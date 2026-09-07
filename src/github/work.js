// @ts-check
'use strict';
/** Issues and pull requests — the work waiting on you, across every repository
 *  you can reach.
 *
 *  Four search queries answer that cross-repo question in four requests; asking
 *  each repository in turn would take one request per repository and still miss
 *  the ones you are not watching. The repos open in this window get a section
 *  of their own, listed directly, because "what is open here" is a different
 *  question from "what is waiting on me". */
const vscode = require('vscode');
const api = require('./api');
const { workspaceRepos, matches } = require('./repos');
const { WorkNotifier } = require('./worknotify');
const { closingRefs } = require('./links');
const { issuePresentation, relativeTime } = require('../util');

/** @param {string} id @param {string|undefined} color @returns {vscode.ThemeIcon} */
const icon = (id, color) => new vscode.ThemeIcon(id, color ? new vscode.ThemeColor(color) : undefined);

/** Search-backed sections, in the order GitHub's own "your work" list uses.
 *  `@me` is resolved by GitHub, so these need no login name of our own. */
const SEARCH_SECTIONS = [
  { id: 'review',    label: 'Review requested', icon: 'git-pull-request',
    q: 'is:open is:pr review-requested:@me archived:false' },
  { id: 'assigned',  label: 'Assigned to me',   icon: 'account',
    q: 'is:open assignee:@me archived:false' },
  { id: 'created',   label: 'Opened by me',     icon: 'edit',
    q: 'is:open author:@me archived:false' },
  { id: 'mentioned', label: 'Mentions',         icon: 'mention',
    q: 'is:open mentions:@me archived:false' },
];
const WORKSPACE = { id: 'workspace', label: 'This window', icon: 'root-folder' };
const ALL_SECTIONS = [...SEARCH_SECTIONS, WORKSPACE];

/** @typedef {{owner:string, repo:string, host:string, key:string, branch?:string, root?:string}} Repo */
/** @typedef {{kind:'section', id:string, label:string, icon:string}} SectionNode */
/** @typedef {{kind:'workrepo', repo:Repo, sectionId:string}} WorkRepoNode */
/** @typedef {{kind:'item', item:any, repo:Repo, sectionId:string}} ItemNode */
/** @typedef {{kind:'message', text:string, icon?:string}} MessageNode */
/** @typedef {SectionNode|WorkRepoNode|ItemNode|MessageNode} Node */

/** Search results name their repository by API url; a repo listing does not
 *  need to. @param {any} item @param {string} host @returns {Repo|null} */
function repoOfItem(item, host) {
  const m = /\/repos\/([^/]+)\/([^/?#]+)/.exec(String(item?.repository_url || ''));
  const full = String(item?.base?.repo?.full_name || item?.repository?.full_name || '');
  const [owner, repo] = m ? [m[1], m[2]] : full.split('/');
  if (!owner || !repo) return null;
  return { owner, repo, host, key: `${host}/${owner}/${repo}`.toLowerCase() };
}

/** @param {any} item @param {string} include 'both' | 'issues' | 'prs' @returns {boolean} */
function passesFilter(item, include) {
  const isPr = issuePresentation(item).kind === 'pr';
  if (include === 'issues') return !isPr;
  if (include === 'prs') return isPr;
  return true;
}

/** Whether a repository survives the watch and exclude lists. An empty watch
 *  list means "everything", the same reading the Actions view gives it.
 * @param {{owner:string, repo:string}} repo @param {string[]} include
 * @param {string[]} exclude @returns {boolean} */
function allowsRepo(repo, include, exclude) {
  if ((exclude || []).some((p) => matches(p, repo))) return false;
  const want = (include || []).filter((p) => String(p || '').trim());
  return !want.length || want.some((p) => matches(p, repo));
}

/** Push the filter into the query where GitHub can apply it, so a narrow watch
 *  list spends its 25 results on repositories you asked for rather than
 *  discarding most of them here. Only unambiguous patterns qualify: `owner/*`
 *  is an org OR a user account and GitHub has no qualifier meaning either, so
 *  those stay a client-side filter.
 * @param {string} q @param {string[]} include @param {number} [max]
 * @returns {string} */
function scopedQuery(q, include, max = 12) {
  const want = (include || []).map((p) => String(p || '').trim()).filter(Boolean);
  if (!want.length || want.length > max || want.some((p) => p.includes('*'))) return q;
  const repos = want.filter((p) => /^[\w.-]+\/[\w.-]+$/.test(p));
  if (repos.length !== want.length) return q;
  return `${q} ${repos.map((r) => `repo:${r}`).join(' ')}`;
}

/** @implements {vscode.TreeDataProvider<Node>} */
class WorkProvider {
  /** @param {vscode.ExtensionContext} ctx @param {InstanceType<typeof api.GitHubClient>} [client] */
  constructor(ctx, client) {
    this.ctx = ctx;
    // sharing the Actions client shares its ETag cache and its serial queue,
    // which is what keeps two pollers from tripping the secondary rate limit
    this.client = client || new api.GitHubClient();
    /** @type {vscode.EventEmitter<Node|undefined>} */
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
    /** @type {Map<string,{rows:{item:any, repo:Repo}[], at:number, error?:string}>} */
    this.sections = new Map();
    this.signedIn = false;
    this.loading = false;
    /** @type {string|undefined} */ this.error = undefined;
    /** @type {string} */ this.login = '';
    this.host = 'github.com';
    /** @type {Repo[]} */ this.workspace = [];
    this.notifier = new WorkNotifier();
    /** @type {((events:any[]) => void)|undefined} */ this.onTransitions = undefined;
    /** @type {((p:any)=>void)|undefined} */ this.onDidRefresh = undefined;
    /** @type {((repo:any, number:number)=>void)|undefined} fires after a write,
     *  so an open detail panel can reload the item it is showing */
    this.onDidMutate = undefined;
    /** @type {NodeJS.Timeout|undefined} */ this._timer = undefined;
    /** @type {AbortController|undefined} */ this._inflight = undefined;
  }

  get cfg() { return vscode.workspace.getConfiguration('ruoste.work'); }
  fire() { this._emitter.fire(undefined); }

  dispose() {
    if (this._timer) clearTimeout(this._timer);
    this._inflight?.abort();
    this._emitter.dispose();
  }

  /** Enabled sections, in the order the setting lists them.
   * @returns {{id:string, label:string, icon:string, q?:string}[]} */
  enabledSections() {
    const want = this.cfg.get('sections', ['review', 'assigned', 'created', 'workspace']) || [];
    const out = want.map((id) => ALL_SECTIONS.find((s) => s.id === String(id))).filter(Boolean);
    return /** @type {any[]} */ (out.length ? out : ALL_SECTIONS.slice(0, 4));
  }

  /** @returns {string[]} */ get watchList() { return this.cfg.get('repositories', []) || []; }
  /** @returns {string[]} */ get excludes() { return this.cfg.get('exclude', []) || []; }
  /** @param {{owner:string, repo:string}} repo @returns {boolean} */
  allowed(repo) { return allowsRepo(repo, this.watchList, this.excludes); }

  /** What the filter is doing, for the view description — a short list should
   *  never be a mystery. @returns {string} */
  filterLabel() {
    const want = this.watchList.filter((p) => String(p || '').trim());
    const hidden = this.excludes.filter((p) => String(p || '').trim());
    if (!want.length && !hidden.length) return '';
    if (want.length === 1) return `only ${want[0]}`;
    if (want.length) return `${want.length} filters`;
    return `${hidden.length} hidden`;
  }

  /** @param {string} id @returns {{item:any, repo:Repo}[]} */
  rows(id) { return this.sections.get(id)?.rows || []; }

  /** every row we hold, deduplicated by item id @returns {{item:any, repo:Repo}[]} */
  allRows() {
    /** @type {Map<number, {item:any, repo:Repo}>} */ const seen = new Map();
    for (const s of this.sections.values()) for (const r of s.rows) seen.set(r.item.id, r);
    return [...seen.values()];
  }
  get reviewCount() { return this.rows('review').length; }
  get assignedCount() { return this.rows('assigned').length; }

  /** @param {boolean} [interactive] @returns {Promise<void>} */
  async refresh(interactive = false) {
    this._inflight?.abort();
    const ctrl = new AbortController();
    this._inflight = ctrl;
    this.loading = true;
    this.error = undefined;
    this.fire();
    try {
      const session = await api.getSession(interactive);
      this.signedIn = !!session;
      if (!session) { this.sections.clear(); return; }
      const token = session.accessToken;

      this.workspace = /** @type {Repo[]} */ (workspaceRepos());
      // a GitHub Enterprise checkout in the window decides which host we ask
      this.host = this.workspace[0]?.host || 'github.com';
      if (!this.login) {
        try { this.login = (await this.client.me(this.host, token))?.login || ''; } catch { /* not fatal */ }
      }

      const limit = Math.max(1, Number(this.cfg.get('itemLimit', 25)));
      const include = String(this.cfg.get('include', 'both'));

      for (const section of this.enabledSections()) {
        if (ctrl.signal.aborted) return;
        try {
          /** @type {{item:any, repo:Repo}[]} */ let rows = [];
          if (section.id === 'workspace') {
            for (const repo of this.workspace) {
              if (!this.allowed(repo)) continue;
              const items = await this.client.listRepoIssues(repo, token, { limit, signal: ctrl.signal });
              for (const item of items) rows.push({ item, repo });
            }
          } else {
            const q = scopedQuery(/** @type {string} */ (section.q), this.watchList);
            const items = await this.client.searchIssues(this.host, token, q, { limit, signal: ctrl.signal });
            for (const item of items) {
              const repo = repoOfItem(item, this.host);
              if (repo && this.allowed(repo)) rows.push({ item, repo });
            }
          }
          rows = rows.filter(({ item }) => passesFilter(item, include));
          this.sections.set(section.id, { rows, at: Date.now() });
        } catch (err) {
          if (ctrl.signal.aborted) return;
          if (err?.kind === 'rate-limit') { this.error = err.message; break; }
          // one failing query must not blank the other three
          this.sections.set(section.id, {
            rows: this.sections.get(section.id)?.rows || [], at: Date.now(),
            error: err?.message || String(err),
          });
        }
      }

      const events = this.notifier.diff(
        this.enabledSections().map((s) => ({ id: s.id, label: s.label, rows: this.rows(s.id) })));
      if (events.length) this.onTransitions?.(events);
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

  /** Refresh unless the last one was recent. The view becoming visible and the
   *  git extension reporting a state change both fire far more often than
   *  GitHub needs to be asked — and search, unlike the runs endpoints, has a
   *  per-minute limit that a burst of those could reach.
   * @param {number} [ms] @returns {Promise<void>} */
  refreshIfStale(ms = 30_000) {
    const newest = Math.max(0, ...[...this.sections.values()].map((s) => s.at));
    if (newest && Date.now() - newest < ms) return Promise.resolve();
    return this.refresh(false);
  }

  schedule() {
    if (this._timer) clearTimeout(this._timer);
    if (!this.cfg.get('autoRefresh', true)) return;
    const secs = Math.max(30, Number(this.cfg.get('refreshInterval', 180)));
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

    if (node.kind === 'section') {
      const entry = this.sections.get(node.id);
      const n = entry?.rows.length ?? 0;
      // a long section starts collapsed; VS Code remembers what you do next
      const it = new vscode.TreeItem(node.label, n && n <= 12 ? S.Expanded : S.Collapsed);
      it.id = `work:${node.id}`;
      it.iconPath = icon(node.icon, n ? undefined : 'descriptionForeground');
      it.description = entry?.error ? entry.error : entry ? String(n) : '…';
      it.contextValue = 'ruoste.work.section';
      return it;
    }

    if (node.kind === 'workrepo') {
      const it = new vscode.TreeItem(`${node.repo.owner}/${node.repo.repo}`, S.Expanded);
      it.id = `work:${node.sectionId}:${node.repo.key}`;
      it.iconPath = icon('repo', 'descriptionForeground');
      it.description = String(this.rows(node.sectionId).filter((r) => r.repo.key === node.repo.key).length);
      it.contextValue = 'ruoste.work.repo';
      return it;
    }

    const { item, repo } = node;
    const p = issuePresentation(item);
    // search results carry the body, so a pull request's closing links cost
    // nothing to show here; the other direction needs a timeline, which is why
    // it waits for the detail panel
    const closes = p.kind === 'pr'
      ? closingRefs(`${item.title || ''}\n${item.body || ''}`, repo)
        .map((c) => (c.repo === repo.repo && c.owner === repo.owner
          ? `#${c.number}` : `${c.owner}/${c.repo}#${c.number}`))
      : [];
    const it = new vscode.TreeItem(String(item.title || 'untitled'), S.None);
    it.id = `work:${node.sectionId}:${item.id}`;
    it.iconPath = icon(p.icon, p.color);
    it.description = `#${item.number} · ${repo.repo} · ${relativeTime(item.updated_at || item.created_at)}`;
    it.contextValue = `ruoste.work.item.${p.kind}${p.open ? '' : '.closed'}`;
    it.tooltip = new vscode.MarkdownString([
      `**${item.title}**`, '',
      `\`${p.label}\` · ${repo.owner}/${repo.repo}#${item.number}`,
      item.user?.login ? `by \`${item.user.login}\`` : '',
      (item.labels || []).length ? (item.labels || []).map((l) => `\`${l.name || l}\``).join(' ') : '',
      (item.assignees || []).length
        ? `assigned: ${(item.assignees || []).map((a) => `\`${a.login}\``).join(' ')}` : '',
      closes.length ? `closes ${closes.map((c) => `\`${c}\``).join(' ')}` : '',
      Number(item.comments) ? `${item.comments} comment${item.comments === 1 ? '' : 's'}` : '',
      `opened ${relativeTime(item.created_at)} · updated ${relativeTime(item.updated_at)}`,
    ].filter(Boolean).join('  \n'));
    it.command = { command: 'ruoste.work.view', title: 'View', arguments: [node] };
    return it;
  }

  /** @param {Node} [node] @returns {Node[]} */
  getChildren(node) {
    if (!node) {
      if (!this.signedIn) return [];
      const sections = this.enabledSections()
        .filter((s) => s.id !== 'workspace' || this.workspace.some((r) => this.allowed(r)));
      if (!sections.length)
        return [{ kind: 'message', text: 'No sections enabled — see ruoste.work.sections', icon: 'settings-gear' }];
      /** @type {Node[]} */
      const out = sections.map((s) => ({ kind: 'section', id: s.id, label: s.label, icon: s.icon }));
      return this.error ? [{ kind: 'message', text: this.error, icon: 'warning' }, ...out] : out;
    }

    if (node.kind === 'section') {
      const entry = this.sections.get(node.id);
      if (!entry) return [{ kind: 'message', text: this.loading ? 'Loading…' : 'Not loaded yet',
                            icon: this.loading ? 'sync~spin' : 'circle-outline' }];
      if (entry.error && !entry.rows.length) return [{ kind: 'message', text: entry.error, icon: 'error' }];
      if (!entry.rows.length) return [{ kind: 'message', text: 'Nothing here', icon: 'check' }];

      // the workspace section is the only one spanning repos we already know by
      // name, so it is the only one worth grouping
      if (node.id === 'workspace') {
        /** @type {Map<string, Repo>} */ const repos = new Map();
        for (const r of entry.rows) repos.set(r.repo.key, r.repo);
        if (repos.size > 1)
          return [...repos.values()].map((repo) => ({ kind: 'workrepo', repo, sectionId: node.id }));
      }
      return entry.rows.map(({ item, repo }) => ({ kind: 'item', item, repo, sectionId: node.id }));
    }

    if (node.kind === 'workrepo')
      return this.rows(node.sectionId).filter((r) => r.repo.key === node.repo.key)
        .map(({ item, repo }) => ({ kind: 'item', item, repo, sectionId: node.sectionId }));

    return [];
  }

  /** A row we already hold, if we hold it — used to refresh in place after a
   *  mutation. @param {{owner:string, repo:string}} repo @param {number} number
   *  @returns {{item:any, repo:Repo}|undefined} */
  find(repo, number) {
    return this.allRows().find((r) =>
      r.repo.owner.toLowerCase() === String(repo.owner).toLowerCase() &&
      r.repo.repo.toLowerCase() === String(repo.repo).toLowerCase() &&
      Number(r.item.number) === Number(number));
  }
}

module.exports = {
  WorkProvider, repoOfItem, passesFilter, allowsRepo, scopedQuery,
  SEARCH_SECTIONS, ALL_SECTIONS,
};
