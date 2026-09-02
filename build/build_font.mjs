// RADIOHUB — build the Phosphor product-icon font (SVG -> SVG font -> TTF -> WOFF2)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SVGIcons2SVGFontStream } from 'svgicons2svgfont';
import svg2ttf from 'svg2ttf';
import ttf2woff2 from 'ttf2woff2';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC  = path.join(ROOT, 'node_modules/@phosphor-icons/core/assets/regular');
const OUT  = path.join(ROOT, 'themes');
const DESCENT = Number(process.argv[2] ?? 0);

// codicon -> phosphor map, exported from python as json
const MAP = JSON.parse(fs.readFileSync(path.join(ROOT, 'build/producticons.json'), 'utf8'));
const glyphs = [...new Set(Object.values(MAP))].sort();

// assign a PUA codepoint per unique glyph
const cp = new Map();
glyphs.forEach((g, i) => cp.set(g, 0xE000 + i));

const svgFontPath = path.join(ROOT, 'build/phosphor.svg');
await new Promise((resolve, reject) => {
  const stream = new SVGIcons2SVGFontStream({
    fontName: 'phosphor',
    fontHeight: 1000,
    descent: DESCENT,
    normalize: true,
    centerHorizontally: true,
    centerVertically: true,
    log: () => {},
  });
  stream.pipe(fs.createWriteStream(svgFontPath)).on('finish', resolve).on('error', reject);
  for (const g of glyphs) {
    const rs = fs.createReadStream(path.join(SRC, `${g}.svg`));
    rs.metadata = { unicode: [String.fromCodePoint(cp.get(g))], name: g.replace(/[^a-z0-9]/g, '_') };
    stream.write(rs);
  }
  stream.end();
});

const ttf = Buffer.from(svg2ttf(fs.readFileSync(svgFontPath, 'utf8'), {
  copyright: 'Phosphor Icons (MIT) — packaged for RADIOHUB Oxide',
  version: 'Version 1.1',
}).buffer);
fs.writeFileSync(path.join(ROOT, 'build/phosphor.ttf'), ttf);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'phosphor.woff2'), ttf2woff2(ttf));

// product icon theme json — fontCharacter is relative to the theme file
const iconDefinitions = {};
for (const [codicon, glyph] of Object.entries(MAP))
  iconDefinitions[codicon] = { fontCharacter: '\\' + cp.get(glyph).toString(16).toUpperCase() };

fs.writeFileSync(path.join(OUT, 'ruoste-product-icon-theme.json'), JSON.stringify({
  $schema: 'vscode://schemas/product-icon-theme',
  fonts: [{
    id: 'phosphor',
    src: [{ path: './phosphor.woff2', format: 'woff2' }],
    weight: 'normal', style: 'normal',
  }],
  iconDefinitions,
}, null, 2) + '\n');

console.log(`descent ${DESCENT} · ${glyphs.length} glyphs · ${Object.keys(MAP).length} codicon ids`);
console.log(`woff2 ${(fs.statSync(path.join(OUT,'phosphor.woff2')).size/1024).toFixed(1)} KB`);
