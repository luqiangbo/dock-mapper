import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const checkOnly = args[0] === "--check";
const version = checkOnly ? args[1] : args[0];

if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("用法：pnpm version:sync <x.y.z> 或 node sync-version.mjs --check <x.y.z>");
  process.exit(1);
}

const cargoPath = "src-tauri/Cargo.toml";
const lockPath = "src-tauri/Cargo.lock";
const cargoVersionPattern = /(\[package\][\s\S]*?\r?\nversion\s*=\s*")([^"]+)(")/;
const lockVersionPattern = /(\[\[package\]\]\r?\nname = "dock-mapper"\r?\nversion = ")([^"]+)(")/;

const [cargoText, lockText] = await Promise.all([
  readFile(cargoPath, "utf8"),
  readFile(lockPath, "utf8"),
]);

const cargoMatch = cargoText.match(cargoVersionPattern);
const lockMatch = lockText.match(lockVersionPattern);

if (!cargoMatch) {
  throw new Error("未找到 Cargo [package] version");
}
if (!lockMatch) {
  throw new Error("未找到 Cargo.lock 中的 dock-mapper version");
}

if (checkOnly) {
  const actual = {
    "src-tauri/Cargo.toml": cargoMatch[2],
    "src-tauri/Cargo.lock": lockMatch[2],
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

if (cargoMatch[2] === version && lockMatch[2] === version) {
  console.log(`版本已经是 ${version}`);
  process.exit(0);
}

const nextCargo = cargoText.replace(cargoVersionPattern, (_match, prefix, _current, suffix) =>
  `${prefix}${version}${suffix}`,
);

function refreshCargoLock() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "cargo",
      ["update", "--manifest-path", cargoPath, "--package", "dock-mapper"],
      {
        cwd: process.cwd(),
        stdio: ["ignore", "ignore", "inherit"],
        windowsHide: true,
      },
    );

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`cargo update 失败，退出码：${code}`));
    });
  });
}

try {
  await writeFile(cargoPath, nextCargo);
  await refreshCargoLock();

  const refreshedLock = await readFile(lockPath, "utf8");
  const refreshedLockMatch = refreshedLock.match(lockVersionPattern);
  if (refreshedLockMatch?.[2] !== version) {
    throw new Error(`Cargo.lock 版本未更新为 ${version}`);
  }
} catch (error) {
  await Promise.all([writeFile(cargoPath, cargoText), writeFile(lockPath, lockText)]);
  throw error;
}

console.log(`版本已同步为 ${version}`);
