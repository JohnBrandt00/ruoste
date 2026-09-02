import { createHighlighter } from 'shiki';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const R = (p) => fs.readFileSync(p, 'utf8');
const b64 = (p) => fs.readFileSync(p).toString('base64');
const FONT = 'node_modules/geist/dist/fonts/geist-mono';
const ICON = 'icons';

const themes = {
  dark:  JSON.parse(R('themes/ruoste-color-theme.json')),
  light: JSON.parse(R('themes/ruoste-paperi-color-theme.json')),
  contrast: JSON.parse(R('themes/ruoste-kontrasti-color-theme.json')),
};
const PICON = JSON.parse(R('themes/ruoste-product-icon-theme.json'));
const PFONT = fs.readFileSync('themes/phosphor.woff2').toString('base64');
const pchar = id => {
  const d = PICON.iconDefinitions[id];
  return d ? String.fromCodePoint(parseInt(d.fontCharacter.replace('\\',''),16)) : '';
};
const icons = JSON.parse(R('themes/ruoste-icon-theme.json'));

const hl = await createHighlighter({
  themes: [themes.dark, themes.light, themes.contrast],
  langs: ['csharp', 'typescript'],
});

// ── sidebar tree ──────────────────────────────────────────────────────────
const TREE = [
  ['fo', 0, 'RADIOHUB.RECEIVER', 'o_root_x'],
  ['fo', 1, '.github',      'o_github'],
  ['fo', 1, 'src',          'o_src_x'],
  ['fo', 2, 'Capture',      'o_services'],
  ['f',  3, 'ClipRecorder.cs',   'f_cs',   'active'],
  ['f',  3, 'Tuner.cs',          'f_cs'],
  ['f',  3, 'Frame.cs',          'f_cs'],
  ['fo', 2, 'types',        'o_types'],
  ['fo', 2, 'components',   'o_components'],
  ['f',  2, 'clip-library.ts',   'f_ts'],
  ['f',  2, 'library.tsx',       'f_tsx'],
  ['f',  2, 'styles.scss',       'f_sass'],
  ['fo', 1, 'tests',        'o_test'],
  ['f',  2, 'Recorder.Tests.cs', 'f_test'],
  ['fo', 1, 'node_modules', 'o_node'],
  ['f',  1, 'RadioHub.csproj',   'f_csproj'],
  ['f',  1, 'RadioHub.sln',      'f_sln'],
  ['f',  1, 'package.json',      'f_npm'],
  ['f',  1, 'tsconfig.json',     'f_tsconfig'],
  ['f',  1, 'Dockerfile',        'f_docker'],
  ['f',  1, '.env.local',        'f_env'],
  ['f',  1, 'pnpm-lock.yaml',    'f_lock'],
  ['f',  1, 'README.md',         'f_readme'],
  ['f',  1, 'LICENSE',           'f_license'],
];

const SUF = { dark:'d', light:'l', contrast:'c' };
const svg = (key, mode) => {
  const p = path.join(ICON, `${key}_${SUF[mode]}.svg`);
  return fs.existsSync(p) ? R(p) : '';
};

// activity bar glyphs (phosphor bold, tinted at render time)
const AB = ['files','search','source-control','debug-alt','extensions','beaker','settings-gear'];

function page(mode, lang, code, filename) {
  const T = themes[mode];
  const c = T.colors, k = (id, f) => c[id] ?? f;
  const themeName = T.name;
  const html = hl.codeToHtml(code, { lang, theme: themeName });
  const lines = code.replace(/\n$/, '').split('\n').length;
  const gutter = Array.from({ length: lines }, (_, i) =>
    `<div class="ln${i === 0 ? ' cur' : ''}">${i + 1}</div>`).join('');

  const tree = TREE.map(([kind, depth, label, icon, state]) => `
    <div class="row ${state === 'active' ? 'sel' : ''}" style="padding-left:${8 + depth * 14}px">
      ${kind === 'fo' ? `<span class="tw">${pchar('chevron-down')}</span>` : '<span class="tw"></span>'}
      <span class="ico">${svg(icon, mode)}</span><span class="lbl">${label}</span>
    </div>`).join('');

  const tabs = [
    ['ClipRecorder.cs', 'f_cs', lang === 'csharp'],
    ['clip-library.ts', 'f_ts', lang === 'typescript'],
    ['RadioHub.csproj', 'f_csproj', false],
  ].map(([n, i, act]) => `
    <div class="tab ${act ? 'act' : ''}">
      <span class="ico">${svg(i, mode)}</span><span>${n}</span>
      <span class="x">×</span>
    </div>`).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face{font-family:GeistMono;src:url(data:font/woff2;base64,${b64(`${FONT}/GeistMono-Regular.woff2`)}) format('woff2');font-weight:400;font-style:normal}
  @font-face{font-family:GeistMono;src:url(data:font/woff2;base64,${b64(`${FONT}/GeistMono-Medium.woff2`)}) format('woff2');font-weight:500;font-style:normal}
  @font-face{font-family:GeistMono;src:url(data:font/woff2;base64,${b64(`${FONT}/GeistMono-SemiBold.woff2`)}) format('woff2');font-weight:600;font-style:normal}
  @font-face{font-family:GeistMono;src:url(data:font/woff2;base64,${b64(`${FONT}/GeistMono-Italic.woff2`)}) format('woff2');font-weight:400;font-style:italic}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:GeistMono,monospace;font-size:12.5px;background:${k('editor.background')};
       color:${k('foreground')};width:1440px;height:940px;overflow:hidden;
       -webkit-font-smoothing:antialiased}
  .win{display:flex;flex-direction:column;height:940px}
  .title{height:34px;background:${k('titleBar.activeBackground')};border-bottom:1px solid ${k('titleBar.border')};
         display:flex;align-items:center;justify-content:center;color:${k('titleBar.activeForeground')};
         font-size:11px;letter-spacing:.14em;text-transform:uppercase;position:relative}
  .title .brand{position:absolute;left:14px;letter-spacing:.22em;color:${k('foreground')};font-weight:600}
  .mid{flex:1;display:flex;min-height:0}
  .ab{width:48px;background:${k('activityBar.background')};border-right:1px solid ${k('activityBar.border')};
      display:flex;flex-direction:column;align-items:center;padding-top:6px;gap:2px}
  .ab .it{width:48px;height:44px;display:flex;align-items:center;justify-content:center;
          color:${k('activityBar.inactiveForeground')}}
  .ab .it svg{width:20px;height:20px}
  @font-face{font-family:phosphor;src:url(data:font/woff2;base64,${PFONT}) format('woff2')}
  .pi{font:normal normal normal 20px/1 phosphor;display:inline-block}
  .row .tw{font-family:phosphor!important;font-size:13px}
  .ab .it.on{color:${k('activityBar.foreground')};box-shadow:inset 2px 0 0 ${k('activityBar.activeBorder')}}
  .sb{width:262px;background:${k('sideBar.background')};border-right:1px solid ${k('sideBar.border')};
      display:flex;flex-direction:column}
  .sbh{height:35px;display:flex;align-items:center;padding:0 12px;font-size:10.5px;
       letter-spacing:.16em;text-transform:uppercase;color:${k('sideBarTitle.foreground')};
       border-bottom:1px solid ${k('sideBarSectionHeader.border')}}
  .row{display:flex;align-items:center;height:22px;gap:5px;color:${k('sideBar.foreground')};font-size:12px}
  .row.sel{background:${k('list.activeSelectionBackground')};color:${k('list.activeSelectionForeground')};
           box-shadow:inset 2px 0 0 ${k('activityBar.activeBorder')}}
  .row .tw{width:11px;font-size:8px;color:${k('editorLineNumber.foreground')};flex:0 0 11px}
  .ico{width:16px;height:16px;display:inline-flex;flex:0 0 16px}
  .ico svg{width:16px;height:16px;display:block}
  .lbl{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ed{flex:1;display:flex;flex-direction:column;min-width:0;background:${k('editor.background')}}
  .tabs{height:35px;background:${k('editorGroupHeader.tabsBackground')};display:flex;
        border-bottom:1px solid ${k('editorGroupHeader.tabsBorder')}}
  .tab{display:flex;align-items:center;gap:7px;padding:0 12px;font-size:12px;
       background:${k('tab.inactiveBackground')};color:${k('tab.inactiveForeground')};
       border-right:1px solid ${k('tab.border')}}
  .tab.act{background:${k('tab.activeBackground')};color:${k('tab.activeForeground')};
           box-shadow:inset 0 2px 0 ${k('tab.activeBorderTop')}}
  .tab .x{opacity:.5;font-size:14px;margin-left:6px}
  .crumb{height:24px;display:flex;align-items:center;padding:0 16px;gap:6px;font-size:11.5px;
         color:${k('breadcrumb.foreground')};background:${k('editor.background')}}
  .crumb b{color:${k('breadcrumb.activeSelectionForeground')};font-weight:500}
  .code{flex:1;display:flex;overflow:hidden;position:relative}
  .gut{padding:8px 12px 0 16px;text-align:right;color:${k('editorLineNumber.foreground')};
       font-size:12px;line-height:19px;user-select:none;background:${k('editor.background')}}
  .gut .cur{color:${k('editorLineNumber.activeForeground')}}
  .pane{flex:1;overflow:hidden;padding:8px 0 0 4px;position:relative}
  .pane pre{background:transparent!important;line-height:19px;font-size:12.5px}
  .pane code{font-family:GeistMono,monospace}

  .hl{position:absolute;left:0;right:0;top:8px;height:19px;background:${k('editor.lineHighlightBackground')}}
  .mm{width:74px;border-left:1px solid ${k('editorGroup.border')};background:${k('minimap.background')};
      padding:8px 6px;opacity:.5}
  .mm i{display:block;height:2px;margin-bottom:2px;background:${k('foreground')};opacity:.25;border-radius:0}
  .st{height:24px;background:${k('statusBar.background')};border-top:1px solid ${k('statusBar.border')};
      display:flex;align-items:center;gap:18px;padding:0 12px;font-size:11px;
      color:${k('statusBar.foreground')};letter-spacing:.06em}
  .st .r{margin-left:auto;display:flex;gap:18px}
  .st .rm{background:${k('statusBarItem.remoteBackground')};color:${k('statusBarItem.remoteForeground')};
          padding:0 10px;height:24px;display:flex;align-items:center;margin:0 12px 0 -12px;
          letter-spacing:.14em}
  .err{color:${k('statusBarItem.errorBackground')}}
  </style></head><body><div class="win">
   <div class="title"><span class="brand">RADIOHUB</span>${filename} — radiohub.receiver</div>
   <div class="mid">
     <div class="ab">${AB.map((n, i) => `<div class="it ${i === 0 ? 'on' : ''}"><span class="pi">${pchar(n)}</span></div>`).join('')}</div>
     <div class="sb"><div class="sbh">Explorer</div>${tree}</div>
     <div class="ed">
       <div class="tabs">${tabs}</div>
       <div class="crumb">src <span>›</span> Capture <span>›</span> <b>${filename}</b></div>
       <div class="code">
         <div class="gut">${gutter}</div>
         <div class="pane"><div class="hl"></div>${html}</div>
         <div class="mm">${Array.from({ length: 60 }, () =>
           `<i style="width:${20 + Math.round(Math.random() * 50)}px"></i>`).join('')}</div>
       </div>
     </div>
   </div>
   <div class="st"><span class="rm">◧ WSL: ubuntu</span><span>⑂ main*</span>
     <span class="err">⊗ 0  ⚠ 0</span><span>↻ 1,999 clips</span>
     <div class="r"><span>Ln 34, Col 22</span><span>UTF-8</span><span>LF</span>
       <span>${lang === 'csharp' ? 'C#' : 'TypeScript'}</span><span>RUOSTE</span></div></div>
  </div></body></html>`;
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const pg = await browser.newPage({ viewport: { width: 1440, height: 940 }, deviceScaleFactor: 2 });
const jobs = [
  ['dark', 'csharp', 'sample.cs', 'ClipRecorder.cs'],
  ['dark', 'typescript', 'sample.ts', 'clip-library.ts'],
  ['light', 'csharp', 'sample.cs', 'ClipRecorder.cs'],
  ['light', 'typescript', 'sample.ts', 'clip-library.ts'],
  ['contrast', 'csharp', 'sample.cs', 'ClipRecorder.cs'],
];
for (const [mode, lang, file, name] of jobs) {
  await pg.setContent(page(mode, lang, R(`preview/${file}`), name), { waitUntil: 'load' });
  await pg.screenshot({ path: `preview/${mode}-${lang}.png` });
  console.log(`✓ preview/${mode}-${lang}.png`);
}
await browser.close();
