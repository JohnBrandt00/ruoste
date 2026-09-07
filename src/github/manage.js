// @ts-check
'use strict';
/** Changing an issue or pull request from inside the editor: comment, close,
 *  assign, label, request review, merge, or check the branch out.
 *
 *  Every mutation goes through one shape — get a session, call, report, refresh
 *  — so a 403 from an org that wants SAML SSO reads the same wherever you hit
 *  it. GitHub answers a write with the updated object, so a refresh here is
 *  about the other views, not about learning what happened. */
const vscode = require('vscode');
const api = require('./api');
const { gitApi } = require('./repos');

/** @param {any} err @param {{owner:string, repo:string}} repo @returns {string} */
function explain(err, repo) {
  const where = `${repo.owner}/${repo.repo}`;
  if (err?.kind === 'sso')
    return `${where} belongs to an organisation that wants SAML SSO authorisation for your GitHub token.`;
  if (err?.status === 403 || err?.kind === 'forbidden')
    return `Not permitted in ${where} — this needs write access to the repository.`;
  if (err?.status === 404)
    return `${where} did not accept that — the item may have moved, or your token cannot see it.`;
  return `RUOSTE: ${err?.message || err}`;
}

/** Every command here is handed a tree node, a webview target, or nothing.
 * @param {any} node @returns {{repo:any, item:any, number:number}|null} */
function targetOf(node) {
  const repo = node?.repo, item = node?.item;
  const number = Number(item?.number ?? node?.number);
  if (!repo || !Number.isFinite(number)) return null;
  return { repo, item, number };
}

/** @param {any} provider @param {any} node @param {(t:{repo:any,item:any,number:number}, token:string)=>Promise<any>} fn
 *  @param {string} [done] @returns {Promise<any>} */
async function withTarget(provider, node, fn, done) {
  const t = targetOf(node);
  if (!t) { vscode.window.showInformationMessage('RUOSTE: no issue or pull request selected.'); return; }
  const session = await api.getSession(true);
  if (!session) return;
  try {
    const result = await fn(t, session.accessToken);
    if (done) vscode.window.setStatusBarMessage(done, 3000);
    void provider.refresh(false);
    provider.onDidMutate?.(t.repo, t.number);
    return result;
  } catch (err) {
    vscode.window.showErrorMessage(explain(err, t.repo));
    return undefined;
  }
}

/** @param {any} provider @param {any} node @param {string} [body] @returns {Promise<void>} */
async function comment(provider, node, body) {
  const text = body ?? await vscode.window.showInputBox({
    title: `Comment on #${node?.item?.number ?? node?.number}`,
    prompt: 'Markdown. Enter posts it.',
    placeHolder: 'Looks good — one thought on the retry loop…',
  });
  if (!text || !text.trim()) return;
  await withTarget(provider, node,
    (t, token) => provider.client.addComment(t.repo, t.number, text, token), 'Comment posted');
}

/** @param {any} provider @param {any} node @param {'closed'|'open'} state @returns {Promise<void>} */
async function setState(provider, node, state) {
  const n = node?.item?.number ?? node?.number;
  /** @type {Record<string, any>} */ const patch = { state };
  if (state === 'closed' && !node?.item?.pull_request) {
    const why = await vscode.window.showQuickPick(
      [{ label: 'Completed', value: 'completed' }, { label: 'Not planned', value: 'not_planned' }],
      { title: `Close #${n} as…` });
    if (!why) return;
    patch.state_reason = why.value;
  }
  await withTarget(provider, node, (t, token) => provider.client.patchIssue(t.repo, t.number, patch, token),
    state === 'closed' ? `Closed #${n}` : `Reopened #${n}`);
}

/** @param {any} provider @param {any} node @returns {Promise<void>} */
async function assign(provider, node) {
  const t = targetOf(node);
  if (!t) return;
  const session = await api.getSession(true);
  if (!session) return;
  /** @type {any[]} */ let people = [];
  try {
    people = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'RUOSTE: reading assignable users…' },
      () => provider.client.assignees(t.repo, session.accessToken));
  } catch (err) { vscode.window.showErrorMessage(explain(err, t.repo)); return; }

  const current = new Set((t.item?.assignees || []).map((a) => a.login));
  if (provider.login && !people.some((p) => p.login === provider.login))
    people.unshift({ login: provider.login });
  const picks = await vscode.window.showQuickPick(
    people.map((p) => ({ label: p.login, picked: current.has(p.login) })),
    { title: `Assignees for #${t.number}`, canPickMany: true });
  if (!picks) return;
  const assignees = picks.map((p) => p.label);
  await withTarget(provider, node,
    (x, token) => provider.client.patchIssue(x.repo, x.number, { assignees }, token),
    assignees.length ? `Assigned to ${assignees.join(', ')}` : 'Assignees cleared');
}

/** @param {any} provider @param {any} node @returns {Promise<void>} */
async function label(provider, node) {
  const t = targetOf(node);
  if (!t) return;
  const session = await api.getSession(true);
  if (!session) return;
  /** @type {any[]} */ let all = [];
  try {
    all = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'RUOSTE: reading labels…' },
      () => provider.client.labels(t.repo, session.accessToken));
  } catch (err) { vscode.window.showErrorMessage(explain(err, t.repo)); return; }
  if (!all.length) { vscode.window.showInformationMessage(`${t.repo.owner}/${t.repo.repo} defines no labels.`); return; }

  const current = new Set((t.item?.labels || []).map((l) => l.name || l));
  const picks = await vscode.window.showQuickPick(
    all.map((l) => ({ label: l.name, description: l.description || '', picked: current.has(l.name) })),
    { title: `Labels on #${t.number}`, canPickMany: true, matchOnDescription: true });
  if (!picks) return;
  const labels = picks.map((p) => p.label);
  await withTarget(provider, node,
    (x, token) => provider.client.patchIssue(x.repo, x.number, { labels }, token),
    labels.length ? `Labels: ${labels.join(', ')}` : 'Labels cleared');
}

/** @param {any} provider @param {any} node @returns {Promise<void>} */
async function requestReview(provider, node) {
  const t = targetOf(node);
  if (!t) return;
  const session = await api.getSession(true);
  if (!session) return;
  /** @type {any[]} */ let people = [];
  try { people = await provider.client.assignees(t.repo, session.accessToken); }
  catch (err) { vscode.window.showErrorMessage(explain(err, t.repo)); return; }
  const author = t.item?.user?.login;
  const picks = await vscode.window.showQuickPick(
    people.filter((p) => p.login !== author).map((p) => ({ label: p.login })),
    { title: `Request review on #${t.number} from…`, canPickMany: true });
  if (!picks || !picks.length) return;
  await withTarget(provider, node,
    (x, token) => provider.client.requestReviewers(x.repo, x.number, picks.map((p) => p.label), token),
    `Review requested from ${picks.map((p) => p.label).join(', ')}`);
}

/** @param {any} provider @param {any} node @returns {Promise<void>} */
async function merge(provider, node) {
  const t = targetOf(node);
  if (!t) return;
  const session = await api.getSession(true);
  if (!session) return;

  /** @type {any} */ let pr = null;
  try { pr = await provider.client.pull(t.repo, t.number, session.accessToken); }
  catch (err) { vscode.window.showErrorMessage(explain(err, t.repo)); return; }
  if (pr?.state !== 'open') { vscode.window.showInformationMessage(`#${t.number} is not open.`); return; }
  if (pr?.draft) { vscode.window.showWarningMessage(`#${t.number} is a draft — mark it ready on GitHub first.`); return; }
  if (pr?.mergeable === false) {
    vscode.window.showWarningMessage(
      `#${t.number} has conflicts with ${pr.base?.ref || 'the base branch'} and cannot be merged from here.`);
    return;
  }

  const cfgMethod = String(vscode.workspace.getConfiguration('ruoste.work').get('mergeMethod', 'merge'));
  const methods = [
    { label: 'Merge commit', value: 'merge' },
    { label: 'Squash and merge', value: 'squash' },
    { label: 'Rebase and merge', value: 'rebase' },
  ].sort((a, b) => (a.value === cfgMethod ? -1 : 0) - (b.value === cfgMethod ? -1 : 0));
  const how = await vscode.window.showQuickPick(methods, { title: `Merge #${t.number} into ${pr.base?.ref}` });
  if (!how) return;

  if (vscode.workspace.getConfiguration('ruoste.work').get('confirmMerge', true)) {
    const ok = await vscode.window.showWarningMessage(
      `Merge #${t.number} "${pr.title}" into ${pr.base?.ref} of ${t.repo.owner}/${t.repo.repo}?`,
      { modal: true }, 'Merge');
    if (ok !== 'Merge') return;
  }

  await withTarget(provider, node, (x, token) => provider.client.mergePull(
    x.repo, x.number, { merge_method: how.value, sha: pr.head?.sha }, token), `Merged #${t.number}`);
}

/** Check a pull request's branch out in the window.
 *  Only same-repository branches: a fork's head needs a remote this extension
 *  has no business adding on your behalf.
 * @param {any} provider @param {any} node @returns {Promise<void>} */
async function checkout(provider, node) {
  const t = targetOf(node);
  if (!t) return;
  const session = await api.getSession(true);
  if (!session) return;

  /** @type {any} */ let pr = null;
  try { pr = await provider.client.pull(t.repo, t.number, session.accessToken); }
  catch (err) { vscode.window.showErrorMessage(explain(err, t.repo)); return; }

  const sameRepo = pr?.head?.repo?.full_name &&
    pr.head.repo.full_name.toLowerCase() === `${t.repo.owner}/${t.repo.repo}`.toLowerCase();
  const branch = pr?.head?.ref;
  if (!branch || !sameRepo) {
    const open = await vscode.window.showWarningMessage(
      `#${t.number} comes from ${pr?.head?.repo?.full_name || 'a fork'}, which is not a branch of ` +
      `${t.repo.owner}/${t.repo.repo}. Fetching it needs a remote RUOSTE will not add for you.`,
      'Open on GitHub');
    if (open && pr?.html_url) await vscode.env.openExternal(vscode.Uri.parse(pr.html_url));
    return;
  }

  const git = gitApi();
  const local = (git?.repositories || []).find((r) => {
    const remotes = r.state?.remotes || [];
    return remotes.some((x) => String(x.fetchUrl || x.pushUrl || '')
      .toLowerCase().includes(`${t.repo.owner}/${t.repo.repo}`.toLowerCase()));
  });
  if (!local) {
    vscode.window.showWarningMessage(
      `${t.repo.owner}/${t.repo.repo} is not open in this window, so there is nothing to check out into.`);
    return;
  }

  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `RUOSTE: checking out ${branch}` },
      async () => { await local.fetch(); await local.checkout(branch); });
    vscode.window.setStatusBarMessage(`On ${branch}`, 3000);
  } catch (err) {
    vscode.window.showErrorMessage(
      `Could not check out ${branch} — ${err?.stderr || err?.message || err}`);
  }
}

/** @param {any} provider @param {any} seedRepo @returns {Promise<void>} */
async function newIssue(provider, seedRepo) {
  const session = await api.getSession(true);
  if (!session) return;

  let repo = seedRepo?.repo && seedRepo?.owner ? seedRepo : seedRepo?.repo;
  if (!repo) {
    const candidates = provider.workspace.length ? provider.workspace
      : [...new Map(provider.allRows().map((r) => [r.repo.key, r.repo])).values()];
    if (!candidates.length) {
      vscode.window.showInformationMessage('No repository to open an issue in — open one in this window first.');
      return;
    }
    const pick = /** @type {any} */ (await vscode.window.showQuickPick(
      candidates.map((r) => ({ label: `${r.owner}/${r.repo}`, repo: r })),
      { title: 'Open an issue in…' }));
    if (!pick) return;
    repo = pick.repo;
  }

  const title = await vscode.window.showInputBox({
    title: `New issue in ${repo.owner}/${repo.repo}`, prompt: 'Title',
    validateInput: (v) => (v.trim() ? undefined : 'A title is required'),
  });
  if (!title) return;
  const body = await vscode.window.showInputBox({
    title: `New issue in ${repo.owner}/${repo.repo}`, prompt: 'Body (markdown, optional)',
  });
  if (body === undefined) return;

  try {
    const created = await provider.client.createIssue(repo, { title, body }, session.accessToken);
    void provider.refresh(false);
    const open = await vscode.window.showInformationMessage(
      `Opened ${repo.owner}/${repo.repo}#${created.number}`, 'View', 'Open on GitHub');
    if (open === 'View')
      await vscode.commands.executeCommand('ruoste.work.view', { repo, item: created, number: created.number });
    else if (open === 'Open on GitHub' && created.html_url)
      await vscode.env.openExternal(vscode.Uri.parse(created.html_url));
  } catch (err) {
    vscode.window.showErrorMessage(explain(err, repo));
  }
}

/** Search GitHub for an issue or pull request and pick one.
 *  The query goes to GitHub verbatim, so the whole search syntax works —
 *  `repo:`, `is:`, `label:`, `sort:` and the rest. A query with no qualifiers
 *  is scoped to open items, which is what typing three words usually means.
 * @param {any} provider @returns {Promise<{repo:any, item:any}|null>} */
async function search(provider) {
  const raw = await vscode.window.showInputBox({
    title: 'Search issues and pull requests',
    prompt: 'GitHub search syntax — e.g. repo:acme/api is:pr is:open review:required',
    placeHolder: 'flaky test',
    value: provider.workspace[0] ? `repo:${provider.workspace[0].owner}/${provider.workspace[0].repo} ` : '',
    valueSelection: [999, 999],
  });
  if (!raw || !raw.trim()) return null;
  const q = /\b(is|repo|org|user|author|assignee|label|state|involves|mentions):/.test(raw)
    ? raw : `${raw} is:open`;

  const session = await api.getSession(true);
  if (!session) return null;
  /** @type {any[]} */ let items = [];
  try {
    items = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'RUOSTE: searching GitHub…' },
      () => provider.client.searchIssues(provider.host, session.accessToken, q, { limit: 50 }));
  } catch (err) {
    vscode.window.showErrorMessage(
      err?.status === 422 ? `GitHub could not parse that query — ${err.message}` : `RUOSTE: ${err?.message || err}`);
    return null;
  }
  if (!items.length) { vscode.window.showInformationMessage(`Nothing matched ${q}`); return null; }

  const { repoOfItem } = require('./work');
  const picks = items.map((item) => {
    const repo = repoOfItem(item, provider.host);
    return {
      label: `$(${item.pull_request ? 'git-pull-request' : 'issues'}) ${item.title}`,
      description: repo ? `${repo.owner}/${repo.repo}#${item.number}` : `#${item.number}`,
      detail: `${item.state}${item.user?.login ? ` · by ${item.user.login}` : ''}`,
      item, repo,
    };
  }).filter((p) => p.repo);
  const pick = /** @type {any} */ (await vscode.window.showQuickPick(picks,
    { title: `${picks.length} results`, matchOnDescription: true }));
  return pick ? { repo: pick.repo, item: pick.item } : null;
}

module.exports = {
  comment, setState, assign, label, merge, checkout, newIssue, requestReview, search,
  explain, targetOf,
};
