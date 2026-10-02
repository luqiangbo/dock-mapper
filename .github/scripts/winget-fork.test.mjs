import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Verify the workflow calls the preflight before wingetcreate submits anything.
test("Winget 提交前使用同一 PAT 快进 fork，失败时停止提交", async () => {
  const workflow = await readFile(new URL("../workflows/release.yml", import.meta.url), "utf8");
  const job = workflow.slice(workflow.indexOf("  submit-winget:"));
  const preflight = job.indexOf("node .github/scripts/winget-fork.mjs");
  assert.ok(preflight >= 0, "Missing fork synchronization preflight");
  assert.ok(preflight < job.indexOf("& $wingetCreate submit"));
  assert.match(job.slice(preflight), /winget-fork\.mjs\s+if \(\$LASTEXITCODE -ne 0\)/);
  assert.match(job, /actions\/checkout@v6/);
  assert.match(job, /WINGET_CREATE_GITHUB_TOKEN: \$\{\{ secrets\.WINGET_TOKEN \}\}/);
});

async function simulate(overrides = {}) {
  const { syncWingetFork } = await import("./winget-fork.mjs");
  const sha = "a".repeat(40);
  const calls = [];
  const responses = {
    "/user": { login: "publisher" },
    "/repos/publisher/winget-pkgs": { fork: true, default_branch: "master", parent: { full_name: "microsoft/winget-pkgs", default_branch: "master" } },
    "/repos/microsoft/winget-pkgs/git/ref/heads/master": { object: { sha } },
    [`/repos/microsoft/winget-pkgs/compare/${sha}...publisher:master`]: { ahead_by: 0, behind_by: 50000 },
    "/repos/publisher/winget-pkgs/git/refs/heads/master": { object: { sha } },
    ...overrides,
  };
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: options.method, body: options.body && JSON.parse(options.body) });
    assert.equal(options.headers.Authorization, "Bearer winget-pat");
    assert.ok(Object.hasOwn(responses, path), `Unexpected API request: ${path}`);
    const data = responses[path];
    return new Response(JSON.stringify(data.body ?? data), { status: data.status ?? 200 });
  };
  return { calls, run: () => syncWingetFork({ token: "winget-pat", fetchImpl, log: () => {} }) };
}

test("严重落后的 fork 使用非强制快进，不依赖失败的 merge-upstream 接口", async () => {
  const { calls, run } = await simulate();
  await run();
  assert.deepEqual(calls.filter((call) => call.method !== "GET"), [{
    path: "/repos/publisher/winget-pkgs/git/refs/heads/master", method: "PATCH",
    body: { sha: "a".repeat(40), force: false },
  }]);
});

test("fork 已同步时不写入 GitHub", async () => {
  const { calls, run } = await simulate({
    [`/repos/microsoft/winget-pkgs/compare/${"a".repeat(40)}...publisher:master`]: { ahead_by: 0, behind_by: 0 },
  });
  await run();
  assert.ok(calls.every((call) => call.method === "GET"));
});

test("首次没有 fork 时交由 WingetCreate 创建", async () => {
  const { calls, run } = await simulate({ "/repos/publisher/winget-pkgs": { status: 404, body: { message: "Not Found" } } });
  await run();
  assert.equal(calls.length, 2);
});

test("fork 有独有提交或同名仓库不是官方 fork 时拒绝改写", async () => {
  for (const overrides of [
    { [`/repos/microsoft/winget-pkgs/compare/${"a".repeat(40)}...publisher:master`]: { ahead_by: 2, behind_by: 50000 } },
    { "/repos/publisher/winget-pkgs": { fork: false } },
  ]) {
    const { calls, run } = await simulate(overrides);
    await assert.rejects(run, /unique commits|not a fork/);
    assert.ok(calls.every((call) => call.method === "GET"));
  }
});

test("令牌无写权限或快进失败时保留 HTTP 错误且不强推重试", async () => {
  for (const status of [403, 422]) {
    const { calls, run } = await simulate({
      "/repos/publisher/winget-pkgs/git/refs/heads/master": { status, body: { message: "Update rejected" } },
    });
    await assert.rejects(run, new RegExp(`HTTP ${status}.*Update rejected`));
    assert.equal(calls.filter((call) => call.method === "PATCH").length, 1);
    assert.equal(calls.at(-1).body.force, false);
  }
});
