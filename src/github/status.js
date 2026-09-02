// @ts-check
'use strict';
const vscode = require('vscode');
const { statusPresentation, shortRef, relativeTime } = require('../util');

/** Status-bar summary of the most recent run. */
class ActionsStatus {
  constructor() {
    this.item = vscode.window.createStatusBarItem('ruoste.actions', vscode.StatusBarAlignment.Left, 90);
    this.item.name = 'RUOSTE Actions';
    this.item.command = 'ruoste.actions.focus';
    this.item.hide();
  }

  /** @param {{runs:any[], repo:any, signedIn:boolean}} state */
  update(state) {
    const cfg = vscode.workspace.getConfiguration('ruoste.actions');
    if (!cfg.get('statusBar', true) || !state.repo || !state.signedIn || !state.runs.length) {
      this.item.hide();
      return;
    }
    const run = state.runs[0];
    const p = statusPresentation(run.status, run.conclusion);
    this.item.text = `$(${p.icon.replace('~spin', '~spin')}) ${shortRef(run.head_branch, 16)}`;
    this.item.tooltip = new vscode.MarkdownString(
      `**${run.display_title || run.name}**  \n\`${p.label}\` · ${relativeTime(run.run_started_at || run.created_at)}`);
    this.item.backgroundColor = p.label === 'failed'
      ? new vscode.ThemeColor('statusBarItem.errorBackground')
      : undefined;
    this.item.show();
  }

  dispose() { this.item.dispose(); }
}

module.exports = { ActionsStatus };
