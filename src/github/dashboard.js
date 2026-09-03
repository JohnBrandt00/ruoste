// @ts-check
'use strict';
/** The pipelines dashboard: every watched repository in one grid, as an editor
 *  tab so VS Code can move it into its own window. A tree in the sidebar is
 *  fine for drilling in; this is for keeping 40 repos in view at once. */
const vscode = require('vscode');
const { statusPresentation, relativeTime, formatDuration, runElapsed, shortRef } = require('../util');

const nonce = () => Array.from({ length: 32 },
  () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)]).join('');

/** Flatten provider state into something the page can render.
 * @param {any} p @returns {any} */
function snapshot(p) {
  const owners = p.repos.byOwner().map(([owner, repos]) => ({
    owner,
    repos: repos.map((r) => {
      const entry = p.runsByRepo.get(r.key);
      const perRepo = Math.max(1, Number(
        vscode.workspace.getConfiguration('ruoste.actions').get('dashboardRunsPerRepo', 5)));
      const runs = (entry?.runs || []).slice(0, perRepo).map((run) => {
        const pr = statusPresentation(run.status, run.conclusion);
        return {
          id: run.id, name: run.name || run.display_title || 'workflow',
          state: pr.label, live: pr.live,
          branch: shortRef(run.head_branch, 22),
          when: relativeTime(run.run_started_at || run.created_at),
          took: formatDuration(runElapsed(run)),
          number: run.run_number, url: run.html_url,
          actor: run.actor?.login || '', event: run.event || '',
          done: run.status === 'completed',
        };
      });
      return { key: r.key, owner: r.owner, name: r.repo, source: r.source,
               error: entry?.error, runs,
               url: `https://${r.host}/${r.owner}/${r.repo}/actions` };
    }),
  }));
  return {
    signedIn: p.signedIn, loading: p.loading, error: p.error,
    live: p.liveCount, failing: p.failedCount,
    budget: p.client.budget(), owners,
    repoCount: p.repos.repos.length,
  };
}

/** @param {vscode.ExtensionContext} ctx @param {any} provider
 *  @param {{current?: vscode.WebviewPanel}} slot @returns {vscode.WebviewPanel} */
function openPipelinesPanel(ctx, provider, slot) {
  if (slot.current) { slot.current.reveal(undefined, false); return slot.current; }
  const panel = vscode.window.createWebviewPanel(
    'ruoste.actions.dashboard', 'Pipelines',
    { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
    { enableScripts: true, retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, 'media')] });
  panel.iconPath = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'activity-bar.svg');
  const n = nonce();
  const uri = (f) => panel.webview.asWebviewUri(vscode.Uri.joinPath(ctx.extensionUri, 'media', f));
  panel.webview.html = `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none';
  img-src ${panel.webview.cspSource} data:; style-src ${panel.webview.cspSource} 'unsafe-inline';
  script-src 'nonce-${n}'; font-src ${panel.webview.cspSource};">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${uri('pipelines.css')}">
</head><body>
<header>
  <div class="brand">PIPELINES</div>
  <div id="summary"></div>
  <div class="spacer"></div>
  <input id="filter" type="search" placeholder="filter repos…" aria-label="Filter repositories">
  <button id="run" class="btn">RUN WORKFLOW</button>
  <button id="refresh" class="btn ghost" title="Refresh">↻</button>
</header>
<main id="grid"></main>
<footer id="budget"></footer>
<script nonce="${n}" src="${uri('pipelines.js')}"></script>
</body></html>`;

  /** @type {vscode.Disposable[]} */ const subs = [];
  const push = () => { if (panel.visible) void panel.webview.postMessage({ type: 'state', state: snapshot(provider) }); };

  subs.push(panel.webview.onDidReceiveMessage(async (m) => {
    switch (m?.type) {
      case 'ready':   push(); break;
      case 'refresh': await provider.refresh(false); break;
      case 'run':     await vscode.commands.executeCommand('ruoste.actions.runWorkflow'); break;
      case 'open':    if (m.url) await vscode.env.openExternal(vscode.Uri.parse(String(m.url))); break;
      case 'rerun':
      case 'cancel': {
        const repo = provider.repos.repos.find((r) => r.key === m.key);
        const entry = provider.runsByRepo.get(m.key);
        const run = (entry?.runs || []).find((x) => x.id === m.id);
        if (repo && run) await vscode.commands.executeCommand(`ruoste.actions.${m.type}`, { run, repo });
        break;
      }
    }
  }));

  const prev = provider.onDidRefresh;
  provider.onDidRefresh = (p) => { prev?.(p); push(); };
  subs.push(new vscode.Disposable(() => { provider.onDidRefresh = prev; }));

  // keep the elapsed times honest between polls
  const tick = setInterval(() => { if (panel.visible && provider.liveCount) push(); }, 1000);
  subs.push(new vscode.Disposable(() => clearInterval(tick)));

  panel.onDidChangeViewState(() => push());
  panel.onDidDispose(() => { subs.forEach((d) => d.dispose()); slot.current = undefined; });
  slot.current = panel;
  push();
  return panel;
}

module.exports = { openPipelinesPanel, snapshot };
