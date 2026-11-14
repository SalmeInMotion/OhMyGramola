/**
 * Incompetech Source Provider (Kevin MacLeod)
 * 1,440+ tracks, CC-BY 4.0 compliant, 100% safe for YouTube with attribution.
 * Bundled offline catalog for instant zero-latency loading in After Effects.
 */
(function (global) {
  "use strict";

  let cachedPieces = null;
  let cachedGenres = {};

  function getFs() {
    if (typeof window !== "undefined") {
      if (window.cep_node && typeof window.cep_node.require === "function") {
        try { return window.cep_node.require("fs"); } catch (_) {}
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
        try { return window.cep_node.require("path"); } catch (_) {}
      }
      if (typeof require === "function") {
        try { return require("path"); } catch (_) {}
      }
    }
    return null;
  }

  function getExtensionDir() {
    if (typeof window !== "undefined" && window.__adobe_cep__) {
      try {
        let value = window.__adobe_cep__.getSystemPath("extension");
        value = decodeURI(value).replace(/^file:\/\/\/?/i, "");
        if (/^\/[a-z]:/i.test(value)) value = value.slice(1);
        return value.replace(/\//g, "\\");
      } catch (_) {}
    }
    return null;
  }

  async function loadCatalog() {
    if (cachedPieces && Object.keys(cachedGenres).length > 0) {
      return { pieces: cachedPieces, genres: cachedGenres };
    }

    let piecesRaw = null;
    let genresRaw = null;

    // Strategy 1: Instant local read via Node.js fs from bundled data
    const fs = getFs();
    const path = getPath();
    const extDir = getExtensionDir();

    if (fs && path && extDir) {
      try {
        const pPieces = path.join(extDir, "src", "data", "incompetech_pieces.json");
        const pGenres = path.join(extDir, "src", "data", "incompetech_genres.json");
        if (fs.existsSync(pPieces) && fs.existsSync(pGenres)) {
          piecesRaw = JSON.parse(fs.readFileSync(pPieces, "utf-8"));
          genresRaw = JSON.parse(fs.readFileSync(pGenres, "utf-8"));
        }
      } catch (err) {
        console.warn("Could not load bundled incompetech json from disk:", err);
      }
    }

    // Strategy 2: NetTransport (Node.js https bypassing CORS)
    if (!piecesRaw || !genresRaw) {
      try {
        const [p, g] = await Promise.all([
          global.NetTransport.fetchJson("https://incompetech.com/music/royalty-free/pieces.json"),
          global.NetTransport.fetchJson("https://incompetech.com/music/royalty-free/genre.json")
        ]);
        piecesRaw = p;
        genresRaw = g;
      } catch (netErr) {
        console.warn("NetTransport fetch failed, trying local relative fetch:", netErr);
        // Strategy 3: Relative fetch
        const [resP, resG] = await Promise.all([
          fetch("./data/incompetech_pieces.json"),
          fetch("./data/incompetech_genres.json")
        ]);
        piecesRaw = await resP.json();
        genresRaw = await resG.json();
      }
    }

    if (!piecesRaw || !genresRaw) {
      throw new Error("Unable to load Kevin MacLeod music catalog.");
    }

    cachedGenres = {};
    genresRaw.forEach((g) => {
      cachedGenres[String(g.id)] = g.genre;
    });

    cachedPieces = piecesRaw.map((p) => {
      const genreName = cachedGenres[String(p.genre)] || "Soundtrack";
      const cleanTitle = (p.title || "").trim();
      const filename = (p.filename || `${cleanTitle}.mp3`).trim();
      const streamUrl = `https://incompetech.com/music/royalty-free/mp3-royaltyfree/${encodeURIComponent(filename)}`;

      const attribution = `"${cleanTitle}" Kevin MacLeod (incompetech.com)\nLicensed under Creative Commons: By Attribution 4.0 License\nhttp://creativecommons.org/licenses/by/4.0/`;

      const webUrl = p.filmmusicURL || (p.isrc
        ? `https://incompetech.com/music/royalty-free/index.html?isrc=${p.isrc}`
        : `https://incompetech.com/music/royalty-free/index.html?keywords=${encodeURIComponent(cleanTitle)}`);

      return {
        id: `incompetech-${filename}`,
        source: "incompetech",
        title: cleanTitle,
        artist: "Kevin MacLeod",
        genre: genreName,
        bpm: p.bpm || "—",
        duration: p.length || "—",
        instruments: p.instruments || "",
        feel: p.feel || "",
        description: p.description || "",
        streamUrl: streamUrl,
        downloadUrl: streamUrl,
        webUrl: webUrl,
        licenseType: "CC BY 4.0",
        licenseNotice: "Attribution Required for YouTube",
        attribution: attribution,
        safeForYouTube: true
      };
    });

    return { pieces: cachedPieces, genres: cachedGenres };
  }

  global.IncompetechProvider = {
    async getGenres() {
      const { genres } = await loadCatalog();
      return Object.values(genres).sort();
    },

    async search({ query = "", genre = "", limit = 60 } = {}) {
      const { pieces } = await loadCatalog();
      const q = query.toLowerCase().trim();
      const g = genre.toLowerCase().trim();

      let results = pieces.filter((item) => {
        if (g && item.genre.toLowerCase() !== g) {
          return false;
        }
        if (q) {
          const matchTitle = item.title.toLowerCase().includes(q);
          const matchFeel = item.feel.toLowerCase().includes(q);
          const matchInst = item.instruments.toLowerCase().includes(q);
          const matchDesc = item.description.toLowerCase().includes(q);
          if (!matchTitle && !matchFeel && !matchInst && !matchDesc) {
            return false;
          }
        }
        return true;
      });

      return results.slice(0, limit);
    }
  };
})(window);
