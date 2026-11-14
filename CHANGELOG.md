# Changelog — OhMyGramola

All notable changes to **OhMyGramola** follow [Semantic Versioning](https://semver.org/).

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
