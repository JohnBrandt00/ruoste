// @ts-check
'use strict';
require('./harness');
const test = require('node:test');
const assert = require('node:assert/strict');
const { matches, keyOf, RepoSet } = require('../src/github/repos');
const { GitHubClient, classify } = require('../src/github/api');
const { ActionsProvider } = require('../src/github/tree');

test('glob matching for watch and exclude patterns', () => {
  const r = { owner: 'JohnBrandt00', repo: 'radiohub' };
  for (const p of ['JohnBrandt00/radiohub', 'johnbrandt00/RADIOHUB', 'JohnBrandt00/*', '*/radiohub', '*', '*/*', 'JohnBrandt00/radio*'])
    assert.equal(matches(p, r), true, `expected ${p} to match`);
  for (const p of ['someone/radiohub', 'JohnBrandt00/ruoste', 'JohnBrandt00/radiohubx', '', null])
    assert.equal(matches(/** @type {any} */ (p), r), false, `expected ${p} not to match`);
  // a bare name is treated as */name
  assert.equal(matches('radiohub', r), true);
});

test('glob patterns cannot be broken by regex metacharacters', () => {
  assert.equal(matches('a.c/x', { owner: 'abc', repo: 'x' }), false, 'dot must be literal');
  assert.equal(matches('a.c/x', { owner: 'a.c', repo: 'x' }), true);
});

test('keyOf normalises case and includes the host', () => {
  assert.equal(keyOf('JohnBrandt00', 'RadioHub', 'github.com'), 'github.com/johnbrandt00/radiohub');
  assert.notEqual(keyOf('o', 'r', 'github.com'), keyOf('o', 'r', 'ghe.corp'));
});

/** @param {any[]} repos @param {Record<string,any>} [cfg] */
function repoSetWith(repos, cfg = {}) {
  const s = new RepoSet(/** @type {any} */ ({}));
  s.repos = repos;
  Object.defineProperty(s, 'cfg', { get: () => ({ get: (k, d) => (k in cfg ? cfg[k] : d) }) });
  return s;
}
const R = (owner, repo, source = 'affiliated') =>
  ({ owner, repo, host: 'github.com', key: keyOf(owner, repo, 'github.com'), source });

test('byOwner groups repos and puts workspace owners first', () => {
  const s = repoSetWith([R('acme', 'a'), R('JohnBrandt00', 'radiohub', 'workspace'), R('acme', 'b'), R('zeta', 'z')]);
  const groups = s.byOwner();
  assert.equal(groups[0][0], 'JohnBrandt00', 'the owner you have open comes first');
  assert.deepEqual(groups.map(([o]) => o), ['JohnBrandt00', 'acme', 'zeta']);
  assert.equal(groups[1][1].length, 2);
});

test('byOwner hides repos with no workflows, unless disabled', () => {
  const repos = [R('acme', 'a'), R('acme', 'b')];
  const s = repoSetWith(repos);
  s.barren.add(repos[1].key);
  assert.equal(s.byOwner()[0][1].length, 1, 'barren repo hidden by default');
  const s2 = repoSetWith(repos, { hideWithoutWorkflows: false });
  s2.barren.add(repos[1].key);
  assert.equal(s2.byOwner()[0][1].length, 2, 'shown when the setting is off');
});

test('exclude patterns and watchlist scope filter the set', () => {
  const s = repoSetWith([], { exclude: ['old-org/*'] });
  assert.equal(s.allowed(R('old-org', 'thing')), false);
  assert.equal(s.allowed(R('new-org', 'thing')), true);
  const w = repoSetWith([], { scope: 'watchlist', repositories: ['acme/*'] });
  assert.equal(w.allowed(R('acme', 'a')), true);
  assert.equal(w.allowed(R('other', 'a')), false);
});

test('selectForFetch always includes hot repos and rotates the rest', () => {
  const p = new ActionsProvider(/** @type {any} */ ({}));
  const all = Array.from({ length: 20 }, (_, i) => R('acme', `r${i}`));
  Object.defineProperty(p, 'cfg', { get: () => ({ get: (k, d) => (k === 'repositoriesPerCycle' ? 4 : d) }) });

  p.expanded.add(all[7].key);                                   // expanded -> hot
  p.runsByRepo.set(all[3].key, { runs: [{ status: 'in_progress' }], at: 0 });  // live -> hot

  const first = p.selectForFetch(all).map((r) => r.key);
  assert.ok(first.includes(all[7].key), 'expanded repo always fetched');
  assert.ok(first.includes(all[3].key), 'repo with a live run always fetched');
  assert.equal(first.length, 2 + 4, 'two hot plus one warm slice');

  const second = p.selectForFetch(all).map((r) => r.key);
  const warmFirst = first.filter((k) => k !== all[7].key && k !== all[3].key);
  const warmSecond = second.filter((k) => k !== all[7].key && k !== all[3].key);
  assert.notDeepEqual(warmFirst, warmSecond, 'the warm slice advances each cycle');
  assert.ok(second.includes(all[7].key) && second.includes(all[3].key), 'hot repos stay hot');
});

test('selectForFetch skips repos already known to have no workflows', () => {
  const p = new ActionsProvider(/** @type {any} */ ({}));
  const all = Array.from({ length: 6 }, (_, i) => R('acme', `r${i}`));
  Object.defineProperty(p, 'cfg', { get: () => ({ get: (k, d) => (k === 'repositoriesPerCycle' ? 10 : d) }) });
  p.repos.barren.add(all[0].key);
  p.repos.barren.add(all[1].key);
  const got = p.selectForFetch(all).map((r) => r.key);
  assert.equal(got.includes(all[0].key), false);
  assert.equal(got.length, 4, 'only the four non-barren repos');
});

/** new Response() refuses to construct 304/204 (null-body statuses), so fake
 *  just the surface the client touches. */
const fakeRes = (status, body, headers = {}) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  text: async () => body ?? '',
  json: async () => JSON.parse(body || 'null'),
});

test('a 304 returns the cached body and does not spend rate limit', async () => {
  const c = new GitHubClient();
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (async (url, init) => {
    calls.push(init.headers['If-None-Match']);
    if (calls.length === 1)
      return fakeRes(200, JSON.stringify({ workflow_runs: [{ id: 1 }] }),
        { etag: 'W/"abc"', 'x-ratelimit-remaining': '4999', 'x-ratelimit-limit': '5000' });
    return fakeRes(304, '', { etag: 'W/"abc"', 'x-ratelimit-remaining': '4999' });
  });
  try {
    const a = await c.request('github.com', '/repos/o/r/actions/runs', 't');
    const b = await c.request('github.com', '/repos/o/r/actions/runs', 't');
    assert.deepEqual(b, a, '304 must replay the cached body');
    assert.equal(calls[0], undefined, 'first request sends no If-None-Match');
    assert.equal(calls[1], 'W/"abc"', 'second request sends the stored ETag');
    assert.equal(c.conditionalHits, 1);
    assert.equal(c.remaining, 4999, 'the 304 did not consume the budget');
    assert.match(c.budget(), /4999\/5000/);
  } finally { globalThis.fetch = original; }
});

test('mutating requests are never sent conditionally', async () => {
  const c = new GitHubClient();
  c._cache.set('https://api.github.com/x', { etag: 'W/"z"', body: 1 });
  let sent;
  const original = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (async (_u, init) => { sent = init.headers['If-None-Match']; return fakeRes(204, ''); });
  try {
    await c.request('github.com', '/x', 't', { method: 'POST', conditional: false });
    assert.equal(sent, undefined, 'a POST must not carry If-None-Match');
  } finally { globalThis.fetch = original; }
});

test('the request queue is serial and survives a rejection', async () => {
  const c = new GitHubClient();
  const order = [];
  const task = (n, fail) => () => new Promise((res, rej) =>
    setTimeout(() => { order.push(n); fail ? rej(new Error('x')) : res(n); }, 10 - n));
  const results = await Promise.allSettled([
    c.enqueue(task(1)), c.enqueue(task(2, true)), c.enqueue(task(3)),
  ]);
  assert.deepEqual(order, [1, 2, 3], 'ran in submission order despite differing delays');
  assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'rejected', 'fulfilled']);
});

test('classify names GitHub failure modes usefully', () => {
  assert.equal(classify(401, '').kind, 'auth');
  assert.equal(classify(404, 'Not Found').kind, 'not-found');
  assert.equal(classify(403, 'You must authorize SAML SSO').kind, 'sso');
  assert.equal(classify(403, 'nope').kind, 'forbidden');
  const rl = classify(403, '', /** @type {any} */ (new Headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '99' })));
  assert.equal(rl.kind, 'rate-limit');
});

test('liveCount and failedCount aggregate across every repo', () => {
  const p = new ActionsProvider(/** @type {any} */ ({}));
  p.runsByRepo.set('a', { runs: [{ status: 'in_progress' }, { status: 'completed', conclusion: 'success' }], at: 0 });
  p.runsByRepo.set('b', { runs: [{ status: 'completed', conclusion: 'failure' }], at: 0 });
  p.runsByRepo.set('c', { runs: [{ status: 'queued' }], at: 0 });
  assert.equal(p.liveCount, 2, 'in_progress and queued both count as live');
  assert.equal(p.failedCount, 1, 'only the newest run per repo counts');
});
