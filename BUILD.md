# Building RUOSTE

Everything in `ext/themes/` and `ext/icons/` is generated. Edit the sources
here, never the JSON.

```
build/
  palette.py    the nine tones + WCAG contrast checker   ← start here
  workbench.py  765 workbench colour ids per theme
  syntax.py     96 semantic token rules + 116 TextMate rules
  iconspec.py   which Phosphor icon and colour each file type gets
  producticons.py  codicon id -> phosphor glyph (367 ids, 206 glyphs)
  emit_producticons.py  -> build/producticons.json, read by build_font.mjs
  build_font.mjs   SVG -> SVG font -> TTF -> WOFF2 for the product icons
  measure_font.mjs renders the font and measures glyph centring
  icongen.py    duotone recolouring + folder/glyph compositing
  emit_themes.py / emit_icons.py
```

## Regenerate

```bash
npm install                          # @phosphor-icons/core, shiki, playwright, geist, vsce
python3 build/palette.py             # print the palette with contrast ratios
python3 build/emit_themes.py         # -> ext/themes/*-color-theme.json
python3 build/emit_icons.py          # -> ext/icons/*.svg + icon theme json
python3 build/emit_producticons.py   # -> build/producticons.json
node build/build_font.mjs 0          # -> ext/themes/phosphor.woff2 + product icon theme
```

## Verify

The checks run real TextMate grammars through Shiki using the actual theme file,
then render a workbench mock in headless Chromium.

```bash
python3 build/check_package.py # THE one to run: every path resolved as VS Code
                               # resolves it, every codicon id against the font cmap
python3 build/check_icons.py   # every iconPath resolves FROM THE THEME FILE's dir
node preview/icons_e2e.mjs     # renders a real tree through the icon theme json
node preview/audit.mjs    # which scopes fall back to default foreground
node preview/spot.mjs     # asserts specific tokens get specific roles
node preview/line.mjs     # per-line token/colour dump for chosen lines
node preview/render.mjs   # -> preview/{dark,light}-{csharp,typescript}.png
```

`audit.mjs` reporting ~83 % (C#) and ~87 % (TS) themed is expected — the
remainder are variables, properties and object members, which are base
foreground by design.

## Package

```bash
npx vsce package --allow-missing-repository --no-dependencies \
    --baseImagesUrl "https://x.invalid/"
# then restore the relative README image paths, which vsce rewrites:
#   unzip -> cp ext/README.md extension/readme.md -> re-zip
```

## Changing a colour

`palette.py` is the single source. Change a tone there, rerun `palette.py` to
confirm it still clears 4.5:1 against its ground, then rerun both emitters.
Roles are documented at the top of `syntax.py`.


## Two path rules that have already bitten once

1. `iconPath` in a **file** icon theme resolves relative to **the icon theme
   file**, not the extension root. Themes live in `themes/`, icons in `icons/`,
   so the path is `../icons/…`.
2. `fonts[].src[].path` in a **product** icon theme is likewise relative to the
   product icon theme file. That one *is* `./phosphor.woff2`, because the font
   sits beside it in `themes/`.

`check_package.py` asserts both from the right base directory. Do not validate
these from the extension root — it will pass while VS Code shows nothing.
