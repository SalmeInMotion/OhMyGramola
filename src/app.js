/**
 * OhMyGramola — Application Orchestrator
 * Coordinates catalog sources, Favorites, streaming Waveform + In/Out Trimming,
 * keyboard shortcuts (Space, ←/→ ±10s / Shift ±60s, ↑/↓ track nav, I/O trim), and AE import.
 */
(function () {
  "use strict";

  const APP_VERSION = "1.1.0";
  window.OHMYGRAMOLA_VERSION = APP_VERSION;

  // Optically matched Play & Pause SVGs (exact same 15-unit vertical span y=4.5..19.5, zero OS emoji styling)
  function playIconSvg(px = 14) {
    return `<svg viewBox="0 0 24 24" width="${px}" height="${px}" fill="currentColor" aria-hidden="true"><path d="M7.2 4.9v14.2c0 .65.72 1.04 1.28.69l11.1-7.1a.82.82 0 0 0 0-1.38L8.48 4.21A.82.82 0 0 0 7.2 4.9z"/></svg>`;
  }

  function pauseIconSvg(px = 14) {
    return `<svg viewBox="0 0 24 24" width="${px}" height="${px}" fill="currentColor" aria-hidden="true"><rect x="6.2" y="4.5" width="4.2" height="15" rx="1.2"/><rect x="13.6" y="4.5" width="4.2" height="15" rx="1.2"/></svg>`;
  }

  function heartIconSvg(filled = false, px = 14) {
    if (filled) {
      return `<svg viewBox="0 0 24 24" width="${px}" height="${px}" fill="currentColor" aria-hidden="true"><path d="M12 21.15l-1.45-1.32C5.4 15.16 2 12.08 2 8.3 2 5.22 4.42 2.8 7.5 2.8c1.74 0 3.41.81 4.5 2.09A6.01 6.01 0 0 1 16.5 2.8C19.58 2.8 22 5.22 22 8.3c0 3.78-3.4 6.86-8.55 11.54L12 21.15z"/></svg>`;
    }
    return `<svg viewBox="0 0 24 24" width="${px}" height="${px}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 20.5s-8.5-5.2-8.5-11.7A4.8 4.8 0 0 1 8.3 4c1.58 0 2.95.8 3.7 2.05A4.42 4.42 0 0 1 15.7 4a4.8 4.8 0 0 1 4.8 4.8c0 6.5-8.5 11.7-8.5 11.7z"/></svg>`;
  }

  function getMergeOnlinePreference() {
    try {
      return localStorage.getItem("merge_online_libraries") === "true";
    } catch (_) {
      return false;
    }
  }

  function setMergeOnlinePreference(enabled) {
    try {
      localStorage.setItem("merge_online_libraries", enabled ? "true" : "false");
    } catch (_) {}
  }

  const isMergedInit = getMergeOnlinePreference();

  const state = {
    activeSource: isMergedInit ? "online" : "incompetech", // "online" | "incompetech" | "jamendo" | "favorites" | "local"
    searchQuery: "",
    selectedGenre: "",
    tracks: [],
    loading: false,
    downloadingId: null,
    jamendoHelpExpanded: false
  };

  const elements = {
    tabsNav: document.getElementById("tabs-nav"),
    openFolderBtn: document.getElementById("open-folder-btn"),
    jamendoHelper: document.getElementById("jamendo-helper"),
    searchInput: document.getElementById("search-input"),
    genreSelect: document.getElementById("genre-select"),
    trackList: document.getElementById("track-list"),
    statusMessage: document.getElementById("status-message"),
    // Player & Waveform bar
    waveformCanvas: document.getElementById("waveform-canvas"),
    trimInBtn: document.getElementById("trim-in-btn"),
    trimOutBtn: document.getElementById("trim-out-btn"),
    trimReadout: document.getElementById("trim-readout"),
    trimClearBtn: document.getElementById("trim-clear-btn"),
    npFavBtn: document.getElementById("np-fav-btn"),
    npTitle: document.getElementById("np-title"),
    npSub: document.getElementById("np-sub"),
    playPauseBtn: document.getElementById("play-pause-btn"),
    playerImportBtn: document.getElementById("player-import-btn"),
    timeCurrent: document.getElementById("time-current"),
    timeTotal: document.getElementById("time-total"),
    volSlider: document.getElementById("vol-slider"),
    toast: document.getElementById("toast"),
    // Settings modal
    settingsBtn: document.getElementById("settings-btn"),
    settingsModal: document.getElementById("settings-modal"),
    closeSettingsBtn: document.getElementById("close-settings-btn"),
    saveSettingsBtn: document.getElementById("save-settings-btn"),
    modalJamendoPortalBtn: document.getElementById("modal-jamendo-portal-btn"),
    inputJamendoKey: document.getElementById("setting-jamendo-key"),
    inputLocalPath: document.getElementById("setting-local-path"),
    checkboxMergeOnline: document.getElementById("setting-merge-online")
  };

  let toastTimer = null;
  function showToast(message) {
    if (!elements.toast) return;
    elements.toast.textContent = message;
    elements.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      elements.toast.classList.remove("show");
    }, 2600);
  }

  function formatTime(seconds) {
    if (!seconds || isNaN(seconds) || seconds < 0) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  }

  function formatPreciseTime(seconds) {
    if (seconds === null || seconds === undefined || isNaN(seconds) || seconds < 0) return "0:00.0";
    const mins = Math.floor(seconds / 60);
    const rem = (seconds - mins * 60).toFixed(1);
    return `${mins}:${ parseFloat(rem) < 10 ? "0" : "" }${rem}`;
  }

  function openJamendoPortal() {
    const url = (window.JamendoProvider && window.JamendoProvider.DEV_PORTAL_URL)
      ? window.JamendoProvider.DEV_PORTAL_URL
      : "https://devportal.jamendo.com/signup";
    if (window.BrokerClient && typeof window.BrokerClient.openExternal === "function") {
      window.BrokerClient.openExternal(url);
    }
  }

  async function copyToClipboard(text) {
    if (!text) return false;

    if (window.BrokerClient) {
      try {
        const ok = await window.BrokerClient.copyToClipboard(text);
        if (ok) return true;
      } catch (_) {}
    }

    try {
      const cp = (typeof window.cep_node !== "undefined" && window.cep_node.require)
        ? window.cep_node.require("child_process")
        : (typeof require === "function" ? require("child_process") : null);
      if (cp) {
        const p = cp.spawn("clip", [], { windowsHide: true });
        p.stdin.write(text);
        p.stdin.end();
        return true;
      }
    } catch (_) {}

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {}

    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const res = document.execCommand("copy");
      document.body.removeChild(textarea);
      return Boolean(res);
    } catch (_) {
      return false;
    }
  }

  function updateMainPlayPauseIcon(isPlaying) {
    if (!elements.playPauseBtn) return;
    elements.playPauseBtn.innerHTML = isPlaying ? pauseIconSvg(16) : playIconSvg(16);
  }

  function updateNowPlayingFavoriteUI() {
    if (!elements.npFavBtn) return;
    const cur = window.MusicPlayer ? window.MusicPlayer.getCurrentTrack() : null;
    if (!cur) {
      elements.npFavBtn.disabled = true;
      elements.npFavBtn.classList.remove("active");
      elements.npFavBtn.innerHTML = heartIconSvg(false, 15);
      return;
    }
    const fav = window.FavoritesManager ? window.FavoritesManager.isFavorite(cur.id) : false;
    elements.npFavBtn.disabled = false;
    elements.npFavBtn.classList.toggle("active", fav);
    elements.npFavBtn.innerHTML = heartIconSvg(fav, 15);
  }

  function updateTrimToolbarUI() {
    const cur = window.MusicPlayer ? window.MusicPlayer.getCurrentTrack() : null;
    const trim = (cur && window.WaveformView) ? window.WaveformView.getTrim(cur.id) : null;

    if (elements.trimReadout && elements.trimClearBtn) {
      if (trim) {
        const dur = (trim.trimOut - trim.trimIn).toFixed(1);
        elements.trimReadout.textContent = `${formatPreciseTime(trim.trimIn)} → ${formatPreciseTime(trim.trimOut)} (${dur}s)`;
        elements.trimReadout.style.display = "inline-block";
        elements.trimClearBtn.style.display = "inline-block";
      } else {
        elements.trimReadout.style.display = "none";
        elements.trimClearBtn.style.display = "none";
      }
    }

    if (elements.playerImportBtn) {
      if (!cur) {
        elements.playerImportBtn.disabled = true;
        elements.playerImportBtn.classList.remove("is-trimmed");
        elements.playerImportBtn.textContent = "Import to AE";
      } else {
        elements.playerImportBtn.disabled = Boolean(state.downloadingId);
        if (state.downloadingId === cur.id) {
          elements.playerImportBtn.textContent = "Importing...";
        } else if (trim) {
          const dur = (trim.trimOut - trim.trimIn).toFixed(1);
          elements.playerImportBtn.textContent = `Import Trim (${dur}s)`;
          elements.playerImportBtn.classList.add("is-trimmed");
        } else {
          elements.playerImportBtn.textContent = "Import to AE";
          elements.playerImportBtn.classList.remove("is-trimmed");
        }
      }
    }
  }

  function updateFilterBar() {
    if (state.activeSource === "local") {
      if (elements.openFolderBtn) elements.openFolderBtn.style.display = "inline-flex";
    } else {
      if (elements.openFolderBtn) elements.openFolderBtn.style.display = "none";
    }
  }

  function renderJamendoHelper() {
    if (!elements.jamendoHelper) return;

    const hasId = window.JamendoProvider ? window.JamendoProvider.hasClientId() : false;
    const currentId = window.JamendoProvider ? window.JamendoProvider.getClientId() : "";

    const showOnJamendo = state.activeSource === "jamendo";
    const showOnMergedMissing = state.activeSource === "online" && !hasId;

    if (!showOnJamendo && !showOnMergedMissing) {
      elements.jamendoHelper.style.display = "none";
      elements.jamendoHelper.innerHTML = "";
      return;
    }

    elements.jamendoHelper.style.display = "flex";
    const expanded = !hasId || state.jamendoHelpExpanded;
    elements.jamendoHelper.classList.toggle("needs-setup", !hasId);

    const statusHtml = hasId
      ? `<span>🔑 <strong>Jamendo ID active</strong> • YouTube-safe CC filter</span>`
      : `<span>🔑 <strong>Set up your free Jamendo Client ID</strong> (~45 sec, 100% free)</span>`;

    const toggleBtnHtml = hasId
      ? `<button type="button" class="btn-sm btn-copy js-jamendo-toggle-help">${expanded ? "Hide Guide" : "? How to get a free ID"}</button>`
      : "";

    const guideHtml = expanded
      ? `
        <div class="jamendo-guide">
          <ol class="jamendo-steps">
            <li>Click <strong>↗ Get Free Client ID</strong> to open the Jamendo Developer Portal and create a free account.</li>
            <li>Click <strong>"Create an Application"</strong> (any app name like <em>OhMyGramola</em> works — instant approval, no card needed).</li>
            <li>Copy the 8-character <strong>Client ID</strong> (ignore Client Secret) and paste it below:</li>
          </ol>
          <div class="jamendo-inline-form">
            <input type="text" class="form-input js-jamendo-inline-input" placeholder="Paste 8-character Client ID" value="${currentId.replace(/"/g, "&quot;")}" />
            <button type="button" class="btn-sm btn-import js-jamendo-inline-save">Save & Load</button>
          </div>
        </div>
      `
      : "";

    elements.jamendoHelper.innerHTML = `
      <div class="jamendo-bar">
        <div class="jamendo-bar-status">${statusHtml}</div>
        <div class="jamendo-bar-actions">
          ${toggleBtnHtml}
          <button type="button" class="btn-sm btn-open-link js-jamendo-open-portal" title="Open Jamendo Developer Portal in browser">↗ Get Free Client ID</button>
        </div>
      </div>
      ${guideHtml}
    `;

    const portalBtn = elements.jamendoHelper.querySelector(".js-jamendo-open-portal");
    if (portalBtn) portalBtn.addEventListener("click", openJamendoPortal);

    const toggleBtn = elements.jamendoHelper.querySelector(".js-jamendo-toggle-help");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", () => {
        state.jamendoHelpExpanded = !state.jamendoHelpExpanded;
        renderJamendoHelper();
      });
    }

    const saveBtn = elements.jamendoHelper.querySelector(".js-jamendo-inline-save");
    const inlineInput = elements.jamendoHelper.querySelector(".js-jamendo-inline-input");
    if (saveBtn && inlineInput) {
      const saveInline = () => {
        const val = inlineInput.value.trim();
        window.JamendoProvider.setClientId(val);
        state.jamendoHelpExpanded = false;
        showToast(val ? "✓ Jamendo Client ID saved!" : "Jamendo Client ID cleared.");
        renderJamendoHelper();
        loadCurrentSource();
      };
      saveBtn.addEventListener("click", saveInline);
      inlineInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") saveInline();
      });
    }
  }

  function renderTabs() {
    if (!elements.tabsNav) return;

    const merged = getMergeOnlinePreference();
    const favCount = window.FavoritesManager ? window.FavoritesManager.count() : 0;
    const favLabel = favCount > 0 ? `♥ Favorites (${favCount})` : "♥ Favorites";

    let tabs = [];
    if (merged) {
      if (state.activeSource !== "online" && state.activeSource !== "favorites" && state.activeSource !== "local") {
        state.activeSource = "online";
      }
      tabs = [
        { id: "online", label: "Online Library" },
        { id: "favorites", label: favLabel },
        { id: "local", label: "Local Library" }
      ];
    } else {
      if (state.activeSource === "online") {
        state.activeSource = "incompetech";
      }
      tabs = [
        { id: "incompetech", label: "Kevin MacLeod" },
        { id: "jamendo", label: "Jamendo" },
        { id: "favorites", label: favLabel },
        { id: "local", label: "Local Library" }
      ];
    }

    elements.tabsNav.innerHTML = "";

    tabs.forEach((tab) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `tab-btn ${state.activeSource === tab.id ? "active" : ""}`;
      btn.dataset.source = tab.id;
      btn.textContent = tab.label;

      btn.addEventListener("click", () => {
        if (state.activeSource !== tab.id) {
          state.selectedGenre = "";
        }
        state.activeSource = tab.id;
        renderTabs();
        updateFilterBar();
        renderJamendoHelper();
        populateGenres();
        loadCurrentSource();
      });

      elements.tabsNav.appendChild(btn);
    });
  }

  async function populateGenres() {
    if (!elements.genreSelect) return;
    elements.genreSelect.innerHTML = '<option value="">All Genres</option>';

    if (state.activeSource === "incompetech" || state.activeSource === "online") {
      try {
        const genres = await window.IncompetechProvider.getGenres();
        genres.forEach((g) => {
          const opt = document.createElement("option");
          opt.value = g;
          opt.textContent = g;
          elements.genreSelect.appendChild(opt);
        });
        elements.genreSelect.value = state.selectedGenre;
        elements.genreSelect.style.display = "block";
      } catch (_) {
        elements.genreSelect.style.display = "none";
      }
    } else if (state.activeSource === "local" && window.LocalLibraryProvider) {
      try {
        const localGenres = await window.LocalLibraryProvider.getGenres();
        if (localGenres.length >= 2) {
          localGenres.forEach((g) => {
            const opt = document.createElement("option");
            opt.value = g;
            opt.textContent = g;
            elements.genreSelect.appendChild(opt);
          });
          elements.genreSelect.value = state.selectedGenre;
          elements.genreSelect.style.display = "block";
        } else {
          elements.genreSelect.style.display = "none";
        }
      } catch (_) {
        elements.genreSelect.style.display = "none";
      }
    } else if (state.activeSource === "favorites" && window.FavoritesManager) {
      try {
        const favGenres = await window.FavoritesManager.getGenres();
        if (favGenres.length >= 2) {
          favGenres.forEach((g) => {
            const opt = document.createElement("option");
            opt.value = g;
            opt.textContent = g;
            elements.genreSelect.appendChild(opt);
          });
          elements.genreSelect.value = state.selectedGenre;
          elements.genreSelect.style.display = "block";
        } else {
          elements.genreSelect.style.display = "none";
        }
      } catch (_) {
        elements.genreSelect.style.display = "none";
      }
    } else {
      elements.genreSelect.style.display = "none";
    }
  }

  async function loadCurrentSource() {
    renderJamendoHelper();

    if (state.activeSource === "jamendo" && window.JamendoProvider && !window.JamendoProvider.hasClientId()) {
      state.tracks = [];
      state.loading = false;
      elements.trackList.innerHTML = "";
      renderStatus("Paste your free Jamendo Client ID above to browse thousands of YouTube-safe tracks.");
      return;
    }

    state.loading = true;
    renderStatus("Loading music catalog...");
    elements.trackList.innerHTML = "";

    try {
      let results = [];
      if (state.activeSource === "incompetech") {
        results = await window.IncompetechProvider.search({
          query: state.searchQuery,
          genre: state.selectedGenre
        });
      } else if (state.activeSource === "local") {
        results = await window.LocalLibraryProvider.scan({
          query: state.searchQuery,
          genre: state.selectedGenre
        });
      } else if (state.activeSource === "favorites") {
        results = await window.FavoritesManager.search({
          query: state.searchQuery,
          genre: state.selectedGenre
        });
      } else if (state.activeSource === "jamendo") {
        results = await window.JamendoProvider.search({
          query: state.searchQuery,
          tags: state.selectedGenre
        });
      } else if (state.activeSource === "online") {
        const queries = [
          window.IncompetechProvider.search({
            query: state.searchQuery,
            genre: state.selectedGenre,
            limit: 40
          })
        ];
        if (window.JamendoProvider && window.JamendoProvider.hasClientId()) {
          queries.push(
            window.JamendoProvider.search({
              query: state.searchQuery,
              tags: state.selectedGenre
            })
          );
        }

        const settled = await Promise.allSettled(queries);
        const incTracks = settled[0] && settled[0].status === "fulfilled" ? settled[0].value : [];
        const jamTracks = settled[1] && settled[1].status === "fulfilled" ? settled[1].value : [];

        const merged = [];
        const max = Math.max(incTracks.length, jamTracks.length);
        for (let i = 0; i < max; i++) {
          if (i < incTracks.length) merged.push(incTracks[i]);
          if (i < jamTracks.length) merged.push(jamTracks[i]);
        }
        results = merged;
      }

      state.tracks = results;
      state.loading = false;
      renderTrackList();
    } catch (err) {
      state.loading = false;
      renderStatus(`Error loading tracks: ${err.message || err}`);
    }
  }

  function renderStatus(msg) {
    if (!elements.statusMessage) return;
    elements.statusMessage.textContent = msg;
    elements.statusMessage.style.display = msg ? "block" : "none";
  }

  function scrollTrackCardIntoView(trackId) {
    if (!elements.trackList || !trackId) return;
    const cards = elements.trackList.querySelectorAll(".track-card");
    for (let i = 0; i < cards.length; i++) {
      if (cards[i].dataset.trackId === trackId) {
        cards[i].scrollIntoView({ block: "nearest", behavior: "smooth" });
        break;
      }
    }
  }

  function renderTrackList() {
    elements.trackList.innerHTML = "";
    if (state.tracks.length === 0) {
      if (state.activeSource === "favorites" && !state.searchQuery) {
        renderStatus("No favorites yet. Click the heart icon (or press F) on any song you like!");
      } else {
        renderStatus("No tracks found matching your query or filters.");
      }
      return;
    }
    renderStatus("");

    const currentTrack = window.MusicPlayer.getCurrentTrack();
    const isPlaying = window.MusicPlayer.isPlaying();

    state.tracks.forEach((track) => {
      const isCurrent = Boolean(currentTrack && currentTrack.id === track.id);
      const isFav = window.FavoritesManager ? window.FavoritesManager.isFavorite(track.id) : false;
      const trim = window.WaveformView ? window.WaveformView.getTrim(track.id) : null;

      const card = document.createElement("div");
      card.className = `track-card ${isCurrent ? "active-playback" : ""}`;
      card.dataset.trackId = track.id;

      const playSvg = isCurrent && isPlaying ? pauseIconSvg(14) : playIconSvg(14);
      const sourceBadgeText = track.source === "incompetech"
        ? "Incompetech"
        : track.source === "jamendo"
        ? "Jamendo"
        : (track.sourceLabel || "Local");

      const linkHtml = track.webUrl
        ? `<button type="button" class="btn-sm btn-open-link" title="Open original track page in web browser (↗)">↗</button>`
        : ``;

      let importLabel = "Import to AE";
      if (state.downloadingId === track.id) {
        importLabel = "Importing...";
      } else if (trim) {
        const trimDur = (trim.trimOut - trim.trimIn).toFixed(1);
        importLabel = `Import Trim (${trimDur}s)`;
      }

      card.innerHTML = `
        <button type="button" class="play-circle-btn" title="Play / Pause (Space)" aria-label="Play or Pause">${playSvg}</button>
        <div class="track-info">
          <div class="track-title" title="${track.title.replace(/"/g, "&quot;")}">${track.title}</div>
          <div class="track-artist">${track.artist}</div>
          <div class="track-meta">
            <span class="badge badge-source">${sourceBadgeText}</span>
            <span class="badge badge-license">${track.licenseType}</span>
            <span class="badge">${track.genre}</span>
            ${track.bpm && track.bpm !== "—" ? `<span class="badge">${track.bpm} BPM</span>` : ""}
            <span class="badge">${track.duration}</span>
          </div>
        </div>
        <div class="track-actions">
          <button type="button" class="fav-btn ${isFav ? "active" : ""}" title="${isFav ? "Remove from Favorites" : "Add to Favorites"}" aria-label="Favorite">${heartIconSvg(isFav, 14)}</button>
          ${linkHtml}
          <button type="button" class="btn-sm btn-copy" title="Copy YouTube description credits to clipboard">Copy Credits</button>
          <button type="button" class="btn-sm btn-import ${trim ? "is-trimmed" : ""}" title="${trim ? "Import trimmed In/Out selection into After Effects" : "Download & import directly into After Effects project"}">
            ${importLabel}
          </button>
        </div>
      `;

      // Play button event
      const playBtn = card.querySelector(".play-circle-btn");
      playBtn.addEventListener("click", () => {
        window.MusicPlayer.toggle(track);
      });

      // Favorite toggle event
      const favBtn = card.querySelector(".fav-btn");
      favBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!window.FavoritesManager) return;
        const added = window.FavoritesManager.toggle(track);
        showToast(added ? `♥ Added "${track.title}" to Favorites` : `Removed "${track.title}" from Favorites`);
        if (state.activeSource === "favorites" && !added) {
          loadCurrentSource();
        } else {
          renderTrackList();
          updateNowPlayingFavoriteUI();
        }
      });

      // Open link button event
      const linkBtn = card.querySelector(".btn-open-link");
      if (linkBtn && track.webUrl) {
        linkBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (window.BrokerClient && typeof window.BrokerClient.openExternal === "function") {
            window.BrokerClient.openExternal(track.webUrl);
          }
        });
      }

      // Copy credits button event
      const copyBtn = card.querySelector(".btn-copy");
      copyBtn.addEventListener("click", async () => {
        const ok = await copyToClipboard(track.attribution);
        if (ok) {
          showToast("✓ CC attribution copied to clipboard for YouTube");
        }
      });

      // Import button event
      const importBtn = card.querySelector(".btn-import");
      importBtn.addEventListener("click", () => {
        handleDownloadAndImport(track);
      });

      elements.trackList.appendChild(card);
    });
  }

  async function handleDownloadAndImport(track) {
    if (!track || state.downloadingId) return;

    const trim = window.WaveformView ? window.WaveformView.getTrim(track.id) : null;

    state.downloadingId = track.id;
    updateTrimToolbarUI();
    renderTrackList();

    try {
      let finalAudioPath = track.localPath;
      let trimmedOnDisk = false;

      // Use broker whenever downloading OR whenever trimming is requested
      if (!finalAudioPath || trim) {
        showToast(trim ? "Preparing trimmed audio for After Effects..." : "Downloading track to P:\\IA\\RRSS\\Music...");

        if (!window.BrokerClient) {
          throw new Error("Broker client unavailable.");
        }
        const ready = await window.BrokerClient.init();
        if (!ready) {
          throw new Error("Local bridge is not ready. Check that Node.js is installed.");
        }

        const importRes = await window.BrokerClient.importTrack({
          track: track,
          targetDir: window.LocalLibraryProvider.getLibraryPath(),
          trimIn: trim ? trim.trimIn : null,
          trimOut: trim ? trim.trimOut : null
        });
        finalAudioPath = importRes.path;
        trimmedOnDisk = Boolean(importRes.trimmedOnDisk);

        if (window.LocalLibraryProvider && typeof window.LocalLibraryProvider.invalidateCache === "function") {
          window.LocalLibraryProvider.invalidateCache();
        }
      }

      // Copy attribution to clipboard for YouTube description
      if (track.attribution) {
        await copyToClipboard(track.attribution);
      }

      showToast("Importing into After Effects project...");
      const result = await window.AEBridge.importAudio(finalAudioPath, true, {
        trimIn: trim ? trim.trimIn : null,
        trimOut: trim ? trim.trimOut : null,
        trimmedOnDisk: trimmedOnDisk
      });

      if (result && result.ok) {
        if (trim) {
          const dur = (trim.trimOut - trim.trimIn).toFixed(1);
          showToast(`✓ Trimmed clip (${dur}s) imported to AE & credits copied!`);
        } else {
          showToast("✓ Track imported to AE & credits copied to clipboard!");
        }
      } else {
        showToast(`Saved on disk, but AE reported: ${(result && result.error) || "Check that an After Effects project is open."}`);
      }
    } catch (err) {
      console.error("Import error:", err);
      showToast(`Error: ${err.message || err}`);
    } finally {
      state.downloadingId = null;
      updateTrimToolbarUI();
      renderTrackList();
    }
  }

  function stepTrackSelection(delta) {
    if (!state.tracks || state.tracks.length === 0) return;
    const cur = window.MusicPlayer.getCurrentTrack();
    let idx = cur ? state.tracks.findIndex((t) => t.id === cur.id) : -1;

    if (idx === -1) {
      idx = delta > 0 ? 0 : state.tracks.length - 1;
    } else {
      idx = Math.max(0, Math.min(state.tracks.length - 1, idx + delta));
    }

    const nextTrack = state.tracks[idx];
    if (nextTrack && (!cur || cur.id !== nextTrack.id)) {
      window.MusicPlayer.play(nextTrack);
      requestAnimationFrame(() => scrollTrackCardIntoView(nextTrack.id));
    } else if (nextTrack) {
      scrollTrackCardIntoView(nextTrack.id);
    }
  }

  // Initialize Waveform View
  if (window.WaveformView && elements.waveformCanvas) {
    window.WaveformView.init(elements.waveformCanvas);
    window.WaveformView.onTrimChange(() => {
      updateTrimToolbarUI();
      renderTrackList();
    });
  }

  // Favorites change listener (updates tab counter)
  if (window.FavoritesManager) {
    window.FavoritesManager.onChange(() => {
      renderTabs();
      updateNowPlayingFavoriteUI();
    });
  }

  // Audio Player Listeners
  window.MusicPlayer.onTrackChange((track) => {
    if (window.WaveformView) {
      window.WaveformView.setTrack(track);
    }
    updateNowPlayingFavoriteUI();
    updateTrimToolbarUI();
  });

  window.MusicPlayer.onStateChange((playbackState, currentTrack) => {
    if (currentTrack) {
      elements.npTitle.textContent = currentTrack.title;
      elements.npSub.textContent = `${currentTrack.artist} • ${currentTrack.licenseType}`;
    }
    updateMainPlayPauseIcon(playbackState === "playing");
    updateNowPlayingFavoriteUI();
    updateTrimToolbarUI();
    renderTrackList();
  });

  window.MusicPlayer.onProgress(({ current, duration, livePeak }) => {
    elements.timeCurrent.textContent = formatTime(current);
    elements.timeTotal.textContent = formatTime(duration);
    if (window.WaveformView) {
      window.WaveformView.updateProgress({ current, duration, livePeak });
    }
  });

  // Trim Toolbar Buttons
  if (elements.trimInBtn) {
    elements.trimInBtn.addEventListener("click", () => {
      const t = window.WaveformView && window.WaveformView.setInAtPlayhead();
      if (t) showToast(`In set at ${formatPreciseTime(t.trimIn)}`);
    });
  }
  if (elements.trimOutBtn) {
    elements.trimOutBtn.addEventListener("click", () => {
      const t = window.WaveformView && window.WaveformView.setOutAtPlayhead();
      if (t) showToast(`Out set at ${formatPreciseTime(t.trimOut)} (${(t.trimOut - t.trimIn).toFixed(1)}s)`);
    });
  }
  if (elements.trimClearBtn) {
    elements.trimClearBtn.addEventListener("click", () => {
      if (window.WaveformView) window.WaveformView.clearTrim();
      showToast("Trim selection cleared");
    });
  }

  // Bottom Player Favorite & Import Buttons
  if (elements.npFavBtn) {
    elements.npFavBtn.addEventListener("click", () => {
      const cur = window.MusicPlayer.getCurrentTrack();
      if (!cur || !window.FavoritesManager) return;
      const added = window.FavoritesManager.toggle(cur);
      showToast(added ? `♥ Added "${cur.title}" to Favorites` : `Removed "${cur.title}" from Favorites`);
      if (state.activeSource === "favorites" && !added) {
        loadCurrentSource();
      } else {
        renderTrackList();
        updateNowPlayingFavoriteUI();
      }
    });
  }

  if (elements.playerImportBtn) {
    elements.playerImportBtn.addEventListener("click", () => {
      const cur = window.MusicPlayer.getCurrentTrack();
      if (cur) handleDownloadAndImport(cur);
    });
  }

  // Open Folder Button Click Event
  if (elements.openFolderBtn) {
    elements.openFolderBtn.addEventListener("click", () => {
      const libPath = window.LocalLibraryProvider
        ? window.LocalLibraryProvider.getLibraryPath()
        : "P:\\IA\\RRSS\\Music";
      if (window.BrokerClient && typeof window.BrokerClient.openExternal === "function") {
        window.BrokerClient.openExternal(libPath);
      }
    });
  }

  // Search & Filter Inputs
  let searchDebounce = null;
  elements.searchInput.addEventListener("input", (e) => {
    state.searchQuery = e.target.value;
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      loadCurrentSource();
    }, 250);
  });

  elements.genreSelect.addEventListener("change", (e) => {
    state.selectedGenre = e.target.value;
    elements.genreSelect.blur();
    loadCurrentSource();
  });

  elements.playPauseBtn.addEventListener("click", () => {
    const cur = window.MusicPlayer.getCurrentTrack();
    if (cur) {
      window.MusicPlayer.toggle(cur);
    } else if (state.tracks.length > 0) {
      window.MusicPlayer.play(state.tracks[0]);
    }
  });

  elements.volSlider.addEventListener("input", (e) => {
    window.MusicPlayer.setVolume(parseFloat(e.target.value));
  });

  // Global Keyboard Shortcuts when focus is in OhMyGramola
  window.addEventListener("keydown", (e) => {
    if (elements.settingsModal && elements.settingsModal.classList.contains("open")) {
      if (e.key === "Escape") {
        elements.settingsModal.classList.remove("open");
      }
      return;
    }

    const activeEl = document.activeElement;
    const tag = activeEl ? activeEl.tagName.toLowerCase() : "";
    const isTextInput = (tag === "input" && activeEl.type !== "range" && activeEl.type !== "checkbox") || tag === "textarea";

    if (isTextInput) {
      if (e.key === "Escape" || e.key === "Enter") {
        activeEl.blur();
        e.preventDefault();
      } else if (activeEl === elements.searchInput && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        activeEl.blur();
        e.preventDefault();
        stepTrackSelection(e.key === "ArrowDown" ? 1 : -1);
      }
      return;
    }

    // Allow native <select> dropdown navigation if focused
    if (tag === "select") return;

    if (e.code === "Space" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      const cur = window.MusicPlayer.getCurrentTrack();
      if (cur) {
        window.MusicPlayer.toggle(cur);
      } else if (state.tracks.length > 0) {
        window.MusicPlayer.play(state.tracks[0]);
      }
      return;
    }

    if (e.key === "ArrowLeft") {
      e.preventDefault();
      e.stopPropagation();
      const jump = e.shiftKey ? -60 : -10;
      window.MusicPlayer.seekBy(jump);
      return;
    }

    if (e.key === "ArrowRight") {
      e.preventDefault();
      e.stopPropagation();
      const jump = e.shiftKey ? 60 : 10;
      window.MusicPlayer.seekBy(jump);
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      stepTrackSelection(-1);
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      stepTrackSelection(1);
      return;
    }

    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      const lowerKey = (e.key || "").toLowerCase();
      if (lowerKey === "i") {
        e.preventDefault();
        const t = window.WaveformView && window.WaveformView.setInAtPlayhead();
        if (t) showToast(`In: ${formatPreciseTime(t.trimIn)}`);
      } else if (lowerKey === "o") {
        e.preventDefault();
        const t = window.WaveformView && window.WaveformView.setOutAtPlayhead();
        if (t) showToast(`Out: ${formatPreciseTime(t.trimOut)} (${(t.trimOut - t.trimIn).toFixed(1)}s)`);
      } else if (lowerKey === "x") {
        e.preventDefault();
        if (window.WaveformView) {
          window.WaveformView.clearTrim();
          showToast("Trim selection cleared");
        }
      } else if (lowerKey === "f") {
        e.preventDefault();
        const cur = window.MusicPlayer.getCurrentTrack();
        if (cur && window.FavoritesManager) {
          const added = window.FavoritesManager.toggle(cur);
          showToast(added ? `♥ Added "${cur.title}" to Favorites` : `Removed "${cur.title}" from Favorites`);
          if (state.activeSource === "favorites" && !added) {
            loadCurrentSource();
          } else {
            renderTrackList();
            updateNowPlayingFavoriteUI();
          }
        }
      }
    }
  }, true);

  // Settings Modal Events
  if (elements.modalJamendoPortalBtn) {
    elements.modalJamendoPortalBtn.addEventListener("click", openJamendoPortal);
  }

  elements.settingsBtn.addEventListener("click", () => {
    elements.inputJamendoKey.value = window.JamendoProvider.getClientId();
    elements.inputLocalPath.value = window.LocalLibraryProvider.getLibraryPath();
    if (elements.checkboxMergeOnline) {
      elements.checkboxMergeOnline.checked = getMergeOnlinePreference();
    }
    elements.settingsModal.classList.add("open");
  });

  elements.closeSettingsBtn.addEventListener("click", () => {
    elements.settingsModal.classList.remove("open");
  });

  elements.saveSettingsBtn.addEventListener("click", () => {
    window.JamendoProvider.setClientId(elements.inputJamendoKey.value);
    window.LocalLibraryProvider.setLibraryPath(elements.inputLocalPath.value);
    if (elements.checkboxMergeOnline) {
      setMergeOnlinePreference(elements.checkboxMergeOnline.checked);
    }
    elements.settingsModal.classList.remove("open");
    showToast("Settings saved.");
    renderTabs();
    updateFilterBar();
    renderJamendoHelper();
    populateGenres();
    loadCurrentSource();
  });

  // Initial Boot
  updateMainPlayPauseIcon(false);
  updateNowPlayingFavoriteUI();
  updateTrimToolbarUI();
  renderTabs();
  updateFilterBar();
  renderJamendoHelper();
  populateGenres();
  setTimeout(() => {
    loadCurrentSource();
  }, 200);
})();
