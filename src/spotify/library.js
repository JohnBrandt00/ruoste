// @ts-check
'use strict';
/** Tree: Playlists → tracks, Up Next, Liked Songs, Devices. */
const vscode = require('vscode');
const { trackTime, artistNames } = require('./format');

const icon = (id, color) => new vscode.ThemeIcon(id, color ? new vscode.ThemeColor(color) : undefined);

/** @typedef {{kind:string, [k:string]:any}} Node */

/** @implements {vscode.TreeDataProvider<Node>} */
class LibraryProvider {
  /** @param {InstanceType<typeof import('./api').SpotifyApi>} api @param {InstanceType<typeof import('./auth').SpotifyAuth>} auth
   *  @param {InstanceType<typeof import('./player').Player>} player */
  constructor(api, auth, player) {
    this.api = api; this.auth = auth; this.player = player;
    /** @type {vscode.EventEmitter<Node|undefined>} */
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
    /** @type {Map<string, any[]>} */ this._trackCache = new Map();
  }

  refresh() { this._trackCache.clear(); this._emitter.fire(undefined); }
  dispose() { this._emitter.dispose(); }

  /** @param {Node} n @returns {vscode.TreeItem} */
  getTreeItem(n) {
    const S = vscode.TreeItemCollapsibleState;
    switch (n.kind) {
      case 'section': {
        const it = new vscode.TreeItem(n.label, n.expanded ? S.Expanded : S.Collapsed);
        it.iconPath = icon(n.icon, 'descriptionForeground');
        it.contextValue = `ruoste.spotify.section.${n.id}`;
        return it;
      }
      case 'playlist': {
        const it = new vscode.TreeItem(n.pl.name || 'playlist', S.Collapsed);
        it.id = `pl:${n.pl.id}`;
        it.iconPath = icon('list-unordered', 'symbolIcon.folderForeground');
        it.description = `${n.pl.tracks?.total ?? '?'} tracks`;
        it.contextValue = 'ruoste.spotify.playlist';
        it.tooltip = new vscode.MarkdownString(
          `**${n.pl.name}**  \n${n.pl.owner?.display_name ? `by ${n.pl.owner.display_name}  \n` : ''}${n.pl.description || ''}`);
        return it;
      }
      case 'track': {
        const t = n.track || {};
        const playing = this.player.summary.uri && this.player.summary.uri === t.uri;
        const it = new vscode.TreeItem(t.name || 'track', S.None);
        it.iconPath = icon(playing ? 'debug-start' : 'music', playing ? 'testing.iconPassed' : undefined);
        it.description = `${artistNames(t)}${t.duration_ms ? ` · ${trackTime(t.duration_ms)}` : ''}`;
        it.contextValue = 'ruoste.spotify.track';
        it.command = { command: 'ruoste.spotify.playTrack', title: 'Play', arguments: [n] };
        it.tooltip = `${t.name}\n${artistNames(t)}\n${t.album?.name || ''}`;
        return it;
      }
      case 'queued': {
        const t = n.track || {};
        const it = new vscode.TreeItem(t.name || 'track', S.None);
        it.iconPath = icon('debug-step-over', 'descriptionForeground');
        it.description = artistNames(t);
        it.contextValue = 'ruoste.spotify.track';
        it.command = { command: 'ruoste.spotify.playTrack', title: 'Play', arguments: [n] };
        return it;
      }
      case 'device': {
        const d = n.device;
        const it = new vscode.TreeItem(d.name, S.None);
        it.iconPath = icon(d.type === 'Smartphone' ? 'device-mobile' : d.type === 'Computer' ? 'device-desktop' : 'broadcast',
          d.is_active ? 'testing.iconPassed' : undefined);
        it.description = d.is_active ? 'active' : d.type;
        it.contextValue = 'ruoste.spotify.device';
        it.command = { command: 'ruoste.spotify.transfer', title: 'Transfer', arguments: [n] };
        return it;
      }
      default: {
        const it = new vscode.TreeItem(n.label || '', S.None);
        it.iconPath = icon(n.icon || 'info', 'descriptionForeground');
        if (n.command) it.command = n.command;
        return it;
      }
    }
  }

  /** @param {Node} [n] @returns {Promise<Node[]>} */
  async getChildren(n) {
    if (!this.auth.signedIn) return [];
    try {
      if (!n) return [
        { kind: 'section', id: 'queue',     label: 'Up Next',      icon: 'list-ordered', expanded: true },
        { kind: 'section', id: 'playlists', label: 'Playlists',    icon: 'library' },
        { kind: 'section', id: 'liked',     label: 'Liked Songs',  icon: 'heart' },
        { kind: 'section', id: 'devices',   label: 'Devices',      icon: 'broadcast' },
      ];

      if (n.kind === 'section') {
        if (n.id === 'queue') {
          const q = this.player.queue;
          return q.length
            ? q.slice(0, 25).map((track) => ({ kind: 'queued', track }))
            : [{ kind: 'message', label: 'Queue is empty', icon: 'circle-outline' }];
        }
        if (n.id === 'playlists') {
          const r = await this.api.playlists(50, 0);
          const items = (r?.items || []).filter(Boolean);
          return items.length ? items.map((pl) => ({ kind: 'playlist', pl }))
                              : [{ kind: 'message', label: 'No playlists', icon: 'circle-outline' }];
        }
        if (n.id === 'liked') {
          const r = await this.api.savedTracks(50, 0);
          return (r?.items || []).map((i) => ({ kind: 'track', track: i.track, context: 'liked' }));
        }
        if (n.id === 'devices') {
          const r = await this.api.devices();
          const list = r?.devices || [];
          return list.length ? list.map((device) => ({ kind: 'device', device }))
                             : [{ kind: 'message', label: 'No devices — open Spotify somewhere', icon: 'circle-slash' }];
        }
      }

      if (n.kind === 'playlist') {
        const id = n.pl.id;
        if (!this._trackCache.has(id)) {
          const r = await this.api.playlistTracks(id, 100, 0);
          this._trackCache.set(id, (r?.items || []).map((i) => i && i.track).filter(Boolean));
        }
        return (this._trackCache.get(id) || [])
          .map((track) => ({ kind: 'track', track, contextUri: n.pl.uri }));
      }
    } catch (err) {
      return [{ kind: 'message', label: err?.message || String(err), icon: 'error' }];
    }
    return [];
  }
}

module.exports = { LibraryProvider };
