// @ts-check
'use strict';
const vscode = require('vscode');

/** Status bar now-playing with a scrolling-free, width-capped label. */
class SpotifyStatus {
  constructor() {
    this.item = vscode.window.createStatusBarItem('ruoste.spotify', vscode.StatusBarAlignment.Left, 80);
    this.item.name = 'RUOSTE Spotify';
    this.item.command = 'ruoste.spotify.toggle';
    this.item.hide();
  }

  /** @param {any} s */
  update(s) {
    const cfg = vscode.workspace.getConfiguration('ruoste.spotify');
    if (!cfg.get('statusBar', true) || !s || !s.signedIn || !s.title) { this.item.hide(); return; }
    const max = Math.max(10, Number(cfg.get('statusBarMaxLength', 32)));
    let label = `${s.title}${s.artist ? ` — ${s.artist}` : ''}`;
    if (label.length > max) label = label.slice(0, max - 1).trimEnd() + '…';
    this.item.text = `$(${s.playing ? 'debug-pause' : 'play'}) ${label}`;
    this.item.tooltip = new vscode.MarkdownString(
      `**${s.title}**  \n${s.artist}  \n${s.album || ''}${s.deviceName ? `  \n\non ${s.deviceName}` : ''}` +
      `${s.dj ? '  \n\n_Spotify DJ_' : ''}`);
    this.item.show();
  }

  dispose() { this.item.dispose(); }
}

module.exports = { SpotifyStatus };
