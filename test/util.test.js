// @ts-check
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseRemote, formatDuration, relativeTime, statusPresentation, runElapsed, shortRef,
} = require('../src/util');

test('parseRemote handles every remote form GitHub accepts', () => {
  const cases = [
    ['git@github.com:JohnBrandt00/radiohub.git',            'JohnBrandt00', 'radiohub', 'github.com'],
    ['git@github.com:JohnBrandt00/radiohub',                'JohnBrandt00', 'radiohub', 'github.com'],
    ['https://github.com/JohnBrandt00/radiohub.git',        'JohnBrandt00', 'radiohub', 'github.com'],
    ['https://github.com/JohnBrandt00/radiohub',            'JohnBrandt00', 'radiohub', 'github.com'],
    ['https://user@github.com/JohnBrandt00/radiohub.git',   'JohnBrandt00', 'radiohub', 'github.com'],
    ['ssh://git@github.com/JohnBrandt00/radiohub.git',      'JohnBrandt00', 'radiohub', 'github.com'],
    ['ssh://git@github.com:22/JohnBrandt00/radiohub.git',   'JohnBrandt00', 'radiohub', 'github.com'],
    ['git://github.com/JohnBrandt00/radiohub.git',          'JohnBrandt00', 'radiohub', 'github.com'],
    ['https://github.com/JohnBrandt00/radiohub/',           'JohnBrandt00', 'radiohub', 'github.com'],
    ['git@ghe.corp.internal:platform/receiver.git',         'platform',     'receiver', 'ghe.corp.internal'],
    ['https://ghe.corp.internal/platform/receiver.git',     'platform',     'receiver', 'ghe.corp.internal'],
  ];
  for (const [url, owner, repo, host] of cases) {
    const r = parseRemote(url);
    assert.ok(r, `failed to parse ${url}`);
    assert.deepEqual([r.owner, r.repo, r.host], [owner, repo, host], url);
  }
});

test('parseRemote rejects junk instead of guessing', () => {
  for (const bad of ['', '   ', 'not a url', 'https://github.com/onlyowner', 'github.com', null, undefined, 42])
    assert.equal(parseRemote(/** @type {any} */ (bad)), null, String(bad));
});

test('formatDuration', () => {
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(9_400), '9s');
  assert.equal(formatDuration(59_000), '59s');
  assert.equal(formatDuration(60_000), '1m');
  assert.equal(formatDuration(134_000), '2m 14s');
  assert.equal(formatDuration(3_600_000), '1h');
  assert.equal(formatDuration(5_400_000), '1h 30m');
  assert.equal(formatDuration(NaN), '—');
  assert.equal(formatDuration(-5), '—');
});

test('relativeTime', () => {
  const now = Date.parse('2026-09-02T12:00:00Z');
  const at = (iso) => relativeTime(iso, now);
  assert.equal(at('2026-09-02T11:59:50Z'), 'just now');
  assert.equal(at('2026-09-02T11:55:00Z'), '5m ago');
  assert.equal(at('2026-09-02T09:00:00Z'), '3h ago');
  assert.equal(at('2026-08-31T12:00:00Z'), '2d ago');
  assert.equal(at('2026-08-19T12:00:00Z'), '2w ago');
  assert.equal(at('2026-01-05T12:00:00Z'), '2026-01-05');
  assert.equal(at(null), '');
  assert.equal(at('nonsense'), '');
});

test('statusPresentation covers every GitHub status and conclusion', () => {
  assert.equal(statusPresentation('in_progress', null).live, true);
  assert.equal(statusPresentation('queued', null).live, true);
  assert.equal(statusPresentation('completed', 'success').icon, 'pass-filled');
  assert.equal(statusPresentation('completed', 'success').color, 'testing.iconPassed');
  assert.equal(statusPresentation('completed', 'failure').color, 'testing.iconFailed');
  assert.equal(statusPresentation('completed', 'cancelled').label, 'cancelled');
  assert.equal(statusPresentation('completed', 'timed_out').label, 'timed out');
  assert.equal(statusPresentation('completed', 'skipped').live, false);
  // anything unknown must still return a usable icon, never undefined
  for (const c of ['neutral', 'stale', 'action_required', 'weird_new_thing', null, undefined]) {
    const p = statusPresentation('completed', c);
    assert.ok(p.icon && typeof p.icon === 'string', String(c));
    assert.equal(p.live, false);
  }
});

test('every colour id used by statusPresentation exists in the themes', () => {
  const fs = require('node:fs');
  const theme = JSON.parse(fs.readFileSync(`${__dirname}/../themes/ruoste-color-theme.json`, 'utf8'));
  const used = new Set();
  for (const s of ['in_progress', 'queued', 'completed'])
    for (const c of [null, 'success', 'failure', 'timed_out', 'action_required',
                     'cancelled', 'skipped', 'neutral', 'stale'])
      { const p = statusPresentation(s, c); if (p.color) used.add(p.color); }
  for (const id of used)
    assert.ok(id in theme.colors, `theme is missing colour id "${id}"`);
});

test('runElapsed uses updated_at once complete and now while running', () => {
  const now = Date.parse('2026-09-02T12:00:00Z');
  assert.equal(runElapsed({ run_started_at: '2026-09-02T11:58:00Z', status: 'in_progress' }, now), 120_000);
  assert.equal(runElapsed({
    run_started_at: '2026-09-02T11:00:00Z', updated_at: '2026-09-02T11:02:14Z', status: 'completed',
  }, now), 134_000);
  assert.ok(Number.isNaN(runElapsed({}, now)));
});

test('shortRef strips ref prefixes and truncates the middle', () => {
  assert.equal(shortRef('refs/heads/main'), 'main');
  assert.equal(shortRef('refs/tags/v1.2.0'), 'tag:v1.2.0');
  assert.equal(shortRef('feature/add-squelch'), 'feature/add-squelch');
  assert.equal(shortRef(''), '');
  assert.equal(shortRef(null), '');
  const long = shortRef('feature/a-very-long-branch-name-indeed-yes', 20);
  assert.equal(long.length, 20);
  assert.ok(long.includes('…'));
});
