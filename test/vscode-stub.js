// @ts-nocheck
'use strict';
/** Minimal stand-in for the `vscode` module so extension logic can be unit
 *  tested outside the extension host. Only the surface our modules touch. */
class EventEmitter {
  constructor() { this._h = []; this.event = (fn) => { this._h.push(fn); return { dispose: () => {} }; }; }
  fire(v) { for (const h of this._h) h(v); }
  dispose() { this._h = []; }
}
class Disposable { constructor(fn) { this._fn = fn; } dispose() { this._fn && this._fn(); } }
class ThemeIcon { constructor(id, color) { this.id = id; this.color = color; } }
class ThemeColor { constructor(id) { this.id = id; } }
class TreeItem { constructor(label, state) { this.label = label; this.collapsibleState = state; } }
class MarkdownString { constructor(v) { this.value = v || ''; } }
class StatusBarItem { show() {} hide() {} dispose() {} }

const noop = () => {};
const cfgStore = new Map();

module.exports = {
  EventEmitter, Disposable, ThemeIcon, ThemeColor, TreeItem, MarkdownString,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  ProgressLocation: { Notification: 15 },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  QuickPickItemKind: { Separator: -1, Default: 0 },
  Uri: {
    parse: (s) => ({ toString: () => s, query: (s.split('?')[1] || '') }),
    file: (s) => ({ fsPath: s, toString: () => `file://${s}` }),
    joinPath: (base, ...p) => ({ fsPath: [base.fsPath, ...p].join('/') }),
  },
  env: {
    uriScheme: 'vscode', clipboard: { readText: async () => '', writeText: async () => {} },
    openExternal: async () => true, asExternalUri: async (u) => u,
  },
  window: {
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    showInputBox: async () => undefined,
    showQuickPick: async () => undefined,
    createQuickPick: () => ({ onDidChangeValue: noop, onDidTriggerItemButton: noop,
      onDidAccept: noop, onDidHide: noop, show: noop, hide: noop, dispose: noop, items: [] }),
    createStatusBarItem: () => new StatusBarItem(),
    createTreeView: () => ({ dispose: noop }),
    registerWebviewViewProvider: () => ({ dispose: noop }),
    registerUriHandler: () => ({ dispose: noop }),
    setStatusBarMessage: noop,
    withProgress: async (_o, fn) => fn({ report: noop }, { onCancellationRequested: noop }),
  },
  workspace: {
    getConfiguration: (section) => ({
      get: (k, d) => (cfgStore.has(`${section}.${k}`) ? cfgStore.get(`${section}.${k}`) : d),
      update: async (k, v) => cfgStore.set(`${section}.${k}`, v),
      inspect: () => undefined,
    }),
    onDidChangeConfiguration: () => ({ dispose: noop }),
    onDidChangeWorkspaceFolders: () => ({ dispose: noop }),
    workspaceFolders: [],
  },
  commands: { registerCommand: () => ({ dispose: noop }), executeCommand: async () => undefined },
  extensions: { getExtension: () => undefined },
  authentication: { getSession: async () => undefined, onDidChangeSessions: () => ({ dispose: noop }) },
};
