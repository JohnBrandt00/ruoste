// @ts-check
'use strict';
/** Read-only readers for what the Claude CLI writes under ~/.claude. We never
 *  write there, and never read the `<pid>.<hash>.key` files. Parsers never throw. */
const fs = require('node:fs');
const path = require('node:path');

/** @typedef {'working'|'needsInput'|'needsPermission'|'waiting'|'ended'|'unknown'} SessionStatus */
/** @typedef {{sessionId:string, pid:number, cwd:string, name:string, status:SessionStatus,
 *   waitingFor?:string, rawStatus?:string, updatedAt?:number, version?:string, entrypoint?:string,
 *   branch?:string, lastActivity?:string, owned:boolean}} SessionRow */
/** @typedef {{agentId:string, agentType:string, description:string, model?:string, effort?:string,
 *   spawnDepth?:number, state:'running'|'finished', status?:string, report?:string,
 *   tokens:number, lastActivity?:string}} AgentRow */
/** @typedef {{time?:string, step:string, agent?:string, status?:string, result?:string, report?:string,
 *   ruling?:{decision:string, why:string, cost:string}}} LedgerEntry */
/** @typedef {{slug:string, entries:LedgerEntry[], skipped:number}} Ledger */
/** @typedef {{pct:number, resetsAt:number}} BudgetWindow */
/** @typedef {{fiveHour?:BudgetWindow, sevenDay?:BudgetWindow, ts:number, stale:boolean}} Budget */
/** @template T @typedef {{ok:true, value:T}|{ok:false, reason:'missing'|'unreadable'|'malformed', detail:string}} ReadResult */
/** @typedef {{offset:number, rest:string}} Cursor */
/** @typedef {{sessions:SessionRow[], selected?:string, agents:ReadResult<AgentRow[]>,
 *   ledger:ReadResult<Ledger>, budget:ReadResult<Budget>, error?:string}} ViewModel */

const STALE_SECONDS = 600;
const SAMPLE_FILES = 5;

/** @param {unknown} e @returns {string} */
const msg = (e) => (e instanceof Error ? e.message : String(e));
/** @param {unknown} e @returns {boolean} */
const isMissing = (e) => !!e && /** @type {any} */ (e).code === 'ENOENT';
/** @param {unknown} v @returns {string|undefined} */
const str = (v) => (typeof v === 'string' && v ? v : undefined);

/** @param {unknown} raw @param {unknown} waitingFor @returns {SessionStatus} */
function mapStatus(raw, waitingFor) {
  if (raw === 'busy') return 'working';
  if (raw === 'idle') return 'needsInput';
  if (raw === 'waiting') return waitingFor === 'permission prompt' ? 'needsPermission' : 'waiting';
  return 'unknown';
}

/** @param {any} j @param {(pid:number)=>boolean} isAlive @returns {SessionRow|undefined} */
function toRow(j, isAlive) {
  if (!j || typeof j !== 'object' || !Number.isInteger(j.pid) || typeof j.sessionId !== 'string') return undefined;
  const status = isAlive(j.pid) ? mapStatus(j.status, j.waitingFor) : 'ended';
  return {
    sessionId: j.sessionId, pid: j.pid, cwd: str(j.cwd) || '', name: str(j.name) || j.sessionId.slice(0, 8),
    status, waitingFor: str(j.waitingFor), rawStatus: str(j.status),
    updatedAt: Number.isFinite(j.updatedAt) ? j.updatedAt : undefined,
    version: str(j.version), entrypoint: str(j.entrypoint), owned: false,
  };
}

/** @param {string} home @param {(pid:number)=>boolean} isAlive @param {Map<number,SessionRow>} [previous]
 *  @returns {ReadResult<SessionRow[]>} */
function readSessions(home, isAlive, previous) {
  const dir = path.join(home, 'sessions');
  let names;
  try { names = fs.readdirSync(dir); }
  catch (e) { return isMissing(e) ? { ok: true, value: [] } : { ok: false, reason: 'unreadable', detail: msg(e) }; }
  /** @type {SessionRow[]} */ const rows = [];
  for (const n of names) {
    const m = /^(\d+)\.json$/.exec(n);   // never the <pid>.<hash>.key files
    if (!m) continue;
    let row;
    try { row = toRow(JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')), isAlive); }
    catch { row = previous && previous.get(Number(m[1])); }   // half-written: keep last good
    if (row) rows.push(row);
  }
  return { ok: true, value: rows };
}

/** @type {Map<string,string>} */
const transcriptCache = new Map();

/** @param {string} home @param {string} sessionId @returns {string|undefined} */
function findTranscript(home, sessionId) {
  if (!/^[\w-]+$/.test(sessionId)) return undefined;
  const key = home + '|' + sessionId;
  const hit = transcriptCache.get(key);
  if (hit && fs.existsSync(hit)) return hit;
  transcriptCache.delete(key);
  const root = path.join(home, 'projects');
  let slugs;
  try { slugs = fs.readdirSync(root); } catch { return undefined; }
  for (const s of slugs) {
    const f = path.join(root, s, sessionId + '.jsonl');
    if (fs.existsSync(f)) { transcriptCache.set(key, f); return f; }
  }
  return undefined;
}

/** Last `bytes` of a file as lines; a first line cut by the window is dropped.
 *  @param {string} file @param {number} bytes @returns {string[]} */
function readTail(file, bytes) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString('utf8').split(/\r?\n/);
    if (start > 0) lines.shift();
    return lines.filter(Boolean);
  } catch { return []; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

/** @param {string[]} lines @returns {{branch?:string, lastActivity?:string}} */
function parseTail(lines) {
  /** @type {{branch?:string, lastActivity?:string}} */ const out = {};
  for (let i = lines.length - 1; i >= 0 && !(out.branch && out.lastActivity); i--) {
    let j;
    try { j = JSON.parse(lines[i]); } catch { continue; }
    if (!j || typeof j !== 'object') continue;
    out.branch = out.branch || str(j.gitBranch);
    out.lastActivity = out.lastActivity || str(j.timestamp);
  }
  return out;
}

/** @param {string} file @param {Cursor} [cursor]
 *  @returns {{lines:unknown[], cursor:Cursor, reset:boolean}} */
function readJsonl(file, cursor) {
  let cur = cursor || { offset: 0, rest: '' };
  let size;
  try { size = fs.statSync(file).size; } catch { return { lines: [], cursor: cur, reset: false }; }
  const reset = size < cur.offset;
  if (reset) cur = { offset: 0, rest: '' };
  if (size === cur.offset) return { lines: [], cursor: cur, reset };
  const fd = fs.openSync(file, 'r');
  let text;
  try {
    const buf = Buffer.alloc(size - cur.offset);
    fs.readSync(fd, buf, 0, buf.length, cur.offset);
    text = cur.rest + buf.toString('utf8');
  } finally { fs.closeSync(fd); }
  const parts = text.split('\n');
  const rest = parts.pop() || '';
  /** @type {unknown[]} */ const lines = [];
  for (const p of parts) {
    if (!p.trim()) continue;
    try { lines.push(JSON.parse(p)); } catch { /* bad line: skipped */ }
  }
  return { lines, cursor: { offset: size, rest }, reset };
}

/** @param {string} text @returns {{status?:string, report?:string}} */
function parseHandback(text) {
  /** @type {{status?:string, report?:string}} */ const out = {};
  const s = /^STATUS:\s*([A-Z_]+)/m.exec(text || '');
  const r = /^REPORT:\s*(.+?)\s*$/m.exec(text || '');
  if (s) out.status = s[1];
  if (r) out.report = r[1];
  return out;
}

/** Fold one transcript line into the agent accumulator. Keeps ids and counts only.
 *  @param {any} acc @param {any} line @returns {any} */
function foldAgent(acc, line) {
  acc = acc || { tokens: new Map(), model: undefined, lastActivity: undefined, handback: undefined };
  if (!line || typeof line !== 'object') return acc;
  if (typeof line.timestamp === 'string') acc.lastActivity = line.timestamp;
  const m = line.message;
  if (line.type !== 'assistant' || !m || typeof m !== 'object') return acc;
  if (typeof m.model === 'string') acc.model = m.model;
  const u = m.usage;
  if (u && typeof m.id === 'string') {
    const n = (/** @type {any} */ v) => (Number.isFinite(v) ? v : 0);
    // usage repeats on every content block of a message: last line per id wins
    acc.tokens.set(m.id, n(u.input_tokens) + n(u.cache_creation_input_tokens) + n(u.output_tokens));
  }
  if (Array.isArray(m.content))
    for (const c of m.content)
      if (c && c.type === 'tool_use' && c.name === 'SubagentHandback' && c.input && typeof c.input.message === 'string')
        acc.handback = c.input.message;
  return acc;
}

/** @param {string} transcriptPath @param {Map<string, any>} cursors @returns {ReadResult<AgentRow[]>} */
function readRoster(transcriptPath, cursors) {
  const dir = path.join(transcriptPath.replace(/\.jsonl$/, ''), 'subagents');
  let names;
  try { names = fs.readdirSync(dir); }
  catch (e) { return isMissing(e) ? { ok: true, value: [] } : { ok: false, reason: 'unreadable', detail: msg(e) }; }
  /** @type {AgentRow[]} */ const rows = [];
  for (const n of names) {
    const m = /^agent-(.+)\.meta\.json$/.exec(n);
    if (!m) continue;
    let meta;
    try { meta = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); } catch { continue; }
    if (!meta || typeof meta !== 'object') continue;
    const file = path.join(dir, 'agent-' + m[1] + '.jsonl');
    let st = cursors.get(file) || { cursor: undefined, acc: undefined };
    const r = readJsonl(file, st.cursor);
    if (r.reset) st = { cursor: undefined, acc: undefined };
    let acc = st.acc || foldAgent(undefined, undefined);
    for (const l of r.lines) acc = foldAgent(acc, l);
    cursors.set(file, { cursor: r.cursor, acc });
    const hb = acc.handback ? parseHandback(acc.handback) : {};
    let tokens = 0;
    for (const v of acc.tokens.values()) tokens += v;
    rows.push({
      agentId: m[1], agentType: str(meta.agentType) || 'agent', description: str(meta.description) || '',
      model: acc.model, effort: str(meta.effort),
      spawnDepth: Number.isFinite(meta.spawnDepth) ? meta.spawnDepth : undefined,
      state: meta.finished === true ? 'finished' : 'running',
      status: hb.status, report: hb.report, tokens, lastActivity: acc.lastActivity,
    });
  }
  return { ok: true, value: rows };
}

/** @param {string} text @returns {Ledger} */
function parseLedger(text) {
  /** @type {LedgerEntry[]} */ const entries = [];
  let skipped = 0;
  const dash = (/** @type {string|undefined} */ v) => (v && v !== '-' ? v : undefined);
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const t = /^(\d{1,2}:\d{2})\s*\|\s*(.*)$/.exec(line);
    const time = t ? t[1] : undefined;
    const rest = t ? t[2] : line;
    const rl = /^RULING:\s*(.*)$/.exec(rest);
    if (rl) {
      const [decision, why, cost] = rl[1].split(' — ').map((x) => x.trim());
      entries.push({ time, step: 'RULING', ruling: { decision: decision || '', why: why || '', cost: cost || '' } });
      continue;
    }
    const f = rest.split('|').map((x) => x.trim());
    if (!t || f.length < 5 || f.length > 6) { skipped++; continue; }
    entries.push({ time, step: f[0], agent: dash(f[1]), status: dash(f[2]), result: dash(f[3]), report: dash(f[4]) });
  }
  return { slug: '', entries, skipped };
}

/** @param {string} cwd @returns {ReadResult<Ledger>} */
function readLedger(cwd) {
  const work = path.join(cwd, '.claude', 'work');
  try {
    const slug = fs.readFileSync(path.join(work, 'ACTIVE'), 'utf8').trim();
    if (!/^[\w.-]+$/.test(slug) || slug === '.' || slug === '..')
      return { ok: false, reason: 'malformed', detail: 'ACTIVE holds an invalid name.' };
    const ledger = parseLedger(fs.readFileSync(path.join(work, slug, 'ledger.md'), 'utf8'));
    ledger.slug = slug;
    return { ok: true, value: ledger };
  } catch (e) {
    return isMissing(e) ? { ok: false, reason: 'missing', detail: 'No chief ledger in this folder.' }
      : { ok: false, reason: 'unreadable', detail: msg(e) };
  }
}

/** @param {string} home @param {number} now ms @returns {ReadResult<Budget>} */
function readBudget(home, now) {
  const dir = path.join(home, 'plugins', 'data', 'budget-guard-golden-team', 'samples');
  const none = { ok: false, reason: 'missing', detail: 'Budget data is not available.' };
  let names;
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl')); }
  catch (e) { return isMissing(e) ? /** @type {any} */ (none) : { ok: false, reason: 'unreadable', detail: msg(e) }; }
  const newest = names.map((n) => {
    const f = path.join(dir, n);
    try { return { f, m: fs.statSync(f).mtimeMs }; } catch { return { f, m: 0 }; }
  }).sort((a, b) => b.m - a.m).slice(0, SAMPLE_FILES);
  /** @type {any} */ let best;
  for (const { f } of newest)
    for (const line of readTail(f, 4096)) {
      let j; try { j = JSON.parse(line); } catch { continue; }
      if (j && Number.isFinite(j.ts) && (!best || j.ts > best.ts)) best = j;
    }
  if (!best) return /** @type {any} */ (none);
  const win = (/** @type {any} */ w) => (w && Number.isFinite(w.pct) ? { pct: w.pct, resetsAt: w.resets_at } : undefined);
  return { ok: true, value: { fiveHour: win(best.five_hour), sevenDay: win(best.seven_day),
    ts: best.ts, stale: now / 1000 - best.ts > STALE_SECONDS } };
}

module.exports = {
  mapStatus, readSessions, findTranscript, readTail, parseTail, readJsonl, foldAgent,
  readRoster, parseHandback, parseLedger, readLedger, readBudget,
};
