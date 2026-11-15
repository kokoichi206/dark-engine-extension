# Development

User-facing documentation is available in [English](./README.md) and
[Japanese](./README.ja.md).

## Build and load

Use Node.js 24 and pnpm 10.34.5. The extension targets Chrome 119 or later.

```sh
pnpm install --frozen-lockfile
pnpm build
```

1. Open `chrome://extensions` in Chrome and enable Developer mode.
2. Choose **Load unpacked** and select this repository's `dist/` directory.
3. Reload the pages you want to theme.

The popup saves the global on/off setting and domain exclusions. Changes apply
when a page next loads. Check that spreadsheet edits are saved before reloading
Google Sheets.

## Commands

```sh
pnpm dev                 # Watch TypeScript, HTML, CSS, and manifest changes
pnpm typecheck           # Check TypeScript separately while using watch mode
pnpm check               # Type checking, unit tests, and formatting
pnpm exec playwright install chromium
pnpm test:e2e            # Build dist/ and run the extension's browser tests
pnpm verify:sites        # Verify live public sites and update screenshots/results
```

After rebuilding, reload the extension at `chrome://extensions` and reload the
affected pages. `pnpm dev` does not run type checking.

GitHub Actions runs `pnpm check` and `pnpm test:e2e` on pushes and pull requests.
The workflow installs Chromium with its Linux dependencies and uploads browser
test artifacts from `test-results/`.

## Test contracts

Unit tests cover color properties and domain boundaries. Browser tests load the
built manifest and scripts into a temporary Chromium profile and check painted
colors, image appearance, dynamic updates, frames, settings, Canvas compatibility,
and transition completion and cancellation.

Assertions must detect a broken user-visible behavior or compatibility contract,
rather than fix the shape of internal CSS, marker attributes, or mapped color
strings. Color checks use independent calculations in
[visual-contract.ts](tests/support/visual-contract.ts), not the production mapper.
Representative light surfaces must map below relative luminance `0.1`, and opaque
text on solid backgrounds must reach a contrast ratio of at least `4.5:1`.
These checks do not imply accessibility conformance for every page.

`pnpm test:e2e` uses controlled fixtures. The Sheets fixture routes a Sheets URL to
local HTML to verify script injection and Canvas API behavior; it does not test
the live Sheets editor. The suite does not sign in or write to real services.

To inspect the local fixtures manually:

```sh
node tests/server.mjs
```

Open the [standard page](http://127.0.0.1:4173/),
[CSP page](http://127.0.0.1:4173/strict.html), or
[transition page](http://127.0.0.1:4173/transitions.html) with the extension loaded.
These URLs require the server to be running.

## Live-site verification

`pnpm verify:sites` opens the actual public
[Sheets sample](https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit),
[GitHub repository](https://github.com/kokoichi206/dark-engine-extension),
[Wikipedia article](https://en.wikipedia.org/wiki/Color), and
[Example Domain](https://example.com/). It uses a temporary profile, keeping
personal Chrome accounts and settings separate.

The script checks page colors and Canvas pixels. On Sheets, it also checks that
arrow-key navigation changes the selected cell and scrolling changes the Canvas
drawing. Generated results and screenshots go to the Git-ignored
`test-results/sites/` directory. Only the two illustrations used by the READMEs
are maintained in `docs/images/`.

For a visible browser window, use `HEADED=1 pnpm test:e2e` or
`HEADED=1 pnpm verify:sites`.

## Performance investigation

```sh
node scripts/profile-performance.mjs --large
node scripts/profile-performance.mjs --live
node scripts/profile-performance.mjs --diagnose
node scripts/profile-performance.mjs --serve
```

Local profiler trials compare enabled, disabled, and absent-extension cases in
temporary profiles. `--large` selects the 3,014-element fixture; `--live` measures
public sites in disabled → enabled → disabled order. `--diagnose` records idle
invalidations and runs a diagnostic `transitionend` propagation-blocking
comparison. The blocking intervention is confined to the diagnostic browser.

Output defaults to `test-results/performance`. Use `--output=directory` to change
it and `--project=directory` to load another project's `dist/` and record that
source's hashes. `--quick` runs a shorter on/off comparison.

`--serve` keeps the [local load fixture](http://127.0.0.1:4175/?cards=600) available
for manual inspection. The URL stops working when the server exits.

The latest synchronous DOM scan can be inspected in the page's DevTools console:

```js
performance.getEntriesByName("dark-engine:render").at(-1)?.duration;
```

This does not include waiting for existing transitions, subsequent painting, or
the full interaction. Evaluate load with main-thread task time and Long Tasks as
well. Generated profiling output belongs in the Git-ignored `test-results/`
directory, not in source control.

## Implementation

The engine maps colors by role, using OKLab to adjust lightness and chroma and
solid-background contrast to choose readable foregrounds. It handles DOM content,
pseudo-elements, forms, SVG fills and strokes, gradients, shadows, and
browser-supported color syntax. The default palette is inspired by GitHub's Dark
dimmed theme.

Identical mapped styles share CSS rules, including their pseudo-elements. A sheet
is replaced only when its generated text changes. The engine waits for existing
site color transitions to finish or be canceled before sampling styles, then
cancels new color transitions caused by its own sheet switching. Opacity,
position, and other non-color transitions are outside that cancellation. Full
DOM scans and temporary sheet disabling remain, so large pages can still be
costly and ongoing color transitions can delay updates.

Google Sheets needs a separate drawing path. A MAIN-world script runs only at
`docs.google.com/spreadsheets/*` and wraps Canvas 2D drawing methods. It changes
colors only while drawing in the cell area and restores `fillStyle` and
`strokeStyle`, preserving `save()` / `restore()` behavior and the site's stored
cell data. WebGL, OffscreenCanvas, image-transfer rendering, CanvasGradient, and
CanvasPattern are unsupported.

```text
manifest.json             Manifest V3 and declarative HTTP/HTTPS script matching
src/
  engine/
    color.ts              Color-space conversion, role mapping, and contrast
    css-colors.ts         Browser color parsing and compound CSS color mapping
    dom-engine.ts         Computed-style sampling and dynamic updates
    sheets-canvas.ts      Sheets Canvas 2D drawing wrappers
  entries/                ISOLATED- and MAIN-world entry points
  popup/                  Global switch, domain exclusion, and page reload
  options/                Excluded-domain settings
  settings/               Settings loading, domain parsing, and matching
scripts/
  build.mjs               Build independent IIFEs with esbuild
  verify-sites.mjs        Read-only live-site verification
  profile-performance.mjs Compare load in temporary profiles
tests/                    Unit tests, extension browser tests, and fixtures
docs/images/              Illustrations used by the READMEs
```

The TypeScript setup, manifest generation, and real-page testing approaches were
informed by [Google Search Navigator](https://github.com/kokoichi206/google-search-navigator-extension)
and [Foldable View for GitHub](https://github.com/kokoichi206/github-foldable-view-extension).
The extension uses independent content and MAIN-world scripts, TypeScript strict,
and esbuild without a UI or extension-development framework. There are no runtime
package dependencies. The build derives `dist/manifest.json`'s version from
`package.json`.

## Documentation and pull requests

Keep `README.md` in English and `README.ja.md` in Japanese, with matching features,
limitations, screenshots, and language links. Keep build, test, and implementation
details in this file. Use English for pull request titles and descriptions.

This layout follows the published
[Foldable View for GitHub documentation](https://github.com/kokoichi206/github-foldable-view-extension/pull/4)
and its [language switcher](https://github.com/kokoichi206/github-foldable-view-extension/pull/8).

## Permissions and data

`storage` persists the global on/off setting and excluded domains in
`chrome.storage.local`. Page execution is declared in
`content_scripts.matches`. The extension requests no `tabs`, `scripting`, cookie,
or history permissions.

The popup uses the Tabs API to get the current tab ID, asks its content script for
the hostname, and can reload that tab. It does not retrieve the full page URL or
page text. The only state passed to the MAIN-world drawing script is a DOM
attribute indicating whether conversion is enabled.

Color analysis stays in the browser. The extension makes no network requests,
sends no page data to an analysis service, and stores no browsing history.

Implementation references: [Chrome content scripts](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts),
[origin-based frame injection](https://developer.chrome.com/docs/extensions/reference/api/scripting#property-RegisteredContentScript-matchOriginAsFallback),
and [Playwright extension testing](https://playwright.dev/docs/chrome-extensions).
