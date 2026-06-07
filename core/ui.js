import blessed from "blessed";
import { VERSION, CODENAME } from "./version.js";

// Matriz tipográfica de Alta Resolución (Altura: 5 celdas) para máxima legibilidad
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
    " █   "
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
    " █   ",
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
    " ███▄ ▄███▓ ▄▄▄        ██████  ▄████▄   ██▓ ██▓",
    "▓██▒▀█▀ ██▒▒████▄    ▒██    ▒ ▒██▀ ▀█  ▓██▒▓██▒",
    "▓██    ▓██░▒██  ▀█▄  ░ ▓██▄   ▒▓█    ▄ ▒██▒▒██▒",
    "▒██    ▒██ ░██▄▄▄▄██   ▒   ██▒▒▓▓▄ ▄██▒░██░░██░",
    "▒██▒   ░██▒ ▓█   ▓██▒▒██████▒▒▒ ▓███▀ ░░██░░██░",
    "░ ▒░   ░  ░ ▒▒   ▓▒█░▒ ▒▓▒ ▒ ░░ ░▒ ▒  ░░▓  ░▓",
    "░  ░      ░  ▒   ▒▒ ░░ ░▒  ░ ░  ░  ▒    ▒ ░ ▒ ░",
    "░      ░     ░   ▒   ░  ░  ░  ░         ▒ ░ ▒ ░",
    "       ░         ░  ░      ░  ░ ░       ░   ░",
    "                              ░"
  ];

  // Franjas Kingston/Jamaica más marcadas:
  // alternamos verde/amarillo como fondo real para que la bandera se note más.
  const stripeTags = [
    "{green-bg}{black-fg}",
    "{yellow-bg}{black-fg}",
    "{green-bg}{black-fg}",
    "{yellow-bg}{black-fg}",
    "{green-bg}{black-fg}",
    "{yellow-bg}{black-fg}",
    "{green-bg}{black-fg}",
    "{yellow-bg}{black-fg}",
    "{green-bg}{black-fg}",
    "{yellow-bg}{black-fg}"
  ];

  const width = Math.max(...logoLines.map((line) => line.length));

  let art = "";
  for (let i = 0; i < logoLines.length; i++) {
    const paddedLine = logoLines[i].padEnd(width, " ");
    art += `${stripeTags[i]} ${paddedLine} {/}\n`;
  }

  return `
${art}

{yellow-fg}v${VERSION} "${CODENAME}"{/}
`;
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
    style: {
      fg: "white",
      bg: "black"
    },
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
    style: { border: { fg: "yellow" } },
    tags: true
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

  return {
    screen,

    showSplash,
    hideSplash,

    getSize: () => ({
      width: screen.width,
      height: screen.height
    }),

    setNowPlaying: (trackName, current, total, percent) => {
      try {
        const computedWidth =
          typeof nowPlayingBox.width === "number"
            ? nowPlayingBox.width
            : Math.floor(screen.width * 0.7);

        const barWidth = Math.max(15, computedWidth - 20);

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

        if (timeDisplayString !== lastTimeStr) {
          lastTimeStr = timeDisplayString;
          cachedBigTime = textToBigAscii(timeDisplayString);
        }

        const maxTextLength = Math.max(20, computedWidth - 15);
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
            `{cyan-fg}${cachedBigTime}{/}\n`
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
          `• Shuffle:   [${shuffle ? "ON" : "OFF"}]           Z         : Toggle Shuffle\n` +
          `• Equalizer: {green-fg}[${String(eqMode || "").padStart(7)}] {/}     E         : Cycle EQ Presets\n` +
          `                           SPACE     : Play / Pause\n` +
          `                           N / P     : Next / Prev Track\n` +
          `                           S / Q     : Stop / Quit Player`
      );
      screen.render();
    },

    setPlaylist: (playlist, currentIndex) => {
      const items = (Array.isArray(playlist) ? playlist : [])
        .map((track, idx) =>
          idx === currentIndex
            ? `{yellow-fg}-> * ${track.name}{/}`
            : `     ${track.name}`
        )
        .slice(Math.max(0, currentIndex - 2), currentIndex + 3);

      playlistBox.setContent(items.join("\n"));
      screen.render();
    },

    setFileInfo: (codec, bitrate) => {
      playlistBox.setLabel(` [ PLAYLIST - ${codec} @ ${bitrate} ] `);
      screen.render();
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

    destroy: () => {
      try {
        screen.destroy();
      } catch {}
    },

    render: () => {
      screen.render();
    }
  };
}
