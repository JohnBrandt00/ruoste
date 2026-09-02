// @ts-check
'use strict';
const vscode = require('vscode');

/** @returns {string} */
const nonce = () => Array.from({ length: 32 },
  () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)]).join('');

/** @implements {vscode.WebviewViewProvider} */
class NowPlayingView {
  /** @param {vscode.ExtensionContext} ctx @param {InstanceType<typeof import('./player').Player>} player */
  constructor(ctx, player) {
    this.ctx = ctx;
    this.player = player;
    /** @type {vscode.WebviewView|undefined} */ this.view = undefined;
    /** @type {vscode.Disposable|undefined} */ this._listener = undefined;
  }

  /** @param {vscode.WebviewView} view */
  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, 'media')],
    };
    view.webview.html = this.html(view.webview);

    view.webview.onDidReceiveMessage(async (msg) => {
      const p = this.player;
      switch (msg?.type) {
        case 'ready':        this.push(); break;
        case 'toggle':       await p.toggle(); break;
        case 'next':         await p.next(); break;
        case 'previous':     await p.previous(); break;
        case 'seek':         await p.seek(Number(msg.value)); break;
        case 'volume':       await p.setVolume(Number(msg.value)); break;
        case 'shuffle':      await p.toggleShuffle(); break;
        case 'repeat':       await p.cycleRepeat(); break;
        case 'like':         await p.toggleLike(); break;
        case 'device':       await p.offerDevice(); break;
        case 'signIn':       await vscode.commands.executeCommand('ruoste.spotify.signIn'); break;
        case 'search':       await vscode.commands.executeCommand('ruoste.spotify.search'); break;
        case 'dj':           await vscode.commands.executeCommand('ruoste.spotify.dj'); break;
        case 'playQueued':   await p.playThis({ uris: [String(msg.uri)] }); break;
        case 'openExternal': if (msg.uri) await vscode.env.openExternal(vscode.Uri.parse(String(msg.uri))); break;
      }
    }, undefined, this.ctx.subscriptions);

    const sync = () => this.push();
    const sub = this.player.onDidChange(sync);
    const vis = view.onDidChangeVisibility(() => {
      if (view.visible) { this._attach(); this.push(); } else this._detach();
    });
    if (view.visible) this._attach();

    view.onDidDispose(() => { sub.dispose(); vis.dispose(); this._detach(); this.view = undefined; });
  }

  _attach() { if (!this._listener) this._listener = this.player.addListener(); }
  _detach() { this._listener?.dispose(); this._listener = undefined; }

  push() {
    if (!this.view || !this.view.visible) return;
    void this.view.webview.postMessage({ type: 'state', state: this.player.snapshot() });
  }

  /** @param {vscode.Webview} w @returns {string} */
  html(w) {
    const n = nonce();
    const uri = (f) => w.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, 'media', f));
    return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none';
  img-src ${w.cspSource} https://i.scdn.co https://*.scdn.co https://*.spotifycdn.com data:;
  style-src ${w.cspSource} 'unsafe-inline'; script-src 'nonce-${n}'; font-src ${w.cspSource};">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${uri('spotify.css')}">
</head><body>
<div id="backdrop"></div>
<main id="app" class="signed-out">

  <section id="gate">
    <p class="gate-title">SPOTIFY</p>
    <p class="gate-body">Connect your account to control playback from here.</p>
    <button id="signin" class="primary">Connect Spotify</button>
  </section>

  <section id="player" hidden>
    <div id="artwrap">
      <img id="art" alt="" draggable="false">
      <div id="artfallback">♪</div>
      <button id="dj" class="chip dj" title="Spotify DJ">DJ</button>
    </div>

    <div id="meta">
      <div id="titlerow"><span id="title" class="marquee"></span></div>
      <div id="artist"></div>
    </div>

    <div id="scrub" role="slider" aria-label="Seek" tabindex="0">
      <div id="bar"><div id="fill"></div><div id="knob"></div></div>
      <div id="times"><span id="pos">0:00</span><span id="dur">0:00</span></div>
    </div>

    <div id="transport">
      <button id="shuffle" class="ghost" title="Shuffle">⤨</button>
      <button id="prev" class="ghost" title="Previous">◀◀</button>
      <button id="toggle" class="play" title="Play/Pause">▶</button>
      <button id="next" class="ghost" title="Next">▶▶</button>
      <button id="repeat" class="ghost" title="Repeat">↻</button>
    </div>

    <div id="secondary">
      <button id="like" class="chip" title="Save to your library">♥</button>
      <button id="search" class="chip" title="Search Spotify">SEARCH</button>
      <button id="device" class="chip" title="Transfer playback">
        <span id="devicename">DEVICE</span>
      </button>
      <div id="volwrap" title="Volume">
        <input id="vol" type="range" min="0" max="100" step="1" value="70" aria-label="Volume">
      </div>
    </div>

    <div id="queuewrap">
      <p class="label">UP NEXT</p>
      <ul id="queue"></ul>
    </div>
  </section>

  <p id="error" hidden></p>
</main>
<script nonce="${n}" src="${uri('spotify.js')}"></script>
</body></html>`;
  }
}

module.exports = { NowPlayingView };
