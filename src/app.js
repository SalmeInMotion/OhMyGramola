/**
 * OhMyGramola — Application Orchestrator
 * Coordinates catalog sources, Favorites, streaming Waveform + In/Out Trimming,
 * keyboard shortcuts (Space, ←/→ ±10s / Shift ±60s, ↑/↓ track nav, I/O trim), and AE import.
 */
(function () {
  "use strict";

  const APP_VERSION = "1.3.0";
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
    selectedLicense: "",
    activeTags: [],
    tracks: [],
    loading: false,
    downloadingId: null,
    jamendoHelpExpanded: false
  };

  const elements = {
    tabsNav: document.getElementById("tabs-nav"),
    licensesBtn: document.getElementById("licenses-btn"),
    reloadLocalBtn: document.getElementById("reload-local-btn"),
    openFolderBtn: document.getElementById("open-folder-btn"),
    jamendoHelper: document.getElementById("jamendo-helper"),
    searchInput: document.getElementById("search-input"),
    searchSuggestions: document.getElementById("search-suggestions"),
    licenseSelect: document.getElementById("license-select"),
    genreSelect: document.getElementById("genre-select"),
    activeFiltersBar: document.getElementById("active-filters-bar"),
    trackList: document.getElementById("track-list"),
    statusMessage: document.getElementById("status-message"),
    trackContextMenu: document.getElementById("track-context-menu"),
    // License modals
    licenseCheckModal: document.getElementById("license-check-modal"),
    closeLicenseCheckBtn: document.getElementById("close-license-check-btn"),
    licenseCheckBody: document.getElementById("license-check-body"),
    licensesGuideModal: document.getElementById("licenses-guide-modal"),
    closeLicensesGuideBtn: document.getElementById("close-licenses-guide-btn"),
    licensesGuideBody: document.getElementById("licenses-guide-body"),
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
    inputDownloadsPath: document.getElementById("setting-downloads-path"),
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
    const isLocal = state.activeSource === "local";
    if (elements.openFolderBtn) elements.openFolderBtn.style.display = isLocal ? "inline-flex" : "none";
    if (elements.reloadLocalBtn) elements.reloadLocalBtn.style.display = isLocal ? "inline-flex" : "none";
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function populateLicenses() {
    if (!elements.licenseSelect || !window.LicenseGuide) return;
    const opts = window.LicenseGuide.getFilterOptions();
    elements.licenseSelect.innerHTML = '<option value="">All Licenses</option>';
    opts.forEach((optItem) => {
      const opt = document.createElement("option");
      opt.value = optItem.value;
      opt.textContent = optItem.label;
      elements.licenseSelect.appendChild(opt);
    });
    elements.licenseSelect.value = state.selectedLicense;
  }

  function renderActiveFiltersBar() {
    if (!elements.activeFiltersBar) return;
    const chips = [];

    if (state.selectedLicense && window.LicenseGuide) {
      const def = window.LicenseGuide.LICENSE_DEFS[state.selectedLicense];
      const lbl = def ? def.shortLabel : state.selectedLicense;
      chips.push({ kind: "license", value: state.selectedLicense, label: `License: ${lbl}` });
    }
    if (state.selectedGenre) {
      chips.push({ kind: "genre", value: state.selectedGenre, label: `Genre: ${state.selectedGenre}` });
    }
    state.activeTags.forEach((tag) => {
      chips.push({ kind: "tag", value: tag, label: tag });
    });

    if (chips.length === 0) {
      elements.activeFiltersBar.style.display = "none";
      elements.activeFiltersBar.innerHTML = "";
      return;
    }

    elements.activeFiltersBar.style.display = "flex";
    elements.activeFiltersBar.innerHTML = `<span class="filter-and-label">AND:</span>`;

    chips.forEach((chip) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "filter-chip";
      btn.title = "Click to remove this filter";
      btn.innerHTML = `<span>${escapeHtml(chip.label)}</span><span>✕</span>`;
      btn.addEventListener("click", () => {
        if (chip.kind === "license") {
          state.selectedLicense = "";
          if (elements.licenseSelect) elements.licenseSelect.value = "";
        } else if (chip.kind === "genre") {
          state.selectedGenre = "";
          if (elements.genreSelect) elements.genreSelect.value = "";
        } else if (chip.kind === "tag") {
          state.activeTags = state.activeTags.filter((t) => t !== chip.value);
        }
        renderActiveFiltersBar();
        loadCurrentSource();
      });
      elements.activeFiltersBar.appendChild(btn);
    });

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "filter-chip-clear";
    clearBtn.textContent = "Clear all";
    clearBtn.addEventListener("click", () => {
      state.selectedLicense = "";
      state.selectedGenre = "";
      state.activeTags = [];
      if (elements.licenseSelect) elements.licenseSelect.value = "";
      if (elements.genreSelect) elements.genreSelect.value = "";
      renderActiveFiltersBar();
      loadCurrentSource();
    });
    elements.activeFiltersBar.appendChild(clearBtn);
  }

  function hideSearchSuggestions() {
    if (elements.searchSuggestions) {
      elements.searchSuggestions.style.display = "none";
    }
  }

  function renderSearchSuggestions(filterText = "") {
    if (!elements.searchSuggestions || !window.LicenseGuide) return;
    const q = String(filterText || "").toLowerCase().trim();
    const base = window.LicenseGuide.getSuggestedFilters();

    // Include available genres from the dropdown as suggested categories too
    const genreSuggestions = [];
    if (elements.genreSelect && elements.genreSelect.style.display !== "none") {
      Array.from(elements.genreSelect.options).forEach((opt) => {
        if (opt.value) {
          genreSuggestions.push({ type: "genre", value: opt.value, label: `Genre: ${opt.value}`, group: "Genre" });
        }
      });
    }

    const combined = [...base, ...genreSuggestions].filter((item) => {
      if (item.type === "tag" && state.activeTags.includes(item.value.toLowerCase())) return false;
      if (item.type === "license" && state.selectedLicense === item.value) return false;
      if (item.type === "genre" && state.selectedGenre === item.value) return false;
      if (!q) return true;
      return item.label.toLowerCase().includes(q) || item.value.toLowerCase().includes(q) || item.group.toLowerCase().includes(q);
    }).slice(0, 14);

    if (combined.length === 0) {
      hideSearchSuggestions();
      return;
    }

    elements.searchSuggestions.innerHTML = "";
    let lastGroup = "";
    combined.forEach((item) => {
      if (item.group !== lastGroup) {
        lastGroup = item.group;
        const grp = document.createElement("div");
        grp.className = "suggestion-group-label";
        grp.textContent = item.group;
        elements.searchSuggestions.appendChild(grp);
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "suggestion-item";
      btn.innerHTML = `<span>${escapeHtml(item.label)}</span><span class="suggestion-hint">+ AND filter</span>`;
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        if (item.type === "license") {
          state.selectedLicense = item.value;
          if (elements.licenseSelect) elements.licenseSelect.value = item.value;
        } else if (item.type === "genre") {
          state.selectedGenre = item.value;
          if (elements.genreSelect) elements.genreSelect.value = item.value;
        } else {
          const val = item.value.toLowerCase();
          if (!state.activeTags.includes(val)) {
            state.activeTags.push(val);
          }
        }
        if (elements.searchInput && q && (item.value.toLowerCase().includes(q) || item.label.toLowerCase().includes(q))) {
          elements.searchInput.value = "";
          state.searchQuery = "";
        }
        hideSearchSuggestions();
        renderActiveFiltersBar();
        loadCurrentSource();
      });
      elements.searchSuggestions.appendChild(btn);
    });
    elements.searchSuggestions.style.display = "flex";
  }

  function openCheckLicenseModal(track) {
    if (!elements.licenseCheckModal || !elements.licenseCheckBody || !window.LicenseGuide) return;
    const info = window.LicenseGuide.explainTrackLicense(track);
    const toneClass = `tone-${info.tone || "neutral"}`;
    const attrBoxHtml = info.attributionText
      ? `
        <div class="license-attr-box">${escapeHtml(info.attributionText)}</div>
        <div style="display:flex; justify-content:flex-end; margin-top:4px;">
          <button type="button" class="btn-sm btn-copy js-modal-copy-attr">Copy Attribution</button>
        </div>
      `
      : "";

    elements.licenseCheckBody.innerHTML = `
      <div class="license-track-header">
        <div class="license-track-title">${escapeHtml(info.title)}</div>
        <div class="license-track-artist">${escapeHtml(info.artist)}</div>
      </div>
      <span class="license-pill ${toneClass}">${escapeHtml(info.rawLicense)} — ${escapeHtml(info.label)}</span>
      <div class="license-summary">${escapeHtml(info.summary)}</div>
      <div class="license-section">
        <div class="license-section-title">What You Can Do</div>
        <ul class="license-list can">
          ${info.canDo.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
        </ul>
      </div>
      <div class="license-section">
        <div class="license-section-title">Rules &amp; Limitations</div>
        <ul class="license-list cannot">
          ${info.cannotDo.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
        </ul>
      </div>
      <div class="license-section">
        <div class="license-section-title">How to Credit / Attribute</div>
        <div style="font-size:10.5px; color:var(--text-main); line-height:1.35;">${escapeHtml(info.howToAttribute)}</div>
        ${attrBoxHtml}
      </div>
    `;

    const copyBtn = elements.licenseCheckBody.querySelector(".js-modal-copy-attr");
    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        const ok = await copyToClipboard(info.attributionText);
        if (ok) showToast("✓ Attribution copied to clipboard");
      });
    }

    elements.licenseCheckModal.classList.add("open");
  }

  function openLicensesGuideModal() {
    if (!elements.licensesGuideModal || !elements.licensesGuideBody || !window.LicenseGuide) return;
    const all = window.LicenseGuide.getAllLicensesOverview();

    elements.licensesGuideBody.innerHTML = `
      <div class="license-summary">
        <strong>Are all tracks the same license?</strong> No — OhMyGramola mixes multiple YouTube-safe licenses across Kevin MacLeod, Jamendo, and your Local Library. Use the <strong>License filter</strong> in the search bar to isolate any specific license (and combine it with tags like <em>drums</em> using <strong>AND</strong> filtering).
      </div>
      <div class="license-section">
        <div class="license-section-title">Automatic YouTube Safety Filter</div>
        <div style="font-size:10.5px; color:var(--text-main); line-height:1.35;">
          Tracks with <strong>-NC (NonCommercial)</strong> or <strong>-ND (NoDerivatives)</strong> clauses are automatically excluded because they block YouTube monetization and video syncing.
        </div>
      </div>
      ${all.map((lic) => `
        <div class="license-guide-card">
          <span class="license-pill tone-${lic.tone}">${escapeHtml(lic.label)}</span>
          <div style="font-size:10.5px; color:var(--text-main); line-height:1.35;">${escapeHtml(lic.summary)}</div>
          <div class="license-guide-examples"><strong>Where seen:</strong> ${escapeHtml(lic.examples)}</div>
          <div style="font-size:10px; color:var(--text-muted);"><strong>Credit rule:</strong> ${escapeHtml(lic.howToAttribute)}</div>
        </div>
      `).join("")}
    `;

    elements.licensesGuideModal.classList.add("open");
  }

  function hideTrackContextMenu() {
    if (elements.trackContextMenu) {
      elements.trackContextMenu.style.display = "none";
      elements.trackContextMenu.innerHTML = "";
    }
  }

  function showTrackContextMenu(e, track) {
    if (!elements.trackContextMenu || !track) return;
    e.preventDefault();
    e.stopPropagation();

    const menu = elements.trackContextMenu;
    menu.innerHTML = "";
    const isLocal = track.source === "local" || Boolean(track.localPath);

    const addItem = (label, shortcut, onClick) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "context-menu-item";
      btn.innerHTML = `<span>${escapeHtml(label)}</span>${shortcut ? `<span class="context-menu-shortcut">${escapeHtml(shortcut)}</span>` : ""}`;
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        hideTrackContextMenu();
        onClick();
      });
      menu.appendChild(btn);
    };

    const addDivider = () => {
      const div = document.createElement("div");
      div.className = "context-menu-divider";
      menu.appendChild(div);
    };

    if (isLocal && track.localPath) {
      addItem("📋 Copy Path", "Shift+MidClick", async () => {
        const ok = await copyToClipboard(track.localPath);
        if (ok) showToast("✓ File path copied to clipboard");
      });
      addItem("📂 Open Folder", "", () => {
        if (window.BrokerClient && typeof window.BrokerClient.openExternal === "function") {
          window.BrokerClient.openExternal(track.localPath);
        }
      });
      addDivider();
    } else if (track.webUrl) {
      addItem("↗ Open Link", "", () => {
        if (window.BrokerClient && typeof window.BrokerClient.openExternal === "function") {
          window.BrokerClient.openExternal(track.webUrl);
        }
      });
      addDivider();
    }

    addItem("⚖ Check License", "", () => {
      openCheckLicenseModal(track);
    });

    menu.style.display = "flex";
    const rect = menu.getBoundingClientRect();
    const maxLeft = Math.max(4, window.innerWidth - rect.width - 6);
    const maxTop = Math.max(4, window.innerHeight - rect.height - 6);
    menu.style.left = `${Math.min(e.clientX, maxLeft)}px`;
    menu.style.top = `${Math.min(e.clientY, maxTop)}px`;
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

  let activeLocalScanHandle = null;
  let activeLoadToken = 0;

  function updateLocalTabCounter(count, isScanning) {
    const el = document.getElementById("local-tab-count");
    if (!el) return;
    el.textContent = typeof count === "number" ? `(${count})` : "";
    el.classList.toggle("is-scanning", Boolean(isScanning));
  }

  function applyLocalGenresIncremental(genres) {
    if (!elements.genreSelect || state.activeSource !== "local") return;
    if (!Array.isArray(genres) || genres.length < 2) {
      elements.genreSelect.style.display = "none";
      return;
    }
    const existing = new Set(Array.from(elements.genreSelect.options).map((o) => o.value));
    let added = false;
    genres.forEach((g) => {
      if (!existing.has(g)) {
        const opt = document.createElement("option");
        opt.value = g;
        opt.textContent = g;
        elements.genreSelect.appendChild(opt);
        added = true;
      }
    });
    if (added) {
      elements.genreSelect.value = state.selectedGenre;
    }
    elements.genreSelect.style.display = "block";
  }

  function renderTabs() {
    if (!elements.tabsNav) return;

    const merged = getMergeOnlinePreference();
    const favCount = window.FavoritesManager ? window.FavoritesManager.count() : 0;
    const favLabel = favCount > 0 ? `♥ Favorites (${favCount})` : "♥ Favorites";
    const localCount = window.LocalLibraryProvider ? window.LocalLibraryProvider.getCachedCount() : null;
    const localScanning = window.LocalLibraryProvider ? window.LocalLibraryProvider.isScanning() : false;

    let tabs = [];
    if (merged) {
      if (state.activeSource !== "online" && state.activeSource !== "favorites" && state.activeSource !== "local") {
        state.activeSource = "online";
      }
      tabs = [
        { id: "online", label: "Online Library" },
        { id: "favorites", label: favLabel },
        { id: "local", label: "Local Library", count: localCount, scanning: localScanning }
      ];
    } else {
      if (state.activeSource === "online") {
        state.activeSource = "incompetech";
      }
      tabs = [
        { id: "incompetech", label: "Kevin MacLeod" },
        { id: "jamendo", label: "Jamendo" },
        { id: "favorites", label: favLabel },
        { id: "local", label: "Local Library", count: localCount, scanning: localScanning }
      ];
    }

    elements.tabsNav.innerHTML = "";

    tabs.forEach((tab) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `tab-btn ${state.activeSource === tab.id ? "active" : ""}`;
      btn.dataset.source = tab.id;

      if (tab.id === "local") {
        const lblSpan = document.createElement("span");
        lblSpan.textContent = tab.label;
        const cntSpan = document.createElement("span");
        cntSpan.id = "local-tab-count";
        cntSpan.className = `tab-count ${tab.scanning ? "is-scanning" : ""}`;
        cntSpan.textContent = typeof tab.count === "number" ? `(${tab.count})` : "";
        btn.appendChild(lblSpan);
        btn.appendChild(cntSpan);
      } else {
        btn.textContent = tab.label;
      }

      btn.addEventListener("click", () => {
        if (state.activeSource !== tab.id) {
          state.selectedGenre = "";
        }
        state.activeSource = tab.id;
        renderTabs();
        updateFilterBar();
        renderJamendoHelper();
        populateGenres();
        renderActiveFiltersBar();
        loadCurrentSource({ forceLocalRefresh: false });
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
      // Genres for Local Library are populated incrementally during progressive scan
      if (!window.LocalLibraryProvider.isScanning() && window.LocalLibraryProvider.getCachedCount() !== null) {
        try {
          const localGenres = await window.LocalLibraryProvider.getGenres();
          applyLocalGenresIncremental(localGenres);
        } catch (_) {
          elements.genreSelect.style.display = "none";
        }
      } else {
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

  async function loadCurrentSource({ forceLocalRefresh = false } = {}) {
    if (activeLocalScanHandle && typeof activeLocalScanHandle.cancel === "function") {
      activeLocalScanHandle.cancel();
      activeLocalScanHandle = null;
    }

    const loadToken = ++activeLoadToken;
    renderJamendoHelper();

    if (state.activeSource === "jamendo" && window.JamendoProvider && !window.JamendoProvider.hasClientId()) {
      state.tracks = [];
      state.loading = false;
      elements.trackList.innerHTML = "";
      renderStatus("Paste your free Jamendo Client ID above to browse thousands of YouTube-safe tracks.");
      return;
    }

    const combinedQuery = [state.searchQuery, ...state.activeTags].filter(Boolean).join(" ").trim();
    const filterTrack = (t) => {
      if (window.LicenseGuide && typeof window.LicenseGuide.matchesTrackAllCriteria === "function") {
        return window.LicenseGuide.matchesTrackAllCriteria(t, {
          query: state.searchQuery,
          genre: state.selectedGenre,
          license: state.selectedLicense,
          tags: state.activeTags
        });
      }
      return true;
    };

    if (state.activeSource === "local" && window.LocalLibraryProvider && typeof window.LocalLibraryProvider.scanProgressive === "function") {
      state.loading = true;
      state.tracks = [];
      elements.trackList.innerHTML = "";
      const initialCount = window.LocalLibraryProvider.getCachedCount();
      renderStatus(initialCount !== null
        ? `Scanning local library... (${initialCount} tracks detected)`
        : "Scanning local library...");

      const handle = window.LocalLibraryProvider.scanProgressive({
        query: combinedQuery,
        genre: state.selectedGenre,
        forceRefresh: forceLocalRefresh,
        onBatch({ newMatches, totalDetected, genres, done }) {
          if (loadToken !== activeLoadToken || state.activeSource !== "local") return;

          updateLocalTabCounter(totalDetected, !done);
          applyLocalGenresIncremental(genres);

          const filteredBatch = (newMatches || []).filter((t) => {
            if (!state.selectedLicense || !window.LicenseGuide) return true;
            return window.LicenseGuide.matchesLicenseFilter(t, state.selectedLicense);
          });

          if (filteredBatch.length > 0) {
            state.tracks.push(...filteredBatch);
            appendTrackCards(filteredBatch);
          }

          if (!done) {
            renderStatus(`Scanning local library... ${totalDetected} tracks detected`);
          } else {
            state.loading = false;
            if (state.tracks.length === 0) {
              renderStatus("No tracks found matching your query or filters.");
            } else {
              renderStatus("");
            }
          }
        }
      });

      activeLocalScanHandle = handle;
      await handle.promise;
      if (loadToken === activeLoadToken && activeLocalScanHandle === handle) {
        activeLocalScanHandle = null;
        state.loading = false;
      }
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
          genre: state.selectedGenre,
          license: state.selectedLicense,
          tags: state.activeTags
        });
      } else if (state.activeSource === "local") {
        results = await window.LocalLibraryProvider.scan({
          query: combinedQuery,
          genre: state.selectedGenre
        });
        results = results.filter(filterTrack);
      } else if (state.activeSource === "favorites") {
        results = await window.FavoritesManager.search({
          query: combinedQuery,
          genre: state.selectedGenre
        });
        results = results.filter(filterTrack);
      } else if (state.activeSource === "jamendo") {
        const jamTags = [state.selectedGenre, ...state.activeTags].filter(Boolean).join(" ");
        results = await window.JamendoProvider.search({
          query: state.searchQuery,
          tags: jamTags
        });
        results = results.filter(filterTrack);
      } else if (state.activeSource === "online") {
        const jamTags = [state.selectedGenre, ...state.activeTags].filter(Boolean).join(" ");
        const queries = [
          window.IncompetechProvider.search({
            query: state.searchQuery,
            genre: state.selectedGenre,
            license: state.selectedLicense,
            tags: state.activeTags,
            limit: 40
          })
        ];
        if (window.JamendoProvider && window.JamendoProvider.hasClientId()) {
          queries.push(
            window.JamendoProvider.search({
              query: state.searchQuery,
              tags: jamTags
            })
          );
        }

        const settled = await Promise.allSettled(queries);
        const incTracks = settled[0] && settled[0].status === "fulfilled" ? settled[0].value : [];
        const jamTracks = (settled[1] && settled[1].status === "fulfilled" ? settled[1].value : []).filter(filterTrack);

        const merged = [];
        const max = Math.max(incTracks.length, jamTracks.length);
        for (let i = 0; i < max; i++) {
          if (i < incTracks.length) merged.push(incTracks[i]);
          if (i < jamTracks.length) merged.push(jamTracks[i]);
        }
        results = merged;
      }

      if (loadToken !== activeLoadToken) return;
      state.tracks = results;
      state.loading = false;
      renderTrackList();
    } catch (err) {
      if (loadToken !== activeLoadToken) return;
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

  function createTrackCard(track, currentTrack, isPlaying) {
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

    card.querySelector(".play-circle-btn").addEventListener("click", () => {
      window.MusicPlayer.toggle(track);
    });

    card.querySelector(".fav-btn").addEventListener("click", (e) => {
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

    const linkBtn = card.querySelector(".btn-open-link");
    if (linkBtn && track.webUrl) {
      linkBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (window.BrokerClient && typeof window.BrokerClient.openExternal === "function") {
          window.BrokerClient.openExternal(track.webUrl);
        }
      });
    }

    card.querySelector(".btn-copy").addEventListener("click", async () => {
      const ok = await copyToClipboard(track.attribution);
      if (ok) {
        showToast("✓ CC attribution copied to clipboard for YouTube");
      }
    });

    card.querySelector(".btn-import").addEventListener("click", () => {
      handleDownloadAndImport(track);
    });

    card.addEventListener("contextmenu", (e) => {
      showTrackContextMenu(e, track);
    });

    // Shift + Middle Click copies local file path (for local tracks)
    card.addEventListener("mousedown", (e) => {
      if (e.button === 1 && e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        if (track.localPath) {
          copyToClipboard(track.localPath).then((ok) => {
            if (ok) showToast("✓ File path copied to clipboard");
          });
        } else if (track.webUrl) {
          copyToClipboard(track.webUrl).then((ok) => {
            if (ok) showToast("✓ Track link copied to clipboard");
          });
        }
      }
    });

    return card;
  }

  function appendTrackCards(tracks) {
    if (!elements.trackList || !tracks || tracks.length === 0) return;
    const currentTrack = window.MusicPlayer.getCurrentTrack();
    const isPlaying = window.MusicPlayer.isPlaying();
    const frag = document.createDocumentFragment();
    tracks.forEach((track) => {
      frag.appendChild(createTrackCard(track, currentTrack, isPlaying));
    });
    elements.trackList.appendChild(frag);
  }

  function renderTrackList() {
    elements.trackList.innerHTML = "";
    if (state.tracks.length === 0) {
      if (state.loading && state.activeSource === "local") return;
      if (state.activeSource === "favorites" && !state.searchQuery) {
        renderStatus("No favorites yet. Click the heart icon (or press F) on any song you like!");
      } else {
        renderStatus("No tracks found matching your query or filters.");
      }
      return;
    }
    if (!state.loading) {
      renderStatus("");
    }
    appendTrackCards(state.tracks);
  }

  async function handleDownloadAndImport(track) {
    if (!track || state.downloadingId) return;

    const trim = window.WaveformView ? window.WaveformView.getTrim(track.id) : null;

    state.downloadingId = track.id;
    updateTrimToolbarUI();
    renderTrackList();

    try {
      let finalAudioPath = track.localPath;

      // Download full master audio to dedicated Online Downloads folder if not already on disk
      if (!finalAudioPath) {
        const targetDir = window.LocalLibraryProvider.getDownloadsPath();
        showToast(`Downloading full track to ${targetDir}...`);

        if (!window.BrokerClient) {
          throw new Error("Broker client unavailable.");
        }
        const ready = await window.BrokerClient.init();
        if (!ready) {
          throw new Error("Local bridge is not ready. Check that Node.js is installed.");
        }

        const importRes = await window.BrokerClient.importTrack({
          track: track,
          targetDir: targetDir
        });
        finalAudioPath = importRes.masterPath || importRes.path;
      }

      // Copy attribution to clipboard for YouTube description
      if (track.attribution) {
        await copyToClipboard(track.attribution);
      }

      showToast(trim ? "Creating trimmed pre-comp with full audio in After Effects..." : "Importing into After Effects project...");
      const result = await window.AEBridge.importAudio(finalAudioPath, true, {
        trimIn: trim ? trim.trimIn : null,
        trimOut: trim ? trim.trimOut : null
      });

      if (result && result.ok) {
        if (trim) {
          const dur = (trim.trimOut - trim.trimIn).toFixed(1);
          showToast(`✓ Full track imported inside "${result.compName || "Trim Comp"}" (${dur}s) & credits copied!`);
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

  // Suppress native browser right-click menu globally (Back/Forward/Print/View Source)
  window.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (!e.target.closest || !e.target.closest(".track-card")) {
      hideTrackContextMenu();
    }
  });

  document.addEventListener("click", (e) => {
    if (elements.trackContextMenu && !elements.trackContextMenu.contains(e.target)) {
      hideTrackContextMenu();
    }
    if (elements.searchSuggestions && e.target !== elements.searchInput && !elements.searchSuggestions.contains(e.target)) {
      hideSearchSuggestions();
    }
  });

  if (elements.licensesBtn) {
    elements.licensesBtn.addEventListener("click", () => {
      openLicensesGuideModal();
    });
  }

  if (elements.closeLicenseCheckBtn) {
    elements.closeLicenseCheckBtn.addEventListener("click", () => {
      elements.licenseCheckModal.classList.remove("open");
    });
  }

  if (elements.licenseCheckModal) {
    elements.licenseCheckModal.addEventListener("click", (e) => {
      if (e.target === elements.licenseCheckModal) {
        elements.licenseCheckModal.classList.remove("open");
      }
    });
  }

  if (elements.closeLicensesGuideBtn) {
    elements.closeLicensesGuideBtn.addEventListener("click", () => {
      elements.licensesGuideModal.classList.remove("open");
    });
  }

  if (elements.licensesGuideModal) {
    elements.licensesGuideModal.addEventListener("click", (e) => {
      if (e.target === elements.licensesGuideModal) {
        elements.licensesGuideModal.classList.remove("open");
      }
    });
  }

  if (elements.reloadLocalBtn) {
    elements.reloadLocalBtn.addEventListener("click", () => {
      if (state.activeSource === "local") {
        showToast("Rescanning Local Library...");
        loadCurrentSource({ forceLocalRefresh: true });
      }
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
  elements.searchInput.addEventListener("focus", () => {
    renderSearchSuggestions(elements.searchInput.value);
  });

  elements.searchInput.addEventListener("input", (e) => {
    state.searchQuery = e.target.value;
    renderSearchSuggestions(state.searchQuery);
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      loadCurrentSource();
    }, 250);
  });

  if (elements.licenseSelect) {
    elements.licenseSelect.addEventListener("change", (e) => {
      state.selectedLicense = e.target.value;
      elements.licenseSelect.blur();
      renderActiveFiltersBar();
      loadCurrentSource();
    });
  }

  elements.genreSelect.addEventListener("change", (e) => {
    state.selectedGenre = e.target.value;
    elements.genreSelect.blur();
    renderActiveFiltersBar();
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
    if (e.key === "Escape") {
      hideTrackContextMenu();
      hideSearchSuggestions();
      if (elements.licenseCheckModal && elements.licenseCheckModal.classList.contains("open")) {
        elements.licenseCheckModal.classList.remove("open");
        return;
      }
      if (elements.licensesGuideModal && elements.licensesGuideModal.classList.contains("open")) {
        elements.licensesGuideModal.classList.remove("open");
        return;
      }
      if (elements.settingsModal && elements.settingsModal.classList.contains("open")) {
        elements.settingsModal.classList.remove("open");
        return;
      }
    }
    if ((elements.settingsModal && elements.settingsModal.classList.contains("open")) ||
        (elements.licenseCheckModal && elements.licenseCheckModal.classList.contains("open")) ||
        (elements.licensesGuideModal && elements.licensesGuideModal.classList.contains("open"))) {
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
    if (elements.inputDownloadsPath) {
      elements.inputDownloadsPath.value = window.LocalLibraryProvider.getDownloadsPath();
    }
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
    if (elements.inputDownloadsPath) {
      window.LocalLibraryProvider.setDownloadsPath(elements.inputDownloadsPath.value);
    }
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

  // Initial Boot (Local Library is NOT scanned until user explicitly clicks its tab)
  updateMainPlayPauseIcon(false);
  updateNowPlayingFavoriteUI();
  updateTrimToolbarUI();
  renderTabs();
  updateFilterBar();
  renderJamendoHelper();
  populateLicenses();
  populateGenres();
  renderActiveFiltersBar();
  setTimeout(() => {
    loadCurrentSource();
  }, 200);
})();
