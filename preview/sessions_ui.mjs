// Renders the real Claude Sessions Chief View (same CSS + JS the extension
// ships, same body markup) against a mock model, light and dark, 400 px wide.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(ROOT, 'media/sessions.css'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'media/sessions.js'), 'utf8');
const panel = fs.readFileSync(path.join(ROOT, 'src/sessions/panel.js'), 'utf8');
const body = /<body>([\s\S]*?)<script/.exec(panel)[1];
const font = fs.readFileSync(path.join(ROOT,
  'node_modules/geist/dist/fonts/geist-mono/GeistMono-Regular.woff2')).toString('base64');

const NOW = Math.floor(Date.now() / 1000);
const MODEL = {
  selected: 's2',
  sessions: [
    { sessionId: 's1', pid: 11, cwd: 'O:/RUOSTE/ruoste', name: 'ruoste main', status: 'working', branch: 'main', owned: false },
    { sessionId: 's2', pid: 12, cwd: 'O:/RUOSTE/radiohub', name: 'radiohub chief', status: 'needsPermission', branch: 'feat/x', owned: false },
    { sessionId: 's3', pid: 13, cwd: 'O:/tmp', name: 'scratch', status: 'waiting', owned: false },
    { sessionId: 's4', pid: 14, cwd: 'O:/old', name: 'old', status: 'ended', owned: false },
  ],
  agents: { ok: true, value: [
    { agentId: 'a1', agentType: 'builder', description: 'Phase 1', model: 'sonnet', effort: 'high', state: 'running', status: 'building', tokens: 48200 },
    { agentId: 'a2', agentType: 'verifier', description: 'Phase 1 check', model: 'opus', state: 'finished', status: 'DONE', report: 'reports/P1-verifier.md', tokens: 1250000 },
  ] },
  ledger: { ok: true, value: { slug: 'x', skipped: 1, entries: [
    { time: '10:02', step: 'P1.T1', agent: 'builder', status: 'DONE', result: 'Tests green', report: 'reports/P1-builder.md' },
    { time: '10:40', step: 'P1.T2', status: 'RULING', ruling: { decision: 'Keep view', why: 'user choice', cost: 'low' } },
  ] } },
  budget: { ok: true, value: { fiveHour: { pct: 42, resetsAt: NOW + 3600 }, sevenDay: { pct: 93, resetsAt: NOW + 86400 }, ts: NOW, stale: false } },
};
const BAD = { ...MODEL, sessions: [], error: 'Could not read sessions.',
  agents: { ok: false, reason: 'missing', detail: 'No transcript found.' },
  ledger: { ok: false, reason: 'missing', detail: 'No chief ledger in this folder.' },
  budget: { ok: false, reason: 'missing', detail: 'Budget data is not available.' } };
// text that must never become markup
const HOSTILE = { ...MODEL, sessions: [{ ...MODEL.sessions[0], name: '<img src=x onerror=window.__pwn=1>' }] };

function page(themeFile, model) {
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
</style><body>${body}<script>
window.__posted = [];
window.acquireVsCodeApi = () => ({ postMessage(m){ window.__posted.push(m); }, setState(){}, getState(){ return null; } });
${js}
window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model:${JSON.stringify(model)}}}));
</script>`;
}

const browser = await chromium.launch();
const SHOTS = [
  ['dark', 'ruoste-color-theme.json', MODEL],
  ['light', 'ruoste-paperi-color-theme.json', MODEL],
  ['empty-dark', 'ruoste-color-theme.json', BAD],
  ['hostile', 'ruoste-color-theme.json', HOSTILE],
];
const fail = (m) => { console.error('  ' + m); process.exitCode = 1; };
for (const [name, theme, model] of SHOTS) {
  const pg = await browser.newPage({ viewport: { width: 400, height: 820 }, deviceScaleFactor: 2 });
  await pg.setContent(page(theme, model), { waitUntil: 'load' });
  const n = (sel) => pg.$$eval(sel, (x) => x.length);
  const sessions = await n('#sessionList button.item');
  const timeline = await n('#timelineList .item');
  const roster = await n('#rosterList .item');
  const selected = await n('#sessionList .item.sel');
  const budget = await pg.$eval('#budget', (b) => b.textContent);
  const overflow = await pg.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (name !== 'hostile') await pg.screenshot({ path: `preview/sessions-${name}.png` });
  console.log(`✓ sessions-${name}  sessions=${sessions} timeline=${timeline} roster=${roster} selected=${selected}`);
  console.log(`  budget: ${budget}`);
  if (sessions !== model.sessions.length) fail('sessions did not bind');
  if (overflow) fail('horizontal overflow at 400 px');
  if (model.ledger.ok && timeline !== model.ledger.value.entries.length) fail('timeline did not bind');
  if (model.agents.ok && roster !== model.agents.value.length) fail('roster did not bind');
  if (model.sessions.some((s) => s.sessionId === model.selected) && selected !== 1) fail('selected session not marked');
  if (await pg.evaluate(() => !!window.__pwn || !!document.querySelector('#sessionList img'))) fail('markup escaped into the page');
  if (model.sessions.length) {
    await pg.click('#sessionList button.item');
    const posted = await pg.evaluate(() => window.__posted.map((m) => m.type));
    if (!posted.includes('ready') || !posted.includes('select')) fail('ready/select not posted');
  }
  if (model.ledger.ok) {
    await pg.click('#timelineList .report');
    const m = await pg.evaluate(() => window.__posted.find((x) => x.type === 'openReport'));
    if (!m || m.sessionId !== model.selected) fail('openReport not posted');
  }
  await pg.close();
}
await browser.close();
