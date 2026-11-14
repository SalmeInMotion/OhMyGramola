/**
 * OhMyGramola — ExtendScript Host Bridge
 * Targets: Adobe After Effects CC 2020 - 2026+ (AEFT 17.0 - 99.9)
 * ECMAScript 3 (ES3) compliant with bundled Crockford JSON shim.
 */

// 1. ES3 JSON compatibility shim for ExtendScript
if (typeof JSON === "undefined" || !JSON || typeof JSON.stringify !== "function" || typeof JSON.parse !== "function") {
    (function () {
        var escMap = {
            "\\": "\\\\",
            "\"": "\\\"",
            "\b": "\\b",
            "\f": "\\f",
            "\n": "\\n",
            "\r": "\\r",
            "\t": "\\t"
        };

        function escString(s) {
            var out = "\"";
            var i;
            for (i = 0; i < s.length; i++) {
                var ch = s.charAt(i);
                var code = s.charCodeAt(i);
                var esc = escMap[ch];
                if (typeof esc === "string") out += esc;
                else if (code < 0x20 || code === 0x7f) {
                    var hex = code.toString(16);
                    while (hex.length < 4) hex = "0" + hex;
                    out += "\\u" + hex;
                } else out += ch;
            }
            return out + "\"";
        }

        function stringify(value) {
            if (value === null || value === undefined) return "null";
            var type = typeof value;
            if (type === "number") return isFinite(value) ? String(value) : "null";
            if (type === "boolean") return value ? "true" : "false";
            if (type === "string") return escString(value);
            if (type === "object") {
                var i;
                if (value instanceof Array || (typeof value.length === "number" && value.hasOwnProperty && value.hasOwnProperty("length"))) {
                    var parts = [];
                    for (i = 0; i < value.length; i++) parts.push(stringify(value[i]));
                    return "[" + parts.join(",") + "]";
                }
                var keyParts = [];
                var key;
                for (key in value) {
                    if (!value.hasOwnProperty(key)) continue;
                    var child = value[key];
                    if (typeof child === "function" || typeof child === "undefined") continue;
                    keyParts.push(escString(key) + ":" + stringify(child));
                }
                return "{" + keyParts.join(",") + "}";
            }
            return "null";
        }

        function parse(text) {
            var value = String(text);
            value = value.replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
            var probe = value
                .replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g, "@")
                .replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g, "]")
                .replace(/(?:^|:|,)(?:\s*\[)+/g, "");
            if (!/^[\],:{}\s]*$/.test(probe)) throw new Error("JSON.parse: input is not valid JSON");
            return eval("(" + value + ")");
        }

        JSON = { stringify: stringify, parse: parse };
    })();
}

// 2. FreeRoyaltiesMusicHost API
var FreeRoyaltiesMusicHost = (function () {
    function formatSecTag(seconds) {
        var total = Math.max(0, Math.round(Number(seconds) || 0));
        var mins = Math.floor(total / 60);
        var secs = total % 60;
        return mins + "m" + (secs < 10 ? "0" : "") + secs + "s";
    }

    function stripExtension(name) {
        return String(name || "Audio").replace(/\.[^.\/\\]+$/, "");
    }

    function findOrCreateProjectFolder(folderName) {
        var i, item;
        for (i = 1; i <= app.project.numItems; i++) {
            item = app.project.item(i);
            if ((item instanceof FolderItem) && item.parentFolder === app.project.rootFolder && item.name === folderName) {
                return item;
            }
        }
        return app.project.items.addFolder(folderName);
    }

    function findExistingAudioFootage(targetFsName) {
        var normTarget = String(targetFsName || "").toLowerCase();
        var i, item;
        for (i = 1; i <= app.project.numItems; i++) {
            item = app.project.item(i);
            if ((item instanceof FootageItem) && item.mainSource && item.mainSource.file) {
                if (String(item.mainSource.file.fsName).toLowerCase() === normTarget) {
                    return item;
                }
            }
        }
        return null;
    }

    return {
        version: 3,

        getProjectContext: function () {
            try {
                if (!app.project) {
                    return JSON.stringify({
                        ok: true,
                        hasProject: false,
                        isSaved: false,
                        projectPath: null,
                        projectDir: null,
                        activeComp: null
                    });
                }

                var isSaved = (app.project.file !== null);
                var projectPath = isSaved ? app.project.file.fsName : null;
                var projectDir = isSaved ? app.project.file.parent.fsName : null;
                var activeCompName = null;

                if (app.project.activeItem && (app.project.activeItem instanceof CompItem)) {
                    activeCompName = app.project.activeItem.name;
                }

                return JSON.stringify({
                    ok: true,
                    hasProject: true,
                    isSaved: isSaved,
                    projectPath: projectPath,
                    projectDir: projectDir,
                    activeComp: activeCompName
                });
            } catch (e) {
                return JSON.stringify({
                    ok: false,
                    error: String(e) + (e.line ? " (line " + e.line + ")" : "")
                });
            }
        },

        importAudio: function (filePath, addToActiveComp, trimIn, trimOut) {
            try {
                if (!app.project) {
                    return JSON.stringify({ ok: false, error: "No open After Effects project." });
                }

                var cleanPath = String(filePath).replace(/\\/g, "/");
                var audioFile = new File(cleanPath);
                if (!audioFile.exists) {
                    return JSON.stringify({ ok: false, error: "File not found on disk: " + cleanPath });
                }

                app.beginUndoGroup("OhMyGramola: Import Audio");

                var musicBin = findOrCreateProjectFolder("OhMyGramola Music");

                // Reuse master footage item if already imported in this .aep so multiple trims share 1 master file
                var footageItem = findExistingAudioFootage(audioFile.fsName);
                if (!footageItem) {
                    var importOptions = new ImportOptions(audioFile);
                    if (!importOptions.canImportAs(ImportAsType.FOOTAGE)) {
                        app.endUndoGroup();
                        return JSON.stringify({ ok: false, error: "File cannot be imported as footage: " + cleanPath });
                    }
                    importOptions.importAs = ImportAsType.FOOTAGE;
                    footageItem = app.project.importFile(importOptions);
                    footageItem.parentFolder = musicBin;
                }

                var activeComp = (app.project.activeItem && (app.project.activeItem instanceof CompItem))
                    ? app.project.activeItem
                    : null;

                var hasTrim = typeof trimIn === "number" &&
                    typeof trimOut === "number" &&
                    isFinite(trimIn) &&
                    isFinite(trimOut) &&
                    trimOut > trimIn + 0.05;

                var layerCreated = false;
                var precompCreated = false;
                var compName = null;

                if (hasTrim) {
                    // Clamp trim bounds to actual footage duration if known
                    var footDur = (footageItem.duration && footageItem.duration > 0) ? footageItem.duration : trimOut;
                    var safeIn = Math.max(0, Math.min(trimIn, Math.max(0, footDur - 0.05)));
                    var safeOut = Math.min(footDur, Math.max(safeIn + 0.05, trimOut));
                    var trimDur = Math.max(0.1, safeOut - safeIn);

                    // Match active composition specs when available, otherwise sensible HD defaults
                    var compW = activeComp ? activeComp.width : 1920;
                    var compH = activeComp ? activeComp.height : 1080;
                    var compPar = activeComp ? activeComp.pixelAspect : 1.0;
                    var compFps = activeComp ? activeComp.frameRate : 30;

                    var baseTitle = stripExtension(footageItem.name);
                    compName = baseTitle + " [Trim " + formatSecTag(safeIn) + "-" + formatSecTag(safeOut) + "]";
                    if (compName.length > 90) {
                        compName = baseTitle.substring(0, 58) + " [Trim " + formatSecTag(safeIn) + "-" + formatSecTag(safeOut) + "]";
                    }

                    // Create dedicated audio composition containing the FULL untrimmed audio shifted to safeIn
                    var trimComp = app.project.items.addComp(compName, compW, compH, compPar, trimDur, compFps);
                    trimComp.parentFolder = musicBin;

                    var innerLayer = trimComp.layers.add(footageItem);
                    innerLayer.startTime = -safeIn;
                    innerLayer.inPoint = 0;
                    innerLayer.outPoint = trimDur;
                    precompCreated = true;

                    if (addToActiveComp && activeComp) {
                        var outerLayer = activeComp.layers.add(trimComp);
                        outerLayer.startTime = activeComp.time || 0;
                        layerCreated = true;
                    } else {
                        // If no active composition was open, open the newly created trim comp in the viewer
                        try { trimComp.openInViewer(); } catch (_) {}
                    }
                } else {
                    if (addToActiveComp && activeComp) {
                        var directLayer = activeComp.layers.add(footageItem);
                        directLayer.startTime = activeComp.time || 0;
                        layerCreated = true;
                    }
                }

                app.endUndoGroup();

                return JSON.stringify({
                    ok: true,
                    imported: true,
                    name: footageItem.name,
                    itemId: footageItem.id,
                    precompCreated: precompCreated,
                    compName: compName,
                    layerCreated: layerCreated
                });
            } catch (e) {
                try { app.endUndoGroup(); } catch (_) {}
                return JSON.stringify({
                    ok: false,
                    error: String(e) + (e.line ? " (line " + e.line + ")" : "")
                });
            }
        }
    };
})();
