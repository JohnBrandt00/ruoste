// @ts-check
'use strict';
/** Which repositories the Actions view watches: every repo open in the window,
 *  everything you are affiliated with on GitHub, and an explicit watch list. */
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { parseRemote } = require('../util');

/** @typedef {{owner:string, repo:string, host:string, key:string,
 *             branch?:string, root?:string, source:string, pushedAt?:string}} Repo */

/** @param {string} owner @param {string} repo @param {string} host @returns {string} */
const keyOf = (owner, repo, host) => `${host}/${owner}/${repo}`.toLowerCase();

/** Match "owner/repo", "owner/*", "*\/repo" or "*" — case-insensitive.
 * @param {string} pattern @param {Repo|{owner:string,repo:string}} r @returns {boolean} */
function matches(pattern, r) {
  const p = String(pattern || '').trim().toLowerCase();
  if (!p) return false;
  if (p === '*' || p === '*/*') return true;
  const [po, pr] = p.includes('/') ? p.split('/', 2) : ['*', p];
  const o = r.owner.toLowerCase(), n = r.repo.toLowerCase();
  const hit = (pat, val) => pat === '*' || pat === val ||
    (pat.includes('*') && new RegExp('^' + pat.split('*').map(escapeRe).join('.*') + '$').test(val));
  return hit(po, o) && hit(pr, n);
}
/** @param {string} s @returns {string} */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The git extension's API, if it is loaded. @returns {any|null} */
function gitApi() {
  const ext = vscode.extensions.getExtension('vscode.git');
  if (!ext || !ext.isActive || typeof ext.exports?.getAPI !== 'function') return null;
  try { return ext.exports.getAPI(1); } catch { return null; }
}

/** @param {string} root @returns {string|null} */
function remoteFromGitConfig(root) {
  try {
    const cfg = fs.readFileSync(path.join(root, '.git', 'config'), 'utf8');
    const origin = /\[remote "origin"\][^[]*?url\s*=\s*(\S+)/s.exec(cfg);
    if (origin) return origin[1];
    const any = /url\s*=\s*(\S+)/.exec(cfg);
    return any ? any[1] : null;
  } catch { return null; }
}

/** EVERY repo open in the window, not just the first. @returns {Repo[]} */
function workspaceRepos() {
  /** @type {Map<string, Repo>} */ const out = new Map();
  const api = gitApi();
  for (const r of (api && api.repositories) || []) {
    const remotes = r.state?.remotes || [];
    const origin = remotes.find((x) => x.name === 'origin') || remotes[0];
    const parsed = origin && parseRemote(origin.fetchUrl || origin.pushUrl);
    if (!parsed) continue;
    const key = keyOf(parsed.owner, parsed.repo, parsed.host);
    out.set(key, { ...parsed, key, source: 'workspace',
      branch: r.state?.HEAD?.name, root: r.rootUri?.fsPath });
  }
  for (const f of vscode.workspace.workspaceFolders || []) {
    const url = remoteFromGitConfig(f.uri.fsPath);
    const parsed = url ? parseRemote(url) : null;
    if (!parsed) continue;
    const key = keyOf(parsed.owner, parsed.repo, parsed.host);
    if (!out.has(key)) out.set(key, { ...parsed, key, source: 'workspace', root: f.uri.fsPath });
  }
  return [...out.values()];
}

/** Fires when the git extension's repo list or any HEAD changes.
 * @param {() => void} onChange @returns {vscode.Disposable} */
function watchWorkspace(onChange) {
  /** @type {vscode.Disposable[]} */ const subs = [];
  const api = gitApi();
  if (api) {
    if (typeof api.onDidOpenRepository === 'function') subs.push(api.onDidOpenRepository(onChange));
    if (typeof api.onDidCloseRepository === 'function') subs.push(api.onDidCloseRepository(onChange));
    for (const r of api.repositories || [])
      if (typeof r.state?.onDidChange === 'function') subs.push(r.state.onDidChange(onChange));
  }
  subs.push(vscode.workspace.onDidChangeWorkspaceFolders(onChange));
  return new vscode.Disposable(() => subs.forEach((s) => s.dispose()));
}

class RepoSet {
  /** @param {InstanceType<typeof import('./api').GitHubClient>} client */
  constructor(client) {
    this.client = client;
    /** @type {Repo[]} */ this.repos = [];
    /** @type {Set<string>} repos we have proven have no workflow runs */
    this.barren = new Set();
    this.discoveredAt = 0;
    /** @type {string|undefined} */ this.warning = undefined;
  }

  get cfg() { return vscode.workspace.getConfiguration('ruoste.actions'); }

  /** @returns {string} */ get scope() { return String(this.cfg.get('scope', 'affiliated')); }
  /** @returns {string[]} */ get watchList() { return this.cfg.get('repositories', []) || []; }
  /** @returns {string[]} */ get excludes() { return this.cfg.get('exclude', []) || []; }
  /** @returns {number} */ get max() { return Math.max(1, Number(this.cfg.get('maxRepositories', 60))); }

  /** @param {Repo} r @returns {boolean} */
  allowed(r) {
    if (this.excludes.some((p) => matches(p, r))) return false;
    if (this.scope === 'watchlist') return this.watchList.some((p) => matches(p, r));
    return true;
  }

  /** Rebuild the repo list from every enabled source.
   * @param {string} token @param {boolean} [force] @returns {Promise<Repo[]>} */
  async discover(token, force = false) {
    const fresh = Date.now() - this.discoveredAt < 10 * 60_000;
    if (!force && fresh && this.repos.length) return this.repos;

    /** @type {Map<string, Repo>} */ const merged = new Map();
    this.warning = undefined;

    for (const r of workspaceRepos()) merged.set(r.key, r);

    const wantRemote = this.scope !== 'workspace';
    if (wantRemote && token) {
      const host = merged.size ? [...merged.values()][0].host : 'github.com';
      try {
        const pages = Math.min(5, Math.ceil(this.max / 100) + 1);
        for (const g of await this.client.affiliatedRepos(host, token, pages)) {
          if (!g || !g.owner) continue;
          const key = keyOf(g.owner.login, g.name, host);
          const entry = {
            owner: g.owner.login, repo: g.name, host, key,
            source: merged.has(key) ? 'workspace' : 'affiliated',
            branch: merged.get(key)?.branch || g.default_branch,
            root: merged.get(key)?.root,
            pushedAt: g.pushed_at,
          };
          merged.set(key, entry);
        }
      } catch (err) {
        this.warning = err?.kind === 'sso'
          ? 'Some organisations need SAML SSO authorisation for your GitHub token.'
          : `Could not list your repositories — ${err?.message || err}`;
      }
    }

    // explicit watch list entries that name a concrete repo
    for (const p of this.watchList) {
      const s = String(p).trim();
      if (!s || s.includes('*')) continue;
      const [owner, repo] = s.split('/');
      if (!owner || !repo) continue;
      const host = 'github.com';
      const key = keyOf(owner, repo, host);
      if (!merged.has(key)) merged.set(key, { owner, repo, host, key, source: 'watchlist' });
    }

    const rank = { workspace: 0, watchlist: 1, affiliated: 2 };
    this.repos = [...merged.values()]
      .filter((r) => this.allowed(r))
      .sort((a, b) =>
        (rank[a.source] ?? 3) - (rank[b.source] ?? 3) ||
        String(b.pushedAt || '').localeCompare(String(a.pushedAt || '')) ||
        a.key.localeCompare(b.key))
      .slice(0, this.max);

    this.discoveredAt = Date.now();
    return this.repos;
  }

  /** Group for display: owner -> repos, workspace repos first. A single group
   *  named '' means "do not group". @returns {[string, Repo[]][]} */
  byOwner() {
    if (!this.cfg.get('groupByOwner', true)) {
      const flat = this.repos.filter((r) =>
        !(this.cfg.get('hideWithoutWorkflows', true) && this.barren.has(r.key)));
      return flat.length ? [['', flat]] : [];
    }
    /** @type {Map<string, Repo[]>} */ const g = new Map();
    for (const r of this.repos) {
      if (this.cfg.get('hideWithoutWorkflows', true) && this.barren.has(r.key)) continue;
      if (!g.has(r.owner)) g.set(r.owner, []);
      g.get(r.owner).push(r);
    }
    return [...g.entries()].sort((a, b) => {
      const aw = a[1].some((r) => r.source === 'workspace');
      const bw = b[1].some((r) => r.source === 'workspace');
      return (bw ? 1 : 0) - (aw ? 1 : 0) || a[0].localeCompare(b[0]);
    });
  }
}

module.exports = { RepoSet, workspaceRepos, watchWorkspace, remoteFromGitConfig, matches, keyOf, gitApi };
