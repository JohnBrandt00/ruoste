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

/** Which rate limit bucket a path draws on. Search is metered separately —
 *  30 requests a minute against core's 5000 an hour — so the two must not be
 *  tracked as one number, or a spent search budget would look like a spent
 *  core budget and stop the runs poller.
 * @param {string} path @returns {string} */
function bucketOf(path) {
  return path.startsWith('/search/') ? 'search' : 'core';
}

class GitHubClient {
  constructor() {
    /** @type {Map<string,{etag:string, body:any}>} cache keyed by full url */
    this._cache = new Map();
    /** @type {Map<string,{remaining:number, limit:number, resetAt:number}>} per bucket */
    this.buckets = new Map();
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
    const bucket = bucketOf(path);
    const spent = this.buckets.get(bucket);
    if (spent && spent.remaining === 0 && Date.now() < spent.resetAt)
      throw new GitHubError(
        bucket === 'search'
          ? `GitHub search is rate limited; resets ${new Date(spent.resetAt).toLocaleTimeString()}`
          : 'Rate limited; waiting for the window to reset', 403, 'rate-limit');

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
      // GitHub names the bucket it just metered; older responses and GHE may
      // not, in which case the path is the better guess than "core, always"
      const which = res.headers.get('x-ratelimit-resource') || bucket;
      const seen = {
        remaining: Number(rem),
        limit: Number(res.headers.get('x-ratelimit-limit')) || this.buckets.get(which)?.limit || NaN,
        resetAt: Number(res.headers.get('x-ratelimit-reset')) * 1000 || this.buckets.get(which)?.resetAt || 0,
      };
      this.buckets.set(which, seen);
      if (which === 'core') {
        this.remaining = seen.remaining;
        this.limit = seen.limit || this.limit;
        this.resetAt = seen.resetAt || this.resetAt;
      }
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

  // ── issues and pull requests ──────────────────────────────────────────
  /** The signed-in user. Cheap, cached by ETag, and the only way to tell
   *  "mine" from "someone else's" once search results are in hand.
   * @param {string} host @param {string} token @returns {Promise<any>} */
  me(host, token) { return this.enqueue(() => this.request(host, '/user', token)); }

  /** Issue search — one request answers a question spanning every repository,
   *  where listing issues repo by repo would take one request each. Search has
   *  its own limit (30/min), which a two-minute poll of five queries never
   *  approaches.
   * @param {string} host @param {string} token @param {string} q
   * @param {{limit?:number, signal?:AbortSignal}} [o] @returns {Promise<any[]>} */
  searchIssues(host, token, q, o = {}) {
    const p = new URLSearchParams({
      q, sort: 'updated', order: 'desc', per_page: String(o.limit ?? 25),
      advanced_search: 'true',
    });
    return this.enqueue(() => this.request(host, `/search/issues?${p}`, token, { signal: o.signal }))
      .then((b) => (b && b.items) || []);
  }

  /** Open issues AND pull requests for one repo — GitHub's issues endpoint
   *  returns both; a pull request is an issue carrying a `pull_request` key.
   * @param {{host:string, owner:string, repo:string}} r @param {string} token
   * @param {{state?:string, limit?:number, signal?:AbortSignal}} [o] @returns {Promise<any[]>} */
  listRepoIssues(r, token, o = {}) {
    const q = new URLSearchParams({
      state: o.state || 'open', sort: 'updated', direction: 'desc',
      per_page: String(o.limit ?? 25),
    });
    return this.enqueue(() =>
      this.request(r.host, `/repos/${r.owner}/${r.repo}/issues?${q}`, token, { signal: o.signal })
    ).then((b) => (Array.isArray(b) ? b : []));
  }

  /** @param {{host:string, owner:string, repo:string}} r @param {number} n @param {string} token */
  issue(r, n, token) {
    return this.enqueue(() => this.request(r.host, `/repos/${r.owner}/${r.repo}/issues/${n}`, token));
  }

  /** @param {{host:string, owner:string, repo:string}} r @param {number} n @param {string} token */
  pull(r, n, token) {
    return this.enqueue(() => this.request(r.host, `/repos/${r.owner}/${r.repo}/pulls/${n}`, token));
  }

  /** @param {{host:string, owner:string, repo:string}} r @param {number} n @param {string} token
   *  @param {number} [limit] */
  issueComments(r, n, token, limit = 50) {
    return this.enqueue(() => this.request(
      r.host, `/repos/${r.owner}/${r.repo}/issues/${n}/comments?per_page=${limit}`, token)
    ).then((b) => (Array.isArray(b) ? b : []));
  }

  /** @param {{host:string, owner:string, repo:string}} r @param {number} n @param {string} token */
  pullReviews(r, n, token) {
    return this.enqueue(() => this.request(
      r.host, `/repos/${r.owner}/${r.repo}/pulls/${n}/reviews?per_page=100`, token)
    ).then((b) => (Array.isArray(b) ? b : []));
  }

  /** @param {{host:string, owner:string, repo:string}} r @param {number} n @param {string} token
   *  @param {number} [limit] */
  pullFiles(r, n, token, limit = 100) {
    return this.enqueue(() => this.request(
      r.host, `/repos/${r.owner}/${r.repo}/pulls/${n}/files?per_page=${limit}`, token)
    ).then((b) => (Array.isArray(b) ? b : []));
  }

  /** Checks on a commit — the pipelines view's subject, seen from a PR.
   * @param {{host:string, owner:string, repo:string}} r @param {string} sha @param {string} token */
  checkRuns(r, sha, token) {
    return this.enqueue(() => this.request(
      r.host, `/repos/${r.owner}/${r.repo}/commits/${sha}/check-runs?per_page=100`, token)
    ).then((b) => (b && b.check_runs) || []);
  }

  /** @param {{host:string, owner:string, repo:string}} r @param {number} n @param {string} body
   *  @param {string} token */
  addComment(r, n, body, token) {
    return this.enqueue(() => this.request(
      r.host, `/repos/${r.owner}/${r.repo}/issues/${n}/comments`, token,
      { method: 'POST', conditional: false, body: { body } }));
  }

  /** Close, reopen, retitle, relabel, reassign — all one PATCH.
   * @param {{host:string, owner:string, repo:string}} r @param {number} n
   * @param {Record<string,any>} patch @param {string} token */
  patchIssue(r, n, patch, token) {
    return this.enqueue(() => this.request(
      r.host, `/repos/${r.owner}/${r.repo}/issues/${n}`, token,
      { method: 'PATCH', conditional: false, body: patch }));
  }

  /** @param {{host:string, owner:string, repo:string}} r
   *  @param {{title:string, body?:string, labels?:string[], assignees?:string[]}} fields
   *  @param {string} token */
  createIssue(r, fields, token) {
    return this.enqueue(() => this.request(
      r.host, `/repos/${r.owner}/${r.repo}/issues`, token,
      { method: 'POST', conditional: false, body: fields }));
  }

  /** @param {{host:string, owner:string, repo:string}} r @param {number} n
   *  @param {{merge_method?:string, commit_title?:string, sha?:string}} opts @param {string} token */
  mergePull(r, n, opts, token) {
    return this.enqueue(() => this.request(
      r.host, `/repos/${r.owner}/${r.repo}/pulls/${n}/merge`, token,
      { method: 'PUT', conditional: false, body: opts }));
  }

  /** @param {{host:string, owner:string, repo:string}} r @param {number} n @param {string} token */
  updateBranch(r, n, token) {
    return this.enqueue(() => this.request(
      r.host, `/repos/${r.owner}/${r.repo}/pulls/${n}/update-branch`, token,
      { method: 'PUT', conditional: false, body: {} }));
  }

  /** @param {{host:string, owner:string, repo:string}} r @param {number} n
   *  @param {string[]} reviewers @param {string} token */
  requestReviewers(r, n, reviewers, token) {
    return this.enqueue(() => this.request(
      r.host, `/repos/${r.owner}/${r.repo}/pulls/${n}/requested_reviewers`, token,
      { method: 'POST', conditional: false, body: { reviewers } }));
  }

  /** @param {{host:string, owner:string, repo:string}} r @param {string} token */
  labels(r, token) {
    return this.enqueue(() =>
      this.request(r.host, `/repos/${r.owner}/${r.repo}/labels?per_page=100`, token)
    ).then((b) => (Array.isArray(b) ? b : []));
  }

  /** The event timeline of an issue or pull request. This is where the link
   *  between the two lives: a pull request saying "closes #12" puts a
   *  `cross-referenced` event on issue 12 naming it, which is the only way the
   *  REST API exposes that relationship in the issue → pull request direction.
   * @param {{host:string, owner:string, repo:string}} r @param {number} n
   * @param {string} token @param {number} [limit] @returns {Promise<any[]>} */
  timeline(r, n, token, limit = 100) {
    return this.enqueue(() => this.request(
      r.host, `/repos/${r.owner}/${r.repo}/issues/${n}/timeline?per_page=${limit}`, token)
    ).then((b) => (Array.isArray(b) ? b : []));
  }

  /** One file at one ref, decoded. The contents endpoint answers with base64
   *  and refuses anything over a megabyte, which is the right refusal for a
   *  diff view: a file that size is not being read in a side-by-side.
   * @param {{host:string, owner:string, repo:string}} r @param {string} filePath
   * @param {string} ref @param {string} token @returns {Promise<string>} */
  async fileAt(r, filePath, ref, token) {
    const q = new URLSearchParams({ ref });
    const segments = String(filePath).split('/').map(encodeURIComponent).join('/');
    const body = await this.enqueue(() => this.request(
      r.host, `/repos/${r.owner}/${r.repo}/contents/${segments}?${q}`, token));
    if (!body || typeof body !== 'object' || body.type !== 'file')
      throw new GitHubError(`${filePath} is not a file at ${ref.slice(0, 7)}`, 404, 'not-found');
    if (body.encoding !== 'base64') return String(body.content ?? '');
    return Buffer.from(String(body.content || ''), 'base64').toString('utf8');
  }

  /** Users who can be assigned an issue in this repo.
   * @param {{host:string, owner:string, repo:string}} r @param {string} token */
  assignees(r, token) {
    return this.enqueue(() =>
      this.request(r.host, `/repos/${r.owner}/${r.repo}/assignees?per_page=100`, token)
    ).then((b) => (Array.isArray(b) ? b : []));
  }

  /** @returns {string} human summary for the view title */
  budget() {
    if (!Number.isFinite(this.remaining)) return '';
    const free = this.requests ? Math.round((this.conditionalHits / this.requests) * 100) : 0;
    return `${this.remaining}/${this.limit || '?'} · ${free}% cached`;
  }
}

module.exports = { GitHubClient, GitHubError, getSession, apiBase, classify, bucketOf, SCOPES };
