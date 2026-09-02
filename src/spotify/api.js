// @ts-check
'use strict';
/** Spotify Web API client: refreshes on 401, honours 429 Retry-After, and tells
 *  the three kinds of 403 apart (no Premium / missing scope / endpoint retired). */
const vscode = require('vscode');

const BASE = 'https://api.spotify.com/v1';

/** Endpoints Spotify retired for apps registered on or after 2024-11-27. */
const RETIRED = [
  '/recommendations', '/audio-features', '/audio-analysis',
  '/artists/related-artists', '/browse/featured-playlists', '/browse/categories',
];

class SpotifyError extends Error {
  /** @param {string} message @param {number} status @param {string} kind */
  constructor(message, status, kind) {
    super(message); this.name = 'SpotifyError'; this.status = status; this.kind = kind;
  }
}

/** @param {number} status @param {string} path @param {string} body @returns {SpotifyError} */
function classify(status, path, body) {
  let detail = '';
  try { const j = JSON.parse(body); detail = j?.error?.message || j?.error_description || ''; } catch { /* text */ }

  if (status === 401) return new SpotifyError(detail || 'Session expired', 401, 'auth');
  if (status === 404) return new SpotifyError(detail || 'Nothing is playing, or no active device', 404, 'no-device');
  if (status === 403) {
    if (RETIRED.some((r) => path.includes(r)))
      return new SpotifyError(
        'Spotify retired this endpoint for apps created after 27 Nov 2024. ' +
        'Recommendations, audio features and algorithmic playlists are no longer available.',
        403, 'retired');
    if (/premium/i.test(detail))
      return new SpotifyError('Spotify Premium is required to control playback.', 403, 'premium');
    return new SpotifyError(detail || 'Spotify refused the request (403)', 403, 'forbidden');
  }
  if (status === 429) return new SpotifyError('Rate limited by Spotify', 429, 'rate-limit');
  return new SpotifyError(detail || `Spotify returned ${status}`, status, 'http');
}

class SpotifyApi {
  /** @param {InstanceType<typeof import('./auth').SpotifyAuth>} auth */
  constructor(auth) {
    this.auth = auth;
    /** @type {number} epoch ms; requests short-circuit until then */
    this.rateLimitedUntil = 0;
  }

  /** @param {string} path @param {{method?:string, body?:any, query?:Record<string,any>, retry?:boolean, signal?:AbortSignal}} [o]
   *  @returns {Promise<any>} */
  async request(path, o = {}) {
    if (Date.now() < this.rateLimitedUntil)
      throw new SpotifyError('Rate limited by Spotify; backing off', 429, 'rate-limit');

    const token = await this.auth.token();
    if (!token) throw new SpotifyError('Not signed in to Spotify', 401, 'auth');

    let url = `${BASE}${path}`;
    if (o.query) {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(o.query)) if (v !== undefined && v !== null) q.set(k, String(v));
      const s = q.toString(); if (s) url += (url.includes('?') ? '&' : '?') + s;
    }

    const res = await fetch(url, {
      method: o.method || 'GET',
      signal: o.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(o.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
    });

    if (res.status === 204 || res.status === 202) return null;

    if (res.ok) {
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    }

    if (res.status === 429) {
      const wait = Math.min(60, Number(res.headers.get('retry-after') || 3));
      this.rateLimitedUntil = Date.now() + wait * 1000;
      throw classify(429, path, '');
    }

    // one automatic retry after a refresh, then give up
    if (res.status === 401 && o.retry !== false) {
      await this.auth._refresh();
      if (this.auth.signedIn) return this.request(path, { ...o, retry: false });
    }

    throw classify(res.status, path, await res.text().catch(() => ''));
  }

  // ── player ────────────────────────────────────────────────────────────
  /** @param {AbortSignal} [signal] */
  state(signal) { return this.request('/me/player', { query: { additional_types: 'track,episode' }, signal }); }
  queue()       { return this.request('/me/player/queue'); }
  devices()     { return this.request('/me/player/devices'); }

  /** @param {{uris?:string[], context_uri?:string, offset?:any, position_ms?:number}} [body]
   *  @param {string} [deviceId] */
  play(body, deviceId = undefined) {
    return this.request('/me/player/play', { method: 'PUT', body: body || undefined, query: { device_id: deviceId } });
  }
  pause(deviceId = undefined)     { return this.request('/me/player/pause',    { method: 'PUT',  query: { device_id: deviceId } }); }
  next(deviceId = undefined)      { return this.request('/me/player/next',     { method: 'POST', query: { device_id: deviceId } }); }
  previous(deviceId = undefined)  { return this.request('/me/player/previous', { method: 'POST', query: { device_id: deviceId } }); }
  /** @param {number} ms */
  seek(ms, deviceId = undefined)  { return this.request('/me/player/seek',     { method: 'PUT', query: { position_ms: Math.max(0, Math.round(ms)), device_id: deviceId } }); }
  /** @param {number} pct */
  volume(pct, deviceId = undefined) { return this.request('/me/player/volume', { method: 'PUT', query: { volume_percent: Math.max(0, Math.min(100, Math.round(pct))), device_id: deviceId } }); }
  /** @param {boolean} on */
  shuffle(on, deviceId = undefined) { return this.request('/me/player/shuffle', { method: 'PUT', query: { state: on, device_id: deviceId } }); }
  /** @param {'off'|'track'|'context'} mode */
  repeat(mode, deviceId = undefined) { return this.request('/me/player/repeat', { method: 'PUT', query: { state: mode, device_id: deviceId } }); }
  /** @param {string} uri */
  enqueue(uri, deviceId = undefined) { return this.request('/me/player/queue', { method: 'POST', query: { uri, device_id: deviceId } }); }
  /** @param {string} deviceId @param {boolean} play */
  transfer(deviceId, play = true) { return this.request('/me/player', { method: 'PUT', body: { device_ids: [deviceId], play } }); }

  // ── library ───────────────────────────────────────────────────────────
  /** @param {number} [limit] @param {number} [offset] */
  playlists(limit = 50, offset = 0) { return this.request('/me/playlists', { query: { limit, offset } }); }
  /** @param {string} id @param {number} [limit] @param {number} [offset] */
  playlistTracks(id, limit = 100, offset = 0) {
    return this.request(`/playlists/${id}/tracks`, {
      query: { limit, offset, fields: 'total,items(track(id,uri,name,duration_ms,artists(name),album(name,images)))' },
    });
  }
  /** @param {string} id @param {string[]} uris */
  addToPlaylist(id, uris) { return this.request(`/playlists/${id}/tracks`, { method: 'POST', body: { uris } }); }
  /** @param {number} [limit] @param {number} [offset] */
  savedTracks(limit = 50, offset = 0) { return this.request('/me/tracks', { query: { limit, offset } }); }
  /** @param {string[]} ids */
  isSaved(ids) { return this.request('/me/tracks/contains', { query: { ids: ids.join(',') } }); }
  /** @param {string[]} ids */
  save(ids)   { return this.request('/me/tracks', { method: 'PUT',    body: { ids } }); }
  /** @param {string[]} ids */
  unsave(ids) { return this.request('/me/tracks', { method: 'DELETE', body: { ids } }); }
  recentlyPlayed(limit = 50) { return this.request('/me/player/recently-played', { query: { limit } }); }
  /** @param {'artists'|'tracks'} type */
  top(type, limit = 50) { return this.request(`/me/top/${type}`, { query: { limit, time_range: 'medium_term' } }); }
  me() { return this.request('/me'); }

  // ── search ────────────────────────────────────────────────────────────
  /** @param {string} q @param {string[]} types @param {number} [limit] @param {AbortSignal} [signal] */
  search(q, types = ['track', 'album', 'artist', 'playlist'], limit = 8, signal) {
    return this.request('/search', { query: { q, type: types.join(','), limit }, signal });
  }
  /** @param {string} id */
  artistTopTracks(id, market = 'from_token') {
    return this.request(`/artists/${id}/top-tracks`, { query: { market } });
  }
}

module.exports = { SpotifyApi, SpotifyError, classify, RETIRED, BASE };
