import fs from 'node:fs'; import { fileURLToPath } from 'node:url'; import path from 'node:path';
import { chromium } from 'playwright';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAP = JSON.parse(fs.readFileSync(path.join(ROOT,'build/producticons.json'),'utf8'));
const T = JSON.parse(fs.readFileSync(path.join(ROOT,'themes/ruoste-product-icon-theme.json'),'utf8'));
const b64 = fs.readFileSync(path.join(ROOT,'themes/phosphor.woff2')).toString('base64');
const probe = ['files','search','gear','folder','check','close','play','database'];
const chars = probe.map(k => T.iconDefinitions[k].fontCharacter.replace('\\','')).map(h=>String.fromCodePoint(parseInt(h,16)));
const S = 128; // 8x the real 16px render, same em box
const html = `<!doctype html><meta charset=utf-8><style>
@font-face{font-family:phosphor;src:url(data:font/woff2;base64,${b64}) format('woff2')}
*{margin:0;padding:0}body{background:#fff}
.box{width:${S}px;height:${S}px;font:normal normal normal ${S}px/1 phosphor;
     color:#000;display:inline-block;text-align:center;overflow:hidden}
</style>${chars.map(c=>`<span class="box">${c}</span>`).join('')}`;
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p = await b.newPage({viewport:{width:S*probe.length,height:S}});
await p.setContent(html,{waitUntil:'load'});
await p.screenshot({path:path.join(ROOT,'build/fontprobe.png')});
await b.close();
console.log('boxes:',probe.join(' '),'| cell',S);
