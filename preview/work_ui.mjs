// Renders the real issue/pull-request panel (same CSS + JS the extension
// ships, same markdown renderer) against mock state.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { renderMarkdown } = require(path.join(ROOT, 'src/github/markdown.js'));

const css = fs.readFileSync(path.join(ROOT, 'media/work.css'), 'utf8');
const js  = fs.readFileSync(path.join(ROOT, 'media/work.js'), 'utf8');
const panel = fs.readFileSync(path.join(ROOT, 'src/github/item.js'), 'utf8');
const body = /<body[^>]*>([\s\S]*?)<script/.exec(panel)[1];
const font = fs.readFileSync(path.join(ROOT,
  'node_modules/geist/dist/fonts/geist-mono/GeistMono-Regular.woff2')).toString('base64');

const REPO = { owner: 'JohnBrandt00', name: 'radiohub', host: 'github.com',
               url: 'https://github.com/JohnBrandt00/radiohub' };
const md = (s) => renderMarkdown(s, { repoUrl: REPO.url, host: REPO.host });
const who = (login) => ({ login, avatar: '', url: '#' });

const PR = {
  repo: REPO,
  item: {
    number: 412, title: 'Squelch the retry storm when the ingest node drops',
    url: '#', kind: 'pr', state: 'open', open: true, draft: false,
    author: who('JohnBrandt00'), opened: '2d ago', updated: '18m ago', age: '2d',
    bodyHtml: md([
      'The retry loop had no ceiling, so a node dropping mid-batch produced a **thundering herd**',
      'against the replacement. Closes #388.',
      '',
      '- [x] cap the backoff at 30s',
      '- [x] jitter the first retry',
      '- [ ] metrics for retry depth',
      '',
      '```csharp',
      'var delay = Math.Min(cap, baseDelay * (1 << attempt));',
      '```',
      '',
      '> Reviewed the numbers with @acme-ops — 30s is where the graph flattens.',
    ].join('\n')),
    labels: [{ name: 'bug', color: 'C76067' }, { name: 'ingest', color: '8DA668' },
             { name: 'needs-backport', color: 'C7A560' }],
    assignees: [who('JohnBrandt00')], locked: false,
  },
  pr: {
    base: 'main', head: 'fix/retry-squelch', fork: '',
    merged: false, mergeable: true, mergeableState: 'unstable',
    additions: 148, deletions: 63, commits: 4, changed: 6,
    reviewers: ['acme-ops'],
    truncated: 0,
    files: [
      { index: 0, name: 'src/Ingest/RetryPolicy.cs', status: 'modified', additions: 71, deletions: 40,
        url: '#', binary: false, patch: [
          '@@ -18,9 +18,14 @@ public sealed class RetryPolicy',
          '     private readonly TimeSpan _cap;',
          '-    public TimeSpan Next(int attempt) =>',
          '-        TimeSpan.FromMilliseconds(_base.TotalMilliseconds * (1 << attempt));',
          '+    public TimeSpan Next(int attempt)',
          '+    {',
          '+        var raw = _base.TotalMilliseconds * (1 << Math.Min(attempt, 16));',
          '+        var capped = Math.Min(raw, _cap.TotalMilliseconds);',
          '+        return TimeSpan.FromMilliseconds(capped * Jitter());',
          '+    }',
          ' }',
        ].join('\n') },
      { index: 1, name: 'src/Ingest/NodeWatcher.cs', status: 'modified', additions: 34, deletions: 12,
        url: '#', binary: false, patch: '@@ -4,3 +4,5 @@\n using System;\n+using System.Diagnostics;\n' },
      { index: 2, name: 'test/RetryPolicyTests.cs', status: 'added', additions: 38, deletions: 0,
        url: '#', binary: false, patch: '@@ -0,0 +1,3 @@\n+[Fact]\n+public void CapsTheBackoff() { }\n' },
      { index: 3, name: 'docs/diagram.png', status: 'modified', additions: 0, deletions: 0,
        url: '#', binary: true, patch: '' },
    ],
    checks: [
      { name: 'build', label: 'success', live: false, ok: true, url: '#' },
      { name: 'unit', label: 'success', live: false, ok: true, url: '#' },
      { name: 'integration', label: 'running', live: true, ok: false, url: '#' },
      { name: 'lint', label: 'failed', live: false, ok: false, url: '#' },
    ],
  },
  links: [
    { owner: 'JohnBrandt00', repo: 'radiohub', number: 388, title: 'Ingest retries hammer the replacement node', kind: 'issue', relation: 'closes', state: 'open', sameRepo: true },
    { owner: 'acme-corp', repo: 'ingest-service', number: 1902, title: 'Backport the cap', kind: 'pr', relation: 'referenced', state: 'merged', sameRepo: false },
  ],
  unnamedLinks: 1,
  timeline: [
    { id: 'c1', kind: 'comment', at: 1, author: who('acme-ops'), url: '#', when: '1d ago',
      edited: false, state: '', bodyHtml: md('Numbers look right. One question on the `jitter` seed — is it per node or per batch?') },
    { id: 'r1', kind: 'review', at: 2, author: who('acme-ops'), url: '#', when: '20m ago',
      edited: false, state: 'changes requested',
      bodyHtml: md('Blocking on the metrics checkbox — we cannot see the herd without it.') },
    { id: 'c2', kind: 'comment', at: 3, author: who('JohnBrandt00'), url: '#', when: '18m ago',
      edited: true, state: '', bodyHtml: md('Per node. Adding the counter now.') },
  ],
};

const ISSUE = {
  repo: REPO,
  item: {
    number: 388, title: 'Ingest retries hammer the replacement node', url: '#',
    kind: 'issue', state: 'open', open: true, draft: false,
    author: who('acme-ops'), opened: '9d ago', updated: '2d ago', age: '9d',
    bodyHtml: md('When a node drops mid-batch every client retries at once.\n\n1. drop a node\n2. watch the graph\n\nSee `RetryPolicy.cs`.'),
    labels: [{ name: 'bug', color: 'C76067' }],
    assignees: [], locked: false,
  },
  pr: null,
  links: [
    { owner: 'JohnBrandt00', repo: 'radiohub', number: 412, title: 'Squelch the retry storm when the ingest node drops', kind: 'pr', relation: 'referenced', state: 'open', sameRepo: true },
  ],
  unnamedLinks: 0,
  timeline: [
    { id: 'c1', kind: 'comment', at: 1, author: who('JohnBrandt00'), url: '#', when: '8d ago',
      edited: false, state: '', bodyHtml: md('Reproduced. Working on it in #412.') },
  ],
};

function page(themeFile, state) {
  const t = JSON.parse(fs.readFileSync(path.join(ROOT, 'themes', themeFile), 'utf8')).colors;
  const v = (id, fb) => t[id] || fb;
  return `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:GM;src:url(data:font/woff2;base64,${font}) format('woff2')}
:root{
  --vscode-editor-font-family: GM, monospace;
  --vscode-editor-background: ${v('editor.background')};
  --vscode-sideBar-background: ${v('sideBar.background')};
  --vscode-input-background: ${v('input.background')};
  --vscode-foreground: ${v('foreground')};
  --vscode-descriptionForeground: ${v('descriptionForeground')};
  --vscode-panel-border: ${v('panel.border')};
  --vscode-activityBar-activeBorder: ${v('activityBar.activeBorder')};
  --vscode-list-hoverBackground: ${v('list.hoverBackground')};
  --vscode-testing-iconPassed: ${v('testing.iconPassed')};
  --vscode-testing-iconFailed: ${v('testing.iconFailed')};
  --vscode-testing-iconQueued: ${v('testing.iconQueued')};
  --vscode-charts-purple: ${v('charts.purple', '#9A7AA0')};
}
${css}
</style><body class="${state.item.kind}">${body}<script>
window.acquireVsCodeApi = () => ({ postMessage(){}, setState(){}, getState(){ return null; } });
${js}
window.dispatchEvent(new MessageEvent('message',{data:{type:'state',state:${JSON.stringify(state)}}}));
</script>`;
}

const browser = await chromium.launch();
const SHOTS = [
  ['pr-dark',    'ruoste-color-theme.json',        PR,    980, 900],
  ['pr-light',   'ruoste-paperi-color-theme.json', PR,    980, 900],
  ['issue-dark', 'ruoste-color-theme.json',        ISSUE, 980, 560],
];
for (const [name, theme, state, w, h] of SHOTS) {
  const pg = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await pg.setContent(page(theme, state), { waitUntil: 'load' });
  // the patches start collapsed, as they do in the panel; open the first one
  await pg.evaluate(() => {
    const rows = document.querySelectorAll('li.file .row');
    if (rows.length) /** @type {any} */ (rows[0]).click();
  });
  await pg.waitForTimeout(200);
  await pg.screenshot({ path: `preview/work-${name}.png`, fullPage: false });

  const cards = await pg.$$eval('.card', (n) => n.length);
  const chips = await pg.$$eval('.chip', (n) => n.length);
  const checks = await pg.$$eval('.check', (n) => n.length);
  const acts = await pg.$$eval('.acts .btn', (n) => n.map((x) => x.textContent));
  const scripts = await pg.$$eval('.prose script', (n) => n.length);
  const linkRows = await pg.$$eval('.link', (n) => n.length);
  const patchLines = await pg.$$eval('pre.patch .ln.add', (n) => n.length);
  console.log(`✓ preview/work-${name}.png  cards=${cards} chips=${chips} checks=${checks}`);
  console.log(`  actions: ${acts.join(' ')}`);
  console.log(`  links=${linkRows} added-patch-lines=${patchLines}`);
  if (linkRows !== state.links.length) { console.error('  links did not bind'); process.exitCode = 1; }
  if (state.pr && !patchLines) { console.error('  patch did not render'); process.exitCode = 1; }

  const wantCards = state.timeline.length + 1;              // description plus the conversation
  if (cards !== wantCards) { console.error(`  expected ${wantCards} cards`); process.exitCode = 1; }
  if (scripts) { console.error('  markup escaped into the page'); process.exitCode = 1; }
  if (state.pr && checks !== state.pr.checks.length) { console.error('  checks did not bind'); process.exitCode = 1; }
  if (!state.pr && acts.includes('MERGE')) { console.error('  merge offered on an issue'); process.exitCode = 1; }
  if (state.pr && !acts.includes('MERGE')) { console.error('  merge missing on an open PR'); process.exitCode = 1; }
  await pg.close();
}
await browser.close();
