// @ts-check
'use strict';
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { parseRemote } = require('../util');

/** Ask the built-in git extension for the open repositories.
 * @returns {any|null} the git API, or null if the extension isn't there yet */
function gitApi() {
  const ext = vscode.extensions.getExtension('vscode.git');
  if (!ext) return null;
  const exports = ext.isActive ? ext.exports : undefined;
  if (!exports || typeof exports.getAPI !== 'function') return null;
  try { return exports.getAPI(1); } catch { return null; }
}

/** Last-resort: read .git/config ourselves.
 * @param {string} root @returns {string|null} */
function remoteFromGitConfig(root) {
  try {
    const cfg = fs.readFileSync(path.join(root, '.git', 'config'), 'utf8');
    // prefer origin, else the first url we find
    const origin = /\[remote "origin"\][^[]*?url\s*=\s*(\S+)/s.exec(cfg);
    if (origin) return origin[1];
    const any = /url\s*=\s*(\S+)/.exec(cfg);
    return any ? any[1] : null;
  } catch { return null; }
}

/** Resolve the repo to show Actions for.
 * @returns {{owner:string, repo:string, host:string, branch:string|undefined, root:string|undefined}|null} */
function detectRepository() {
  const api = gitApi();
  if (api && Array.isArray(api.repositories)) {
    for (const r of api.repositories) {
      const remotes = r.state && Array.isArray(r.state.remotes) ? r.state.remotes : [];
      const origin = remotes.find((x) => x.name === 'origin') || remotes[0];
      const url = origin && (origin.fetchUrl || origin.pushUrl);
      const parsed = url ? parseRemote(url) : null;
      if (parsed) return {
        ...parsed,
        branch: r.state && r.state.HEAD ? r.state.HEAD.name : undefined,
        root: r.rootUri ? r.rootUri.fsPath : undefined,
      };
    }
  }
  for (const folder of vscode.workspace.workspaceFolders || []) {
    const url = remoteFromGitConfig(folder.uri.fsPath);
    const parsed = url ? parseRemote(url) : null;
    if (parsed) return { ...parsed, branch: undefined, root: folder.uri.fsPath };
  }
  return null;
}

/** Fires when the git extension's repo list or HEAD changes.
 * @param {() => void} onChange @returns {vscode.Disposable} */
function watchRepository(onChange) {
  /** @type {vscode.Disposable[]} */
  const subs = [];
  const api = gitApi();
  if (api) {
    if (typeof api.onDidOpenRepository === 'function') subs.push(api.onDidOpenRepository(onChange));
    if (typeof api.onDidCloseRepository === 'function') subs.push(api.onDidCloseRepository(onChange));
    for (const r of api.repositories || [])
      if (typeof r.state?.onDidChange === 'function') subs.push(r.state.onDidChange(onChange));
  }
  subs.push(vscode.workspace.onDidChangeWorkspaceFolders(onChange));
  return new vscode.Disposable(() => { for (const s of subs) s.dispose(); });
}

module.exports = { detectRepository, watchRepository, remoteFromGitConfig, gitApi };
