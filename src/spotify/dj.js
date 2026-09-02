// @ts-check
'use strict';
/** Spotify's AI DJ handoff.
 *
 * The DJ is a Spotify-owned algorithmic context. Since 27 Nov 2024 newly
 * registered apps cannot start algorithmic or editorial playlists through the
 * Web API — /me/player/play with the DJ context returns 403. Reading what the
 * DJ is playing works fine, so this hands off to a real Spotify client and then
 * follows along. */
const vscode = require('vscode');
const { DJ_URI } = require('./format');

/** @param {InstanceType<typeof import('./api').SpotifyApi>} api @param {InstanceType<typeof import('./player').Player>} player */
async function startDj(api, player) {
  // Try it anyway — accounts with older extended-access apps can still do this.
  try {
    await api.play({ context_uri: DJ_URI });
    vscode.window.setStatusBarMessage('RUOSTE · Spotify DJ started', 3000);
    setTimeout(() => void player.poll(), 600);
    return;
  } catch (err) {
    if (err?.kind !== 'retired' && err?.kind !== 'forbidden' && err?.status !== 404) {
      vscode.window.showErrorMessage(`RUOSTE · Spotify: ${err?.message || err}`);
      return;
    }
  }

  const OPEN_APP = 'Open Spotify at DJ';
  const DEVICE = 'Pick a device first';
  const pick = await vscode.window.showInformationMessage(
    'Spotify does not let apps start the AI DJ — it is a Spotify-owned algorithmic context, ' +
    'closed to the Web API since November 2024. Start DJ once in the Spotify app and RUOSTE ' +
    'will follow along and control it from here.',
    OPEN_APP, DEVICE);

  if (pick === DEVICE) { await player.offerDevice(); return; }
  if (pick === OPEN_APP) {
    // spotify: deep link opens the desktop app directly on the DJ
    const opened = await vscode.env.openExternal(vscode.Uri.parse(DJ_URI)).then(() => true, () => false);
    if (!opened) await vscode.env.openExternal(vscode.Uri.parse('https://open.spotify.com/collection/dj'));
    // give the client a moment, then pick the playback up
    setTimeout(() => void player.poll(), 4000);
  }
}

module.exports = { startDj };
