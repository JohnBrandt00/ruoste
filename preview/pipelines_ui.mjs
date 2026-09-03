// Renders the real pipelines dashboard (same CSS + JS the extension ships)
// against mock provider state.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(ROOT, 'media/pipelines.css'), 'utf8');
const js  = fs.readFileSync(path.join(ROOT, 'media/pipelines.js'), 'utf8');
const dash = fs.readFileSync(path.join(ROOT, 'src/github/dashboard.js'), 'utf8');
const body = /<body>([\s\S]*?)<script/.exec(dash)[1];
const font = fs.readFileSync(path.join(ROOT,
  'node_modules/geist/dist/fonts/geist-mono/GeistMono-Regular.woff2')).toString('base64');

const run = (name, state, branch, when, took, done, n) =>
  ({ id: n, name, state, live: !done, branch, when, took, number: n,
     url: '#', actor: 'JohnBrandt00', event: 'push', done });

const STATE = {
  signedIn: true, loading: false, live: 2, failing: 1, repoCount: 38,
  budget: '4821/5000 · 74% cached',
  owners: [
    { owner: 'JohnBrandt00', repos: [
      { key: 'a', owner: 'JohnBrandt00', name: 'radiohub', source: 'workspace', url: '#', runs: [
        run('build and test', 'running', 'main', '2m ago', '2m 14s', false, 412),
        run('deploy chart', 'success', 'main', '1h ago', '3m 02s', true, 411),
        run('build and test', 'success', 'feat/squelch', '3h ago', '2m 51s', true, 410)] },
      { key: 'b', owner: 'JohnBrandt00', name: 'ruoste', source: 'workspace', url: '#', runs: [
        run('build', 'success', 'main', '18m ago', '48s', true, 87)] },
      { key: 'c', owner: 'JohnBrandt00', name: 'portfolio', source: 'affiliated', url: '#', runs: [
        run('pages', 'success', 'main', '2d ago', '39s', true, 220)] },
    ]},
    { owner: 'acme-corp', repos: [
      { key: 'd', owner: 'acme-corp', name: 'ingest-service', source: 'affiliated', url: '#', runs: [
        run('deploy', 'failed', 'main', '3h ago', '5m 40s', true, 1902),
        run('unit', 'success', 'main', '3h ago', '1m 12s', true, 1901)] },
      { key: 'e', owner: 'acme-corp', name: 'edge-router', source: 'affiliated', url: '#', runs: [
        run('integration', 'queued', 'release/2.4', '20s ago', '20s', false, 77)] },
      { key: 'f', owner: 'acme-corp', name: 'legacy-batch', source: 'affiliated', url: '#',
        error: 'SAML SSO authorisation required for this organisation', runs: [] },
      { key: 'g', owner: 'acme-corp', name: 'docs-site', source: 'affiliated', url: '#', runs: [] },
    ]},
  ],
};

function page(themeFile) {
  const t = JSON.parse(fs.readFileSync(path.join(ROOT, 'themes', themeFile), 'utf8')).colors;
  const v = (id, fb) => t[id] || fb;
  return `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:GM;src:url(data:font/woff2;base64,${font}) format('woff2')}
:root{
  --vscode-editor-font-family: GM, monospace;
  --vscode-editor-background: ${v('editor.background')};
  --vscode-sideBar-background: ${v('sideBar.background')};
  --vscode-foreground: ${v('foreground')};
  --vscode-descriptionForeground: ${v('descriptionForeground')};
  --vscode-panel-border: ${v('panel.border')};
  --vscode-activityBar-activeBorder: ${v('activityBar.activeBorder')};
  --vscode-list-hoverBackground: ${v('list.hoverBackground')};
  --vscode-testing-iconPassed: ${v('testing.iconPassed')};
  --vscode-testing-iconFailed: ${v('testing.iconFailed')};
  --vscode-testing-iconQueued: ${v('testing.iconQueued')};
}
${css}
</style>${body}<script>
window.acquireVsCodeApi = () => ({ postMessage(){} });
${js}
window.dispatchEvent(new MessageEvent('message',{data:{type:'state',state:${JSON.stringify(STATE)}}}));
</script>`;
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const [mode, file] of [['dark', 'ruoste-color-theme.json'], ['light', 'ruoste-paperi-color-theme.json']]) {
  const pg = await browser.newPage({ viewport: { width: 1080, height: 720 }, deviceScaleFactor: 2 });
  await pg.setContent(page(file), { waitUntil: 'load' });
  await pg.waitForTimeout(300);
  await pg.screenshot({ path: `preview/pipelines-${mode}.png`, fullPage: true });
  const cards = await pg.$$eval('.repo', (n) => n.length);
  const runs = await pg.$$eval('.runs li', (n) => n.length);
  console.log(`✓ preview/pipelines-${mode}.png  cards=${cards} runs=${runs}`);
  if (cards !== 7 || runs !== 8) { console.error('  state did not bind'); process.exitCode = 1; }
  await pg.close();
}
await browser.close();
