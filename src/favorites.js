/**
 * OhMyGramola — Favorites Manager
 * Persists favorite tracks durably to P:\IA\RRSS\Music\.ohmygramola_favorites.json
 * (with localStorage backup) so favorites survive cache clears and work across sessions.
 */
(function (global) {
  "use strict";

  const STORAGE_KEY = "ohmygramola_favorites_v1";
  const FILENAME = ".ohmygramola_favorites.json";

  let favoritesMap = null; // Map<id, cleanTrackObject>
  const listeners = [];

  function getNodeReq() {
    if (typeof window !== "undefined") {
      if (window.cep_node && typeof window.cep_node.require === "function") {
        return window.cep_node.require;
      }
      if (typeof require === "function") {
        return require;
      }
    }
    return null;
  }

  function getFavoritesFilePath() {
    const req = getNodeReq();
    if (!req) return null;
    try {
      const path = req("path");
      const libDir = (global.LocalLibraryProvider && typeof global.LocalLibraryProvider.getLibraryPath === "function")
        ? global.LocalLibraryProvider.getLibraryPath()
        : (req("fs").existsSync("P:\\IA\\RRSS\\Music") ? "P:\\IA\\RRSS\\Music" : path.join(req("os").homedir(), "Music", "OhMyGramola"));
      return path.join(libDir, FILENAME);
    } catch (_) {
      return null;
    }
  }

  function sanitizeTrack(track) {
    if (!track || !track.id) return null;
    return {
      id: track.id,
      source: track.source || "local",
      sourceLabel: track.sourceLabel || undefined,
      title: track.title || "Untitled",
      artist: track.artist || "Unknown",
      genre: track.genre || "Music",
      bpm: track.bpm || "—",
      duration: track.duration || "—",
      durationSec: track.durationSec || undefined,
      peaks: Array.isArray(track.peaks) ? track.peaks : undefined,
      streamUrl: track.streamUrl || "",
      downloadUrl: track.downloadUrl || track.streamUrl || "",
      localPath: track.localPath || undefined,
      webUrl: track.webUrl || null,
      licenseType: track.licenseType || "Royalty-Free",
      attribution: track.attribution || "",
      safeForYouTube: true,
      favoritedAt: track.favoritedAt || Date.now()
    };
  }

  function ensureLoaded() {
    if (favoritesMap !== null) return favoritesMap;
    favoritesMap = new Map();

    let loadedItems = null;
    const req = getNodeReq();
    const filePath = getFavoritesFilePath();

    if (req && filePath) {
      try {
        const fs = req("fs");
        if (fs.existsSync(filePath)) {
          const raw = fs.readFileSync(filePath, "utf-8").replace(/^\uFEFF/, "");
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) loadedItems = parsed;
        }
      } catch (err) {
        console.warn("Could not read favorites file:", err);
      }
    }

    if (!loadedItems) {
      try {
        const rawLocal = localStorage.getItem(STORAGE_KEY);
        if (rawLocal) {
          const parsed = JSON.parse(rawLocal);
          if (Array.isArray(parsed)) loadedItems = parsed;
        }
      } catch (_) {}
    }

    if (Array.isArray(loadedItems)) {
      loadedItems.forEach((item) => {
        const clean = sanitizeTrack(item);
        if (clean) favoritesMap.set(clean.id, clean);
      });
    }

    return favoritesMap;
  }

  function persist() {
    const map = ensureLoaded();
    const arr = Array.from(map.values()).sort((a, b) => (b.favoritedAt || 0) - (a.favoritedAt || 0));
    const jsonText = JSON.stringify(arr, null, 2);

    try {
      localStorage.setItem(STORAGE_KEY, jsonText);
    } catch (_) {}

    const req = getNodeReq();
    const filePath = getFavoritesFilePath();
    if (req && filePath) {
      try {
        const fs = req("fs");
        const path = req("path");
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, jsonText, "utf-8");
      } catch (err) {
        console.warn("Could not write favorites file:", err);
      }
    }

    listeners.forEach((fn) => {
      try { fn(arr.length); } catch (_) {}
    });
  }

  global.FavoritesManager = {
    isFavorite(trackId) {
      if (!trackId) return false;
      return ensureLoaded().has(trackId);
    },

    count() {
      return ensureLoaded().size;
    },

    toggle(track) {
      if (!track || !track.id) return false;
      const map = ensureLoaded();
      if (map.has(track.id)) {
        map.delete(track.id);
        persist();
        return false;
      }
      const clean = sanitizeTrack(Object.assign({}, track, { favoritedAt: Date.now() }));
      map.set(clean.id, clean);
      persist();
      return true;
    },

    getAll() {
      return Array.from(ensureLoaded().values()).sort((a, b) => (b.favoritedAt || 0) - (a.favoritedAt || 0));
    },

    async getGenres() {
      const set = new Set();
      this.getAll().forEach((t) => {
        if (t.genre) set.add(t.genre);
      });
      return Array.from(set).sort();
    },

    async search({ query = "", genre = "" } = {}) {
      const qTokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
      const g = genre.toLowerCase().trim();

      return this.getAll().filter((t) => {
        if (g && (t.genre || "").toLowerCase() !== g) return false;
        if (qTokens.length > 0) {
          const blob = [
            t.title,
            t.artist,
            t.genre,
            t.bpm,
            t.licenseType,
            t.attribution
          ].join(" ").toLowerCase();
          for (const tok of qTokens) {
            if (!blob.includes(tok)) return false;
          }
        }
        return true;
      });
    },

    onChange(fn) {
      if (typeof fn === "function") listeners.push(fn);
    }
  };
})(window);
