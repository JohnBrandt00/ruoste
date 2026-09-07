// @ts-check
'use strict';
/** Reviewing a pull request's changes without leaving the editor.
 *
 *  Two depths. The panel renders the unified patch GitHub already sent with the
 *  file list — no extra request, enough to read a change. Opening a file goes
 *  further: both sides are fetched at their exact commits and handed to VS
 *  Code's own diff editor, which brings syntax highlighting, folding, find, and
 *  every diff setting the user already has.
 *
 *  Both sides are read-only documents behind a scheme of our own, so nothing
 *  here can be mistaken for a working-tree file and saved over. */
const vscode = require('vscode');
const api = require('./api');

const SCHEME = 'ruoste-github';

/** `ruoste-github://host/owner/repo/ref/path/to/file.cs` — the extension is the
 *  last segment, which is what VS Code reads the language from.
 * @param {{host:string, owner:string, repo:string}} repo @param {string} filePath
 * @param {string} ref @param {{empty?:boolean, label?:string}} [o] @returns {vscode.Uri} */
function fileUri(repo, filePath, ref, o = {}) {
  const clean = String(filePath).replace(/^\/+/, '');
  return vscode.Uri.from({
    scheme: SCHEME,
    authority: repo.host,
    path: `/${repo.owner}/${repo.repo}/${ref}/${clean}`,
    query: o.empty ? 'empty=1' : '',
  });
}

/** @param {vscode.Uri} uri @returns {{repo:{host:string, owner:string, repo:string},
 *   ref:string, path:string, empty:boolean}|null} */
function parseUri(uri) {
  const parts = uri.path.replace(/^\//, '').split('/');
  if (parts.length < 4) return null;
  const [owner, repo, ref, ...rest] = parts;
  return {
    repo: { host: uri.authority || 'github.com', owner, repo },
    ref, path: rest.join('/'), empty: /(^|&)empty=1(&|$)/.test(uri.query),
  };
}

/** Serves the two sides of a diff. Contents are cached by URI: a blob at a
 *  given commit cannot change, so a reopened diff costs nothing. */
class GitHubFileProvider {
  /** @param {InstanceType<typeof api.GitHubClient>} client */
  constructor(client) {
    this.client = client;
    /** @type {Map<string, string>} */ this.cache = new Map();
    /** @type {vscode.EventEmitter<vscode.Uri>} */
    this._emitter = new vscode.EventEmitter();
    this.onDidChange = this._emitter.event;
  }

  /** @param {vscode.Uri} uri @returns {Promise<string>} */
  async provideTextDocumentContent(uri) {
    const key = uri.toString();
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;

    const parsed = parseUri(uri);
    if (!parsed) return '';
    if (parsed.empty) return '';

    const session = await api.getSession(false);
    if (!session) return '// RUOSTE: sign in to GitHub to read this file.';
    try {
      const text = await this.client.fileAt(parsed.repo, parsed.path, parsed.ref, session.accessToken);
      this.cache.set(key, text);
      return text;
    } catch (err) {
      // a readable placeholder beats an empty editor with a toast behind it
      return `// RUOSTE could not read ${parsed.path} at ${parsed.ref.slice(0, 7)}\n` +
             `// ${err?.message || err}\n`;
    }
  }

  dispose() { this._emitter.dispose(); }
}

/** @param {any} file @returns {boolean} a file the diff editor cannot show */
const isBinary = (file) => !file?.patch && file?.status !== 'renamed' &&
  (Number(file?.additions) || 0) + (Number(file?.deletions) || 0) === 0;

/** @param {{host:string, owner:string, repo:string}} repo @param {any} pr @param {any} file
 *  @returns {Promise<void>} */
async function openFileDiff(repo, pr, file) {
  if (!pr?.base?.sha || !pr?.head?.sha) {
    vscode.window.showWarningMessage('RUOSTE: this pull request has no commits to compare.');
    return;
  }
  if (isBinary(file)) {
    const open = await vscode.window.showWarningMessage(
      `${file.filename} is binary — there is nothing for the diff editor to show.`, 'Open on GitHub');
    if (open && file.blob_url) await vscode.env.openExternal(vscode.Uri.parse(file.blob_url));
    return;
  }

  const added = file.status === 'added';
  const removed = file.status === 'removed';
  const basePath = file.previous_filename || file.filename;
  const left = fileUri(repo, basePath, pr.base.sha, { empty: added });
  const right = fileUri(repo, file.filename, pr.head.sha, { empty: removed });
  const name = String(file.filename).split('/').pop();
  const title = `${name} · #${pr.number} ${pr.base.ref}…${pr.head.ref}`;
  await vscode.commands.executeCommand('vscode.diff', left, right, title, { preview: true });
}

/** Pick a changed file, then diff it. The entry point from the tree, where we
 *  hold a search result rather than the pull request itself.
 * @param {any} provider @param {any} node @returns {Promise<void>} */
async function pickAndDiff(provider, node) {
  const repo = node?.repo;
  const number = Number(node?.item?.number ?? node?.number);
  if (!repo || !Number.isFinite(number)) return;
  const session = await api.getSession(true);
  if (!session) return;

  /** @type {any} */ let pr = null;
  /** @type {any[]} */ let files = [];
  try {
    [pr, files] = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'RUOSTE: reading the diff…' },
      async () => Promise.all([
        provider.client.pull(repo, number, session.accessToken),
        provider.client.pullFiles(repo, number, session.accessToken),
      ]));
  } catch (err) {
    vscode.window.showErrorMessage(`RUOSTE: could not read #${number} — ${err?.message || err}`);
    return;
  }
  if (!files.length) { vscode.window.showInformationMessage(`#${number} changes no files.`); return; }

  const pick = /** @type {any} */ (await vscode.window.showQuickPick(
    files.map((f) => ({
      label: String(f.filename).split('/').pop(),
      description: String(f.filename).split('/').slice(0, -1).join('/'),
      detail: `${f.status} · +${f.additions} −${f.deletions}${isBinary(f) ? ' · binary' : ''}`,
      file: f,
    })),
    { title: `#${number} · ${files.length} changed files`, matchOnDescription: true }));
  if (!pick) return;
  await openFileDiff(repo, pr, pick.file);
}

/** @param {vscode.ExtensionContext} ctx @param {InstanceType<typeof api.GitHubClient>} client
 *  @returns {GitHubFileProvider} */
function registerDiffProvider(ctx, client) {
  const provider = new GitHubFileProvider(client);
  ctx.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider),
    provider,
  );
  return provider;
}

module.exports = { registerDiffProvider, openFileDiff, pickAndDiff, fileUri, parseUri, isBinary, SCHEME };
