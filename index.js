#!/usr/bin/env node

import { spawnSync } from "child_process";
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

  const visualizer = createVisualizer({
    ui,
    player
  });

  createCommands({
    ui,
    player,
    visualizer
  });

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
