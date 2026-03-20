import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function prependCargoToPath() {
  const home = os.homedir();
  const cargoBin = path.join(home, ".cargo", "bin");

  if (!existsSync(cargoBin)) {
    return;
  }

  const currentPath = process.env.PATH ?? "";
  const parts = currentPath.split(path.delimiter);
  if (!parts.includes(cargoBin)) {
    process.env.PATH = `${cargoBin}${path.delimiter}${currentPath}`;
  }
}

prependCargoToPath();

function ensureDistExists() {
  const distDir = path.resolve(process.cwd(), "dist");
  if (existsSync(distDir)) {
    return;
  }

  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmCmd, ["run", "build"], {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

ensureDistExists();

const tauriBin = process.platform === "win32" ? "tauri.cmd" : "tauri";
const child = spawn(tauriBin, ["dev"], {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on("error", (err) => {
  console.error(err.message);
  process.exit(1);
});
