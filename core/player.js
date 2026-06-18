import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import http from "http";
import https from "https";
import net from "net";
import * as mm from "music-metadata";
import sharp from "sharp";

let MUSIC_DIR = path.resolve("./music");
const SUPPORTED_EXTENSIONS = new Set([".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac"]);
const DEFAULT_DURATION = 180;
const DEFAULT_VOLUME = 80;
const YTDLP_PATH = process.env.YTDLP_PATH || "/usr/local/bin/yt-dlp";

const DEFAULT_ART = [
  "    \\|/          (__)  ",
  "          `\\------(oo) ",
  "               ||    (__)  ",
  "               ||w--||     \\|/",
  "       \\|/             "
].join("\n");

export function createPlayer({ playlist: initialPlaylist = [], ui }) {
  let playlist = Array.isArray(initialPlaylist) ? [...initialPlaylist] : [];
  let originalPlaylist = [...playlist];

  let index = 0;
  let audioProcess = null;
  let ipcClient = null;
  let tickerInterval = null;

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

  let currentImageBuffer = null;
  let currentAlbumName = "Album Not Available";
  let currentAlbumYear = "----";
  let currentTrackNumber = "-";

  let lastTrackPath = "";
  let lastRenderedTime = -1;

  const listeners = {};
  function on(event, callback) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(callback);
  }

  function emit(event, data) {
    if (listeners[event]) {
      listeners[event].forEach((cb) => {
        try {
          cb(data);
        } catch {}
      });
    }
  }

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

  function normalizeYearFromMetadata(metadata) {
    const year = metadata?.common?.year;
    if (Number.isFinite(year)) {
      return String(year);
    }

    const date = metadata?.common?.date;
    if (typeof date === "string" && date.length >= 4) {
      const match = date.match(/^(\d{4})/);
      if (match) return match[1];
    }

    return "----";
  }

  function normalizeTrackNumberFromMetadata(metadata) {
    const rawTrackNo = metadata?.common?.track?.no;

    if (rawTrackNo === null || rawTrackNo === undefined || rawTrackNo === "") {
      return "-";
    }

    const asString = String(rawTrackNo).trim();
    const match = asString.match(/^(\d+)/);
    return match ? match[1] : asString;
  }

  function syncTrackMetadata(track, metadata) {
    if (!track || !metadata) return;

    if (metadata?.common?.album) {
      track.album = metadata.common.album;
    }

    track.year = normalizeYearFromMetadata(metadata);
    track.trackNumber = normalizeTrackNumberFromMetadata(metadata);

    if (metadata?.common?.artist) {
      track.artist = metadata.common.artist;
    }

    if (metadata?.format?.duration && Number.isFinite(metadata.format.duration)) {
      track.duration = Math.max(1, Math.round(metadata.format.duration));
    }
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
          artist: metadata?.common?.artist || "Local Track",
          album: metadata?.common?.album || "Unknown Album",
          year: normalizeYearFromMetadata(metadata),
          trackNumber: normalizeTrackNumberFromMetadata(metadata)
        });
      }

      localTracks.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      );

      playlist = mergeTrackLists([], localTracks);
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
    if (exists) return;

    if (playlist.length > 0) {
      playlist.splice(index + 1, 0, trackObj);
      originalPlaylist.splice(index + 1, 0, trackObj);
    } else {
      playlist.push(trackObj);
      originalPlaylist.push(trackObj);
    }

    safeCall(ui?.setPlaylist, playlist, index);
    scheduleRender();
  }

  function stopProgressTicker() {
    if (tickerInterval) {
      clearInterval(tickerInterval);
      tickerInterval = null;
    }
  }

  function getCurrentTime() {
    if (!playing) return 0;
    let elapsed = totalElapsedTime;
    if (!isPaused && lastResumeAt > 0) {
      elapsed += Date.now() - lastResumeAt;
    }
    return Math.round(elapsed / 1000);
  }

  function getDuration() {
    const track = getTrack();
    return track ? track.duration || DEFAULT_DURATION : DEFAULT_DURATION;
  }

  function pushNowPlaying(forceMetadata = false) {
    const currentTrack = getTrack();
    if (!currentTrack || !playing) return;

    const curTime = getCurrentTime();
    const totalDur = getDuration();
    const percent = totalDur > 0 ? Math.round((curTime / totalDur) * 100) : 0;

    const isNewTrackArriving = currentTrack.path !== lastTrackPath;

    if (!forceMetadata && !isNewTrackArriving && curTime === lastRenderedTime) {
      return;
    }

    lastRenderedTime = curTime;
    lastTrackPath = currentTrack.path;

    const trackGenre = currentTrack.source === "youtube" ? "YouTube Stream" : (currentTrack.genre || "Unknown");

    safeCall(
      ui?.setNowPlaying,
      currentTrack.name,
      curTime,
      totalDur,
      percent,
      currentAlbumName,
      currentAlbumYear,
      currentTrackNumber,
      currentTrack.artist || "Unknown Artist",
      trackGenre
    );

    scheduleRender();
  }

  function startProgressTicker() {
    stopProgressTicker();
    tickerInterval = setInterval(() => {
      if (playing && !isPaused) {
        pushNowPlaying(false);
      }
    }, 250);
  }

  function cleanup() {
    playing = false;
    isPaused = false;
    currentImageBuffer = null;
    lastTrackPath = "";
    lastRenderedTime = -1;
    stopProgressTicker();

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
        proc.stdout?.removeAllListeners?.("data");
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

      ipcClient.on("data", (data) => {
        const lines = data.toString().split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.event === "playback-restart" || (msg.event === "property-change" && msg.name === "pause" && msg.data === false)) {
              if (playing && !isPaused && !tickerInterval) {
                lastResumeAt = Date.now();
                startProgressTicker();
              }
            }
          } catch {}
        }
      });

      sendIpcCommand(["observe_property", 1, "pause"]);
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

    if (playing) {
      pushNowPlaying(true);
    }

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
    if (!track?.path) {
      if (myTrackId === currentTrackId) {
        currentImageBuffer = null;
        currentAlbumName = "Album Not Available";
        currentAlbumYear = "----";
        currentTrackNumber = "-";
        safeCall(ui?.setFileInfo, "Unknown", "Unknown");
        safeCall(ui?.setAlbumArt, DEFAULT_ART, currentAlbumName, currentAlbumYear);
        pushNowPlaying(true);
        updatePlaylistUI();
        emit("trackChange", track);
      }
      return;
    }

    const currentBoxSize = safeCall(ui?.getAlbumBoxSize) || { width: 22, height: 11 };
    const isRemote = /^https?:\/\//i.test(track.path);
    const isYoutube = track.source === "youtube" || /youtube\.com|youtu\.be/i.test(track.webpage_url || track.path || "");

    if (isYoutube || isRemote) {
      if (myTrackId !== currentTrackId) return;

      currentAlbumName = track.album || "Network Album";
      currentAlbumYear = track.year || "2026";
      currentTrackNumber = "-";

      safeCall(ui?.setFileInfo, isYoutube ? "YouTube/Opus" : "WEB Stream", "160 kbps");

      const thumbUrl = track.thumbnail || null;
      if (!thumbUrl) {
        currentImageBuffer = null;
        safeCall(ui?.setAlbumArt, DEFAULT_ART, currentAlbumName, currentAlbumYear);
        pushNowPlaying(true);
        updatePlaylistUI();
        emit("trackChange", track);
        return;
      }

      const baseKey = thumbUrl;
      const uniqueCacheKey = `${baseKey}_w${currentBoxSize.width}_h${currentBoxSize.height}`;

      if (artCache.has(uniqueCacheKey)) {
        safeCall(ui?.setAlbumArt, artCache.get(uniqueCacheKey), currentAlbumName, currentAlbumYear);
        pushNowPlaying(true);
        updatePlaylistUI();
        emit("trackChange", track);
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
            safeCall(ui?.setAlbumArt, DEFAULT_ART, currentAlbumName, currentAlbumYear);
          }
        } else {
          currentImageBuffer = null;
          safeCall(ui?.setAlbumArt, DEFAULT_ART, currentAlbumName, currentAlbumYear);
        }
      } catch {
        if (myTrackId === currentTrackId) {
          currentImageBuffer = null;
          safeCall(ui?.setAlbumArt, DEFAULT_ART, currentAlbumName, currentAlbumYear);
        }
      }

      pushNowPlaying(true);
      updatePlaylistUI();
      emit("trackChange", track);
      return;
    }

    currentAlbumName = track.album || "Unknown Album";
    currentAlbumYear = track.year || "----";
    currentTrackNumber = track.trackNumber || "-";

    try {
      const metadata = await getMetadata(track.path);

      if (myTrackId !== currentTrackId) return;

      syncTrackMetadata(track, metadata);

      currentAlbumName = track.album || "Unknown Album";
      currentAlbumYear = track.year || "----";
      currentTrackNumber = track.trackNumber || "-";

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
          pushNowPlaying(true);
          updatePlaylistUI();
          emit("trackChange", track);
          return;
        }

        const ascii = await imageBufferToAscii(picture.data, baseKey, currentBoxSize);
        if (myTrackId !== currentTrackId) return;

        if (ascii) {
          safeCall(ui?.setAlbumArt, ascii, currentAlbumName, currentAlbumYear);
        } else {
          safeCall(ui?.setAlbumArt, DEFAULT_ART, currentAlbumName, currentAlbumYear);
        }
      } else {
        currentImageBuffer = null;
        safeCall(ui?.setAlbumArt, DEFAULT_ART, currentAlbumName, currentAlbumYear);
      }
    } catch {
      if (myTrackId === currentTrackId) {
        currentImageBuffer = null;
        safeCall(ui?.setFileInfo, "Unknown", "Unknown");
        safeCall(ui?.setAlbumArt, DEFAULT_ART, currentAlbumName, currentAlbumYear);
      }
    }

    if (myTrackId === currentTrackId) {
      pushNowPlaying(true);
      updatePlaylistUI();
      emit("trackChange", track);
    }
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

  function play() {
    ensureIndex();
    const track = playlist[index];

    if (!track) {
      safeCall(ui?.appendLog, "{red-fg}No music found.{/red-fg} Add files or URLs.");
      safeCall(ui?.setAlbumArt, DEFAULT_ART, "Album Not Available", "----");
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

        stopProgressTicker();

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
            const nextIdx = getNextIndexForAutoAdvance();
            if (nextIdx !== -1) {
              index = nextIdx;
              play();
            } else {
              playing = false;
              isPaused = false;
              scheduleRender();
            }
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
        stopProgressTicker();
        safeCall(ui?.appendLog, `{red-fg}Failed to launch mpv:{/red-fg} ${error?.message || error}`);
        scheduleRender();
      });

      if (track.source === "youtube" || isUrl) {
        safeCall(ui?.setFileInfo, "YouTube/Opus", "160 kbps");
        currentAlbumName = track.album || "YouTube Single";
        currentAlbumYear = track.year || "2026";
        currentTrackNumber = "-";
      } else {
        safeCall(ui?.setFileInfo, "MPEG Layer 3", "320kbps");
        currentAlbumName = track.album || "Unknown Album";
        currentAlbumYear = track.year || "----";
        currentTrackNumber = track.trackNumber || "-";
        
        startProgressTicker();
      }

      updateAlbumArtMetadata(track, myTrackId);
      connectIpcWithRetry(myTrackId);
      updatePlaylistUI();
      emit("trackChange", track); 

    } catch (error) {
      playing = false;
      isPaused = false;
      stopProgressTicker();
      safeCall(ui?.appendLog, `{red-fg}Playback failed:{/red-fg} ${error?.message || error}`);
      scheduleRender();
    }
  }

  async function getLinkInfo(url) {
    if (!url) return null;
    try {
      const child = spawn(YTDLP_PATH, [
        "--dump-json",
        "--skip-download",
        "--no-playlist",
        "--no-check-certificates",
        url
      ]);

      let rawData = "";
      child.stdout.on("data", (chunk) => { rawData += chunk; });

      await new Promise((resolve) => {
        child.on("close", () => resolve());
        setTimeout(() => { try { child.kill(); } catch {} resolve(); }, 8000);
      });

      if (!rawData) return null;
      const json = JSON.parse(rawData);

      let year = "2026";
      if (typeof json.upload_date === "string" && json.upload_date.length >= 4) {
        year = json.upload_date.substring(0, 4);
      } else if (json.release_year) {
        year = String(json.release_year);
      }

      return {
        title: json.title || "YouTube Audio Stream",
        duration: json.duration ? Math.round(json.duration) : DEFAULT_DURATION,
        thumbnail: json.thumbnail || null,
        artist: json.uploader || "Remote Stream",
        album: json.album || (json.uploader ? `${json.uploader} Single` : "Network Album"),
        year: year
      };
    } catch {
      return null;
    }
  }

  async function playYoutube(url) {
    if (!url) return;

    safeCall(ui?.appendLog, "{yellow-fg}Obteniendo información del stream...{/yellow-fg}");
    const info = await getLinkInfo(url);

    const remoteTrack = {
      name: info?.title || "YouTube Audio Stream",
      path: url,
      duration: info?.duration || DEFAULT_DURATION,
      artist: info?.artist || "Remote Stream",
      album: info?.album || "Network Album",
      year: info?.year || "2026",
      trackNumber: "-",
      source: "youtube",
      thumbnail: info?.thumbnail || null
    };

    const targetIndex = playlist.findIndex((t) => t.path === url);
    if (targetIndex !== -1) {
      playlist[targetIndex] = remoteTrack;
      index = targetIndex;
    } else {
      playlist.push(remoteTrack);
      originalPlaylist.push(remoteTrack);
      index = playlist.length - 1;
    }

    safeCall(ui?.setPlaylist, playlist, index);
    play();
  }

  function downloadYoutubeAudio(url, quality = "bestaudio", onProgress, onDone) {
    if (!url) return;

    safeCall(ui?.appendLog, "{yellow-fg}Iniciando la extracción del audio local...{/yellow-fg}");

    const args = [
      "--extract-audio",
      "--audio-format", "mp3",
      "--audio-quality", quality === "bestaudio" ? "0" : "5",
      "-o", path.join(MUSIC_DIR, "%(title)s.%(ext)s"),
      "--no-playlist",
      "--no-check-certificates",
      url
    ];

    const child = spawn(YTDLP_PATH, args);

    child.stdout.on("data", (data) => {
      const output = data.toString();
      if (typeof onProgress === "function") {
        const match = output.match(/\[download\]\s+(\d+\.\d+)%/);
        if (match) onProgress(match[1]);
      }
    });

    child.on("close", (code) => {
      if (code === 0) {
        loadTracks().then(() => {
          if (typeof onDone === "function") onDone(true);
        });
      } else {
        if (typeof onDone === "function") onDone(false);
      }
    });
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
      stopProgressTicker();
      safeCall(ui?.appendLog, "{yellow-fg}Playback Paused{/yellow-fg}");
    } else {
      lastResumeAt = Date.now();
      isPaused = false;
      sendIpcCommand(["set_property", "pause", false]);
      startProgressTicker();
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

  function setMusicDir(newPath) {
    MUSIC_DIR = path.resolve(newPath);
    index = 0;
    return loadTracks();
  }

  function setIndex(newIndex) {
    if (newIndex >= 0 && newIndex < playlist.length) {
      index = newIndex;
    }
  }

  function isPlaying() {
    return playing && !isPaused;
  }

  function getCurrentIndex() {
    return index;
  }

  function getCurrentTrack() {
    return getTrack();
  }

  function getTracks() {
    return playlist;
  }

  function getVolume() {
    return currentVolume;
  }

  function getLoop() {
    return loopState;
  }

  function getShuffle() {
    return shuffleState;
  }

  function getEQMode() {
    return eqMode;
  }

  async function resizeAlbumArt() {
    if (!playing || !currentImageBuffer) return;
    const track = getTrack();
    if (!track) return;

    const currentBoxSize = safeCall(ui?.getAlbumBoxSize);
    if (!currentBoxSize) return;

    try {
      const ascii = await imageBufferToAscii(currentImageBuffer, track.path, currentBoxSize);
      if (ascii) {
        safeCall(ui?.setAlbumArt, ascii, currentAlbumName, currentAlbumYear);
        updatePlaylistUI();
      }
    } catch {}
  }

  return {
    on,
    loadTracks,
    addTrack,
    play,
    getLinkInfo,
    playYoutube,
    downloadYoutubeAudio,
    toggle,
    stop,
    next,
    prev,
    setVolume,
    toggleLoop,
    toggleShuffle,
    cycleEQ,
    setMusicDir,
    setIndex,
    isPlaying,
    getCurrentIndex,
    getCurrentTrack,
    getTracks,
    getVolume,
    getLoop,
    getShuffle,
    getEQMode,
    resizeAlbumArt
  };
}
