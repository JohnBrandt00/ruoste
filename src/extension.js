// @ts-check
'use strict';
const vscode = require('vscode');
const fonts = require('./fonts');
const { activateActions } = require('./github');
const { activateSpotify } = require('./spotify');
const { registerDiagnostics, noteFeature } = require('./diagnostics');

/** Run one feature's setup in isolation. A synchronous failure in one must not
 *  take the others down — everything here runs inside a single activate().
 *  Note: errors raised on VS Code's main thread (a view failing to register,
 *  for instance) surface asynchronously and cannot be caught here, which is why
 *  view creation is also guarded individually. */
function safely(name, fn) {
  try { const v = fn(); noteFeature(name, 'ok'); return v; }
  catch (err) {
    const msg = err && err.message ? err.message : String(err);
    noteFeature(name, `FAILED — ${msg}`);
    console.error(`[RUOSTE] ${name} failed to activate`, err);
    vscode.window.showErrorMessage(
      `RUOSTE: ${name} failed to start — ${msg}. Run “RUOSTE: Show Diagnostics” for details.`);
    return undefined;
  }
}

/** @param {vscode.ExtensionContext} ctx */
function activate(ctx) {
  safely('fonts', () => {
    ctx.subscriptions.push(
      vscode.commands.registerCommand('ruoste.installFont', () => fonts.installFontCommand(ctx)),
      vscode.commands.registerCommand('ruoste.useFontSetting', () => fonts.reconcileFontSetting()),
    );
    void fonts.maybeOfferInstall(ctx);
  });

  const actions = safely('GitHub Actions', () => activateActions(ctx));
  const spotify = safely('Spotify', () => activateSpotify(ctx));

  ctx.subscriptions.push(registerDiagnostics(ctx, () => ({
    githubSignedIn: !!actions?.signedIn,
    repoCount: actions?.repos?.repos?.length,
    rateLimit: actions?.client?.budget(),
    spotifyClientId: !!spotify?.auth?.clientId,
    spotifySignedIn: !!spotify?.auth?.signedIn,
    redirectUri: spotify?.auth?.redirectUri,
  })));
}

function deactivate() { /* subscriptions handle teardown */ }

module.exports = { activate, deactivate };
