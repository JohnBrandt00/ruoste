// Resolves icons exactly as VS Code does: through the icon theme JSON,
// with iconPath relative to the theme file.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const THEME_FILE = 'themes/ruoste-icon-theme.json';
const BASE = path.dirname(THEME_FILE);
const T = JSON.parse(fs.readFileSync(THEME_FILE, 'utf8'));
const C = JSON.parse(fs.readFileSync('themes/ruoste-color-theme.json','utf8')).colors;
const b64 = p => fs.readFileSync(p).toString('base64');
const FONT = 'node_modules/geist/dist/fonts/geist-mono';

let misses = 0;
function iconFor(name, isFolder, expanded) {
  const tbl = isFolder
    ? (expanded ? T.folderNamesExpanded : T.folderNames)
    : T.fileNames;
  const lower = name.toLowerCase();
  let key = tbl?.[name] ?? tbl?.[lower];
  if (!key && !isFolder) {
    const parts = lower.split('.');
    for (let i = 1; i < parts.length; i++) {
      const ext = parts.slice(i).join('.');
      if (T.fileExtensions?.[ext]) { key = T.fileExtensions[ext]; break; }
    }
  }
  if (!key) key = isFolder ? (expanded ? T.folderExpanded : T.folder) : T.file;
  const def = T.iconDefinitions[key];
  if (!def) { misses++; return { svg:'', key:'(none)' }; }
  const p = path.join(BASE, def.iconPath);          // ← the resolution under test
  if (!fs.existsSync(p)) { misses++; return { svg:'', key }; }
  return { svg: fs.readFileSync(p,'utf8'), key };
}

// the user's actual tree, from their screenshot
const TREE = [
  [0,'RADIOHUB','fo',1],  [1,'.cursor','fo',0], [1,'apps','fo',0], [1,'data','fo',0],
  [1,'deploy','fo',0],    [1,'docs','fo',1],
  [2,'deploy','fo',1],    [3,'scripts','fo',1],
  [4,'build-images.sh','f'],[4,'deploy-chart.sh','f'],[4,'etcd-backup.sh','f'],
  [4,'init-control-plane.sh','f'],[4,'install-addons.sh','f'],[4,'install-buildkit.sh','f'],
  [4,'install-certmanager.sh','f'],[4,'install-cni.sh','f'],[4,'install-redis.sh','f'],
  [4,'install-registry.sh','f'],[4,'install-ui.sh','f'],[4,'join-worker.sh','f'],
  [4,'node-common.sh','f'],[4,'node-preflight.sh','f'],[4,'README.md','f'],
  [4,'rh-ssh.sh','f'],[4,'verify-cluster.sh','f'],
  [3,'01-network.md','f'],[3,'02-nodes.md','f'],[3,'03-cluster.md','f'],
  [3,'04-registry.md','f'],[3,'05-images.md','f'],[3,'06-storage.md','f'],
  [3,'07-external-services.md','f'],[3,'08-helm-deploy.md','f'],[3,'09-ingress-access.md','f'],
  [3,'10-operations.md','f'],[3,'BUILD-LOG.md','f'],[3,'README.md','f'],
  [2,'CORPUS.md','f'],[2,'DEPLOYMENT-PI.md','f'],[2,'MIGRATIONS.md','f'],
  [2,'PROGRESS.md','f','M'],[2,'SCALING-PLAN.md','f'],
  [1,'guanshiyin','fo',1],[2,'radiohub_eval','fo',0],
  [2,'.env.example','f'],[2,'compare_models.py','f'],[2,'decode.py','f'],
  [2,'eval_wer.py','f'],[2,'finetune.py','f'],[2,'llm-ctl.sh','f'],
  [2,'prompt_compare.py','f'],[2,'requirements.txt','f'],[2,'Dockerfile','f'],
  [1,'RadioHub.sln','f'],[1,'Directory.Build.props','f'],[1,'global.json','f'],
  [1,'package.json','f'],[1,'tsconfig.json','f'],[1,'pnpm-lock.yaml','f'],
  [1,'docker-compose.yml','f'],[1,'.gitignore','f'],[1,'LICENSE','f'],
];

const rows = TREE.map(([d,name,kind,exp,badge]) => {
  const { svg } = iconFor(name, kind==='fo', !!exp);
  return `<div class="row" style="padding-left:${6+d*13}px">
    <span class="tw">${kind==='fo' ? (exp?'⌄':'›') : ''}</span>
    <span class="ico">${svg}</span><span class="lbl">${name}</span>
    ${badge?`<span class="bg">${badge}</span>`:''}</div>`;
}).join('');

const html = `<!doctype html><meta charset=utf-8><style>
@font-face{font-family:GM;src:url(data:font/woff2;base64,${b64(`${FONT}/GeistMono-Regular.woff2`)}) format('woff2')}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:GM,monospace;background:${C['sideBar.background']};width:360px;
     color:${C['sideBar.foreground']};font-size:12px;padding-bottom:8px}
.hd{height:35px;display:flex;align-items:center;padding:0 12px;font-size:10.5px;
    letter-spacing:.16em;text-transform:uppercase;color:${C['sideBarTitle.foreground']};
    border-bottom:1px solid ${C['sideBarSectionHeader.border']}}
.row{display:flex;align-items:center;height:22px;gap:5px}
.tw{width:11px;font-size:9px;color:${C['editorLineNumber.foreground']};flex:0 0 11px;text-align:center}
.ico{width:16px;height:16px;flex:0 0 16px;display:inline-flex}
.ico svg{width:16px;height:16px}
.lbl{white-space:nowrap}
.bg{margin-left:auto;margin-right:10px;color:${C['gitDecoration.modifiedResourceForeground']}}
</style><div class="hd">Explorer</div>${rows}`;

const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const pg = await browser.newPage({ viewport:{width:360,height:1400}, deviceScaleFactor:2 });
await pg.setContent(html,{waitUntil:'load'});
await pg.screenshot({ path:'preview/icons-e2e.png', fullPage:true });
await browser.close();
console.log(`rendered ${TREE.length} rows · unresolved icons: ${misses}`);
process.exit(misses ? 1 : 0);
