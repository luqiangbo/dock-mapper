import { readFile, writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const checkOnly = args[0] === "--check";
const version = checkOnly ? args[1] : args[0];

if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("用法：pnpm version:sync <x.y.z> 或 node sync-version.mjs --check <x.y.z>");
  process.exit(1);
}

const packagePath = "package.json";
const cargoPath = "src-tauri/Cargo.toml";
const tauriPath = "src-tauri/tauri.conf.json";

const [packageText, cargoText, tauriText] = await Promise.all([
  readFile(packagePath, "utf8"),
  readFile(cargoPath, "utf8"),
  readFile(tauriPath, "utf8"),
]);

const packageJson = JSON.parse(packageText);
const tauriJson = JSON.parse(tauriText);
const cargoMatch = cargoText.match(/(\[package\][\s\S]*?\nversion\s*=\s*")([^"]+)(")/);

if (!cargoMatch) {
  throw new Error("未找到 Cargo [package] version");
}

if (checkOnly) {
  const actual = {
    "package.json": packageJson.version,
    "src-tauri/Cargo.toml": cargoMatch[2],
    "src-tauri/tauri.conf.json": tauriJson.version,
  };
  const mismatches = Object.entries(actual).filter(([, value]) => value !== version);
  if (mismatches.length) {
    for (const [file, value] of mismatches) {
      console.error(`${file}: ${value}，预期 ${version}`);
    }
    process.exit(1);
  }
  console.log(`版本校验通过：${version}`);
  process.exit(0);
}

packageJson.version = version;
tauriJson.version = version;
const nextCargo = cargoText.replace(
  /(\[package\][\s\S]*?\nversion\s*=\s*")([^"]+)(")/,
  `$1${version}$3`,
);

await Promise.all([
  writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`),
  writeFile(cargoPath, nextCargo),
  writeFile(tauriPath, `${JSON.stringify(tauriJson, null, 2)}\n`),
]);

console.log(`版本已同步为 ${version}`);
