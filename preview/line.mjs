import { createHighlighter } from 'shiki';
import fs from 'node:fs';
const theme = JSON.parse(fs.readFileSync('themes/ruoste-color-theme.json','utf8'));
const hl = await createHighlighter({ themes:[theme], langs:['csharp','typescript'] });
const P = { '#C57749':'rust','#E0A37B':'rust_hi','#C7A560':'ochre','#8DA668':'moss',
  '#51A499':'verdigris','#72C0B5':'verd_hi','#7496B4':'blueprint','#C76067':'madder',
  '#887E6D':'graphite','#A6A196':'mute','#E4DFD3':'fg','#6B665C':'dim' };
const nm = c => P[(c||'').toUpperCase()] ?? c;
for (const [lang,file,want] of [['typescript','sample.ts',[22,25,26,31,58]],
                                ['csharp','sample.cs',[8,9,36,37,38]]]) {
  const src = fs.readFileSync(`preview/${file}`,'utf8');
  const { tokens } = hl.codeToTokens(src, { lang, theme: theme.name });
  console.log(`\n══ ${file}`);
  for (const n of want) {
    const row = tokens[n-1]; if (!row) continue;
    console.log(`  ${String(n).padStart(3)} │ ` +
      row.filter(t=>t.content.trim()).map(t=>`${t.content.trim()}·${nm(t.color)}`).join('  '));
  }
}
