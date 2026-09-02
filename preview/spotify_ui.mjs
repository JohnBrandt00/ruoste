// Renders the real Spotify webview (same CSS + JS the extension ships) against
// mock player state, at true sidebar widths, in both themes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(ROOT, 'media/spotify.css'), 'utf8');
const js  = fs.readFileSync(path.join(ROOT, 'media/spotify.js'), 'utf8');
// the markup is authored in webview.js — lift it out so this can never drift
const wv  = fs.readFileSync(path.join(ROOT, 'src/spotify/webview.js'), 'utf8');
const body = /<body>([\s\S]*?)<script/.exec(wv)[1];

const FONT = 'node_modules/geist/dist/fonts/geist-mono/GeistMono-Regular.woff2';
const font = fs.readFileSync(path.join(ROOT, FONT)).toString('base64');

// a generated cover, so the preview needs no network and ships no one's artwork
const cover = (a, b) => 'data:image/svg+xml;base64,' + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">
     <rect width="600" height="600" fill="${a}"/>
     <rect x="0" y="past" width="600" height="1" fill="${b}"/>
     <g fill="${b}">
       <rect x="60" y="96"  width="300" height="26"/>
       <rect x="60" y="150" width="180" height="26"/>
       <rect x="60" y="300" width="480" height="88"/>
       <rect x="60" y="430" width="240" height="26"/>
       <rect x="60" y="484" width="380" height="26"/>
     </g>
     <circle cx="470" cy="150" r="54" fill="none" stroke="${b}" stroke-width="10"/>
   </svg>`).toString('base64');

const THEMES = {
  dark:  { name: 'ruoste-color-theme.json',        art: cover('#1B1712', '#C57749') },
  light: { name: 'ruoste-paperi-color-theme.json', art: cover('#E7E2D6', '#985934') },
};

const STATE = (art) => ({
  signedIn: true, playing: true, hasDevice: true, deviceName: 'STUDIO',
  volume: 62, shuffle: true, repeat: 'context',
  progress: 78_400, duration: 214_000,
  title: 'Squelch Floor (Nassau Mix)', artist: 'Oxide Transmission',
  album: 'Kaputt', art, uri: 'spotify:track:t1', id: 't1',
  isEpisode: false, dj: true, liked: true, error: undefined,
  queue: [
    { uri: 'spotify:track:1', name: 'Carrier Wave',        artists: [{ name: 'Verdigris' }] },
    { uri: 'spotify:track:2', name: 'Nine Six Hundred',    artists: [{ name: 'Blueprint Co.' }] },
    { uri: 'spotify:track:3', name: 'Paper Ink Oxide',     artists: [{ name: 'Moss & Madder' }] },
    { uri: 'spotify:track:4', name: 'Glen Cove',           artists: [{ name: 'Oxide Transmission' }] },
    { uri: 'spotify:track:5', name: 'Attenuation',         artists: [{ name: 'Graphite' }] },
  ],
});

function page(themeFile, state) {
  const t = JSON.parse(fs.readFileSync(path.join(ROOT, 'themes', themeFile), 'utf8')).colors;
  const v = (id, fb) => t[id] || fb;
  return `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:GM;src:url(data:font/woff2;base64,${font}) format('woff2')}
html,body{margin:0;background:${v('sideBar.background')}}
:root{
  --vscode-editor-font-family: GM, monospace;
  --vscode-sideBar-background: ${v('sideBar.background')};
  --vscode-foreground: ${v('foreground')};
  --vscode-descriptionForeground: ${v('descriptionForeground')};
  --vscode-panel-border: ${v('panel.border')};
  --vscode-activityBar-activeBorder: ${v('activityBar.activeBorder')};
  --vscode-list-hoverBackground: ${v('list.hoverBackground')};
  --vscode-list-activeSelectionBackground: ${v('list.activeSelectionBackground')};
}
${css}
</style>${body}<script>
window.acquireVsCodeApi = () => ({ postMessage(){} });
${js}
window.dispatchEvent(new MessageEvent('message',{data:{type:'state',state:${JSON.stringify(state)}}}));
</script>`;
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const [mode, cfg] of Object.entries(THEMES)) {
  const pg = await browser.newPage({ viewport: { width: 300, height: 720 }, deviceScaleFactor: 2 });
  await pg.setContent(page(cfg.name, STATE(cfg.art)), { waitUntil: 'load' });
  await pg.waitForTimeout(400);
  const shot = `preview/spotify-${mode}.png`;
  await pg.screenshot({ path: shot, fullPage: true });
  // the render is only meaningful if the state actually bound
  const title = await pg.textContent('#title');
  const queue = await pg.$$eval('#queue li', (n) => n.length);
  const hidden = await pg.$eval('#player', (e) => e.hidden);
  console.log(`✓ ${shot}  title=${JSON.stringify(title)}  queue=${queue}  playerHidden=${hidden}`);
  if (hidden || !title || queue !== 5) { console.error('  render did not bind state'); process.exitCode = 1; }
  await pg.close();
}
await browser.close();
