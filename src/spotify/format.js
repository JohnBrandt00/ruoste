// @ts-check
'use strict';
/** Pure display helpers for the Spotify surfaces — unit tested, no vscode import. */

/** @param {number} ms @returns {string} m:ss or h:mm:ss */
function trackTime(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const s = total % 60, m = Math.floor(total / 60) % 60, h = Math.floor(total / 3600);
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** @param {{artists?:{name:string}[]}|null|undefined} item @returns {string} */
function artistNames(item) {
  const a = item && Array.isArray(item.artists) ? item.artists : [];
  return a.map((x) => x && x.name).filter(Boolean).join(', ');
}

/** Pick the artwork closest to (but not below) the requested width.
 * @param {{url:string,width?:number,height?:number}[]|null|undefined} images @param {number} want
 * @returns {string|undefined} */
function artwork(images, want = 300) {
  if (!Array.isArray(images) || !images.length) return undefined;
  const sorted = images.filter((i) => i && i.url).slice()
    .sort((a, b) => (a.width || 0) - (b.width || 0));
  return (sorted.find((i) => (i.width || 0) >= want) || sorted[sorted.length - 1]).url;
}

/** "spotify:track:abc" -> {type:'track', id:'abc'}; also accepts open.spotify.com links.
 * @param {string} input @returns {{type:string,id:string}|null} */
function parseUri(input) {
  if (!input || typeof input !== 'string') return null;
  const s = input.trim();
  let m = /^spotify:([a-z]+):([A-Za-z0-9]+)/.exec(s);
  if (m) return { type: m[1], id: m[2] };
  m = /^https?:\/\/open\.spotify\.com\/(?:intl-[a-z]+\/)?([a-z]+)\/([A-Za-z0-9]+)/.exec(s);
  if (m) return { type: m[1], id: m[2] };
  return null;
}

/** @param {{type:string,id:string}} r @returns {string} */
const toUri = (r) => `spotify:${r.type}:${r.id}`;

/** Spotify's own DJ. Readable when playing; a new app cannot start it. */
const DJ_URI = 'spotify:playlist:37i9dQZF1EYkqdzj48dyYq';

/** @param {any} state @returns {boolean} */
function isDjPlaying(state) {
  const ctx = state && state.context;
  if (!ctx) return false;
  return String(ctx.uri || '') === DJ_URI || /:collection:dj$/i.test(String(ctx.uri || ''));
}

/** Progress as 0..1, guarding against a null item or zero duration.
 * @param {number} progress @param {number} duration @returns {number} */
function progressFraction(progress, duration) {
  if (!Number.isFinite(progress) || !Number.isFinite(duration) || duration <= 0) return 0;
  return Math.max(0, Math.min(1, progress / duration));
}

/** Flatten /me/player into what the UI needs. @param {any} s @returns {any} */
function playerSummary(s) {
  const item = s && s.item;
  return {
    playing: !!(s && s.is_playing),
    hasDevice: !!(s && s.device),
    deviceName: s?.device?.name || '',
    deviceId: s?.device?.id || '',
    volume: typeof s?.device?.volume_percent === 'number' ? s.device.volume_percent : null,
    shuffle: !!(s && s.shuffle_state),
    repeat: (s && s.repeat_state) || 'off',
    progress: Number(s?.progress_ms) || 0,
    duration: Number(item?.duration_ms) || 0,
    title: item?.name || '',
    artist: artistNames(item) || item?.show?.name || '',
    album: item?.album?.name || '',
    art: artwork(item?.album?.images || item?.images, 300),
    uri: item?.uri || '',
    id: item?.id || '',
    isEpisode: item?.type === 'episode',
    dj: isDjPlaying(s),
    contextUri: s?.context?.uri || '',
  };
}

module.exports = {
  trackTime, artistNames, artwork, parseUri, toUri,
  DJ_URI, isDjPlaying, progressFraction, playerSummary,
};
