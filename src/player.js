/**
 * OhMyGramola — Audio Player Controller
 * Manages HTML5 audio streaming via Local Broker with 60fps playhead tracking,
 * ±10s/±60s keyboard scrubbing, and optional WebAudio live amplitude fallback.
 */
(function (global) {
  "use strict";

  const audio = document.createElement("audio");
  audio.id = "frm-native-player";
  audio.crossOrigin = "anonymous";
  audio.style.display = "none";
  audio.preload = "auto";
  document.body.appendChild(audio);

  let currentTrack = null;
  let playRequestSeq = 0;
  let rafId = null;

  // Optional WebAudio analyser for fallback live waveform sampling when ffmpeg is absent
  let audioCtx = null;
  let analyser = null;
  let timeDomainBuf = null;
  let webAudioConnected = false;

  const listeners = {
    stateChange: [],
    progress: [],
    trackChange: []
  };

  function parseDurationString(val) {
    if (typeof val === "number" && isFinite(val) && val > 0) return val;
    if (!val || typeof val !== "string") return 0;
    const parts = val.trim().split(":").map((n) => parseFloat(n));
    if (parts.some((n) => isNaN(n))) return 0;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
  }

  function getEffectiveDuration() {
    if (audio.duration && isFinite(audio.duration) && audio.duration > 0) {
      return audio.duration;
    }
    if (currentTrack) {
      return currentTrack.durationSec || parseDurationString(currentTrack.duration) || 0;
    }
    return 0;
  }

  function ensureWebAudio() {
    if (webAudioConnected) {
      if (audioCtx && audioCtx.state === "suspended") {
        audioCtx.resume().catch(() => {});
      }
      return;
    }
    try {
      const Ctx = global.AudioContext || global.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = new Ctx();
      const src = audioCtx.createMediaElementSource(audio);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      timeDomainBuf = new Uint8Array(analyser.fftSize);
      src.connect(analyser);
      analyser.connect(audioCtx.destination);
      webAudioConnected = true;
    } catch (e) {
      console.warn("WebAudio analyser unavailable, using native output:", e);
      webAudioConnected = true; // prevent repeated attempts
    }
  }

  function sampleLivePeak() {
    if (!analyser || !timeDomainBuf || audio.paused) return 0;
    try {
      analyser.getByteTimeDomainData(timeDomainBuf);
      let maxDev = 0;
      for (let i = 0; i < timeDomainBuf.length; i++) {
        const dev = Math.abs(timeDomainBuf[i] - 128) / 128;
        if (dev > maxDev) maxDev = dev;
      }
      return Math.min(1, Math.pow(maxDev, 0.85));
    } catch (_) {
      return 0;
    }
  }

  function emitState(state) {
    listeners.stateChange.forEach((fn) => fn(state, currentTrack));
  }

  function emitProgress() {
    const duration = getEffectiveDuration();
    const current = audio.currentTime || 0;
    const percent = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;
    const livePeak = sampleLivePeak();
    listeners.progress.forEach((fn) => fn({ current, duration, percent, livePeak }, currentTrack));
  }

  function startRafLoop() {
    if (rafId !== null) return;
    const tick = () => {
      emitProgress();
      if (!audio.paused && !audio.ended) {
        rafId = requestAnimationFrame(tick);
      } else {
        rafId = null;
      }
    };
    rafId = requestAnimationFrame(tick);
  }

  function stopRafLoop() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  audio.addEventListener("playing", () => {
    emitState("playing");
    startRafLoop();
  });
  audio.addEventListener("pause", () => {
    stopRafLoop();
    emitProgress();
    emitState("paused");
  });
  audio.addEventListener("waiting", () => emitState("loading"));
  audio.addEventListener("loadedmetadata", () => emitProgress());
  audio.addEventListener("canplay", () => {
    emitProgress();
    if (audio.paused) emitState("ready");
  });
  audio.addEventListener("timeupdate", emitProgress);
  audio.addEventListener("seeked", emitProgress);
  audio.addEventListener("ended", () => {
    stopRafLoop();
    emitState("ended");
    audio.currentTime = 0;
    emitProgress();
  });
  audio.addEventListener("error", (e) => {
    stopRafLoop();
    const mediaErr = audio.error;
    let desc = "Audio playback error";
    if (mediaErr) {
      if (mediaErr.code === 1) desc = "Aborted by user";
      else if (mediaErr.code === 2) desc = "Network error while streaming";
      else if (mediaErr.code === 3) desc = "Media decoding error";
      else if (mediaErr.code === 4) desc = "Format not supported by host CEF";
    }
    console.error("Player error:", desc, mediaErr, e);
    emitState("error");
  });

  global.MusicPlayer = {
    parseDurationString,

    getCurrentTrack() {
      return currentTrack;
    },

    isPlaying() {
      return !audio.paused && !audio.ended;
    },

    getCurrentTime() {
      return audio.currentTime || 0;
    },

    getDuration() {
      return getEffectiveDuration();
    },

    async play(track) {
      if (!track || !track.streamUrl) return;
      ensureWebAudio();

      // Resume same track if paused and already loaded
      if (currentTrack && currentTrack.id === track.id && audio.src) {
        audio.play().catch((err) => {
          console.warn("Audio resume prevented:", err);
          emitState("paused");
        });
        return;
      }

      const seq = ++playRequestSeq;
      stopRafLoop();
      audio.pause();

      const isNewTrack = !currentTrack || currentTrack.id !== track.id;
      currentTrack = track;
      if (isNewTrack) {
        listeners.trackChange.forEach((fn) => fn(currentTrack));
      }
      emitState("loading");

      // Ensure local broker is initialized
      if (global.BrokerClient) {
        await global.BrokerClient.init();
      }
      if (seq !== playRequestSeq) return;

      const estDur = track.durationSec || parseDurationString(track.duration) || 0;
      let streamUrl = track.streamUrl;
      if (global.BrokerClient && global.BrokerClient.isReady()) {
        streamUrl = global.BrokerClient.getStreamUrl(track.streamUrl, track.id, estDur);
      } else if (global.NetTransport && typeof global.NetTransport.getStreamUrl === "function") {
        streamUrl = global.NetTransport.getStreamUrl(track.streamUrl);
      }

      audio.src = streamUrl;

      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          if (seq !== playRequestSeq) return;
          console.warn("Audio play rejected:", err);
          emitState("paused");
        });
      }
    },

    pause() {
      audio.pause();
    },

    async toggle(track) {
      const target = track || currentTrack;
      if (!target) return;
      if (currentTrack && currentTrack.id === target.id && this.isPlaying()) {
        this.pause();
      } else {
        await this.play(target);
      }
    },

    seekSeconds(targetSeconds) {
      const dur = getEffectiveDuration();
      if (!dur || !isFinite(dur) || dur <= 0) return;
      const clamped = Math.max(0, Math.min(dur, targetSeconds));
      try {
        audio.currentTime = clamped;
        emitProgress();
      } catch (_) {}
    },

    seekBy(deltaSeconds) {
      const dur = getEffectiveDuration();
      if (!dur || !isFinite(dur) || dur <= 0) return;
      this.seekSeconds((audio.currentTime || 0) + deltaSeconds);
    },

    seek(percent) {
      const dur = getEffectiveDuration();
      if (!dur || !isFinite(dur) || dur <= 0) return;
      this.seekSeconds((Math.max(0, Math.min(100, percent)) / 100) * dur);
    },

    setVolume(ratio) {
      audio.volume = Math.max(0, Math.min(1, ratio));
    },

    onStateChange(fn) {
      listeners.stateChange.push(fn);
    },

    onProgress(fn) {
      listeners.progress.push(fn);
    },

    onTrackChange(fn) {
      listeners.trackChange.push(fn);
    }
  };
})(window);
