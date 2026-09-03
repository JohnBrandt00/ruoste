# Changelog

## 2.4.1

**Fixed: the dashboard hid its own errors.** `snapshot()` carried `error` and
`loading`, but the page never rendered either — so a partial repository
discovery looked exactly like "you only have one repository". Repo discovery
fails softly on purpose (a SAML-SSO-protected organisation should not blank the
whole view), and that soft failure was invisible. There is now a banner, the
header reports how many repositories are hidden, and the footer shows the active
scope.

### Dashboard layouts

- **GRID** — cards in an auto-fitting grid, best in a wide pane.
- **LIST** — dense rows, no card chrome, best in a narrow column.
- **SPLIT** — repositories on the left, the selected one's runs on the right.
- A compact toggle for tighter rows, and both choices persist.
- **SCOPE** in the header opens the repository-scope picker directly.

## 2.4.0

**Fixed: the queue did not reflect Spotify's queue.** Three compounding causes.
The queue was only refetched every 15 seconds with nothing invalidating it after
a change, so a track added to the queue could take that long to appear. Nothing
refetched it when the playing track advanced, which is precisely when the queue
moves. And the webview skipped re-rendering unless the list length *and* first
item both changed — which stayed true for most real changes once the list was
capped. The queue is now invalidated by anything that reorders it (queueing,
skipping, shuffling, starting playback), read twice after a write because
Spotify's queue endpoint lags writes, and the view re-renders on any change to
what is visible.

**Fixed: `could not seek — Restriction violated`.** Spotify reports what is
disallowed at any moment — seeking is blocked during ads and while the DJ is
playing. RUOSTE now reads that map: forbidden controls are greyed rather than
offered and failed, the scrubber ignores drags when seeking is blocked, and if a
restriction is hit anyway the message says what and why instead of quoting
Spotify's jargon.

### Pipelines dashboard

- **RUOSTE: Open Pipelines Dashboard** — every watched repository as cards in one
  grid, grouped by owner, live-updating, filterable, with re-run and cancel on
  each row and the rate-limit budget in the footer. Opens as an editor tab, so
  *Move Editor into New Window* floats it on a second monitor.

### Starting runs

- **Run Workflow…** picks repo → workflow → branch → optional `key=value` inputs
  and dispatches. A workflow without a `workflow_dispatch` trigger returns 422,
  which is reported as that rather than as a generic error; 403 explains that
  write access and possibly SAML SSO are needed.
- **Re-run Failed Jobs** on any completed run.

### Configuration

Six new settings: `actions.groupByOwner`, `actions.dashboardRunsPerRepo`,
`actions.confirmDispatch`, `spotify.queueLength`, `spotify.queuePollInterval`,
`spotify.showArtwork` — plus `spotify.queueBatchLimit` from 2.3.3. 26 in total.

## 2.3.3

**Fixed: every Spotify player command failed with a JSON parse error.**
`could not pause — Unexpected non-whitespace character after JSON`,
`could not skip forward — Unexpected token 'd', "d84dWL__jz"`,
`could not add to queue — Unexpected token 'Y', "Yv6puxxLYD"`.

Spotify answers player commands with a bare plain-text trace id, not JSON, and
the client parsed every 2xx body as JSON unconditionally. Three different
symptoms, one cause — the third failed differently only because that trace id
happened to start with a digit, so `JSON.parse` consumed a number before
choking.

- Response bodies are now read by content-type. A non-JSON body is returned as
  text, a malformed JSON body falls back to text, and 204/205/304 and empty
  bodies return null. A successful call can no longer be reported as a failure.
- The GitHub client had the same unconditional parse and got the same fix.

**Fixed: queueing an album or playlist could never have worked.** Spotify's
queue endpoint accepts only `track` and `episode` URIs, but the menu offered
*Add to Queue* on playlists. Albums and playlists are now expanded into their
tracks and queued with a cancellable progress notification, capped by
`ruoste.spotify.queueBatchLimit` (default 50). Queueing an artist now says why
it cannot, instead of failing obscurely.

### Pop-out player

- **⇱ / RUOSTE Spotify: Open Player in Editor** opens Now Playing as an editor
  tab. VS Code's *Move Editor into New Window* then floats it as an independent
  mini-player. The sidebar view and the panel share one implementation.

## 2.3.2

**Fixed: the packaged .vsix was not what vsce produced.** To keep relative
README image paths (vsce rewrites them for the marketplace) I had been
unzipping vsce's output, swapping the readme, and re-zipping. That re-zip was
not faithful — it injected 11 directory entries vsce never emits and put
`[Content_Types].xml` ahead of `extension.vsixmanifest`, reordering the OPC
package. This is the likeliest cause of `ruoste.spotify.clientId is not a
registered configuration` and `No view is registered with id:
ruoste.spotify.library`, where commands loaded but views and settings did not.

- The repackaging step is gone. README images now use absolute
  `raw.githubusercontent.com` URLs, so vsce has nothing to rewrite and its
  output ships untouched.
- `.vscodeignore` was missing `preview/` and `.github/` — 2.7 MB of preview
  renders were shipping inside the extension. Package is down from 5.66 MB to
  3.2 MB.
- `check_package.py` now inspects the built .vsix: no directory entries,
  `extension.vsixmanifest` first, no dev directories, size ceiling. Verified by
  reproducing the old re-zip and watching the check fail.

### Also

- **Actions and Spotify now live in separate activity bar containers.** Mixing a
  webview view with tree views in one container is legal but was an unnecessary
  variable while diagnosing this.
- **`RUOSTE: Show Diagnostics`** reports the running version, install path, every
  declared view, which views actually registered, feature status, GitHub
  sign-in and rate budget, and the Spotify redirect URI. If something is wrong,
  this says what rather than leaving it to guesswork.
- View creation no longer assumes success: the Actions panel runs without its
  tree if registration fails, and the Spotify player comes up whether or not the
  library tree does.

## 2.3.1

**Fixed: the extension failed to activate.** `ruoste.spotify.library` was
declared with `when: ruoste.spotify.signedIn`, but `createTreeView` is called
during `activate()` — before that context key is ever set. VS Code had not
registered the view, so the call threw, and because it threw inside `activate()`
it took the GitHub Actions panel and the Spotify webview down with it. The
themes and icons were unaffected, being declarative.

- The `when` clause is gone; `viewsWelcome` already handled the signed-out
  state, which is the correct mechanism.
- **Each feature now activates in isolation.** A failure in fonts, Actions or
  Spotify reports itself and leaves the others running, instead of aborting
  activation for everything.
- `check_package.py` gained the rule that would have caught this: no view
  created eagerly during activation may carry a `when` clause. Verified by
  reintroducing the bug and watching the check fail.

### Notifications and live tracking

- Notifies when a run finishes: `failures` (default), `completions`, `all` or
  `off`, with **Re-run** offered inline on a failure. Bursts of more than three
  collapse into one summary, and the first sync after start-up is silent so
  connecting with 40 repos does not fire 40 alerts.
- While a run is in progress its jobs are refetched each cycle, so steps update
  live rather than freezing at whatever they were when first expanded.
- Live poll interval is now 8s (minimum 3) — affordable because unchanged runs
  return 304 and cost nothing.
- The status bar elapsed timer ticks every second between polls.
- GitHub has no push channel for Actions that a desktop client can subscribe to;
  this is polling, and the README says so.

## 2.3.0 — Actions across every repository

**Fixed: the Actions panel only ever showed one repository.** It took the first
repo from the git extension and stopped there — the wrong model for anyone with
more than one project, let alone 40 across several organisations.

- Watches every repository you are affiliated with, grouped by owner, with
  workspace repos first. Scope is configurable: `affiliated`, `workspace` or an
  explicit `watchlist`, with `owner/*` wildcards in both the watch and exclude
  lists.
- Rate limit is handled properly rather than hoped for: every GET carries an
  `ETag`, so unchanged repositories return 304 and cost nothing; requests go
  through a serial queue, per GitHub's guidance on secondary limits; and only
  expanded or actively-running repositories refresh each cycle while the rest
  rotate. The view title shows remaining budget and cache hit rate.
- Repositories with no workflow runs are detected once and then skipped.
- Per-repository failures no longer blank the tree — the repo shows its own
  error and the rest keep working. SAML SSO and 404s are named specifically.
- New commands: **Go to Repository…**, **Choose Watched Repositories…**,
  **Rediscover Repositories**, **Watch Repository…**, **Stop Watching**.
- Status bar aggregates across all repos ("3 running", "1 failing") with a
  tooltip listing the most recent runs.
- 13 new tests covering glob matching, owner grouping, hot/warm rotation, the
  304 cache path, and serial queue ordering under failure.

## 2.2.0 — Spotify

A full Spotify player, taking its cue from
[CodeBeats](https://github.com/JunAkerBuilds/CodeBeats) and going further.

- **Now Playing webview** — artwork with a blurred backdrop, drag-to-seek
  scrubber, transport, shuffle/repeat/like, volume, device switch and a live
  queue. Every colour comes from the active theme, so it tracks RUOSTE, Paperi
  and Kontrasti without a second stylesheet.
- **Library tree** — Up Next, Playlists (to track level), Liked Songs, Devices.
- **Search** across tracks, albums, artists and playlists, with play and
  add-to-queue buttons on every result.
- **Queue** — add tracks, albums or playlists; queue straight from a Spotify
  link on the clipboard.
- **Add to playlist**, which needs `playlist-modify-private/public` — a scope
  CodeBeats does not request.
- **Auth**: OAuth PKCE through VS Code's URI handler instead of a self-signed
  HTTPS server on a fixed port. No certificate warning, nothing to collide with,
  works over Remote-SSH and WSL, and falls back to pasting the redirect URL where
  the handler cannot fire. Tokens live in `SecretStorage`.
- **Failure handling**: 401 refreshes and retries once, 429 honours
  `Retry-After`, and the three kinds of 403 — Premium required, missing scope,
  endpoint retired in Nov 2024 — are reported apart from each other.
- **Polling** runs at 2 s while playing, 15 s while paused, and stops completely
  when no RUOSTE view is visible.
- **DJ**: attempts the DJ context, and on the expected 403 hands off to the
  Spotify app and then follows the session. Spotify closed algorithmic and
  editorial contexts to apps registered after 27 November 2024.
- 13 new unit tests behind a `vscode` module stub, so extension logic is testable
  outside the extension host.

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
