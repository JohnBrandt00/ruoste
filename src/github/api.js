// @ts-check
'use strict';
const vscode = require('vscode');

const SCOPES = ['repo'];

/** @param {boolean} createIfNone @returns {Promise<vscode.AuthenticationSession|undefined>} */
async function getSession(createIfNone) {
  try {
    return await vscode.authentication.getSession('github', SCOPES, { createIfNone });
  } catch {
    return undefined;                       // user dismissed the sign-in prompt
  }
}

/** api.github.com for github.com, /api/v3 for GitHub Enterprise.
 * @param {string} host @returns {string} */
function apiBase(host) {
  return host === 'github.com' || host === 'www.github.com'
    ? 'https://api.github.com'
    : `https://${host}/api/v3`;
}

class GitHubError extends Error {
  /** @param {string} message @param {number} status */
  constructor(message, status) { super(message); this.name = 'GitHubError'; this.status = status; }
}

/** @param {string} host @param {string} pathname @param {string} token
 *  @param {{method?:string, signal?:AbortSignal}} [opts] @returns {Promise<any>} */
async function request(host, pathname, token, opts = {}) {
  const res = await fetch(`${apiBase(host)}${pathname}`, {
    method: opts.method || 'GET',
    signal: opts.signal,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ruoste-vscode',
    },
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    let detail = '';
    try { const b = await res.json(); detail = b && b.message ? ` — ${b.message}` : ''; } catch { /* ignore */ }
    if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
      const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
      throw new GitHubError(`GitHub rate limit reached; resets ${new Date(reset).toLocaleTimeString()}`, 403);
    }
    throw new GitHubError(`GitHub ${res.status}${detail}`, res.status);
  }
  return res.json();
}

/** @param {{host:string, owner:string, repo:string}} r @param {string} token
 *  @param {{branch?:string, limit?:number, signal?:AbortSignal}} [o] @returns {Promise<any[]>} */
async function listRuns(r, token, o = {}) {
  const q = new URLSearchParams({ per_page: String(o.limit ?? 20) });
  if (o.branch) q.set('branch', o.branch);
  const body = await request(r.host, `/repos/${r.owner}/${r.repo}/actions/runs?${q}`, token, { signal: o.signal });
  return (body && body.workflow_runs) || [];
}

/** @param {{host:string, owner:string, repo:string}} r @param {number} runId @param {string} token
 *  @param {{signal?:AbortSignal}} [o] @returns {Promise<any[]>} */
async function listJobs(r, runId, token, o = {}) {
  const body = await request(r.host, `/repos/${r.owner}/${r.repo}/actions/runs/${runId}/jobs?per_page=100`,
    token, { signal: o.signal });
  return (body && body.jobs) || [];
}

/** @param {{host:string, owner:string, repo:string}} r @param {number} runId @param {string} token */
async function rerun(r, runId, token) {
  return request(r.host, `/repos/${r.owner}/${r.repo}/actions/runs/${runId}/rerun`, token, { method: 'POST' });
}

/** @param {{host:string, owner:string, repo:string}} r @param {number} runId @param {string} token */
async function cancel(r, runId, token) {
  return request(r.host, `/repos/${r.owner}/${r.repo}/actions/runs/${runId}/cancel`, token, { method: 'POST' });
}

module.exports = { getSession, apiBase, request, listRuns, listJobs, rerun, cancel, GitHubError, SCOPES };
