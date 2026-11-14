/**
 * OhMyGramola — Local Library Provider
 * Recursively scans P:\IA\RRSS\Music (or custom configured folder) for audio files,
 * subfolder categories (<Collection>\<Genre>\<Track>.mp3), and optional sidecar metadata
 * (<Track>.json and <Track>_attribution.txt) so bulk-downloaded catalogs are fully searchable.
 */
(function (global) {
  "use strict";

  const PREFERRED_LEGACY_DIR = "P:\\IA\\RRSS\\Music";
  const AUDIO_EXTS = new Set([".mp3", ".wav", ".aac", ".m4a", ".ogg", ".flac"]);
  const SKIP_DIRS = new Set([".git", "node_modules", "_temp", ".temp", ".cache", "_trimmed", "_clips"]);

  let cachedCatalog = null;
  let cachedAt = 0;
  let cachedRoot = "";
  let resolvedDefaultDir = null;

  function getFs() {
    if (typeof window !== "undefined") {
      if (window.cep_node && typeof window.cep_node.require === "function") {
        return window.cep_node.require("fs");
      }
      if (typeof require === "function") {
        try { return require("fs"); } catch (_) {}
      }
    }
    return null;
  }

  function getPath() {
    if (typeof window !== "undefined") {
      if (window.cep_node && typeof window.cep_node.require === "function") {
        return window.cep_node.require("path");
      }
      if (typeof require === "function") {
        try { return require("path"); } catch (_) {}
      }
    }
    return null;
  }

  function isUnsafeLicense(lic) {
    if (!lic) return false;
    const lower = String(lic).toLowerCase();
    return lower.includes("-nc") || lower.includes("/nc/") || lower.includes("-nd") || lower.includes("/nd/") || lower.includes("noncommercial") || lower.includes("noderivs");
  }

  function buildCatalogFromDisk(fs, path, libraryDir) {
    if (!fs.existsSync(libraryDir)) {
      try {
        fs.mkdirSync(libraryDir, { recursive: true });
      } catch (err) {
        console.error("Could not create local music folder:", err);
      }
    }

    const items = [];

    function walk(currentDir, relSegments, depth) {
      if (depth > 6) return;
      let entries;
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch (_) {
        return;
      }

      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name.toLowerCase())) continue;
          walk(fullPath, relSegments.concat(entry.name), depth + 1);
          continue;
        }

        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (!AUDIO_EXTS.has(ext)) continue;

        const baseName = path.basename(entry.name, ext);
        const relKey = relSegments.concat(entry.name).join("/");

        // Infer defaults from subfolder hierarchy and "Artist - Title" naming
        let defaultTitle = baseName;
        let defaultArtist = relSegments.length >= 1 ? relSegments[0] : "Local Library";
        let defaultGenre = relSegments.length >= 2
          ? relSegments[1]
          : (relSegments.length === 1 ? relSegments[0] : ext.replace(".", "").toUpperCase());

        if (baseName.includes(" - ")) {
          const splitIdx = baseName.indexOf(" - ");
          const maybeArtist = baseName.slice(0, splitIdx).trim();
          const maybeTitle = baseName.slice(splitIdx + 3).trim();
          if (maybeArtist && maybeTitle) {
            defaultArtist = maybeArtist;
            defaultTitle = maybeTitle;
          }
        }

        // Check optional <baseName>.json metadata sidecar
        let meta = null;
        const jsonSidecar = path.join(currentDir, `${baseName}.json`);
        if (fs.existsSync(jsonSidecar)) {
          try {
            meta = JSON.parse(fs.readFileSync(jsonSidecar, "utf-8"));
          } catch (_) {}
        }

        if (meta && (meta.safeForYouTube === false || isUnsafeLicense(meta.licenseType) || isUnsafeLicense(meta.licenseUrl))) {
          continue;
        }

        // Check optional <baseName>_attribution.txt sidecar
        let attribution = (meta && meta.attribution) || `Local track from: ${fullPath}`;
        let webUrl = (meta && meta.webUrl) || null;
        const attrFile = path.join(currentDir, `${baseName}_attribution.txt`);
        if (fs.existsSync(attrFile)) {
          try {
            const attrText = fs.readFileSync(attrFile, "utf-8").trim();
            if (attrText) attribution = attrText;
          } catch (_) {}
        }

        if (!webUrl && attribution) {
          const urlMatch = attribution.match(/https?:\/\/[^\s\)\]]+/i);
          if (urlMatch) webUrl = urlMatch[0];
        }

        const tagsText = meta
          ? [meta.tags, meta.mood, meta.feel, meta.instruments, meta.collection, meta.sourceName]
              .filter(Boolean)
              .map((v) => (Array.isArray(v) ? v.join(" ") : String(v)))
              .join(" ")
          : "";

        const finalTitle = (meta && meta.title) ? String(meta.title).trim() : defaultTitle;
        const finalArtist = (meta && meta.artist) ? String(meta.artist).trim() : defaultArtist;
        const finalGenre = (meta && meta.genre) ? String(meta.genre).trim() : defaultGenre;
        const finalBpm = (meta && meta.bpm) ? String(meta.bpm) : "—";
        const finalLicense = (meta && meta.licenseType) ? String(meta.licenseType).trim() : "Local / Pre-verified";

        const searchBlob = [
          finalTitle,
          finalArtist,
          finalGenre,
          finalBpm !== "—" ? `${finalBpm} ${finalBpm}bpm` : "",
          relSegments.join(" "),
          tagsText,
          attribution
        ].join(" ").toLowerCase();

        items.push({
          id: `local-${relKey}`,
          source: "local",
          sourceLabel: (meta && meta.sourceName) || (relSegments[0] || "Local"),
          title: finalTitle,
          artist: finalArtist,
          genre: finalGenre,
          bpm: finalBpm,
          duration: (meta && meta.duration) ? String(meta.duration) : "Local",
          streamUrl: fullPath,
          downloadUrl: fullPath,
          localPath: fullPath,
          webUrl: webUrl,
          licenseType: finalLicense,
          attribution: attribution,
          safeForYouTube: true,
          _searchBlob: searchBlob
        });
      }
    }

    walk(libraryDir, [], 0);
    return items;
  }

  function loadLocalCatalog(libraryDir, forceRefresh = false) {
    const fs = getFs();
    const path = getPath();
    if (!fs || !path) return null;

    const now = Date.now();
    if (!forceRefresh && cachedCatalog && cachedRoot === libraryDir && now - cachedAt < 5000) {
      return cachedCatalog;
    }

    cachedCatalog = buildCatalogFromDisk(fs, path, libraryDir);
    cachedRoot = libraryDir;
    cachedAt = now;
    return cachedCatalog;
  }

  function resolveDefaultLibraryDir() {
    if (resolvedDefaultDir) return resolvedDefaultDir;
    const fs = getFs();
    const path = getPath();
    if (fs && path) {
      // 1. Check runtime-config.json written by the installer
      try {
        if (typeof window !== "undefined" && window.__adobe_cep__) {
          let extDir = decodeURI(window.__adobe_cep__.getSystemPath("extension")).replace(/^file:\/\/\/?/i, "");
          if (/^\/[a-z]:/i.test(extDir)) extDir = extDir.slice(1);
          extDir = extDir.replace(/\//g, "\\");
          const cfgPath = path.join(extDir, "runtime-config.json");
          if (fs.existsSync(cfgPath)) {
            const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8").replace(/^\uFEFF/, ""));
            if (cfg.defaultMusicDir && String(cfg.defaultMusicDir).trim()) {
              resolvedDefaultDir = String(cfg.defaultMusicDir).trim();
              return resolvedDefaultDir;
            }
          }
        }
      } catch (_) {}

      // 2. Keep SalmeInMotion studio path if P:\IA\RRSS exists on this machine
      try {
        if (fs.existsSync(PREFERRED_LEGACY_DIR) || fs.existsSync("P:\\IA\\RRSS")) {
          resolvedDefaultDir = PREFERRED_LEGACY_DIR;
          return resolvedDefaultDir;
        }
      } catch (_) {}

      // 3. Portable fallback for external users: %USERPROFILE%\Music\OhMyGramola
      try {
        const req = (typeof window !== "undefined" && window.cep_node && typeof window.cep_node.require === "function")
          ? window.cep_node.require
          : (typeof require === "function" ? require : null);
        if (req) {
          const os = req("os");
          resolvedDefaultDir = path.join(os.homedir(), "Music", "OhMyGramola");
          return resolvedDefaultDir;
        }
      } catch (_) {}
    }

    resolvedDefaultDir = PREFERRED_LEGACY_DIR;
    return resolvedDefaultDir;
  }

  global.LocalLibraryProvider = {
    getLibraryPath() {
      try {
        const stored = localStorage.getItem("local_library_path");
        if (stored && stored.trim()) return stored.trim();
      } catch (_) {}
      return resolveDefaultLibraryDir();
    },

    setLibraryPath(p) {
      try {
        localStorage.setItem("local_library_path", p.trim());
        cachedCatalog = null;
      } catch (_) {}
    },

    invalidateCache() {
      cachedCatalog = null;
    },

    async getGenres() {
      const libraryDir = this.getLibraryPath();
      const items = loadLocalCatalog(libraryDir);
      if (!items) return [];
      const set = new Set();
      items.forEach((it) => {
        if (it.genre) set.add(it.genre);
      });
      return Array.from(set).sort();
    },

    async scan({ query = "", genre = "", limit = 150, forceRefresh = false } = {}) {
      const libraryDir = this.getLibraryPath();
      const items = loadLocalCatalog(libraryDir, forceRefresh);

      if (!items) {
        return [
          {
            id: "local-demo",
            source: "local",
            sourceLabel: "Local",
            title: "Sample Local Track (Mock Mode)",
            artist: `Library ${libraryDir}`,
            genre: "Local",
            bpm: "—",
            duration: "03:15",
            streamUrl: "",
            downloadUrl: "",
            localPath: `${libraryDir}\\sample.mp3`,
            licenseType: "Local Asset",
            attribution: `Asset stored in ${libraryDir}`,
            safeForYouTube: true
          }
        ];
      }

      const qTokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
      const g = genre.toLowerCase().trim();

      const filtered = items.filter((item) => {
        if (g && item.genre.toLowerCase() !== g) return false;
        if (qTokens.length > 0) {
          for (const tok of qTokens) {
            if (!item._searchBlob.includes(tok)) return false;
          }
        }
        return true;
      });

      return filtered.slice(0, limit);
    }
  };
})(window);
