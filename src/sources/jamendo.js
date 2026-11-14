/**
 * OhMyGramola — Jamendo Source Provider
 * Uses Jamendo API v3 via the standalone Local Broker.
 * Automatically excludes tracks with NoDerivatives (-ND) or NonCommercial (-NC) clauses.
 */
(function (global) {
  "use strict";

  const DEV_PORTAL_URL = "https://devportal.jamendo.com/signup";
  let runtimeFallbackId = null;

  function loadRuntimeFallbackId() {
    if (runtimeFallbackId !== null) return runtimeFallbackId;
    runtimeFallbackId = "";
    try {
      const req = (typeof window !== "undefined" && window.cep_node && typeof window.cep_node.require === "function")
        ? window.cep_node.require
        : (typeof require === "function" ? require : null);
      if (req && typeof window !== "undefined" && window.__adobe_cep__) {
        const fs = req("fs");
        const path = req("path");
        let extDir = decodeURI(window.__adobe_cep__.getSystemPath("extension")).replace(/^file:\/\/\/?/i, "");
        if (/^\/[a-z]:/i.test(extDir)) extDir = extDir.slice(1);
        extDir = extDir.replace(/\//g, "\\");
        const cfgPath = path.join(extDir, "runtime-config.json");
        if (fs.existsSync(cfgPath)) {
          const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8").replace(/^\uFEFF/, ""));
          if (cfg.defaultJamendoClientId && String(cfg.defaultJamendoClientId).trim()) {
            runtimeFallbackId = String(cfg.defaultJamendoClientId).trim();
          }
        }
      }
    } catch (_) {}
    return runtimeFallbackId;
  }

  function getClientId() {
    try {
      const stored = localStorage.getItem("jamendo_client_id");
      if (stored !== null) {
        return stored.trim();
      }
    } catch (_) {}
    return loadRuntimeFallbackId();
  }

  global.JamendoProvider = {
    DEV_PORTAL_URL,
    getClientId,
    hasClientId() {
      return Boolean(getClientId());
    },
    setClientId(id) {
      try {
        localStorage.setItem("jamendo_client_id", String(id || "").trim());
      } catch (_) {}
    },

    async search({ query = "", tags = "", limit = 30 } = {}) {
      const clientId = getClientId();
      if (!clientId) {
        return [];
      }

      // Use the standalone BrokerClient to bypass AfterFX.exe firewall blocks
      if (global.BrokerClient) {
        const results = await global.BrokerClient.queryJamendo({
          search: query,
          tags: tags,
          clientId: clientId
        });
        return results.slice(0, limit);
      }

      throw new Error("Local bridge is initializing. Please wait a moment and retry.");
    }
  };
})(window);
