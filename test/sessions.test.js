// @ts-check
'use strict';
require('./harness');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vscode = require('vscode');
const R = require('../src/sessions/read');
const { activateSessions, Poller, SessionsProvider, createStore } = require('../src/sessions');
const { handleWebviewMessage } = require('../src/sessions/panel');

const ROOT = path.resolve(__dirname, '..');
const SID = '11111111-2222-4333-8444-555555555555';
const NOW = Date.parse('2026-10-29T12:00:00Z');

/** @returns {string} a fresh temp dir, removed when the test ends */
function tmp(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ruoste-sessions-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}
/** @param {string} p @param {string} s */
function put(p, s) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); }
const sessionFile = (o = {}) => JSON.stringify(Object.assign({
  pid: 100, sessionId: SID, cwd: 'C:\\w', startedAt: NOW - 60000, procStart: '1', version: '2.1.314',
  kind: 'interactive', entrypoint: 'cli', name: 'main', status: 'busy', updatedAt: NOW - 1000,
}, o));
const alive = () => true;

// ── P1.T1 sessions ──────────────────────────────────────────────────────
const STATUS_CASES = [
  ['busy', undefined, 'working'], ['idle', undefined, 'needsInput'],
  ['waiting', 'permission prompt', 'needsPermission'], ['waiting', 'x', 'waiting'],
  [undefined, undefined, 'unknown'], [42, undefined, 'unknown'],
];
for (const [raw, wf, want] of STATUS_CASES) {
  test(`mapStatus maps ${JSON.stringify(raw)} + ${JSON.stringify(wf)} to ${want}`, () => {
    assert.equal(R.mapStatus(raw, wf), want);
  });
}

test('readSessions reads N.json files and never opens .key or other names', (t) => {
  const home = tmp(t);
  put(path.join(home, 'sessions', '100.json'), sessionFile());
  put(path.join(home, 'sessions', '100.abcdef.key'), 'SECRET');
  put(path.join(home, 'sessions', 'notes.json'), '{}');
  const opened = [];
  const orig = fs.readFileSync;
  fs.readFileSync = /** @type {any} */ ((p, ...rest) => { opened.push(String(p)); return orig.call(fs, p, ...rest); });
  let r;
  try { r = R.readSessions(home, alive); } finally { fs.readFileSync = orig; }
  assert.ok(r.ok);
  assert.equal(r.ok && r.value.length, 1);
  assert.deepEqual(opened.filter((p) => !/100\.json$/.test(p)), []);
});

test('readSessions maps a live pid to its status and a dead pid to ended', (t) => {
  const home = tmp(t);
  put(path.join(home, 'sessions', '100.json'), sessionFile());
  put(path.join(home, 'sessions', '200.json'), sessionFile({ pid: 200, sessionId: 'b', status: 'idle' }));
  const r = R.readSessions(home, (pid) => pid === 100);
  assert.ok(r.ok);
  const by = Object.fromEntries(r.ok ? r.value.map((s) => [s.pid, s]) : []);
  assert.equal(by[100].status, 'working');
  assert.equal(by[200].status, 'ended');
  assert.equal(by[100].owned, false);
  assert.equal(by[100].name, 'main');
});

test('readSessions returns ok and empty when the sessions dir is missing', (t) => {
  const r = R.readSessions(tmp(t), alive);
  assert.deepEqual(r, { ok: true, value: [] });
});

test('readSessions returns unreadable when the sessions path is not a directory', (t) => {
  const home = tmp(t);
  put(path.join(home, 'sessions'), 'a file');
  const r = R.readSessions(home, alive);
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.reason, 'unreadable');
});

test('readSessions keeps the previous row for a half-written file', (t) => {
  const home = tmp(t);
  put(path.join(home, 'sessions', '100.json'), sessionFile());
  const first = R.readSessions(home, alive);
  assert.ok(first.ok);
  put(path.join(home, 'sessions', '100.json'), '{"pid": 100, "sess');
  const prev = new Map(first.ok ? first.value.map((s) => [s.pid, s]) : []);
  const second = R.readSessions(home, alive, prev);
  assert.ok(second.ok);
  assert.equal(second.ok && second.value[0].sessionId, SID);
});

test('readSessions skips a half-written file with no previous row and returns the others', (t) => {
  const home = tmp(t);
  put(path.join(home, 'sessions', '100.json'), '{"pid": 100, "sess');
  put(path.join(home, 'sessions', '200.json'), sessionFile({ pid: 200, sessionId: 'b' }));
  const r = R.readSessions(home, alive);
  assert.ok(r.ok);
  assert.deepEqual(r.ok && r.value.map((s) => s.pid), [200]);
});

test('parseTail takes gitBranch and timestamp of the last complete line and ignores a partial one', () => {
  const lines = [
    '"partial": 1}',
    JSON.stringify({ type: 'user', gitBranch: 'old', timestamp: '2026-10-29T10:00:00.000Z' }),
    JSON.stringify({ type: 'assistant', gitBranch: 'feat/x', timestamp: '2026-10-29T11:00:00.000Z' }),
    '{"type":"assistant","gitBr',
  ];
  assert.deepEqual(R.parseTail(lines), { branch: 'feat/x', lastActivity: '2026-10-29T11:00:00.000Z' });
});

test('readTail drops the partial first line when it starts mid-file', (t) => {
  const f = path.join(tmp(t), 'a.jsonl');
  put(f, ['{"n":1}', '{"n":2}', '{"n":3}'].join('\n') + '\n');
  const lines = R.readTail(f, 12);
  assert.deepEqual(lines, ['{"n":3}']);
});

test('findTranscript finds the file under any slug directory and caches the hit', (t) => {
  const home = tmp(t);
  const file = path.join(home, 'projects', 'o--RUOSTE-ruoste', `${SID}.jsonl`);
  put(file, '{}\n');
  assert.equal(R.findTranscript(home, SID), file);
  let reads = 0;
  const orig = fs.readdirSync;
  fs.readdirSync = /** @type {any} */ ((...a) => { reads++; return orig.apply(fs, a); });
  try { assert.equal(R.findTranscript(home, SID), file); } finally { fs.readdirSync = orig; }
  assert.equal(reads, 0);
});

test('findTranscript returns undefined when nothing matches', (t) => {
  assert.equal(R.findTranscript(tmp(t), SID), undefined);
});

// parity: flag off
function countRegistrations() {
  const seen = { commands: 0, views: 0, timers: 0 };
  const rc = vscode.commands.registerCommand, ctv = vscode.window.createTreeView, si = global.setInterval;
  vscode.commands.registerCommand = /** @type {any} */ (() => { seen.commands++; return { dispose() {} }; });
  vscode.window.createTreeView = /** @type {any} */ (() => { seen.views++; return { dispose() {}, visible: false, onDidChangeVisibility: () => ({ dispose() {} }) }; });
  global.setInterval = /** @type {any} */ (() => { seen.timers++; return 0; });
  return { seen, restore() { vscode.commands.registerCommand = rc; vscode.window.createTreeView = ctv; global.setInterval = si; } };
}

test('activateSessions registers nothing when the flag is off', () => {
  const c = countRegistrations();
  let r;
  try { r = activateSessions(/** @type {any} */ ({ subscriptions: [], extensionUri: vscode.Uri.file('/x') })); } finally { c.restore(); }
  assert.equal(r, undefined);
  assert.deepEqual(c.seen, { commands: 0, views: 0, timers: 0 });
});

test('activateSessions registers 2 commands and 1 view when the flag is on', async (t) => {
  await vscode.workspace.getConfiguration('ruoste.sessions').update('enabled', true);
  t.after(() => vscode.workspace.getConfiguration('ruoste.sessions').update('enabled', false));
  const c = countRegistrations();
  let r;
  try { r = activateSessions(/** @type {any} */ ({ subscriptions: [], extensionUri: vscode.Uri.file('/x') }), { home: tmp(t), isAlive: alive, now: () => NOW }); }
  finally { c.restore(); }
  assert.ok(r);
  r.poller.stop();
  assert.equal(c.seen.commands, 2);
  assert.equal(c.seen.views, 1);
});

test('package.json gates every sessions command, keeps the view always visible and the setting application-scoped', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const cmds = pkg.contributes.commands.map((c) => c.command).filter((c) => c.startsWith('ruoste.sessions.'));
  assert.ok(cmds.length >= 2);
  const palette = pkg.contributes.menus.commandPalette;
  for (const c of cmds) {
    const e = palette.find((p) => p.command === c);
    assert.ok(e && /config\.ruoste\.sessions\.enabled/.test(e.when), `${c} needs a palette gate`);
  }
  const view = pkg.contributes.views.ruoste.find((v) => v.id === 'ruoste.sessions');
  assert.ok(view, 'view declared');
  assert.equal(view.when, undefined);
  const welcome = pkg.contributes.viewsWelcome.filter((w) => w.view === 'ruoste.sessions');
  assert.ok(welcome.some((w) => /!config\.ruoste\.sessions\.enabled/.test(w.when)), 'off-state welcome');
  assert.equal(pkg.contributes.configuration.properties['ruoste.sessions.enabled'].default, false);
  assert.equal(pkg.contributes.configuration.properties['ruoste.sessions.enabled'].scope, 'application');
});

// ── P1.T2 roster ────────────────────────────────────────────────────────
const asst = (id, out, o = {}) => JSON.stringify(Object.assign({
  type: 'assistant', timestamp: '2026-10-29T11:00:00.000Z',
  message: { id, model: 'claude-opus-x', role: 'assistant', content: [],
    usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 999, output_tokens: out } },
}, o));
const handback = (text) => JSON.stringify({ type: 'assistant', timestamp: '2026-10-29T11:05:00.000Z',
  message: { id: 'hb', model: 'claude-opus-x', content: [{ type: 'tool_use', name: 'SubagentHandback', input: { message: text } }],
    usage: { input_tokens: 1, cache_creation_input_tokens: 1, output_tokens: 1 } } });

/** transcript + subagent dir; returns the transcript path */
function roster(home, agents) {
  const tr = path.join(home, 'projects', 's', `${SID}.jsonl`);
  put(tr, '{}\n');
  for (const [id, meta, lines] of agents) {
    const d = path.join(home, 'projects', 's', SID, 'subagents');
    put(path.join(d, `agent-${id}.meta.json`), JSON.stringify(meta));
    if (lines) put(path.join(d, `agent-${id}.jsonl`), lines.join('\n') + '\n');
  }
  return tr;
}
const META = { agentType: 'builder', description: 'Build P1', spawnDepth: 1, effort: 'high' };

test('readRoster marks an agent without finished as running', (t) => {
  const tr = roster(tmp(t), [['a1', META, [asst('m1', 3)]]]);
  const r = R.readRoster(tr, new Map());
  assert.ok(r.ok);
  assert.equal(r.ok && r.value[0].state, 'running');
  assert.equal(r.ok && r.value[0].description, 'Build P1');
});

test('readRoster reads STATUS and REPORT from the SubagentHandback and marks it finished', (t) => {
  const tr = roster(tmp(t), [['a1', { ...META, finished: true }, [asst('m1', 3), handback('STATUS: DONE\nREPORT: .claude/work/x/r.md\nSUMMARY: ok')]]]);
  const r = R.readRoster(tr, new Map());
  assert.ok(r.ok);
  const a = r.ok ? r.value[0] : undefined;
  assert.equal(a.state, 'finished');
  assert.equal(a.status, 'DONE');
  assert.equal(a.report, '.claude/work/x/r.md');
});

test('readRoster marks finished without a handback as finished with no status', (t) => {
  const tr = roster(tmp(t), [['a1', { ...META, finished: true }, [asst('m1', 3)]]]);
  const r = R.readRoster(tr, new Map());
  assert.ok(r.ok);
  assert.equal(r.ok && r.value[0].state, 'finished');
  assert.equal(r.ok && r.value[0].status, undefined);
});

test('readRoster sums tokens by message id, last line wins (36 lines, 20 ids)', (t) => {
  const lines = [];
  let want = 0;
  for (let i = 0; i < 20; i++) {
    if (i < 16) lines.push(asst(`m${i}`, 1));           // streamed early, smaller
    lines.push(asst(`m${i}`, 100 + i));                  // final
    want += 10 + 5 + 100 + i;                            // cache_read is not counted
  }
  assert.equal(lines.length, 36);
  const tr = roster(tmp(t), [['a1', META, lines]]);
  const r = R.readRoster(tr, new Map());
  assert.ok(r.ok);
  assert.equal(r.ok && r.value[0].tokens, want);
});

test('readRoster takes model from message.model and effort and spawnDepth from meta', (t) => {
  const tr = roster(tmp(t), [['a1', META, [asst('m1', 3)]]]);
  const r = R.readRoster(tr, new Map());
  const a = r.ok ? r.value[0] : undefined;
  assert.equal(a.model, 'claude-opus-x');
  assert.equal(a.effort, 'high');
  assert.equal(a.spawnDepth, 1);
});

test('readRoster returns ok and empty when there is no subagents dir', (t) => {
  const home = tmp(t);
  const tr = path.join(home, 'projects', 's', `${SID}.jsonl`);
  put(tr, '{}\n');
  assert.deepEqual(R.readRoster(tr, new Map()), { ok: true, value: [] });
});

test('readRoster skips a bad JSON line and keeps the rest', (t) => {
  const tr = roster(tmp(t), [['a1', META, ['{"bad', asst('m1', 7)]]]);
  const r = R.readRoster(tr, new Map());
  assert.equal(r.ok && r.value[0].tokens, 22);
});

test('readJsonl keeps a partial last line in cursor.rest and joins it on the next read', (t) => {
  const f = path.join(tmp(t), 'a.jsonl');
  put(f, '{"n":1}\n{"n":');
  const a = R.readJsonl(f);
  assert.deepEqual(a.lines, [{ n: 1 }]);
  assert.equal(a.cursor.rest, '{"n":');
  fs.appendFileSync(f, '2}\n');
  const b = R.readJsonl(f, a.cursor);
  assert.deepEqual(b.lines, [{ n: 2 }]);
  assert.equal(b.reset, false);
});

test('readJsonl resets and rereads from the start when the file shrank', (t) => {
  const f = path.join(tmp(t), 'a.jsonl');
  put(f, '{"n":1}\n');
  const r = R.readJsonl(f, { offset: 5000, rest: '' });
  assert.equal(r.reset, true);
  assert.deepEqual(r.lines, [{ n: 1 }]);
});

test('parseHandback reads the first STATUS word and the REPORT path', () => {
  assert.deepEqual(R.parseHandback('STATUS: DONE_WITH_CONCERNS\nREPORT: a/b.md\nx'), { status: 'DONE_WITH_CONCERNS', report: 'a/b.md' });
  assert.deepEqual(R.parseHandback('no block'), {});
});

// ── P1.T3 chief context ─────────────────────────────────────────────────
const LEDGER = [
  '22:47 | recon | investigator(sonnet/medium) | DONE | plain VS Code ext | facts.md',
  '23:10 | P1 build | builder(opus*/high) | RUNNING | T1-T4 red/green | briefs/P1-build.md',
  '22:44 | RULING: proceed despite budget guard — user chose it — weekly limit may run out',
  'RULING: no time — because — cost',
  'garbage line without pipes',
].join('\n');

test('parseLedger reads the six fields and keeps the star on builder(opus*/high)', () => {
  const l = R.parseLedger(LEDGER);
  assert.deepEqual(l.entries[0], { time: '22:47', step: 'recon', agent: 'investigator(sonnet/medium)', status: 'DONE', result: 'plain VS Code ext', report: 'facts.md' });
  assert.equal(l.entries[1].agent, 'builder(opus*/high)');
});

test('parseLedger reads a RULING with and without a time prefix', () => {
  const l = R.parseLedger(LEDGER);
  assert.deepEqual(l.entries[2].ruling, { decision: 'proceed despite budget guard', why: 'user chose it', cost: 'weekly limit may run out' });
  assert.equal(l.entries[2].time, '22:44');
  assert.deepEqual(l.entries[3].ruling, { decision: 'no time', why: 'because', cost: 'cost' });
  assert.equal(l.entries[3].time, undefined);
});

test('parseLedger counts a malformed line as skipped and keeps the others', () => {
  const l = R.parseLedger(LEDGER);
  assert.equal(l.skipped, 1);
  assert.equal(l.entries.length, 4);
});

test('readLedger returns missing when there is no ACTIVE file', (t) => {
  const r = /** @type {any} */ (R.readLedger(tmp(t)));
  assert.equal(!r.ok && r.reason, 'missing');
});

test('readLedger returns missing when ACTIVE has no ledger.md', (t) => {
  const cwd = tmp(t);
  put(path.join(cwd, '.claude', 'work', 'ACTIVE'), 'slug-a');
  assert.equal(R.readLedger(cwd).ok, false);
});

test('readLedger reads the active ledger and refuses a slug that climbs out', (t) => {
  const cwd = tmp(t);
  put(path.join(cwd, '.claude', 'work', 'ACTIVE'), 'slug-a\n');
  put(path.join(cwd, '.claude', 'work', 'slug-a', 'ledger.md'), LEDGER);
  const r = R.readLedger(cwd);
  assert.ok(r.ok);
  assert.equal(r.ok && r.value.slug, 'slug-a');
  put(path.join(cwd, '.claude', 'work', 'ACTIVE'), '../../..');
  assert.equal(R.readLedger(cwd).ok, false);
});

const sample = (ts, p5, p7) => JSON.stringify({ v: 1, ts, sid: 's', five_hour: { pct: p5, resets_at: ts + 100 }, seven_day: { pct: p7, resets_at: ts + 200 }, ctx_pct: 1 });
const SAMPLES = (home) => path.join(home, 'plugins', 'data', 'budget-guard-golden-team', 'samples');

test('readBudget picks the newest ts across files and is not stale within 10 minutes', (t) => {
  const home = tmp(t);
  const nowS = NOW / 1000;
  put(path.join(SAMPLES(home), 'a.jsonl'), sample(nowS - 300, 10, 20) + '\n');
  put(path.join(SAMPLES(home), 'b.jsonl'), sample(nowS - 100, 28, 43) + '\n' + sample(nowS - 200, 1, 1) + '\n');
  const r = R.readBudget(home, NOW);
  assert.ok(r.ok);
  const b = r.ok ? r.value : undefined;
  assert.equal(b.fiveHour.pct, 28);
  assert.equal(b.sevenDay.pct, 43);
  assert.equal(b.stale, false);
});

test('readBudget marks a sample older than 10 minutes as stale', (t) => {
  const home = tmp(t);
  put(path.join(SAMPLES(home), 'a.jsonl'), sample(NOW / 1000 - 601, 10, 20) + '\n');
  const r = R.readBudget(home, NOW);
  assert.equal(r.ok && r.value.stale, true);
});

test('readBudget returns missing when the samples dir is missing', (t) => {
  const r = /** @type {any} */ (R.readBudget(tmp(t), NOW));
  assert.equal(!r.ok && r.reason, 'missing');
});

// ── P1.T4 views ─────────────────────────────────────────────────────────
const ROW = (o = {}) => Object.assign({ sessionId: SID, pid: 1, cwd: '/w', name: 'main', status: 'working', owned: false, updatedAt: NOW - 5 * 60000 }, o);
/** @returns {any} */
const MODEL = (sessions, o = {}) => Object.assign({ sessions, agents: { ok: true, value: [] }, ledger: { ok: false, reason: 'missing', detail: '' }, budget: { ok: false, reason: 'missing', detail: '' } }, o);

test('SessionsProvider lists one item per session with name, status text, relative time', () => {
  const p = new SessionsProvider(() => MODEL([ROW(), ROW({ sessionId: 'b', name: 'other', status: 'needsInput' })]), () => ({ ok: true, value: [] }), () => NOW);
  const els = p.getChildren();
  assert.equal(els.length, 2);
  const it = p.getTreeItem(els[0]);
  assert.equal(it.label, 'main');
  assert.equal(it.description, 'Working · 5m ago');
});

test('SessionsProvider gives each of the six statuses a different icon', () => {
  const statuses = ['working', 'needsInput', 'needsPermission', 'waiting', 'ended', 'unknown'];
  const p = new SessionsProvider(() => MODEL(statuses.map((s, i) => ROW({ sessionId: `s${i}`, status: s }))), () => ({ ok: true, value: [] }), () => NOW);
  const icons = p.getChildren().map((e) => /** @type {any} */ (p.getTreeItem(e).iconPath).id);
  assert.equal(new Set(icons).size, 6);
});

test('SessionsProvider returns the agents of a session as its children', () => {
  const agent = /** @type {any} */ ({ agentId: 'a1', agentType: 'builder', description: 'Build', state: 'running', tokens: 5 });
  const p = new SessionsProvider(() => MODEL([ROW()]), () => ({ ok: true, value: [agent] }), () => NOW);
  const kids = p.getChildren(p.getChildren()[0]);
  assert.equal(kids.length, 1);
  assert.equal(p.getTreeItem(kids[0]).label, 'Build');
});

test('Poller skips a tick while one is in flight', async () => {
  let calls = 0, release;
  const p = new Poller(() => { calls++; return new Promise((r) => { release = r; }); }, () => true, 2000, { setInterval: () => 0, clearInterval() {} });
  const first = p.tick();
  await p.tick();
  assert.equal(calls, 1);
  /** @type {any} */ (release)();
  await first;
  await p.tick();
  assert.equal(calls, 2);
});

test('Poller does not tick when not visible', async () => {
  let calls = 0;
  const p = new Poller(async () => { calls++; }, () => false, 2000, { setInterval: () => 0, clearInterval() {} });
  await p.tick();
  assert.equal(calls, 0);
});

test('handleWebviewMessage ignores select with an unknown sessionId and accepts a known one', () => {
  const m = MODEL([ROW()]);
  assert.deepEqual(handleWebviewMessage({ type: 'select', sessionId: 'nope' }, m), { action: 'ignore' });
  assert.deepEqual(handleWebviewMessage({ type: 'select', sessionId: SID }, m), { action: 'select', sessionId: SID });
  assert.deepEqual(handleWebviewMessage({ type: 'bogus' }, m), { action: 'ignore' });
  assert.deepEqual(handleWebviewMessage(null, m), { action: 'ignore' });
});

test('handleWebviewMessage opens a report inside the session cwd and refuses one outside', (t) => {
  const base = tmp(t);
  const cwd = path.join(base, 'proj');
  put(path.join(cwd, 'r', 'a.md'), 'x');
  put(path.join(base, 'outside.md'), 'x');
  const m = MODEL([ROW({ cwd })]);
  const ok = handleWebviewMessage({ type: 'openReport', sessionId: SID, path: 'r/a.md' }, m);
  assert.equal(ok.action, 'open');
  assert.equal(ok.action === 'open' && fs.realpathSync(ok.file), fs.realpathSync(path.join(cwd, 'r', 'a.md')));
  assert.deepEqual(handleWebviewMessage({ type: 'openReport', sessionId: SID, path: '../outside.md' }, m), { action: 'ignore' });
  assert.deepEqual(handleWebviewMessage({ type: 'openReport', sessionId: SID, path: path.join(base, 'outside.md') }, m), { action: 'ignore' });
  assert.deepEqual(handleWebviewMessage({ type: 'openReport', sessionId: 'nope', path: 'r/a.md' }, m), { action: 'ignore' });
});

test('createStore builds a model that holds no transcript message text', (t) => {
  const home = tmp(t);
  const cwd = path.join(home, 'work');
  put(path.join(home, 'sessions', '100.json'), sessionFile({ cwd }));
  const secret = 'SECRET-PROMPT-TEXT';
  const tr = path.join(home, 'projects', 's', `${SID}.jsonl`);
  put(tr, [
    JSON.stringify({ type: 'user', gitBranch: 'feat/x', timestamp: '2026-10-29T11:00:00.000Z', message: { role: 'user', content: secret } }),
    JSON.stringify({ type: 'assistant', gitBranch: 'feat/x', timestamp: '2026-10-29T11:01:00.000Z', message: { id: 'm', content: [{ type: 'text', text: secret }], usage: { output_tokens: 1 } } }),
  ].join('\n') + '\n');
  put(path.join(home, 'projects', 's', SID, 'subagents', 'agent-a1.meta.json'), JSON.stringify(META));
  put(path.join(home, 'projects', 's', SID, 'subagents', 'agent-a1.jsonl'),
    JSON.stringify({ type: 'user', message: { role: 'user', content: secret } }) + '\n' + asst('m1', 3) + '\n');
  const store = createStore({ home, isAlive: alive, now: () => NOW });
  const model = store.refresh(SID);
  assert.equal(model.sessions[0].branch, 'feat/x');
  assert.equal(model.agents.ok && model.agents.value.length, 1);
  assert.ok(!JSON.stringify(model).includes(secret));
});
