# OhMyGramola (`v1.1.0`)

**Royalty-Free & Creative Commons Music Browser, Live Waveform Trimmer, and One-Click Importer for Adobe After Effects.**

![Version](https://img.shields.io/badge/version-1.1.0-d8ff42?style=flat-square&labelColor=1d2026)
![After Effects](https://img.shields.io/badge/After%20Effects-2020%20--%202026%2B-398dc2?style=flat-square&labelColor=1d2026)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-242832?style=flat-square&labelColor=1d2026)
![License](https://img.shields.io/badge/license-MIT-949cab?style=flat-square&labelColor=1d2026)

**OhMyGramola** is a native docked CEP panel for **Adobe After Effects** that lets motion designers and video creators discover, stream instantaneously, trim In/Out ranges on a live waveform, and import YouTube-safe music directly onto their active composition playhead with automatic attribution credits.

---

## ✨ Key Features

- **3 Built-In Safe Sources + Unified Mode**
  - **Kevin MacLeod (Incompetech)**: 1,440+ tracks indexed offline for instant search by feel, genre, BPM, and instrumentation (CC BY 4.0).
  - **Jamendo Music**: Live API v3 integration with automatic **YouTube-safe license filtering** (strictly strips `-NC` NonCommercial and `-ND` NoDerivatives tracks) and a guided 45-second free Client ID setup.
  - **Local Library**: Recursive scanner for your own local audio collection (`.mp3`, `.wav`, `.flac`, `.m4a`, `.ogg`, `.aac`) with optional `.json` / `_attribution.txt` sidecar support.
  - **♥ Favorites**: Mark tracks across any source and filter them from a dedicated persistent Favorites tab.
  - **Merge Online Libraries**: Optional toggle in Settings (`⚙`) to search Kevin MacLeod + Jamendo together in a single tab.
- **Instant Streaming & Firewall-Proof Companion Broker**
  - Streams remote tracks via HTTP Range requests (~300ms time-to-first-byte) through a lightweight local `node.exe` companion process—even if `AfterFX.exe` is blocked by Windows Firewall.
- **Live Symmetrical Waveform & Sample-Accurate In/Out Trimming**
  - Draws a smooth mirrored envelope waveform progressively as you listen.
  - Drag across the waveform (or press `I` and `O`) to select a section, then click **`Import Trim`** to generate a click-free (`8ms` micro-faded) trimmed clip and place it straight at your After Effects composition CTI.
- **Automatic YouTube Credits**
  - Saves a `<Track>_attribution.txt` file alongside downloaded tracks and copies formatted credits to the Windows clipboard in one click.

---

## ⌨️ Panel Keyboard Shortcuts

When the **OhMyGramola** panel has focus:

| Shortcut | Action |
| :--- | :--- |
| `Space` | Play / Pause |
| `←` / `→` | Seek `-10s` / `+10s` |
| `Shift + ←` / `Shift + →` | Seek `-60s` / `+60s` |
| `↑` / `↓` | Previous / Next track in list |
| `I` / `O` | Set **In** / **Out** trim point at current playhead |
| `X` | Clear active In/Out trim selection |
| `F` | Toggle `♥` Favorite on current track |

---

## 🖥️ Supported After Effects Versions & System Requirements

**OhMyGramola (`v1.1.0`)** works across all modern Creative Cloud releases of **Adobe After Effects on Windows 10 / 11** (`CSXS 9.0+`, host range `AEFT [17.0, 99.9]`):

| Adobe After Effects Version | Internal Host (`AEFT`) | CEP / CSXS Runtime | Status |
| :--- | :--- | :--- | :--- |
| **After Effects 2020** | `17.x` | `CSXS 9` / `10` | ✅ Supported |
| **After Effects 2021** | `18.x` | `CSXS 10` / `11` | ✅ Supported |
| **After Effects 2022** | `22.x` | `CSXS 11` | ✅ Supported |
| **After Effects 2023** | `23.x` | `CSXS 11` | ✅ Supported |
| **After Effects 2024** | `24.x` | `CSXS 11` / `12` | ✅ Supported |
| **After Effects 2025** | `25.x` | `CSXS 12` | ✅ Supported |
| **After Effects 2026 & Beta** | `26.x+` | `CSXS 12` – `16` | ✅ Supported |

> **How multi-version CEP installation works:** Adobe CEP extensions live in a single user folder (`%APPDATA%\Adobe\CEP\extensions\com.salmeinmotion.free-royalties-music`). The included GUI installer (`Install-OhMyGramola.cmd`) auto-detects every After Effects version installed on the PC, enables unsigned panel loading (`PlayerDebugMode=1`) for the corresponding `CSXS` runtimes, and lets you target either specific AE releases or all current & future versions (`2020–2026+`).

### External Companion Tools
- **[Node.js LTS](https://nodejs.org/)** *(Required for live online streaming & Jamendo API proxy — runs a silent local companion process so online playback works even when `AfterFX.exe` is blocked by Windows Firewall)*.
- **[FFmpeg](https://www.gyan.dev/ffmpeg/builds/)** *(Recommended — enables progressive waveform extraction while streaming non-Jamendo tracks and exports sample-accurate, click-free trimmed `.mp3`/`.wav` clips on disk. If FFmpeg is not installed, OhMyGramola gracefully falls back to WebAudio live visualization and non-destructive After Effects timeline layer trimming).*

---

## 🚀 Installation (Windows)

1. Download **`OhMyGramola-v1.1.0-Setup.zip`** from [**Releases**](https://github.com/SalmeInMotion/OhMyGramola/releases) (or clone this repository) and extract it anywhere.
2. Double-click **`Install-OhMyGramola.cmd`**.
3. In the **OhMyGramola Setup** window:
   - Choose which **After Effects versions** to enable (installed versions are auto-detected; *All compatible & future versions* is enabled by default).
   - Choose your **Local Music & Downloads Folder** (defaults to `Music\OhMyGramola`).
   - Click **Install Now**.
4. Open **Adobe After Effects** and go to:
   **`Window -> Extensions -> OhMyGramola`**

> **Headless / Silent CLI Install:**
> ```bat
> Install-OhMyGramola.cmd --silent
> ```

---

## 📂 Repository Structure

```text
OhMyGramola/
├── Install-OhMyGramola.cmd   # Double-click GUI installer launcher (supports --silent)
├── CSXS/manifest.xml         # CEP manifest (AE 17.0 - 99.9 / CSXS 9+)
├── host/index.jsx            # ExtendScript bridge (import + CTI placement + layer trim)
├── src/
│   ├── index.html            # Panel UI
│   ├── styles.css            # SalmeInMotion dark theme
│   ├── app.js                # UI orchestrator & keyboard shortcuts
│   ├── player.js             # HTML5 + WebAudio streaming player
│   ├── waveform.js           # HiDPI symmetrical envelope & In/Out range selector
│   ├── favorites.js          # Persistent favorites manager
│   ├── broker-client.js      # Local Node companion client
│   ├── ae-bridge.js          # CSInterface host evaluator
│   ├── server/broker.mjs     # Standalone HTTP Range streamer, Jamendo proxy & FFmpeg trimmer
│   ├── sources/              # Incompetech, Jamendo (YouTube-safe filter), Local scanner
│   └── data/                 # Offline bundled Kevin MacLeod catalog (1,443 tracks)
└── scripts/
    ├── install-gui.ps1       # WinForms GUI installer (AE version selector + diagnostics)
    ├── install.ps1           # Core CLI / headless installer
    └── package-release.ps1   # Builds clean distributable Setup ZIP
```

---

## 📜 License

Released under the [MIT License](./LICENSE) by **SalmeInMotion**. Individual music tracks remain subject to their respective creators' licenses (e.g., Creative Commons CC BY 4.0 for Kevin MacLeod / Jamendo artists).
