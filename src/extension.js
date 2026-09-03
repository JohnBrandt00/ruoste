// @ts-check
'use strict';
const vscode = require('vscode');
const fonts = require('./fonts');
const { activateActions } = require('./github');
const { activateSpotify } = require('./spotify');

/** Run one feature's setup in isolation. A failure in one must not take the
 *  others down with it — everything here runs inside a single activate(). */
function safely(name, fn) {
  try { return fn(); }
  catch (err) {
    console.error(`[RUOSTE] ${name} failed to activate`, err);
    vscode.window.showErrorMessage(
      `RUOSTE: ${name} failed to start — ${err && err.message ? err.message : err}. ` +
      `The themes and the rest of the extension are unaffected.`);
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

  safely('GitHub Actions', () => activateActions(ctx));
  safely('Spotify', () => activateSpotify(ctx));
}

function deactivate() { /* subscriptions handle teardown */ }

module.exports = { activate, deactivate };
