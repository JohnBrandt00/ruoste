// @ts-check
'use strict';
/** Notifies when a run crosses into a terminal state.
 *
 *  GitHub has no push channel for Actions that a desktop client can subscribe
 *  to — webhooks need a public endpoint — so transitions are detected by diffing
 *  successive polls. The first sync after start-up seeds the baseline silently,
 *  otherwise connecting with 40 repos would fire 40 notifications at once. */
const vscode = require('vscode');
const { formatDuration, runElapsed, shortRef } = require('../util');

/** @typedef {{status:string, conclusion:string|null}} Seen */

class RunNotifier {
  constructor() {
    /** @type {Map<number, Seen>} */ this.seen = new Map();
    this.seeded = false;
  }

  get cfg() { return vscode.workspace.getConfiguration('ruoste.actions'); }
  /** @returns {string} */ get policy() { return String(this.cfg.get('notifications', 'failures')); }

  /** @param {any} run @param {'started'|'finished'} event @returns {boolean} */
  wants(run, event) {
    const p = this.policy;
    if (p === 'off') return false;
    if (event === 'started') return Boolean(this.cfg.get('notifyOnStart', false));
    if (p === 'failures') return run.conclusion !== 'success' && run.conclusion !== 'skipped';
    if (p === 'completions') return true;
    return true;                            // 'all'
  }

  /** Diff a fresh set of runs against what we last saw.
   * @param {{run:any, repo:any}[]} current
   * @returns {{run:any, repo:any, event:'started'|'finished'}[]} */
  diff(current) {
    /** @type {{run:any, repo:any, event:'started'|'finished'}[]} */
    const events = [];
    for (const { run, repo } of current) {
      const prev = this.seen.get(run.id);
      const now = { status: run.status, conclusion: run.conclusion ?? null };
      this.seen.set(run.id, now);
      if (!this.seeded) continue;                       // baseline pass is silent
      if (!prev) {
        if (now.status !== 'completed') events.push({ run, repo, event: 'started' });
        continue;
      }
      if (prev.status !== 'completed' && now.status === 'completed')
        events.push({ run, repo, event: 'finished' });
    }
    // keep the map from growing without bound across a long session
    if (this.seen.size > 2000) {
      const keep = new Set(current.map((c) => c.run.id));
      for (const id of this.seen.keys()) if (!keep.has(id)) this.seen.delete(id);
    }
    this.seeded = true;
    return events;
  }

  /** @param {{run:any, repo:any, event:'started'|'finished'}[]} events
   *  @param {(action:string, run:any, repo:any) => void} onAction */
  show(events, onAction) {
    const fire = events.filter((e) => this.wants(e.run, e.event));
    if (!fire.length) return;

    // a burst is one summary, not fifteen toasts
    if (fire.length > 3) {
      const bad = fire.filter((e) => e.event === 'finished' && e.run.conclusion !== 'success').length;
      const msg = `RUOSTE · ${fire.length} workflow runs updated${bad ? `, ${bad} failed` : ''}`;
      (bad ? vscode.window.showWarningMessage : vscode.window.showInformationMessage)(msg, 'Show Actions')
        .then((p) => { if (p) onAction('focus', null, null); });
      return;
    }

    for (const { run, repo, event } of fire) {
      const where = `${repo.owner}/${repo.repo}`;
      const branch = shortRef(run.head_branch, 20);
      if (event === 'started') {
        vscode.window.showInformationMessage(
          `▶ ${run.name} started · ${where} · ${branch}`, 'Open Run')
          .then((p) => { if (p === 'Open Run') onAction('open', run, repo); });
        continue;
      }
      const took = formatDuration(runElapsed(run));
      const ok = run.conclusion === 'success';
      const text = `${ok ? '✓' : '✗'} ${run.name} ${ok ? 'passed' : run.conclusion || 'finished'}` +
                   ` · ${where} · ${branch} · ${took}`;
      const buttons = ok ? ['Open Run'] : ['Open Run', 'Re-run'];
      (ok ? vscode.window.showInformationMessage : vscode.window.showErrorMessage)(text, ...buttons)
        .then((p) => {
          if (p === 'Open Run') onAction('open', run, repo);
          else if (p === 'Re-run') onAction('rerun', run, repo);
        });
    }
  }
}

module.exports = { RunNotifier };
