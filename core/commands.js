import fs from "fs";
import path from "path";
import blessed from "blessed";
import { spawn } from "child_process";

const YTDLP_PATH = process.env.YTDLP_PATH || "/usr/local/bin/yt-dlp";

export function createCommands({ ui, player }) {
  let isLocked = false;
  let promptOpen = false;

  function log(message = "") {
    ui.appendLog(message);
  }

  function updatePlaylistUI() {
    if (
      typeof player.getTracks === "function" &&
      typeof player.getCurrentIndex === "function"
    ) {
      const tracks = player.getTracks();
      const currentIndex = player.getCurrentIndex();
      ui.setPlaylist(tracks, currentIndex);
    }

    if (typeof ui.setVolumeState === "function") {
      ui.setVolumeState(
        player.getVolume?.() ?? 0,
        player.isLoop?.() ?? false,
        player.isShuffle?.() ?? false,
        player.getEQ?.() ?? "FLAT"
      );
    }

    if (typeof ui.render === "function") {
      ui.render();
    }
  }

  function importPath(targetPath) {
    const trimmedPath = String(targetPath || "").trim();

    if (!trimmedPath) {
      log(`{red-fg}Missing path{/red-fg}\nUse a folder or file path.`);
      return;
    }

    const resolved = path.resolve(trimmedPath);

    if (!fs.existsSync(resolved)) {
      log(`{red-fg}Path not found{/red-fg}\n${resolved}`);
      return;
    }

    const musicDir = path.resolve("./music");

    if (!fs.existsSync(musicDir)) {
      fs.mkdirSync(musicDir, { recursive: true });
    }

    const supported = new Set([".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac"]);
    let copied = 0;

    function copyFile(filePath) {
      const ext = path.extname(filePath).toLowerCase();
      if (!supported.has(ext)) return;

      const filename = path.basename(filePath);
      const destination = path.join(musicDir, filename);

      try {
        fs.copyFileSync(filePath, destination);
        copied++;
      } catch {
        log(`{red-fg}Copy failed:{/red-fg} ${filename}`);
      }
    }

    const stats = fs.statSync(resolved);

    if (stats.isDirectory()) {
      const files = fs.readdirSync(resolved);
      for (const file of files) {
        copyFile(path.join(resolved, file));
      }
    } else {
      copyFile(resolved);
    }

    log(`{green-fg}Imported ${copied} file(s){/green-fg} to ./music`);

    if (typeof player.loadTracks === "function") {
      player.loadTracks();
      updatePlaylistUI();
    }
  }

  function runYtDlpJson(url) {
    return new Promise((resolve) => {
      const proc = spawn(
        YTDLP_PATH,
        [
          "--dump-single-json",
          "--no-playlist",
          "--no-warnings",
          url
        ],
        {
          stdio: ["ignore", "pipe", "pipe"]
        }
      );

      let stdout = "";

      proc.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      proc.on("error", () => {
        resolve(null);
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          resolve(null);
          return;
        }

        try {
          resolve(JSON.parse(stdout));
        } catch {
          resolve(null);
        }
      });
    });
  }

  function isYoutubeUrl(url) {
    return (
      typeof url === "string" &&
      (url.includes("youtube.com") || url.includes("youtu.be"))
    );
  }

  function extractFallbackTitle(url) {
    try {
      const urlObj = new URL(url);

      if (urlObj.searchParams.has("v")) {
        return `YT: ${urlObj.searchParams.get("v")}`;
      }

      const lastPart = urlObj.pathname.split("/").filter(Boolean).pop();
      return `YT: ${lastPart || "Stream"}`;
    } catch {
      return "YouTube Stream";
    }
  }

  async function openYoutubePrompt() {
    if (isLocked || promptOpen) return;

    isLocked = true;
    promptOpen = true;

    // Caja contenedora del formulario
    const formBox = blessed.box({
      parent: ui.screen,
      width: 90,
      height: 7,
      top: "center",
      left: "center",
      border: { type: "line" },
      label: " Paste YouTube URL ",
      tags: true,
      style: {
        border: { fg: "orange" },
        bg: "black",
        fg: "white"
      }
    });

    // Label instruccional en inglés
    blessed.element({
      parent: formBox,
      top: 1,
      left: 2,
      content: "Paste YouTube URL and press ENTER (ESC to cancel):",
      style: { bg: "black", fg: "white" }
    });

    // Input de texto clásico adaptado
    const inputField = blessed.textbox({
      parent: formBox,
      top: 3,
      left: 2,
      width: 84,
      height: 1,
      inputOnFocus: true,
      style: {
        bg: "white",
        fg: "black"
      }
    });

    const closePrompt = () => {
      try {
        inputField.unkey("escape");
        formBox.destroy();
      } catch {}

      promptOpen = false;
      isLocked = false;

      if (ui.screen) {
        ui.screen.grabKeys = false;
        ui.screen.render();
      }
    };

    // Salida limpia con Escape
    inputField.key(["escape"], () => {
      closePrompt();
    });

    // Procesar envío de datos con Enter
    inputField.on("submit", async (value) => {
      const url = String(value || "").trim();
      closePrompt();

      if (!url) return;

      if (!isYoutubeUrl(url) && !url.startsWith("http")) {
        log(`{red-fg}Invalid streaming URL{/red-fg}`);
        return;
      }

      const fallbackTitle = extractFallbackTitle(url);
      log(`{yellow-fg}Resolving YouTube metadata...{/yellow-fg}`);

      const meta = isYoutubeUrl(url) ? await runYtDlpJson(url) : null;
      const title = meta?.title || fallbackTitle;
      const artist = meta?.uploader || meta?.channel || meta?.uploader_id || "YouTube";
      const duration = Number.isFinite(meta?.duration) ? Math.max(1, Math.round(meta.duration)) : 0;
      const thumbnail = meta?.thumbnail || null;

      if (typeof player.addTrack === "function") {
        player.addTrack({
          name: title,
          path: url,
          duration,
          artist,
          thumbnail,
          source: isYoutubeUrl(url) ? "youtube" : "stream",
          webpage_url: url
        });
        log(`{green-fg}URL added to playlist!{/green-fg}`);
      } else {
        log(`{red-fg}Player cannot add tracks{/red-fg}`);
      }

      updatePlaylistUI();
    });

    // Despierta el render y enfoca el campo de texto directamente de forma nativa
    ui.screen.render();
    inputField.focus();
  }

  function runCommand(commandName, args = []) {
    switch (commandName) {
      case "toggle":
        player.toggle?.();
        break;

      case "next":
        player.next?.();
        break;

      case "prev":
        player.prev?.();
        break;

      case "stop":
        player.stop?.();
        break;

      case "volup":
        if (typeof player.setVolume === "function") {
          const currentVol = player.getVolume?.() ?? 0;
          player.setVolume(Math.min(100, currentVol + 5));
        }
        break;

      case "voldown":
        if (typeof player.setVolume === "function") {
          const currentVol = player.getVolume?.() ?? 0;
          player.setVolume(Math.max(0, currentVol - 5));
        }
        break;

      case "loop":
        player.toggleLoop?.();
        break;

      case "shuffle":
        player.toggleShuffle?.();
        break;

      case "eq":
        player.cycleEQ?.();
        break;

      case "load":
        if (isLocked) return;
        isLocked = true;
        try {
          importPath(args.join(" "));
        } finally {
          isLocked = false;
        }
        break;

      case "youtube":
        openYoutubePrompt();
        break;

      case "quit":
        player.stop?.();
        ui.screen?.destroy?.();
        process.exit(0);
        return;

      default:
        break;
    }

    updatePlaylistUI();
  }

  if (ui.screen) {
    ui.screen.removeAllListeners("keypress");
  }

  ui.getInput((ch, key) => {
    if (isLocked || promptOpen) return;

    const name = key ? key.name : "";

    if (name === "space") {
      runCommand("toggle");
    } else if (name === "n") {
      runCommand("next");
    } else if (name === "p") {
      runCommand("prev");
    } else if (name === "s") {
      runCommand("stop");
    } else if (ch === "+" || name === "up") {
      runCommand("volup");
    } else if (ch === "-" || name === "down") {
      runCommand("voldown");
    } else if (ch === "l") {
      runCommand("loop");
    } else if (ch === "z") {
      runCommand("shuffle");
    } else if (ch === "e") {
      runCommand("eq");
    } else if (ch === "y") {
      runCommand("youtube");
    } else if (name === "q" || (key && key.ctrl && name === "c")) {
      runCommand("quit");
    }
  });

  updatePlaylistUI();
}
