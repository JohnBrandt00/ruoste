// @ts-check
'use strict';
const vscode = require('vscode');
const { statusPresentation, issuePresentation, shortRef, relativeTime, formatDuration, runElapsed } = require('../util');

/** Status bar summary across every watched repository. */
class ActionsStatus {
  constructor() {
    this.item = vscode.window.createStatusBarItem('ruoste.actions', vscode.StatusBarAlignment.Left, 90);
    this.item.name = 'RUOSTE Actions';
    this.item.command = 'ruoste.actions.focus';
    this.item.hide();
    /** @type {NodeJS.Timeout|undefined} */ this._tick = undefined;
    /** @type {any} */ this._provider = undefined;
  }

  /** While something is running, retick every second so the elapsed time moves
   *  between polls instead of freezing at whatever the last fetch said. */
  _retick() {
    if (this._tick) { clearInterval(this._tick); this._tick = undefined; }
    if (!this._provider || !this._provider.liveCount) return;
    this._tick = setInterval(() => {
      if (!this._provider || !this._provider.liveCount) { this._retick(); return; }
      const live = this._provider.liveRuns();
      const oldest = live.reduce((a, b) =>
        (runElapsed(a.run) > runElapsed(b.run) ? a : b), live[0]);
      const el = oldest ? formatDuration(runElapsed(oldest.run)) : '';
      this.item.text = `$(sync~spin) ${live.length} running${el ? ` · ${el}` : ''}`;
    }, 1000);
  }

  /** @param {any} p the ActionsProvider */
  update(p) {
    const cfg = vscode.workspace.getConfiguration('ruoste.actions');
    this._provider = p;
    if (!cfg.get('statusBar', true) || !p || !p.signedIn) { this.item.hide(); this._retick(); return; }

    const watched = p.repos.repos.length;
    if (!watched) { this.item.hide(); return; }

    const live = p.liveCount;
    const failing = p.failedCount;
    const newest = p.allRuns()[0];

    if (live) {
      const oldest = p.liveRuns()[0];
      const el = oldest ? formatDuration(runElapsed(oldest.run)) : '';
      this.item.text = `$(sync~spin) ${live} running${el ? ` · ${el}` : ''}`;
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
    this._retick();
  }

  dispose() { if (this._tick) clearInterval(this._tick); this.item.dispose(); }
}

/** Status bar summary for issues and pull requests. Separate from the runs
 *  item: a red build and a review request are different kinds of urgent, and
 *  one number hides both. */
class WorkStatus {
  constructor() {
    this.item = vscode.window.createStatusBarItem('ruoste.work', vscode.StatusBarAlignment.Left, 89);
    this.item.name = 'RUOSTE Issues & PRs';
    this.item.command = 'ruoste.work.focus';
    this.item.hide();
  }

  /** @param {any} p the WorkProvider */
  update(p) {
    const cfg = vscode.workspace.getConfiguration('ruoste.work');
    if (!cfg.get('statusBar', true) || !p || !p.signedIn) { this.item.hide(); return; }

    const review = p.reviewCount, assigned = p.assignedCount;
    if (!review && !assigned) { this.item.hide(); return; }

    this.item.text = [
      review ? `$(git-pull-request) ${review}` : '',
      assigned ? `$(issues) ${assigned}` : '',
    ].filter(Boolean).join(' ');

    const lines = [];
    if (review) lines.push(`**${review}** waiting on your review`);
    if (assigned) lines.push(`**${assigned}** assigned to you`);
    lines.push('');
    for (const { item, repo } of [...p.rows('review'), ...p.rows('assigned')].slice(0, 6)) {
      const pr = issuePresentation(item);
      lines.push(`\`${pr.label}\` ${repo.owner}/${repo.repo}#${item.number} · ${item.title}`);
    }
    this.item.tooltip = new vscode.MarkdownString(lines.join('  \n'));
    this.item.show();
  }

  dispose() { this.item.dispose(); }
}

module.exports = { ActionsStatus, WorkStatus };
