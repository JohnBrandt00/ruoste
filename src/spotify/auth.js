// @ts-check
'use strict';
/**
 * Spotify OAuth 2.0 with PKCE.
 *
 * The callback comes back through VS Code's own URI handler
 * (vscode://<publisher>.<ext>/spotify) instead of a local HTTPS server, so there
 * is no self-signed certificate warning, no port to collide with, and it works
 * over Remote-SSH and WSL. Where the URI handler cannot fire (vscode.dev,
 * some browser Codespaces) the user can paste the redirect URL instead.
 *
 * Tokens live in SecretStorage, never in globalState.
 */
const vscode = require('vscode');
const crypto = require('crypto');

const AUTHORIZE = 'https://accounts.spotify.com/authorize';
const TOKEN = 'https://accounts.spotify.com/api/token';
const SECRET_KEY = 'ruoste.spotify.tokens';

const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
  'playlist-modify-public',
  'user-library-read',
  'user-library-modify',
  'user-top-read',
  'user-read-recently-played',
];

/** @param {Buffer} buf @returns {string} */
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** @returns {{verifier:string, challenge:string}} */
function pkcePair() {
  const verifier = b64url(crypto.randomBytes(64));                 // 86 chars, within 43..128
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/** @typedef {{access_token:string, refresh_token:string, expires_at:number, scope:string}} Tokens */

class SpotifyAuth {
  /** @param {vscode.ExtensionContext} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    /** @type {Tokens|undefined} */ this.tokens = undefined;
    /** @type {Promise<string|undefined>|undefined} */ this._refreshing = undefined;
    /** @type {vscode.EventEmitter<boolean>} */
    this._onDidChange = new vscode.EventEmitter();
    this.onDidChangeSession = this._onDidChange.event;
    /** @type {{verifier:string, state:string, resolve:(v:any)=>void, reject:(e:any)=>void}|undefined} */
    this._pending = undefined;
  }

  get clientId() {
    return String(vscode.workspace.getConfiguration('ruoste.spotify').get('clientId', '') || '').trim();
  }

  /** vscode://publisher.name/spotify — must match the dashboard entry exactly. */
  get redirectUri() {
    return `${vscode.env.uriScheme}://${this.ctx.extension.id}/spotify`;
  }

  /** @returns {Promise<void>} */
  async load() {
    const raw = await this.ctx.secrets.get(SECRET_KEY);
    if (!raw) return;
    try { this.tokens = JSON.parse(raw); } catch { this.tokens = undefined; }
    this._onDidChange.fire(!!this.tokens);
  }

  /** @param {Tokens|undefined} t @returns {Promise<void>} */
  async store(t) {
    this.tokens = t;
    if (t) await this.ctx.secrets.store(SECRET_KEY, JSON.stringify(t));
    else await this.ctx.secrets.delete(SECRET_KEY);
    this._onDidChange.fire(!!t);
  }

  get signedIn() { return !!this.tokens; }

  /** A valid access token, refreshing when it is close to expiry.
   * @returns {Promise<string|undefined>} */
  async token() {
    if (!this.tokens) return undefined;
    if (Date.now() < this.tokens.expires_at - 30_000) return this.tokens.access_token;
    if (!this._refreshing) this._refreshing = this._refresh().finally(() => { this._refreshing = undefined; });
    return this._refreshing;
  }

  /** @returns {Promise<string|undefined>} */
  async _refresh() {
    if (!this.tokens?.refresh_token) return undefined;
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.tokens.refresh_token,
      client_id: this.clientId,
    });
    const res = await fetch(TOKEN, {
      method: 'POST', body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (!res.ok) {
      await this.store(undefined);                    // refresh token revoked — force re-auth
      return undefined;
    }
    const j = /** @type {any} */ (await res.json());
    await this.store({
      access_token: j.access_token,
      // Spotify does not always return a new refresh token; keep the old one
      refresh_token: j.refresh_token || this.tokens.refresh_token,
      expires_at: Date.now() + (Number(j.expires_in) || 3600) * 1000,
      scope: j.scope || this.tokens.scope,
    });
    return this.tokens?.access_token;
  }

  /** Handle vscode://…/spotify?code=…&state=… @param {vscode.Uri} uri */
  handleUri(uri) {
    const q = new URLSearchParams(uri.query);
    const err = q.get('error');
    const code = q.get('code');
    const state = q.get('state');
    if (!this._pending) return;
    if (err) { this._pending.reject(new Error(`Spotify returned "${err}"`)); this._pending = undefined; return; }
    if (!code) { this._pending.reject(new Error('No authorization code in the callback')); this._pending = undefined; return; }
    if (state !== this._pending.state) { this._pending.reject(new Error('State mismatch — ignoring callback')); this._pending = undefined; return; }
    this._pending.resolve(code);
    this._pending = undefined;
  }

  /** @returns {Promise<boolean>} true when a session now exists */
  async signIn() {
    if (!this.clientId) { await this.promptForClientId(); if (!this.clientId) return false; }

    const { verifier, challenge } = pkcePair();
    const state = b64url(crypto.randomBytes(16));
    const url = new URL(AUTHORIZE);
    url.search = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      code_challenge_method: 'S256',
      code_challenge: challenge,
      state,
      scope: SCOPES.join(' '),
      show_dialog: 'false',
    }).toString();

    /** @type {Promise<string>} */
    const waitForCode = new Promise((resolve, reject) => {
      this._pending = { verifier, state, resolve, reject };
      setTimeout(() => {
        if (this._pending && this._pending.state === state) {
          this._pending = undefined;
          reject(new Error('timeout'));
        }
      }, 180_000);
    });

    await vscode.env.openExternal(vscode.Uri.parse(url.toString()));

    let code;
    try {
      code = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification,
          title: 'RUOSTE: waiting for Spotify…', cancellable: true },
        (_p, tok) => new Promise((resolve, reject) => {
          tok.onCancellationRequested(() => reject(new Error('cancelled')));
          waitForCode.then(resolve, reject);
        }));
    } catch (e) {
      if (e && e.message === 'cancelled') return false;
      code = await this.pasteFallback();               // browser / Codespaces path
      if (!code) return false;
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code, redirect_uri: this.redirectUri,
      client_id: this.clientId, code_verifier: verifier,
    });
    const res = await fetch(TOKEN, {
      method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      vscode.window.showErrorMessage(`RUOSTE: Spotify rejected the sign-in (${res.status}). ${detail.slice(0, 200)}`);
      return false;
    }
    const j = /** @type {any} */ (await res.json());
    await this.store({
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_at: Date.now() + (Number(j.expires_in) || 3600) * 1000,
      scope: j.scope || SCOPES.join(' '),
    });
    return true;
  }

  /** When the URI handler cannot fire, let the user paste the whole redirect URL.
   * @returns {Promise<string|undefined>} */
  async pasteFallback() {
    const pasted = await vscode.window.showInputBox({
      title: 'RUOSTE — finish Spotify sign-in',
      prompt: 'VS Code did not receive the callback. Paste the full URL from your browser address bar.',
      placeHolder: `${this.redirectUri}?code=…&state=…`,
      ignoreFocusOut: true,
    });
    if (!pasted) return undefined;
    try { return new URL(pasted.trim()).searchParams.get('code') || undefined; }
    catch { return /[?&]code=([^&\s]+)/.exec(pasted)?.[1]; }
  }

  /** @returns {Promise<void>} */
  async promptForClientId() {
    const OPEN = 'Open Spotify Dashboard';
    const pick = await vscode.window.showInformationMessage(
      'RUOSTE needs a Spotify Client ID. Create an app (free), add the redirect URI below, then paste the Client ID.',
      OPEN, 'I have one');
    if (pick === OPEN) {
      await vscode.env.clipboard.writeText(this.redirectUri);
      vscode.window.showInformationMessage(
        `Redirect URI copied to your clipboard — paste it into the Spotify app's "Redirect URIs" field:  ${this.redirectUri}`);
      await vscode.env.openExternal(vscode.Uri.parse('https://developer.spotify.com/dashboard'));
    }
    const id = await vscode.window.showInputBox({
      title: 'Spotify Client ID',
      prompt: `Redirect URI to register: ${this.redirectUri}`,
      ignoreFocusOut: true,
      validateInput: (v) => /^[0-9a-f]{32}$/i.test(v.trim()) ? undefined
        : 'A Spotify Client ID is 32 hexadecimal characters',
    });
    if (id) {
      await vscode.workspace.getConfiguration('ruoste.spotify')
        .update('clientId', id.trim(), vscode.ConfigurationTarget.Global);
    }
  }

  /** @returns {Promise<void>} */
  async signOut() { await this.store(undefined); }

  dispose() { this._onDidChange.dispose(); }
}

module.exports = { SpotifyAuth, SCOPES, pkcePair, b64url };
