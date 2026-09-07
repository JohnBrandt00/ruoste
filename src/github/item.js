// @ts-check
'use strict';
/** One issue or pull request, as an editor tab: body, conversation, reviews,
 *  changed files, checks — and the buttons that change any of it.
 *
 *  Bodies are rendered here rather than in the page: the extension host is the
 *  only side that ever sees the raw markdown, so nothing a stranger writes in
 *  an issue reaches the webview as anything but escaped text. */
const vscode = require('vscode');
const apiMod = require('./api');
const manage = require('./manage');
const { renderMarkdown } = require('./markdown');
const { issuePresentation, relativeTime, formatDuration, statusPresentation } = require('../util');

const nonce = () => Array.from({ length: 32 },
  () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)]).join('');

/** @type {Map<string, {panel:vscode.WebviewPanel, reload:() => Promise<void>}>} */
const panels = new Map();

/** @param {{owner:string, repo:string}} repo @param {number} number @returns {string} */
const keyOf = (repo, number) => `${repo.owner}/${repo.repo}#${number}`.toLowerCase();

/** Tell any open panel for this item to reload — called after a mutation from
 *  the tree, a notification, or another panel. @param {any} repo @param {number} number */
function refreshPanels(repo, number) {
  if (!repo) return;
  const entry = panels.get(keyOf(repo, number));
  if (entry) void entry.reload();
}

/** @param {any} u @returns {{login:string, avatar:string, url:string}|null} */
const person = (u) => (u ? { login: u.login || '', avatar: u.avatar_url || '', url: u.html_url || '' } : null);

/** Everything the page needs about one item, in one flat object.
 * @param {any} client @param {any} repo @param {number} number @param {string} token
 * @returns {Promise<any>} */
async function load(client, repo, number, token) {
  const item = await client.issue(repo, number, token);
  const p = issuePresentation(item);
  const repoUrl = `https://${repo.host}/${repo.owner}/${repo.repo}`;
  const md = (s) => renderMarkdown(s, { repoUrl, host: repo.host });

  const comments = Number(item.comments)
    ? await client.issueComments(repo, number, token).catch(() => [])
    : [];

  /** @type {any} */ let pr = null;
  if (p.kind === 'pr') {
    pr = await client.pull(repo, number, token).catch(() => null);
  }

  /** @type {any[]} */ let reviews = [];
  /** @type {any[]} */ let files = [];
  /** @type {any[]} */ let checks = [];
  if (pr) {
    [reviews, files] = await Promise.all([
      client.pullReviews(repo, number, token).catch(() => []),
      client.pullFiles(repo, number, token).catch(() => []),
    ]);
    if (pr.head?.sha) checks = await client.checkRuns(repo, pr.head.sha, token).catch(() => []);
  }

  // comments and reviews are two lists on GitHub's side and one conversation
  // in practice, so they are merged back into posting order here
  const timeline = [
    ...comments.map((c) => ({
      id: `c${c.id}`, kind: 'comment', at: Date.parse(c.created_at || '') || 0,
      author: person(c.user), url: c.html_url,
      when: relativeTime(c.created_at), edited: c.updated_at !== c.created_at,
      bodyHtml: md(c.body), state: '',
    })),
    ...reviews.filter((r) => r.state !== 'PENDING').map((r) => ({
      id: `r${r.id}`, kind: 'review', at: Date.parse(r.submitted_at || '') || 0,
      author: person(r.user), url: r.html_url,
      when: relativeTime(r.submitted_at), edited: false,
      bodyHtml: r.body ? md(r.body) : '',
      state: String(r.state || '').toLowerCase().replace(/_/g, ' '),
    })),
  ].sort((a, b) => a.at - b.at);

  return {
    repo: { owner: repo.owner, name: repo.repo, host: repo.host, url: repoUrl },
    item: {
      number: item.number, title: item.title, url: item.html_url,
      kind: p.kind, state: p.label, open: p.open, draft: Boolean(item.draft || pr?.draft),
      author: person(item.user),
      opened: relativeTime(item.created_at), updated: relativeTime(item.updated_at),
      age: formatDuration(Date.now() - Date.parse(item.created_at || '')),
      bodyHtml: md(item.body),
      labels: (item.labels || []).map((l) => ({ name: l.name || String(l), color: l.color || '' })),
      assignees: (item.assignees || []).map(person).filter(Boolean),
      locked: Boolean(item.locked),
    },
    pr: pr && {
      base: pr.base?.ref || '', head: pr.head?.ref || '',
      fork: pr.head?.repo?.full_name && pr.head.repo.full_name !== `${repo.owner}/${repo.repo}`
        ? pr.head.repo.full_name : '',
      merged: Boolean(pr.merged), mergeable: pr.mergeable, mergeableState: pr.mergeable_state || '',
      additions: pr.additions ?? 0, deletions: pr.deletions ?? 0,
      commits: pr.commits ?? 0, changed: pr.changed_files ?? files.length,
      reviewers: (pr.requested_reviewers || []).map((r) => r.login),
      files: files.slice(0, 300).map((f) => ({
        name: f.filename, status: f.status,
        additions: f.additions ?? 0, deletions: f.deletions ?? 0, url: f.blob_url,
      })),
      checks: checks.map((c) => {
        const s = statusPresentation(c.status, c.conclusion);
        return { name: c.name, label: s.label, live: s.live, ok: c.conclusion === 'success', url: c.html_url };
      }),
    },
    timeline,
  };
}

/** @param {vscode.ExtensionContext} ctx @param {any} provider @param {any} target
 *  @returns {vscode.WebviewPanel|undefined} */
function openItemPanel(ctx, provider, target) {
  const repo = target?.repo;
  const number = Number(target?.item?.number ?? target?.number);
  if (!repo || !Number.isFinite(number)) {
    vscode.window.showInformationMessage('RUOSTE: no issue or pull request selected.');
    return undefined;
  }
  const key = keyOf(repo, number);
  const existing = panels.get(key);
  if (existing) { existing.panel.reveal(undefined, false); void existing.reload(); return existing.panel; }

  const seed = target?.item;
  const p = seed ? issuePresentation(seed) : { kind: 'issue' };
  const panel = vscode.window.createWebviewPanel(
    'ruoste.work.item', `#${number} ${seed?.title ? String(seed.title).slice(0, 40) : ''}`.trim(),
    { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
    { enableScripts: true, retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, 'media')] });
  panel.iconPath = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'activity-bar.svg');

  const n = nonce();
  const uri = (f) => panel.webview.asWebviewUri(vscode.Uri.joinPath(ctx.extensionUri, 'media', f));
  panel.webview.html = `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none';
  img-src ${panel.webview.cspSource} https: data:; style-src ${panel.webview.cspSource} 'unsafe-inline';
  script-src 'nonce-${n}'; font-src ${panel.webview.cspSource};">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${uri('work.css')}">
</head><body class="${p.kind}">
<header>
  <div class="brand" id="chip">${p.kind === 'pr' ? 'PULL REQUEST' : 'ISSUE'}</div>
  <div id="where"></div>
  <div class="spacer"></div>
  <button id="refresh" class="btn ghost" title="Refresh">&#8635;</button>
  <button id="browser" class="btn ghost" title="Open on GitHub">GITHUB</button>
</header>
<div id="banner"></div>
<main id="body">
  <section id="head"></section>
  <section id="strip"></section>
  <section id="desc" class="card"></section>
  <section id="files"></section>
  <section id="timeline"></section>
</main>
<footer>
  <textarea id="draft" rows="2" placeholder="Leave a comment&hellip;" aria-label="Comment"></textarea>
  <div class="acts" id="acts"></div>
</footer>
<script nonce="${n}" src="${uri('work.js')}"></script>
</body></html>`;

  let disposed = false;
  const post = (msg) => { if (!disposed) void panel.webview.postMessage(msg); };

  /** A write triggers a reload from two directions at once — the panel that
   *  made it, and the provider telling every panel the item changed. Coalescing
   *  them keeps that one round of requests rather than two.
   *  @type {Promise<void>|null} */
  let pending = null;
  const reload = () => (pending = pending || doReload().finally(() => { pending = null; }));

  const doReload = async () => {
    post({ type: 'loading' });
    const session = await apiMod.getSession(false);
    if (!session) { post({ type: 'error', error: 'Not signed in to GitHub.' }); return; }
    try {
      const state = await load(provider.client, repo, number, session.accessToken);
      panel.title = `#${number} ${String(state.item.title).slice(0, 40)}`;
      post({ type: 'state', state });
    } catch (err) {
      post({ type: 'error', error: manage.explain(err, repo) });
    }
  };

  /** The node shape the manage commands expect. @returns {any} */
  const node = () => ({ repo, number, item: provider.find(repo, number)?.item || seed || { number } });

  panel.webview.onDidReceiveMessage(async (m) => {
    switch (m?.type) {
      case 'ready':    await reload(); break;
      case 'refresh':  await reload(); break;
      case 'open':     if (m.url) await vscode.env.openExternal(vscode.Uri.parse(String(m.url))); break;
      case 'comment':  if (String(m.body || '').trim()) {
        await manage.comment(provider, node(), String(m.body));
        post({ type: 'commented' });
        await reload();
      } break;
      case 'close':    await manage.setState(provider, node(), 'closed'); await reload(); break;
      case 'reopen':   await manage.setState(provider, node(), 'open'); await reload(); break;
      case 'merge':    await manage.merge(provider, node()); await reload(); break;
      case 'checkout': await manage.checkout(provider, node()); break;
      case 'assign':   await manage.assign(provider, node()); await reload(); break;
      case 'label':    await manage.label(provider, node()); await reload(); break;
      case 'review':   await manage.requestReview(provider, node()); await reload(); break;
    }
  });

  panel.onDidDispose(() => { disposed = true; panels.delete(key); });
  panels.set(key, { panel, reload });
  return panel;
}

module.exports = { openItemPanel, refreshPanels, load };
