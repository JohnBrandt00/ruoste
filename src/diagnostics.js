// @ts-check
'use strict';
/** A single command that reports exactly what did and did not come up, so a
 *  failure can be diagnosed from the user's machine instead of guessed at. */
const vscode = require('vscode');

/** @type {Map<string, string>} view id -> 'ok' | error text */
const viewStatus = new Map();
/** @type {Map<string, string>} feature -> 'ok' | error text */
const featureStatus = new Map();

/** @param {string} id @param {string} state */
const noteView = (id, state) => viewStatus.set(id, state);
/** @param {string} name @param {string} state */
const noteFeature = (name, state) => featureStatus.set(name, state);

/** Create a tree view without letting a registration failure be fatal.
 * The "No view is registered with id" error is raised on VS Code's main thread
 * and surfaces asynchronously, so it cannot be caught here — but we can at
 * least record the attempt and keep going.
 * @param {string} id @param {vscode.TreeViewOptions<any>} opts
 * @returns {vscode.TreeView<any>|undefined} */
function safeTreeView(id, opts) {
  try {
    const v = vscode.window.createTreeView(id, opts);
    noteView(id, 'ok');
    return v;
  } catch (err) {
    noteView(id, `FAILED — ${err && err.message ? err.message : err}`);
    return undefined;
  }
}

/** @param {vscode.ExtensionContext} ctx @param {() => any} getState */
function registerDiagnostics(ctx, getState) {
  return vscode.commands.registerCommand('ruoste.diagnostics', async () => {
    const ch = vscode.window.createOutputChannel('RUOSTE Diagnostics');
    const ext = ctx.extension;
    const pkg = ext.packageJSON || {};
    const declared = [];
    for (const [container, views] of Object.entries(pkg.contributes?.views || {}))
      for (const v of /** @type {any[]} */ (views))
        declared.push(`      ${v.id}  (container: ${container}${v.when ? `, when: ${v.when}` : ''}${v.type ? `, type: ${v.type}` : ''})`);

    const s = getState() || {};
    const lines = [
      'RUOSTE diagnostics',
      '='.repeat(60), '',
      `  extension     ${ext.id} v${pkg.version}`,
      `  vscode        ${vscode.version}`,
      `  install path  ${ext.extensionPath}`,
      '',
      '  DECLARED VIEWS',
      ...declared,
      '',
      '  VIEW REGISTRATION',
      ...[...viewStatus.entries()].map(([k, v]) => `      ${k.padEnd(30)} ${v}`),
      '',
      '  FEATURES',
      ...[...featureStatus.entries()].map(([k, v]) => `      ${k.padEnd(30)} ${v}`),
      '',
      '  GITHUB',
      `      signed in     ${s.githubSignedIn ? 'yes' : 'no'}`,
      `      repositories  ${s.repoCount ?? '—'}`,
      `      rate limit    ${s.rateLimit || '—'}`,
      `      issues/prs    ${s.workItems ?? '—'}${s.workReview ? ` (${s.workReview} to review)` : ''}`,
      '',
      '  SPOTIFY',
      `      client id     ${s.spotifyClientId ? 'set' : 'NOT SET'}`,
      `      signed in     ${s.spotifySignedIn ? 'yes' : 'no'}`,
      `      redirect uri  ${s.redirectUri || '—'}`,
      '',
      '='.repeat(60),
      'If a view says FAILED, reload the window first — installing a .vsix over a',
      'running extension leaves the old contributions live until reload.',
    ];
    ch.appendLine(lines.join('\n'));
    ch.show(true);
  });
}

module.exports = { safeTreeView, noteView, noteFeature, registerDiagnostics, viewStatus, featureStatus };
