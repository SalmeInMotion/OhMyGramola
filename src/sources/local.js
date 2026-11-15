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
  let activeScan = null; // { root, items, genresSet, done, promise, listeners }

  const SCAN_BATCH_SIZE = 16;
  const CACHE_TTL_MS = 15000;

  function yieldToUi() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

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

  async function readTextAsync(fs, filePath) {
    if (fs.promises && typeof fs.promises.readFile === "function") {
      return fs.promises.readFile(filePath, "utf-8");
    }
    return fs.readFileSync(filePath, "utf-8");
  }

  async function readDirAsync(fs, dirPath) {
    if (fs.promises && typeof fs.promises.readdir === "function") {
      return fs.promises.readdir(dirPath, { withFileTypes: true });
    }
    return fs.readdirSync(dirPath, { withFileTypes: true });
  }

  async function pathExistsAsync(fs, targetPath) {
    if (fs.promises && typeof fs.promises.access === "function") {
      try {
        await fs.promises.access(targetPath);
        return true;
      } catch (_) {
        return false;
      }
    }
    return fs.existsSync(targetPath);
  }

  async function buildTrackEntry(fs, path, currentDir, relSegments, entryName) {
    const fullPath = path.join(currentDir, entryName);
    const ext = path.extname(entryName).toLowerCase();
    if (!AUDIO_EXTS.has(ext)) return null;

    const baseName = path.basename(entryName, ext);
    const relKey = relSegments.concat(entryName).join("/");

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
    if (await pathExistsAsync(fs, jsonSidecar)) {
      try {
        const rawMeta = await readTextAsync(fs, jsonSidecar);
        meta = JSON.parse(rawMeta.replace(/^\uFEFF/, ""));
      } catch (_) {}
    }

    if (meta && (meta.safeForYouTube === false || isUnsafeLicense(meta.licenseType) || isUnsafeLicense(meta.licenseUrl))) {
      return null;
    }

    // Check optional <baseName>_attribution.txt sidecar
    let attribution = (meta && meta.attribution) || `Local track from: ${fullPath}`;
    let webUrl = (meta && meta.webUrl) || null;
    const attrFile = path.join(currentDir, `${baseName}_attribution.txt`);
    if (await pathExistsAsync(fs, attrFile)) {
      try {
        const attrText = (await readTextAsync(fs, attrFile)).trim();
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

    return {
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
    };
  }

  function startAsyncDiskScan(fs, path, libraryDir) {
    if (activeScan && activeScan.root === libraryDir && !activeScan.done) {
      return activeScan;
    }

    const scanState = {
      root: libraryDir,
      items: [],
      genresSet: new Set(),
      done: false,
      listeners: new Set(),
      promise: null
    };
    activeScan = scanState;

    const notify = (batch, done) => {
      const genres = Array.from(scanState.genresSet).sort();
      scanState.listeners.forEach((fn) => {
        try {
          fn({
            batch,
            totalDetected: scanState.items.length,
            genres,
            done
          });
        } catch (_) {}
      });
    };

    scanState.promise = (async () => {
      if (!(await pathExistsAsync(fs, libraryDir))) {
        try {
          fs.mkdirSync(libraryDir, { recursive: true });
        } catch (err) {
          console.error("Could not create local music folder:", err);
        }
      }

      const dirQueue = [{ dir: libraryDir, relSegments: [] }];
      const visitedRealPaths = new Set();
      let pendingBatch = [];

      while (dirQueue.length > 0) {
        const { dir, relSegments } = dirQueue.shift();

        // Guard against symlink/junction cycles while allowing unlimited recursion depth
        try {
          const realDir = (fs.promises && typeof fs.promises.realpath === "function")
            ? await fs.promises.realpath(dir)
            : fs.realpathSync(dir);
          const normKey = realDir.toLowerCase();
          if (visitedRealPaths.has(normKey)) continue;
          visitedRealPaths.add(normKey);
        } catch (_) {}

        let entries;
        try {
          entries = await readDirAsync(fs, dir);
        } catch (_) {
          continue;
        }

        const subDirs = [];
        for (const entry of entries) {
          if (entry.name.startsWith(".")) continue;
          if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name.toLowerCase())) {
              subDirs.push({
                dir: path.join(dir, entry.name),
                relSegments: relSegments.concat(entry.name)
              });
            }
            continue;
          }

          if (!entry.isFile()) continue;
          const item = await buildTrackEntry(fs, path, dir, relSegments, entry.name);
          if (!item) continue;

          scanState.items.push(item);
          if (item.genre) scanState.genresSet.add(item.genre);
          pendingBatch.push(item);

          if (pendingBatch.length >= SCAN_BATCH_SIZE) {
            const flush = pendingBatch;
            pendingBatch = [];
            notify(flush, false);
            await yieldToUi();
          }
        }

        // Depth-first order by prepending subdirectories so folder contents stay grouped
        if (subDirs.length > 0) {
          dirQueue.unshift(...subDirs);
        }
      }

      if (pendingBatch.length > 0) {
        notify(pendingBatch, false);
      }

      cachedCatalog = scanState.items;
      cachedRoot = libraryDir;
      cachedAt = Date.now();
      scanState.done = true;
      notify([], true);
      if (activeScan === scanState) {
        activeScan = null;
      }
      return scanState.items;
    })();

    return scanState;
  }

  function matchesFilters(item, qTokens, gLower) {
    if (gLower && item.genre.toLowerCase() !== gLower) return false;
    if (qTokens.length > 0) {
      for (const tok of qTokens) {
        if (!item._searchBlob.includes(tok)) return false;
      }
    }
    return true;
  }

  async function loadLocalCatalogAsync(libraryDir, forceRefresh = false) {
    const fs = getFs();
    const path = getPath();
    if (!fs || !path) return null;

    const now = Date.now();
    if (!forceRefresh && cachedCatalog && cachedRoot === libraryDir && now - cachedAt < CACHE_TTL_MS) {
      return cachedCatalog;
    }

    const scanState = startAsyncDiskScan(fs, path, libraryDir);
    return scanState.promise;
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
        cachedAt = 0;
      } catch (_) {}
    },

    getDownloadsPath() {
      try {
        const stored = localStorage.getItem("online_downloads_path");
        if (stored && stored.trim()) return stored.trim();
      } catch (_) {}
      const libDir = this.getLibraryPath().replace(/[\\/]+$/, "");
      return `${libDir} Downloads`;
    },

    setDownloadsPath(p) {
      try {
        localStorage.setItem("online_downloads_path", p.trim());
      } catch (_) {}
    },

    invalidateCache() {
      cachedCatalog = null;
      cachedAt = 0;
    },

    getCachedCount() {
      if (activeScan && !activeScan.done) return activeScan.items.length;
      if (cachedCatalog) return cachedCatalog.length;
      return null;
    },

    isScanning() {
      return Boolean(activeScan && !activeScan.done);
    },

    warmUp(onProgress) {
      const fs = getFs();
      const path = getPath();
      if (!fs || !path) return;
      const libraryDir = this.getLibraryPath();
      if (cachedCatalog && cachedRoot === libraryDir && Date.now() - cachedAt < CACHE_TTL_MS) {
        if (typeof onProgress === "function") onProgress(cachedCatalog.length, true);
        return;
      }
      const scanState = startAsyncDiskScan(fs, path, libraryDir);
      if (typeof onProgress === "function") {
        const listener = ({ totalDetected, done }) => {
          onProgress(totalDetected, done);
          if (done) scanState.listeners.delete(listener);
        };
        scanState.listeners.add(listener);
      }
    },

    async getGenres() {
      const libraryDir = this.getLibraryPath();
      const items = await loadLocalCatalogAsync(libraryDir);
      if (!items) return [];
      const set = new Set();
      items.forEach((it) => {
        if (it.genre) set.add(it.genre);
      });
      return Array.from(set).sort();
    },

    scanProgressive({ query = "", genre = "", limit = 2000, forceRefresh = false, onBatch } = {}) {
      let cancelled = false;
      const cancel = () => {
        cancelled = true;
      };

      const libraryDir = this.getLibraryPath();
      const fs = getFs();
      const path = getPath();
      const qTokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
      const gLower = genre.toLowerCase().trim();

      const promise = (async () => {
        if (!fs || !path) {
          const mock = [
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
          if (!cancelled && typeof onBatch === "function") {
            onBatch({ newMatches: mock, totalDetected: 1, genres: ["Local"], done: true });
          }
          return mock;
        }

        const now = Date.now();
        const useCache = !forceRefresh && cachedCatalog && cachedRoot === libraryDir && now - cachedAt < CACHE_TTL_MS;

        if (useCache) {
          const genresSet = new Set();
          cachedCatalog.forEach((it) => { if (it.genre) genresSet.add(it.genre); });
          const genres = Array.from(genresSet).sort();
          const allMatches = [];
          let chunk = [];

          for (let i = 0; i < cachedCatalog.length; i++) {
            if (cancelled) return allMatches;
            const item = cachedCatalog[i];
            if (!matchesFilters(item, qTokens, gLower)) continue;
            if (allMatches.length >= limit) break;
            allMatches.push(item);
            chunk.push(item);
            if (chunk.length >= 24) {
              if (typeof onBatch === "function") {
                onBatch({ newMatches: chunk, totalDetected: cachedCatalog.length, genres, done: false });
              }
              chunk = [];
              await yieldToUi();
            }
          }

          if (!cancelled && typeof onBatch === "function") {
            onBatch({ newMatches: chunk, totalDetected: cachedCatalog.length, genres, done: true });
          }
          return allMatches;
        }

        const scanState = startAsyncDiskScan(fs, path, libraryDir);
        const allMatches = [];

        // Emit any already-discovered items from an in-flight scan in smooth UI chunks
        let cursor = 0;
        const already = scanState.items.slice();
        if (already.length > 0) {
          const genres = Array.from(scanState.genresSet).sort();
          for (let i = 0; i < already.length; i += 24) {
            if (cancelled) return allMatches;
            const slice = already.slice(i, i + 24);
            const matched = [];
            for (const item of slice) {
              if (allMatches.length < limit && matchesFilters(item, qTokens, gLower)) {
                allMatches.push(item);
                matched.push(item);
              }
            }
            cursor = i + slice.length;
            if ((matched.length > 0 || i === 0) && typeof onBatch === "function") {
              onBatch({ newMatches: matched, totalDetected: scanState.items.length, genres, done: false });
            }
            await yieldToUi();
          }
        }

        if (scanState.done) {
          if (!cancelled && typeof onBatch === "function") {
            onBatch({
              newMatches: [],
              totalDetected: scanState.items.length,
              genres: Array.from(scanState.genresSet).sort(),
              done: true
            });
          }
          return allMatches;
        }

        await new Promise((resolve) => {
          const listener = ({ totalDetected, genres, done }) => {
            if (cancelled) {
              scanState.listeners.delete(listener);
              return resolve();
            }
            const newSlice = scanState.items.slice(cursor);
            cursor = scanState.items.length;
            const matched = [];
            for (const item of newSlice) {
              if (allMatches.length < limit && matchesFilters(item, qTokens, gLower)) {
                allMatches.push(item);
                matched.push(item);
              }
            }
            if (typeof onBatch === "function") {
              onBatch({ newMatches: matched, totalDetected, genres, done });
            }
            if (done) {
              scanState.listeners.delete(listener);
              resolve();
            }
          };
          scanState.listeners.add(listener);
        });

        return allMatches;
      })();

      return { promise, cancel };
    },

    async scan({ query = "", genre = "", limit = 2000, forceRefresh = false } = {}) {
      const { promise } = this.scanProgressive({ query, genre, limit, forceRefresh });
      return promise;
    }
  };
})(window);
