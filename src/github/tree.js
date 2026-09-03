// @ts-check
'use strict';
/** Owner → repo → run → job → step.
 *  Repos you have expanded, or that have something running, refresh every cycle;
 *  the rest rotate a few at a time. Every GET carries an ETag, so most of this
 *  costs nothing against the rate limit. */
const vscode = require('vscode');
const api = require('./api');
const { RepoSet } = require('./repos');
const { RunNotifier } = require('./notify');
const { formatDuration, relativeTime, statusPresentation, runElapsed, shortRef } = require('../util');

/** @param {string} id @param {string|undefined} color @returns {vscode.ThemeIcon} */
const icon = (id, color) => new vscode.ThemeIcon(id, color ? new vscode.ThemeColor(color) : undefined);

/** @typedef {{kind:'owner', owner:string, repos:any[]}} OwnerNode */
/** @typedef {{kind:'repo', repo:any}} RepoNode */
/** @typedef {{kind:'run', run:any, repo:any}} RunNode */
/** @typedef {{kind:'job', job:any, run:any, repo:any}} JobNode */
/** @typedef {{kind:'step', step:any}} StepNode */
/** @typedef {{kind:'message', text:string, icon?:string}} MessageNode */
/** @typedef {OwnerNode|RepoNode|RunNode|JobNode|StepNode|MessageNode} Node */

/** @implements {vscode.TreeDataProvider<Node>} */
class ActionsProvider {
  /** @param {vscode.ExtensionContext} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    this.client = new api.GitHubClient();
    this.repos = new RepoSet(this.client);
    /** @type {vscode.EventEmitter<Node|undefined>} */
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
    /** @type {Map<string,{runs:any[], at:number, error?:string}>} */ this.runsByRepo = new Map();
    /** @type {Map<number, any[]>} */ this.jobs = new Map();
    /** @type {Set<string>} repo keys the user has expanded */ this.expanded = new Set();
    this.signedIn = false;
    /** @type {string|undefined} */ this.error = undefined;
    this.loading = false;
    this._rotation = 0;
    this.notifier = new RunNotifier();
    /** @type {((events:any[]) => void)|undefined} */ this.onTransitions = undefined;
    /** @type {NodeJS.Timeout|undefined} */ this._timer = undefined;
    /** @type {AbortController|undefined} */ this._inflight = undefined;
    /** @type {((p:any)=>void)|undefined} */ this.onDidRefresh = undefined;
  }

  get cfg() { return vscode.workspace.getConfiguration('ruoste.actions'); }
  fire() { this._emitter.fire(undefined); }

  dispose() {
    if (this._timer) clearTimeout(this._timer);
    this._inflight?.abort();
    this._emitter.dispose();
  }

  /** every run we currently hold, newest first @returns {any[]} */
  allRuns() {
    const out = [];
    for (const [key, v] of this.runsByRepo)
      for (const r of v.runs) out.push({ run: r, key });
    return out.sort((a, b) =>
      String(b.run.run_started_at || b.run.created_at).localeCompare(String(a.run.run_started_at || a.run.created_at)));
  }

  get liveCount() {
    let n = 0;
    for (const v of this.runsByRepo.values()) n += v.runs.filter((r) => r.status !== 'completed').length;
    return n;
  }
  /** runs that are still queued or in progress, with their repo @returns {{run:any, repo:any}[]} */
  liveRuns() {
    /** @type {{run:any, repo:any}[]} */ const out = [];
    for (const r of this.repos.repos) {
      for (const run of this.runsByRepo.get(r.key)?.runs || [])
        if (run.status !== 'completed') out.push({ run, repo: r });
    }
    return out;
  }

  get failedCount() {
    let n = 0;
    for (const v of this.runsByRepo.values())
      if (v.runs[0] && v.runs[0].conclusion === 'failure') n++;
    return n;
  }

  /** Repos that deserve a fetch this cycle. @param {any[]} all @returns {any[]} */
  selectForFetch(all) {
    const hot = all.filter((r) =>
      this.expanded.has(r.key) ||
      r.source === 'workspace' ||
      (this.runsByRepo.get(r.key)?.runs || []).some((x) => x.status !== 'completed'));
    const hotKeys = new Set(hot.map((r) => r.key));
    const warm = all.filter((r) => !hotKeys.has(r.key) && !this.repos.barren.has(r.key));
    const perCycle = Math.max(1, Number(this.cfg.get('repositoriesPerCycle', 8)));
    /** @type {any[]} */ const slice = [];
    for (let i = 0; i < Math.min(perCycle, warm.length); i++)
      slice.push(warm[(this._rotation + i) % warm.length]);
    this._rotation = warm.length ? (this._rotation + slice.length) % warm.length : 0;
    return [...hot, ...slice];
  }

  /** @param {boolean} [interactive] @param {boolean} [rediscover] @returns {Promise<void>} */
  async refresh(interactive = false, rediscover = false) {
    this._inflight?.abort();
    const ctrl = new AbortController();
    this._inflight = ctrl;
    this.loading = true;
    this.error = undefined;
    this.fire();
    try {
      const session = await api.getSession(interactive);
      this.signedIn = !!session;
      if (!session) { this.runsByRepo.clear(); return; }

      const all = await this.repos.discover(session.accessToken, rediscover);
      if (ctrl.signal.aborted) return;
      if (!all.length) return;

      const limit = Math.max(1, Number(this.cfg.get('runCount', 10)));
      const branchOnly = this.cfg.get('currentBranchOnly', false);

      for (const r of this.selectForFetch(all)) {
        if (ctrl.signal.aborted) return;
        try {
          const runs = await this.client.listRuns(r, session.accessToken, {
            limit, branch: branchOnly ? r.branch : undefined, signal: ctrl.signal,
          });
          this.runsByRepo.set(r.key, { runs, at: Date.now() });
          if (!runs.length && r.source !== 'workspace') this.repos.barren.add(r.key);
          else this.repos.barren.delete(r.key);
        } catch (err) {
          if (ctrl.signal.aborted) return;
          if (err?.kind === 'rate-limit') { this.error = err.message; break; }
          // a single unreachable repo must not blank the whole tree
          this.runsByRepo.set(r.key, { runs: this.runsByRepo.get(r.key)?.runs || [], at: Date.now(),
            error: err?.message || String(err) });
          if (err?.status === 404) this.repos.barren.add(r.key);
        }
      }
      // steps of a running job change constantly — drop their cache so the
      // tree shows live progress rather than the state at first expansion
      for (const { run } of this.liveRuns()) this.jobs.delete(run.id);

      /** @type {{run:any, repo:any}[]} */ const seenNow = [];
      for (const r of all)
        for (const run of this.runsByRepo.get(r.key)?.runs || []) seenNow.push({ run, repo: r });
      const events = this.notifier.diff(seenNow);
      if (events.length) this.onTransitions?.(events);

      if (!this.error && this.repos.warning) this.error = this.repos.warning;
    } catch (err) {
      if (!ctrl.signal.aborted) this.error = err?.message || String(err);
    } finally {
      if (!ctrl.signal.aborted) {
        this.loading = false;
        this.fire();
        this.onDidRefresh?.(this);
        this.schedule();
      }
    }
  }

  schedule() {
    if (this._timer) clearTimeout(this._timer);
    if (!this.cfg.get('autoRefresh', true)) return;
    const idle = Math.max(15, Number(this.cfg.get('refreshInterval', 60)));
    const live = Math.max(5, Number(this.cfg.get('liveRefreshInterval', 10)));
    const secs = this.liveCount ? live : idle;
    this._timer = setTimeout(() => { void this.refresh(false); }, secs * 1000);
  }

  /** @param {Node} node @returns {vscode.TreeItem} */
  getTreeItem(node) {
    const S = vscode.TreeItemCollapsibleState;

    if (node.kind === 'message') {
      const it = new vscode.TreeItem(node.text, S.None);
      it.iconPath = icon(node.icon || 'info', 'descriptionForeground');
      return it;
    }

    if (node.kind === 'owner') {
      const live = node.repos.reduce((n, r) =>
        n + (this.runsByRepo.get(r.key)?.runs || []).filter((x) => x.status !== 'completed').length, 0);
      const bad = node.repos.filter((r) => (this.runsByRepo.get(r.key)?.runs || [])[0]?.conclusion === 'failure').length;
      const it = new vscode.TreeItem(node.owner, S.Expanded);
      it.id = `owner:${node.owner}`;
      it.iconPath = icon(live ? 'sync~spin' : bad ? 'error' : 'organization',
        live ? 'testing.iconQueued' : bad ? 'testing.iconFailed' : 'descriptionForeground');
      it.description = `${node.repos.length}${live ? ` · ${live} running` : ''}${bad ? ` · ${bad} failing` : ''}`;
      it.contextValue = 'ruoste.owner';
      return it;
    }

    if (node.kind === 'repo') {
      const r = node.repo;
      const entry = this.runsByRepo.get(r.key);
      const latest = entry?.runs?.[0];
      const p = latest ? statusPresentation(latest.status, latest.conclusion)
                       : { icon: entry?.error ? 'error' : 'circle-outline', color: 'descriptionForeground', label: '', live: false };
      const it = new vscode.TreeItem(r.repo, latest ? S.Collapsed : S.None);
      it.id = `repo:${r.key}`;
      it.iconPath = icon(p.icon, p.color);
      it.description = entry?.error ? entry.error
        : latest ? `${shortRef(latest.head_branch, 18)} · ${relativeTime(latest.run_started_at || latest.created_at)}`
        : entry ? 'no runs' : '…';
      it.contextValue = `ruoste.repo${r.source === 'workspace' ? '.workspace' : ''}`;
      it.tooltip = new vscode.MarkdownString(
        `**${r.owner}/${r.repo}**  \n\`${r.source}\`${r.branch ? `  \nbranch \`${r.branch}\`` : ''}` +
        `${latest ? `  \nlatest: ${latest.name} — \`${p.label}\`` : ''}`);
      return it;
    }

    if (node.kind === 'run') {
      const r = node.run;
      const p = statusPresentation(r.status, r.conclusion);
      const it = new vscode.TreeItem(String(r.name || r.display_title || 'workflow'), S.Collapsed);
      it.id = `run:${node.repo.key}:${r.id}`;
      it.iconPath = icon(p.icon, p.color);
      it.description = `${shortRef(r.head_branch, 16)} · ${relativeTime(r.run_started_at || r.created_at)}`;
      it.contextValue = r.status === 'completed' ? 'ruoste.run.done' : 'ruoste.run.live';
      it.tooltip = new vscode.MarkdownString([
        `**${r.display_title || r.name || 'run'}**`, '',
        `\`${p.label}\` · #${r.run_number}${r.run_attempt > 1 ? ` (attempt ${r.run_attempt})` : ''}`,
        `${node.repo.owner}/${node.repo.repo} · branch \`${r.head_branch || '?'}\``,
        r.actor?.login ? `by \`${r.actor.login}\`` : '',
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
      const ms = j.completed_at && j.started_at ? Date.parse(j.completed_at) - Date.parse(j.started_at)
        : j.started_at ? Date.now() - Date.parse(j.started_at) : NaN;
      it.description = Number.isFinite(ms) ? formatDuration(ms) : p.label;
      it.contextValue = 'ruoste.job';
      it.tooltip = `${j.name} — ${p.label}${j.runner_name ? ` on ${j.runner_name}` : ''}`;
      return it;
    }

    const s = node.step;
    const p = statusPresentation(s.status, s.conclusion);
    const it = new vscode.TreeItem(String(s.name || 'step'), S.None);
    it.iconPath = icon(p.icon, p.color);
    const ms = s.completed_at && s.started_at ? Date.parse(s.completed_at) - Date.parse(s.started_at) : NaN;
    if (Number.isFinite(ms)) it.description = formatDuration(ms);
    it.contextValue = 'ruoste.step';
    return it;
  }

  /** @param {Node} [node] @returns {Promise<Node[]>} */
  async getChildren(node) {
    if (!node) {
      if (!this.signedIn) return [];
      if (this.error && !this.repos.repos.length) return [{ kind: 'message', text: this.error, icon: 'error' }];
      const groups = this.repos.byOwner();
      if (!groups.length)
        return [{ kind: 'message', text: this.loading ? 'Discovering repositories…' : 'No repositories match your settings',
                  icon: this.loading ? 'sync~spin' : 'circle-outline' }];
      // one repo total reads better flattened
      if (groups.length === 1 && groups[0][1].length === 1)
        return this.getChildren({ kind: 'repo', repo: groups[0][1][0] });
      const out = groups.map(([owner, repos]) => /** @type {OwnerNode} */ ({ kind: 'owner', owner, repos }));
      return this.error ? [{ kind: 'message', text: this.error, icon: 'warning' }, ...out] : out;
    }

    if (node.kind === 'owner') return node.repos.map((repo) => ({ kind: 'repo', repo }));

    if (node.kind === 'repo') {
      const entry = this.runsByRepo.get(node.repo.key);
      if (!entry) { void this.fetchRepo(node.repo); return [{ kind: 'message', text: 'Loading…', icon: 'sync~spin' }]; }
      if (entry.error) return [{ kind: 'message', text: entry.error, icon: 'error' }];
      if (!entry.runs.length) return [{ kind: 'message', text: 'No workflow runs', icon: 'circle-outline' }];
      return entry.runs.map((run) => ({ kind: 'run', run, repo: node.repo }));
    }

    if (node.kind === 'run') {
      const cached = this.jobs.get(node.run.id);
      if (cached) return cached.map((job) => ({ kind: 'job', job, run: node.run, repo: node.repo }));
      const session = await api.getSession(false);
      if (!session) return [];
      try {
        const jobs = await this.client.listJobs(node.repo, node.run.id, session.accessToken);
        this.jobs.set(node.run.id, jobs);
        return jobs.map((job) => ({ kind: 'job', job, run: node.run, repo: node.repo }));
      } catch (err) {
        return [{ kind: 'message', text: err?.message || String(err), icon: 'error' }];
      }
    }

    if (node.kind === 'job') return (node.job.steps || []).map((step) => ({ kind: 'step', step }));
    return [];
  }

  /** Fetch one repo on demand (expanding a repo we have not reached yet).
   * @param {any} repo @returns {Promise<void>} */
  async fetchRepo(repo) {
    const session = await api.getSession(false);
    if (!session) return;
    try {
      const runs = await this.client.listRuns(repo, session.accessToken,
        { limit: Math.max(1, Number(this.cfg.get('runCount', 10))) });
      this.runsByRepo.set(repo.key, { runs, at: Date.now() });
    } catch (err) {
      this.runsByRepo.set(repo.key, { runs: [], at: Date.now(), error: err?.message || String(err) });
    }
    this.fire();
  }
}

module.exports = { ActionsProvider };
