/**
 * OhMyGramola — Local Companion Broker (v1.2.1)
 * Runs as a standalone node.exe process outside AfterFX.exe to bypass Adobe outbound firewall blocks.
 * Provides live HTTP Range streaming, progressive waveform extraction, Jamendo API proxy, and master audio downloads.
 */
import http from "http";
import https from "https";
import fs from "fs";
import path from "path";
import os from "os";
import { spawn, spawnSync } from "child_process";

const CACHE_DIR = path.join(os.tmpdir(), "free-royalties-music-preview-cache");
if (!fs.existsSync(CACHE_DIR)) {
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch (_) {}
}

const WAVEFORM_BUCKETS = 240;
const PCM_SAMPLE_RATE = 400; // 400 Hz mono s16le -> 800 bytes/sec
const SLICE_SAMPLES = 100;   // 0.25s per raw amplitude slice

let cachedFfmpegPath = undefined;

function resolveFfmpegPath() {
  if (cachedFfmpegPath !== undefined) return cachedFfmpegPath;

  // 1. Check runtime-config.json in extension cwd
  try {
    const cfgFile = path.join(process.cwd(), "runtime-config.json");
    if (fs.existsSync(cfgFile)) {
      const cfg = JSON.parse(fs.readFileSync(cfgFile, "utf-8").replace(/^\uFEFF/, ""));
      if (cfg.ffmpegPath && fs.existsSync(cfg.ffmpegPath)) {
        cachedFfmpegPath = cfg.ffmpegPath;
        return cachedFfmpegPath;
      }
    }
  } catch (_) {}

  // 2. Check PATH via where.exe
  try {
    const w = spawnSync("where.exe", ["ffmpeg"], { windowsHide: true });
    if (w.status === 0 && w.stdout) {
      const first = String(w.stdout).split(/\r?\n/)[0].trim();
      if (first && fs.existsSync(first)) {
        cachedFfmpegPath = first;
        return cachedFfmpegPath;
      }
    }
  } catch (_) {}

  // 3. Check common Windows locations
  const candidates = [
    "C:\\Program Files\\ffmpeg-8.0.1-full_build\\bin\\ffmpeg.exe",
    "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
    "C:\\ffmpeg\\bin\\ffmpeg.exe"
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      cachedFfmpegPath = c;
      return cachedFfmpegPath;
    }
  }

  cachedFfmpegPath = null;
  return null;
}

function normalizePeaksArray(rawArr, targetCount = WAVEFORM_BUCKETS) {
  if (!Array.isArray(rawArr) || rawArr.length === 0) return [];
  const out = new Array(targetCount).fill(0);
  const len = rawArr.length;
  let globalMax = 0.001;

  for (let i = 0; i < targetCount; i++) {
    const start = Math.floor((i * len) / targetCount);
    const end = Math.max(start + 1, Math.floor(((i + 1) * len) / targetCount));
    let peak = 0;
    for (let j = start; j < end && j < len; j++) {
      const v = Math.abs(Number(rawArr[j]) || 0);
      if (v > peak) peak = v;
    }
    out[i] = peak;
    if (peak > globalMax) globalMax = peak;
  }

  for (let i = 0; i < targetCount; i++) {
    // Gentle gamma (0.85) for clean DAW-like envelope dynamics
    out[i] = Math.round(Math.pow(out[i] / globalMax, 0.85) * 1000) / 1000;
  }
  return out;
}

const waveformStore = new Map();

function getPeaksCacheFile(safeBase) {
  return path.join(CACHE_DIR, `${safeBase}.peaks.json`);
}

function loadCachedPeaksFromDisk(safeBase) {
  const f = getPeaksCacheFile(safeBase);
  if (fs.existsSync(f)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(f, "utf-8"));
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    } catch (_) {}
  }
  return null;
}

function savePeaksToDisk(safeBase, peaks) {
  try {
    fs.writeFileSync(getPeaksCacheFile(safeBase), JSON.stringify(peaks), "utf-8");
  } catch (_) {}
}

function buildPartialBucketsFromSlices(rawSlices, estimatedDurSec) {
  const totalExpectedSlices = estimatedDurSec > 2
    ? Math.max(rawSlices.length, Math.ceil(estimatedDurSec * (PCM_SAMPLE_RATE / SLICE_SAMPLES)))
    : Math.max(rawSlices.length, WAVEFORM_BUCKETS);

  const buckets = new Array(WAVEFORM_BUCKETS).fill(0);
  let globalMax = 0.02;

  for (let s = 0; s < rawSlices.length; s++) {
    const v = rawSlices[s];
    if (v > globalMax) globalMax = v;
    const bIdx = Math.min(WAVEFORM_BUCKETS - 1, Math.floor((s / totalExpectedSlices) * WAVEFORM_BUCKETS));
    if (v > buckets[bIdx]) buckets[bIdx] = v;
  }

  const filledBuckets = Math.min(WAVEFORM_BUCKETS, Math.ceil((rawSlices.length / totalExpectedSlices) * WAVEFORM_BUCKETS));
  for (let i = 0; i < filledBuckets; i++) {
    buckets[i] = Math.round(Math.pow(buckets[i] / globalMax, 0.85) * 1000) / 1000;
  }

  return {
    peaks: buckets,
    progress: Math.min(0.99, filledBuckets / WAVEFORM_BUCKETS)
  };
}

function createFfmpegPeakExtractor(safeBase, estimatedDurSec, inputArgs) {
  const ff = resolveFfmpegPath();
  if (!ff) return null;

  const existing = waveformStore.get(safeBase);
  if (existing && (existing.complete || existing.active)) {
    return null;
  }

  const entry = {
    active: true,
    complete: false,
    progress: 0,
    peaks: new Array(WAVEFORM_BUCKETS).fill(0),
    rawSlices: []
  };
  waveformStore.set(safeBase, entry);

  const args = ["-v", "error", ...inputArgs, "-ac", "1", "-ar", String(PCM_SAMPLE_RATE), "-f", "s16le", "pipe:1"];
  const proc = spawn(ff, args, {
    windowsHide: true,
    stdio: [inputArgs[1] === "pipe:0" ? "pipe" : "ignore", "pipe", "ignore"]
  });

  let leftover = null;
  let sampleCountInSlice = 0;
  let currentSliceMax = 0;

  proc.stdout.on("data", (chunk) => {
    const buf = leftover ? Buffer.concat([leftover, chunk]) : chunk;
    const evenLen = buf.length - (buf.length % 2);
    leftover = evenLen < buf.length ? buf.subarray(evenLen) : null;

    for (let offset = 0; offset < evenLen; offset += 2) {
      const sample = Math.abs(buf.readInt16LE(offset)) / 32768;
      if (sample > currentSliceMax) currentSliceMax = sample;
      sampleCountInSlice++;
      if (sampleCountInSlice >= SLICE_SAMPLES) {
        entry.rawSlices.push(currentSliceMax);
        sampleCountInSlice = 0;
        currentSliceMax = 0;
      }
    }

    if (entry.rawSlices.length > 0) {
      const partial = buildPartialBucketsFromSlices(entry.rawSlices, estimatedDurSec);
      entry.peaks = partial.peaks;
      entry.progress = partial.progress;
    }
  });

  proc.on("close", (code) => {
    if (sampleCountInSlice > 0) {
      entry.rawSlices.push(currentSliceMax);
    }
    entry.active = false;
    if (code === 0 && entry.rawSlices.length > 4) {
      entry.peaks = normalizePeaksArray(entry.rawSlices, WAVEFORM_BUCKETS);
      entry.complete = true;
      entry.progress = 1;
      savePeaksToDisk(safeBase, entry.peaks);
    } else if (!entry.complete) {
      waveformStore.delete(safeBase);
    }
    entry.rawSlices = [];
  });

  proc.on("error", () => {
    entry.active = false;
    if (!entry.complete) waveformStore.delete(safeBase);
  });

  return proc;
}

function resolveLocalPathIfLocal(rawUrl) {
  if (!rawUrl) return null;
  let cleanLocal = rawUrl;
  try { cleanLocal = decodeURIComponent(rawUrl); } catch (_) {}
  const isFileScheme = /^file:\/\//i.test(cleanLocal);
  if (isFileScheme) {
    cleanLocal = cleanLocal.replace(/^file:\/\/\/?/i, "");
  }
  cleanLocal = cleanLocal.replace(/^[/\\]+([a-zA-Z]:)/, "$1").replace(/\//g, "\\");
  const isWindowsPath = /^[a-zA-Z]:\\/.test(cleanLocal) || /^\\\\/.test(cleanLocal);
  if (isFileScheme || isWindowsPath || fs.existsSync(cleanLocal)) {
    return cleanLocal;
  }
  return null;
}

function isLicenseYouTubeSafe(licenseUrl) {
  if (!licenseUrl) return false;
  const lower = licenseUrl.toLowerCase();
  if (lower.includes("-nd") || lower.includes("/nd/")) return false;
  if (lower.includes("-nc") || lower.includes("/nc/")) return false;
  if (lower.includes("/by/") || lower.includes("/by-sa/") || lower.includes("publicdomain") || lower.includes("/zero/")) {
    return true;
  }
  return false;
}

function extractLicenseName(licenseUrl) {
  if (!licenseUrl) return "Unknown";
  const lower = licenseUrl.toLowerCase();
  if (lower.includes("publicdomain") || lower.includes("/zero/")) return "CC0 (Public Domain)";
  if (lower.includes("/by/")) return "CC BY";
  if (lower.includes("/by-sa/")) return "CC BY-SA";
  return "Creative Commons";
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("http://") ? http : https;
    const req = client.get(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const nextUrl = new URL(res.headers.location, url).toString();
        res.resume();
        return downloadFile(nextUrl, destPath).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Download failed with status ${res.statusCode}`));
      }
      const out = fs.createWriteStream(destPath);
      res.pipe(out);
      out.on("finish", () => {
        out.close(() => resolve(destPath));
      });
    });
    req.on("error", (err) => {
      try { fs.unlinkSync(destPath); } catch (_) {}
      reject(err);
    });
  });
}

function formatTrimTag(sec) {
  const mins = Math.floor(sec / 60);
  const rem = (sec - mins * 60).toFixed(1).replace(/\.0$/, "");
  return `${mins}m${rem}s`;
}

function trimAudioWithFfmpeg(ffmpegBin, inputPath, outputPath, trimIn, trimOut) {
  return new Promise((resolve, reject) => {
    const duration = Math.max(0.1, trimOut - trimIn);
    const fadeDur = Math.min(0.01, duration / 4);
    const fadeOutStart = Math.max(0, duration - fadeDur);
    const afFilter = `afade=t=in:st=0:d=${fadeDur.toFixed(4)},afade=t=out:st=${fadeOutStart.toFixed(4)}:d=${fadeDur.toFixed(4)}`;

    const ext = path.extname(outputPath).toLowerCase();
    const codecArgs = ext === ".wav"
      ? ["-c:a", "pcm_s16le"]
      : ["-c:a", "libmp3lame", "-q:a", "1"];

    const args = [
      "-y",
      "-v", "error",
      "-ss", trimIn.toFixed(3),
      "-to", trimOut.toFixed(3),
      "-i", inputPath,
      "-af", afFilter,
      ...codecArgs,
      outputPath
    ];

    const proc = spawn(ffmpegBin, args, { windowsHide: true });
    let errText = "";
    proc.stderr.on("data", (c) => (errText += String(c)));
    proc.on("close", (code) => {
      if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 256) {
        resolve(outputPath);
      } else {
        reject(new Error(errText.trim() || `ffmpeg exited with code ${code}`));
      }
    });
    proc.on("error", reject);
  });
}

let tmpStreamCounter = 0;
const jamendoQueryCache = new Map();

function fetchJamendoJson(targetUrl) {
  return new Promise((resolve, reject) => {
    https.get(targetUrl, { headers: { "User-Agent": "OhMyGramola/1.0" } }, (jamRes) => {
      let raw = "";
      jamRes.on("data", (c) => (raw += c));
      jamRes.on("end", () => {
        try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

function streamRemoteAudio(targetUrl, safeBase, cachedFile, estimatedDurSec, req, res, redirectCount = 0) {
  if (redirectCount > 5) {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Too many redirects while streaming audio");
    }
    return;
  }

  const client = targetUrl.startsWith("http://") ? http : https;
  const reqHeaders = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
  };
  if (req.headers.range) {
    reqHeaders["Range"] = req.headers.range;
  }

  const upstreamReq = client.get(targetUrl, { headers: reqHeaders }, (upstreamRes) => {
    const status = upstreamRes.statusCode || 500;

    if ([301, 302, 303, 307, 308].includes(status) && upstreamRes.headers.location) {
      const nextUrl = new URL(upstreamRes.headers.location, targetUrl).toString();
      upstreamRes.resume();
      return streamRemoteAudio(nextUrl, safeBase, cachedFile, estimatedDurSec, req, res, redirectCount + 1);
    }

    if (status !== 200 && status !== 206) {
      upstreamRes.resume();
      if (!res.headersSent) {
        res.writeHead(status >= 400 ? status : 502, { "Content-Type": "text/plain" });
        res.end(`Upstream audio returned status ${status}`);
      }
      return;
    }

    const outHeaders = {
      "Content-Type": "audio/mpeg",
      "Accept-Ranges": "bytes"
    };
    if (upstreamRes.headers["content-length"]) {
      outHeaders["Content-Length"] = upstreamRes.headers["content-length"];
    }
    if (upstreamRes.headers["content-range"]) {
      outHeaders["Content-Range"] = upstreamRes.headers["content-range"];
    }

    res.writeHead(status, outHeaders);

    // Opportunistically tee to disk cache AND live waveform extractor ONLY when streaming from byte 0
    let isFullFromZero = false;
    let expectedBytes = parseInt(upstreamRes.headers["content-length"] || "0", 10);
    const contentRange = upstreamRes.headers["content-range"];

    if (status === 200 && expectedBytes > 0) {
      isFullFromZero = true;
    } else if (status === 206 && contentRange) {
      const m = /^bytes\s+0-(\d+)\/(\d+)$/i.exec(contentRange.trim());
      if (m) {
        const endByte = parseInt(m[1], 10);
        const totalBytes = parseInt(m[2], 10);
        if (totalBytes > 0 && endByte === totalBytes - 1) {
          isFullFromZero = true;
          expectedBytes = totalBytes;
        }
      }
    }

    let tempPath = null;
    let tempStream = null;
    let writtenBytes = 0;
    let cacheAborted = false;

    if (isFullFromZero && !fs.existsSync(cachedFile)) {
      tempPath = `${cachedFile}.${process.pid}_${++tmpStreamCounter}.part`;
      try {
        tempStream = fs.createWriteStream(tempPath);
        tempStream.on("error", () => {
          cacheAborted = true;
          try { fs.unlinkSync(tempPath); } catch (_) {}
        });
      } catch (_) {
        tempStream = null;
      }
    }

    // Live progressive waveform extractor fed from incoming network chunks (zero extra download!)
    let ffPeakProc = null;
    if (isFullFromZero && !loadCachedPeaksFromDisk(safeBase)) {
      ffPeakProc = createFfmpegPeakExtractor(safeBase, estimatedDurSec, ["-i", "pipe:0"]);
      if (ffPeakProc && ffPeakProc.stdin) {
        ffPeakProc.stdin.on("error", () => {});
      }
    }

    const cleanupSideEffects = () => {
      if (tempStream && !cacheAborted) {
        cacheAborted = true;
        tempStream.destroy();
        if (tempPath) {
          fs.unlink(tempPath, () => {});
        }
      }
      if (ffPeakProc) {
        try { ffPeakProc.kill(); } catch (_) {}
        ffPeakProc = null;
      }
    };

    upstreamRes.on("data", (chunk) => {
      if (tempStream && !cacheAborted) {
        writtenBytes += chunk.length;
        tempStream.write(chunk);
      }
      if (ffPeakProc && ffPeakProc.stdin && !ffPeakProc.stdin.destroyed) {
        try { ffPeakProc.stdin.write(chunk); } catch (_) {}
      }
    });

    upstreamRes.on("end", () => {
      if (ffPeakProc && ffPeakProc.stdin && !ffPeakProc.stdin.destroyed) {
        try { ffPeakProc.stdin.end(); } catch (_) {}
      }
      if (tempStream && !cacheAborted) {
        if (expectedBytes > 0 && writtenBytes === expectedBytes && !upstreamRes.aborted && upstreamRes.complete) {
          tempStream.end(() => {
            try {
              if (!fs.existsSync(cachedFile)) {
                fs.renameSync(tempPath, cachedFile);
              } else {
                fs.unlinkSync(tempPath);
              }
            } catch (_) {
              try { fs.unlinkSync(tempPath); } catch (__) {}
            }
          });
        } else {
          cleanupSideEffects();
        }
      }
    });

    upstreamRes.on("error", () => {
      cleanupSideEffects();
      if (!res.writableEnded) res.destroy();
    });

    req.on("close", () => {
      if (!upstreamRes.complete) {
        cleanupSideEffects();
        upstreamReq.destroy();
      }
    });

    upstreamRes.pipe(res);
  });

  upstreamReq.on("error", (err) => {
    console.error("Broker live stream error:", err.message);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end(err.message);
    } else if (!res.writableEnded) {
      res.destroy();
    }
  });

  req.on("close", () => {
    if (!res.writableEnded) {
      upstreamReq.destroy();
    }
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);

  // CORS headers for local panel + Web Audio API
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  // 1. Status Check
  if (parsedUrl.pathname === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      ok: true,
      version: "1.0.6",
      cacheDir: CACHE_DIR,
      hasFfmpeg: Boolean(resolveFfmpegPath())
    }));
  }

  // 2. Jamendo API Proxy
  if (parsedUrl.pathname === "/api/jamendo") {
    const clientId = (parsedUrl.searchParams.get("client_id") || "").trim();
    if (!clientId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Missing Jamendo Developer Client ID" }));
    }
    const search = parsedUrl.searchParams.get("search") || "";
    const tags = parsedUrl.searchParams.get("tags") || "";

    const jamendoParams = new URLSearchParams({
      client_id: clientId,
      format: "json",
      limit: "40",
      ccnc: "false",
      ccnd: "false",
      include: "musicinfo",
      order: "popularity_total"
    });
    if (search) jamendoParams.set("search", search);
    if (tags) jamendoParams.set("tags", tags);

    const target = `https://api.jamendo.com/v3.0/tracks/?${jamendoParams.toString()}`;
    const cachedHit = jamendoQueryCache.get(target);
    if (cachedHit && Date.now() - cachedHit.ts < 120000) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, results: cachedHit.results }));
    }

    try {
      let data = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        data = await fetchJamendoJson(target);
        if ((data.headers && data.headers.status === "failed") || (data.results && data.results.length > 0)) {
          break;
        }
        await new Promise((r) => setTimeout(r, 250));
      }

      if (data.headers && data.headers.status === "failed") {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: false, error: data.headers.error_message || "Jamendo API Error" }));
      }

      const rawTracks = data.results || [];
      const safeTracks = rawTracks
        .filter((t) => t.audiodownload_allowed !== false && isLicenseYouTubeSafe(t.license_ccurl))
        .map((t) => {
          const licenseName = extractLicenseName(t.license_ccurl);
          const attribution = `"${t.name}" by ${t.artist_name} (${t.shareurl})\nLicensed under Creative Commons: ${licenseName} (${t.license_ccurl})\nSource: Jamendo Music`;

          const sec = parseInt(t.duration, 10) || 0;
          const mins = Math.floor(sec / 60);
          const remSec = sec % 60;
          const durationFormatted = `${mins}:${remSec < 10 ? "0" : ""}${remSec}`;

          let peaks = null;
          if (t.waveform) {
            try {
              const wfObj = typeof t.waveform === "string" ? JSON.parse(t.waveform) : t.waveform;
              if (wfObj && Array.isArray(wfObj.peaks) && wfObj.peaks.length > 0) {
                peaks = normalizePeaksArray(wfObj.peaks, WAVEFORM_BUCKETS);
              }
            } catch (_) {}
          }

          return {
            id: `jamendo-${t.id}`,
            source: "jamendo",
            title: t.name,
            artist: t.artist_name,
            genre: (t.musicinfo?.tags?.genres?.[0]) || "Indie",
            bpm: t.musicinfo?.bpm || "—",
            duration: durationFormatted,
            durationSec: sec,
            peaks: peaks,
            streamUrl: t.audio,
            downloadUrl: t.audiodownload || t.audio,
            webUrl: t.shareurl || `https://www.jamendo.com/track/${t.id}`,
            licenseType: licenseName,
            licenseNotice: "YouTube-safe (ND/NC excluded)",
            attribution: attribution,
            safeForYouTube: true
          };
        });

      if (safeTracks.length > 0) {
        jamendoQueryCache.set(target, { ts: Date.now(), results: safeTracks });
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, results: safeTracks }));
    } catch (err) {
      console.error("Broker Jamendo query error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  }

  // 3. Audio Streaming (Live HTTP Range + Progressive Waveform Tee)
  if (parsedUrl.pathname === "/api/stream") {
    const rawUrl = parsedUrl.searchParams.get("url");
    const trackId = parsedUrl.searchParams.get("id") || "track";
    const estimatedDurSec = parseFloat(parsedUrl.searchParams.get("dur") || "0") || 0;
    if (!rawUrl) {
      res.writeHead(400);
      return res.end("Missing url parameter");
    }

    const safeBase = trackId.replace(/[/\\?%*:|"<>]/g, "_");
    const cleanLocal = resolveLocalPathIfLocal(rawUrl);

    if (cleanLocal !== null) {
      if (!fs.existsSync(cleanLocal)) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        return res.end(`Local file not found: ${cleanLocal}`);
      }
      if (!loadCachedPeaksFromDisk(safeBase)) {
        createFfmpegPeakExtractor(safeBase, estimatedDurSec, ["-i", cleanLocal]);
      }
      return streamLocalFile(cleanLocal, req, res);
    }

    const cachedFile = path.join(CACHE_DIR, `${safeBase}.mp3`);
    if (fs.existsSync(cachedFile)) {
      try {
        if (fs.statSync(cachedFile).size > 0) {
          if (!loadCachedPeaksFromDisk(safeBase)) {
            createFfmpegPeakExtractor(safeBase, estimatedDurSec, ["-i", cachedFile]);
          }
          return streamLocalFile(cachedFile, req, res);
        }
      } catch (_) {}
    }

    return streamRemoteAudio(rawUrl, safeBase, cachedFile, estimatedDurSec, req, res);
  }

  // 3b. Progressive & Cached Waveform Endpoint
  if (parsedUrl.pathname === "/api/waveform") {
    const trackId = parsedUrl.searchParams.get("id") || "track";
    const rawUrl = parsedUrl.searchParams.get("url") || "";
    const estimatedDurSec = parseFloat(parsedUrl.searchParams.get("dur") || "0") || 0;
    const safeBase = trackId.replace(/[/\\?%*:|"<>]/g, "_");

    const diskPeaks = loadCachedPeaksFromDisk(safeBase);
    if (diskPeaks) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, complete: true, progress: 1, peaks: diskPeaks }));
    }

    const mem = waveformStore.get(safeBase);
    if (mem) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({
        ok: true,
        complete: mem.complete,
        progress: mem.progress,
        peaks: mem.peaks
      }));
    }

    if (!resolveFfmpegPath()) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, unsupported: true, complete: false, progress: 0, peaks: [] }));
    }

    // Trigger local/cached file extraction if file is already on disk
    const cleanLocal = resolveLocalPathIfLocal(rawUrl);
    const cachedFile = path.join(CACHE_DIR, `${safeBase}.mp3`);
    if (cleanLocal && fs.existsSync(cleanLocal)) {
      createFfmpegPeakExtractor(safeBase, estimatedDurSec, ["-i", cleanLocal]);
    } else if (fs.existsSync(cachedFile) && fs.statSync(cachedFile).size > 0) {
      createFfmpegPeakExtractor(safeBase, estimatedDurSec, ["-i", cachedFile]);
    }

    const afterStart = waveformStore.get(safeBase);
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      ok: true,
      complete: afterStart ? afterStart.complete : false,
      progress: afterStart ? afterStart.progress : 0,
      peaks: afterStart ? afterStart.peaks : []
    }));
  }

  // 4. Download, Optional Trim, and Import to Final Library
  if (parsedUrl.pathname === "/api/import" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body);
        const { track, targetDir, trimIn, trimOut } = payload;
        const defaultMusicFallback = fs.existsSync("P:\\IA\\RRSS\\Music")
          ? "P:\\IA\\RRSS\\Music"
          : path.join(os.homedir(), "Music", "OhMyGramola");
        const libraryDir = targetDir || defaultMusicFallback;

        if (!fs.existsSync(libraryDir)) {
          fs.mkdirSync(libraryDir, { recursive: true });
        }

        const safeTitle = String(track.title || "Track").replace(/[/\\?%*:|"<>]/g, "_").trim() || "Track";
        let masterAudioPath = null;

        if (track.localPath && fs.existsSync(track.localPath)) {
          masterAudioPath = track.localPath;
        } else {
          masterAudioPath = path.join(libraryDir, `${safeTitle}.mp3`);
          const finalAttrPath = path.join(libraryDir, `${safeTitle}_attribution.txt`);
          const safeBase = String(track.id || "track").replace(/[/\\?%*:|"<>]/g, "_");
          const cachedFile = path.join(CACHE_DIR, `${safeBase}.mp3`);

          if (!fs.existsSync(masterAudioPath)) {
            if (fs.existsSync(cachedFile) && fs.statSync(cachedFile).size > 0) {
              fs.copyFileSync(cachedFile, masterAudioPath);
            } else {
              await downloadFile(track.downloadUrl || track.streamUrl, masterAudioPath);
            }
          }
          if (track.attribution) {
            fs.writeFileSync(finalAttrPath, track.attribution, "utf-8");
          }
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({
          ok: true,
          path: masterAudioPath,
          masterPath: masterAudioPath,
          trimmedOnDisk: false,
          trimIn: typeof trimIn === "number" ? trimIn : null,
          trimOut: typeof trimOut === "number" ? trimOut : null,
          attribution: track.attribution
        }));
      } catch (err) {
        console.error("Broker import error:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // 5. Native Windows Clipboard Copy
  if (parsedUrl.pathname === "/api/clipboard" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const text = payload.text || "";
        const proc = spawn("clip", [], { windowsHide: true });
        proc.stdin.write(text);
        proc.stdin.end();
        proc.on("close", (code) => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: code === 0 }));
        });
      } catch (err) {
        console.error("Broker clipboard error:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // 6. Native Windows Open External (Web URL or Explorer Folder)
  if (parsedUrl.pathname === "/api/open" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const target = (payload.target || "").trim();
        if (target) {
          spawn("cmd.exe", ["/c", "start", "", target], { windowsHide: true });
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        console.error("Broker open external error:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".mp3": return "audio/mpeg";
    case ".wav": return "audio/wav";
    case ".m4a": return "audio/mp4";
    case ".aac": return "audio/aac";
    case ".ogg": return "audio/ogg";
    case ".flac": return "audio/flac";
    default: return "audio/mpeg";
  }
}

function streamLocalFile(filePath, req, res) {
  const stat = fs.statSync(filePath);
  const totalSize = stat.size;
  const range = req.headers.range;
  const contentType = getMimeType(filePath);

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${totalSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunkSize,
      "Content-Type": contentType
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": totalSize,
      "Content-Type": contentType,
      "Accept-Ranges": "bytes"
    });
    fs.createReadStream(filePath).pipe(res);
  }
}

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  // Emit JSON handshake line on stdout for parent CEP panel
  console.log(JSON.stringify({ ok: true, port: port, version: "1.2.1" }));
});
