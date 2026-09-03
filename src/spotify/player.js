// @ts-check
'use strict';
/** Owns player state. Polls fast while playing, slowly while paused, not at all
 *  while nothing is listening. Commands apply optimistically then reconcile. */
const vscode = require('vscode');
const { playerSummary, parseUri } = require('./format');

class Player {
  /** @param {InstanceType<typeof import('./api').SpotifyApi>} api @param {InstanceType<typeof import('./auth').SpotifyAuth>} auth */
  constructor(api, auth) {
    this.api = api;
    this.auth = auth;
    /** @type {any} */ this.summary = playerSummary(null);
    /** @type {any[]} */ this.queue = [];
    /** @type {any} */ this.queueNowPlaying = null;
    /** @type {any[]} */ this.devices = [];
    this.liked = false;
    /** @type {string|undefined} */ this.error = undefined;
    /** @type {vscode.EventEmitter<any>} */
    this._onDidChange = new vscode.EventEmitter();
    this.onDidChange = this._onDidChange.event;
    /** @type {NodeJS.Timeout|undefined} */ this._timer = undefined;
    /** @type {AbortController|undefined} */ this._inflight = undefined;
    this._listeners = 0;                 // how many surfaces are visible
    this._lastQueueFetch = 0;
    this._queueDirty = true;      // force a fetch after anything that reorders it
    this._localProgressAt = 0;
  }

  get cfg() { return vscode.workspace.getConfiguration('ruoste.spotify'); }

  /** A surface became visible. @returns {vscode.Disposable} */
  addListener() {
    this._listeners++;
    this.schedule(true);
    return new vscode.Disposable(() => {
      this._listeners = Math.max(0, this._listeners - 1);
      if (!this._listeners && this._timer) { clearTimeout(this._timer); this._timer = undefined; }
    });
  }

  fire() { this._onDidChange.fire(this.snapshot()); }

  /** State plus a locally advanced progress, so the scrubber moves between polls. */
  snapshot() {
    const s = { ...this.summary };
    if (s.playing && this._localProgressAt)
      s.progress = Math.min(s.duration, s.progress + (Date.now() - this._localProgressAt));
    return {
      ...s, queue: this.queue, devices: this.devices,
      liked: this.liked, error: this.error, signedIn: this.auth.signedIn,
      queueLimit: Math.max(1, Number(this.cfg.get('queueLength', 25))),
      showArtwork: Boolean(this.cfg.get('showArtwork', true)),
    };
  }

  schedule(immediate = false) {
    if (this._timer) clearTimeout(this._timer);
    this._timer = undefined;
    if (!this._listeners || !this.auth.signedIn) return;
    const fast = Math.max(1, Number(this.cfg.get('pollInterval', 2)));
    const slow = Math.max(5, Number(this.cfg.get('idlePollInterval', 15)));
    const ms = immediate ? 0 : (this.summary.playing ? fast : slow) * 1000;
    this._timer = setTimeout(() => { void this.poll(); }, ms);
  }

  /** @returns {Promise<void>} */
  async poll() {
    if (!this.auth.signedIn) { this.schedule(); return; }
    this._inflight?.abort();
    const ctrl = new AbortController();
    this._inflight = ctrl;
    try {
      const raw = await this.api.state(ctrl.signal);
      const prevId = this.summary.id;
      this.summary = playerSummary(raw);
      this._localProgressAt = Date.now();
      this.error = undefined;

      if (this.summary.id && this.summary.id !== prevId) {
        this._queueDirty = true;   // the track changed, so the queue moved with it
        this.liked = false;
        try {
          const r = await this.api.isSaved([this.summary.id]);
          this.liked = Array.isArray(r) ? !!r[0] : false;
        } catch { /* non-fatal */ }
      }
      // Refetch when something has reordered the queue, otherwise on a slow
      // cadence. Spotify's queue is eventually consistent, so a write is not
      // immediately visible — hence the retry below rather than a single read.
      const stale = Date.now() - this._lastQueueFetch >
        Math.max(3, Number(this.cfg.get('queuePollInterval', 8))) * 1000;
      if (this._queueDirty || stale) {
        this._queueDirty = false;
        this._lastQueueFetch = Date.now();
        try {
          const q = await this.api.queue();
          this.queue = Array.isArray(q?.queue) ? q.queue : [];
          this.queueNowPlaying = q?.currently_playing || null;
        } catch { /* some accounts 403 this endpoint; leave the queue as-is */ }
      }
    } catch (err) {
      if (ctrl.signal.aborted) return;
      this.error = err?.kind === 'no-device' ? undefined : (err?.message || String(err));
      if (err?.kind === 'no-device') this.summary = playerSummary(null);
    } finally {
      if (!ctrl.signal.aborted) { this.fire(); this.schedule(); }
    }
  }

  /** Run a command, surface a useful message, then re-poll.
   * @param {() => Promise<any>} fn @param {string} what @param {boolean} [touchesQueue]
   * @returns {Promise<boolean>} */
  async run(fn, what, touchesQueue = false) {
    try {
      await fn();
      if (touchesQueue) {
        this._queueDirty = true;
        // the queue endpoint lags the write; read twice rather than show stale
        setTimeout(() => { this._queueDirty = true; void this.poll(); }, 400);
        setTimeout(() => { this._queueDirty = true; void this.poll(); }, 1400);
      } else {
        setTimeout(() => void this.poll(), 350);
      }
      return true;
    } catch (err) {
      const kind = err?.kind;
      if (kind === 'premium')
        vscode.window.showWarningMessage('Spotify Premium is required to control playback from the Web API.');
      else if (kind === 'no-device')
        void this.offerDevice();
      else if (kind === 'retired' || kind === 'restricted')
        vscode.window.showWarningMessage(err.message);
      else
        vscode.window.showErrorMessage(`RUOSTE · Spotify: could not ${what} — ${err?.message || err}`);
      return false;
    }
  }

  /** No active device: offer to pick one rather than failing silently. */
  async offerDevice() {
    let list = [];
    try { list = (await this.api.devices())?.devices || []; } catch { /* ignore */ }
    if (!list.length) {
      const OPEN = 'Open Spotify';
      const pick = await vscode.window.showWarningMessage(
        'No active Spotify device. Start playback in the Spotify app once, then control it from here.', OPEN);
      if (pick === OPEN) await vscode.env.openExternal(vscode.Uri.parse('https://open.spotify.com'));
      return;
    }
    const pick = await vscode.window.showQuickPick(
      list.map((d) => ({ label: d.name, description: d.type + (d.is_active ? ' · active' : ''), id: d.id })),
      { title: 'Transfer Spotify playback to…' });
    if (pick) await this.run(() => this.api.transfer(pick.id, true), 'transfer playback');
  }

  // ── commands (optimistic where it is safe) ────────────────────────────
  async toggle() {
    const wasPlaying = this.summary.playing;
    this.summary = { ...this.summary, playing: !wasPlaying };
    this._localProgressAt = Date.now();
    this.fire();
    const ok = await this.run(() => (wasPlaying ? this.api.pause() : this.api.play()), wasPlaying ? 'pause' : 'play');
    if (!ok) { this.summary = { ...this.summary, playing: wasPlaying }; this.fire(); }
  }
  next() {
    if (this.disallowed('skipping_next')) {
      vscode.window.showWarningMessage('Spotify is not allowing skip forward right now.');
      return Promise.resolve(false);
    }
    return this.run(() => this.api.next(), 'skip forward', true);
  }
  previous() {
    if (this.disallowed('skipping_prev')) {
      vscode.window.showWarningMessage('Spotify is not allowing skip back right now.');
      return Promise.resolve(false);
    }
    return this.run(() => this.api.previous(), 'skip back', true);
  }
  /** @param {string} action @returns {boolean} */
  disallowed(action) { return !!(this.summary.disallows && this.summary.disallows[action]); }

  /** @param {number} ms */
  seek(ms) {
    if (this.disallowed('seeking')) {
      vscode.window.showWarningMessage(this.summary.dj
        ? 'Spotify blocks seeking while the DJ is playing.'
        : 'Spotify is not allowing seeking on this track right now.');
      this.fire();                       // snap the scrubber back
      return Promise.resolve(false);
    }
    this.summary = { ...this.summary, progress: ms };
    this._localProgressAt = Date.now();
    this.fire();
    return this.run(() => this.api.seek(ms), 'seek');
  }
  /** @param {number} pct */
  setVolume(pct) {
    this.summary = { ...this.summary, volume: pct };
    this.fire();
    return this.run(() => this.api.volume(pct), 'set volume');
  }
  toggleShuffle() {
    const next = !this.summary.shuffle;
    this.summary = { ...this.summary, shuffle: next }; this.fire();
    // shuffle reorders everything after the current track
    return this.run(() => this.api.shuffle(next), 'toggle shuffle', true);
  }
  cycleRepeat() {
    const order = /** @type {const} */ (['off', 'context', 'track']);
    const next = order[(order.indexOf(this.summary.repeat) + 1) % order.length];
    this.summary = { ...this.summary, repeat: next }; this.fire();
    return this.run(() => this.api.repeat(next), 'change repeat');
  }
  async toggleLike() {
    const id = this.summary.id;
    if (!id) return;
    const want = !this.liked;
    this.liked = want; this.fire();
    const ok = await this.run(() => (want ? this.api.save([id]) : this.api.unsave([id])),
      want ? 'save track' : 'remove track');
    if (!ok) { this.liked = !want; this.fire(); }
  }
  /** @param {string} uri */
  enqueue(uri) { return this.run(() => this.api.enqueue(uri), 'add to queue', true); }

  /** Spotify's queue endpoint takes only track and episode URIs. Albums and
   *  playlists have to be expanded into their tracks first.
   * @param {string} uri @param {string} [label] @returns {Promise<number>} number queued */
  async enqueueAny(uri, label = 'item') {
    const r = parseUri(uri);
    if (!r) { vscode.window.showWarningMessage(`RUOSTE · Spotify: "${uri}" is not a Spotify URI.`); return 0; }
    if (r.type === 'track' || r.type === 'episode')
      return (await this.enqueue(uri)) ? 1 : 0;

    if (r.type !== 'album' && r.type !== 'playlist') {
      vscode.window.showWarningMessage(
        `RUOSTE · Spotify: a ${r.type} cannot be queued — only tracks, episodes, albums and playlists.`);
      return 0;
    }

    const cap = Math.max(1, Number(this.cfg.get('queueBatchLimit', 50)));
    /** @type {string[]} */ let uris = [];
    try {
      if (r.type === 'album') {
        const b = await this.api.albumTracks(r.id, Math.min(50, cap));
        uris = (b?.items || []).map((t) => t && t.uri).filter(Boolean);
      } else {
        const b = await this.api.playlistTracks(r.id, Math.min(100, cap));
        uris = (b?.items || []).map((i) => i && i.track && i.track.uri).filter(Boolean);
      }
    } catch (err) {
      vscode.window.showErrorMessage(`RUOSTE · Spotify: could not read that ${r.type} — ${err?.message || err}`);
      return 0;
    }
    uris = uris.slice(0, cap);
    if (!uris.length) { vscode.window.showWarningMessage(`RUOSTE · Spotify: that ${r.type} has no playable tracks.`); return 0; }

    let queued = 0;
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Queueing ${label}…`, cancellable: true },
      async (progress, token) => {
        for (const [i, u] of uris.entries()) {
          if (token.isCancellationRequested) break;
          try { await this.api.enqueue(u); queued++; }
          catch (err) {
            // one bad track should not abort the batch; a dead device should
            if (err?.kind === 'no-device' || err?.kind === 'premium') { await this.run(() => Promise.reject(err), 'add to queue'); break; }
          }
          progress.report({ message: `${i + 1} / ${uris.length}`, increment: 100 / uris.length });
        }
      });
    if (queued) {
      vscode.window.setStatusBarMessage(`Queued ${queued} track${queued === 1 ? '' : 's'} from ${label}`, 3000);
      setTimeout(() => void this.poll(), 400);
    }
    return queued;
  }
  /** @param {{uris?:string[], context_uri?:string, offset?:any}} body */
  playThis(body) { return this.run(() => this.api.play(body), 'start playback', true); }

  dispose() {
    if (this._timer) clearTimeout(this._timer);
    this._inflight?.abort();
    this._onDidChange.dispose();
  }
}

module.exports = { Player };
