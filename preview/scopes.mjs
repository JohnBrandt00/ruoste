import { createHighlighter } from 'shiki';
import fs from 'node:fs';
const theme = JSON.parse(fs.readFileSync('themes/ruoste-color-theme.json','utf8'));
const hl = await createHighlighter({ themes:[theme], langs:['csharp','typescript'] });
const probe = { csharp:['ApiController','Route','apiVersion'], typescript:['Injectable','Inject','host','port','providedIn'] };
for (const [lang,file] of [['csharp','sample.cs'],['typescript','sample.ts']]) {
  const { tokens } = hl.codeToTokens(fs.readFileSync(`preview/${file}`,'utf8'),
    { lang, theme: theme.name, includeExplanation: true });
  console.log(`\n══ ${lang}`);
  const done = new Set();
  for (const line of tokens) for (const t of line) {
    for (const p of probe[lang]) {
      if (t.content.includes(p) && !done.has(p)) {
        done.add(p);
        console.log(`  "${t.content.trim()}"  → ${t.color}`);
        for (const e of t.explanation||[])
          console.log(`      [${e.content}] ${e.scopes.map(s=>s.scopeName).join('  ▸  ')}`);
      }
    }
  }
}
