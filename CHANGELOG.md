# Changelog — OhMyGramola

All notable changes to **OhMyGramola** follow [Semantic Versioning](https://semver.org/).

## [1.3.0] - 2026-11-15

### Added
- **Custom Right-Click Context Menu**: Replaced the default CEF browser context menu (Back/Forward/Print/View Source) with a dark-themed track context menu:
  - **Local tracks**: `Copy Path` (also triggered via **Shift + Middle Click**), `Open Folder` (selects the file in Windows Explorer via `/select,`), and `Check License`.
  - **Online tracks**: `Open Link` and `Check License`.
- **Dummy-Proof License Popups**:
  - **Per-Track `Check License`**: Explains in plain English what you can/cannot do and provides ready-to-copy attribution when required.
  - **`Licenses` Guide Button**: Added next to the library tabs to explain all mixed licenses (`CC0`, `Royalty-Free No Attribution`, `CC BY`, `Royalty-Free Attribution`, `CC BY-SA`, `Local / Pre-verified`) and YouTube `-NC`/`-ND` safety filtering.
- **Exclusive Multi-Filter (`AND`) Categories & Search Suggestions**: Added a License filter dropdown, clickable search suggestions (licenses, genres, instruments, moods), and active `AND` filter chips so combining e.g. `License: CC BY` + `drums` strictly requires every condition to match.
- **Lazy Local Library Loading & `Reload` Button**: Local Library no longer scans automatically on startup; scanning begins only when clicking the `Local Library` tab or pressing the new `↻ Reload` button.

## [1.2.3] - 2026-11-15

### Added
- **Embedded MP3 ID3v2 Metadata & Attribution Reader/Writer**: `LocalLibraryProvider` now reads embedded ID3v2.3/2.4 tags (`TIT2`, `TPE1`, `TALB`, `TCON`, `TBPM`, `TCOP`, `WXXX`/`WOAS`, `COMM`, and `TXXX:OHMYGRAMOLA_META`) directly from the `.mp3` header (reading only the header bytes, with `.json` / `_attribution.txt` kept as legacy fallback).
- **Zero-Clutter Online Downloads**: `broker.mjs` now embeds attribution and track metadata directly inside downloaded `.mp3` files via FFmpeg instead of creating extra `_attribution.txt` files when FFmpeg is present.

## [1.2.2] - 2026-11-15

### Fixed
- **Fixed `Open Folder` Button in Local Library**: Windows CEP `openURLInDefaultBrowser` silently ignored raw directory paths; local paths now launch `explorer.exe` directly (both in `BrokerClient.openExternal` and `/api/open`).
- **Unlimited Recursive Depth**: Removed the 6-level depth cap in `LocalLibraryProvider` and added canonical `realpath` cycle protection so deeply nested folders are always discovered.

### Added
- **Separate Online Downloads Folder**: Added a configurable **Online Downloads Folder (AE Imports)** setting (`<LocalLibrary> Downloads` by default) so downloaded Kevin MacLeod & Jamendo tracks stay separate from your scanned Local Library without creating duplicates.

## [1.2.1] - 2026-11-15

### Added
- **Progressive Non-Blocking Local Library Scanner**: Clicking **Local Library** now streams tracks onto the screen in batches of 16 via `fs.promises` without freezing the After Effects UI, and populates genre filters incrementally.
- **Live Track Counter Badge**: Added a live `(N)` counter next to **Local Library** (`Local Library (347)`) that ticks up in real time as files are discovered on disk and warms up quietly in the background on panel startup.
- **Full Library Visibility**: Raised Local Library scan limit from 150 to 2,000 tracks so large local collections are browsable without hidden truncation.

## [1.2.0] - 2026-11-14

### Changed
- **Non-Destructive Pre-Comp Audio Trimming**: Importing an In/Out selection now always imports (or reuses) the **full untrimmed master audio file** inside an `OhMyGramola Music` project folder, creates a dedicated After Effects composition (`<Title> [Trim XmXXs-YmYYs]`) containing the full track shifted to `-trimIn`, and places that pre-comp at your active composition playhead (CTI). You can double-click the pre-comp or lengthen its duration at any time to recover the rest of the song without re-importing or generating duplicate `_Trimmed` files on disk.

## [1.1.0] - 2026-11-14

### Added
- **Interactive Waveform & In/Out Trimmer**: Symmetrical HiDPI envelope waveform rendered progressively while streaming, with mouse drag-to-select, `[` / `]` draggable handles, and `I` / `O` shortcut keys.
- **Trimmed Import to After Effects**: Clicking **Import Trim (Xs)** exports a click-free (`8ms` micro-faded) trimmed clip via FFmpeg (or falls back to non-destructive timeline layer trimming if FFmpeg is absent) and places it directly at the active composition's playhead (CTI).
- **Favorites System (`♥`)**: Persistent favorites tab (`♥ Favorites`) saved to `.ohmygramola_favorites.json` inside your music library folder.
- **Panel Keyboard Shortcuts**: `Space` (Play/Pause), `←`/`→` (`±10s`, or `±60s` with `Shift`), `↑`/`↓` (previous/next track), `I`/`O` (mark In/Out), `X` (clear trim), `F` (toggle favorite).
- **GUI & One-Click Installer (`Install-OhMyGramola.cmd`)**: Dark-themed Windows GUI installer allowing After Effects version selection (**AE 2020 through AE 2026+ / Beta**), custom local music folder selection, environment diagnostics, and clean uninstall (`--silent` CLI mode also supported).
- **Visible Release Versioning**: Header and Settings version badge (`v1.1.0`) synchronized across `package.json`, `CSXS/manifest.xml`, and the local companion broker.

### Changed
- **Expanded After Effects Compatibility**: Lowered CEP manifest runtime floor to `CSXS 9.0` and host range `[17.0, 99.9]` so the extension works out of the box in **After Effects 2020, 2021, 2022, 2023, 2024, 2025, and 2026+**.
- **Portable Default Music Folder**: Defaults to `%USERPROFILE%\Music\OhMyGramola` on new machines (or any folder chosen in the installer / Settings).
- **Crisp Vector Controls**: Replaced OS Unicode play/pause characters with optically matched inline SVGs.
