# RUOSTE

*Finnish: **rust** — the oxide, not the language.*

Swiss industrial brutalism for VS Code. Paper, ink and oxide rust; hairline rules
instead of shadows; one accent doing all the work.

Three colour themes, a Phosphor **duotone file icon** set, a Phosphor **product
icon** set that replaces the whole UI chrome, and **Geist Mono in the box**.
Tuned first for **C#** and **TypeScript**.

![RUOSTE — C#](https://raw.githubusercontent.com/JohnBrandt00/ruoste/main/media/preview-dark-csharp.png)

![RUOSTE Paperi — TypeScript](https://raw.githubusercontent.com/JohnBrandt00/ruoste/main/media/preview-light-typescript.png)

---

## Install

```
code --install-extension ruoste-2.0.0.vsix
```

> Upgrading from **RADIOHUB Oxide**? Uninstall it first — the rename makes this a
> separate extension, so both would sit in your list.

Then pick your pieces:

| | |
|---|---|
| **Colour theme** | ⌘K ⌘T — *RUOSTE*, *RUOSTE Paperi*, or *RUOSTE Kontrasti* |
| **File icons** | ⌘⇧P → *Preferences: File Icon Theme* → *RUOSTE (Phosphor Duotone)* |
| **UI icons** | ⌘⇧P → *Preferences: Product Icon Theme* → *RUOSTE (Phosphor)* |

## The font

**Geist Mono is bundled, and RUOSTE can install it for you.**

> ⌘⇧P → **RUOSTE: Install Geist Mono** → Reload Window

VS Code has no API for installing an OS font, so an extension normally can only
tell you to do it by hand. RUOSTE ships the files and runs the copy itself:
`~/Library/Fonts` on macOS, `~/.local/share/fonts` plus `fc-cache` on Linux, and
`%LOCALAPPDATA%\Microsoft\Windows\Fonts` plus the per-user registry entries on
Windows. It offers this once, the first time it activates.

It also checks whether **your own `settings.json` is overriding the font** — user
settings beat extension defaults, which is the usual reason a theme's font looks
like it did nothing — and offers to fix it.

<details><summary>Doing it by hand instead</summary>

```bash
# find the folder
cd ~/.vscode/extensions/gapashu.ruoste-2.0.0/fonts

# macOS
cp *.ttf ~/Library/Fonts/

# Linux
mkdir -p ~/.local/share/fonts && cp *.ttf ~/.local/share/fonts/ && fc-cache -f

# Windows (PowerShell, from that folder)
Get-ChildItem *.ttf | ForEach-Object { Copy-Item $_ "$env:LOCALAPPDATA\Microsoft\Windows\Fonts" }
```

Restart VS Code afterwards.
</details>

Nine weights ship: Regular through Bold, matching italics, plus the variable font.
The font is applied in **nine** settings, not just the editor — terminal, debug
console, notebook output, chat, inlay hints, CodeLens and the SCM commit box — so
the whole workbench matches rather than just the code pane.

## Recommended settings

```jsonc
{
  "editor.fontSize": 13,
  "editor.lineHeight": 1.6,
  "editor.letterSpacing": 0.2,
  "editor.cursorBlinking": "solid",
  "editor.renderLineHighlight": "all",
  "editor.guides.bracketPairs": "active",
  "editor.stickyScroll.enabled": true,
  "editor.minimap.renderCharacters": false,
  "workbench.tree.indent": 14,
  "workbench.editor.tabSizing": "shrink",
  "terminal.integrated.fontSize": 12
}
```

## The palette

Nine tones, sampled from a photograph and held to a mineral range — nothing above
55 % saturation in the standard themes. Every syntax colour clears **WCAG AA
(4.5:1)** against its own ground; the Kontrasti variant clears **AAA (7:1)**.

| Role | RUOSTE | Paperi | Kontrasti | Used for |
|---|---|---|---|---|
| Ground | `#14120E` | `#F2F0EA` | `#0A0907` | editor background |
| Body | `#E4DFD3` | `#1A1712` | `#F6F2E8` | variables, fields, properties |
| Oxide rust | `#C57749` | `#985934` | `#E59661` | keywords, control flow, storage, decorators |
| Brass ochre | `#C7A560` | `#886220` | `#E7C474` | functions, methods, constructors |
| Verdigris | `#51A499` | `#25655E` | `#64CEC0` | types, classes, interfaces, generics |
| Blueprint | `#7496B4` | `#38618A` | `#89B8DC` | numbers, constants, enum members |
| Moss | `#8DA668` | `#4E6732` | `#ABCA7D` | strings |
| Madder | `#C76067` | `#A72F37` | `#E87D84` | errors, deletions, invalid |
| Graphite | `#887E6D` | `#72685A` | `#AEA28F` | comments *(italic)* |

## What's covered

**C#** — Roslyn semantic tokens including `recordClass`, `recordStruct`,
`extensionMethod`, `operatorOverloaded`, `controlKeyword`, `preprocessorKeyword`,
`excludedCode`, the nine `regex*` tokens inside string literals, and the full
`xmlDocComment*` family. LINQ query keywords, verbatim and interpolated strings,
nullable annotations and generic constraints all read distinctly.

**TypeScript** — `class`, `interface`, `enum`, `enumMember`, `typeParameter`,
`type`, `namespace`, `function`, `member`, `property`, `parameter`, each with
`declaration`, `readonly`, `static`, `async`, `defaultLibrary` and `local`
modifiers. Decorators are rust italic, generics teal italic, JSX components typed
apart from intrinsic tags.

Also themed: JSON, YAML, TOML, XML, Razor, Markdown, HTML, CSS/SCSS, SQL, shell,
Python, Go, Rust, Ruby, Java/Kotlin, PHP, C/C++, diffs and merge conflicts — plus
every notebook, testing, debug, chat, SCM-graph and terminal surface.

## Icons

**File icons** — 426 duotone SVGs from [Phosphor](https://phosphoricons.com),
recoloured per palette, covering 265 extensions, 164 exact filenames, 60 language
IDs and 211 folder names, in matched dark / light / high-contrast sets. Named
folders are composites: the Phosphor folder shell with a bold glyph inset, with
separate geometry for the open state so the glyph sits inside the front panel
rather than across the fold.

The .NET ecosystem is first-class — `.cs`, `.csproj`, `.sln`, `.razor`, `.cshtml`,
`.resx`, `.xaml`, `.nuspec`, `Directory.Build.props`, `global.json`,
`appsettings.json` — as is the TS toolchain: `tsconfig`, Vite/Webpack/Rollup/
Next/Turbo, ESLint, Prettier, Tailwind, Vitest, Jest, Playwright, every lockfile.

**Product icons** — a 20 KB WOFF2 built from 206 Phosphor glyphs, mapped onto 367
codicon ids: activity bar, tree twisties, tabs, toolbars, diagnostics, source
control, the debug toolbar, and all 40 IntelliSense symbol icons. Anything
unmapped falls back to the stock codicon, so there are no holes.

## GitHub Actions panel

Watches **every repository you can reach**, not just the one you happen to have
open — grouped by owner, so 40 repos across several organisations stay legible.

```
▾ JohnBrandt00 · 12 · 1 running
    radiohub          ● main · 2m ago
    ruoste            ✓ main · 1h ago
▾ acme-corp · 26 · 2 failing
    ingest-service    ✗ deploy · 3h ago
```

Expand a repo for its runs, a run for its jobs, a job for its steps.

- Signs in with **VS Code's built-in GitHub account**. No personal access token.
- **Scope** is yours to choose: everything you are affiliated with (default),
  only what is open in this window, or an explicit watch list. `owner/*`
  wildcards work in both the watch list and the exclude list.
- Re-run, cancel, open on GitHub and copy run URL from the item menu; **Go to
  Repository…** jumps straight to one by name.
- **Notifications** when a run finishes — failures only by default, or every
  completion, or nothing. A failure notification offers **Re-run** inline. More
  than three at once collapse into a single summary, and the first sync after
  start-up is silent so connecting doesn't fire forty alerts.
- **Live tracking**: while a run is in progress the view polls every 8 seconds
  and refreshes its jobs too, so steps tick over as they complete. The status
  bar shows a running elapsed timer that advances every second between polls.
- Status bar summarises across all of them — *3 running · 4m 12s*, *1 failing* —
  and turns red on failure.

**On "real time".** This is polling, not push. GitHub exposes no stream a
desktop client can subscribe to — webhooks need a public endpoint, which an
editor extension has no business running. What makes short intervals affordable
is the ETag cache below: an unchanged run costs nothing, so the live interval
can sit at 8 seconds (3 minimum) without eating the budget.

**How it stays inside the rate limit.** GitHub has no cross-repo runs endpoint,
so N repos means N requests. Two things make that cheap. Every GET carries an
`ETag`, and [a conditional request that returns 304 does not count against the
primary rate limit](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api),
so unchanged repositories are free. And requests go through a serial queue
rather than in parallel, which is what GitHub's own guidance asks for to avoid
secondary limits. On top of that, only repositories you have expanded — or that
have a run in progress — refresh every cycle; the rest rotate a few at a time.
The view title shows your remaining budget and the share of requests served from
cache.

| Setting | Default | |
|---|---|---|
| `ruoste.actions.scope` | `affiliated` | `affiliated`, `workspace` or `watchlist` |
| `ruoste.actions.repositories` | `[]` | extra repos to watch — `owner/repo`, wildcards allowed |
| `ruoste.actions.exclude` | `[]` | repos to hide — wildcards allowed |
| `ruoste.actions.maxRepositories` | `60` | cap on repos watched at once |
| `ruoste.actions.repositoriesPerCycle` | `8` | idle repos refreshed per cycle |
| `ruoste.actions.hideWithoutWorkflows` | `true` | hide repos with no runs |
| `ruoste.actions.runCount` | `10` | runs listed per repository |
| `ruoste.actions.autoRefresh` | `true` | poll automatically |
| `ruoste.actions.refreshInterval` | `60` | seconds between idle polls |
| `ruoste.actions.liveRefreshInterval` | `8` | seconds while a run is live (min 3) |
| `ruoste.actions.notifications` | `failures` | `off`, `failures`, `completions` or `all` |
| `ruoste.actions.notifyOnStart` | `false` | also notify when a run starts |
| `ruoste.actions.currentBranchOnly` | `false` | limit to the checked-out branch |
| `ruoste.actions.statusBar` | `true` | show the status bar item |


## Spotify

A full player in the sidebar — Now Playing webview, plus a library tree for your
queue, playlists, liked songs and devices.

![RUOSTE Spotify](https://raw.githubusercontent.com/JohnBrandt00/ruoste/main/media/preview-spotify-dark.png)

**Setup.** Create a free app at
[developer.spotify.com/dashboard](https://developer.spotify.com/dashboard), add
`vscode://gapashu.ruoste/spotify` as a Redirect URI, then run
**RUOSTE Spotify: Set Spotify Client ID** — it copies the redirect URI to your
clipboard and validates the ID.

**Playback control needs Spotify Premium**, and VS Code cannot play audio: this
is a remote for a Spotify client you already have running. Reading what is
playing works on a free account.

| | |
|---|---|
| Transport | play/pause, next, previous, drag-to-seek, volume, shuffle, repeat |
| Queue | see what's up next, click to jump, add any track/album/playlist, queue from a link on your clipboard |
| Playlists | browse to track level, play in context so the queue survives, add the current track to a playlist |
| Search | tracks, albums, artists and playlists — play or queue any result from the picker |
| Library | liked songs, save/unsave, transfer playback between devices |
| Pop out | **⇱** opens the player as an editor tab — from there VS Code's *Move Editor into New Window* gives you a floating mini-player on a second monitor |
| DJ | follows along when Spotify's AI DJ is playing, and hands off to the app to start it |

**Popping the player out.** The **⇱** button (or *RUOSTE Spotify: Open Player in
Editor*) opens Now Playing as an editor tab. Right-click that tab → **Move
Editor into New Window** and you have a floating player independent of the
window. You can also drag the sidebar view itself into the panel or the
secondary side bar with VS Code's own *Move View*.

**On the DJ.** Spotify closed algorithmic and editorial contexts to new apps in
November 2024, so no extension can *start* the AI DJ — the play call returns 403.
RUOSTE tries anyway (older apps with extended access still work), and otherwise
deep-links you into Spotify to start it, then picks the session up and controls
it from here. Reading DJ playback was never restricted.

### How this differs from CodeBeats

[CodeBeats](https://github.com/JunAkerBuilds/CodeBeats) is the extension this
took its cue from. The differences that matter:

| | CodeBeats | RUOSTE |
|---|---|---|
| OAuth callback | self-signed HTTPS server on `127.0.0.1:4567` | VS Code's own URI handler — no cert warning, no port to collide with, works over Remote-SSH and WSL, with a paste fallback |
| Token storage | extension state | `SecretStorage` (encrypted at rest) |
| Search | — | tracks, albums, artists, playlists |
| Add to queue | — | any track, album or playlist, plus from a clipboard link |
| Add to playlist | — | yes (`playlist-modify-*`, a scope CodeBeats does not request) |
| Polling | fixed | 2 s while playing, 15 s idle, stops entirely when no view is visible |
| 403 handling | one generic message | tells Premium-required, missing-scope and retired-endpoint apart |
| Errors | — | 401 auto-refresh and retry, 429 `Retry-After` backoff, no-device prompts a transfer |

## Building from source

```bash
npm install
npm run build     # regenerate themes, icons and the product icon font
npm run check     # typecheck against @types/vscode, unit tests, package validation
npm run verify    # tokenize real C#/TS through the actual grammars
npm run ui        # render the Spotify webview against mock state, both themes
npm run package   # -> ruoste-x.y.z.vsix
```

`BUILD.md` has the details, including two path rules that have already caused one
bug each.

## Credits

Icons © [Phosphor Icons](https://github.com/phosphor-icons/core), MIT.
Geist Mono © Vercel / basement.studio, SIL Open Font License 1.1 — redistributed
under its terms; see `fonts/OFL.txt`.
