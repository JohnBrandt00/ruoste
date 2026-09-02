// @ts-check
'use strict';
const vscode = require('vscode');
const fonts = require('./fonts');
const api = require('./github/api');
const { ActionsProvider } = require('./github/tree');
const { ActionsStatus } = require('./github/status');
const { watchRepository } = require('./github/repo');
const { activateSpotify } = require('./spotify');

/** @param {vscode.ExtensionContext} ctx */
function activate(ctx) {
  // ── fonts ──────────────────────────────────────────────────────────────
  ctx.subscriptions.push(
    vscode.commands.registerCommand('ruoste.installFont', () => fonts.installFontCommand(ctx)),
    vscode.commands.registerCommand('ruoste.useFontSetting', () => fonts.reconcileFontSetting()),
  );
  void fonts.maybeOfferInstall(ctx);

  // ── github actions ─────────────────────────────────────────────────────
  const provider = new ActionsProvider(ctx);
  const status = new ActionsStatus();
  const view = vscode.window.createTreeView('ruoste.actions', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  ctx.subscriptions.push(view, provider, status);

  const sync = () => {
    status.update({ runs: provider.runs, repo: provider.repo, signedIn: provider.signedIn });
    void vscode.commands.executeCommand('setContext', 'ruoste.actions.signedIn', provider.signedIn);
    void vscode.commands.executeCommand('setContext', 'ruoste.actions.hasRepo', !!provider.repo);
    view.description = provider.repo ? `${provider.repo.owner}/${provider.repo.repo}` : undefined;
  };
  provider.onDidRefresh = sync;

  /** @param {string} id @param {(...a:any[]) => any} fn */
  const cmd = (id, fn) => ctx.subscriptions.push(vscode.commands.registerCommand(id, fn));

  cmd('ruoste.actions.refresh', () => provider.refresh(false));
  cmd('ruoste.actions.signIn', () => provider.refresh(true));
  cmd('ruoste.actions.focus', () => view.reveal(undefined, { focus: true }).then(undefined, () =>
    vscode.commands.executeCommand('workbench.view.extension.ruoste')));

  cmd('ruoste.actions.open', (node) => {
    const url = node?.run?.html_url || node?.job?.html_url;
    if (url) return vscode.env.openExternal(vscode.Uri.parse(url));
    if (provider.repo) return vscode.env.openExternal(vscode.Uri.parse(
      `https://${provider.repo.host}/${provider.repo.owner}/${provider.repo.repo}/actions`));
  });

  cmd('ruoste.actions.copyUrl', async (node) => {
    const url = node?.run?.html_url || node?.job?.html_url;
    if (url) { await vscode.env.clipboard.writeText(url); vscode.window.setStatusBarMessage('Run URL copied', 2000); }
  });

  /** @param {'rerun'|'cancel'} which @param {any} node */
  const act = async (which, node) => {
    const run = node?.run;
    if (!run || !provider.repo) return;
    const session = await api.getSession(true);
    if (!session) return;
    try {
      await api[which](provider.repo, run.id, session.accessToken);
      vscode.window.setStatusBarMessage(
        which === 'rerun' ? `Re-running #${run.run_number}` : `Cancelling #${run.run_number}`, 3000);
      setTimeout(() => void provider.refresh(false), 1500);
    } catch (err) {
      vscode.window.showErrorMessage(`RUOSTE: ${err && err.message ? err.message : err}`);
    }
  };
  cmd('ruoste.actions.rerun', (node) => act('rerun', node));
  cmd('ruoste.actions.cancel', (node) => act('cancel', node));

  ctx.subscriptions.push(
    watchRepository(() => void provider.refresh(false)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('ruoste.actions')) void provider.refresh(false);
    }),
    vscode.authentication.onDidChangeSessions((e) => {
      if (e.provider.id === 'github') void provider.refresh(false);
    }),
    view.onDidChangeVisibility((e) => { if (e.visible) void provider.refresh(false); }),
  );

  void provider.refresh(false);

  // ── spotify ────────────────────────────────────────────────────────────
  activateSpotify(ctx);
}

function deactivate() { /* subscriptions handle teardown */ }

module.exports = { activate, deactivate };
