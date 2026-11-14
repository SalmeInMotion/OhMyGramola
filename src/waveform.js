/**
 * OhMyGramola — Interactive Streaming Waveform & In/Out Trim Controller
 * Renders a smooth symmetrical envelope waveform progressively as audio streams,
 * displays a 60fps sweeping playhead bar, and supports mouse drag + I/O key trimming.
 */
(function (global) {
  "use strict";

  const BUCKETS = 240;
  const HANDLE_HIT_PX = 7;
  const DRAG_THRESHOLD_PX = 5;

  let canvas = null;
  let ctx = null;
  let activeTrack = null;
  let peaks = new Array(BUCKETS).fill(0);
  let hasAnyPeaks = false;
  let streamProgress = 0;
  let currentSec = 0;
  let durationSec = 0;

  let pollTimer = null;
  let pollSeq = 0;

  // Map<trackId, { trimIn: number|null, trimOut: number|null }>
  const trimMap = new Map();
  const trimListeners = [];

  // Mouse interaction state
  let dragMode = null; // null | "pending" | "create" | "move-in" | "move-out"
  let downX = 0;
  let anchorSec = 0;

  function notifyTrimChange() {
    const t = activeTrack ? global.WaveformView.getTrim(activeTrack.id) : null;
    trimListeners.forEach((fn) => {
      try { fn(t, activeTrack); } catch (_) {}
    });
    draw();
  }

  function getRawTrimEntry(trackId) {
    if (!trackId) return null;
    return trimMap.get(trackId) || null;
  }

  function resizeCanvasIfNeeded() {
    if (!canvas) return false;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const dpr = global.devicePixelRatio || 1;
    const targetW = Math.round(rect.width * dpr);
    const targetH = Math.round(rect.height * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    return true;
  }

  function traceEnvelopePath(c, w, h, maxBucketIndex) {
    const midY = h / 2;
    const maxAmp = h * 0.44;
    const count = Math.min(peaks.length, Math.max(2, maxBucketIndex));

    c.beginPath();
    c.moveTo(0, midY);

    // Upper smooth contour (left -> right)
    for (let i = 0; i < count; i++) {
      const x = (i / (BUCKETS - 1)) * w;
      const amp = Math.max(0.025, peaks[i] || 0) * maxAmp;
      const y = midY - amp;
      if (i === 0) {
        c.lineTo(x, y);
      } else {
        const prevX = ((i - 1) / (BUCKETS - 1)) * w;
        const prevAmp = Math.max(0.025, peaks[i - 1] || 0) * maxAmp;
        const prevY = midY - prevAmp;
        const cx = (prevX + x) * 0.5;
        const cy = (prevY + y) * 0.5;
        c.quadraticCurveTo(prevX, prevY, cx, cy);
        if (i === count - 1) c.lineTo(x, y);
      }
    }

    const endX = ((count - 1) / (BUCKETS - 1)) * w;
    c.lineTo(endX, midY);

    // Lower mirrored smooth contour (right -> left)
    for (let i = count - 1; i >= 0; i--) {
      const x = (i / (BUCKETS - 1)) * w;
      const amp = Math.max(0.025, peaks[i] || 0) * maxAmp;
      const y = midY + amp;
      if (i === count - 1) {
        c.lineTo(x, y);
      } else {
        const nextX = ((i + 1) / (BUCKETS - 1)) * w;
        const nextAmp = Math.max(0.025, peaks[i + 1] || 0) * maxAmp;
        const nextY = midY + nextAmp;
        const cx = (nextX + x) * 0.5;
        const cy = (nextY + y) * 0.5;
        c.quadraticCurveTo(nextX, nextY, cx, cy);
        if (i === 0) c.lineTo(x, y);
      }
    }

    c.closePath();
  }

  function draw() {
    if (!canvas || !ctx) return;
    if (!resizeCanvasIfNeeded()) return;

    const dpr = global.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    ctx.save();
    ctx.scale(dpr, dpr);

    // 1. Sleek studio dark background
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, "#1c2028");
    bgGrad.addColorStop(0.5, "#232833");
    bgGrad.addColorStop(1, "#1a1e25");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Subtle center axis line
    const midY = h / 2;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    const playRatio = durationSec > 0 ? Math.max(0, Math.min(1, currentSec / durationSec)) : 0;
    const playX = playRatio * w;

    // 2. Mirrored Waveform Envelope
    if (hasAnyPeaks) {
      const visibleBuckets = streamProgress >= 0.99
        ? BUCKETS
        : Math.max(2, Math.ceil(Math.max(streamProgress, playRatio) * BUCKETS));

      // Unplayed / buffered silver-grey silhouette
      traceEnvelopePath(ctx, w, h, visibleBuckets);
      ctx.fillStyle = "rgba(196, 204, 218, 0.44)";
      ctx.fill();

      // Played highlight (left of playhead)
      if (playX > 0.5) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, playX, h);
        ctx.clip();
        traceEnvelopePath(ctx, w, h, visibleBuckets);
        ctx.fillStyle = "rgba(241, 243, 247, 0.88)";
        ctx.fill();
        ctx.restore();
      }
    } else if (activeTrack) {
      // Subtle center pulse line while first audio packets arrive
      ctx.strokeStyle = "rgba(216, 255, 66, 0.35)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(Math.max(12, playX), midY);
      ctx.stroke();
    }

    // 3. In / Out Trim Selection Region
    const trim = activeTrack ? global.WaveformView.getTrim(activeTrack.id) : null;
    if (trim && durationSec > 0) {
      const inX = Math.max(0, Math.min(w, (trim.trimIn / durationSec) * w));
      const outX = Math.max(0, Math.min(w, (trim.trimOut / durationSec) * w));

      // Dim outside trim region
      ctx.fillStyle = "rgba(11, 13, 17, 0.58)";
      if (inX > 0) ctx.fillRect(0, 0, inX, h);
      if (outX < w) ctx.fillRect(outX, 0, w - outX, h);

      // Tint inside trim region
      const regionW = Math.max(1, outX - inX);
      ctx.fillStyle = "rgba(216, 255, 66, 0.11)";
      ctx.fillRect(inX, 0, regionW, h);

      // Tint waveform inside trim region with subtle lime glow
      if (hasAnyPeaks) {
        const visibleBuckets = streamProgress >= 0.99 ? BUCKETS : Math.max(2, Math.ceil(Math.max(streamProgress, playRatio) * BUCKETS));
        ctx.save();
        ctx.beginPath();
        ctx.rect(inX, 0, regionW, h);
        ctx.clip();
        traceEnvelopePath(ctx, w, h, visibleBuckets);
        ctx.fillStyle = "rgba(216, 255, 66, 0.78)";
        ctx.fill();
        ctx.restore();
      }

      // Top & bottom work-area border
      ctx.strokeStyle = "rgba(216, 255, 66, 0.55)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(inX, 0.5);
      ctx.lineTo(outX, 0.5);
      ctx.moveTo(inX, h - 0.5);
      ctx.lineTo(outX, h - 0.5);
      ctx.stroke();

      // In '[' & Out ']' bracket handles
      ctx.fillStyle = "#d8ff42";
      // In handle
      ctx.fillRect(inX, 0, 2, h);
      ctx.fillRect(inX, 0, 6, 2);
      ctx.fillRect(inX, h - 2, 6, 2);
      // Out handle
      ctx.fillRect(Math.max(0, outX - 2), 0, 2, h);
      ctx.fillRect(Math.max(0, outX - 6), 0, 6, 2);
      ctx.fillRect(Math.max(0, outX - 6), h - 2, 6, 2);
    }

    // 4. Sweeping Playhead Bar
    if (activeTrack && durationSec > 0) {
      const clampedPlayX = Math.max(1, Math.min(w - 1, playX));
      ctx.save();
      ctx.shadowColor = "rgba(0, 0, 0, 0.7)";
      ctx.shadowBlur = 3;
      ctx.fillStyle = trim ? "#ffffff" : "#d8ff42";
      ctx.fillRect(clampedPlayX - 1, 0, 2, h);

      // Top playhead cap
      ctx.beginPath();
      ctx.moveTo(clampedPlayX - 4, 0);
      ctx.lineTo(clampedPlayX + 4, 0);
      ctx.lineTo(clampedPlayX, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  function stopPolling() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function startWaveformPolling(track) {
    stopPolling();
    const mySeq = ++pollSeq;

    if (!track || !global.BrokerClient) return;

    // If track already carries precomputed Jamendo peaks, display immediately!
    if (Array.isArray(track.peaks) && track.peaks.length > 0) {
      peaks = track.peaks.slice(0, BUCKETS);
      while (peaks.length < BUCKETS) peaks.push(0);
      hasAnyPeaks = true;
      streamProgress = 1;
      draw();
      return;
    }

    const estDur = track.durationSec || (global.MusicPlayer ? global.MusicPlayer.parseDurationString(track.duration) : 0) || 0;

    const poll = async () => {
      if (mySeq !== pollSeq || !activeTrack || activeTrack.id !== track.id) return;

      const wf = await global.BrokerClient.getWaveform({
        trackId: track.id,
        url: track.streamUrl || "",
        durationSec: estDur || durationSec || 0
      });

      if (mySeq !== pollSeq || !activeTrack || activeTrack.id !== track.id) return;

      if (wf && wf.ok) {
        if (wf.unsupported) {
          // Machine has no ffmpeg: rely on WebAudio live amplitude samples in updateProgress()
          return;
        }
        if (Array.isArray(wf.peaks) && wf.peaks.some((v) => v > 0)) {
          peaks = wf.peaks.slice(0, BUCKETS);
          while (peaks.length < BUCKETS) peaks.push(0);
          hasAnyPeaks = true;
          streamProgress = wf.complete ? 1 : Math.max(streamProgress, wf.progress || 0);
          draw();
        }
        if (wf.complete) {
          track.peaks = peaks.slice();
          return;
        }
      }

      pollTimer = setTimeout(poll, 180);
    };

    pollTimer = setTimeout(poll, 120);
  }

  function xToSeconds(clientX) {
    if (!canvas || durationSec <= 0) return 0;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    return ratio * durationSec;
  }

  function getHandleNearX(clientX) {
    if (!canvas || !activeTrack || durationSec <= 0) return null;
    const trim = global.WaveformView.getTrim(activeTrack.id);
    if (!trim) return null;
    const rect = canvas.getBoundingClientRect();
    const localX = clientX - rect.left;
    const inX = (trim.trimIn / durationSec) * rect.width;
    const outX = (trim.trimOut / durationSec) * rect.width;

    if (Math.abs(localX - inX) <= HANDLE_HIT_PX) return "in";
    if (Math.abs(localX - outX) <= HANDLE_HIT_PX) return "out";
    return null;
  }

  function bindCanvasEvents() {
    if (!canvas) return;

    canvas.addEventListener("mousemove", (e) => {
      if (dragMode) return;
      const handle = getHandleNearX(e.clientX);
      canvas.style.cursor = handle ? "ew-resize" : "pointer";
    });

    canvas.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || !activeTrack) return;
      if (durationSec <= 0 && global.MusicPlayer) {
        durationSec = global.MusicPlayer.getDuration() || 0;
      }
      if (durationSec <= 0) return;

      e.preventDefault();
      downX = e.clientX;
      anchorSec = xToSeconds(e.clientX);

      const handle = getHandleNearX(e.clientX);
      if (handle === "in") {
        dragMode = "move-in";
      } else if (handle === "out") {
        dragMode = "move-out";
      } else {
        dragMode = "pending";
      }
    });

    global.addEventListener("mousemove", (e) => {
      if (!dragMode || !activeTrack || durationSec <= 0) return;

      if (dragMode === "pending") {
        if (Math.abs(e.clientX - downX) < DRAG_THRESHOLD_PX) return;
        dragMode = "create";
      }

      const sec = xToSeconds(e.clientX);
      const existing = global.WaveformView.getTrim(activeTrack.id);

      if (dragMode === "create") {
        const start = Math.min(anchorSec, sec);
        const end = Math.max(anchorSec, sec);
        if (end - start >= 0.2) {
          trimMap.set(activeTrack.id, { trimIn: start, trimOut: end });
          notifyTrimChange();
        }
      } else if (dragMode === "move-in" && existing) {
        const clampedIn = Math.max(0, Math.min(existing.trimOut - 0.2, sec));
        trimMap.set(activeTrack.id, { trimIn: clampedIn, trimOut: existing.trimOut });
        notifyTrimChange();
      } else if (dragMode === "move-out" && existing) {
        const clampedOut = Math.min(durationSec, Math.max(existing.trimIn + 0.2, sec));
        trimMap.set(activeTrack.id, { trimIn: existing.trimIn, trimOut: clampedOut });
        notifyTrimChange();
      }
    });

    global.addEventListener("mouseup", (e) => {
      if (!dragMode) return;
      const mode = dragMode;
      dragMode = null;

      if (mode === "pending" && activeTrack && durationSec > 0) {
        // Simple click without dragging -> seek playhead!
        const targetSec = xToSeconds(e.clientX);
        if (global.MusicPlayer) {
          global.MusicPlayer.seekSeconds(targetSec);
        }
      }
    });

    global.addEventListener("resize", () => draw());
  }

  global.WaveformView = {
    init(canvasElement) {
      canvas = canvasElement;
      if (!canvas) return;
      ctx = canvas.getContext("2d");
      bindCanvasEvents();
      draw();
    },

    setTrack(track) {
      activeTrack = track || null;
      peaks = new Array(BUCKETS).fill(0);
      hasAnyPeaks = false;
      streamProgress = 0;
      currentSec = 0;
      durationSec = track
        ? (track.durationSec || (global.MusicPlayer ? global.MusicPlayer.parseDurationString(track.duration) : 0) || 0)
        : 0;
      startWaveformPolling(track);
      notifyTrimChange();
    },

    updateProgress({ current = 0, duration = 0, livePeak = 0 } = {}) {
      currentSec = current;
      if (duration > 0) durationSec = duration;

      // Fallback progressive live peak recording when ffmpeg is unavailable
      if (activeTrack && durationSec > 0 && livePeak > 0 && streamProgress < 0.99) {
        const bIdx = Math.min(BUCKETS - 1, Math.floor((currentSec / durationSec) * BUCKETS));
        if (livePeak > (peaks[bIdx] || 0)) {
          peaks[bIdx] = livePeak;
          hasAnyPeaks = true;
        }
      }

      draw();
    },

    getTrim(trackId) {
      const id = trackId || (activeTrack && activeTrack.id);
      const entry = getRawTrimEntry(id);
      if (!entry) return null;
      const dur = (activeTrack && activeTrack.id === id && durationSec > 0)
        ? durationSec
        : (entry.trimOut || 0);
      const tIn = typeof entry.trimIn === "number" ? entry.trimIn : 0;
      const tOut = typeof entry.trimOut === "number" ? entry.trimOut : dur;
      if (tOut <= tIn + 0.1) return null;
      return { trimIn: tIn, trimOut: tOut };
    },

    setInAtPlayhead() {
      if (!activeTrack) return null;
      const dur = durationSec || (global.MusicPlayer ? global.MusicPlayer.getDuration() : 0);
      if (!dur || dur <= 0) return null;
      const now = global.MusicPlayer ? global.MusicPlayer.getCurrentTime() : currentSec;
      const prev = getRawTrimEntry(activeTrack.id);
      let nextOut = prev && typeof prev.trimOut === "number" ? prev.trimOut : dur;
      if (nextOut <= now + 0.2) {
        nextOut = dur;
      }
      const clampedIn = Math.max(0, Math.min(dur - 0.2, now));
      trimMap.set(activeTrack.id, { trimIn: clampedIn, trimOut: nextOut });
      notifyTrimChange();
      return this.getTrim(activeTrack.id);
    },

    setOutAtPlayhead() {
      if (!activeTrack) return null;
      const dur = durationSec || (global.MusicPlayer ? global.MusicPlayer.getDuration() : 0);
      if (!dur || dur <= 0) return null;
      const now = global.MusicPlayer ? global.MusicPlayer.getCurrentTime() : currentSec;
      const prev = getRawTrimEntry(activeTrack.id);
      let nextIn = prev && typeof prev.trimIn === "number" ? prev.trimIn : 0;
      if (nextIn >= now - 0.2) {
        nextIn = 0;
      }
      const clampedOut = Math.max(0.2, Math.min(dur, now));
      trimMap.set(activeTrack.id, { trimIn: nextIn, trimOut: clampedOut });
      notifyTrimChange();
      return this.getTrim(activeTrack.id);
    },

    clearTrim(trackId) {
      const id = trackId || (activeTrack && activeTrack.id);
      if (!id) return;
      trimMap.delete(id);
      notifyTrimChange();
    },

    onTrimChange(fn) {
      if (typeof fn === "function") trimListeners.push(fn);
    },

    redraw: draw
  };
})(window);
