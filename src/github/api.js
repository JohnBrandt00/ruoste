// @ts-check
'use strict';
/**
 * GitHub REST client built for watching many repositories at once.
 *
 * Two rules from GitHub's own guidance shape this:
 *   1. A conditional request that returns 304 does NOT count against the
 *      primary rate limit, so every GET carries an ETag.
 *   2. Requests should be serial, not concurrent, to avoid secondary limits —
 *      hence the queue.
 */
const vscode = require('vscode');

const SCOPES = ['repo'];

/** @param {boolean} createIfNone @returns {Promise<vscode.AuthenticationSession|undefined>} */
async function getSession(createIfNone) {
  try { return await vscode.authentication.getSession('github', SCOPES, { createIfNone }); }
  catch { return undefined; }
}

/** @param {string} host @returns {string} */
function apiBase(host) {
  return host === 'github.com' || host === 'www.github.com'
    ? 'https://api.github.com'
    : `https://${host}/api/v3`;
}

class GitHubError extends Error {
  /** @param {string} message @param {number} status @param {string} [kind] */
  constructor(message, status, kind = 'http') {
    super(message); this.name = 'GitHubError'; this.status = status; this.kind = kind;
  }
}

/** @param {number} status @param {string} detail @param {Headers} [h] @returns {GitHubError} */
function classify(status, detail, h) {
  if (status === 401) return new GitHubError('GitHub session expired — sign in again', 401, 'auth');
  if (status === 403) {
    if (h && h.get('x-ratelimit-remaining') === '0') {
      const reset = Number(h.get('x-ratelimit-reset')) * 1000;
      return new GitHubError(`Rate limit reached; resets ${new Date(reset).toLocaleTimeString()}`, 403, 'rate-limit');
    }
    if (/saml|sso/i.test(detail))
      return new GitHubError('This organisation requires SAML SSO authorisation for your token', 403, 'sso');
    return new GitHubError(detail || 'Forbidden', 403, 'forbidden');
  }
  if (status === 404) return new GitHubError(detail || 'Not found', 404, 'not-found');
  if (status === 429) return new GitHubError('Secondary rate limit — backing off', 429, 'rate-limit');
  return new GitHubError(detail || `GitHub returned ${status}`, status);
}

class GitHubClient {
  constructor() {
    /** @type {Map<string,{etag:string, body:any}>} cache keyed by full url */
    this._cache = new Map();
    /** @type {Promise<any>} tail of the serial queue */
    this._queue = Promise.resolve();
    this.remaining = NaN;
    this.limit = NaN;
    this.resetAt = 0;
    this.conditionalHits = 0;
    this.requests = 0;
  }

  /** Serialise every call — GitHub asks for serial, not concurrent, requests.
   * @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
  enqueue(fn) {
    const run = this._queue.then(fn, fn);
    // keep the chain alive regardless of individual failures
    this._queue = run.then(() => undefined, () => undefined);
    return run;
  }

  /** @param {string} host @param {string} path @param {string} token
   *  @param {{method?:string, signal?:AbortSignal, conditional?:boolean, body?:any}} [o]
   *  @returns {Promise<any>} */
  async request(host, path, token, o = {}) {
    if (this.remaining === 0 && Date.now() < this.resetAt)
      throw new GitHubError('Rate limited; waiting for the window to reset', 403, 'rate-limit');

    const url = `${apiBase(host)}${path}`;
    const conditional = o.conditional !== false && (o.method || 'GET') === 'GET';
    const cached = conditional ? this._cache.get(url) : undefined;

    /** @type {Record<string,string>} */
    const headers = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ruoste-vscode',
    };
    if (cached) headers['If-None-Match'] = cached.etag;

    if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, {
      method: o.method || 'GET', signal: o.signal, headers,
      body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
    });
    this.requests++;

    const rem = res.headers.get('x-ratelimit-remaining');
    if (rem !== null) {
      this.remaining = Number(rem);
      this.limit = Number(res.headers.get('x-ratelimit-limit')) || this.limit;
      this.resetAt = Number(res.headers.get('x-ratelimit-reset')) * 1000 || this.resetAt;
    }

    // 304: body unchanged, and this request was free
    if (res.status === 304 && cached) { this.conditionalHits++; return cached.body; }
    if (res.status === 204) return null;

    if (!res.ok) {
      let detail = '';
      try { const b = await res.json(); detail = b?.message || ''; } catch { /* ignore */ }
      throw classify(res.status, detail, res.headers);
    }

    const text = await res.text().catch(() => '');
    const type = res.headers.get('content-type') || '';
    /** @type {any} */ let body = null;
    if (text.trim()) {
      if (/\bjson\b/i.test(type)) { try { body = JSON.parse(text); } catch { body = text; } }
      else body = text;
    }
    const etag = res.headers.get('etag');
    if (conditional && etag) this._cache.set(url, { etag, body });
    return body;
  }

  /** @param {{host:string, owner:string, repo:string}} r @param {string} token
   *  @param {{branch?:string, limit?:number, signal?:AbortSignal}} [o] @returns {Promise<any[]>} */
  listRuns(r, token, o = {}) {
    const q = new URLSearchParams({ per_page: String(o.limit ?? 10) });
    if (o.branch) q.set('branch', o.branch);
    return this.enqueue(() =>
      this.request(r.host, `/repos/${r.owner}/${r.repo}/actions/runs?${q}`, token, { signal: o.signal })
    ).then((b) => (b && b.workflow_runs) || []);
  }

  /** @param {{host:string, owner:string, repo:string}} r @param {number} runId @param {string} token */
  listJobs(r, runId, token) {
    return this.enqueue(() =>
      this.request(r.host, `/repos/${r.owner}/${r.repo}/actions/runs/${runId}/jobs?per_page=100`, token)
    ).then((b) => (b && b.jobs) || []);
  }

  /** Repos the user can see, newest push first. Paginated.
   * @param {string} host @param {string} token @param {number} pages @returns {Promise<any[]>} */
  async affiliatedRepos(host, token, pages = 3) {
    /** @type {any[]} */ const out = [];
    for (let page = 1; page <= pages; page++) {
      const q = new URLSearchParams({
        per_page: '100', page: String(page), sort: 'pushed',
        affiliation: 'owner,collaborator,organization_member',
      });
      const batch = await this.enqueue(() => this.request(host, `/user/repos?${q}`, token));
      if (!Array.isArray(batch) || !batch.length) break;
      out.push(...batch);
      if (batch.length < 100) break;
    }
    return out;
  }

  /** @param {string} host @param {string} token @param {string} owner @param {string} repo */
  repo(host, token, owner, repo) {
    return this.enqueue(() => this.request(host, `/repos/${owner}/${repo}`, token));
  }

  /** @param {{host:string, owner:string, repo:string}} r @param {number} runId @param {string} token */
  rerun(r, runId, token) {
    return this.enqueue(() => this.request(r.host, `/repos/${r.owner}/${r.repo}/actions/runs/${runId}/rerun`,
      token, { method: 'POST', conditional: false }));
  }
  /** Workflows defined in a repo. @param {{host:string, owner:string, repo:string}} r @param {string} token */
  listWorkflows(r, token) {
    return this.enqueue(() =>
      this.request(r.host, `/repos/${r.owner}/${r.repo}/actions/workflows?per_page=100`, token)
    ).then((b) => (b && b.workflows) || []);
  }

  /** @param {{host:string, owner:string, repo:string}} r @param {string} token @param {number} [limit] */
  listBranches(r, token, limit = 100) {
    return this.enqueue(() =>
      this.request(r.host, `/repos/${r.owner}/${r.repo}/branches?per_page=${limit}`, token)
    ).then((b) => (Array.isArray(b) ? b : []));
  }

  /** Trigger a workflow_dispatch run.
   * @param {{host:string, owner:string, repo:string}} r @param {number|string} workflowId
   * @param {string} ref @param {Record<string,string>} inputs @param {string} token */
  dispatch(r, workflowId, ref, inputs, token) {
    return this.enqueue(() => this.request(
      r.host, `/repos/${r.owner}/${r.repo}/actions/workflows/${workflowId}/dispatches`, token,
      { method: 'POST', conditional: false, body: { ref, inputs } }));
  }

  /** @param {{host:string, owner:string, repo:string}} r @param {number} runId @param {string} token */
  rerunFailed(r, runId, token) {
    return this.enqueue(() => this.request(
      r.host, `/repos/${r.owner}/${r.repo}/actions/runs/${runId}/rerun-failed-jobs`, token,
      { method: 'POST', conditional: false }));
  }

  /** @param {{host:string, owner:string, repo:string}} r @param {number} runId @param {string} token */
  cancel(r, runId, token) {
    return this.enqueue(() => this.request(r.host, `/repos/${r.owner}/${r.repo}/actions/runs/${runId}/cancel`,
      token, { method: 'POST', conditional: false }));
  }

  /** @returns {string} human summary for the view title */
  budget() {
    if (!Number.isFinite(this.remaining)) return '';
    const free = this.requests ? Math.round((this.conditionalHits / this.requests) * 100) : 0;
    return `${this.remaining}/${this.limit || '?'} · ${free}% cached`;
  }
}

module.exports = { GitHubClient, GitHubError, getSession, apiBase, classify, SCOPES };
