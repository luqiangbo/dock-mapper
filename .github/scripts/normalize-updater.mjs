import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeUpdaterUrls } from "./release-assets.mjs";

// The workflow supplies the ID of the exact installer from the current release.
try {
  const args = process.argv.slice(2);
  if (args.length !== 4) throw new Error("Expected: directory owner/repo version installer-asset-id");
  const [directory, repo, version, assetId] = args;
  const path = join(directory, "latest.json");
  const updater = JSON.parse(await readFile(path, "utf8"));
  const signature = await readFile(join(directory, `DockMapper_${version}_x64-setup.exe.sig`), "utf8");
  const normalized = normalizeUpdaterUrls(updater, { version, repo, signature, assetId });
  await writeFile(path, `${JSON.stringify(normalized, null, 2)}\n`);
} catch (error) {
  console.error(`更新清单地址准备失败：${error.message}`);
  process.exitCode = 1;
}
