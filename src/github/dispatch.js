// @ts-check
'use strict';
/** Start a new run. GitHub only lets an app trigger workflows that declare a
 *  `workflow_dispatch` trigger; the API does not say which those are, so an
 *  attempt that comes back 422 is reported as exactly that rather than as a
 *  generic failure. */
const vscode = require('vscode');
const api = require('./api');

/** @param {any} provider @param {any} [seedRepo] @returns {Promise<void>} */
async function runWorkflow(provider, seedRepo) {
  const session = await api.getSession(true);
  if (!session) return;
  const token = session.accessToken;

  let repo = seedRepo;
  if (!repo) {
    const all = provider.repos.repos;
    if (!all.length) { vscode.window.showInformationMessage('No repositories discovered yet.'); return; }
    const pick = /** @type {any} */ (await vscode.window.showQuickPick(
      all.map((r) => ({ label: `${r.owner}/${r.repo}`, description: r.source, repo: r })),
      { title: 'Run a workflow in…', matchOnDescription: true }));
    if (!pick) return;
    repo = pick.repo;
  }

  /** @type {any[]} */ let workflows = [];
  try {
    workflows = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'RUOSTE: reading workflows…' },
      () => provider.client.listWorkflows(repo, token));
  } catch (err) {
    vscode.window.showErrorMessage(`RUOSTE: could not list workflows — ${err?.message || err}`);
    return;
  }
  const active = workflows.filter((w) => w && w.state === 'active');
  if (!active.length) { vscode.window.showInformationMessage(`${repo.owner}/${repo.repo} has no active workflows.`); return; }

  const wf = /** @type {any} */ (await vscode.window.showQuickPick(
    active.map((w) => ({ label: w.name, description: (w.path || '').replace('.github/workflows/', ''), w })),
    { title: `Workflow to run in ${repo.owner}/${repo.repo}` }));
  if (!wf) return;

  // default to the checked-out branch when we have one
  let ref = repo.branch;
  const REFRESH = '$(git-branch) Choose a different branch…';
  if (ref) {
    const useIt = await vscode.window.showQuickPick(
      [{ label: ref, description: 'current branch' }, { label: REFRESH }],
      { title: 'Run on which ref?' });
    if (!useIt) return;
    if (useIt.label === REFRESH) ref = undefined;
  }
  if (!ref) {
    /** @type {any[]} */ let branches = [];
    try { branches = await provider.client.listBranches(repo, token); } catch { /* fall back to typing */ }
    if (branches.length) {
      const b = await vscode.window.showQuickPick(branches.map((x) => x.name), { title: 'Branch or tag' });
      if (!b) return;
      ref = b;
    } else {
      ref = await vscode.window.showInputBox({ title: 'Branch or tag to run on', value: 'main' });
      if (!ref) return;
    }
  }

  // workflow_dispatch inputs are declared in the yaml, which the API will not
  // hand us — offer a free-form key=value line rather than pretending otherwise
  /** @type {Record<string,string>} */ const inputs = {};
  const raw = await vscode.window.showInputBox({
    title: `Inputs for ${wf.label} (optional)`,
    prompt: 'key=value, comma separated. Leave blank for none.',
    placeHolder: 'environment=staging, dry_run=true',
  });
  if (raw === undefined) return;
  for (const pair of raw.split(',')) {
    const i = pair.indexOf('=');
    if (i > 0) inputs[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }

  try {
    await provider.client.dispatch(repo, wf.w.id, ref, inputs, token);
    vscode.window.showInformationMessage(
      `Dispatched ${wf.label} on ${ref} in ${repo.owner}/${repo.repo}`);
    // the run takes a moment to appear
    setTimeout(() => void provider.refresh(false), 2500);
    setTimeout(() => void provider.refresh(false), 7000);
  } catch (err) {
    if (err?.status === 422) {
      vscode.window.showWarningMessage(
        `"${wf.label}" cannot be started from here — a workflow must declare a ` +
        `\`workflow_dispatch\` trigger to be dispatchable, and this one does not.`);
      return;
    }
    if (err?.kind === 'forbidden' || err?.status === 403) {
      vscode.window.showWarningMessage(
        `Not permitted to dispatch in ${repo.owner}/${repo.repo}. This needs write access, ` +
        `and org repos may also require SAML SSO authorisation for your token.`);
      return;
    }
    vscode.window.showErrorMessage(`RUOSTE: dispatch failed — ${err?.message || err}`);
  }
}

/** @param {any} provider @param {any} node @returns {Promise<void>} */
async function rerunFailed(provider, node) {
  const run = node?.run, repo = node?.repo;
  if (!run || !repo) return;
  const session = await api.getSession(true);
  if (!session) return;
  try {
    await provider.client.rerunFailed(repo, run.id, session.accessToken);
    vscode.window.setStatusBarMessage(`Re-running failed jobs in #${run.run_number}`, 3000);
    setTimeout(() => void provider.refresh(false), 1500);
  } catch (err) {
    vscode.window.showErrorMessage(
      err?.status === 403
        ? `Not permitted to re-run in ${repo.owner}/${repo.repo}.`
        : `RUOSTE: ${err?.message || err}`);
  }
}

module.exports = { runWorkflow, rerunFailed };
