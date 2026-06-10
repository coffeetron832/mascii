import blessed from "blessed";
import fs from "fs";
import path from "path";
import { VERSION, CODENAME } from "./version.js";

// Matriz tipográfica (Altura: 5 celdas) para máxima legibilidad
const ASCII_DIGITS = {
  "0": [
    "▄███▄",
    "█▀  █",
    "█   █",
    "█▄  █",
    "▀███▀"
  ],
  "1": [
    " ▄█  ",
    "  █  ",
    "  █  ",
    "  █  ",
    "█████"
  ],
  "2": [
    "████▄",
    "    █",
    "▄███▀",
    "█    ",
    "█████"
  ],
  "3": [
    "████▄",
    "    █",
    " ███▄",
    "    █",
    "████▀"
  ],
  "4": [
    "█  █ ",
    "█  █ ",
    "█████",
    "   █ ",
    "   █ "
  ],
  "5": [
    "█████",
    "█    ",
    "████▄",
    "    █",
    "████▀"
  ],
  "6": [
    "▄███▄",
    "█    ",
    "████▄",
    "█   █",
    "▀███▀"
  ],
  "7": [
    "█████",
    "    █",
    "   █ ",
    "  █  ",
    " █    "
  ],
  "8": [
    "▄███▄",
    "█   █",
    " ▀██▀",
    "█   █",
    "▀███▀"
  ],
  "9": [
    "▄███▄",
    "█   █",
    "▀████",
    "    █",
    "▀███▀"
  ],
  ":": [
    " ▄ ",
    " ▀ ",
    "   ",
    " ▄ ",
    " ▀ "
  ],
  "/": [
    "    █",
    "   █ ",
    "  █  ",
    " █    ",
    "█    "
  ],
  " ": [
    "     ",
    "     ",
    "     ",
    "     ",
    "     "
  ],
  "-": [
    "     ",
    "     ",
    "█████",
    "     ",
    "     "
  ]
};

function textToBigAscii(text) {
  const lines = ["", "", "", "", ""];
  for (const char of text) {
    const glyph = ASCII_DIGITS[char] || ASCII_DIGITS[" "];
    lines[0] += glyph[0] + "  ";
    lines[1] += glyph[1] + "  ";
    lines[2] += glyph[2] + "  ";
    lines[3] += glyph[3] + "  ";
    lines[4] += glyph[4] + "  ";
  }
  return lines.join("\n");
}

function buildSplashArt() {
  const logoLines = [
    " ███▄ ▄███▓ ▄▄▄         ██████  ▄████▄   ██▓ ██▓",
    "▓██▒▀█▀ ██▒▒████▄     ▒██    ▒ ▒██▀ ▀█  ▓██▒▓██▒",
    "▓██    ▓██░▒██  ▀█▄   ░ ▓██▄   ▒▓█    ▄ ▒██▒▒██▒",
    "▒██    ▒██ ░██▄▄▄▄██   ▒   ██▒▒▓▓▄ ▄██▒░██░░██░",
    "▒██▒   ░██▒ ▓█   ▓██▒▒██████▒▒▒ ▓███▀ ░░██░░██░",
    "░ ▒░   ░  ░ ▒▒   ▓▒█░▒ ▒▓▒ ▒ ░░ ░▒ ▒  ░░▓  ░▓",
    "░  ░      ░  ▒   ▒▒ ░░ ░▒  ░ ░  ░  ▒    ▒ ░ ▒ ░",
    "░      ░     ░   ▒   ░  ░  ░  ░          ▒ ░ ▒ ░",
    "       ░         ░  ░      ░  ░ ░        ░   ░",
    "                              ░"
  ];

  const stripeTags = [
    "{green-bg}{black-fg}", "{yellow-bg}{black-fg}", "{green-bg}{black-fg}", "{yellow-bg}{black-fg}",
    "{green-bg}{black-fg}", "{yellow-bg}{black-fg}", "{green-bg}{black-fg}", "{yellow-bg}{black-fg}",
    "{green-bg}{black-fg}", "{yellow-bg}{black-fg}"
  ];

  const width = Math.max(...logoLines.map((line) => line.length));

  let art = "";
  for (let i = 0; i < logoLines.length; i++) {
    const paddedLine = logoLines[i].padEnd(width, " ");
    art += `${stripeTags[i]} ${paddedLine} {/}\n`;
  }

  return `\n${art}\n{yellow-fg}v${VERSION} "${CODENAME}"{/}\n`;
}

export function createUI() {
  const screen = blessed.screen({
    smartCSR: true,
    title: "MASCII Player",
    dockBorders: true
  });

  const splash = blessed.box({
    parent: screen,
    width: "100%",
    height: "100%",
    top: 0,
    left: 0,
    align: "center",
    valign: "middle",
    tags: true,
    border: { type: "none" },
    style: { fg: "white", bg: "black" },
    content: buildSplashArt()
  });

  const albumBox = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: "30%",
    height: "70%",
    label: " [ ALBUM ART ] ",
    border: { type: "line" },
    style: { border: { fg: "cyan" } },
    align: "center",
    valign: "middle",
    tags: true
  });

  const nowPlayingBox = blessed.box({
    parent: screen,
    top: 0,
    left: "30%",
    width: "70%",
    height: "70%",
    label: " [ NOW PLAYING ] ",
    border: { type: "line" },
    style: { border: { fg: "green" } },
    padding: { top: 1, left: 3, right: 3 },
    scrollable: false,
    tags: true
  });

  const playlistBox = blessed.box({
    parent: screen,
    top: "70%",
    left: 0,
    width: "60%",
    height: "30%",
    label: " [ TRACKLIST ] ",
    border: { type: "line" },
    style: { border: { fg: "yellow" } }
  });

  const interactiveList = blessed.list({
    parent: playlistBox,
    top: 0,
    left: 0,
    width: "100%-2",
    height: "100%-2",
    tags: true,
    keys: false,
    vi: false,
    scrollbar: {
      ch: "░",
      track: { bg: "black" },
      style: { fg: "yellow" }
    },
    style: {
      selected: { fg: "black", bg: "yellow", bold: true },
      item: { fg: "white" }
    }
  });

  const statusBox = blessed.box({
    parent: screen,
    top: "70%",
    left: "60%",
    width: "40%",
    height: "30%",
    label: " [ AUDIO CONFIG & CONTROLS ] ",
    border: { type: "line" },
    style: { border: { fg: "green" } },
    padding: { top: 1, left: 2, right: 2 },
    tags: true
  });

  let globalKeypressListener = null;
  let lastTimeStr = "";
  let cachedBigTime = "";
  let splashHidden = false;
  let resizeCallback = null;

  let isBrowsingFiles = false;
  let currentBrowseDir = process.cwd();
  let browseItemsRaw = [];
  let onFileSelectedCallback = null;
  let onFolderSelectedCallback = null;
  let cachedPlaylistData = null;

  screen.on("resize", () => {
    screen.realloc();
    albumBox.setContent("");
    screen.render();
    if (typeof resizeCallback === "function") {
      resizeCallback();
    }
  });

  function formatSeconds(sec = 0) {
    if (!isFinite(sec) || sec < 0) return "00:00";
    const minutes = Math.floor(sec / 60);
    const seconds = Math.floor(sec % 60);
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function showSplash() {
    splashHidden = false;
    splash.show();
    splash.setFront();
    screen.render();
  }

  function hideSplash() {
    if (splashHidden) return;
    splashHidden = true;
    splash.hide();
    screen.render();
  }

  function updateDirectoryBrowser() {
    playlistBox.setLabel(` [ BROWSER: ${path.basename(currentBrowseDir) || currentBrowseDir} ] `);
    interactiveList.clearItems();

    try {
      const files = fs.readdirSync(currentBrowseDir);
      const directories = [];
      const audioFiles = [];

      if (currentBrowseDir !== path.parse(currentBrowseDir).root) {
        directories.push({ name: "📁 .. (Go Up Directory)", isDir: true, path: path.dirname(currentBrowseDir) });
      }

      files.forEach(file => {
        try {
          const fullPath = path.join(currentBrowseDir, file);
          const stat = fs.statSync(fullPath);
          
          if (stat.isDirectory()) {
            directories.push({ name: `📁 ${file}/`, isDir: true, path: fullPath });
          } else {
            const ext = path.extname(file).toLowerCase();
            if ([".mp3", ".wav", ".ogg", ".flac", ".m4a"].includes(ext)) {
              audioFiles.push({ name: `🎵 ${file}`, isDir: false, path: fullPath });
            }
          }
        } catch (_) {}
      });

      browseItemsRaw = [...directories, ...audioFiles];
      
      if (browseItemsRaw.length === 0) {
        interactiveList.addItem("{italic}Empty (No audio/folders found){/}");
      } else {
        browseItemsRaw.forEach(item => {
          interactiveList.addItem(item.isDir ? `{cyan-fg}${item.name}{/}` : item.name);
        });
      }
    } catch (err) {
      playlistBox.setLabel(" [ BROWSER ERROR ] ");
      interactiveList.addItem(`{red-fg}Error reading path.{/}`);
      browseItemsRaw = [];
    }

    interactiveList.select(0);
    screen.render();
  }

  function renderCachedPlaylist() {
    playlistBox.setLabel(" [ TRACKLIST ] ");
    interactiveList.clearItems();
    if (cachedPlaylistData && Array.isArray(cachedPlaylistData.playlist)) {
      cachedPlaylistData.playlist.forEach((track, idx) => {
        if (idx === cachedPlaylistData.currentIndex) {
          interactiveList.addItem(`{yellow-fg}▶ * ${track.name}{/}`);
        } else {
          interactiveList.addItem(`    ${track.name}`);
        }
      });
      interactiveList.select(cachedPlaylistData.currentIndex);
    }
    screen.render();
  }

  return {
    screen,
    showSplash,
    hideSplash,

    getSize: () => ({ width: screen.width, height: screen.height }),

    getAlbumBoxSize: () => {
      const width = albumBox.width || Math.floor(screen.width * 0.3);
      const height = albumBox.height || Math.floor(screen.height * 0.7);
      return { width: Math.max(10, width - 4), height: Math.max(5, height - 4) };
    },

    onResize: (callback) => { resizeCallback = callback; },

    onFileSelected: (callback) => {
      onFileSelectedCallback = callback;
    },

    onFolderSelected: (callback) => {
      onFolderSelectedCallback = callback;
    },

    setMusicDir: (dirPath) => {
      if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
        currentBrowseDir = dirPath;
        
        const folderName = path.basename(dirPath) || dirPath;
        nowPlayingBox.setLabel(` [ LOG: Tracklist loaded from 📁 ${folderName} ] `);

        if (isBrowsingFiles) {
          updateDirectoryBrowser();
        } else {
          screen.render();
        }
      }
    },

    setNowPlaying: (trackName, current, total, percent) => {
      try {
        const currentBoxWidth = nowPlayingBox.width || Math.floor(screen.width * 0.7);
        const currentBoxHeight = nowPlayingBox.height || Math.floor(screen.height * 0.7);
        const barWidth = Math.max(15, currentBoxWidth - 20);

        let safePercent = parseInt(percent, 10);
        if (Number.isNaN(safePercent) || safePercent < 0) safePercent = 0;
        if (safePercent > 100) safePercent = 100;

        const barLength = Math.floor(barWidth * (safePercent / 100)) || 0;
        const safeBarLength = Math.max(0, Math.min(barWidth, barLength));
        const remainingLength = Math.max(0, barWidth - safeBarLength);
        const progressBar = "█".repeat(safeBarLength) + "░".repeat(remainingLength);

        const currentTimeStr = formatSeconds(current);
        const totalTimeStr = formatSeconds(total);
        const timeDisplayString = `${currentTimeStr} / ${totalTimeStr}`;
        const canRenderBigASCII = currentBoxWidth > 58 && currentBoxHeight > 14;

        let timeRenderResult = "";
        if (canRenderBigASCII) {
          if (timeDisplayString !== lastTimeStr) {
            lastTimeStr = timeDisplayString;
            cachedBigTime = textToBigAscii(timeDisplayString);
          }
          timeRenderResult = `{cyan-fg}${cachedBigTime}{/}`;
        } else {
          timeRenderResult = `  {cyan-fg}{bold}▶ ${timeDisplayString}{/}`;
        }

        const maxTextLength = Math.max(20, currentBoxWidth - 15);
        let displayTrackName = String(trackName || "Unknown Track");
        if (displayTrackName.length > maxTextLength) {
          displayTrackName = displayTrackName.slice(0, maxTextLength - 3) + "...";
        }

        nowPlayingBox.setContent(
          `{green-fg}{bold}🎵 CURRENT TRACK{/}\n` +
          `  ${displayTrackName}\n\n` +
          `{green-fg}{bold}📊 PROGRESS ({/}${safePercent}%{green-fg}{bold}){/}\n` +
          `  [${progressBar}]\n\n` +
          `{green-fg}{bold}⏱️ TIME ELAPSED (MIN:SEC){/}\n` +
          `${timeRenderResult}\n`
        );
        screen.render();
      } catch {
        nowPlayingBox.setContent(`{bold}Track:{/} ${trackName}\nTime: ${current} / ${total}`);
        screen.render();
      }
    },

    setVisualizer: () => {},
    clearVisual: () => {},
    setWaveform: () => {},

    setAlbumArt: (asciiArt, album, year) => {
      albumBox.setContent(`${asciiArt}\n\n{yellow-fg}${album}{/}\n(${year})`);
      screen.render();
    },

    setVolumeState: (volume, loop, shuffle, eqMode) => {
      statusBox.setContent(
        `{bold}STATE{/}                         {bold}KEYBOARD SHORTCUTS{/}\n` +
        `• Volume:    [${volume}%]          ▲/▼ o +/- : Vol Up/Down\n` +
        `• Loop:      [${loop ? "ENABLED" : "DISABLED"}]          L         : Toggle Loop\n` +
        `• Shuffle:   [${shuffle ? "ON" : "OFF"}]            Z         : Toggle Shuffle\n` +
        `• Equalizer: {green-fg}[${String(eqMode || "").padStart(7)}] {/}      E         : Cycle EQ Presets\n` +
        `                                    F         : Toggle Browse Files (Tab/Esc)\n` +
        `                                    SPACE     : Play / Pause\n` +
        `                                    N / P     : Next / Prev Track\n` +
        `                                    S / Q     : Stop / Quit Player`
      );
      screen.render();
    },

    setPlaylist: (playlist, currentIndex) => {
      cachedPlaylistData = { playlist, currentIndex };
      
      if (isBrowsingFiles) return;
      
      playlistBox.setLabel(" [ TRACKLIST ] ");
      interactiveList.clearItems();
      
      const tracks = Array.isArray(playlist) ? playlist : [];
      tracks.forEach((track, idx) => {
        if (idx === currentIndex) {
          interactiveList.addItem(`{yellow-fg}▶ * ${track.name}{/}`);
        } else {
          interactiveList.addItem(`    ${track.name}`);
        }
      });

      if (tracks.length > 0) {
        interactiveList.select(currentIndex);
      }
      screen.render();
    },

    setFileInfo: (codec, bitrate) => {
      if (!isBrowsingFiles) {
        playlistBox.setLabel(` [ PLAYLIST - ${codec} @ ${bitrate} ] `);
        screen.render();
      }
    },

    appendLog: (msg) => {
      const clearMsg = String(msg || "").replace(/\{.*?\}/g, "");
      nowPlayingBox.setLabel(` [ LOG: ${clearMsg} ] `);
      screen.render();
    },

    clearLog: () => {
      nowPlayingBox.setLabel(" [ NOW PLAYING ] ");
      screen.render();
    },

    getInput: (callback) => {
      if (globalKeypressListener) {
        screen.removeListener("keypress", globalKeypressListener);
      }

      globalKeypressListener = (ch, key) => {
        // .trim() elimina espacios en blanco e invisibles (\u00a0) heredados de la cadena original
        const keyName = key && key.name ? key.name.trim() : "";

        if (keyName === "f" || keyName === "tab") {
          isBrowsingFiles = !isBrowsingFiles;
          if (isBrowsingFiles) {
            updateDirectoryBrowser();
          } else {
            renderCachedPlaylist();
          }
          return;
        }

        if (isBrowsingFiles) {
          if (keyName === "up") {
            interactiveList.up(1);
            screen.render();
            return;
          }
          if (keyName === "down") {
            interactiveList.down(1);
            screen.render();
            return;
          }
          if (keyName === "backspace") {
            currentBrowseDir = path.dirname(currentBrowseDir);
            if (typeof onFolderSelectedCallback === "function") {
              onFolderSelectedCallback(currentBrowseDir);
            }
            const folderName = path.basename(currentBrowseDir) || currentBrowseDir;
            nowPlayingBox.setLabel(` [ LOG: Browsing 📁 ${folderName} ] `);
            
            updateDirectoryBrowser();
            return;
          }
          if (keyName === "enter") {
            const index = interactiveList.selected;
            const targetItem = browseItemsRaw[index];

            if (targetItem) {
              if (targetItem.isDir) {
                currentBrowseDir = targetItem.path;
                if (typeof onFolderSelectedCallback === "function") {
                  onFolderSelectedCallback(currentBrowseDir);
                }
                const folderName = path.basename(currentBrowseDir) || currentBrowseDir;
                nowPlayingBox.setLabel(` [ LOG: Browsing 📁 ${folderName} ] `);

                updateDirectoryBrowser();
              } else if (typeof onFileSelectedCallback === "function") {
                // Sincroniza la nueva carpeta de forma oficial en el Core
                if (typeof onFolderSelectedCallback === "function") {
                  onFolderSelectedCallback(currentBrowseDir);
                }

                // Despacha el audio seleccionado
                onFileSelectedCallback(targetItem.path, targetItem.name.replace("🎵 ", ""));
                
                isBrowsingFiles = false;
                renderCachedPlaylist();
                return;
              }
            }
            return;
          }
          if (keyName === "escape") {
            isBrowsingFiles = false;
            renderCachedPlaylist();
            return;
          }
        }

        // Delegación limpia de vuelta al core principal (volumen, pausa, etc.)
        callback(ch, key);
      };

      screen.on("keypress", globalKeypressListener);

      return {
        removeAllListeners: () => {
          if (globalKeypressListener) {
            screen.removeListener("keypress", globalKeypressListener);
            globalKeypressListener = null;
          }
        },
        setValue: () => {},
        focusInput: () => {}
      };
    },

    focusInput: () => {},
    destroy: () => { try { screen.destroy(); } catch {} },
    render: () => { screen.render(); }
  };
}
