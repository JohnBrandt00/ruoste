# Contributing

Nothing in `themes/` or `icons/` is written by hand — they are generated from
`build/`. Edit the generators, run `npm run build`, commit the result. CI fails
if the committed output has drifted from what the generators produce.

`BUILD.md` explains the pipeline and the two path rules that have each caused a
shipped bug.

```bash
npm install
npm run build     # regenerate themes, icons, product icon font
npm run check     # tsc against @types/vscode + unit tests + package validation
npm run verify    # tokenize real C#/TS through the actual TextMate grammars
npm run preview   # render workbench screenshots
npm run package   # build the .vsix
```

`npm run check` is the one that matters before a commit. It typechecks every
`vscode.*` call against the real 1.85 API definitions, so a wrong method name or
signature fails locally instead of at runtime in someone's editor.
