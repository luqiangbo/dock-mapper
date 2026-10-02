import { createHash, createPublicKey, verify } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

async function readReleaseAsset(directory, name, encoding) {
  const path = join(directory, name);
  try {
    return await readFile(path, encoding);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const assetError = new Error(
      `缺少发布产物：${resolve(path)}（${error.code}）\n` +
      "release:verify 只校验已有产物，不会构建或生成 build-info.json。\n" +
      "请从同一次 CI 发布下载 build-info.json、latest.json、安装包及其 .sig 到同一目录，" +
      "然后运行 pnpm release:verify <产物目录>。\n" +
      "build-info.json 由发布 CI 生成；旧版本若没有此文件，无法完成此项校验。",
      { cause: error },
    );
    assetError.code = error.code;
    throw assetError;
  }
}

function decodeBase64(value) {
  if (typeof value !== "string" || !value.trim() || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.trim())) {
    throw new Error("Invalid updater signature/key encoding");
  }
  const decoded = Buffer.from(value.trim(), "base64");
  if (decoded.toString("base64").replace(/=+$/, "") !== value.trim().replace(/=+$/, "")) {
    throw new Error("Invalid updater signature/key encoding");
  }
  return decoded;
}

// Tauri stores Base64-encoded Minisign documents. Verify both the file signature
// and the global signature protecting the trusted comment, just like the updater.
export function verifyUpdaterSignature(content, encodedSignature, encodedPublicKey) {
  const keyLines = decodeBase64(encodedPublicKey).toString("utf8").trim().split(/\r?\n/);
  const lines = decodeBase64(encodedSignature).toString("utf8").trim().split(/\r?\n/);
  if (keyLines.length !== 2 || lines.length !== 4 || !keyLines[0].startsWith("untrusted comment: ") ||
      !lines[0].startsWith("untrusted comment: ") || !lines[2].startsWith("trusted comment: ")) {
    throw new Error("Invalid Minisign document encoding");
  }
  const key = decodeBase64(keyLines[1]);
  const packet = decodeBase64(lines[1]);
  const globalSignature = decodeBase64(lines[3]);
  if (key.length !== 42 || packet.length !== 74 || globalSignature.length !== 64) {
    throw new Error("Invalid Minisign packet encoding");
  }
  const algorithm = packet.subarray(0, 2).toString("ascii");
  if (!["Ed", "ED"].includes(key.subarray(0, 2).toString("ascii")) || !["Ed", "ED"].includes(algorithm)) {
    throw new Error("Unsupported Minisign algorithm");
  }
  if (!key.subarray(2, 10).equals(packet.subarray(2, 10))) throw new Error("Updater key ID mismatch");
  const publicKey = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), key.subarray(10)]),
    type: "spki", format: "der",
  });
  const signature = packet.subarray(10);
  const message = algorithm === "ED" ? createHash("blake2b512").update(content).digest() : content;
  const trustedComment = Buffer.from(lines[2].slice("trusted comment: ".length));
  if (!verify(null, message, publicKey, signature) ||
      !verify(null, Buffer.concat([signature, trustedComment]), publicKey, globalSignature)) {
    throw new Error("Updater signature verification failed");
  }
}

export function validateUpdater(updater, { version, repo, signature }) {
  if (typeof updater.version !== "string" || updater.version.replace(/^v/, "") !== version) {
    throw new Error("Updater version mismatch");
  }
  const platforms = updater.platforms;
  if (!platforms || !Object.hasOwn(platforms, "windows-x86_64")) throw new Error("Updater windows-x86_64 platform missing");
  const expectedUrl = `https://github.com/${repo}/releases/download/v${version}/DockMapper_${version}_x64-setup.exe`;
  for (const [name, platform] of Object.entries(platforms)) {
    if (!platform || platform.url !== expectedUrl) {
      throw new Error(`Updater URL mismatch (${name}): expected ${expectedUrl}, received ${JSON.stringify(platform?.url)}`);
    }
    if (typeof platform.signature !== "string" || platform.signature.trim() !== signature.trim()) {
      throw new Error(`Updater signature mismatch (${name}): latest.json 与安装包 .sig 不一致`);
    }
  }
}

export function normalizeUpdaterUrls(updater, { version, repo, signature, assetId }) {
  if (!/^[1-9]\d*$/.test(String(assetId))) throw new Error("Invalid installer asset ID");
  const apiUrl = `https://api.github.com/repos/${repo}/releases/assets/${assetId}`;
  const downloadUrl = `https://github.com/${repo}/releases/download/v${version}/DockMapper_${version}_x64-setup.exe`;
  const normalized = { ...updater, platforms: Object.fromEntries(
    Object.entries(updater.platforms ?? {}).map(([name, platform]) => [name,
      platform?.url === apiUrl ? { ...platform, url: downloadUrl } : platform,
    ]),
  ) };
  validateUpdater(normalized, { version, repo, signature });
  return normalized;
}

export async function verifyReleaseAssets({ directory = "release-assets", repo, version, sha, publicKey }) {
  const metadata = JSON.parse(await readReleaseAsset(directory, "build-info.json", "utf8"));
  const manifestBytes = await readReleaseAsset(directory, "latest.json");
  const updater = JSON.parse(manifestBytes.toString("utf8"));
  if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[a-f0-9]{40}$/.test(sha ?? "") ||
      metadata.version !== version || metadata.sha !== sha) throw new Error("Release provenance/version mismatch");
  const installerName = `DockMapper_${version}_x64-setup.exe`;
  const installer = await readReleaseAsset(directory, installerName);
  if (!installer.length) throw new Error("Installer is empty");
  const signature = (await readReleaseAsset(directory, `${installerName}.sig`, "utf8")).trim();
  validateUpdater(updater, { version, repo, signature });
  const names = Object.keys(metadata.sha256 ?? {});
  if (names.length !== 2 || !names.includes(installerName) || !names.includes("latest.json")) throw new Error("Incomplete provenance");
  for (const [name, content] of [[installerName, installer], ["latest.json", manifestBytes]]) {
    if (createHash("sha256").update(content).digest("hex") !== metadata.sha256[name]) throw new Error(`Asset checksum mismatch: ${name}`);
  }
  const config = JSON.parse(await readFile(join(repositoryRoot, "src-tauri/tauri.conf.json"), "utf8"));
  verifyUpdaterSignature(installer, signature, publicKey ?? config.plugins.updater.pubkey);
  return metadata;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 0 && args.length !== 1 && args.length !== 4) {
    throw new Error("用法：pnpm release:verify [产物目录] [owner/repo 版本 完整40位提交号]");
  }
  const directory = args[0] ?? "release-assets";
  let [repo, version, sha] = args.slice(1);
  if (args.length < 4) {
    const config = JSON.parse(await readFile(join(repositoryRoot, "src-tauri/tauri.conf.json"), "utf8"));
    const endpoint = config.plugins?.updater?.endpoints?.[0];
    const match = typeof endpoint === "string" && endpoint.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/latest\/download\/latest\.json$/);
    if (!match) throw new Error("无法从更新地址识别 GitHub 仓库；请传入完整参数");
    repo = match[1];
    version = JSON.parse(await readReleaseAsset(directory, "build-info.json", "utf8")).version;
    const git = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" });
    if (git.error || git.status !== 0) throw new Error("无法读取当前提交；请传入完整参数");
    sha = git.stdout.trim();
  }
  await verifyReleaseAssets({ directory, repo, version, sha });
  console.log(`发布产物、公钥签名与更新清单校验通过：${version}，提交 ${sha}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`发布产物校验失败：${error.message}`);
    process.exitCode = 1;
  });
}
