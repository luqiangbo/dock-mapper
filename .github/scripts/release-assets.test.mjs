import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyUpdaterSignature, validateUpdater, verifyReleaseAssets } from "./release-assets.mjs";
import { assertMatchingTauriVersions } from "./tauri-versions.mjs";

test("产物目录为空时说明下载前置条件并以失败状态退出", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dockmapper-empty-assets-"));
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./release-assets.mjs", import.meta.url)), directory], { encoding: "utf8" });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /缺少发布产物：.*build-info\.json/);
  assert.match(result.stderr, /ENOENT/);
  assert.match(result.stderr, /从同一次 CI 发布下载/);
  assert.doesNotMatch(result.stderr, /node:internal|at async/);
});

test("指定完整参数时也会说明缺失产物的准备方式", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dockmapper-missing-assets-"));
  const options = { directory, repo: "owner/repo", version: "2026.1002.1", sha: "a".repeat(40) };
  await assert.rejects(verifyReleaseAssets(options), (error) => {
    assert.match(error.message, /缺少发布产物：.*build-info\.json.*ENOENT/);
    assert.equal(error.code, "ENOENT");
    assert.equal(error.cause.code, "ENOENT");
    return true;
  });
  await writeFile(join(directory, "build-info.json"), JSON.stringify({ version: options.version, sha: options.sha }));
  await assert.rejects(verifyReleaseAssets(options), /缺少发布产物：.*latest\.json/);
});

test("构建前拒绝前后端次版本不一致，允许补丁版本不同", () => {
  assertMatchingTauriVersions([{ name: "tauri", rust: "2.11.5", npm: "2.11.1" }]);
  assert.throws(() => assertMatchingTauriVersions([{ name: "tauri", rust: "2.11.5", npm: "2.12.1" }]), /version mismatch/);
  assert.throws(() => assertMatchingTauriVersions([{ name: "updater", rust: "2.11.0", npm: "2.13.1" }]), /version mismatch/);
  assert.throws(() => assertMatchingTauriVersions([{ name: "tauri", npm: "2.11.1" }]), /invalid Tauri version/);
});

// Published minisign-verify interoperability vector, not produced by our verifier.
const publicKey = Buffer.from("untrusted comment: fixture\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3\n").toString("base64");
const signature = Buffer.from("untrusted comment: signature from minisign secret key\nRUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=\ntrusted comment: timestamp:1633700835\tfile:test\tprehashed\nwLMDjy9FLAuxZ3q4NlEvkgtyhrr0gtTu6KC4KBJdITbbOeAi1zBIYo0v4iTgt8jJpIidRJnp94ABQkJAgAooBQ==\n").toString("base64");

test("验证真实 Minisign 预哈希签名并拒绝被篡改的安装包", () => {
  verifyUpdaterSignature(Buffer.from("test"), signature, publicKey);
  assert.throws(() => verifyUpdaterSignature(Buffer.from("tampered"), signature, publicKey), /signature verification failed/);
});

test("拒绝被篡改的可信注释以及不同的更新公钥", () => {
  const changed = Buffer.from(signature, "base64").toString().replace("file:test", "file:other");
  assert.throws(() => verifyUpdaterSignature(Buffer.from("test"), Buffer.from(changed).toString("base64"), publicKey), /signature verification failed/);
  const changedKey = Buffer.from(publicKey, "base64").toString().replace("RWQf", "RWQg");
  assert.throws(() => verifyUpdaterSignature(Buffer.from("test"), signature, Buffer.from(changedKey).toString("base64")), /key ID mismatch/);
});

test("接受 Tauri 非预哈希签名并拒绝损坏的编码", () => {
  const { privateKey, publicKey: key } = generateKeyPairSync("ed25519");
  const rawKey = key.export({ type: "spki", format: "der" }).subarray(-32);
  const keyId = Buffer.alloc(8, 1);
  const content = Buffer.from("installer");
  const sig = sign(null, content, privateKey);
  const comment = "timestamp:1\tfile:installer";
  const packet = Buffer.concat([Buffer.from("Ed"), keyId, sig]);
  const global = sign(null, Buffer.concat([sig, Buffer.from(comment)]), privateKey);
  const encodedKey = Buffer.from(`untrusted comment: test\n${Buffer.concat([Buffer.from("Ed"), keyId, rawKey]).toString("base64")}\n`).toString("base64");
  const encodedSig = Buffer.from(`untrusted comment: test\n${packet.toString("base64")}\ntrusted comment: ${comment}\n${global.toString("base64")}\n`).toString("base64");
  verifyUpdaterSignature(content, encodedSig, encodedKey);
  assert.throws(() => verifyUpdaterSignature(content, "not base64", encodedKey), /encoding/);
});

const version = "2026.1002.1";
const repo = "owner/repo";
const url = `https://github.com/${repo}/releases/download/v${version}/DockMapper_${version}_x64-setup.exe`;
const updater = () => ({ version, platforms: { "windows-x86_64": { url, signature } } });
test("更新清单必须包含 Windows x64、正确版本、固定版本 URL 和相同签名", () => {
  validateUpdater(updater(), { version, repo, signature });
  assert.throws(() => validateUpdater({ version, platforms: { linux: { url, signature } } }, { version, repo, signature }), /windows-x86_64/);
  for (const field of ["url", "signature"]) {
    const manifest = updater();
    manifest.platforms["windows-x86_64"][field] = "wrong";
    assert.throws(() => validateUpdater(manifest, { version, repo, signature }));
  }
  assert.throws(() => validateUpdater({ ...updater(), version: "1.1.5" }, { version, repo, signature }), /version mismatch/);
});

test("产物目录通过公钥验证后才能发布，摘要或来源不一致则失败", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dockmapper-assets-"));
  const sha = "a".repeat(40);
  const installerName = `DockMapper_${version}_x64-setup.exe`;
  const manifest = JSON.stringify(updater());
  const metadata = { version, sha, sha256: {
    [installerName]: createHash("sha256").update("test").digest("hex"),
    "latest.json": createHash("sha256").update(manifest).digest("hex"),
  } };
  await Promise.all([
    writeFile(join(directory, installerName), "test"),
    writeFile(join(directory, `${installerName}.sig`), signature),
    writeFile(join(directory, "latest.json"), manifest),
    writeFile(join(directory, "build-info.json"), JSON.stringify(metadata)),
  ]);
  await verifyReleaseAssets({ directory, repo, version, sha, publicKey });
  await assert.rejects(verifyReleaseAssets({ directory, repo, version, sha: "b".repeat(40), publicKey }), /provenance/);
  await writeFile(join(directory, installerName), "tampered");
  await assert.rejects(verifyReleaseAssets({ directory, repo, version, sha, publicKey }), /checksum mismatch/);
  metadata.sha256[installerName] = createHash("sha256").update("tampered").digest("hex");
  await writeFile(join(directory, "build-info.json"), JSON.stringify(metadata));
  await assert.rejects(verifyReleaseAssets({ directory, repo, version, sha, publicKey }), /signature verification failed/);
});
