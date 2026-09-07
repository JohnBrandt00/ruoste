// @ts-check
'use strict';
/** Notifies when something new lands in a section — a review request arriving,
 *  an issue being assigned to you.
 *
 *  Like the runs notifier, this diffs successive polls: GitHub's notifications
 *  API needs its own poll and returns threads rather than items, and there is
 *  no push channel a desktop client can subscribe to. The first pass seeds the
 *  baseline silently, otherwise signing in would announce every open item at
 *  once. */
const vscode = require('vscode');

/** @typedef {{id:string, label:string, rows:{item:any, repo:any}[]}} SectionState */

class WorkNotifier {
  constructor() {
    /** @type {Map<string, Set<number>>} section id -> item ids seen there */
    this.seen = new Map();
    this.seeded = false;
  }

  get cfg() { return vscode.workspace.getConfiguration('ruoste.work'); }
  /** @returns {string} */ get policy() { return String(this.cfg.get('notifications', 'review-requested')); }

  /** @param {string} sectionId @returns {boolean} */
  wants(sectionId) {
    const p = this.policy;
    if (p === 'off') return false;
    if (p === 'all') return true;
    if (p === 'assigned') return sectionId === 'assigned' || sectionId === 'review';
    return sectionId === 'review';
  }

  /** @param {SectionState[]} sections
   *  @returns {{item:any, repo:any, sectionId:string, sectionLabel:string}[]} */
  diff(sections) {
    /** @type {{item:any, repo:any, sectionId:string, sectionLabel:string}[]} */ const events = [];
    for (const s of sections) {
      const before = this.seen.get(s.id);
      const now = new Set(s.rows.map((r) => Number(r.item.id)));
      this.seen.set(s.id, now);
      if (!this.seeded || !before) continue;
      for (const { item, repo } of s.rows)
        if (!before.has(Number(item.id)))
          events.push({ item, repo, sectionId: s.id, sectionLabel: s.label });
    }
    this.seeded = true;
    return events;
  }

  /** @param {{item:any, repo:any, sectionId:string, sectionLabel:string}[]} events
   *  @param {(action:string, item:any, repo:any) => void} onAction */
  show(events, onAction) {
    const fire = events.filter((e) => this.wants(e.sectionId));
    if (!fire.length) return;

    // a burst is one summary, not fifteen toasts
    if (fire.length > 3) {
      vscode.window.showInformationMessage(
        `RUOSTE · ${fire.length} new items across ${new Set(fire.map((e) => e.sectionId)).size} sections`,
        'Show Issues & PRs')
        .then((p) => { if (p) onAction('focus', null, null); });
      return;
    }

    for (const { item, repo, sectionId, sectionLabel } of fire) {
      const verb = sectionId === 'review' ? 'wants your review'
        : sectionId === 'assigned' ? 'was assigned to you' : `is new in ${sectionLabel}`;
      vscode.window.showInformationMessage(
        `${repo.owner}/${repo.repo}#${item.number} ${verb} · ${item.title}`, 'Open', 'View on GitHub')
        .then((p) => {
          if (p === 'Open') onAction('view', item, repo);
          else if (p === 'View on GitHub') onAction('browser', item, repo);
        });
    }
  }
}

module.exports = { WorkNotifier };
