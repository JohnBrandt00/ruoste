// @ts-check
'use strict';
const vscode = require('vscode');
const api = require('./api');
const { ActionsProvider } = require('./tree');
const { ActionsStatus } = require('./status');
const { watchWorkspace } = require('./repos');

/** @param {vscode.ExtensionContext} ctx */
function activateActions(ctx) {
  const provider = new ActionsProvider(ctx);
  const status = new ActionsStatus();
  const view = vscode.window.createTreeView('ruoste.actions', {
    treeDataProvider: provider, showCollapseAll: true,
  });
  ctx.subscriptions.push(view, provider, status);

  const sync = () => {
    status.update(provider);
    void vscode.commands.executeCommand('setContext', 'ruoste.actions.signedIn', provider.signedIn);
    void vscode.commands.executeCommand('setContext', 'ruoste.actions.hasRepo', provider.repos.repos.length > 0);
    const n = provider.repos.repos.length;
    view.description = n ? `${n} ${n === 1 ? 'repo' : 'repos'}` : undefined;
    const budget = provider.client.budget();
    view.title = budget ? `GitHub Actions — ${budget}` : 'GitHub Actions';
  };
  provider.onDidRefresh = sync;

  // GitHub has no push channel for Actions, so transitions are detected by
  // diffing polls; the first sync seeds silently.
  provider.onTransitions = (events) => {
    provider.notifier.show(events, (action, run, repo) => {
      if (action === 'focus') return void vscode.commands.executeCommand('ruoste.actions.focus');
      if (action === 'open' && run?.html_url)
        return void vscode.env.openExternal(vscode.Uri.parse(run.html_url));
      if (action === 'rerun') return void act('rerun', { run, repo });
    });
  };

  /** @param {string} id @param {(...a:any[]) => any} fn */
  const cmd = (id, fn) => ctx.subscriptions.push(vscode.commands.registerCommand(id, fn));

  cmd('ruoste.actions.refresh', () => provider.refresh(false));
  cmd('ruoste.actions.rediscover', () => provider.refresh(false, true));
  cmd('ruoste.actions.signIn', () => provider.refresh(true));
  cmd('ruoste.actions.focus', () => view.reveal(undefined, { focus: true }).then(undefined, () =>
    vscode.commands.executeCommand('workbench.view.extension.ruoste')));

  cmd('ruoste.actions.pickScope', async () => {
    const current = String(provider.cfg.get('scope', 'affiliated'));
    const pick = await vscode.window.showQuickPick([
      { label: 'Affiliated', value: 'affiliated', description: 'every repo you own, collaborate on, or reach through an org', picked: current === 'affiliated' },
      { label: 'Workspace', value: 'workspace', description: 'only repos open in this window', picked: current === 'workspace' },
      { label: 'Watch list', value: 'watchlist', description: 'only repos matching ruoste.actions.repositories', picked: current === 'watchlist' },
    ], { title: 'Which repositories should the Actions view watch?' });
    if (!pick) return;
    await provider.cfg.update('scope', pick.value, vscode.ConfigurationTarget.Global);
    await provider.refresh(false, true);
  });

  cmd('ruoste.actions.filter', async () => {
    const all = provider.repos.repos;
    if (!all.length) { vscode.window.showInformationMessage('No repositories discovered yet.'); return; }
    const pick = await vscode.window.showQuickPick(
      all.map((r) => ({ label: `${r.owner}/${r.repo}`, description: r.source, repo: r })),
      { title: 'Go to repository', matchOnDescription: true });
    if (pick) await view.reveal(/** @type {any} */ ({ kind: 'repo', repo: pick.repo }),
      { select: true, focus: true, expand: true }).then(undefined, () => undefined);
  });

  cmd('ruoste.actions.watchRepo', async (node) => {
    const r = node?.repo || node?.repos?.[0];
    const value = await vscode.window.showInputBox({
      title: 'Watch repository', value: r ? `${r.owner}/${r.repo}` : '',
      prompt: 'owner/repo — wildcards allowed, e.g. my-org/*',
      validateInput: (v) => /^[\w.-]+\/[\w.*-]+$/.test(v.trim()) ? undefined : 'Use owner/repo',
    });
    if (!value) return;
    const list = (provider.cfg.get('repositories', []) || []).slice();
    if (!list.includes(value.trim())) list.push(value.trim());
    await provider.cfg.update('repositories', list, vscode.ConfigurationTarget.Global);
    await provider.refresh(false, true);
  });

  cmd('ruoste.actions.unwatchRepo', async (node) => {
    const r = node?.repo;
    if (!r) return;
    const list = (provider.cfg.get('exclude', []) || []).slice();
    const pat = `${r.owner}/${r.repo}`;
    if (!list.includes(pat)) list.push(pat);
    await provider.cfg.update('exclude', list, vscode.ConfigurationTarget.Global);
    await provider.refresh(false, true);
  });

  cmd('ruoste.actions.open', (node) => {
    const url = node?.run?.html_url || node?.job?.html_url;
    if (url) return vscode.env.openExternal(vscode.Uri.parse(url));
    const r = node?.repo || provider.repos.repos[0];
    if (r) return vscode.env.openExternal(vscode.Uri.parse(`https://${r.host}/${r.owner}/${r.repo}/actions`));
  });

  cmd('ruoste.actions.copyUrl', async (node) => {
    const url = node?.run?.html_url || node?.job?.html_url;
    if (url) { await vscode.env.clipboard.writeText(url); vscode.window.setStatusBarMessage('Run URL copied', 2000); }
  });

  /** @param {'rerun'|'cancel'} which @param {any} node */
  async function act(which, node) {
    const run = node?.run, repo = node?.repo;
    if (!run || !repo) return;
    const session = await api.getSession(true);
    if (!session) return;
    try {
      await provider.client[which](repo, run.id, session.accessToken);
      vscode.window.setStatusBarMessage(
        which === 'rerun' ? `Re-running #${run.run_number}` : `Cancelling #${run.run_number}`, 3000);
      setTimeout(() => void provider.refresh(false), 1500);
    } catch (err) {
      vscode.window.showErrorMessage(`RUOSTE: ${err && err.message ? err.message : err}`);
    }
  }
  cmd('ruoste.actions.rerun', (node) => act('rerun', node));
  cmd('ruoste.actions.cancel', (node) => act('cancel', node));

  ctx.subscriptions.push(
    watchWorkspace(() => void provider.refresh(false, true)),
    view.onDidExpandElement((e) => {
      const el = /** @type {any} */ (e.element);
      if (el && el.kind === 'repo') { provider.expanded.add(el.repo.key); void provider.fetchRepo(el.repo); }
    }),
    view.onDidCollapseElement((e) => {
      const el = /** @type {any} */ (e.element);
      if (el && el.kind === 'repo') provider.expanded.delete(el.repo.key);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('ruoste.actions')) void provider.refresh(false, true);
    }),
    vscode.authentication.onDidChangeSessions((e) => {
      if (e.provider.id === 'github') void provider.refresh(false, true);
    }),
    view.onDidChangeVisibility((e) => { if (e.visible) void provider.refresh(false); }),
  );

  void provider.refresh(false);
  return provider;
}

module.exports = { activateActions };
