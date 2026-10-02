import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { verifyUpdaterSignature } from "./release-assets.mjs";
import { checkTauriVersions } from "./tauri-versions.mjs";

// Runs only on the release runner, before the expensive application build.
await checkTauriVersions();
if (!process.env.TAURI_SIGNING_PRIVATE_KEY) throw new Error("TAURI_SIGNING_PRIVATE_KEY is required for releases");
if (!process.env.RUNNER_TEMP) throw new Error("Signing preflight requires RUNNER_TEMP");
const probe = join(process.env.RUNNER_TEMP, "dockmapper-signing-probe.txt");
const content = Buffer.from("DockMapper updater signing preflight\n");
await writeFile(probe, content);
const cli = join(process.cwd(), "node_modules/@tauri-apps/cli/tauri.js");
const result = spawnSync(process.execPath, [cli, "signer", "sign", probe], {
  stdio: ["ignore", "inherit", "inherit"], timeout: 60000,
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error("Updater signing preflight failed; check private key and password");
const config = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8"));
verifyUpdaterSignature(content, (await readFile(`${probe}.sig`, "utf8")).trim(), config.plugins.updater.pubkey);
console.log("Updater private key/password and application public key match");
