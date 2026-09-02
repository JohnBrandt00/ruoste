// @ts-check
'use strict';
const vscode = require('vscode');
const api = require('./api');
const { detectRepository } = require('./repo');
const { formatDuration, relativeTime, statusPresentation, runElapsed, shortRef } = require('../util');

/** @typedef {{kind:'run', run:any}} RunNode */
/** @typedef {{kind:'job', job:any, run:any}} JobNode */
/** @typedef {{kind:'step', step:any, job:any}} StepNode */
/** @typedef {{kind:'message', text:string, icon?:string, command?:vscode.Command}} MessageNode */
/** @typedef {RunNode|JobNode|StepNode|MessageNode} Node */

/** @param {string} id @param {string|undefined} color @returns {vscode.ThemeIcon} */
const icon = (id, color) =>
  new vscode.ThemeIcon(id, color ? new vscode.ThemeColor(color) : undefined);

/** @implements {vscode.TreeDataProvider<Node>} */
class ActionsProvider {
  /** @param {vscode.ExtensionContext} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    /** @type {vscode.EventEmitter<Node|undefined>} */
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
    /** @type {any[]} */ this.runs = [];
    /** @type {Map<number, any[]>} */ this.jobs = new Map();
    /** @type {ReturnType<typeof detectRepository>} */ this.repo = null;
    /** @type {string|undefined} */ this.error = undefined;
    this.signedIn = false;
    this.loading = false;
    /** @type {AbortController|undefined} */ this._inflight = undefined;
    /** @type {NodeJS.Timeout|undefined} */ this._timer = undefined;
    /** @type {((live:boolean) => void)|undefined} */ this.onDidRefresh = undefined;
  }

  /** @returns {vscode.WorkspaceConfiguration} */
  get cfg() { return vscode.workspace.getConfiguration('ruoste.actions'); }

  /** True while any visible run is queued or running. @returns {boolean} */
  get hasLiveRun() {
    return this.runs.some((r) => r.status !== 'completed');
  }

  dispose() {
    if (this._timer) clearTimeout(this._timer);
    this._inflight?.abort();
    this._emitter.dispose();
  }

  fire() { this._emitter.fire(undefined); }

  /** @param {boolean} [interactive] sign in if we have no session @returns {Promise<void>} */
  async refresh(interactive = false) {
    this._inflight?.abort();
    const ctrl = new AbortController();
    this._inflight = ctrl;
    this.loading = true;
    this.error = undefined;
    this.fire();

    try {
      this.repo = detectRepository();
      if (!this.repo) { this.runs = []; return; }

      const session = await api.getSession(interactive);
      this.signedIn = !!session;
      if (!session) { this.runs = []; return; }

      const branchOnly = this.cfg.get('currentBranchOnly', false);
      this.runs = await api.listRuns(this.repo, session.accessToken, {
        branch: branchOnly ? this.repo.branch : undefined,
        limit: /** @type {number} */ (this.cfg.get('runCount', 20)),
        signal: ctrl.signal,
      });
      this.jobs.clear();
    } catch (err) {
      if (ctrl.signal.aborted) return;                 // superseded by a newer refresh
      this.error = err && err.message ? err.message : String(err);
      this.runs = [];
    } finally {
      if (!ctrl.signal.aborted) {
        this.loading = false;
        this.fire();
        this.onDidRefresh?.(this.hasLiveRun);
        this.schedule();
      }
    }
  }

  /** Poll faster while something is running, slower when idle. */
  schedule() {
    if (this._timer) clearTimeout(this._timer);
    if (!this.cfg.get('autoRefresh', true)) return;
    const idle = Math.max(15, Number(this.cfg.get('refreshInterval', 60)));
    const live = Math.max(5, Number(this.cfg.get('liveRefreshInterval', 10)));
    const secs = this.hasLiveRun ? live : idle;
    this._timer = setTimeout(() => { void this.refresh(false); }, secs * 1000);
  }

  /** @param {Node} node @returns {vscode.TreeItem} */
  getTreeItem(node) {
    const S = vscode.TreeItemCollapsibleState;

    if (node.kind === 'message') {
      const it = new vscode.TreeItem(node.text, S.None);
      it.iconPath = icon(node.icon || 'info', 'descriptionForeground');
      if (node.command) it.command = node.command;
      return it;
    }

    if (node.kind === 'run') {
      const r = node.run;
      const p = statusPresentation(r.status, r.conclusion);
      const it = new vscode.TreeItem(String(r.name || r.display_title || 'workflow'), S.Collapsed);
      it.id = `run:${r.id}`;
      it.iconPath = icon(p.icon, p.color);
      it.description = `${shortRef(r.head_branch)} · ${relativeTime(r.run_started_at || r.created_at)}`;
      it.contextValue = r.status === 'completed' ? 'ruoste.run.done' : 'ruoste.run.live';
      it.tooltip = new vscode.MarkdownString(
        [`**${r.display_title || r.name || 'run'}**`, '',
         `\`${p.label}\`  ·  #${r.run_number}${r.run_attempt > 1 ? ` (attempt ${r.run_attempt})` : ''}`,
         `branch \`${r.head_branch || '?'}\``,
         r.actor && r.actor.login ? `by \`${r.actor.login}\`` : '',
         `took ${formatDuration(runElapsed(r))}`,
         r.event ? `triggered by \`${r.event}\`` : '',
        ].filter(Boolean).join('  \n'));
      return it;
    }

    if (node.kind === 'job') {
      const j = node.job;
      const p = statusPresentation(j.status, j.conclusion);
      const steps = Array.isArray(j.steps) && j.steps.length;
      const it = new vscode.TreeItem(String(j.name || 'job'), steps ? S.Collapsed : S.None);
      it.id = `job:${j.id}`;
      it.iconPath = icon(p.icon, p.color);
      const ms = j.completed_at && j.started_at
        ? Date.parse(j.completed_at) - Date.parse(j.started_at)
        : (j.started_at ? Date.now() - Date.parse(j.started_at) : NaN);
      it.description = Number.isFinite(ms) ? formatDuration(ms) : p.label;
      it.contextValue = 'ruoste.job';
      it.tooltip = `${j.name} — ${p.label}${j.runner_name ? ` on ${j.runner_name}` : ''}`;
      return it;
    }

    // step
    const s = node.step;
    const p = statusPresentation(s.status, s.conclusion);
    const it = new vscode.TreeItem(String(s.name || 'step'), S.None);
    it.iconPath = icon(p.icon, p.color);
    const ms = s.completed_at && s.started_at
      ? Date.parse(s.completed_at) - Date.parse(s.started_at) : NaN;
    if (Number.isFinite(ms)) it.description = formatDuration(ms);
    it.contextValue = 'ruoste.step';
    return it;
  }

  /** @param {Node} [node] @returns {Promise<Node[]>} */
  async getChildren(node) {
    if (!node) {
      if (this.error) return [{ kind: 'message', text: this.error, icon: 'error' }];
      if (this.loading && !this.runs.length) return [{ kind: 'message', text: 'Loading…', icon: 'sync~spin' }];
      if (!this.repo) return [];                 // viewsWelcome covers this
      if (!this.signedIn) return [];             // viewsWelcome covers this
      if (!this.runs.length) return [{ kind: 'message', text: 'No workflow runs yet', icon: 'circle-outline' }];
      return this.runs.map((run) => ({ kind: 'run', run }));
    }

    if (node.kind === 'run') {
      const cached = this.jobs.get(node.run.id);
      if (cached) return cached.map((job) => ({ kind: 'job', job, run: node.run }));
      const session = await api.getSession(false);
      if (!session || !this.repo) return [];
      try {
        const jobs = await api.listJobs(this.repo, node.run.id, session.accessToken);
        this.jobs.set(node.run.id, jobs);
        return jobs.map((job) => ({ kind: 'job', job, run: node.run }));
      } catch (err) {
        return [{ kind: 'message', text: err && err.message ? err.message : String(err), icon: 'error' }];
      }
    }

    if (node.kind === 'job')
      return (node.job.steps || []).map((step) => ({ kind: 'step', step, job: node.job }));

    return [];
  }
}

module.exports = { ActionsProvider };
