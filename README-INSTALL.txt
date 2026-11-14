======================================================================
  OhMyGramola v1.2.0 — Quick Install & Compatibility Guide (Windows)
======================================================================

1. HOW TO INSTALL (NO COMMAND LINE NEEDED)
----------------------------------------------------------------------
  1) Extract this ZIP archive to any temporary folder.
  2) Double-click "Install-OhMyGramola.cmd".
  3) In the Setup window:
       - Select your target Adobe After Effects versions (installed
         versions are detected automatically; "Enable for all
         compatible & future versions (AE 2020 - 2026+)" is checked
         by default).
       - Choose the folder where downloaded tracks will be saved
         (defaults to "%USERPROFILE%\Music\OhMyGramola").
       - Click "Install Now".
  4) Open Adobe After Effects and go to:
       Window -> Extensions -> OhMyGramola

  (Optional silent install: run "Install-OhMyGramola.cmd --silent")


2. SUPPORTED ADOBE AFTER EFFECTS VERSIONS
----------------------------------------------------------------------
  OhMyGramola v1.2.0 targets CEP 9+ (AEFT 17.0 through 99.9) and works
  out of the box in:
    - After Effects 2020 (v17.x)
    - After Effects 2021 (v18.x)
    - After Effects 2022 (v22.x)
    - After Effects 2023 (v23.x)
    - After Effects 2024 (v24.x)
    - After Effects 2025 (v25.x)
    - After Effects 2026 & After Effects (Beta) (v26+)


3. COMPANION TOOLS (RECOMMENDED)
----------------------------------------------------------------------
  - Node.js LTS (https://nodejs.org):
      Required for instant online HTTP streaming and Jamendo API
      search (also bypasses Windows Firewall rules blocking AfterFX).
  - FFmpeg (https://www.gyan.dev/ffmpeg/builds/):
      Optional/Recommended. Enables progressive streaming waveforms on
      Incompetech/Local tracks (WebAudio fallback is automatic). In/Out
      audio trimming is 100% non-destructive via After Effects pre-comps,
      so the full untrimmed audio is always preserved in your project!


4. KEYBOARD SHORTCUTS (WHEN PANEL HAS FOCUS)
----------------------------------------------------------------------
  - Space                : Play / Pause
  - Left / Right Arrow   : Seek -10s / +10s (hold Shift for -60s / +60s)
  - Up / Down Arrow      : Previous / Next track in list
  - I / O                : Mark In / Out trim points at playhead
  - Mouse Drag on Wave   : Select or adjust In / Out trim range
  - X                    : Clear active In / Out trim
  - F                    : Toggle Favorite (Heart)

Full documentation & updates:
https://github.com/SalmeInMotion/OhMyGramola
======================================================================
