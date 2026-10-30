// @ts-check
'use strict';
const os = require('node:os');
const path = require('node:path');
const vscode = require('vscode');
const { safeTreeView } = require('../diagnostics');
const { relativeTime } = require('../util');
const R = require('./read');
const panel = require('./panel');

const POLL_MS = 2000;
const TAIL_BYTES = 64 * 1024;

const STATUS_TEXT = {
  working: 'Working', needsInput: 'Needs input', needsPermission: 'Needs permission',
  waiting: 'Waiting', ended: 'Ended', unknown: 'Unknown',
};
const STATUS_ICON = {
  working: ['sync~spin', 'charts.blue'], needsInput: ['comment-discussion', 'charts.yellow'],
  needsPermission: ['shield', 'charts.red'], waiting: ['clock', 'charts.orange'],
  ended: ['circle-slash', undefined], unknown: ['question', undefined],
};

/** Runs `fn` on an interval while `isVisible()`; a tick is skipped while one is in flight. */
class Poller {
  /** @param {() => Promise<void>} fn @param {() => boolean} isVisible @param {number} intervalMs
   *  @param {{setInterval:Function, clearInterval:Function}} [timers] */
  constructor(fn, isVisible, intervalMs, timers) {
    this.fn = fn; this.isVisible = isVisible; this.intervalMs = intervalMs; this.timers = timers;
    this.running = false; this.handle = undefined;
  }
  async tick() {
    if (this.running || !this.isVisible()) return;
    this.running = true;
    try { await this.fn(); }
    catch (err) { console.error('[RUOSTE] sessions refresh failed', err); }
    finally { this.running = false; }
  }
  start() {
    this.stop();
    const t = this.timers || { setInterval: global.setInterval, clearInterval: global.clearInterval };
    this.handle = t.setInterval(() => { void this.tick(); }, this.intervalMs);
  }
  stop() {
    if (this.handle === undefined) return;
    (this.timers || { clearInterval: global.clearInterval }).clearInterval(this.handle);
    this.handle = undefined;
  }
}

/** Tree of sessions; children of a session are its agents. */
class SessionsProvider {
  /** @param {() => R.ViewModel} getModel
   *  @param {(sessionId:string) => R.ReadResult<R.AgentRow[]>} getAgents
   *  @param {() => number} [now] */
  constructor(getModel, getAgents, now) {
    this.getModel = getModel; this.getAgents = getAgents; this.now = now || Date.now;
    this._change = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._change.event;
  }
  refresh() { this._change.fire(undefined); }
  /** @param {any} el @returns {vscode.TreeItem} */
  getTreeItem(el) {
    if (el.kind === 'agent') {
      const a = /** @type {R.AgentRow} */ (el.row);
      const item = new vscode.TreeItem(a.description || a.agentType, vscode.TreeItemCollapsibleState.None);
      item.description = [a.agentType, a.status || a.state, `${a.tokens.toLocaleString('en-US')} tokens`].join(' · ');
      item.iconPath = new vscode.ThemeIcon(a.state === 'running' ? 'sync~spin' : 'check');
      item.contextValue = 'claudeAgent';
      return item;
    }
    const s = /** @type {R.SessionRow} */ (el.row);
    const item = new vscode.TreeItem(s.name, vscode.TreeItemCollapsibleState.Collapsed);
    let text = STATUS_TEXT[s.status] || STATUS_TEXT.unknown;
    if (s.status === 'waiting' && s.waitingFor) text += `: ${s.waitingFor}`;
    if (s.status === 'unknown' && s.rawStatus) text += ` (${s.rawStatus})`;
    const rel = s.updatedAt ? relativeTime(new Date(s.updatedAt), this.now()) : '';
    item.description = rel ? `${text} · ${rel}` : text;
    const [icon, color] = STATUS_ICON[s.status] || STATUS_ICON.unknown;
    item.iconPath = new vscode.ThemeIcon(icon, color ? new vscode.ThemeColor(color) : undefined);
    item.tooltip = [s.cwd, s.branch && `branch ${s.branch}`, s.version && `Claude Code ${s.version}`]
      .filter(Boolean).join('\n');
    item.contextValue = s.owned ? 'claudeSession.owned' : 'claudeSession.external';
    return item;
  }
  /** @param {any} [el] @returns {any[]} */
  getChildren(el) {
    if (!el) return this.getModel().sessions.map((row) => ({ kind: 'session', row }));
    if (el.kind !== 'session') return [];
    const r = this.getAgents(el.row.sessionId);
    return r.ok ? r.value.map((row) => ({ kind: 'agent', row, sessionId: el.row.sessionId })) : [];
  }
}

/** Build the view model from disk. Sessions come first; the rest is for the selected one.
 *  @param {{home:string, isAlive:(pid:number)=>boolean, now:()=>number}} deps
 *  @returns {{refresh:(selected?:string)=>R.ViewModel,
 *    getAgents:(sessionId:string)=>R.ReadResult<R.AgentRow[]>}} */
function createStore(deps) {
  /** @type {Map<number,R.SessionRow>} */ let previous = new Map();
  /** @type {Map<string,any>} */ const cursors = new Map();
  /** @type {string|undefined} */ let lastError;

  /** @param {string} sessionId @returns {R.ReadResult<R.AgentRow[]>} */
  const getAgents = (sessionId) => {
    const file = R.findTranscript(deps.home, sessionId);
    return file ? R.readRoster(file, cursors) : { ok: false, reason: 'missing', detail: 'No transcript found.' };
  };

  /** @param {string} [selected] @returns {R.ViewModel} */
  const refresh = (selected) => {
    const read = R.readSessions(deps.home, deps.isAlive, previous);
    let sessions = previous.size ? [...previous.values()] : [];
    /** @type {string|undefined} */ let error;
    if (read.ok) {
      sessions = read.value.map((row) => {
        const file = R.findTranscript(deps.home, row.sessionId);
        return file ? { ...row, ...R.parseTail(R.readTail(file, TAIL_BYTES)) } : row;
      });
      previous = new Map(sessions.map((s) => [s.pid, s]));
      lastError = undefined;
    } else {
      error = `Cannot read Claude sessions: ${/** @type {any} */ (read).detail}`;
      if (error !== lastError) console.error(`[RUOSTE] ${error}`);   // once per change
      lastError = error;
    }
    const sel = sessions.find((s) => s.sessionId === selected) || sessions[0];
    const missing = /** @type {const} */ ({ ok: false, reason: 'missing', detail: 'No session is selected.' });
    return {
      sessions, selected: sel && sel.sessionId, error,
      agents: sel ? getAgents(sel.sessionId) : missing,
      ledger: sel && sel.cwd ? R.readLedger(sel.cwd) : missing,
      budget: R.readBudget(deps.home, deps.now()),
    };
  };
  return { refresh, getAgents };
}

/** @param {number} pid @returns {boolean} */
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (e) { return !!e && /** @type {any} */ (e).code === 'EPERM'; }
}

/** @param {vscode.ExtensionContext} ctx
 *  @param {{home?:string, isAlive?:(pid:number)=>boolean, now?:()=>number}} [deps]
 *  @returns {{provider:SessionsProvider, poller:Poller}|undefined} */
function activateSessions(ctx, deps) {
  // read once: the setting text asks for a window reload after a change
  if (!vscode.workspace.getConfiguration('ruoste.sessions').get('enabled', false)) return undefined;
  const store = createStore({
    home: (deps && deps.home) || path.join(os.homedir(), '.claude'),
    isAlive: (deps && deps.isAlive) || pidAlive,
    now: (deps && deps.now) || Date.now,
  });
  /** @type {string|undefined} */ let selected;
  let model = store.refresh(selected);
  /** @param {string} [sel] @returns {R.ViewModel} */
  const getModel = (sel) => {
    if (sel) selected = sel;
    model = store.refresh(selected);
    selected = model.selected;
    return model;
  };
  const provider = new SessionsProvider(() => model, store.getAgents, deps && deps.now);
  const view = safeTreeView('ruoste.sessions', { treeDataProvider: provider });
  const poller = new Poller(async () => {
    getModel();
    provider.refresh();
    panel.refreshChiefView();
  }, () => !!(view && view.visible) || panel.isChiefViewVisible(), POLL_MS);
  poller.start();
  ctx.subscriptions.push(
    ...(view ? [view, view.onDidChangeVisibility((e) => { if (e.visible) void poller.tick(); })] : []),
    { dispose: () => poller.stop() },
    vscode.commands.registerCommand('ruoste.sessions.refresh', () => {
      getModel(); provider.refresh(); panel.refreshChiefView();
    }),
    vscode.commands.registerCommand('ruoste.sessions.openChiefView', (arg) => {
      const id = arg && (arg.row ? arg.row.sessionId : arg.sessionId);
      panel.openChiefView(ctx, getModel, typeof id === 'string' ? id : undefined);
    }),
  );
  return { provider, poller };
}

module.exports = { activateSessions, Poller, SessionsProvider, createStore };
