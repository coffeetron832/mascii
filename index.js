#!/usr/bin/env node

import { spawnSync } from "child_process";
import path from "path"; // Importante para manejar rutas dinámicas del explorador
import { getVersionString } from "./core/version.js";

import { createUI } from "./core/ui.js";
import { createPlayer } from "./core/player.js";
import { createVisualizer } from "./core/visualizer.js";
import { createCommands } from "./core/commands.js";
import { loadPlaylist } from "./core/playlist.js";

console.log(`MASCII ${getVersionString()}`);

function hasBinary(name) {
  const result = spawnSync("which", [name], {
    stdio: "ignore"
  });

  return result.status === 0;
}

function checkDependencies() {
  const required = ["mpv", "yt-dlp", "ffmpeg"];
  const missing = required.filter((dep) => !hasBinary(dep));

  if (missing.length === 0) {
    return;
  }

  console.error("\nMissing dependencies:\n");

  for (const dep of missing) {
    console.error(`  ✗ ${dep}`);
  }

  console.error("\nInstall the missing dependencies and try again.\n");
  console.error("Ubuntu / Debian:");
  console.error("  sudo apt install mpv ffmpeg yt-dlp");

  console.error("\nArch Linux:");
  console.error("  sudo pacman -S mpv ffmpeg yt-dlp");

  console.error("\nFedora:");
  console.error("  sudo dnf install mpv ffmpeg yt-dlp");
  console.error("");

  process.exit(1);
}

function checkOptionalDependencies() {
  const optional = ["cava"];
  const missing = optional.filter((dep) => !hasBinary(dep));

  if (!missing.length) {
    return;
  }

  console.warn("\nOptional dependencies missing:");
  for (const dep of missing) {
    console.warn(`  - ${dep}`);
  }
  console.warn("Visualizer may be limited until they are installed.\n");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  checkDependencies();
  checkOptionalDependencies();

  const ui = createUI();

  if (typeof ui.showSplash === "function") {
    ui.showSplash();
  }

  const splashStartedAt = Date.now();
  const splashMinDurationMs = 2500;

  let playlist = [];

  try {
    playlist = await loadPlaylist("./music");
  } catch (error) {
    ui.appendLog(`
{red-fg}Could not load ./music folder{/red-fg}

${String(error?.message || error)}
    `);
  }

  const player = createPlayer({
    playlist,
    ui
  });

  // SOLUCIÓN: Enlaza la instancia física del reproductor con los métodos internos de consulta de la interfaz
  if (typeof ui.setPlayerCore === "function") {
    ui.setPlayerCore(player);
  }

  const visualizer = createVisualizer({
    ui,
    player
  });

  createCommands({
    ui,
    player,
    visualizer
  });

  // =========================================================================
  // CONTROL DE CONTEXTO DE NAVEGACIÓN
  // =========================================================================
  let isBrowsingFiles = false; 

  // =========================================================================
  // ENLACES ASÍNCRONOS Y CORRECCIÓN DE FLUJO UI <-> PLAYER
  // =========================================================================

  // CORRECCIÓN RADICAL: Extrae directamente del track mutado e ignora los residuos del player de ejecuciones anteriores
  function updateTrackDetails(track) {
    if (!track || typeof ui.setTrackDetails !== "function") return;

    // Prioridad absoluta a los metadatos dinámicos del objeto track, evitando cortocircuitos por variables globales corruptas
    const album = track.album || player.currentAlbumName || "YouTube Stream";
    const year = track.year || player.currentAlbumYear || "2026";
    const trackNum = track.trackNumber || player.currentTrackNumber || "-";

    const extendedInfo = `Album: ${album}\nYear: ${year}\nTrack: ${trackNum}`;
    
    ui.setTrackDetails(track.name, track.artist, extendedInfo);
  }

  // 1. Enlace para reproducir instantáneamente al presionar Enter en la lista de tracks principal
  if (typeof ui.onSearchTrack === "function") {
    ui.onSearchTrack((absoluteIndex) => {
      player.stop();                  
      player.setIndex(absoluteIndex); 
      player.play();                  
      
      if (typeof player.getCurrentTrack === "function") {
        updateTrackDetails(player.getCurrentTrack());
      }
    });
  }

  // 2. Enlace cuando el usuario selecciona un archivo desde el navegador (F / TAB)
  if (typeof ui.onFileSelected === "function") {
    ui.onFileSelected(async (filePath, fileName) => {
      try {
        const targetFolder = path.dirname(filePath);
        
        ui.appendLog(`{yellow-fg}Loading entire folder content...{/}`);

        const newPlaylist = await player.setMusicDir(targetFolder);

        const trackIndex = newPlaylist.findIndex(
          (track) => path.resolve(track.path) === path.resolve(filePath)
        );

        if (trackIndex !== -1) {
          player.stop();
          player.setIndex(trackIndex);
          player.play();
          
          ui.setPlaylist(newPlaylist, trackIndex);
          ui.appendLog(`{green-fg}Playing folder track:{/green-fg} ${fileName}`);
          
          isBrowsingFiles = false; 

          updateTrackDetails(newPlaylist[trackIndex]);
        } else {
          player.play();
        }
      } catch (err) {
        ui.appendLog(`{red-fg}Error opening folder context:{/red-fg} ${err.message}`);
      }
    });
  }

  // CORRECCIÓN INTERNA: Al procesar el evento del núcleo, forzamos la actualización visual
  if (typeof player.on === "function") {
    player.on("trackChange", (track) => {
      updateTrackDetails(track);
      
      if (typeof player.getTracks === "function" && typeof player.getCurrentIndex === "function") {
        ui.setPlaylist(player.getTracks(), player.getCurrentIndex());
      }
    });
  }

  // 3. Enlace cuando el usuario cambia de directorio en el navegador
  if (typeof ui.onFolderSelected === "function") {
    ui.onFolderSelected((newDirPath) => {
      // Mantiene el explorador abierto de forma libre
    });
  }

  // =========================================================================
  // CORRECCIÓN REORGANIZADA: CARGA DIRECTA DE STREAM DESDE LA PREVIEW CARD
  // =========================================================================
  if (typeof ui.onYoutubeUrlSubmitted === "function") {
    ui.onYoutubeUrlSubmitted(async (url) => {
      try {
        ui.appendLog(`{yellow-fg}Connecting to remote stream...{/}`);
        player.stop();

        // RESET DE CONTEXTO: Limpiamos los residuos de la canción de YouTube anterior antes de inyectar el nuevo link
        player.currentAlbumName = undefined;
        player.currentAlbumYear = undefined;
        player.currentTrackNumber = undefined;

        // Mapeo adaptativo según tu core/player.js
        if (typeof player.playYoutube === "function") {
          await player.playYoutube(url);
        } else if (typeof player.playRemoteStream === "function") {
          await player.playRemoteStream(url);
        } else if (typeof player.play === "function") {
          await player.play(url);
        }

        ui.appendLog(`{green-fg}Streaming URL successfully loaded!{/green-fg}`);
        
        // Renderizado inmediato usando el estado actual remoto extraído por el backend
        if (typeof player.getCurrentTrack === "function") {
          const currentTrack = player.getCurrentTrack();
          updateTrackDetails(currentTrack);
          
          if (typeof player.getTracks === "function" && typeof player.getCurrentIndex === "function") {
            ui.setPlaylist(player.getTracks(), player.getCurrentIndex());
          }
        }

      } catch (err) {
        ui.appendLog(`{red-fg}Streaming Failure:{/red-fg} ${err.message}`);
        player.play().catch(() => {});
      }
    });
  }

  // 4. Iniciar la captura de teclado del bucle general pasándole las acciones globales
  ui.getInput((ch, key) => {
    if (!key) return;
    const name = key.name;

    if (name === "f" || name === "tab") {
      isBrowsingFiles = !isBrowsingFiles;
      return;
    }

    if (name === "escape") {
      isBrowsingFiles = false;
      return;
    }

    switch (name) {
      case "space":
        player.toggle();
        break;
      case "n":
        player.next();
        if (typeof player.getCurrentTrack === "function") updateTrackDetails(player.getCurrentTrack());
        break;
      case "p":
        player.prev();
        if (typeof player.getCurrentTrack === "function") updateTrackDetails(player.getCurrentTrack());
        break;
      case "l":
        player.toggleLoop();
        break;
      case "z":
        player.toggleShuffle();
        break;
      case "e":
        player.cycleEQ();
        break;
      case "s":
        player.stop();
        break;
      case "up":
      case "down":
        if (!isBrowsingFiles) {
          const currentVol = player.getVolume();
          player.setVolume(name === "up" ? currentVol + 5 : currentVol - 5);
        }
        break;
    }
  });

  // Enlazar el redimensionamiento dinámico del arte ASCII (Braille) con Sharp
  if (typeof ui.onResize === "function") {
    ui.onResize(() => {
      player.resizeAlbumArt().catch(() => {});
    });
  }

  // Sincronizar e imprimir los valores de los paneles informativos del estado base inicial
  if (typeof ui.setVolumeState === "function") {
    ui.setVolumeState(player.getVolume(), player.getLoop(), player.getShuffle(), player.getEQMode());
  }
  
  if (typeof player.loadTracks === "function" && playlist.length > 0) {
    player.loadTracks().catch(() => {});
  }

  // =========================================================================
  // CONTROL DE FINALIZACIÓN DE LA PANTALLA DE CARGA (SPLASH ART)
  // =========================================================================

  const elapsedSplashTime = Date.now() - splashStartedAt;
  const remainingSplashTime = Math.max(0, splashMinDurationMs - elapsedSplashTime);

  if (remainingSplashTime > 0) {
    await sleep(remainingSplashTime);
  }

  if (typeof ui.hideSplash === "function") {
    ui.hideSplash();
  }

  let cleanedUp = false;

  function cleanup(exitCode = null) {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;

    try {
      visualizer.stop?.();
    } catch {}

    try {
      player.stop?.();
    } catch {}

    try {
      ui.destroy?.();
    } catch {}

    if (typeof exitCode === "number") {
      process.exit(exitCode);
    }
  }

  process.once("SIGINT", () => {
    cleanup(0);
  });

  process.once("SIGTERM", () => {
    cleanup(0);
  });

  process.once("uncaughtException", (error) => {
    try {
      cleanup();
    } finally {
      console.error("\nFatal Error:\n");
      console.error(error);
      process.exit(1);
    }
  });

  process.once("unhandledRejection", (error) => {
    try {
      cleanup();
    } finally {
      console.error("\nUnhandled Promise Rejection:\n");
      console.error(error);
      process.exit(1);
    }
  });

  ui.screen.key(["q"], () => {
    cleanup(0);
  });

  visualizer.start();
  ui.render();
}

main();
