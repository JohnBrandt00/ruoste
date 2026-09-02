import { createHighlighter } from 'shiki';
import fs from 'node:fs';
const theme = JSON.parse(fs.readFileSync('themes/ruoste-color-theme.json','utf8'));
const hl = await createHighlighter({ themes:[theme], langs:['csharp','typescript'] });
const DEFAULT = theme.colors['editor.foreground'].toUpperCase();

for (const [lang,file] of [['csharp','sample.cs'],['typescript','sample.ts']]) {
  const code = fs.readFileSync(`preview/${file}`,'utf8');
  const { tokens } = hl.codeToTokens(code, { lang, theme: theme.name, includeExplanation: true });
  const fallback = new Map();
  let total = 0, colored = 0;
  for (const line of tokens) for (const t of line) {
    const txt = t.content.trim();
    if (!txt) continue;
    total++;
    const col = (t.color||'').toUpperCase();
    if (col === DEFAULT || !col) {
      const scopes = (t.explanation?.[0]?.scopes||[]).map(s=>s.scopeName);
      const deepest = scopes[scopes.length-1] || '?';
      if (!/^(source|meta\.(block|body|brace)|punctuation\.section)/.test(deepest) || /entity|storage|keyword|support|variable|constant/.test(deepest)) {
        const k = deepest;
        if (!fallback.has(k)) fallback.set(k, new Set());
        if (fallback.get(k).size < 4) fallback.get(k).add(txt);
      }
    } else colored++;
  }
  console.log(`\n══ ${lang.toUpperCase()}  ${colored}/${total} tokens themed (${(100*colored/total).toFixed(1)}%)`);
  const rows = [...fallback.entries()].sort((a,b)=>b[1].size-a[1].size);
  if (!rows.length) console.log('   no meaningful fallbacks');
  for (const [scope, ex] of rows.slice(0,28))
    console.log(`   ${scope.padEnd(58)} ${[...ex].slice(0,3).join(' · ')}`);
}
