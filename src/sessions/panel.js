// @ts-check
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const nonce = () => Array.from({ length: 32 },
  () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');

/** Validate a message from the webview. Returns what the host must do. A report opens
 *  only when its real path is inside the cwd of a session we know.
 *  @param {any} msg @param {import('./read').ViewModel} model
 *  @returns {{action:'select', sessionId:string}|{action:'open', file:string}|{action:'ignore'}} */
function handleWebviewMessage(msg, model) {
  const ignore = /** @type {const} */ ({ action: 'ignore' });
  if (!msg || typeof msg !== 'object' || typeof msg.sessionId !== 'string') return ignore;
  const row = model.sessions.find((s) => s.sessionId === msg.sessionId);
  if (!row) return ignore;
  if (msg.type === 'select') return { action: 'select', sessionId: row.sessionId };
  if (msg.type === 'openReport' && typeof msg.path === 'string' && row.cwd) {
    try {
      const root = fs.realpathSync(row.cwd);
      const file = fs.realpathSync(path.resolve(row.cwd, msg.path));
      const rel = path.relative(root, file);
      if (/\.key$/i.test(file)) return ignore;   // session secrets: never open
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return { action: 'open', file };
    } catch { /* missing file or cwd: refuse */ }
  }
  return ignore;
}

/** @type {{panel?: vscode.WebviewPanel, push?: () => void, select?: (id:string) => void}} */
const slot = {};

const isChiefViewVisible = () => !!slot.panel && slot.panel.visible;

/** Push the current model to the open panel, if any. */
function refreshChiefView() { if (slot.push && isChiefViewVisible()) slot.push(); }

/** @param {vscode.ExtensionContext} ctx @param {(selected?:string)=>import('./read').ViewModel} getModel
 *  @param {string} [sessionId] */
function openChiefView(ctx, getModel, sessionId) {
  let selected = sessionId;
  if (slot.panel && slot.push) {
    slot.panel.reveal(undefined, false);
    if (sessionId) slot.select(sessionId);
    slot.push();
    return;
  }
  const panel = vscode.window.createWebviewPanel(
    'ruoste.sessions.chief', 'Claude Sessions',
    { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
    { enableScripts: true, retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, 'media')] });
  panel.iconPath = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'activity-bar.svg');
  const n = nonce();
  const uri = (/** @type {string} */ f) => panel.webview.asWebviewUri(vscode.Uri.joinPath(ctx.extensionUri, 'media', f));
  panel.webview.html = `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none';
  img-src ${panel.webview.cspSource} data:; style-src ${panel.webview.cspSource} 'unsafe-inline';
  script-src 'nonce-${n}'; font-src ${panel.webview.cspSource};">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${uri('sessions.css')}">
</head><body>
<header>
  <div class="brand">CLAUDE SESSIONS</div>
  <div class="spacer"></div>
  <div id="budget"></div>
</header>
<div id="banner"></div>
<main>
  <section id="sessions"><h2>Sessions</h2><div id="sessionList"></div></section>
  <section id="timeline"><h2>Chief timeline</h2><div id="timelineList"></div></section>
  <section id="roster"><h2>Agents</h2><div id="rosterList"></div></section>
</main>
<script nonce="${n}" src="${uri('sessions.js')}"></script>
</body></html>`;

  let disposed = false;
  const push = () => {
    if (disposed) return;
    const model = getModel(selected);
    selected = model.selected;
    void panel.webview.postMessage({ type: 'model', model });
  };
  panel.webview.onDidReceiveMessage((m) => {
    if (m && m.type === 'ready') { push(); return; }
    const r = handleWebviewMessage(m, getModel(selected));
    if (r.action === 'select') { selected = r.sessionId; push(); }
    else if (r.action === 'open') void vscode.window.showTextDocument(vscode.Uri.file(r.file));
  });
  panel.onDidDispose(() => { disposed = true; slot.panel = undefined; slot.push = undefined; slot.select = undefined; });
  slot.panel = panel;
  slot.push = push;
  slot.select = (id) => { selected = id; };
}

module.exports = { handleWebviewMessage, openChiefView, refreshChiefView, isChiefViewVisible };
