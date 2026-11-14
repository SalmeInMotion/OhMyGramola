/**
 * Free Royalties Music — ExtendScript Host Bridge
 * Targets: Adobe After Effects CC 2022+ (AEFT)
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
    return {
        version: 2,
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

        importAudio: function (filePath, addToActiveComp, trimIn, trimOut, alreadyTrimmedOnDisk) {
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

                var importOptions = new ImportOptions(audioFile);
                if (!importOptions.canImportAs(ImportAsType.FOOTAGE)) {
                    app.endUndoGroup();
                    return JSON.stringify({ ok: false, error: "File cannot be imported as footage: " + cleanPath });
                }

                importOptions.importAs = ImportAsType.FOOTAGE;
                var footageItem = app.project.importFile(importOptions);

                var layerCreated = false;
                if (addToActiveComp && app.project.activeItem && (app.project.activeItem instanceof CompItem)) {
                    var comp = app.project.activeItem;
                    var layer = comp.layers.add(footageItem);
                    var cti = comp.time || 0;

                    var hasLayerTrim = (!alreadyTrimmedOnDisk) &&
                        typeof trimIn === "number" &&
                        typeof trimOut === "number" &&
                        isFinite(trimIn) &&
                        isFinite(trimOut) &&
                        trimOut > trimIn + 0.05;

                    if (hasLayerTrim) {
                        var dur = trimOut - trimIn;
                        layer.startTime = cti - trimIn;
                        layer.inPoint = cti;
                        layer.outPoint = cti + dur;
                    } else {
                        layer.startTime = cti;
                    }
                    layerCreated = true;
                }

                app.endUndoGroup();

                return JSON.stringify({
                    ok: true,
                    imported: true,
                    name: footageItem.name,
                    itemId: footageItem.id,
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
