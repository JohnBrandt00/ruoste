// @ts-check
'use strict';
/** Read-only readers for what the Claude CLI writes under ~/.claude. We never
 *  write there, and never read the `<pid>.<hash>.key` files. Parsers never throw. */

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

const nope = () => { throw new Error('Not implemented'); };

/** @param {unknown} raw @param {unknown} waitingFor @returns {SessionStatus} */
function mapStatus(raw, waitingFor) { return nope(); }
/** @param {string} home @param {(pid:number)=>boolean} isAlive @param {Map<number,SessionRow>} [previous]
 *  @returns {ReadResult<SessionRow[]>} */
function readSessions(home, isAlive, previous) { return nope(); }
/** @param {string} home @param {string} sessionId @returns {string|undefined} */
function findTranscript(home, sessionId) { return nope(); }
/** @param {string} file @param {number} bytes @returns {string[]} */
function readTail(file, bytes) { return nope(); }
/** @param {string[]} lines @returns {{branch?:string, lastActivity?:string}} */
function parseTail(lines) { return nope(); }
/** @param {string} file @param {Cursor} [cursor]
 *  @returns {{lines:unknown[], cursor:Cursor, reset:boolean}} */
function readJsonl(file, cursor) { return nope(); }
/** @param {any} acc @param {any} line @returns {any} */
function foldAgent(acc, line) { return nope(); }
/** @param {string} transcriptPath @param {Map<string, any>} cursors @returns {ReadResult<AgentRow[]>} */
function readRoster(transcriptPath, cursors) { return nope(); }
/** @param {string} text @returns {{status?:string, report?:string}} */
function parseHandback(text) { return nope(); }
/** @param {string} text @returns {Ledger} */
function parseLedger(text) { return nope(); }
/** @param {string} cwd @returns {ReadResult<Ledger>} */
function readLedger(cwd) { return nope(); }
/** @param {string} home @param {number} now ms @returns {ReadResult<Budget>} */
function readBudget(home, now) { return nope(); }

module.exports = {
  mapStatus, readSessions, findTranscript, readTail, parseTail, readJsonl, foldAgent,
  readRoster, parseHandback, parseLedger, readLedger, readBudget,
};
