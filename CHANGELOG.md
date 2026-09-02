# Changelog

## 2.1.0

- **`RUOSTE: Install Geist Mono`** — the extension now installs the bundled font
  into the OS font directory itself, per platform, including the Windows registry
  entries. It also detects a user `editor.fontFamily` override shadowing the
  theme default and offers to fix it. Shipping the files and telling you to copy
  them was not good enough.
- **GitHub Actions panel** — activity bar container with runs → jobs → steps,
  native GitHub sign-in, GHE support, adaptive polling, re-run/cancel, and a
  status bar item. Status colours reference theme colour ids, so they track
  whichever RUOSTE variant is active.
- Repo layout: extension root is the repo root, generators are portable (no
  absolute paths), `npm run build|check|verify|package`, and a CI workflow that
  fails if the committed generated output has drifted.
- `check_package.py` now also verifies the extension host: main entry, every
  declared command is wired, menus reference real commands, viewsWelcome
  references real views, and the code only reads declared settings keys.
- `preview/spot.mjs` rewritten — 50 assertions anchored to source text rather
  than line numbers, covering the semantic layer as well as the TextMate one.
- Fixed invalid C# in the sample (`yield return` from a `ValueTask` method).

  Known upstream: the C# TextMate grammar mis-scopes control keywords for the
  rest of a block following `await foreach (x in a.b.C())`. Roslyn's semantic
  tokens override it in the editor, so it is not visible in normal use.

## 2.0.0 — RUOSTE

Renamed from **RADIOHUB Oxide**. Finnish for *rust*. This is a new extension id,
so uninstall the old one.

- **Geist Mono is now bundled** (SIL OFL) — nine TTFs in `fonts/`, with per-OS
  install steps in the README. VS Code cannot install fonts itself.
- **Font applied in nine places**, not one: editor, terminal, debug console,
  notebook output, chat, inlay hints, CodeLens, SCM input, plus ligatures.
  Documented that user `settings.json` beats extension defaults, which is the
  usual reason a theme's font appears not to work.
- **Product icon theme** — 206 Phosphor glyphs compiled to a 20 KB WOFF2 and
  mapped to 367 codicon ids, so the whole UI is Phosphor, not just the files.
  Glyph centring measured empirically rather than guessed (0.4 % off centre).
- **RUOSTE Kontrasti** — a third theme on `hc-black`. Every syntax colour clears
  WCAG AAA; contrast borders enabled throughout.
- File icons gain a **high-contrast set** — 426 SVGs across three modes.
- `build/check_package.py` validates every path the way VS Code resolves it, and
  every codicon id against the real font cmap.

## 1.0.1

- **Fixed: no file icons appeared.** `iconPath` resolves relative to the icon
  theme file, not the extension root. Paths said `./icons/…` from `themes/`, so
  all 280 lookups missed. Now `../icons/…`.
- New folder mappings: `apps`, `packages`, `modules`; `.cursor`, `.claude`,
  `.devcontainer`; and a deploy group covering `k8s`, `helm`, `terraform`, `ops`.

## 1.0.0

- Dark and light themes, 765 workbench colours each.
- 96 semantic token rules, 116 TextMate rules across 421 scopes.
- Phosphor duotone file icon theme.
