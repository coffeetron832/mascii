import blessed from "blessed";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { VERSION, CODENAME } from "./version.js";

// ============================================================================
// 1. CONSTANTES Y CONFIGURACIONES GRÁFICAS (ASCII ART)
// ============================================================================

// Glifos Big ASCII optimizados: Matriz geométrica estricta de 5x5 por carácter
const ASCII_DIGITS = {
  "0": ["█████", "█   █", "█   █", "█   █", "█████"],
  "1": ["  ██ ", "   █ ", "   █ ", "   █ ", " ████"],
  "2": ["█████", "    █", "█████", "█    ", "█████"],
  "3": ["█████", "    █", "█████", "    █", "█████"],
  "4": ["█   █", "█   █", "█████", "    █", "    █"],
  "5": ["█████", "█    ", "█████", "    █", "█████"],
  "6": ["█████", "█    ", "█████", "█   █", "█████"],
  "7": ["█████", "    █", "   █ ", "  █  ", "  █  "],
  "8": ["█████", "█   █", "█████", "█   █", "█████"],
  "9": ["█████", "█   █", "█████", "    █", "█████"],
  ":": ["     ", "  █  ", "     ", "  █  ", "     "],
  "/": ["    █", "   █ ", "  █  ", " █   ", "█    "],
  "-": ["     ", "     ", "█████", "     ", "     "],
  " ": ["     ", "     ", "     ", "     ", "     "]
};

// Bloque de diseño del logotipo base con alternancia de colores Rojo, Azul y Blanco
const SHARED_LOGO_LINES = [
  "                                          {red-fg}d8b{/} {blue-fg}d8b{/}",
  "                                          {red-fg}Y8P{/} {blue-fg}Y8P{/}",
  "                                                     ",
  "{red-fg}88888b.d88b.{/}   {blue-fg}8888b.{/}   {white-fg}.d8888b{/}   {red-fg}.d8888b{/} {blue-fg}888{/} {white-fg}888{/} ",
  "{red-fg}888 \"888 \"88b{/}      {blue-fg}\"88b{/} {white-fg}88K{/}      {red-fg}d88P\"{/}    {blue-fg}888{/} {white-fg}888{/} ",
  "{red-fg}888  888  888{/}  {blue-fg}.d888888{/} {white-fg}\"Y8888b.{/} {red-fg}888{/}      {blue-fg}888{/} {white-fg}888{/} ",
  "{red-fg}888  888  888{/}  {blue-fg}888  888{/}      {white-fg}X88{/} {red-fg}Y88b.{/}    {blue-fg}888{/} {white-fg}888{/} ",
  "{red-fg}888  888  888{/}  {blue-fg}\"Y888888{/}  {white-fg}88888P'{/}  {red-fg}\"Y8888P{/} {blue-fg}888{/} {white-fg}888{/}"
];

// ============================================================================
// 2. FUNCIONES AUXILIARES DE RENDERIZADO
// ============================================================================

function textToBigAscii(text) {
  const lines = ["", "", "", "", ""];
  for (const char of text) {
    const glyph = ASCII_DIGITS[char] || ASCII_DIGITS[" "];
    lines[0] += glyph[0] + " ";
    lines[1] += glyph[1] + " ";
    lines[2] += glyph[2] + " ";
    lines[3] += glyph[3] + " ";
    lines[4] += glyph[4] + " ";
  }
  return lines.join("\n");
}

function buildSplashArt() {
  const getVisibleLength = (str) => str.replace(/\{.*?\}/g, "").length;
  const maxWidth = Math.max(...SHARED_LOGO_LINES.map(getVisibleLength));

  let art = "";
  for (let i = 0; i < SHARED_LOGO_LINES.length; i++) {
    const visibleLen = getVisibleLength(SHARED_LOGO_LINES[i]);
    const paddedLine = SHARED_LOGO_LINES[i] + " ".repeat(maxWidth - visibleLen);
    art += ` ${paddedLine} \n`;
  }

  return `\n${art}\n{gray-fg}Music that stays inside your workflow{/}\n`;
}

// ============================================================================
// 3. FÁBRICA PRINCIPAL DEL ENTORNO DE INTERFAZ (UI)
// ============================================================================

export function createUI() {
  
  // Base del contenedor de Blessed Terminal
  const screen = blessed.screen({
    smartCSR: true,
    title: "MASCII Player",
    dockBorders: true
  });

  // --------------------------------------------------------------------------
  // 3.1. COMPONENTES Y CRISTALES DE LA INTERFAZ (BOXES)
  // --------------------------------------------------------------------------

  // Pantalla de Bienvenida (Splash)
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

  const noAlbumArtText = "\n{gray-fg}[ NO ALBUM ART AVAILABLE ]{/}";

  // Contenedor de Carátula
  const albumBox = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: "30%",
    height: "70%",
    label: " [ ALBUM ART ] ",
    border: { type: "line" },
    style: { border: { fg: "cyan" } },
    scrollable: false
  });

  const albumContentContainer = blessed.box({
    parent: albumBox,
    top: "center",
    left: "center",
    width: "100%-2",
    height: "100%-2", 
    align: "center",
    valign: "middle",
    tags: true,
    content: `${noAlbumArtText}\n\n{yellow-fg}MASCII{/}\n{white-fg}Ready to play{/}`
  });

  // Panel de Información Central (Now Playing)
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

  const defaultWelcomeMessage = 
    `{green-fg}{bold}::: WELCOME TO MASCII PLAYER :::{/}\n\n` +
    `{white-fg}Relax, turn up the volume, and enjoy a seamless audio experience.{/}\n` +
    `{white-fg}Everything you need to control your music is right at your fingertips.{/}\n\n` +
    `{cyan-fg}• Find Tracks : Press {bold}F{/bold} or {bold}TAB{/bold} to browse your library and add files.\n` +
    `• YouTube Stream : Press {bold}Y{/bold} to stream your favorite audio directly from a URL.\n` +
    `• Controls    : Use {bold}UP/DOWN{/bold} to navigate and {bold}SPACE{/bold} to play or pause.\n\n` +
    `{yellow-fg}{italic}Load your favorite playlist and let the music take over...{/}`;

  const nowPlayingStaticBox = blessed.box({
    parent: nowPlayingBox,
    top: 0,
    left: 0,
    width: "100%-6",
    height: 9, 
    tags: true,
    border: { type: "none" },
    content: defaultWelcomeMessage
  });

  const nowPlayingProgressBox = blessed.box({
    parent: nowPlayingBox,
    top: 9, 
    left: 0,
    width: "100%-6",
    height: "shrink",
    tags: true,
    border: { type: "none" }
  });

  // Panel de Lista de Reproducción / Explorador
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
    keys: true, 
    vi: true,
    scrollbar: {
      ch: "█",
      track: { bg: "black" },
      style: { fg: "yellow" }
    },
    style: {
      selected: { fg: "black", bg: "yellow", bold: true },
      item: { fg: "white" }
    }
  });

  // Barra de búsqueda nativa integrada
  const searchBar = blessed.textbox({
    parent: playlistBox,
    bottom: 0,
    left: 0,
    width: "100%-2",
    height: 1,
    style: { fg: "black", bg: "cyan" },
    inputOnFocus: true,
    hidden: true
  });

  // Panel de Estado de Audio y Atajos de Teclado
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

  // --------------------------------------------------------------------------
  // 3.2. ESTADO INTERNO DE LA UI Y VARIABLES DE CACHÉ
  // --------------------------------------------------------------------------
  let globalKeypressListener = null;
  let lastTimeStr = "";
  let cachedBigTime = "";
  let splashHidden = false;
  let resizeCallback = null;

  let lastTrackName = "";
  let lastArtist = "";
  let lastAlbumName = "";
  let lastAlbumYear = "";
  let lastTrackNum = "";
  let lastGenre = "";
  let lastCodec = "Unknown";
  let lastBitrate = "--- kbps";

  let currentTrackColor = "{cyan-fg}";
  let lastRenderedColor = ""; 

  let cachedStaticNowPlaying = defaultWelcomeMessage;
  let lastProgressPercent = -1;

  let isBrowsingFiles = false;
  let isSearching = false;
  let searchQuery = "";

  let currentBrowseDir = process.cwd();
  let browseItemsRaw = [];
  let onFileSelectedCallback = null;
  let onFolderSelectedCallback = null;
  let onSearchTrackCallback = null;
  let cachedPlaylistData = null;
  let onYoutubeUrlSubmittedCallback = null;

  let activePlayerInstance = null;

  // --------------------------------------------------------------------------
  // 3.3. FUNCIONES INTERNAS DE LA INTERFAZ
  // --------------------------------------------------------------------------
  
  function formatSeconds(sec = 0) {
    if (!isFinite(sec) || sec < 0) return "00:00";
    const minutes = Math.floor(sec / 60);
    const seconds = Math.floor(sec % 60);
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function safeMoveSelector(offset, maxItems) {
    if (maxItems <= 0) return;
    const current = interactiveList.selected;
    const target = current + offset;
    if (target >= 0 && target < maxItems) {
      if (offset === -1) interactiveList.up();
      if (offset === 1) interactiveList.down();
    }
    screen.render();
  }

  let showSplashInstance = () => {
    splashHidden = false;
    splash.show();
    splash.setFront();
    screen.render();
  };

  function hideSplash() {
    if (splashHidden) return;
    splashHidden = true;
    splash.hide();
    screen.render();
  }

  function renderStaticNowPlaying(trackName, artist, album, year, trackNumber, genre, codec, bitrate) {
    cachedStaticNowPlaying =
      `{green-fg}{bold}TRACK     :{/} {white-fg}${trackName || "Unknown Track"}{/}\n` +
      `{green-fg}{bold}ARTIST    :{/} {white-fg}${artist || "Unknown Artist"}{/}\n` +
      `{green-fg}{bold}ALBUM     :{/} {white-fg}${album || "Unknown Album"}{/}\n` +
      `{green-fg}{bold}YEAR      :{/} {white-fg}${year || "----"}{/}\n` +
      `{green-fg}{bold}TRACK NO  :{/} {white-fg}${trackNumber || "-"}{/}\n` +
      `{green-fg}{bold}GENRE     :{/} {white-fg}${genre || "Unknown"}{/}\n` +
      `{green-fg}{bold}FORMAT    :{/} {white-fg}${codec || "Unknown"} @ ${bitrate || "---"}{/}\n`;

    nowPlayingStaticBox.setContent(cachedStaticNowPlaying);
  }

  // --------------------------------------------------------------------------
  // 3.4. SISTEMA DE EXPLORACIÓN DE DIRECTORIOS LOCALES
  // --------------------------------------------------------------------------
  function updateDirectoryBrowser() {
    playlistBox.setLabel(` [ BROWSER: ${path.basename(currentBrowseDir) || currentBrowseDir} ] `);
    interactiveList.clearItems();

    try {
      const files = fs.readdirSync(currentBrowseDir);
      const directories = [];
      const audioFiles = [];

      if (currentBrowseDir !== path.parse(currentBrowseDir).root) {
        directories.push({
          name: "[DIR] .. (Go Up Directory)",
          isDir: true,
          path: path.dirname(currentBrowseDir)
        });
      }

      files.forEach((file) => {
        try {
          const fullPath = path.join(currentBrowseDir, file);
          const stat = fs.statSync(fullPath);

          if (stat.isDirectory()) {
            directories.push({ name: `[DIR] ${file}/`, isDir: true, path: fullPath });
          } else {
            const ext = path.extname(file).toLowerCase();
            if ([".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac"].includes(ext)) {
              audioFiles.push({ name: `[FILE] ${file}`, isDir: false, path: fullPath });
            }
          }
        } catch {}
      });

      browseItemsRaw = [...directories, ...audioFiles];

      if (browseItemsRaw.length === 0) {
        interactiveList.addItem(" Empty (No audio/folders found) ");
      } else {
        browseItemsRaw.forEach((item) => {
          interactiveList.addItem(item.isDir ? `{cyan-fg}${item.name}{/}` : item.name);
        });
      }
    } catch {
      playlistBox.setLabel(" [ BROWSER ERROR ] ");
      interactiveList.addItem(`{red-fg}Error reading path.{/}`);
      browseItemsRaw = [];
    }

    interactiveList.select(0);
    screen.render();
  }

  // --------------------------------------------------------------------------
  // 3.5. RENDERIZADO DE LA LISTA DE REPRODUCCIÓN (PLAYLIST)
  // --------------------------------------------------------------------------
  function renderCachedPlaylist() {
    const labelSuffix = searchQuery ? ` | SEARCH: "${searchQuery}"` : "";
    playlistBox.setLabel(` [ TRACKLIST${labelSuffix} ] `);

    interactiveList.clearItems();

    const totalWidth = playlistBox.width || Math.floor(screen.width * 0.6);
    const availableWidth = Math.max(40, totalWidth - 6);

    const durationColWidth = 10;
    const remainingWidth = availableWidth - durationColWidth;
    
    const trackColWidth = Math.floor(remainingWidth * 0.6);
    const albumColWidth = remainingWidth - trackColWidth;

    const headTrack = "Track Name".padEnd(trackColWidth).slice(0, trackColWidth);
    const headAlbum = "Album".padEnd(albumColWidth).slice(0, albumColWidth);
    const headDuration = "Duration".padStart(durationColWidth - 2).padEnd(durationColWidth);
    
    interactiveList.addItem(`{bold}{yellow-fg}  ${headTrack}${headAlbum}${headDuration}{/}`);

    if (cachedPlaylistData && Array.isArray(cachedPlaylistData.playlist)) {
      let filteredTracks = cachedPlaylistData.playlist;
      let visualTargetIndex = -1;

      if (searchQuery) {
        filteredTracks = cachedPlaylistData.playlist.filter((t) =>
          t.name.toLowerCase().includes(searchQuery.toLowerCase())
        );
      }

      if (filteredTracks.length === 0) {
        interactiveList.addItem("  No tracks match search ");
        interactiveList.select(1);
      } else {
        filteredTracks.forEach((track, localIdx) => {
          const globalIdx = cachedPlaylistData.playlist.findIndex((t) => t.path === track.path);
          
          const rawName = track.name || "Unknown Track";
          const rawAlbum = track.album || "--";
          
          let rawDuration = "00:00";
          if (track.durationStr) {
            rawDuration = track.durationStr;
          } else if (typeof track.duration === "number") {
            rawDuration = formatSeconds(track.duration);
          }

          const fmtName = rawName.padEnd(trackColWidth).slice(0, trackColWidth);
          const fmtAlbum = rawAlbum.padEnd(albumColWidth).slice(0, albumColWidth);
          const fmtDuration = rawDuration.padStart(durationColWidth - 2).padEnd(durationColWidth);

          const isCurrent = (globalIdx === cachedPlaylistData.currentIndex);
          
          if (isCurrent) {
            interactiveList.addItem(`{yellow-fg}> ${fmtName}${fmtAlbum}${fmtDuration}{/}`);
            visualTargetIndex = localIdx + 1;
          } else {
            interactiveList.addItem(`  ${fmtName}${fmtAlbum}${fmtDuration}`);
          }
        });

        if (visualTargetIndex !== -1) {
          interactiveList.select(visualTargetIndex);
        } else {
          interactiveList.select(1); 
        }
      }
    }

    screen.render();
  }

  // MODAL DE BÚSQUEDA FLOTANTE (FILTRO DE TRACKLIST)
  function activateSearchMode(onKeypressCallback) {
    isSearching = true;
    isBrowsingFiles = false;

    searchBar.show();
    searchBar.setValue(searchQuery);

    interactiveList.height = "100%-3";
    playlistBox.setLabel(` [ FIND TRACK: Enter to Confirm / Esc to Exit ] `);

    if (globalKeypressListener) {
      screen.removeListener("keypress", globalKeypressListener);
    }

    screen.render();
    searchBar.focus();

    const exitSearch = () => {
      isSearching = false;
      searchBar.hide();
      interactiveList.height = "100%-2";

      searchBar.removeAllListeners("submit");
      searchBar.removeAllListeners("cancel");

      if (screen.focused === searchBar) {
        screen.focused = null;
      }
      screen.grabKeys = false;

      renderCachedPlaylist();
      screen.on("keypress", globalKeypressListener);
      screen.render();
    };

    searchBar.on("submit", (val) => {
      searchQuery = val.trim();
      exitSearch();
    });

    searchBar.on("cancel", () => {
      exitSearch();
    });
  }

  // --------------------------------------------------------------------------
  // 3.6. MODALES Y VENTANAS EMERGENTES (ABOUT & YOUTUBE)
  // --------------------------------------------------------------------------
  function createModalWindow(options) {
    return blessed.box({
      parent: screen,
      top: "center",
      left: "center",
      width: options.width || 60,
      height: options.height || 11,
      border: { type: "line" },
      style: {
        border: { fg: "cyan" },
        bg: "black"
      },
      label: options.title || "",
      tags: true
    });
  }

  function openAboutModal() {
    if (globalKeypressListener) {
      screen.removeListener("keypress", globalKeypressListener);
    }

    const aboutBox = createModalWindow({
      title: " ABOUT MASCII PLAYER ",
      width: 72,
      height: 22
    });

    const currentYear = new Date().getFullYear();

    const linesContent = [
      ...SHARED_LOGO_LINES,
      "",
      "  {white-fg}Music ASCII Player {/}",
      `  {yellow-fg}Version:{/} ${VERSION} "${CODENAME}"`, 
      "  {yellow-fg}Environment:{/} Blessed Terminal Architecture",
      " ──────────────────────────────────────────────────────────────────",
      '  {cyan-fg}Friedrich Nietzsche - “Without music, life would be a mistake”{/}',
      " ──────────────────────────────────────────────────────────────────",
      `  {gray-fg}Software under MIT Open Source License | Copyright (c)J Ponton ${currentYear}{/}`,
      "",
      "  {gray-fg}[ Press Esc, Enter or 'A' to close this window ]{/}"
    ];

    aboutBox.setContent(linesContent.join("\n"));
    screen.append(aboutBox);
    aboutBox.setFront();
    screen.render();

    const closeAboutHandler = (ch, key) => {
      const action = (key.name || ch || "").toLowerCase();
      if (action === "escape" || action === "enter" || action === "a") {
        screen.remove(aboutBox);
        screen.removeListener("keypress", closeAboutHandler);
        if (globalKeypressListener) screen.on("keypress", globalKeypressListener);
        screen.render();
      }
    };

    screen.on("keypress", closeAboutHandler);
  }

  async function handleYoutubeLinkInput(url) {
    if (!url) return;

    nowPlayingBox.setLabel(" [ LOG: Fetching stream metadata... ] ");
    screen.render();

    if (!activePlayerInstance || typeof activePlayerInstance.getLinkInfo !== "function") {
      nowPlayingBox.setLabel(" [ LOG: Error - Player instance core not linked to UI ] ");
      screen.render();
      if (globalKeypressListener) screen.on("keypress", globalKeypressListener);
      return;
    }

    try {
      const linkInfo = await activePlayerInstance.getLinkInfo(url);

      if (!linkInfo) {
        nowPlayingBox.setLabel(" [ LOG: Error - Could not retrieve link information ] ");
        screen.render();
        if (globalKeypressListener) screen.on("keypress", globalKeypressListener);
        return;
      }

      const previewBox = createModalWindow({
        title: " REMOTE STREAM PREVIEW ",
        width: 60,
        height: 11
      });

      previewBox.setContent([
        `Title:    ${(linkInfo.title || "Unknown").substring(0, 45)}`,
        `Channel:  ${linkInfo.artist || "Unknown"}`,
        `Album:    ${linkInfo.album || "Unknown"}`,
        `Year:     ${linkInfo.year || "----"}          Duration: ${formatSeconds(linkInfo.duration || 0)}`,
        "-".repeat(56),
        ` [P] Play directly (Streaming)`,
        ` [D] Download locally (Save to /music)`,
        ` [C] Cancel operation`
      ].join("\n"));

      screen.append(previewBox);
      previewBox.setFront();
      screen.render();

      const previewKeyHandler = async (ch, key) => {
        const action = (key.name || ch || "").toLowerCase();

        if (action === "p") {
          screen.remove(previewBox);
          screen.removeListener("keypress", previewKeyHandler);
          if (globalKeypressListener) screen.on("keypress", globalKeypressListener);
          
          if (typeof onYoutubeUrlSubmittedCallback === "function") {
            onYoutubeUrlSubmittedCallback(url);
          }
        } 
        else if (action === "d") {
          screen.removeListener("keypress", previewKeyHandler);

          previewBox.setContent([
            `Downloading: ${(linkInfo.title || "").substring(0, 40)}...`,
            "-".repeat(56),
            ` Progress: [                    ] 0%`,
            ` Extracting optimal audio stream and converting to MP3.`
          ].join("\n"));
          screen.render();

          if (typeof activePlayerInstance.downloadYoutubeAudio !== "function") {
            screen.remove(previewBox);
            nowPlayingBox.setLabel(" [ LOG: Error - Core download method missing ] ");
            if (globalKeypressListener) screen.on("keypress", globalKeypressListener);
            screen.render();
            return;
          }

          activePlayerInstance.downloadYoutubeAudio(
            url,
            "bestaudio",
            (percent) => {
              const width = 20;
              const completed = Math.round((percent / 100) * width);
              const bar = "=".repeat(completed) + " ".repeat(width - completed);

              previewBox.setContent([
                `Downloading: ${(linkInfo.title || "").substring(0, 40)}...`,
                "-".repeat(56),
                ` Progress: [${bar}] ${percent}%`,
                ` Converting tracks and updating local database...`
              ].join("\n"));
              screen.render();
            },
            (success) => {
              screen.remove(previewBox);
              if (globalKeypressListener) screen.on("keypress", globalKeypressListener);
              
              if (success) {
                nowPlayingBox.setLabel(` [ LOG: Success - ${linkInfo.title} downloaded ] `);
              } else {
                nowPlayingBox.setLabel(" [ LOG: Error - Download or conversion failed ] ");
              }
              screen.render();
            }
          );
        } 
        else if (action === "c" || key.name === "escape") {
          screen.remove(previewBox);
          screen.removeListener("keypress", previewKeyHandler);
          if (globalKeypressListener) screen.on("keypress", globalKeypressListener);
          nowPlayingBox.setLabel(" [ LOG: Operation canceled by user ] ");
          screen.render();
        }
      };

      screen.on("keypress", previewKeyHandler);

    } catch (err) {
      nowPlayingBox.setLabel(" [ LOG: Error - Stream lookup failed ] ");
      if (globalKeypressListener) screen.on("keypress", globalKeypressListener);
      screen.render();
    }
  }

  function openYoutubePrompt() {
    if (globalKeypressListener) {
      screen.removeListener("keypress", globalKeypressListener);
    }

    const promptContainer = blessed.form({
      parent: screen,
      top: "center",
      left: "center",
      width: "60%",
      height: 7,
      keys: true,
      border: "line",
      style: {
        border: { fg: "cyan" },
        bg: "black"
      },
      label: " YouTube URL Stream " 
    });

    blessed.box({
      parent: promptContainer,
      top: 1,
      left: 2,
      width: "100%-4",
      height: 1,
      tags: true,
      content: "Enter YouTube or Stream URL:"
    });

    const promptInput = blessed.textbox({
      parent: promptContainer,
      top: 3,
      left: 2,
      width: "100%-5",
      height: 1,
      keys: true,         
      inputOnFocus: true,
      style: {
        fg: "black",
        bg: "white",
        focus: { bg: "lightgray" }
      }
    });

    const closePrompt = () => {
      promptContainer.destroy();
      screen.render();
    };

    promptInput.on("submit", (value) => {
      closePrompt();
      if (value && value.trim() !== "") {
        handleYoutubeLinkInput(value.trim());
      } else {
        if (globalKeypressListener) screen.on("keypress", globalKeypressListener);
      }
    });

    promptInput.on("cancel", () => {
      closePrompt();
      if (globalKeypressListener) screen.on("keypress", globalKeypressListener);
    });

    screen.render();
    promptInput.focus();
    promptInput.readInput(); 
  }

  // --------------------------------------------------------------------------
  // 3.7. COMPILACIÓN CINEMÁTICA EN ENTORNO EXTERNO (VISUALIZER)
  // --------------------------------------------------------------------------
  function launchVisualizer() {
    const terminals = [
      { cmd: "gnome-terminal", args: ["--", "./snake_anim"] }, 
      { cmd: "konsole", args: ["-e", "./snake_anim"] },        
      { cmd: "xfce4-terminal", args: ["-e", "./snake_anim"] }, 
      { cmd: "mate-terminal", args: ["--", "./snake_anim"] },  
      { cmd: "lxterminal", args: ["-e", "./snake_anim"] },     
      { cmd: "kitty", args: ["./snake_anim"] },                
      { cmd: "alacritty", args: ["-e", "./snake_anim"] },      
      { cmd: "xterm", args: ["-e", "./snake_anim"] }           
    ];

    let index = 0;

    function tryNextTerminal() {
      if (index >= terminals.length) {
        nowPlayingBox.setLabel(" [ LOG: Error - No compatible terminal emulator found (gnome-terminal, konsole, xterm) ] ");
        screen.render();
        return;
      }

      const term = terminals[index];
      
      const child = spawn(term.cmd, term.args, {
        detached: true,
        stdio: "ignore"
      });

      child.on("error", (err) => {
        if (err.code === "ENOENT") {
          index++;
          tryNextTerminal(); 
        }
      });

      child.unref();
      
      if (index < terminals.length) {
        nowPlayingBox.setLabel(` [ LOG: Visualizer requested via external window (${term.cmd}) ] `);
        screen.render();
      }
    }

    tryNextTerminal();
  }

  // Manejador del evento de redimensionamiento de ventana
  screen.on("resize", () => {
    screen.realloc();
    if (lastTrackName === "") {
      albumContentContainer.setContent(`${noAlbumArtText}\n\n{yellow-fg}MASCII{/}\n{white-fg}Ready to play{/}`);
    } else {
      albumContentContainer.setContent("");
    }
    nowPlayingStaticBox.setContent(cachedStaticNowPlaying);
    screen.render();

    if (typeof resizeCallback === "function") {
      resizeCallback();
    }
  });

  // ============================================================================
  // 4. API REVELADA (MÉTODOS PÚBLICOS DE RETORNO)
  // ============================================================================
  return {
    screen,
    showSplash: showSplashInstance,
    hideSplash,
    getSize: () => ({ width: screen.width, height: screen.height }),
    getAlbumBoxSize: () => {
      const width = albumBox.width || Math.floor(screen.width * 0.3);
      const height = albumBox.height || Math.floor(screen.height * 0.7);
      return { width: Math.max(10, width - 4), height: Math.max(5, height - 4) };
    },
    onResize: (callback) => { resizeCallback = callback; },
    onFileSelected: (callback) => { onFileSelectedCallback = callback; },
    onFolderSelected: (callback) => { onFolderSelectedCallback = callback; },
    onSearchTrack: (callback) => { onSearchTrackCallback = callback; },
    onSearchTrackSelected: (callback) => { onSearchTrackCallback = callback; },
    onYoutubeUrlSubmitted: (callback) => { onYoutubeUrlSubmittedCallback = callback; },
    
    setPlayerCore: (playerInstance) => {
      activePlayerInstance = playerInstance;
    },

    setTrackColor: (colorTag) => {
      if (colorTag && colorTag.startsWith("{") && colorTag.endsWith("}")) {
        currentTrackColor = colorTag;
      } else if (colorTag) {
        currentTrackColor = `{${colorTag}-fg}`;
      } else {
        currentTrackColor = "{cyan-fg}";
      }
    },

    setTrackDetails: (trackName, artist, extendedInfoText) => {
      hideSplash();
      
      lastTrackName = (trackName || "").trim() || "Loading Stream...";
      lastArtist = (artist || "").trim() || "Unknown Artist";
      lastAlbumName = "";
      lastAlbumYear = "";
      lastTrackNum = "";
      lastGenre = "";

      if (extendedInfoText && typeof extendedInfoText === "string") {
        const albumMatch = extendedInfoText.match(/(?:Album|Álbum):\s*([^\n]+)/i);
        const yearMatch = extendedInfoText.match(/(?:Year|Año):\s*(\d{4})/i);
        const trackMatch = extendedInfoText.match(/(?:Track|Pista|Número):\s*(\d+)/i);
        const genreMatch = extendedInfoText.match(/(?:Genre|Género):\s*([^\n]+)/i);

        if (albumMatch) lastAlbumName = albumMatch[1].trim();
        if (yearMatch) lastAlbumYear = yearMatch[1].trim();
        if (trackMatch) lastTrackNum = trackMatch[1].trim();
        if (genreMatch) lastGenre = genreMatch[1].trim();
      }

      renderStaticNowPlaying(
        lastTrackName,
        lastArtist,
        lastAlbumName,
        lastAlbumYear,
        lastTrackNum,
        lastGenre,
        lastCodec,
        lastBitrate
      );
      screen.render();
    },

    setMusicDir: (dirPath) => {
      if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
        currentBrowseDir = dirPath;
        const folderName = path.basename(dirPath) || dirPath;
        nowPlayingBox.setLabel(` [ LOG: Tracklist loaded from [DIR] ${folderName} ] `);

        if (isBrowsingFiles) {
          updateDirectoryBrowser();
        } else {
          screen.render();
        }
      }
    },

    setNowPlaying: (trackName, current, total, percent, album, year, trackNumber, artist, genre) => {
      try {
        hideSplash();

        const currentBoxWidth = nowPlayingBox.width || Math.floor(screen.width * 0.7);
        const currentBoxHeight = nowPlayingBox.height || Math.floor(screen.height * 0.7);
        
        let safePercent = parseInt(percent, 10);
        if (Number.isNaN(safePercent) || safePercent < 0) safePercent = 0;
        if (safePercent > 100) safePercent = 100;

        const currentTimeStr = formatSeconds(current);
        const totalTimeStr = formatSeconds(total);
        const timeDisplayString = `${currentTimeStr} / ${totalTimeStr}`;

        const maxTextLength = Math.max(20, currentBoxWidth - 15);
        
        let displayTrackName = String(trackName || "").trim();
        if (!displayTrackName) {
          displayTrackName = lastTrackName || "Unknown Track";
        }
        if (displayTrackName.length > maxTextLength) {
          displayTrackName = displayTrackName.slice(0, maxTextLength - 3) + "...";
        }

        let displayArtist = String(artist || "").trim() || lastArtist || "Unknown Artist";
        let displayAlbum = String(album || "").trim() || lastAlbumName || "Unknown Album";
        
        if (displayAlbum.length > Math.max(15, currentBoxWidth - 40)) {
          displayAlbum = displayAlbum.slice(0, Math.max(15, currentBoxWidth - 43)) + "...";
        }

        const displayYear = String(year || "").trim() || lastAlbumYear || "----";
        const displayTrack = String(trackNumber || "").trim() || lastTrackNum || "-";
        const displayGenre = String(genre || "").trim() || lastGenre || "Unknown Genre";

        const colorChanged = currentTrackColor !== lastRenderedColor;
        const progressChanged = safePercent !== lastProgressPercent;
        const timeChanged = timeDisplayString !== lastTimeStr;

        const metadataChanged =
          displayTrackName !== lastTrackName ||
          displayArtist !== lastArtist ||
          displayAlbum !== lastAlbumName ||
          displayYear !== lastAlbumYear ||
          displayTrack !== lastTrackNum ||
          displayGenre !== lastGenre;

        if (!colorChanged && !metadataChanged && !progressChanged && !timeChanged) {
          return;
        }

        if (metadataChanged) {
          lastTrackName = displayTrackName;
          lastArtist = displayArtist;
          lastAlbumName = displayAlbum;
          lastAlbumYear = displayYear;
          lastTrackNum = displayTrack;
          lastGenre = displayGenre;

          renderStaticNowPlaying(
            displayTrackName,
            displayArtist,
            displayAlbum,
            displayYear,
            displayTrack,
            displayGenre,
            lastCodec,
            lastBitrate
          );
        }

        const barWidth = Math.max(12, Math.min(26, currentBoxWidth - 36));
        let barLength = Math.max(0, Math.min(barWidth, Math.floor(barWidth * (safePercent / 100)) || 0));
        
        let progressBar = "";
        if (barLength > 0) {
          if (safePercent === 100) {
            progressBar = "{white-fg}" + "█".repeat(barLength) + "{/}";
          } else {
            const whiteBlocks = "█".repeat(barLength - 1);
            const greenIndicator = "{green-fg}█{/}";
            progressBar = `{white-fg}${whiteBlocks}{/}${greenIndicator}`;
          }
        }
        
        const remainingLength = Math.max(0, barWidth - barLength);
        progressBar += "-".repeat(remainingLength);

        let progressContent = 
          `{green-fg}{bold}PROGRESS ({/}${safePercent}%{green-fg}{bold}){/}\n` +
          `  [${progressBar}]\n\n` +
          `{green-fg}{bold}TIME ELAPSED (MIN:SEC){/}\n`;

        const canRenderBigASCII = currentBoxWidth > 58 && currentBoxHeight > 22;

        if (canRenderBigASCII) {
          cachedBigTime = textToBigAscii(timeDisplayString);
          progressContent += `${currentTrackColor}${cachedBigTime}{/}`;
        } else {
          progressContent += `  ${currentTrackColor}{bold}> ${timeDisplayString}{/}`;
        }

        nowPlayingProgressBox.setContent(progressContent);
        
        lastProgressPercent = safePercent;
        lastTimeStr = timeDisplayString;
        lastRenderedColor = currentTrackColor; 

        screen.render();

      } catch {
        nowPlayingStaticBox.setContent(`{bold}Track:{/} ${trackName}`);
        nowPlayingProgressBox.setContent(`{green-fg}{bold}PROGRESS{/}\n  [--->------]\n\nTime: ${current} / ${total}`);
        screen.render();
      }
    },

    setVisualizer: () => {},
    clearVisual: () => {},
    setWaveform: () => {},

    setAlbumArt: (asciiArt, album, year) => {
      if (asciiArt && asciiArt.trim() !== "") {
        albumContentContainer.setContent(`${asciiArt}\n\n{yellow-fg}${album}{/}\n(${year})`);
      } else {
        albumContentContainer.setContent(`${noAlbumArtText}\n\n{yellow-fg}${album || "Unknown Album"}{/}\n(${year || "----"})`);
      }
      screen.render();
    },

    setVolumeState: (volume, loop, shuffle, eqMode) => {
      const volStr = `[${volume}%]`.padEnd(8, " ");
      const loopStr = `[${loop ? "ON" : "OFF"}]`.padEnd(8, " ");
      const shufStr = `[${shuffle ? "ON" : "OFF"}]`.padEnd(8, " ");
      const eqStr = `[${String(eqMode || "NONE").toUpperCase()}]`.padEnd(8, " ");

      statusBox.setContent(
        `{bold}AUDIO CONFIG{/}                     {bold}KEYBOARD SHORTCUTS{/}\n` +
        `- Volume:     {green-fg}${volStr}{/}         UP/DOWN or +/- : Vol Up/Down\n` +
        `- Loop:       {green-fg}${loopStr}{/}         L              : Toggle Loop\n` +
        `- Shuffle:    {green-fg}${shufStr}{/}         Z              : Toggle Shuffle\n` +
        `- Equalizer:  {green-fg}${eqStr}{/}         E              : Cycle EQ Presets\n` +
        `                                SPACE          : Play / Pause\n` +
        `                                N / P          : Next / Prev Track\n` +
        `                                F / TAB        : Browse Files (Esc)\n` +
        `                                B              : Find Track in List\n` +
        `                                Y              : Stream YouTube URL\n` +
        `                                V              : Open Ext Visualizer\n` +
        `                                A              : About \n` + 
        `                                S / Q          : Stop / Quit Player`
      );
      screen.render();
    },

    setPlaylist: (playlist, currentIndex) => {
      cachedPlaylistData = { playlist, currentIndex };
      if (isBrowsingFiles) return;
      renderCachedPlaylist();
    },

    setFileInfo: (codec, bitrate) => {
      lastCodec = codec || "Unknown";
      lastBitrate = bitrate || "--- kbps";
      
      if (!isBrowsingFiles && !searchQuery) {
        playlistBox.setLabel(` [ PLAYLIST - ${lastCodec} @ ${lastBitrate} ] `);
      }
      
      renderStaticNowPlaying(
        lastTrackName,
        lastArtist,
        lastAlbumName,
        lastAlbumYear,
        lastTrackNum,
        lastGenre,
        lastCodec,
        lastBitrate
      );
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

    // --------------------------------------------------------------------------
    // 4.1. CAPTURA Y PROCESAMIENTO DE ENTRADAS DE TECLADO (INPUT HNDLR)
    // --------------------------------------------------------------------------
    getInput: (callback) => {
      if (globalKeypressListener) {
        screen.removeListener("keypress", globalKeypressListener);
      }

      globalKeypressListener = (ch, key) => {
        const keyName = key && key.name ? key.name.trim() : "";

        if ((keyName === "y" || ch === "y" || ch === "Y") && !isSearching && !isBrowsingFiles) {
          openYoutubePrompt();
          return;
        }

        if ((keyName === "v" || ch === "v" || ch === "V") && !isSearching && !isBrowsingFiles) {
          launchVisualizer();
          return;
        }

        if ((keyName === "a" || ch === "a" || ch === "A") && !isSearching && !isBrowsingFiles) {
          openAboutModal();
          return;
        }

        if (keyName === "b" && !isSearching) {
          activateSearchMode(callback);
          return;
        }

        if (keyName === "f" || keyName === "tab") {
          isBrowsingFiles = !isBrowsingFiles;
          searchQuery = "";
          if (isBrowsingFiles) {
            updateDirectoryBrowser();
          } else {
            renderCachedPlaylist();
          }
          return;
        }

        // Lógica interna cuando el Navegador de Carpetas está Activo
        if (isBrowsingFiles) {
          if (keyName === "up") { safeMoveSelector(-1, browseItemsRaw.length); return; }
          if (keyName === "down") { safeMoveSelector(1, browseItemsRaw.length); return; }

          if (keyName === "backspace") {
            currentBrowseDir = path.dirname(currentBrowseDir);
            if (typeof onFolderSelectedCallback === "function") {
              onFolderSelectedCallback(currentBrowseDir);
            }
            updateDirectoryBrowser();
            return;
          }

          if (keyName === "enter") {
            const idx = interactiveList.selected;
            const targetItem = browseItemsRaw[idx];

            if (targetItem) {
              if (targetItem.isDir) {
                currentBrowseDir = targetItem.path;
                if (typeof onFolderSelectedCallback === "function") {
                  onFolderSelectedCallback(currentBrowseDir);
                }
                updateDirectoryBrowser();
              } else if (typeof onFileSelectedCallback === "function") {
                if (typeof onFolderSelectedCallback === "function") {
                  onFolderSelectedCallback(currentBrowseDir);
                }
                onFileSelectedCallback(targetItem.path, targetItem.name.replace("[FILE] ", ""));
                isBrowsingFiles = false;
                renderCachedPlaylist();
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

        // Lógica interna cuando estamos sobre la Tracklist Estándar
        if (!isBrowsingFiles && !isSearching) {
          if (keyName === "up") { safeMoveSelector(-1, interactiveList.items.length); callback(ch, key); return; }
          if (keyName === "down") { safeMoveSelector(1, interactiveList.items.length); callback(ch, key); return; }

          if (keyName === "backspace" && searchQuery) {
            searchQuery = "";
            renderCachedPlaylist();
            return;
          }

          if (keyName === "enter") {
            const idx = interactiveList.selected;
            if (idx === 0) return; // Salta la cabecera del renderizado estilizado

            if (cachedPlaylistData && cachedPlaylistData.playlist) {
              let targetTracks = cachedPlaylistData.playlist;
              if (searchQuery) {
                targetTracks = cachedPlaylistData.playlist.filter((t) =>
                  t.name.toLowerCase().includes(searchQuery.toLowerCase())
                );
              }

              // Ajustamos la selección restando la posición de la cabecera nativa
              const track = targetTracks[idx - 1];
              if (track) {
                const absoluteIndex = cachedPlaylistData.playlist.findIndex((t) => t.path === track.path);
                
                if (absoluteIndex !== -1) {
                  cachedPlaylistData.currentIndex = absoluteIndex;
                  
                  if (typeof onSearchTrackCallback === "function") {
                    onSearchTrackCallback(absoluteIndex);
                  }
                }
              }
            }
            return; 
          }
        }

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
