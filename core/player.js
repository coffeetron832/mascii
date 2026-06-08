import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import http from "http";
import https from "https";
import net from "net";
import * as mm from "music-metadata";
import sharp from "sharp";

const MUSIC_DIR = path.resolve("./music");
const SUPPORTED_EXTENSIONS = new Set([".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac"]);
const DEFAULT_DURATION = 180;
const DEFAULT_VOLUME = 80;
const YTDLP_PATH = process.env.YTDLP_PATH || "/usr/local/bin/yt-dlp";

// Arte por defecto global actualizado con la vaca alineada comiendo pasto
const DEFAULT_ART = [
  "    \\|/          (__)  ",
  "        `\\------(oo) ",
  "          ||    (__)  ",
  "          ||w--||     \\|/",
  "       \\|/             "
].join("\n");

export function createPlayer({ playlist: initialPlaylist = [], ui }) {
  let playlist = Array.isArray(initialPlaylist) ? [...initialPlaylist] : [];
  let originalPlaylist = [...playlist];

  let index = 0;
  let audioProcess = null;
  let ipcClient = null;

  let playing = false;
  let isPaused = false;

  let startedAt = 0;
  let totalElapsedTime = 0;
  let lastResumeAt = 0;

  let isManualKill = false;
  let currentTrackId = 0;

  let currentVolume = DEFAULT_VOLUME;
  let loopState = false;
  let shuffleState = false;
  let eqMode = "ROCK";

  const EQ_PRESETS = ["ROCK", "POP", "JAZZ", "FLAT", "CLASSIC"];
  let eqIndex = 0;

  const IPC_PATH = `/tmp/mascii-mpv-${Date.now()}.sock`;

  const metadataCache = new Map();
  const artCache = new Map();

  let renderPending = false;

  // Persistencia de metadatos de la pista en reproducción para redibujado dinámico
  let currentImageBuffer = null;
  let currentAlbumName = "Art Not Available";
  let currentAlbumYear = "2026";

  function safeCall(fn, ...args) {
    try {
      return typeof fn === "function" ? fn(...args) : undefined;
    } catch {
      return undefined;
    }
  }

  function scheduleRender() {
    if (renderPending) return;
    renderPending = true;

    setTimeout(() => {
      renderPending = false;
      safeCall(ui?.render);
    }, 16);
  }

  function syncOriginalPlaylist() {
    originalPlaylist = [...playlist];
  }

  function ensureIndex() {
    if (!playlist.length) {
      index = 0;
      return;
    }

    if (index < 0) index = playlist.length - 1;
    if (index >= playlist.length) index = 0;
  }

  function getTrack() {
    if (!playlist.length) return null;
    ensureIndex();
    return playlist[index] || null;
  }

  async function getMetadata(filePath) {
    if (metadataCache.has(filePath)) {
      return metadataCache.get(filePath);
    }

    const promise = mm.parseFile(filePath).catch(() => null);
    metadataCache.set(filePath, promise);
    return promise;
  }

  function mergeTrackLists(existingTracks, localTracks) {
    const merged = [];
    const seen = new Set();

    for (const track of existingTracks) {
      if (!track || !track.path || seen.has(track.path)) continue;
      seen.add(track.path);
      merged.push(track);
    }

    for (const track of localTracks) {
      if (!track || !track.path || seen.has(track.path)) continue;
      seen.add(track.path);
      merged.push(track);
    }

    return merged;
  }

  async function loadTracks() {
    try {
      if (!fs.existsSync(MUSIC_DIR)) {
        fs.mkdirSync(MUSIC_DIR, { recursive: true });
        return playlist;
      }

      const files = fs.readdirSync(MUSIC_DIR);
      const localTracks = [];

      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

        const filePath = path.join(MUSIC_DIR, file);
        const metadata = await getMetadata(filePath);

        const duration =
          metadata?.format?.duration && Number.isFinite(metadata.format.duration)
            ? Math.max(1, Math.round(metadata.format.duration))
            : DEFAULT_DURATION;

        localTracks.push({
          name: path.basename(file, ext),
          path: filePath,
          duration,
          artist: metadata?.common?.artist || "Local Track"
        });
      }

      localTracks.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      );

      playlist = mergeTrackLists(playlist, localTracks);
      syncOriginalPlaylist();

      if (index >= playlist.length) index = 0;
      safeCall(ui?.setPlaylist, playlist, index);
      scheduleRender();

      return playlist;
    } catch (error) {
      safeCall(ui?.appendLog, `{red-fg}Error loading tracks:{/red-fg} ${error?.message || error}`);
      return playlist;
    }
  }

  function addTrack(trackObj) {
    if (!trackObj || !trackObj.path) return;

    const exists = playlist.some((track) => track.path === trackObj.path);
    if (exists) {
      safeCall(ui?.appendLog, `{yellow-fg}Track already exists in playlist.{/yellow-fg}`);
      return;
    }

    playlist.push(trackObj);
    originalPlaylist.push(trackObj);

    safeCall(ui?.setPlaylist, playlist, index);
    scheduleRender();
  }

  function cleanup() {
    playing = false;
    isPaused = false;
    currentImageBuffer = null; 

    if (ipcClient) {
      try {
        ipcClient.removeAllListeners();
        ipcClient.destroy();
      } catch {}
      ipcClient = null;
    }

    if (audioProcess) {
      const proc = audioProcess;
      audioProcess = null;

      try {
        proc.removeAllListeners("exit");
        proc.removeAllListeners("error");
        proc.removeAllListeners("close");
        proc.stderr?.removeAllListeners?.("data");
      } catch {}

      try {
        proc.kill("SIGTERM");
      } catch {}

      setTimeout(() => {
        try {
          if (proc.exitCode === null && !proc.killed) {
            proc.kill("SIGKILL");
          }
        } catch {}
      }, 800);
    }

    try {
      if (fs.existsSync(IPC_PATH)) {
        fs.unlinkSync(IPC_PATH);
      }
    } catch {}

    startedAt = 0;
    totalElapsedTime = 0;
    lastResumeAt = 0;
  }

  function sendIpcCommand(commandArray) {
    if (ipcClient && !ipcClient.destroyed && ipcClient.writable) {
      try {
        ipcClient.write(JSON.stringify({ command: commandArray }) + "\n");
      } catch {}
    }
  }

  function getEqFilter(mode) {
    switch (mode) {
      case "ROCK":
        return "equalizer=f=100:g=4,equalizer=f=1000:g=-2,equalizer=f=10000:g=5";
      case "POP":
        return "equalizer=f=100:g=-2,equalizer=f=1000:g=3,equalizer=f=10000:g=-1";
      case "JAZZ":
        return "equalizer=f=100:g=3,equalizer=f=1000:g=0,equalizer=f=10000:g=3";
      case "CLASSIC":
        return "equalizer=f=100:g=2,equalizer=f=1000:g=-1,equalizer=f=10000:g=-3";
      case "FLAT":
      default:
        return "";
    }
  }

  function applyEQ() {
    const eqFilter = getEqFilter(eqMode);
    sendIpcCommand(["set_property_string", "af", eqFilter]);
  }

  function applyRuntimeSettings() {
    sendIpcCommand(["set_property", "volume", currentVolume]);
    sendIpcCommand(["set_property", "loop-file", loopState ? "inf" : "no"]);
    sendIpcCommand(["set_property", "pause", isPaused]);
    applyEQ();
  }

  function connectIpcWithRetry(trackId, attempt = 0) {
    if (trackId !== currentTrackId || !playing || isManualKill) return;
    if (ipcClient && !ipcClient.destroyed) return;

    const socket = net.connect({ path: IPC_PATH });

    socket.once("connect", () => {
      if (trackId !== currentTrackId || !playing || isManualKill) {
        try {
          socket.destroy();
        } catch {}
          return;
      }

      ipcClient = socket;

      ipcClient.on("error", () => {});
      ipcClient.on("close", () => {
        if (ipcClient === socket) {
          ipcClient = null;
        }
      });

      applyRuntimeSettings();
    });

    socket.once("error", () => {
      try {
        socket.destroy();
      } catch {}

      if (trackId !== currentTrackId || !playing || isManualKill) return;
      if (attempt >= 30) return;

      setTimeout(() => {
        connectIpcWithRetry(trackId, attempt + 1);
      }, 100);
    });
  }

  function updatePlaylistUI() {
    safeCall(ui?.setPlaylist, playlist, index);
    safeCall(ui?.setVolumeState, currentVolume, loopState, shuffleState, eqMode);
    scheduleRender();
  }

  function setVolume(val) {
    const num = Number(val);
    if (!Number.isFinite(num)) return currentVolume;

    currentVolume = Math.max(0, Math.min(100, Math.round(num)));
    sendIpcCommand(["set_property", "volume", currentVolume]);
    updatePlaylistUI();
    return currentVolume;
  }

  function toggleLoop() {
    loopState = !loopState;
    sendIpcCommand(["set_property", "loop-file", loopState ? "inf" : "no"]);
    updatePlaylistUI();
    return loopState;
  }

  function toggleShuffle() {
    if (!playlist.length) return shuffleState;

    shuffleState = !shuffleState;
    const currentTrack = playlist[index];

    if (shuffleState) {
      for (let i = playlist.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [playlist[i], playlist[j]] = [playlist[j], playlist[i]];
      }
      index = playlist.findIndex((t) => t.path === currentTrack.path);
      if (index === -1) index = 0;
    } else {
      playlist = [...originalPlaylist];
      index = playlist.findIndex((t) => t.path === currentTrack.path);
      if (index === -1) index = 0;
    }

    updatePlaylistUI();
    return shuffleState;
  }

  function cycleEQ() {
    eqIndex = (eqIndex + 1) % EQ_PRESETS.length;
    eqMode = EQ_PRESETS[eqIndex];
    applyEQ();
    updatePlaylistUI();
    return eqMode;
  }

  function buildBrailleAsciiFromRaw(raw, width, height) {
    let asciiResult = "";

    const dotValues = [
      [0x01, 0x08],
      [0x02, 0x10],
      [0x04, 0x20],
      [0x40, 0x80]
    ];

    for (let y = 0; y < height; y += 4) {
      for (let x = 0; x < width; x += 2) {
        let brailleCode = 0;
        let rSum = 0;
        let gSum = 0;
        let bSum = 0;
        let count = 0;

        for (let dy = 0; dy < 4; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const py = y + dy;
            const px = x + dx;

            if (py < height && px < width) {
              const idx = (py * width + px) * 3;
              const r = raw[idx];
              const g = raw[idx + 1];
              const b = raw[idx + 2];

              rSum += r;
              gSum += g;
              bSum += b;
              count++;

              const brightness = 0.2126 * r + 0.7152 * g + 0.0722 * b;
              if (brightness > 45) {
                brailleCode |= dotValues[dy][dx];
              }
            }
          }
        }

        const rAvg = count > 0 ? Math.round(rSum / count) : 0;
        const gAvg = count > 0 ? Math.round(gSum / count) : 0;
        const bAvg = count > 0 ? Math.round(bSum / count) : 0;

        const finalChar = String.fromCharCode(0x2800 + brailleCode);
        asciiResult += `\x1b[38;2;${rAvg};${gAvg};${bAvg}m${finalChar}\x1b[0m`;
      }
      asciiResult += "\n";
    }

    return asciiResult;
  }

  function fetchBufferFromUrl(urlStr, redirectCount = 0) {
    return new Promise((resolve) => {
      if (redirectCount > 5) {
        resolve(null);
        return;
      }

      let parsed;
      try {
        parsed = new URL(urlStr);
      } catch {
        resolve(null);
        return;
      }

      const client = parsed.protocol === "http:" ? http : https;
      let settled = false;

      const done = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      const req = client.get(urlStr, (res) => {
        const status = res.statusCode || 0;

        if (status >= 300 && status < 400 && res.headers.location) {
          const nextUrl = new URL(res.headers.location, urlStr).toString();
          res.resume();
          done(fetchBufferFromUrl(nextUrl, redirectCount + 1));
          return;
        }

        if (status !== 200) {
          res.resume();
          done(null);
          return;
        }

        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => done(Buffer.concat(chunks)));
      });

      req.on("error", () => done(null));
      req.setTimeout(8000, () => {
        try {
          req.destroy();
        } catch {}
        done(null);
      });
    });
  }

  async function normalizeImageBuffer(imageBuffer) {
    if (!imageBuffer) return null;
    return Buffer.isBuffer(imageBuffer) ? imageBuffer : Buffer.from(imageBuffer);
  }

  async function imageBufferToAscii(imageBuffer, baseKey, targetBoxSize) {
    const normalized = await normalizeImageBuffer(imageBuffer);
    if (!normalized) return null;
    
    const boxSize = targetBoxSize || safeCall(ui?.getAlbumBoxSize) || { width: 22, height: 11 };
    const uniqueCacheKey = `${baseKey}_w${boxSize.width}_h${boxSize.height}`;
    
    if (artCache.has(uniqueCacheKey)) {
      return artCache.get(uniqueCacheKey);
    }

    const targetWidth = boxSize.width * 2;
    const targetHeight = boxSize.height * 4;

    const { data, info } = await sharp(normalized)
      .resize(targetWidth, targetHeight, { fit: "contain" }) 
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const ascii = buildBrailleAsciiFromRaw(data, info.width, info.height);
    artCache.set(uniqueCacheKey, ascii);
    return ascii;
  }

  async function updateAlbumArtMetadata(track, myTrackId) {
    const defaultArt = [
      "    \\|/          (__)  ",
      "        `\\------(oo) ",
      "          ||    (__)  ",
      "          ||w--||     \\|/",
      "       \\|/             "
    ].join("\n");

    if (!track?.path) {
      if (myTrackId === currentTrackId) {
        currentImageBuffer = null;
        safeCall(ui?.setFileInfo, "Unknown", "Unknown");
        safeCall(ui?.setAlbumArt, defaultArt, "Art Not Available", "2026");
        scheduleRender();
      }
      return;
    }

    const currentBoxSize = safeCall(ui?.getAlbumBoxSize) || { width: 22, height: 11 };
    const isRemote = /^https?:\/\//i.test(track.path);
    const isYoutube = track.source === "youtube" || /youtube\.com|youtu\.be/i.test(track.webpage_url || track.path || "");

    if (isYoutube || isRemote) {
      if (myTrackId !== currentTrackId) return;

      currentAlbumName = track.name || "YouTube Stream";
      currentAlbumYear = "2026";

      safeCall(ui?.setFileInfo, isYoutube ? "YouTube" : "WEB Stream", "Stream");

      const thumbUrl = track.thumbnail || null;
      if (!thumbUrl) {
        currentImageBuffer = null;
        safeCall(ui?.setAlbumArt, defaultArt, currentAlbumName, currentAlbumYear);
        scheduleRender();
        return;
      }

      const baseKey = thumbUrl;
      const uniqueCacheKey = `${baseKey}_w${currentBoxSize.width}_h${currentBoxSize.height}`;
      
      if (artCache.has(uniqueCacheKey)) {
        safeCall(ui?.setAlbumArt, artCache.get(uniqueCacheKey), currentAlbumName, currentAlbumYear);
        scheduleRender();
        return;
      }

      try {
        const thumbBuffer = await fetchBufferFromUrl(thumbUrl);
        if (myTrackId !== currentTrackId) return;

        if (thumbBuffer) {
          currentImageBuffer = thumbBuffer;
          const ascii = await imageBufferToAscii(thumbBuffer, baseKey, currentBoxSize);
          if (myTrackId !== currentTrackId) return;

          if (ascii) {
            safeCall(ui?.setAlbumArt, ascii, currentAlbumName, currentAlbumYear);
          } else {
            safeCall(ui?.setAlbumArt, defaultArt, currentAlbumName, currentAlbumYear);
          }
        } else {
          currentImageBuffer = null;
          safeCall(ui?.setAlbumArt, defaultArt, currentAlbumName, currentAlbumYear);
        }
      } catch {
        if (myTrackId === currentTrackId) {
          currentImageBuffer = null;
          safeCall(ui?.setAlbumArt, defaultArt, currentAlbumName, currentAlbumYear);
        }
      }

      scheduleRender();
      return;
    }

    currentAlbumName = "Art Not Available";
    currentAlbumYear = "2026";

    try {
      const metadata = await getMetadata(track.path);

      if (myTrackId !== currentTrackId) return;

      if (metadata?.common?.album) currentAlbumName = metadata.common.album;
      if (metadata?.common?.year) currentAlbumYear = String(metadata.common.year);
      if (metadata?.common?.artist) track.artist = metadata.common.artist;

      if (metadata?.format?.duration && Number.isFinite(metadata.format.duration)) {
        track.duration = Math.max(1, Math.round(metadata.format.duration));
      }

      const codec = metadata?.container || "MPEG Audio";
      const bitrate = metadata?.format?.bitrate
        ? `${Math.max(1, Math.round(metadata.format.bitrate / 1000))}kbps`
        : "320kbps";

      safeCall(ui?.setFileInfo, codec, bitrate);

      const picture = metadata?.common?.picture?.[0];

      if (picture?.data) {
        currentImageBuffer = picture.data;
        const baseKey = track.path;
        const uniqueCacheKey = `${baseKey}_w${currentBoxSize.width}_h${currentBoxSize.height}`;
        
        if (artCache.has(uniqueCacheKey)) {
          safeCall(ui?.setAlbumArt, artCache.get(uniqueCacheKey), currentAlbumName, currentAlbumYear);
          scheduleRender();
          return;
        }

        const ascii = await imageBufferToAscii(picture.data, baseKey, currentBoxSize);
        if (myTrackId !== currentTrackId) return;

        if (ascii) {
          safeCall(ui?.setAlbumArt, ascii, currentAlbumName, currentAlbumYear);
        } else {
          safeCall(ui?.setAlbumArt, defaultArt, currentAlbumName, currentAlbumYear);
        }
      } else {
        currentImageBuffer = null;
        safeCall(ui?.setAlbumArt, defaultArt, currentAlbumName, currentAlbumYear);
      }
    } catch {
      if (myTrackId === currentTrackId) {
        currentImageBuffer = null;
        safeCall(ui?.setFileInfo, "Unknown", "Unknown");
        safeCall(ui?.setAlbumArt, defaultArt, currentAlbumName, currentAlbumYear);
      }
    }

    if (myTrackId === currentTrackId) scheduleRender();
  }

  function getNextIndexForAutoAdvance() {
    if (!playlist.length) return -1;

    if (shuffleState && playlist.length > 1) {
      let nextIndex = index;
      while (nextIndex === index) {
        nextIndex = Math.floor(Math.random() * playlist.length);
      }
      return nextIndex;
    }

    if (index + 1 < playlist.length) return index + 1;
    return loopState ? 0 : -1;
  }

  function getPrevIndex() {
    if (!playlist.length) return -1;

    if (shuffleState && playlist.length > 1) {
      let prevIndex = index;
      while (prevIndex === index) {
        prevIndex = Math.floor(Math.random() * playlist.length);
      }
      return prevIndex;
    }

    if (index - 1 >= 0) return index - 1;
    return loopState ? playlist.length - 1 : 0;
  }

  function play() {
    const track = getTrack();

    if (!track) {
      safeCall(ui?.appendLog, "{red-fg}No music found.{/red-fg} Add files or URLs.");
      safeCall(ui?.setAlbumArt, DEFAULT_ART, "Art Not Available", "2026");
      scheduleRender();
      return;
    }

    cleanup();
    isManualKill = false;
    currentTrackId++;
    const myTrackId = currentTrackId;

    try {
      playing = true;
      isPaused = false;
      startedAt = Date.now();
      lastResumeAt = Date.now();
      totalElapsedTime = 0;

      const isUrl = /^https?:\/\//i.test(track.path);

      const mpvArgs = [
        "--no-video",
        "--no-terminal",
        "--really-quiet",
        "--keep-open=no",
        "--ytdl=yes",
        `--script-opts=ytdl_hook-ytdl_path=${YTDLP_PATH}`,
        "--ytdl-format=bestaudio/best",
        `--input-ipc-server=${IPC_PATH}`,
        `--volume=${currentVolume}`,
        `--loop-file=${loopState ? "inf" : "no"}`,
        track.path
      ];

      audioProcess = spawn("mpv", mpvArgs, {
        detached: false,
        stdio: ["ignore", "pipe", "pipe"]
      });

      audioProcess.stdout?.on("data", () => {});

      audioProcess.stderr?.on("data", (data) => {
        const text = String(data || "").trim();
        if (!text) return;

        if (/error|fatal|failed/i.test(text)) {
          safeCall(ui?.appendLog, `{red-fg}mpv:{/red-fg} ${text.slice(0, 140)}`);
        }
      });

      audioProcess.on("exit", (code) => {
        if (myTrackId !== currentTrackId) return;

        if (isManualKill) {
          playing = false;
          isPaused = false;
          startedAt = 0;
          totalElapsedTime = 0;
          lastResumeAt = 0;
          scheduleRender();
          return;
        }

        if (code === 0) {
          if (loopState) {
            play();
          } else {
            next();
          }
        } else {
          playing = false;
          isPaused = false;
          safeCall(ui?.appendLog, "{yellow-fg}Playback ended with error.{/yellow-fg}");
          scheduleRender();
        }
      });

      audioProcess.on("error", (error) => {
        if (myTrackId !== currentTrackId) return;
        playing = false;
        isPaused = false;
        safeCall(ui?.appendLog, `{red-fg}Failed to launch mpv:{/red-fg} ${error?.message || error}`);
        scheduleRender();
      });

      safeCall(ui?.setFileInfo, isUrl ? "Streaming" : "MPEG Layer 3", isUrl ? "Network" : "320kbps");
      safeCall(ui?.setPlaylist, playlist, index);
      updateAlbumArtMetadata(track, myTrackId);

      connectIpcWithRetry(myTrackId);
      updatePlaylistUI();
    } catch (error) {
      playing = false;
      isPaused = false;
      safeCall(ui?.appendLog, `{red-fg}Playback failed:{/red-fg} ${error?.message || error}`);
      scheduleRender();
    }
  }

  function toggle() {
    if (!playing) {
      play();
      return;
    }

    if (!isPaused) {
      totalElapsedTime += Date.now() - lastResumeAt;
      isPaused = true;
      sendIpcCommand(["set_property", "pause", true]);
      safeCall(ui?.appendLog, "{yellow-fg}Playback Paused{/yellow-fg}");
    } else {
      lastResumeAt = Date.now();
      isPaused = false;
      sendIpcCommand(["set_property", "pause", false]);
      safeCall(ui?.clearLog);
    }

    updatePlaylistUI();
  }

  function stop() {
    isManualKill = true;
    cleanup();
    safeCall(ui?.clearVisual);
    safeCall(ui?.setPlaylist, playlist, index);
    scheduleRender();
  }

  function next() {
    if (!playlist.length) return;

    isManualKill = true;
    cleanup();

    index++;
    if (index >= playlist.length) index = 0;
    play();
  }

  function prev() {
    if (!playlist.length) return;

    isManualKill = true;
    cleanup();

    index--;
    if (index < 0) index = playlist.length - 1;
    play();
  }

  function isPlaying() {
    return playing && !isPaused;
  }

  function getCurrentIndex() {
    return index;
  }

  function getTracks() {
    return playlist;
  }

  function getVolume() {
    return currentVolume;
  }

  function isLoop() {
    return loopState;
  }

  function isShuffle() {
    return shuffleState;
  }

  function getEQ() {
    return eqMode;
  }

  function getCurrentTime() {
    if (!playing) return 0;
    if (isPaused) return Math.floor(totalElapsedTime / 1000);

    const currentSegment = Date.now() - lastResumeAt;
    return Math.floor((totalElapsedTime + currentSegment) / 1000);
  }

  function getDuration() {
    const track = getTrack();
    return track && track.duration ? track.duration : DEFAULT_DURATION;
  }

  syncOriginalPlaylist();
  safeCall(loadTracks);

  safeCall(ui?.onResize, async () => {
    if (currentImageBuffer && playing) {
      const currentBoxSize = safeCall(ui?.getAlbumBoxSize) || { width: 22, height: 11 };
      const baseKey = getTrack()?.path || "resize";
      
      const resizedAscii = await imageBufferToAscii(currentImageBuffer, baseKey, currentBoxSize);
      if (resizedAscii) {
        safeCall(ui?.setAlbumArt, resizedAscii, currentAlbumName, currentAlbumYear);
      }
    } else if (!currentImageBuffer && playing) {
      safeCall(ui?.setAlbumArt, DEFAULT_ART, currentAlbumName, currentAlbumYear);
    }
  });

  return {
    play,
    stop,
    toggle,
    next,
    prev,
    isPlaying,
    getTrack,
    getCurrentIndex,
    getTracks,
    getCurrentTime,
    getDuration,
    loadTracks,
    getVolume,
    isLoop,
    isShuffle,
    getEQ,
    setVolume,
    toggleLoop,
    toggleShuffle,
    cycleEQ,
    addTrack
  };
}
