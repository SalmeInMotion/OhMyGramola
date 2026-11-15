import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import vm from "vm";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const brokerScript = path.resolve(__dirname, "../src/server/broker.mjs");
const favoritesScript = path.resolve(__dirname, "../src/favorites.js");
const requireFromTest = createRequire(import.meta.url);

function resolveJamendoClientId() {
  if (process.env.JAMENDO_CLIENT_ID) return process.env.JAMENDO_CLIENT_ID.trim();
  const appData = process.env.APPDATA || "";
  if (appData) {
    const deployedCfg = path.join(appData, "Adobe", "CEP", "extensions", "com.salmeinmotion.free-royalties-music", "runtime-config.json");
    if (fs.existsSync(deployedCfg)) {
      try {
        const cfg = JSON.parse(fs.readFileSync(deployedCfg, "utf-8").replace(/^\uFEFF/, ""));
        if (cfg.defaultJamendoClientId) return String(cfg.defaultJamendoClientId).trim();
      } catch (_) {}
    }
  }
  return "";
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("=== Testing OhMyGramola End-to-End Broker & Modules ===");

const child = spawn("node", [brokerScript], {
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"]
});

let port = null;
let started = false;

const fail = (msg, extra) => {
  console.error("✗ " + msg, extra !== undefined ? extra : "");
  try { child.kill(); } catch (_) {}
  process.exit(1);
};

const runTests = async () => {
  try {
    console.log(`✓ Broker active on port ${port}`);

    // Test 1: Jamendo Query, webUrl, and instant waveform peaks
    const testClientId = resolveJamendoClientId();
    if (testClientId) {
      console.log("Testing Jamendo API query & waveform peaks through broker...");
      const jamRes = await fetch(`http://127.0.0.1:${port}/api/jamendo?client_id=${encodeURIComponent(testClientId)}&limit=3`);
      const jamData = await jamRes.json();
      if (jamData.ok && jamData.results.length > 0) {
        const sample = jamData.results[0];
        console.log(`✓ Jamendo query succeeded: returned ${jamData.results.length} safe tracks (e.g. "${sample.title}")`);
        if (!sample.webUrl) {
          fail("Jamendo track missing webUrl!");
        }
        if (!Array.isArray(sample.peaks) || sample.peaks.length !== 240) {
          fail(`Jamendo track peaks invalid (expected 240 buckets, got ${sample.peaks ? sample.peaks.length : "none"})`);
        }
        console.log(`✓ Jamendo track webUrl & 240-bucket peaks verified: ${sample.webUrl}`);
      } else {
        fail("Jamendo query failed:", jamData);
      }
    } else {
      console.log("ℹ Skipping live Jamendo query check (no local JAMENDO_CLIENT_ID configured); testing missing-key validation...");
      const jamMissing = await fetch(`http://127.0.0.1:${port}/api/jamendo`);
      if (jamMissing.status === 400) {
        console.log("✓ Missing Jamendo Client ID validation verified (400).");
      } else {
        fail("Expected 400 when client_id is omitted");
      }
    }

    // Test 2: Incompetech Audio Stream & Cache
    console.log("Testing Incompetech stream through broker...");
    const sampleUrl = "https://incompetech.com/music/royalty-free/mp3-royaltyfree/The%20Britons.mp3";
    const streamRes = await fetch(`http://127.0.0.1:${port}/api/stream?url=${encodeURIComponent(sampleUrl)}&id=test-britons&dur=150`, {
      headers: { Range: "bytes=0-100" }
    });

    if (streamRes.status === 206 && streamRes.headers.get("content-type") === "audio/mpeg") {
      console.log("✓ Incompetech streaming proxy succeeded with audio/mpeg & Range support!");
    } else {
      fail("Streaming test failed, status:", streamRes.status);
    }

    // Test 3: Local file streaming with spaces & file:/// URI
    console.log("Testing Local Library file streaming with spaces & URL encoding...");
    const localTarget = "P:\\IA\\RRSS\\Music\\Dentaneosuchus Hunt.mp3";
    const localStreamRes = await fetch(`http://127.0.0.1:${port}/api/stream?url=${encodeURIComponent(localTarget)}&id=local-test`, {
      headers: { Range: "bytes=0-200" }
    });

    if (localStreamRes.status === 206 && localStreamRes.headers.get("content-type") === "audio/mpeg") {
      console.log("✓ Local file streaming succeeded for P:\\IA\\RRSS\\Music\\Dentaneosuchus Hunt.mp3 with 206 Partial Content!");
    } else {
      fail("Local streaming test failed, status:", localStreamRes.status);
    }

    // Test 4: Local file streaming with encoded file:/// URI
    const encodedFileUri = "file:///P:/IA/RRSS/Music/Capricerie%20No.%205%20(Bach,%20Paganini).mp3";
    const fileUriRes = await fetch(`http://127.0.0.1:${port}/api/stream?url=${encodeURIComponent(encodedFileUri)}&id=local-uri-test`, {
      headers: { Range: "bytes=0-100" }
    });
    if (fileUriRes.status === 206 && fileUriRes.headers.get("content-type") === "audio/mpeg") {
      console.log("✓ Local file streaming succeeded for encoded file:/// URI with spaces and parenthesis!");
    } else {
      fail("Encoded file:/// streaming failed, status:", fileUriRes.status);
    }

    // Test 5: /api/waveform progressive/cached extraction on local MP3
    console.log("Testing /api/waveform FFmpeg envelope extraction...");
    const wfId = `e2e-wf-${Date.now()}`;
    let wfData = null;
    for (let attempt = 0; attempt < 15; attempt++) {
      const wfRes = await fetch(`http://127.0.0.1:${port}/api/waveform?id=${encodeURIComponent(wfId)}&url=${encodeURIComponent(localTarget)}&dur=180`);
      wfData = await wfRes.json();
      if (wfData && wfData.complete) break;
      await sleep(120);
    }
    if (!wfData || !wfData.ok || !wfData.complete || !Array.isArray(wfData.peaks) || wfData.peaks.length !== 240) {
      fail("Waveform extraction did not complete with 240 peaks:", wfData);
    }
    const maxPeak = Math.max(...wfData.peaks);
    if (!(maxPeak > 0.5)) {
      fail("Waveform peaks have unexpectedly zero/low amplitude:", maxPeak);
    }
    console.log(`✓ /api/waveform extracted 240 normalized envelope peaks (max=${maxPeak}).`);

    // Cleanup temporary peaks cache created by test
    const peaksCacheFile = path.join(os.tmpdir(), "free-royalties-music-preview-cache", `${wfId}.peaks.json`);
    try { if (fs.existsSync(peaksCacheFile)) fs.unlinkSync(peaksCacheFile); } catch (_) {}

    // Test 6: /api/import preserves full untrimmed master file AND ExtendScript v3 builds non-destructive pre-comp
    console.log("Testing /api/import master preservation & ExtendScript v3 pre-comp trim logic...");
    const tempImportDir = fs.mkdtempSync(path.join(os.tmpdir(), "ohmygramola-trim-e2e-"));
    try {
      const trimRes = await fetch(`http://127.0.0.1:${port}/api/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          track: {
            id: "local-dentaneosuchus",
            title: "Dentaneosuchus Hunt",
            localPath: localTarget,
            attribution: ""
          },
          targetDir: tempImportDir,
          trimIn: 10.0,
          trimOut: 25.0
        })
      });
      const trimData = await trimRes.json();
      if (!trimData.ok || trimData.trimmedOnDisk !== false || trimData.path !== localTarget) {
        fail("/api/import did not return full untrimmed master audio path:", trimData);
      }

      // Execute host/index.jsx inside an ES3-compatible mock After Effects DOM to verify pre-comp creation & layer offsets
      const hostJsxPath = path.resolve(__dirname, "../host/index.jsx");
      const hostCode = fs.readFileSync(hostJsxPath, "utf-8");

      function FolderItem(name, parent) { this.name = name; this.parentFolder = parent; }
      function FootageItem(file) {
        this.id = 101;
        this.name = path.basename(file.fsName);
        this.duration = 180.0;
        this.mainSource = { file };
        this.parentFolder = null;
      }
      function CompItem(name, w, h, par, dur, fps) {
        this.name = name;
        this.width = w;
        this.height = h;
        this.pixelAspect = par;
        this.duration = dur;
        this.frameRate = fps;
        this.time = 4.5; // Active comp CTI at 4.5s
        this.parentFolder = null;
        this.addedLayers = [];
        this.layers = {
          add: (srcItem) => {
            const lyr = { source: srcItem, startTime: 0, inPoint: 0, outPoint: srcItem.duration };
            this.addedLayers.push(lyr);
            return lyr;
          }
        };
        this.openInViewer = () => {};
      }

      const rootFolder = { name: "Root" };
      const mainComp = new CompItem("Main Edit", 1920, 1080, 1.0, 60.0, 25);
      const projectItems = [mainComp];

      const aeSandbox = {
        FolderItem,
        FootageItem,
        CompItem,
        ImportAsType: { FOOTAGE: "FOOTAGE" },
        File: function (p) {
          this.fsName = p.replace(/\//g, "\\");
          this.exists = fs.existsSync(this.fsName);
        },
        ImportOptions: function (f) {
          this.file = f;
          this.importAs = null;
          this.canImportAs = () => true;
        },
        app: {
          beginUndoGroup: () => {},
          endUndoGroup: () => {},
          project: {
            file: null,
            rootFolder,
            activeItem: mainComp,
            get numItems() { return projectItems.length; },
            item: (idx) => projectItems[idx - 1],
            importFile: (opts) => {
              const ftg = new FootageItem(opts.file);
              ftg.parentFolder = rootFolder;
              projectItems.push(ftg);
              return ftg;
            },
            items: {
              addFolder: (name) => {
                const fld = new FolderItem(name, rootFolder);
                projectItems.push(fld);
                return fld;
              },
              addComp: (name, w, h, par, dur, fps) => {
                const cmp = new CompItem(name, w, h, par, dur, fps);
                cmp.parentFolder = rootFolder;
                projectItems.push(cmp);
                return cmp;
              }
            }
          }
        }
      };

      vm.runInNewContext(hostCode, aeSandbox);
      const host = aeSandbox.FreeRoyaltiesMusicHost;
      if (!host || host.version !== 3) {
        fail("Expected FreeRoyaltiesMusicHost v3, got:", host && host.version);
      }

      // First trimmed import (10s -> 25s)
      const res1 = JSON.parse(host.importAudio(localTarget, true, 10.0, 25.0));
      if (!res1.ok || !res1.precompCreated || !res1.layerCreated) {
        fail("ExtendScript importAudio failed to create pre-comp & outer layer:", res1);
      }

      const createdComps = projectItems.filter((it) => it instanceof CompItem && it !== mainComp);
      const createdFootages = projectItems.filter((it) => it instanceof FootageItem);
      if (createdComps.length !== 1 || createdFootages.length !== 1) {
        fail("Expected 1 master footage and 1 trim comp:", { comps: createdComps.length, footages: createdFootages.length });
      }

      const trimComp = createdComps[0];
      const innerAudioLayer = trimComp.addedLayers[0];
      const outerPrecompLayer = mainComp.addedLayers[0];

      if (Math.abs(trimComp.duration - 15.0) > 0.001 || Math.abs(innerAudioLayer.startTime - (-10.0)) > 0.001 || Math.abs(innerAudioLayer.outPoint - 15.0) > 0.001) {
        fail("Inner audio layer inside trim comp has wrong timing:", { compDur: trimComp.duration, inner: innerAudioLayer });
      }
      if (outerPrecompLayer.source !== trimComp || Math.abs(outerPrecompLayer.startTime - 4.5) > 0.001) {
        fail("Outer pre-comp layer on active comp was not placed at CTI 4.5s:", outerPrecompLayer);
      }

      // Second trimmed import of same song (30s -> 50s) should REUSE the same master FootageItem!
      const res2 = JSON.parse(host.importAudio(localTarget, true, 30.0, 50.0));
      const footagesAfterSecond = projectItems.filter((it) => it instanceof FootageItem);
      if (!res2.ok || footagesAfterSecond.length !== 1) {
        fail("Second trim of same track duplicated FootageItem instead of reusing master:", footagesAfterSecond.length);
      }

      console.log(`✓ Non-destructive AE pre-comp trim verified: "${res1.compName}" (startTime=-10s, dur=15s, master footage reused)!`);
    } finally {
      try { fs.rmSync(tempImportDir, { recursive: true, force: true }); } catch (_) {}
    }

    // Test 7: FavoritesManager durable persistence & search in disposable temp folder
    console.log("Testing FavoritesManager persistence & search...");
    const tempFavDir = fs.mkdtempSync(path.join(os.tmpdir(), "ohmygramola-fav-e2e-"));
    try {
      const memStorage = new Map();
      const sandboxWindow = {
        cep_node: { require: requireFromTest },
        LocalLibraryProvider: { getLibraryPath: () => tempFavDir },
        localStorage: {
          getItem: (k) => (memStorage.has(k) ? memStorage.get(k) : null),
          setItem: (k, v) => memStorage.set(k, String(v))
        }
      };
      sandboxWindow.window = sandboxWindow;
      const favCode = fs.readFileSync(favoritesScript, "utf-8");
      vm.runInNewContext(favCode, sandboxWindow);

      const fm = sandboxWindow.FavoritesManager;
      const sampleFav = {
        id: "incomp-test-1",
        source: "incompetech",
        title: "Sneaky Snitch",
        artist: "Kevin MacLeod",
        genre: "Comedy",
        bpm: "116",
        duration: "02:16",
        streamUrl: "https://incompetech.com/test.mp3",
        licenseType: "CC BY 4.0"
      };
      const added = fm.toggle(sampleFav);
      if (!added || !fm.isFavorite("incomp-test-1") || fm.count() !== 1) {
        fail("FavoritesManager failed to add track");
      }
      const favDiskPath = path.join(tempFavDir, ".ohmygramola_favorites.json");
      if (!fs.existsSync(favDiskPath)) {
        fail("FavoritesManager did not persist .ohmygramola_favorites.json to disk");
      }
      const matches = await fm.search({ query: "sneaky 116", genre: "Comedy" });
      if (matches.length !== 1) {
        fail("FavoritesManager search failed:", matches);
      }
      const removed = fm.toggle(sampleFav);
      if (removed !== false || fm.count() !== 0) {
        fail("FavoritesManager failed to remove track on second toggle");
      }
      console.log("✓ FavoritesManager toggle, disk persistence, and search verified!");
    } finally {
      try { fs.rmSync(tempFavDir, { recursive: true, force: true }); } catch (_) {}
    }

    // Test 7b: LocalLibraryProvider progressive non-blocking scan on P:\IA\RRSS\Music
    console.log("Testing LocalLibraryProvider progressive scan & counter...");
    const localJsPath = path.resolve(__dirname, "../src/sources/local.js");
    const localSandbox = {
      setTimeout,
      clearTimeout,
      console,
      cep_node: { require: requireFromTest },
      localStorage: { getItem: () => null, setItem: () => {} }
    };
    localSandbox.window = localSandbox;
    vm.runInNewContext(fs.readFileSync(localJsPath, "utf-8"), localSandbox);

    let batchCalls = 0;
    let lastCount = 0;
    let sawIncrementalCount = false;
    const { promise: scanPromise } = localSandbox.LocalLibraryProvider.scanProgressive({
      forceRefresh: true,
      onBatch: ({ newMatches, totalDetected, done }) => {
        batchCalls += 1;
        if (!done && totalDetected > 0 && lastCount > 0 && totalDetected > lastCount) {
          sawIncrementalCount = true;
        }
        lastCount = totalDetected;
      }
    });
    const scannedTracks = await scanPromise;
    if (scannedTracks.length < 300 || batchCalls < 5 || !sawIncrementalCount) {
      fail("Progressive scan did not stream incrementally or missed tracks:", {
        scanned: scannedTracks.length,
        batchCalls,
        sawIncrementalCount
      });
    }
    console.log(`✓ LocalLibraryProvider progressive scan verified: ${scannedTracks.length} tracks in ${batchCalls} non-blocking batches!`);

    // Test 8: Windows Native Clipboard Copy
    console.log("Testing Windows native clipboard copy through broker...");
    const clipRes = await fetch(`http://127.0.0.1:${port}/api/clipboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Test Attribution Line for YouTube" })
    });
    const clipData = await clipRes.json();
    if (clipData.ok) {
      console.log("✓ Windows native clipboard copy succeeded!");
    } else {
      fail("Clipboard test failed:", clipData);
    }

    // Test 9: Open External API endpoint
    console.log("Testing /api/open endpoint...");
    const openRes = await fetch(`http://127.0.0.1:${port}/api/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "" }) // empty target to avoid popping visible window during test
    });
    const openData = await openRes.json();
    if (openData.ok) {
      console.log("✓ /api/open endpoint responsive and working!");
    } else {
      fail("/api/open failed:", openData);
    }

    child.kill();
    console.log("=== All E2E Broker & Module tests PASSED successfully! ===");
  } catch (err) {
    fail("Unhandled error in E2E suite:", err);
  }
};

child.stdout.on("data", (chunk) => {
  const lines = String(chunk).trim().split(/\r?\n/);
  for (const line of lines) {
    try {
      const data = JSON.parse(line);
      if (data.ok && data.port && !started) {
        started = true;
        port = data.port;
        runTests();
      }
    } catch (_) {}
  }
});

child.stderr.on("data", (e) => {
  console.error("Broker stderr:", String(e));
});
