# OhMyGramola (Free Royalties Music) — Agent instructions

**OhMyGramola** is a docked CEP panel for Adobe After Effects (`com.salmeinmotion.free-royalties-music`, project root `P:\IA\Tools\Free Royalties Music`).
It enables creators to discover, preview, download, and import royalty-free and Creative Commons music directly into their active After Effects project, storing downloads in `P:\IA\RRSS\Music`.

## Design and Visual Standards
- Follows `SALMEINMOTION_DESIGN_v001.md`:
  - Dark surfaces: background `#15171b`, panel `#1d2026`, raised `#242832`, divider `#343946`, primary text `#f1f3f7`, muted `#949cab`.
  - Brand accents: lime `#d8ff42`, action blue `#398dc2`, alert red `#f16c73`.
  - Typography: Segoe UI / Arial.
  - UI Language: English for all tool controls, labels, buttons, dialogs, and notifications.

## Licensing and YouTube Safety
- Automatically filters out tracks containing NoDerivatives (`-ND`) or NonCommercial (`-NC`) clauses that violate video synchronization or YouTube monetization.
- Integrates Incompetech (Kevin MacLeod) with CC-BY 4.0 compliant attribution generator and bundled offline catalog.
- Integrates Local Library scanner for `P:\IA\RRSS\Music` (YouTube Audio Library / Pixabay safe downloads).
- Supports Jamendo API v3 with strict license filter and configurable developer client ID.

## Architecture & Release Workflow
- `CSXS/manifest.xml`: CEP 9+ manifest targeting `AEFT` `[17.0, 99.9]` (After Effects 2020 through 2026+ / Beta) with `--disable-web-security` and `--enable-nodejs`.
- `host/index.jsx`: ExtendScript host script (`FreeRoyaltiesMusicHost` v3+) for project detection, full master footage import & deduplication inside `OhMyGramola Music`, non-destructive trimmed pre-comp creation (`<Title> [Trim ...]`), and CTI placement.
- `src/`: Panel UI (HTML5, CSS, vanilla JS + Node.js companion broker `src/server/broker.mjs`).
- **Release & Auto-Install Policy**:
  - Bump synchronized SemVer across `package.json`, `CSXS/manifest.xml`, `src/index.html`, `src/app.js`, `src/server/broker.mjs`, and `CHANGELOG.md` on every release.
  - Always deploy locally via `scripts/install.ps1` (or `Install-OhMyGramola.cmd --silent`) automatically as part of every release so the user never has to run manual PowerShell commands.
  - `Install-OhMyGramola.cmd` launches `scripts/install-gui.ps1` (WinForms GUI installer with AE version selector) on double-click, or runs headless with `--silent`.
  - `scripts/package-release.ps1` builds clean distributable archives in `dist/` without private keys (`runtime-config.json` is gitignored).
