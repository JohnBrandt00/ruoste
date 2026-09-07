// @ts-check
'use strict';
require('./harness');
const test = require('node:test');
const assert = require('node:assert/strict');
const { issuePresentation } = require('../src/util');
const { renderMarkdown, safeUrl } = require('../src/github/markdown');
const { WorkProvider, repoOfItem, passesFilter } = require('../src/github/work');
const { WorkNotifier } = require('../src/github/worknotify');
const { targetOf, explain } = require('../src/github/manage');

const ISSUE = (o = {}) => Object.assign({ id: 1, number: 7, title: 'x', state: 'open' }, o);
const PR = (o = {}) => ISSUE(Object.assign({ pull_request: { url: 'u' } }, o));

// ── presentation ─────────────────────────────────────────────────────────
test('issues and pull requests read as GitHub presents them', () => {
  assert.equal(issuePresentation(ISSUE()).kind, 'issue');
  assert.equal(issuePresentation(PR()).kind, 'pr');
  assert.equal(issuePresentation(PR({ draft: true })).label, 'draft');
  assert.equal(issuePresentation(PR({ state: 'closed', pull_request: { merged_at: 'now' } })).label, 'merged');
  assert.equal(issuePresentation(PR({ state: 'closed' })).label, 'closed');
  assert.equal(issuePresentation(ISSUE({ state: 'closed' })).color, 'charts.purple');
  assert.equal(issuePresentation(ISSUE({ state: 'closed', state_reason: 'not_planned' })).label, 'not planned');
  // a pull request fetched from /pulls has no `pull_request` key of its own
  assert.equal(issuePresentation({ state: 'open', head: { ref: 'x' } }).kind, 'pr');
});

// ── search results carry their repo in a url ─────────────────────────────
test('repoOfItem reads the repository out of a search result', () => {
  const r = repoOfItem({ repository_url: 'https://api.github.com/repos/Acme/API' }, 'github.com');
  assert.deepEqual(r, { owner: 'Acme', repo: 'API', host: 'github.com', key: 'github.com/acme/api' });
  assert.equal(repoOfItem({}, 'github.com'), null);
  // GitHub Enterprise serves the same shape under /api/v3
  assert.equal(repoOfItem({ repository_url: 'https://ghe.corp/api/v3/repos/o/r' }, 'ghe.corp')?.key,
    'ghe.corp/o/r');
});

test('the include filter splits issues from pull requests', () => {
  assert.equal(passesFilter(PR(), 'issues'), false);
  assert.equal(passesFilter(PR(), 'prs'), true);
  assert.equal(passesFilter(ISSUE(), 'issues'), true);
  assert.equal(passesFilter(ISSUE(), 'prs'), false);
  assert.equal(passesFilter(ISSUE(), 'both'), true);
});

// ── provider ─────────────────────────────────────────────────────────────
/** @param {Record<string,any>} cfg */
function providerWith(cfg = {}) {
  const p = new WorkProvider(/** @type {any} */ ({}), /** @type {any} */ ({}));
  Object.defineProperty(p, 'cfg', {
    get: () => ({ get: (k, d) => (k in cfg ? cfg[k] : d), update: async () => {} }),
  });
  return p;
}

test('sections follow the setting, and a bad setting still yields sections', () => {
  assert.deepEqual(providerWith().enabledSections().map((s) => s.id),
    ['review', 'assigned', 'created', 'workspace']);
  assert.deepEqual(providerWith({ sections: ['mentioned', 'review'] }).enabledSections().map((s) => s.id),
    ['mentioned', 'review'], 'order comes from the setting');
  assert.equal(providerWith({ sections: ['nonsense'] }).enabledSections().length, 4, 'falls back');
});

test('the tree hides the workspace section when no repo is open here', () => {
  const p = providerWith();
  p.signedIn = true;
  assert.deepEqual(p.getChildren().map((n) => /** @type {any} */ (n).id),
    ['review', 'assigned', 'created']);
  p.workspace = [/** @type {any} */ ({ owner: 'o', repo: 'r', host: 'github.com', key: 'github.com/o/r' })];
  assert.equal(p.getChildren().length, 4);
});

test('a section that failed keeps the rows it had and says why', () => {
  const p = providerWith();
  p.signedIn = true;
  p.sections.set('review', { rows: [], at: 0, error: 'Rate limit reached' });
  const kids = p.getChildren({ kind: 'section', id: 'review', label: 'Review requested', icon: 'x' });
  assert.equal(kids.length, 1);
  assert.match(/** @type {any} */ (kids[0]).text, /Rate limit/);
  assert.equal(/** @type {any} */ (p.getTreeItem({ kind: 'section', id: 'review', label: 'R', icon: 'x' })).description,
    'Rate limit reached');
});

test('rows carry a context value the menus can match', () => {
  const p = providerWith();
  const repo = /** @type {any} */ ({ owner: 'o', repo: 'r', host: 'github.com', key: 'github.com/o/r' });
  const ctxOf = (item) => /** @type {any} */ (
    p.getTreeItem({ kind: 'item', item, repo, sectionId: 'review' })).contextValue;
  assert.equal(ctxOf(PR()), 'ruoste.work.item.pr');
  assert.equal(ctxOf(ISSUE()), 'ruoste.work.item.issue');
  assert.equal(ctxOf(ISSUE({ state: 'closed' })), 'ruoste.work.item.issue.closed');
});

test('find locates a held item regardless of case', () => {
  const p = providerWith();
  const repo = /** @type {any} */ ({ owner: 'Acme', repo: 'API', host: 'github.com', key: 'github.com/acme/api' });
  p.sections.set('review', { rows: [{ item: PR({ number: 12 }), repo }], at: 0 });
  assert.ok(p.find({ owner: 'acme', repo: 'api' }, 12));
  assert.equal(p.find({ owner: 'acme', repo: 'api' }, 13), undefined);
});

test('allRows deduplicates an item that appears in two sections', () => {
  const p = providerWith();
  const repo = /** @type {any} */ ({ owner: 'o', repo: 'r', host: 'github.com', key: 'github.com/o/r' });
  const item = PR({ id: 99 });
  p.sections.set('review', { rows: [{ item, repo }], at: 0 });
  p.sections.set('assigned', { rows: [{ item, repo }], at: 0 });
  assert.equal(p.allRows().length, 1);
  assert.equal(p.reviewCount, 1);
});

// ── notifier ─────────────────────────────────────────────────────────────
test('the first poll seeds silently, later ones report what is new', () => {
  const n = new WorkNotifier();
  const repo = { owner: 'o', repo: 'r' };
  const state = (ids) => [{ id: 'review', label: 'Review requested',
    rows: ids.map((id) => ({ item: { id, number: id, title: 't' }, repo })) }];
  assert.deepEqual(n.diff(state([1, 2])), [], 'baseline is silent');
  assert.deepEqual(n.diff(state([1, 2])), [], 'unchanged is silent');
  const events = n.diff(state([1, 2, 3]));
  assert.equal(events.length, 1);
  assert.equal(events[0].item.id, 3);
  assert.deepEqual(n.diff(state([3])), [], 'items leaving are not events');
});

test('the notification policy decides which sections speak', () => {
  const n = new WorkNotifier();
  const policy = (p) => { Object.defineProperty(n, 'policy', { get: () => p, configurable: true }); return n; };
  assert.equal(policy('off').wants('review'), false);
  assert.equal(policy('review-requested').wants('review'), true);
  assert.equal(policy('review-requested').wants('assigned'), false);
  assert.equal(policy('assigned').wants('assigned'), true);
  assert.equal(policy('all').wants('mentioned'), true);
});

// ── manage ───────────────────────────────────────────────────────────────
test('targetOf accepts a tree node, a panel target, and nothing else', () => {
  const repo = { owner: 'o', repo: 'r' };
  assert.equal(targetOf({ repo, item: { number: 4 } })?.number, 4);
  assert.equal(targetOf({ repo, number: 4 })?.number, 4);
  assert.equal(targetOf({ repo }), null);
  assert.equal(targetOf(undefined), null);
});

test('failures are explained in terms of what to do about them', () => {
  const repo = { owner: 'acme', repo: 'api' };
  assert.match(explain({ kind: 'sso' }, repo), /SAML SSO/);
  assert.match(explain({ status: 403 }, repo), /write access/);
  assert.match(explain({ status: 404 }, repo), /acme\/api/);
  assert.match(explain({ message: 'boom' }, repo), /boom/);
});

// ── rate limit buckets ───────────────────────────────────────────────────
const { GitHubClient, bucketOf } = require('../src/github/api');

test('search draws on its own rate limit bucket, not core', async () => {
  assert.equal(bucketOf('/search/issues?q=x'), 'search');
  assert.equal(bucketOf('/repos/o/r/actions/runs'), 'core');

  const c = new GitHubClient();
  const res = (headers) => ({
    status: 200, ok: true, headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    text: async () => '{}', json: async () => ({}),
  });
  const original = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (async (url) => (String(url).includes('/search/')
    ? res({ 'x-ratelimit-remaining': '0', 'x-ratelimit-limit': '30',
            'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 60),
            'x-ratelimit-resource': 'search', 'content-type': 'application/json' })
    : res({ 'x-ratelimit-remaining': '4998', 'x-ratelimit-limit': '5000',
            'x-ratelimit-resource': 'core', 'content-type': 'application/json' })));
  try {
    await c.request('github.com', '/repos/o/r/actions/runs', 't');
    await c.request('github.com', '/search/issues?q=x', 't');
    assert.equal(c.remaining, 4998, 'a spent search budget does not touch the core figure');
    assert.match(c.budget(), /4998\/5000/);
    assert.equal(c.buckets.get('search')?.remaining, 0);

    // core still goes through; the exhausted search bucket refuses early
    await c.request('github.com', '/repos/o/r/actions/runs', 't');
    await assert.rejects(() => c.request('github.com', '/search/issues?q=y', 't'),
      (err) => /** @type {any} */ (err).kind === 'rate-limit' && /search/i.test(/** @type {any} */ (err).message));
  } finally { globalThis.fetch = original; }
});

// ── markdown ─────────────────────────────────────────────────────────────
test('markdown escapes everything before it renders anything', () => {
  const html = renderMarkdown('<script>alert(1)</script> & "quotes"');
  assert.ok(!html.includes('<script>'), 'no script tag survives');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&amp;'));
});

test('only http, https and mailto links are rendered as links', () => {
  assert.equal(safeUrl('https://x.y'), 'https://x.y');
  assert.equal(safeUrl('mailto:a@b.c'), 'mailto:a@b.c');
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('vscode://gapashu.ruoste/x'), null);
  assert.ok(!renderMarkdown('[click](javascript:alert(1))').includes('<a'));
  assert.ok(renderMarkdown('[click](https://x.y)').includes('<a href="https://x.y">click</a>'));
});

test('markdown renders the blocks people actually write in issues', () => {
  const md = [
    '## Heading', '', 'A **bold** and `code` line.', '',
    '- [ ] unchecked', '- [x] checked', '',
    '1. first', '2. second', '',
    '> quoted', '', '```js', 'const a = 1;', '```', '', '---',
  ].join('\n');
  const html = renderMarkdown(md);
  assert.ok(html.includes('<h3>Heading</h3>'), 'an h2 in a body renders below the page title');
  assert.ok(html.includes('<strong>bold</strong>'));
  assert.ok(html.includes('<code>code</code>'));
  assert.ok(html.includes('<li class="task">'));
  assert.ok(html.includes('<ol>') && html.includes('<blockquote>'));
  assert.ok(html.includes('<pre data-lang="js"><code>const a = 1;</code></pre>'));
  assert.ok(html.includes('<hr>'));
});

test('markdown does not format inside code spans or fences', () => {
  assert.ok(renderMarkdown('`**not bold**`').includes('<code>**not bold**</code>'));
  assert.ok(!renderMarkdown('```\n**not bold**\n```').includes('<strong>'));
});

test('issue and user references become links when the repo is known', () => {
  const html = renderMarkdown('fixes #12 thanks @jb', { repoUrl: 'https://github.com/o/r', host: 'github.com' });
  assert.ok(html.includes('href="https://github.com/o/r/issues/12"'));
  assert.ok(html.includes('href="https://github.com/jb"'));
  // without a repo there is nothing to point at, so it stays text
  assert.ok(!renderMarkdown('fixes #12').includes('<a'));
});

test('an empty body says so rather than rendering nothing', () => {
  assert.match(renderMarkdown(''), /No description/);
  assert.match(renderMarkdown(null), /No description/);
});
