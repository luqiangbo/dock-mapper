import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const checks = [
  ["工作流与发布脚本语法", process.execPath, [".github/scripts/workflow-preflight.mjs"], root],
  ["Tauri 依赖版本", process.execPath, [".github/scripts/tauri-versions.mjs"], root],
  ["前端类型", "pnpm", ["typecheck"], root],
  ["前端行为", "pnpm", ["test"], root],
  ["发布规则", process.execPath, ["--test", ".github/scripts/release-version.test.mjs", ".github/scripts/release-api.test.mjs", ".github/scripts/release-assets.test.mjs", ".github/scripts/winget-fork.test.mjs", ".github/scripts/workflow-preflight.test.mjs"], root],
  ["Rust 核心行为", "cargo", ["test", "--", "--skip", "model"], fileURLToPath(new URL("../../src-tauri/", import.meta.url))],
];

for (const [label, command, args, cwd] of checks) {
  console.log(`\n检查：${label}`);
  // Windows pnpm installations may expose a .cmd shim that spawnSync cannot execute.
  // Only the fixed pnpm subcommands above use cmd; no user input enters this command.
  const windowsPnpm = process.platform === "win32" && command === "pnpm";
  const result = windowsPnpm
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", [command, ...args].join(" ")], { cwd, stdio: "inherit", windowsHide: true })
    : spawnSync(command, args, { cwd, stdio: "inherit", windowsHide: true });
  if (result.error) throw new Error(`${label} 无法启动：${result.error.message}`);
  if (result.signal) throw new Error(`${label} 被中断：${result.signal}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log("\n本地发布预检通过（尚未验证安装包或真实安装）");
