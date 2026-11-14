/**
 * Free Royalties Music — Broker Client
 * Spawns and communicates with the standalone local Node.js broker.
 */
(function (global) {
  "use strict";

  let brokerProcess = null;
  let brokerPort = null;
  let initPromise = null;

  function getNodeModule(name) {
    if (typeof window !== "undefined") {
      if (window.cep_node && typeof window.cep_node.require === "function") {
        try { return window.cep_node.require(name); } catch (_) {}
      }
      if (typeof require === "function") {
        try { return require(name); } catch (_) {}
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

  function startBroker() {
    if (initPromise) return initPromise;

    initPromise = new Promise((resolve) => {
      const childProcess = getNodeModule("child_process");
      const path = getNodeModule("path");
      const fs = getNodeModule("fs");
      const nodeProcess = getNodeModule("process");
      const root = getExtensionDir();

      if (!childProcess || !path || !root || !fs) {
        console.warn("Node.js child_process or extension directory not available; broker disabled.");
        return resolve(false);
      }

      // 1. Resolve node.exe binary path
      let nodePath = "C:\\Program Files\\nodejs\\node.exe";
      const configPath = path.join(root, "runtime-config.json");
      if (fs.existsSync(configPath)) {
        try {
          const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8").replace(/^\uFEFF/, ""));
          if (cfg.nodePath && fs.existsSync(cfg.nodePath)) {
            nodePath = cfg.nodePath;
          }
        } catch (_) {}
      }

      // Fallback check
      if (!fs.existsSync(nodePath)) {
        nodePath = "node.exe";
      }

      const brokerScript = path.join(root, "src", "server", "broker.mjs");
      if (!fs.existsSync(brokerScript)) {
        console.error("Broker script not found on disk at:", brokerScript);
        return resolve(false);
      }

      try {
        const parentEnv = nodeProcess ? nodeProcess.env : {};

        brokerProcess = childProcess.spawn(nodePath, [brokerScript], {
          cwd: root,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
          env: Object.assign({}, parentEnv, {
            PATH: parentEnv.PATH || parentEnv.Path || "C:\\Program Files\\nodejs;C:\\Windows\\system32"
          })
        });

        let output = "";
        const timer = setTimeout(() => {
          if (!brokerPort) {
            console.warn("Broker handshake timeout after 8 seconds.");
            resolve(false);
          }
        }, 8000);

        brokerProcess.stdout.on("data", (chunk) => {
          output += String(chunk);
          const newlineIndex = output.indexOf("\n");
          if (newlineIndex >= 0) {
            clearTimeout(timer);
            try {
              const data = JSON.parse(output.slice(0, newlineIndex).trim());
              if (data.ok && data.port) {
                brokerPort = data.port;
                console.log(`[BrokerClient] Connected to local broker on port ${brokerPort}`);
                return resolve(true);
              }
            } catch (e) {
              console.error("Broker handshake JSON parse error:", e);
            }
          }
        });

        brokerProcess.stderr.on("data", (err) => {
          console.warn("[Broker stderr]:", String(err));
        });

        brokerProcess.on("exit", () => {
          brokerProcess = null;
          brokerPort = null;
          initPromise = null;
        });

        window.addEventListener("beforeunload", () => {
          if (brokerProcess) {
            try { brokerProcess.kill(); } catch (_) {}
            brokerProcess = null;
          }
        });
      } catch (err) {
        console.error("Failed to spawn local broker process:", err);
        resolve(false);
      }
    });

    return initPromise;
  }

  global.BrokerClient = {
    async init() {
      return startBroker();
    },

    isReady() {
      return Boolean(brokerPort);
    },

    getPort() {
      return brokerPort;
    },

    getStreamUrl(url, trackId, durationSec = 0) {
      if (!brokerPort || !url) return url;
      const durParam = durationSec > 0 ? `&dur=${encodeURIComponent(String(durationSec))}` : "";
      return `http://127.0.0.1:${brokerPort}/api/stream?url=${encodeURIComponent(url)}&id=${encodeURIComponent(trackId || "track")}${durParam}`;
    },

    async getWaveform({ trackId, url = "", durationSec = 0 } = {}) {
      await startBroker();
      if (!brokerPort || !trackId) return null;
      try {
        const params = new URLSearchParams({
          id: trackId,
          url: url || "",
          dur: durationSec > 0 ? String(durationSec) : "0"
        });
        const res = await fetch(`http://127.0.0.1:${brokerPort}/api/waveform?${params.toString()}`);
        if (!res.ok) return null;
        return await res.json();
      } catch (_) {
        return null;
      }
    },

    async queryJamendo({ search = "", tags = "", clientId = "" } = {}) {
      if (!clientId) {
        return [];
      }
      const ready = await startBroker();
      if (!ready || !brokerPort) {
        throw new Error("Local bridge failed to start. Verify Node.js is installed at C:\\Program Files\\nodejs\\node.exe.");
      }
      const params = new URLSearchParams({
        client_id: clientId,
        search: search,
        tags: tags
      });
      const res = await fetch(`http://127.0.0.1:${brokerPort}/api/jamendo?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Broker Jamendo HTTP ${res.status}`);
      }
      const data = await res.json();
      if (!data.ok) {
        throw new Error(data.error || "Jamendo query failed");
      }
      return data.results || [];
    },

    async importTrack({ track, targetDir, trimIn = null, trimOut = null }) {
      const ready = await startBroker();
      if (!ready || !brokerPort) {
        throw new Error("Local bridge failed to start. Verify Node.js is installed at C:\\Program Files\\nodejs\\node.exe.");
      }
      const res = await fetch(`http://127.0.0.1:${brokerPort}/api/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track, targetDir, trimIn, trimOut })
      });
      if (!res.ok) {
        throw new Error(`Broker import HTTP ${res.status}`);
      }
      const data = await res.json();
      if (!data.ok) {
        throw new Error(data.error || "Import failed");
      }
      return data;
    },

    async copyToClipboard(text) {
      await startBroker();
      if (!brokerPort) return false;
      try {
        const res = await fetch(`http://127.0.0.1:${brokerPort}/api/clipboard`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text })
        });
        const data = await res.json();
        return Boolean(data.ok);
      } catch (_) {
        return false;
      }
    },

    async openExternal(target) {
      if (!target) return false;

      // 1. CEP openURLInDefaultBrowser (works for web links and file URLs)
      if (typeof window !== "undefined" && window.cep && window.cep.util && typeof window.cep.util.openURLInDefaultBrowser === "function") {
        try {
          window.cep.util.openURLInDefaultBrowser(target);
          return true;
        } catch (_) {}
      }

      // 2. Direct Node child_process if in CEP
      try {
        const cp = getNodeModule("child_process");
        if (cp) {
          cp.spawn("cmd.exe", ["/c", "start", "", target], { windowsHide: true });
          return true;
        }
      } catch (_) {}

      // 3. Companion Broker endpoint
      await startBroker();
      if (brokerPort) {
        try {
          const res = await fetch(`http://127.0.0.1:${brokerPort}/api/open`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target })
          });
          const data = await res.json();
          return Boolean(data.ok);
        } catch (_) {}
      }

      return false;
    }
  };

  // Pre-warm broker on load
  startBroker();
})(window);
