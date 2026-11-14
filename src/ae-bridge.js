/**
 * Client bridge for communicating with After Effects ExtendScript
 */
(function (global) {
  "use strict";

  const ERROR_PREFIX = "__FRM_HOST_ERROR__";

  function getCep() {
    return (typeof window !== "undefined" && window.__adobe_cep__) || null;
  }

  function getExtensionDir() {
    if (typeof window !== "undefined" && window.__adobe_cep__) {
      try {
        let value = window.__adobe_cep__.getSystemPath("extension");
        value = decodeURI(value).replace(/^file:\/\/\/?/i, "");
        if (/^\/[a-z]:/i.test(value)) value = value.slice(1);
        return value.replace(/\//g, "/");
      } catch (_) {}
    }
    return null;
  }

  function wrap(body) {
    return `(function(){try{${body}}catch(e){return ${JSON.stringify(ERROR_PREFIX)}+encodeURIComponent(String(e)+(e.line?' (line '+e.line+')':''));}}())`;
  }

  function evalScript(expression) {
    return new Promise((resolve, reject) => {
      const cep = getCep();
      if (!cep) {
        // Fallback for browser mock mode
        return resolve({
          ok: true,
          mock: true,
          hasProject: true,
          isSaved: true,
          projectPath: "P:/IA/RRSS/MockProject.aep",
          projectDir: "P:/IA/RRSS",
          activeComp: "Main Comp"
        });
      }

      const extDir = getExtensionDir();
      const jsxPath = extDir ? `${extDir}/host/index.jsx` : "";

      // Ensure index.jsx v2 is hot-reloaded if outdated or undefined
      const guardedScript = wrap(`
        if (typeof FreeRoyaltiesMusicHost === 'undefined' || FreeRoyaltiesMusicHost.version !== 2) {
          if (${JSON.stringify(jsxPath)}) {
            $.evalFile(new File(${JSON.stringify(jsxPath)}));
          }
        }
        return ${expression};
      `);

      cep.evalScript(guardedScript, (rawResult) => {
        if (!rawResult || rawResult === "EvalScript error.") {
          return reject(new Error("After Effects script execution rejected. Verify a project is open and no modal dialog is blocking AE."));
        }
        if (typeof rawResult === "string" && rawResult.indexOf(ERROR_PREFIX) === 0) {
          const errMsg = decodeURIComponent(rawResult.slice(ERROR_PREFIX.length));
          return reject(new Error(errMsg));
        }
        try {
          const parsed = JSON.parse(rawResult);
          resolve(parsed);
        } catch (e) {
          resolve({ ok: true, raw: rawResult });
        }
      });
    });
  }

  global.AEBridge = {
    isAvailable() {
      return Boolean(getCep());
    },

    async getProjectContext() {
      return evalScript("FreeRoyaltiesMusicHost.getProjectContext()");
    },

    async importAudio(filePath, addToActiveComp = false, options = {}) {
      const escapedPath = JSON.stringify(String(filePath).replace(/\\/g, "/"));
      const trimIn = typeof options.trimIn === "number" ? options.trimIn : null;
      const trimOut = typeof options.trimOut === "number" ? options.trimOut : null;
      const trimmedOnDisk = Boolean(options.trimmedOnDisk);
      const script = `FreeRoyaltiesMusicHost.importAudio(${escapedPath}, ${Boolean(addToActiveComp)}, ${JSON.stringify(trimIn)}, ${JSON.stringify(trimOut)}, ${trimmedOnDisk})`;
      return evalScript(script);
    }
  };
})(window);
