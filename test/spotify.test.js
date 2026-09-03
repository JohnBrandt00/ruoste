// @ts-check
'use strict';
require('./harness');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  trackTime, artistNames, artwork, parseUri, toUri,
  DJ_URI, isDjPlaying, progressFraction, playerSummary,
} = require('../src/spotify/format');
const { classify, RETIRED } = require('../src/spotify/api');
const { pkcePair, b64url, SCOPES } = require('../src/spotify/auth');

test('trackTime formats m:ss and h:mm:ss', () => {
  assert.equal(trackTime(0), '0:00');
  assert.equal(trackTime(9_000), '0:09');
  assert.equal(trackTime(65_000), '1:05');
  assert.equal(trackTime(214_000), '3:34');
  assert.equal(trackTime(3_725_000), '1:02:05');
  assert.equal(trackTime(NaN), '0:00');
  assert.equal(trackTime(-1), '0:00');
});

test('artistNames joins and survives missing data', () => {
  assert.equal(artistNames({ artists: [{ name: 'Boards of Canada' }] }), 'Boards of Canada');
  assert.equal(artistNames({ artists: [{ name: 'A' }, { name: 'B' }] }), 'A, B');
  assert.equal(artistNames({ artists: [] }), '');
  assert.equal(artistNames({}), '');
  assert.equal(artistNames(null), '');
  assert.equal(artistNames(/** @type {any} */ ({ artists: [{ name: 'A' }, null, {}] })), 'A');
});

test('artwork picks the smallest image at or above the requested width', () => {
  const imgs = [{ url: 'l', width: 640 }, { url: 's', width: 64 }, { url: 'm', width: 300 }];
  assert.equal(artwork(imgs, 300), 'm');
  assert.equal(artwork(imgs, 64), 's');
  assert.equal(artwork(imgs, 1000), 'l');   // nothing big enough -> largest
  assert.equal(artwork([], 300), undefined);
  assert.equal(artwork(null, 300), undefined);
});

test('parseUri accepts spotify: URIs and open.spotify.com links', () => {
  assert.deepEqual(parseUri('spotify:track:4cOdK2wGLETKBW3PvgPWqT'), { type: 'track', id: '4cOdK2wGLETKBW3PvgPWqT' });
  assert.deepEqual(parseUri('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M'), { type: 'playlist', id: '37i9dQZF1DXcBWIGoYBM5M' });
  assert.deepEqual(parseUri('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT'), { type: 'track', id: '4cOdK2wGLETKBW3PvgPWqT' });
  assert.deepEqual(parseUri('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=abc123'), { type: 'track', id: '4cOdK2wGLETKBW3PvgPWqT' });
  // localised share links carry an intl- segment
  assert.deepEqual(parseUri('https://open.spotify.com/intl-de/album/1234567890abcdefABCDEF'), { type: 'album', id: '1234567890abcdefABCDEF' });
  for (const bad of ['', 'nonsense', 'https://example.com/track/x', null, undefined, 7])
    assert.equal(parseUri(/** @type {any} */ (bad)), null, String(bad));
  assert.equal(toUri({ type: 'track', id: 'abc' }), 'spotify:track:abc');
});

test('isDjPlaying only matches the DJ context', () => {
  assert.equal(isDjPlaying({ context: { uri: DJ_URI } }), true);
  assert.equal(isDjPlaying({ context: { uri: 'spotify:user:x:collection:dj' } }), true);
  assert.equal(isDjPlaying({ context: { uri: 'spotify:playlist:other' } }), false);
  assert.equal(isDjPlaying({ context: null }), false);
  assert.equal(isDjPlaying(null), false);
});

test('progressFraction is clamped and division-safe', () => {
  assert.equal(progressFraction(50, 100), 0.5);
  assert.equal(progressFraction(0, 0), 0);        // no divide-by-zero
  assert.equal(progressFraction(200, 100), 1);
  assert.equal(progressFraction(-5, 100), 0);
  assert.equal(progressFraction(NaN, 100), 0);
});

test('playerSummary flattens a real /me/player payload', () => {
  const s = playerSummary({
    is_playing: true, progress_ms: 61_000, shuffle_state: true, repeat_state: 'context',
    device: { id: 'd1', name: 'Studio', volume_percent: 62 },
    context: { uri: 'spotify:playlist:abc' },
    item: {
      id: 't1', uri: 'spotify:track:t1', name: 'Kaputt', duration_ms: 214_000, type: 'track',
      artists: [{ name: 'Destroyer' }], album: { name: 'Kaputt', images: [{ url: 'art', width: 300 }] },
    },
  });
  assert.equal(s.playing, true);
  assert.equal(s.title, 'Kaputt');
  assert.equal(s.artist, 'Destroyer');
  assert.equal(s.art, 'art');
  assert.equal(s.volume, 62);
  assert.equal(s.shuffle, true);
  assert.equal(s.repeat, 'context');
  assert.equal(s.isEpisode, false);
  assert.equal(s.dj, false);
});

test('playerSummary survives a null player (nothing playing, no device)', () => {
  const s = playerSummary(null);
  assert.equal(s.playing, false);
  assert.equal(s.hasDevice, false);
  assert.equal(s.title, '');
  assert.equal(s.duration, 0);
  assert.equal(s.volume, null);
  assert.equal(s.art, undefined);
});

test('classify separates the three kinds of 403', () => {
  const retired = classify(403, '/recommendations?seed_tracks=x', '{}');
  assert.equal(retired.kind, 'retired');
  assert.match(retired.message, /27 Nov 2024/);

  const premium = classify(403, '/me/player/play', JSON.stringify({ error: { message: 'Player command failed: Premium required' } }));
  assert.equal(premium.kind, 'premium');

  const plain = classify(403, '/me/player/play', JSON.stringify({ error: { message: 'Forbidden' } }));
  assert.equal(plain.kind, 'forbidden');

  assert.equal(classify(401, '/me', '{}').kind, 'auth');
  assert.equal(classify(404, '/me/player', '{}').kind, 'no-device');
  assert.equal(classify(429, '/me/player', '').kind, 'rate-limit');
  assert.equal(classify(500, '/me', 'boom').kind, 'http');
});

test('every retired endpoint is recognised from its path', () => {
  for (const r of RETIRED)
    assert.equal(classify(403, `${r}?x=1`, '{}').kind, 'retired', r);
});

test('PKCE verifier and challenge are spec-shaped', () => {
  const { verifier, challenge } = pkcePair();
  assert.ok(verifier.length >= 43 && verifier.length <= 128, `verifier length ${verifier.length}`);
  assert.match(verifier, /^[A-Za-z0-9\-._~]+$/, 'verifier must be url-safe with no padding');
  assert.match(challenge, /^[A-Za-z0-9\-_]+$/, 'challenge must be base64url with no padding');
  assert.equal(challenge.length, 43, 'S256 challenge is 43 chars');
  assert.notEqual(pkcePair().verifier, verifier, 'verifiers must not repeat');
  assert.equal(b64url(Buffer.from([255, 254, 253])), '__79');
});

test('requested scopes cover every feature the UI exposes', () => {
  for (const need of [
    'user-read-playback-state',   // read player
    'user-modify-playback-state', // transport, queue, transfer
    'playlist-read-private',      // browse playlists
    'playlist-modify-private',    // add to playlist — CodeBeats omits this
    'user-library-read', 'user-library-modify',  // like / unlike
  ]) assert.ok(SCOPES.includes(need), `missing scope ${need}`);
});

test('webview references assets that exist, and locks down CSP', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'spotify', 'webview.js'), 'utf8');
  for (const asset of ['spotify.css', 'spotify.js'])
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'media', asset)), `media/${asset} is missing`);
  assert.match(html, /default-src 'none'/, 'CSP must default-deny');
  assert.match(html, /script-src 'nonce-\$\{n\}'/, 'scripts must be nonce-gated');
  assert.match(html, /i\.scdn\.co/, 'album art host must be allowed');
  assert.doesNotMatch(html, /script-src[^;]*'unsafe-inline'/, 'no unsafe-inline scripts');
});

// ── response body handling ──────────────────────────────────────────────
const { readBody, SpotifyApi } = require('../src/spotify/api');

/** new Response() cannot construct 204, so fake the surface we read. */
const res = (status, body, type) => /** @type {any} */ ({
  status, ok: status >= 200 && status < 300,
  headers: { get: (k) => (k.toLowerCase() === 'content-type' ? type ?? null : null) },
  text: async () => body ?? '',
});

test('readBody never assumes a 2xx body is JSON', async () => {
  // the real regression: Spotify answers player POSTs with a bare trace id
  assert.equal(await readBody(res(200, 'Yv6puxxLYD', 'text/plain')), 'Yv6puxxLYD');
  assert.equal(await readBody(res(200, 'd84dWL__jz')), 'd84dWL__jz', 'no content-type at all');
  // and with a JSON content-type but a malformed body, return the text, never throw
  assert.equal(await readBody(res(200, 'd84dWL__jz', 'application/json')), 'd84dWL__jz');
  // proper JSON still parses
  assert.deepEqual(await readBody(res(200, '{"a":1}', 'application/json; charset=utf-8')), { a: 1 });
  // empty and no-content responses are null
  for (const r of [res(204, ''), res(205, ''), res(304, ''), res(200, ''), res(200, '   ')])
    assert.equal(await readBody(r), null);
});

test('a player command that replies with plain text resolves instead of throwing', async () => {
  const api = new SpotifyApi(/** @type {any} */ ({ token: async () => 'tok', signedIn: true }));
  const original = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (async () => res(200, 'd84dWL__jz', 'text/plain'));
  try {
    // this is exactly the call that failed: POST /me/player/next
    await assert.doesNotReject(() => api.next(), 'skip forward must not throw on a non-JSON body');
    await assert.doesNotReject(() => api.enqueue('spotify:track:abc'), 'add to queue likewise');
  } finally { globalThis.fetch = original; }
});

test('an error body that is not JSON still produces a usable message', () => {
  const e = classify(500, '/me/player/next', 'upstream exploded');
  assert.equal(e.status, 500);
  assert.ok(e.message.length, 'never an empty message');
});
