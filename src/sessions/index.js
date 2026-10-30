// @ts-check
'use strict';
const os = require('node:os');
const crypto = require('node:crypto');
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
 *  @param {{home:string, isAlive:(pid:number)=>boolean, now:()=>number,
 *    isOwned?:(sessionId:string)=>boolean}} deps
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
        const owned = { ...row, owned: !!(deps.isOwned && deps.isOwned(row.sessionId)) };
        return file ? { ...owned, ...R.parseTail(R.readTail(file, TAIL_BYTES)) } : owned;
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

/** Shown when a control command gets a session that this window did not start. */
const GUARD_MESSAGE = 'RUOSTE did not start this session.';
/** Shown when a control command runs from the palette and this window owns no session. */
const NONE_MESSAGE = 'RUOSTE did not start a session.';

/** Terminals this window started, by sessionId, and the four control commands (P2).
 *  Only a terminal in this registry can be stopped, sent input or shown: an argument that claims
 *  `owned` is never trusted. Quick pick items carry `sessionId`; a picked item goes through the guard too.
 *  @param {() => R.ViewModel} getModel */
function createControl(getModel) {
  /** @type {Map<string, vscode.Terminal>} */
  const terminals = new Map();
  /** The terminal RUOSTE started for `sessionId`; otherwise show GUARD_MESSAGE and return undefined.
   *  @param {unknown} sessionId @returns {vscode.Terminal|undefined} */
  const ownedTerminal = (sessionId) => {
    const term = typeof sessionId === 'string' ? terminals.get(sessionId) : undefined;
    if (!term) void vscode.window.showWarningMessage(GUARD_MESSAGE);
    return term;
  };
  /** The owned terminal for a command argument; every entry path ends in `ownedTerminal`.
   *  @param {unknown} arg @returns {Promise<vscode.Terminal|undefined>} */
  const target = async (arg) => {
    if (arg === undefined) {
      if (!terminals.size) {
        void vscode.window.showWarningMessage(NONE_MESSAGE);
        return undefined;
      }
      const rows = getModel().sessions;
      const items = [...terminals.keys()].map((sessionId) => {
        const row = rows.find((r) => r.sessionId === sessionId);
        return { label: row ? row.name : sessionId, description: row ? row.cwd : '', sessionId };
      });
      const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select a Claude session' });
      return picked ? ownedTerminal(picked.sessionId) : undefined;
    }
    const el = /** @type {any} */ (arg);
    return ownedTerminal(typeof arg === 'string' ? arg : el && el.row ? el.row.sessionId : undefined);
  };
  /** Pick a workspace folder, open a terminal there and run `claude --session-id <uuid>`.
   *  @returns {Promise<void>} */
  const start = async () => {
    if (!(vscode.workspace.workspaceFolders || []).length) {
      void vscode.window.showInformationMessage('Open a folder to start a Claude session.');
      return;
    }
    const folder = await vscode.window.showWorkspaceFolderPick();
    if (!folder) return;
    const sessionId = crypto.randomUUID();
    const term = vscode.window.createTerminal({ name: 'Claude', cwd: folder.uri });
    terminals.set(sessionId, term);
    term.sendText(`claude --session-id ${sessionId}`);
    term.show();
  };
  /** Ask, then dispose the owned terminal.
   *  @param {unknown} [arg] tree element, sessionId string, or nothing (quick pick of owned sessions)
   *  @returns {Promise<void>} */
  const stop = async (arg) => {
    const term = await target(arg);
    if (!term) return;
    const ok = await vscode.window.showWarningMessage('Stop this Claude session?', { modal: true }, 'Stop');
    if (ok === 'Stop') term.dispose();
  };
  /** Ask for one line and send it to the owned terminal.
   *  @param {unknown} [arg] tree element, sessionId string, or nothing (quick pick of owned sessions)
   *  @returns {Promise<void>} */
  const sendInput = async (arg) => {
    const term = await target(arg);
    if (!term) return;
    const text = await vscode.window.showInputBox({ prompt: 'Type a line to send to Claude.' });
    if (text) term.sendText(text, true);
  };
  /** Show the owned terminal.
   *  @param {unknown} [arg] tree element, sessionId string, or nothing (quick pick of owned sessions)
   *  @returns {Promise<void>} */
  const showTerminal = async (arg) => {
    const term = await target(arg);
    if (term) term.show();
  };
  /** @param {vscode.Terminal} term */
  const forget = (term) => { for (const [id, t] of terminals) if (t === term) terminals.delete(id); };
  return { terminals, forget, ownedTerminal, start, stop, sendInput, showTerminal };
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
  /** @type {R.ViewModel} */ let model;
  const control = createControl(() => model);
  const store = createStore({
    home: (deps && deps.home) || path.join(os.homedir(), '.claude'),
    isAlive: (deps && deps.isAlive) || pidAlive,
    now: (deps && deps.now) || Date.now,
    isOwned: (id) => control.terminals.has(id),
  });
  /** @type {string|undefined} */ let selected;
  model = store.refresh(selected);
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
    vscode.window.onDidCloseTerminal((term) => control.forget(term)),
    vscode.commands.registerCommand('ruoste.sessions.refresh', () => {
      getModel(); provider.refresh(); panel.refreshChiefView();
    }),
    vscode.commands.registerCommand('ruoste.sessions.openChiefView', (arg) => {
      const id = arg && (arg.row ? arg.row.sessionId : arg.sessionId);
      panel.openChiefView(ctx, getModel, typeof id === 'string' ? id : undefined);
    }),
    vscode.commands.registerCommand('ruoste.sessions.start', () => control.start()),
    vscode.commands.registerCommand('ruoste.sessions.stop', (arg) => control.stop(arg)),
    vscode.commands.registerCommand('ruoste.sessions.sendInput', (arg) => control.sendInput(arg)),
    vscode.commands.registerCommand('ruoste.sessions.showTerminal', (arg) => control.showTerminal(arg)),
  );
  return { provider, poller };
}

module.exports = { activateSessions, Poller, SessionsProvider, createStore, createControl, GUARD_MESSAGE };
