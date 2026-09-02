// @ts-check
'use strict';
/** Incremental QuickPick search across tracks, albums, artists and playlists. */
const vscode = require('vscode');
const { artistNames, trackTime } = require('./format');

/** @param {InstanceType<typeof import('./api').SpotifyApi>} api @param {InstanceType<typeof import('./player').Player>} player */
async function searchQuickPick(api, player) {
  const qp = vscode.window.createQuickPick();
  qp.title = 'Search Spotify';
  qp.placeholder = 'Track, album, artist or playlist…';
  qp.matchOnDescription = true;
  qp.matchOnDetail = true;
  /** @type {AbortController|undefined} */ let ctrl;
  /** @type {NodeJS.Timeout|undefined} */ let debounce;

  const PLAY = { iconPath: new vscode.ThemeIcon('play'), tooltip: 'Play now' };
  const QUEUE = { iconPath: new vscode.ThemeIcon('add'), tooltip: 'Add to queue' };

  const run = async (text) => {
    if (!text.trim()) { qp.items = []; return; }
    ctrl?.abort(); ctrl = new AbortController();
    qp.busy = true;
    try {
      const r = await api.search(text, ['track', 'album', 'artist', 'playlist'], 8, ctrl.signal);
      /** @type {any[]} */ const items = [];
      const push = (label, arr, map) => {
        const list = (arr || []).filter(Boolean);
        if (!list.length) return;
        items.push({ label, kind: vscode.QuickPickItemKind.Separator });
        for (const x of list) items.push(map(x));
      };
      push('Tracks', r?.tracks?.items, (t) => ({
        label: `$(music) ${t.name}`, description: artistNames(t),
        detail: `${t.album?.name || ''} · ${trackTime(t.duration_ms)}`,
        buttons: [PLAY, QUEUE], uri: t.uri, kindName: 'track',
      }));
      push('Albums', r?.albums?.items, (a) => ({
        label: `$(package) ${a.name}`, description: artistNames(a),
        detail: `${a.total_tracks || '?'} tracks · ${(a.release_date || '').slice(0, 4)}`,
        buttons: [PLAY], uri: a.uri, kindName: 'album',
      }));
      push('Artists', r?.artists?.items, (a) => ({
        label: `$(person) ${a.name}`,
        description: a.followers?.total ? `${a.followers.total.toLocaleString()} followers` : '',
        buttons: [PLAY], uri: a.uri, kindName: 'artist', id: a.id,
      }));
      push('Playlists', r?.playlists?.items, (p) => ({
        label: `$(list-unordered) ${p.name}`, description: p.owner?.display_name || '',
        detail: `${p.tracks?.total ?? '?'} tracks`,
        buttons: [PLAY], uri: p.uri, kindName: 'playlist',
      }));
      qp.items = items;
    } catch (err) {
      if (!ctrl.signal.aborted)
        qp.items = [{ label: `$(error) ${err?.message || err}`, alwaysShow: true }];
    } finally { qp.busy = false; }
  };

  qp.onDidChangeValue((v) => { clearTimeout(debounce); debounce = setTimeout(() => void run(v), 260); });

  /** @param {any} item @param {boolean} queue */
  const activate = async (item, queue) => {
    if (!item || !item.uri) return;
    if (queue) { await player.enqueue(item.uri); vscode.window.setStatusBarMessage(`Queued ${item.label.replace(/^\$\([a-z-]+\)\s*/, '')}`, 2500); return; }
    if (item.kindName === 'track') await player.playThis({ uris: [item.uri] });
    else if (item.kindName === 'artist') {
      // artists have no playable context uri; use their top tracks
      try {
        const top = await api.artistTopTracks(item.id);
        const uris = (top?.tracks || []).slice(0, 10).map((t) => t.uri);
        if (uris.length) await player.playThis({ uris });
      } catch { await player.playThis({ context_uri: item.uri }); }
    } else await player.playThis({ context_uri: item.uri });
  };

  qp.onDidTriggerItemButton(async (e) => {
    await activate(e.item, e.button.tooltip === 'Add to queue');
    if (e.button.tooltip !== 'Add to queue') qp.hide();
  });
  qp.onDidAccept(async () => { await activate(qp.selectedItems[0], false); qp.hide(); });
  qp.onDidHide(() => { ctrl?.abort(); clearTimeout(debounce); qp.dispose(); });
  qp.show();
}

module.exports = { searchQuickPick };
