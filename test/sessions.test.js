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

test('activateSessions registers 6 commands and 1 view when the flag is on', async (t) => {
  await vscode.workspace.getConfiguration('ruoste.sessions').update('enabled', true);
  t.after(() => vscode.workspace.getConfiguration('ruoste.sessions').update('enabled', false));
  const c = countRegistrations();
  let r;
  try { r = activateSessions(/** @type {any} */ ({ subscriptions: [], extensionUri: vscode.Uri.file('/x') }), { home: tmp(t), isAlive: alive, now: () => NOW }); }
  finally { c.restore(); }
  assert.ok(r);
  r.poller.stop();
  assert.equal(c.seen.commands, 6);   // refresh, openChiefView + P2 start, stop, sendInput, showTerminal
  assert.equal(c.seen.views, 1);
});

test('with the flag off no sessions menu entry is shown, view/title included', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const ungated = [];
  for (const [where, grp] of Object.entries(pkg.contributes.menus)) {
    if (where === 'view/item/context') continue;   // no items exist while the flag is off
    for (const m of grp)
      if (String(m.command).startsWith('ruoste.sessions.') && !/config\.ruoste\.sessions\.enabled/.test(m.when || ''))
        ungated.push(`${where}:${m.command}`);
  }
  assert.deepEqual(ungated, []);
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
  void p.tick();   // the third tick stays in flight on purpose: do not await it
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
  const rep = '.claude/work/s/reports/a.md';
  put(path.join(cwd, rep), 'x');
  put(path.join(base, 'outside.md'), 'x');
  const m = MODEL([ROW({ cwd })]);
  const ok = handleWebviewMessage({ type: 'openReport', sessionId: SID, path: rep }, m);
  assert.equal(ok.action, 'open');
  assert.equal(ok.action === 'open' && fs.realpathSync(ok.file), fs.realpathSync(path.join(cwd, rep)));
  assert.deepEqual(handleWebviewMessage({ type: 'openReport', sessionId: SID, path: '../outside.md' }, m), { action: 'ignore' });
  assert.deepEqual(handleWebviewMessage({ type: 'openReport', sessionId: SID, path: path.join(base, 'outside.md') }, m), { action: 'ignore' });
  assert.deepEqual(handleWebviewMessage({ type: 'openReport', sessionId: 'nope', path: rep }, m), { action: 'ignore' });
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

test('openReport never opens a <pid>.<hash>.key file, even when the session cwd is the home folder', (t) => {
  const home = tmp(t);
  const key = path.join(home, '.claude', 'sessions', '100.abc123.key');
  fs.mkdirSync(path.dirname(key), { recursive: true });
  fs.writeFileSync(key, 'secret');
  const ok = path.join(home, '.claude', 'work', 's', 'reports', 'r.md');   // control: a normal report in the same cwd opens
  fs.mkdirSync(path.dirname(ok), { recursive: true });
  fs.writeFileSync(ok, '# r');
  const model = /** @type {any} */ ({ sessions: [{ sessionId: SID, pid: 100, cwd: home, name: 'x', status: 'working', owned: false }] });
  assert.equal(handleWebviewMessage({ type: 'openReport', sessionId: SID, path: '.claude/work/s/reports/r.md' }, model).action, 'open');
  const r = handleWebviewMessage({ type: 'openReport', sessionId: SID, path: '.claude/sessions/100.abc123.key' }, model);
  assert.equal(r.action, 'ignore');
});

test('openReport opens only a .md inside <cwd>/.claude/work (allowlist), with the cwd at the home folder', (t) => {
  const home = tmp(t);
  const outside = tmp(t);
  put(path.join(home, '.claude', '.credentials.json'), 'secret');
  put(path.join(home, '.claude', 'projects', 'p', 's.jsonl'), '{}');
  put(path.join(home, '.claude', 'sessions', '100.abc123.key'), 'secret');
  put(path.join(home, '.claude', 'work', 's', 'reports', 'x.md'), '# x');
  put(path.join(home, '.claude', 'work', 's', 'notes.txt'), 'x');
  put(path.join(outside, 'leak.md'), 'leak');
  fs.symlinkSync(path.join(outside, 'leak.md'), path.join(home, '.claude', 'work', 'link.md'), 'file');
  fs.symlinkSync(outside, path.join(home, '.claude', 'work', 'jct'), 'junction');
  fs.symlinkSync(path.join(home, '.claude', 'projects', 'p', 's.jsonl'), path.join(home, '.claude', 'work', 'in.md'), 'file');   // .md name, target inside cwd but outside work
  const model = /** @type {any} */ ({ sessions: [{ sessionId: SID, pid: 100, cwd: home, name: 'x', status: 'working', owned: false }] });
  const act = (p) => handleWebviewMessage({ type: 'openReport', sessionId: SID, path: p }, model).action;
  assert.equal(act('.claude/work/s/reports/x.md'), 'open');
  assert.deepEqual({
    cred: act('.claude/.credentials.json'),
    transcript: act('.claude/projects/p/s.jsonl'),
    key: act('.claude/sessions/100.abc123.key'),
    txt: act('.claude/work/s/notes.txt'),
    fileLink: act('.claude/work/link.md'),
    junction: act('.claude/work/jct/leak.md'),
    inCwdLink: act('.claude/work/in.md'),
  }, { cred: 'ignore', transcript: 'ignore', key: 'ignore', txt: 'ignore', fileLink: 'ignore', junction: 'ignore', inCwdLink: 'ignore' });
});

// ── P2 process control ──────────────────────────────────────────────────
const GUARD_MSG = 'RUOSTE did not start this session.';
const EXT_SID = '99999999-8888-4777-8666-555555555555';   // a session RUOSTE did not start
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A fake vscode.Terminal that records what the extension does to it. @param {any} opts */
function fakeTerminal(opts) {
  return {
    name: opts && opts.name, creationOptions: opts || {}, processId: Promise.resolve(4242),
    /** @type {any[][]} */ sent: [], shown: 0, disposed: 0,
    /** @param {string} text @param {boolean} [addNewLine] */
    sendText(text, addNewLine) { this.sent.push([text, addNewLine]); },
    show() { this.shown++; }, hide() {}, dispose() { this.disposed++; },
  };
}

/** Flag on, fake window/terminal/commands API, activate; everything is restored when the test ends.
 *  `policy` drives the user's answers: folder pick, confirm button, input text, quick pick choice.
 *  @param {any} t @param {{folders?: string[]}} [o] */
function controlEnv(t, o = {}) {
  const home = tmp(t);
  const W = /** @type {any} */ (vscode.window), C = /** @type {any} */ (vscode.commands), WS = /** @type {any} */ (vscode.workspace);
  const saved = { window: { ...W }, commands: { ...C }, folders: WS.workspaceFolders };
  /** @type {Map<string, Function>} */ const commands = new Map();
  /** @type {ReturnType<typeof fakeTerminal>[]} */ const terminals = [];
  const closed = new vscode.EventEmitter();
  const calls = { info: /** @type {string[]} */ ([]), warn: /** @type {string[]} */ ([]),
    picks: /** @type {any[][]} */ ([]), folderPicks: 0, inputs: 0 };
  const folders = (o.folders || [path.join(home, 'a'), path.join(home, 'b')])
    .map((p, index) => ({ uri: vscode.Uri.file(p), name: path.basename(p), index }));
  /** @type {{folder:any, confirm:boolean, input:string|undefined, pick:(items:any[])=>any}} */
  const policy = { folder: undefined, confirm: true, input: 'hello', pick: () => undefined };
  Object.assign(W, {
    createTerminal: (opts) => { const term = fakeTerminal(opts); terminals.push(term); return term; },
    onDidCloseTerminal: closed.event,
    showWorkspaceFolderPick: async () => { calls.folderPicks++; return policy.folder; },
    showInformationMessage: async (msg) => { calls.info.push(msg); return undefined; },
    showWarningMessage: async (msg, ...items) => {
      calls.warn.push(msg);
      return policy.confirm ? items.find((i) => typeof i === 'string') : undefined;   // the confirm button, if any
    },
    showInputBox: async () => { calls.inputs++; return policy.input; },
    showQuickPick: async (items) => { const list = await items; calls.picks.push(list); return policy.pick(list); },
    createTreeView: () => ({ dispose() {}, visible: false, onDidChangeVisibility: () => ({ dispose() {} }) }),
  });
  WS.workspaceFolders = folders;
  C.registerCommand = (id, fn) => { commands.set(id, fn); return { dispose() {} }; };
  C.executeCommand = async (id, ...args) => {
    const fn = commands.get(id);
    assert.ok(fn, `${id} is registered`);
    return fn(...args);
  };
  void vscode.workspace.getConfiguration('ruoste.sessions').update('enabled', true);
  /** @type {any} */ let r;
  t.after(() => {
    if (r) r.poller.stop();
    Object.assign(W, saved.window); Object.assign(C, saved.commands); WS.workspaceFolders = saved.folders;
    void vscode.workspace.getConfiguration('ruoste.sessions').update('enabled', false);
  });
  r = activateSessions(/** @type {any} */ ({ subscriptions: [], extensionUri: vscode.Uri.file('/x') }),
    { home, isAlive: alive, now: () => NOW });
  assert.ok(r, 'activateSessions returns the provider when the flag is on');
  /** @param {string} id @param {...any} args */
  const run = (id, ...args) => {
    const fn = commands.get(id);
    assert.ok(fn, `${id} is registered`);
    return fn(...args);
  };
  /** the tree element for a session, as the view passes it to an item command @param {string} sid */
  const element = (sid) => r.provider.getChildren().find((e) => e.row.sessionId === sid);
  /** @param {string} sid */
  const contextValue = (sid) => { const el = element(sid); return el && r.provider.getTreeItem(el).contextValue; };
  /** write a live session file for `sid` @param {number} pid @param {string} sid */
  const writeSession = (pid, sid) => put(path.join(home, 'sessions', `${pid}.json`), sessionFile({ pid, sessionId: sid, cwd: home }));
  return { home, commands, terminals, closed, calls, folders, policy, run, element, contextValue, writeSession, provider: r.provider };
}

/** Start a session through the command, in the second folder. @param {ReturnType<typeof controlEnv>} env */
async function startOwned(env) {
  env.policy.folder = env.folders[1];
  await env.run('ruoste.sessions.start');
  const term = env.terminals[env.terminals.length - 1];
  assert.ok(term, 'start opened a terminal');
  const m = /^claude --session-id (\S+)$/.exec(String(term.sent[0] && term.sent[0][0]));
  assert.ok(m, `start sent "claude --session-id <uuid>", got ${JSON.stringify(term.sent)}`);
  return { term, sid: m[1] };
}

/** One owned session (pid 200) and one external session (pid 100, EXT_SID), both listed. @param {any} t */
async function ownedAndExternal(t) {
  const env = controlEnv(t);
  const { term, sid } = await startOwned(env);
  env.writeSession(200, sid);
  env.writeSession(100, EXT_SID);
  await env.run('ruoste.sessions.refresh');
  return { env, term, sid };
}

const readPkg = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// P2.T1 start
test('start opens a terminal in the picked folder and runs claude with a new v4 session id', async (t) => {
  const env = controlEnv(t);
  env.policy.folder = env.folders[1];
  await env.run('ruoste.sessions.start');
  assert.equal(env.terminals.length, 1);
  const cwd = env.terminals[0].creationOptions.cwd;
  assert.equal(typeof cwd === 'string' ? cwd : cwd && cwd.fsPath, env.folders[1].uri.fsPath);
  assert.equal(env.terminals[0].sent.length, 1);
  const [text, addNewLine] = env.terminals[0].sent[0];
  const m = /^claude --session-id (\S+)$/.exec(text);
  assert.ok(m, `sent ${JSON.stringify(text)}`);
  assert.match(m[1], UUID_V4);
  assert.notEqual(addNewLine, false, 'the command runs (new line is sent)');
});

test('start gives each new session a different id', async (t) => {
  const env = controlEnv(t);
  const a = await startOwned(env);
  const b = await startOwned(env);
  assert.notEqual(a.sid, b.sid);
});

test('start shows an information message and opens no terminal when no folder is open', async (t) => {
  const env = controlEnv(t, { folders: [] });
  await env.run('ruoste.sessions.start');
  assert.equal(env.calls.info.length, 1);
  assert.equal(env.terminals.length, 0);
});

test('start opens nothing when the folder pick is cancelled', async (t) => {
  const env = controlEnv(t);
  env.policy.folder = undefined;
  await env.run('ruoste.sessions.start');
  assert.equal(env.calls.folderPicks, 1);
  assert.equal(env.terminals.length, 0);
  assert.deepEqual(env.calls.info, []);
});

test('a session that start opened is listed as owned and the others as external', async (t) => {
  const { env, sid } = await ownedAndExternal(t);
  assert.deepEqual({ owned: env.contextValue(sid), external: env.contextValue(EXT_SID) },
    { owned: 'claudeSession.owned', external: 'claudeSession.external' });
});

test('onDidCloseTerminal removes the session from the registry and its row turns external', async (t) => {
  const { env, term, sid } = await ownedAndExternal(t);
  env.closed.fire(term);
  await env.run('ruoste.sessions.refresh');
  assert.equal(env.contextValue(sid), 'claudeSession.external');
});

test('package.json shows Start in the sessions view title, gated on the flag', () => {
  const title = readPkg().contributes.menus['view/title'].filter((m) => m.command === 'ruoste.sessions.start');
  assert.equal(title.length, 1);
  assert.match(title[0].when, /view == ruoste\.sessions/);
  assert.match(title[0].when, /config\.ruoste\.sessions\.enabled/);
});

// P2.T2 ownership guard + stop
// The four entry paths of a control command (plan §Invocation paths):
//   inline         tree inline action: the tree element
//   context        tree context menu: the tree element (+ the selection, as VS Code passes it)
//   palette        Command Palette, no argument: a quick pick of owned sessions; the picked item's
//                  sessionId goes through the guard (a forged item stands in for a session not offered)
//   executeCommand an arbitrary argument: the sessionId string
const PATHS = ['inline', 'context', 'palette', 'executeCommand'];
/** What each command does to the owned terminal; a rise in this number means it acted. */
const EFFECT = {
  'ruoste.sessions.stop': (/** @type {any} */ term) => term.disposed,
  'ruoste.sessions.sendInput': (/** @type {any} */ term) => term.sent.filter(([s]) => s === 'hello').length,
  'ruoste.sessions.showTerminal': (/** @type {any} */ term) => term.shown,
};

/** Invoke `cmd` for `sid` along one entry path.
 *  @param {any} env @param {string} cmd @param {string} via @param {string} sid */
function invoke(env, cmd, via, sid) {
  const el = env.element(sid);
  assert.ok(el, `session ${sid} is listed`);
  if (via === 'inline') return env.run(cmd, el);
  if (via === 'context') return env.run(cmd, el, [el]);
  if (via === 'palette') {
    env.policy.pick = (items) => items.find((i) => i.sessionId === sid) || { label: 'forged', sessionId: sid };
    return env.run(cmd);
  }
  return vscode.commands.executeCommand(cmd, sid);
}

/** @param {any} env @param {string} cmd @param {any} term @param {() => any} act */
async function outcome(env, cmd, term, act) {
  const guarded = () => env.calls.warn.filter((m) => m === GUARD_MSG).length;
  const before = EFFECT[cmd](term), warned = guarded();
  await act();
  return { acted: EFFECT[cmd](term) > before, warned: guarded() > warned };
}

/** The guard matrix for one command: every path x {owned, external}, plus the equivalence test.
 *  @param {string} cmd */
function guardMatrix(cmd) {
  const expected = { owned: { acted: true, warned: false }, external: { acted: false, warned: true } };
  for (const via of PATHS) {
    for (const who of /** @type {const} */ (['owned', 'external'])) {
      test(`${cmd} on the ${via} path ${who === 'owned' ? 'acts on an owned session' : 'refuses an external session with a warning'}`, async (t) => {
        const { env, term, sid } = await ownedAndExternal(t);
        const got = await outcome(env, cmd, term, () => invoke(env, cmd, via, who === 'owned' ? sid : EXT_SID));
        assert.deepEqual(got, expected[who]);
      });
    }
  }
  test(`${cmd} reaches the same decision on all four paths for the same session (equivalence)`, async (t) => {
    /** @type {Record<string, Record<string, any>>} */ const seen = { owned: {}, external: {} };
    for (const via of PATHS) {
      for (const who of /** @type {const} */ (['owned', 'external'])) {
        const { env, term, sid } = await ownedAndExternal(t);
        seen[who][via] = await outcome(env, cmd, term, () => invoke(env, cmd, via, who === 'owned' ? sid : EXT_SID));
      }
    }
    const same = (o) => Object.fromEntries(PATHS.map((p) => [p, o]));
    for (const who of ['owned', 'external']) assert.deepEqual(seen[who], same(seen[who].inline), `${who}: all paths agree`);
    assert.notDeepEqual(seen.owned.inline, seen.external.inline, 'owned and external are told apart');
  });
  test(`${cmd} without an argument offers only the sessions RUOSTE started`, async (t) => {
    const { env, sid } = await ownedAndExternal(t);
    await env.run(cmd);
    assert.equal(env.calls.picks.length, 1);
    assert.deepEqual(env.calls.picks[0].map((i) => i.sessionId), [sid]);
  });
  test(`${cmd} refuses an argument that claims owned for a session RUOSTE did not start`, async (t) => {
    const { env, term } = await ownedAndExternal(t);
    const forged = { kind: 'session', row: { ...env.element(EXT_SID).row, owned: true } };
    const got = await outcome(env, cmd, term, () => vscode.commands.executeCommand(cmd, forged));
    assert.deepEqual(got, { acted: false, warned: true });
  });
  test(`${cmd} refuses an unknown session id with a warning`, async (t) => {
    const { env, term } = await ownedAndExternal(t);
    const got = await outcome(env, cmd, term, () => vscode.commands.executeCommand(cmd, '00000000-0000-4000-8000-000000000000'));
    assert.deepEqual(got, { acted: false, warned: true });
  });
  test(`${cmd} refuses a session whose terminal has closed`, async (t) => {
    const { env, term, sid } = await ownedAndExternal(t);
    env.closed.fire(term);
    const got = await outcome(env, cmd, term, () => vscode.commands.executeCommand(cmd, sid));
    assert.deepEqual(got, { acted: false, warned: true });
  });
  test(`package.json shows ${cmd} on owned session items only, inline and in the context menu`, () => {
    const items = readPkg().contributes.menus['view/item/context'].filter((m) => m.command === cmd);
    assert.ok(items.some((m) => /^inline/.test(m.group || '')), 'inline entry (path a)');
    assert.ok(items.some((m) => !/^inline/.test(m.group || '')), 'context menu entry (path b)');
    for (const m of items) {
      assert.match(m.when, /view == ruoste\.sessions/);
      assert.match(m.when, /viewItem == claudeSession\.owned\b/);
    }
  });
}

test('stop disposes an owned terminal after the user confirms', async (t) => {
  const { env, term, sid } = await ownedAndExternal(t);
  env.policy.confirm = true;
  await env.run('ruoste.sessions.stop', env.element(sid));
  assert.equal(term.disposed, 1);
  assert.equal(env.calls.warn.length, 1, 'the user was asked to confirm');
});

test('stop does not dispose the terminal when the user cancels', async (t) => {
  const { env, term, sid } = await ownedAndExternal(t);
  env.policy.confirm = false;
  await env.run('ruoste.sessions.stop', env.element(sid));
  assert.equal(term.disposed, 0);
});

test('stop asks nothing for a session RUOSTE did not start', async (t) => {
  const { env } = await ownedAndExternal(t);
  await env.run('ruoste.sessions.stop', env.element(EXT_SID));
  assert.deepEqual(env.calls.warn, [GUARD_MSG]);
});

guardMatrix('ruoste.sessions.stop');
