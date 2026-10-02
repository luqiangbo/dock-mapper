import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sourceMarker } from "./release-version.mjs";

const sha = "a".repeat(40);
let sequence = 0;
async function simulate(mode, handler) {
  const folder = await mkdtemp(join(tmpdir(), "dockmapper-release-test-"));
  const savedEnv = { ...process.env }, savedArgs = process.argv, savedFetch = globalThis.fetch, savedCwd = process.cwd();
  const calls = [];
  Object.assign(process.env, { GITHUB_REPOSITORY: "owner/repo", GITHUB_SHA: sha, GH_TOKEN: "test", GITHUB_OUTPUT: join(folder, "output") });
  process.argv = ["node", "release.mjs", mode];
  process.chdir(folder);
  globalThis.fetch = async (url, options) => {
    const path = new URL(url).pathname.replace("/repos/owner/repo/", "");
    calls.push({ path, method: options.method, body: options.body && JSON.parse(options.body) });
    const data = handler(path, options);
    return new Response(JSON.stringify(data), { status: 200 });
  };
  try {
    await import(`./release.mjs?simulation=${sequence++}`);
    return { calls, output: await readFile(process.env.GITHUB_OUTPUT, "utf8") };
  } finally {
    process.env = savedEnv;
    process.argv = savedArgs;
    globalThis.fetch = savedFetch;
    process.chdir(savedCwd);
    await rm(folder, { recursive: true, force: true });
  }
}
test("旧提交检查后不分配草稿或发布", async () => {
  const result = await simulate("prepare", (path) => path === "git/ref/heads/main" ? { object: { sha: "b".repeat(40) } } : []);
  assert.match(result.output, /build=false/);
  assert.ok(result.calls.every((call) => call.method === "GET"));
});
test("已发布提交重跑仅返回原版本不写入 GitHub", async () => {
  const release = { id: 1, tag_name: "v2026.1002.1", body: sourceMarker(sha), draft: false };
  const result = await simulate("prepare", (path) => {
    if (path === "git/ref/heads/main") return { object: { sha: "b".repeat(40) } };
    if (path === "releases") return [release];
    if (path === `git/ref/tags/${release.tag_name}`) return { object: { type: "commit", sha } };
    throw new Error(`Unexpected API: ${path}`);
  });
  assert.match(result.output, /published=true/);
  assert.match(result.output, /version=2026.1002.1/);
  assert.ok(result.calls.every((call) => call.method === "GET"));
});
test("草稿创建前中断留下的标签恢复为同一个编号", async () => {
  const result = await simulate("prepare", (path, options) => {
    if (path === "git/ref/heads/main") return { object: { sha } };
    if (path === "releases" && options.method === "GET") return [];
    if (path === `commits/${sha}`) return { commit: { committer: { date: "2026-10-02T00:00:00Z" } } };
    if (path === "tags") return [{ name: "v2026.1002.1", commit: { sha } }];
    if (path === "releases" && options.method === "POST") return { id: 1, draft: true, ...JSON.parse(options.body) };
    if (path === "git/ref/tags/v2026.1002.1") return { object: { type: "commit", sha } };
    throw new Error(`Unexpected API: ${path}`);
  });
  assert.match(result.output, /version=2026.1002.1/);
  assert.equal(result.calls.filter((call) => call.method === "POST").length, 1);
  assert.match(result.output, /release_id=1\n/);
});

test("重跑已有草稿时提供同一发布 ID 且不创建新发布", async () => {
  const draft = { id: 42, tag_name: "v2026.1002.1", body: sourceMarker(sha), draft: true };
  const result = await simulate("prepare", (path) => {
    if (path === "git/ref/heads/main") return { object: { sha } };
    if (path === "releases") return [draft];
    if (path === `git/ref/tags/${draft.tag_name}`) return { object: { type: "commit", sha } };
    throw new Error(`Unexpected API: ${path}`);
  });
  assert.match(result.output, /release_id=42\n/);
  assert.match(result.output, /build=true\n/);
  assert.match(result.output, /tag=v2026\.1002\.1\n/);
  assert.ok(result.calls.every((call) => call.method === "GET"));
});
test("GitHub 读取失败明确失败且不会创建正式发布", async () => {
  await assert.rejects(simulate("prepare", () => { throw new Error("GitHub unavailable"); }), /GitHub unavailable/);
});
test("发布前发现 main 已更新只保留草稿", async () => {
  const release = { tag_name: "v2026.1002.1", body: sourceMarker(sha), draft: true };
  const result = await simulate("publish", (path) => path === "git/ref/heads/main" ? { object: { sha: "b".repeat(40) } } : [release]);
  assert.match(result.output, /published=false/);
  assert.ok(result.calls.every((call) => call.method === "GET"));
});
test("草稿标签被移动后禁止发布", async () => {
  const release = { tag_name: "v2026.1002.1", body: sourceMarker(sha), draft: true };
  const writes = [];
  await assert.rejects(simulate("publish", (path, options) => {
    if (options.method !== "GET") writes.push(path);
    if (path === "git/ref/heads/main") return { object: { sha } };
    if (path === "releases") return [release];
    return { object: { type: "commit", sha: "b".repeat(40) } };
  }), /Source tag mismatch/);
  assert.deepEqual(writes, []);
});
test("重新读取较高正式版后禁止发布旧草稿", async () => {
  const draft = { tag_name: "v2026.1002.1", body: sourceMarker(sha), draft: true };
  await assert.rejects(simulate("publish", (path) => {
    if (path === "git/ref/heads/main") return { object: { sha } };
    if (path === "releases") return [draft, { tag_name: "v2026.1003.1", body: "", draft: false, prerelease: false }];
    return { object: { type: "commit", sha } };
  }), /exceed every published/);
});
test("构建失败没有产物时不执行正式发布写入", async () => {
  const draft = { tag_name: "v2026.1002.1", body: sourceMarker(sha), draft: true };
  const writes = [];
  await assert.rejects(simulate("publish", (path, options) => {
    if (options.method !== "GET") writes.push(path);
    if (path === "git/ref/heads/main") return { object: { sha } };
    if (path === "releases") return [draft];
    return { object: { type: "commit", sha } };
  }), /ENOENT/);
  assert.deepEqual(writes, []);
});
