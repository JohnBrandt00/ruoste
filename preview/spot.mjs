// Asserts that specific tokens land on specific palette ROLES, not specific hexes.
// Roles are read back out of the theme file, so this survives palette changes.
import { createHighlighter } from 'shiki';
import fs from 'node:fs';

const theme = JSON.parse(fs.readFileSync('themes/ruoste-color-theme.json', 'utf8'));
const hl = await createHighlighter({ themes: [theme], langs: ['csharp', 'typescript'] });

// derive role -> hex from the theme's own semantic rules, so nothing is hardcoded
const S = theme.semanticTokenColors;
const ROLE = {
  rust:      S.keyword.foreground,
  ochre:     S.method.foreground,
  verdigris: S.class.foreground,
  verd_hi:   S.interface.foreground,
  blueprint: S.number.foreground,
  moss:      S.string.foreground,
  graphite:  S.comment.foreground,
  mute:      S.parameter.foreground,
  fg:        S.property.foreground,
};
const NAME = Object.fromEntries(Object.entries(ROLE).map(([k, v]) => [v.toUpperCase(), k]));
const roleOf = (hex) => NAME[(hex || '').toUpperCase()] ?? hex;

/** Find the line containing `anchor`, then the exact token `text` on it.
 *  Anchored to source text, not line numbers, so edits to the sample can't rot it. */
function tokenRole(tokens, src, anchor, text) {
  const i = src.findIndex((l) => l.includes(anchor));
  if (i < 0) return `(no line matching ${JSON.stringify(anchor)})`;
  const t = (tokens[i] || []).find((x) => x.content.trim() === text);
  return t ? roleOf(t.color) : `(no token ${JSON.stringify(text)} on that line)`;
}

// The TextMate layer is the FALLBACK. In real VS Code, Roslyn and the TS server
// emit semantic tokens that win over it, so assert that layer separately.
const SEMANTIC = [
  ['controlKeyword',  'rust',      'if / foreach / return in C#'],
  ['keyword',         'rust',      'keywords'],
  ['class',           'verdigris', 'C# and TS classes'],
  ['interface',       'verd_hi',   'interfaces'],
  ['struct',          'verdigris', 'C# structs'],
  ['enumMember',      'blueprint', 'enum members'],
  ['method',          'ochre',     'methods'],
  ['function',        'ochre',     'functions'],
  ['parameter',       'mute',      'parameters'],
  ['property',        'fg',        'properties'],
  ['string',          'moss',      'strings'],
  ['number',          'blueprint', 'numeric literals'],
  ['comment',         'graphite',  'comments'],
  ['stringVerbatim',  'moss',      'C# verbatim strings'],
  ['xmlDocCommentName','verdigris','C# xml doc tags'],
  ['regexAnchor',     'rust',      'regex anchors inside C# strings'],
  ['decorator',       'rust',      'TS decorators'],
  ['typeParameter',   'verd_hi',   'generics'],
];

// KNOWN UPSTREAM: the C# TextMate grammar mis-scopes control keywords for the rest
// of a block after `await foreach (x in a.b.C())` — `if` comes out as
// entity.name.function.cs. Roslyn's semantic tokens correct it in the editor, so it
// is asserted above via controlKeyword rather than here.

const CASES = {
  csharp: { file: 'preview/sample.cs', want: [
    ['using System.Text',                 'using',           'rust',      'using directive'],
    ['namespace RadioHub',                'namespace',       'rust',      'namespace keyword'],
    ['[ApiController]',                   'ApiController',   'verdigris', 'attribute — the C# grammar emits entity.name.type, same as a class'],
    ['public sealed partial class',       'class',           'rust',      'storage keyword'],
    ['public sealed partial class',       'ClipRecorder',    'verdigris', 'declared type'],
    ['public sealed partial class',       'IAsyncDisposable','verdigris', 'interface reference'],
    ['where TSink',                       'notnull',         'rust',      'generic constraint'],
    ['SquelchFloorDbfs =',                'const',           'rust',      'modifier'],
    ['SquelchFloorDbfs =',                '27.3',            'blueprint', 'numeric literal'],
    ['MaxBurst = TimeSpan',               'TimeSpan',        'verdigris', 'framework type'],
    ['MaxBurst = TimeSpan',               'FromMinutes',     'ochre',     'static method call'],
    ['await foreach',                     'await',           'rust',      'control keyword'],
    ['await foreach',                     'ReadAllAsync',    'ochre',     'method call'],
    ['IsDigital: true',                   'true',            'blueprint', 'boolean literal'],
    ['=> "analog"',                       '"analog"',        'moss',      'string literal'],
    ['/// <summary>',                     '///',             'graphite',  'xml doc comment'],
  ]},
  typescript: { file: 'preview/sample.ts', want: [
    ['import { z }',                      'import',          'rust',      'import keyword'],
    ['export const ClipSchema',           'const',           'rust',      'declaration keyword'],
    ['id:       z.string()',              'string',          'ochre',     'z.string() is a method call here, not the primitive type'],
    ['export type Clip',                  'type',            'rust',      'type alias keyword'],
    ['interface TunerOptions',            'interface',       'rust',      'interface keyword'],
    ['interface TunerOptions',            'TunerOptions',    'verd_hi',   'declared interface'],
    ['readonly source',                   'readonly',        'rust',      'modifier'],
    ['squelch?: number',                  'number',          'rust',      'primitive type in annotation position'],
    ['const enum Band',                   '136',             'blueprint', 'enum member value'],
    ['@Injectable',                       '@Injectable',     'rust',      'decorator'],
    ['MAX_CLIPS',                         '1_999',           'blueprint', 'numeric separator literal'],
    ['get idle()',                        'get',             'rust',      'accessor keyword'],
    ['get idle()',                        'boolean',         'rust',      'primitive type'],
    ['async *stream',                     'async',           'rust',      'modifier'],
    ['console.warn',                      'warn',            'ochre',     'method call'],
    ['      continue;',                   'continue',        'rust',      'control keyword'],
  ]},
};

let pass = 0; const fails = [];

console.log('══ SEMANTIC LAYER (what Roslyn / the TS server actually render)');
for (const [token, expect, why] of SEMANTIC) {
  const rule = S[token];
  const got = rule ? roleOf(rule.foreground) : '(undefined)';
  if (got === expect) { pass++; console.log(`  ok   ${token.padEnd(20)} ${expect.padEnd(10)} ${why}`); }
  else { fails.push(`semantic ${token}: want ${expect}, got ${got}`);
         console.log(`  FAIL ${token.padEnd(20)} want ${expect}, got ${got}`); }
}
for (const [lang, { file, want }] of Object.entries(CASES)) {
  const raw = fs.readFileSync(file, 'utf8');
  const src = raw.split('\n');
  const { tokens } = hl.codeToTokens(raw, { lang, theme: theme.name });
  console.log(`\n══ ${lang.toUpperCase()} (TextMate fallback layer)`);
  for (const [anchor, text, expect, why] of want) {
    const got = tokenRole(tokens, src, anchor, text);
    if (got === expect) { pass++; console.log(`  ok   ${text.padEnd(18)} ${expect.padEnd(10)} ${why}`); }
    else { fails.push(`${lang} ${text}: want ${expect}, got ${got}`);
           console.log(`  FAIL ${text.padEnd(18)} want ${expect}, got ${got}`); }
  }
}
console.log(`\n${pass} correct · ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
