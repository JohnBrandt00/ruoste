// @ts-check
'use strict';
const vscode = require('vscode');
const { statusPresentation, shortRef, relativeTime } = require('../util');

/** Status bar summary across every watched repository. */
class ActionsStatus {
  constructor() {
    this.item = vscode.window.createStatusBarItem('ruoste.actions', vscode.StatusBarAlignment.Left, 90);
    this.item.name = 'RUOSTE Actions';
    this.item.command = 'ruoste.actions.focus';
    this.item.hide();
  }

  /** @param {any} p the ActionsProvider */
  update(p) {
    const cfg = vscode.workspace.getConfiguration('ruoste.actions');
    if (!cfg.get('statusBar', true) || !p || !p.signedIn) { this.item.hide(); return; }

    const watched = p.repos.repos.length;
    if (!watched) { this.item.hide(); return; }

    const live = p.liveCount;
    const failing = p.failedCount;
    const newest = p.allRuns()[0];

    if (live) {
      this.item.text = `$(sync~spin) ${live} running`;
      this.item.backgroundColor = undefined;
    } else if (failing) {
      this.item.text = `$(error) ${failing} failing`;
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (newest) {
      const pr = statusPresentation(newest.run.status, newest.run.conclusion);
      this.item.text = `$(${pr.icon}) ${shortRef(newest.run.head_branch, 14)}`;
      this.item.backgroundColor = undefined;
    } else {
      this.item.text = '$(circle-outline) actions';
      this.item.backgroundColor = undefined;
    }

    const lines = [`**GitHub Actions** — ${watched} ${watched === 1 ? 'repository' : 'repositories'} watched`, ''];
    for (const { run, key } of p.allRuns().slice(0, 6)) {
      const pr = statusPresentation(run.status, run.conclusion);
      const [, owner, repo] = key.split('/');
      lines.push(`\`${pr.label}\` ${owner}/${repo} · ${run.name} · ${relativeTime(run.run_started_at || run.created_at)}`);
    }
    const budget = p.client.budget();
    if (budget) lines.push('', `_rate limit ${budget}_`);
    this.item.tooltip = new vscode.MarkdownString(lines.join('  \n'));
    this.item.show();
  }

  dispose() { this.item.dispose(); }
}

module.exports = { ActionsStatus };
