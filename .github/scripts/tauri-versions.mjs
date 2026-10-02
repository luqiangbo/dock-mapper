import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const pairs = [
  ["tauri", "api"],
  ["tauri-plugin-autostart", "plugin-autostart"],
  ["tauri-plugin-opener", "plugin-opener"],
  ["tauri-plugin-process", "plugin-process"],
  ["tauri-plugin-updater", "plugin-updater"],
];

export function assertMatchingTauriVersions(versions) {
  for (const { name, rust, npm } of versions) {
    if (!/^\d+\.\d+\.\d+$/.test(rust ?? "") || !/^\d+\.\d+\.\d+$/.test(npm ?? "")) throw new Error(`Missing/invalid Tauri version: ${name}`);
    if (rust.split(".").slice(0, 2).join(".") !== npm.split(".").slice(0, 2).join(".")) {
      throw new Error(`Tauri version mismatch: ${name}, Rust ${rust}, npm ${npm}; align major/minor versions before building`);
    }
  }
}

export async function checkTauriVersions() {
  const lock = (await readFile(join(root, "src-tauri/Cargo.lock"), "utf8")).replace(/\r\n/g, "\n");
  const versions = await Promise.all(pairs.map(async ([crate, packageName]) => {
    const block = lock.split("[[package]]").find((item) => item.includes(`\nname = "${crate}"\n`));
    const rust = block?.match(/\nversion = "([^"]+)"/)?.[1];
    const npm = JSON.parse(await readFile(join(root, `node_modules/@tauri-apps/${packageName}/package.json`), "utf8")).version;
    return { name: crate, rust, npm };
  }));
  assertMatchingTauriVersions(versions);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await checkTauriVersions();
  console.log("Tauri API/plugin major/minor versions match the Rust lockfile");
}
