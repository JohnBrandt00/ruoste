// @ts-check
'use strict';
const vscode = require('vscode');
const { SpotifyAuth } = require('./auth');
const { SpotifyApi } = require('./api');
const { Player } = require('./player');
const { NowPlayingView } = require('./webview');
const { LibraryProvider } = require('./library');
const { searchQuickPick } = require('./search');
const { startDj } = require('./dj');
const { SpotifyStatus } = require('./status');
const { parseUri } = require('./format');

/** @param {vscode.ExtensionContext} ctx */
function activateSpotify(ctx) {
  const auth = new SpotifyAuth(ctx);
  const api = new SpotifyApi(auth);
  const player = new Player(api, auth);
  const status = new SpotifyStatus();
  const library = new LibraryProvider(api, auth, player);
  const view = new NowPlayingView(ctx, player);

  ctx.subscriptions.push(auth, player, status, library,
    vscode.window.registerWebviewViewProvider('ruoste.spotify.nowPlaying', view,
      { webviewOptions: { retainContextWhenHidden: false } }),
    vscode.window.createTreeView('ruoste.spotify.library', { treeDataProvider: library, showCollapseAll: true }),
    vscode.window.registerUriHandler({ handleUri: (uri) => auth.handleUri(uri) }),
  );

  const setCtx = () => vscode.commands.executeCommand('setContext', 'ruoste.spotify.signedIn', auth.signedIn);
  ctx.subscriptions.push(
    auth.onDidChangeSession(() => { setCtx(); library.refresh(); void player.poll(); }),
    player.onDidChange((s) => { status.update(s); }),
  );

  /** @param {string} id @param {(...a:any[]) => any} fn */
  const cmd = (id, fn) => ctx.subscriptions.push(vscode.commands.registerCommand(id, fn));

  cmd('ruoste.spotify.signIn', async () => {
    if (await auth.signIn()) { vscode.window.setStatusBarMessage('RUOSTE · connected to Spotify', 3000); void player.poll(); library.refresh(); }
  });
  cmd('ruoste.spotify.signOut', async () => { await auth.signOut(); library.refresh(); status.update(null); });
  cmd('ruoste.spotify.setClientId', () => auth.promptForClientId());

  cmd('ruoste.spotify.toggle',   () => player.toggle());
  cmd('ruoste.spotify.next',     () => player.next());
  cmd('ruoste.spotify.previous', () => player.previous());
  cmd('ruoste.spotify.shuffle',  () => player.toggleShuffle());
  cmd('ruoste.spotify.repeat',   () => player.cycleRepeat());
  cmd('ruoste.spotify.like',     () => player.toggleLike());
  cmd('ruoste.spotify.device',   () => player.offerDevice());
  cmd('ruoste.spotify.search',   () => searchQuickPick(api, player));
  cmd('ruoste.spotify.dj',       () => startDj(api, player));
  cmd('ruoste.spotify.refresh',  () => { library.refresh(); return player.poll(); });

  cmd('ruoste.spotify.playTrack', async (node) => {
    const t = node?.track;
    if (!t?.uri) return;
    // playing inside its playlist keeps the queue intact; a bare uri does not
    if (node.contextUri) await player.playThis({ context_uri: node.contextUri, offset: { uri: t.uri } });
    else await player.playThis({ uris: [t.uri] });
  });
  cmd('ruoste.spotify.playPlaylist', (node) => {
    const uri = node?.pl?.uri;
    return uri ? player.playThis({ context_uri: uri }) : undefined;
  });
  cmd('ruoste.spotify.queueTrack', async (node) => {
    const uri = node?.track?.uri || node?.pl?.uri;
    if (!uri) return;
    if (await player.enqueue(uri))
      vscode.window.setStatusBarMessage(`Queued ${node?.track?.name || node?.pl?.name || 'item'}`, 2500);
  });
  cmd('ruoste.spotify.queueFromClipboard', async () => {
    const text = await vscode.env.clipboard.readText();
    const r = parseUri(text);
    if (!r) { vscode.window.showWarningMessage('No Spotify link or URI on the clipboard.'); return; }
    if (r.type === 'track') { if (await player.enqueue(`spotify:track:${r.id}`)) vscode.window.setStatusBarMessage('Queued from clipboard', 2500); }
    else await player.playThis({ context_uri: `spotify:${r.type}:${r.id}` });
  });

  cmd('ruoste.spotify.addToPlaylist', async (node) => {
    const uri = node?.track?.uri || player.summary.uri;
    const name = node?.track?.name || player.summary.title;
    if (!uri) { vscode.window.showWarningMessage('Nothing to add.'); return; }
    let lists = [];
    try { lists = (await api.playlists(50, 0))?.items || []; }
    catch (e) { vscode.window.showErrorMessage(`RUOSTE · Spotify: ${e?.message || e}`); return; }
    let me = null;
    try { me = await api.me(); } catch { /* owner filter is best-effort */ }
    const own = lists.filter((p) => p && (!me || p.owner?.id === me.id || p.collaborative));
    if (!own.length) { vscode.window.showWarningMessage('No playlists you can add to.'); return; }
    const pick = await vscode.window.showQuickPick(
      own.map((p) => ({ label: p.name, description: `${p.tracks?.total ?? '?'} tracks`, id: p.id })),
      { title: `Add “${name}” to playlist…` });
    if (!pick) return;
    try {
      await api.addToPlaylist(pick.id, [uri]);
      library.refresh();
      vscode.window.setStatusBarMessage(`Added to ${pick.label}`, 3000);
    } catch (e) { vscode.window.showErrorMessage(`RUOSTE · Spotify: ${e?.message || e}`); }
  });

  cmd('ruoste.spotify.transfer', async (node) => {
    const id = node?.device?.id;
    if (!id) return player.offerDevice();
    await player.run(() => api.transfer(id, player.summary.playing), 'transfer playback');
    library.refresh();
  });

  cmd('ruoste.spotify.openInSpotify', async (node) => {
    const uri = node?.track?.uri || node?.pl?.uri || player.summary.uri;
    const r = uri ? parseUri(uri) : null;
    if (r) await vscode.env.openExternal(vscode.Uri.parse(`https://open.spotify.com/${r.type}/${r.id}`));
  });
  cmd('ruoste.spotify.copyLink', async (node) => {
    const uri = node?.track?.uri || node?.pl?.uri || player.summary.uri;
    const r = uri ? parseUri(uri) : null;
    if (!r) return;
    await vscode.env.clipboard.writeText(`https://open.spotify.com/${r.type}/${r.id}`);
    vscode.window.setStatusBarMessage('Spotify link copied', 2000);
  });

  void auth.load().then(() => { setCtx(); void player.poll(); });
  return { auth, api, player };
}

module.exports = { activateSpotify };
