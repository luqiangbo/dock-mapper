import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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

async function simulate(overrides = {}, gitError) {
  const { syncWingetFork } = await import("./winget-fork.mjs");
  const sha = "a".repeat(40);
  const calls = [];
  const gitCalls = [];
  const responses = {
    "/user": { login: "publisher" },
    "/repos/publisher/winget-pkgs": { fork: true, default_branch: "master", parent: { full_name: "microsoft/winget-pkgs", default_branch: "master" } },
    "/repos/microsoft/winget-pkgs/git/ref/heads/master": { object: { sha } },
    [`/repos/microsoft/winget-pkgs/compare/${sha}...publisher:master`]: { ahead_by: 0, behind_by: 50000 },
    "/repos/publisher/winget-pkgs/git/refs/heads/master": { object: { sha } },
    "/repos/publisher/winget-pkgs/git/ref/heads/master": { object: { sha } },
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
  const gitSync = async (options) => {
    gitCalls.push(options);
    if (gitError) throw gitError;
  };
  return { calls, gitCalls, run: () => syncWingetFork({ token: "winget-pat", fetchImpl, gitSync, log: () => {} }) };
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

test("落后 15699 个提交且引用 API 返回 404 时改用 Git 快进", async () => {
  const { gitCalls, run } = await simulate({
    [`/repos/microsoft/winget-pkgs/compare/${"a".repeat(40)}...publisher:master`]: { ahead_by: 0, behind_by: 15699 },
    "/repos/publisher/winget-pkgs/git/refs/heads/master": { status: 404, body: { message: "Not Found" } },
  });
  await run();
  assert.equal(gitCalls.length, 1);
  assert.equal(gitCalls[0].forkRepo, "publisher/winget-pkgs");
  assert.equal(gitCalls[0].sha, "a".repeat(40));
  assert.equal(gitCalls[0].behindBy, 15699);
});

test("引用 API 返回 422 时也使用 Git 快进兜底", async () => {
  const { gitCalls, run } = await simulate({
    "/repos/publisher/winget-pkgs/git/refs/heads/master": { status: 422, body: { message: "Update rejected" } },
  });
  await run();
  assert.equal(gitCalls.length, 1);
});

test("令牌被拒绝或服务故障时保留 HTTP 错误且不尝试 Git 推送", async () => {
  for (const status of [401, 403, 500]) {
    const { calls, gitCalls, run } = await simulate({
      "/repos/publisher/winget-pkgs/git/refs/heads/master": { status, body: { message: "Update rejected" } },
    });
    await assert.rejects(run, new RegExp(`HTTP ${status}.*Update rejected`));
    assert.equal(calls.filter((call) => call.method === "PATCH").length, 1);
    assert.equal(calls.at(-1).body.force, false);
    assert.equal(gitCalls.length, 0);
  }
});

test("Git 兜底失败时停止提交并保留错误", async () => {
  const { run } = await simulate({
    "/repos/publisher/winget-pkgs/git/refs/heads/master": { status: 404, body: { message: "Not Found" } },
  }, new Error("Git push denied"));
  await assert.rejects(run, /Git push denied/);
});

test("Git 同步抓取到共同祖先、只推送目标分支且不把 PAT 写入参数", async () => {
  const { fastForwardWingetFork } = await import("./winget-fork.mjs");
  const calls = [];
  await fastForwardWingetFork({ token: "test-secret", forkRepo: "publisher/winget-pkgs", branch: "master",
    sha: "a".repeat(40), behindBy: 15699, createDirectory: async () => "test-bare-repository",
    run: async (file, args, options) => { calls.push({ file, args, options }); },
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1].args, ["--git-dir", "test-bare-repository", "fetch", "--quiet", "--no-tags",
    "--depth=15700", "https://github.com/microsoft/winget-pkgs.git", "a".repeat(40)]);
  assert.deepEqual(calls[2].args, ["--git-dir", "test-bare-repository", "push", "--porcelain",
    "https://github.com/publisher/winget-pkgs.git", `${"a".repeat(40)}:refs/heads/master`]);
  for (const call of calls) {
    assert.equal(call.file, "git");
    assert.ok(!call.args.some((arg) => /test-secret|--force|^\+/.test(arg)));
    assert.equal(call.options.env.GIT_TERMINAL_PROMPT, "0");
    assert.equal(call.options.env.GIT_CONFIG_VALUE_0, "");
    assert.equal(call.options.env.GIT_CONFIG_VALUE_1, `Authorization: Basic ${Buffer.from("x-access-token:test-secret").toString("base64")}`);
  }
});

test("Git 拒绝推送时输出权限修复路径并遮蔽凭据", async () => {
  const { fastForwardWingetFork } = await import("./winget-fork.mjs");
  const token = "test-secret", encoded = Buffer.from(`x-access-token:${token}`).toString("base64");
  const calls = [];
  await assert.rejects(() => fastForwardWingetFork({ token, forkRepo: "publisher/winget-pkgs", branch: "master",
    sha: "a".repeat(40), behindBy: 15699, createDirectory: async () => "test-bare-repository",
    run: async (_file, args) => {
      calls.push(args);
      if (args.includes("push")) throw new Error(`Permission denied ${token} ${encoded}`);
    },
  }), (error) => {
    assert.match(error.message, /Contents: write.*classic PAT: public_repo/);
    assert.ok(!error.message.includes(token) && !error.message.includes(encoded));
    return true;
  });
  assert.equal(calls.length, 3);
});

test("Git 推送后仍未同步到目标提交时停止提交", async () => {
  const { run } = await simulate({
    "/repos/publisher/winget-pkgs/git/refs/heads/master": { status: 404, body: { message: "Not Found" } },
    "/repos/publisher/winget-pkgs/git/ref/heads/master": { object: { sha: "b".repeat(40) } },
  });
  await assert.rejects(run, /expected upstream SHA/);
});

test("Git 推送失败时保留 stdout 中的拒绝原因并遮蔽两路输出的凭据", async () => {
  const { fastForwardWingetFork } = await import("./winget-fork.mjs");
  const token = "test-secret", encoded = Buffer.from(`x-access-token:${token}`).toString("base64");
  await assert.rejects(() => fastForwardWingetFork({ token, forkRepo: "publisher/winget-pkgs", branch: "master",
    sha: "a".repeat(40), behindBy: 15699, createDirectory: async () => "test-bare-repository",
    run: async (_file, args) => {
      if (!args.includes("push")) return;
      const error = new Error(`Command failed: git push ${token}`);
      error.stdout = `!\t${"a".repeat(40)}:refs/heads/master\t[remote rejected] (shallow update not allowed) ${token} ${encoded}`;
      error.stderr = `error: failed to push some refs ${token} ${encoded}`;
      throw error;
    },
  }), (error) => {
    assert.match(error.message, /stdout:\n.*remote rejected.*shallow update not allowed/);
    assert.match(error.message, /stderr:\nerror: failed to push some refs/);
    assert.ok(!error.message.includes(token) && !error.message.includes(encoded));
    return true;
  });
});

test("真实 Git 能快进落后的分支，并拒绝覆盖并发新增提交", async () => {
  const { fastForwardWingetFork } = await import("./winget-fork.mjs");
  const exec = promisify(execFile);
  const directory = await mkdtemp(join(tmpdir(), "dockmapper-winget-test-"));
  const upstream = join(directory, "upstream.git"), fork = join(directory, "fork.git");
  const identity = { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" };
  async function git(args) {
    return (await exec("git", args, { env: identity, windowsHide: true })).stdout.trim();
  }
  await git(["init", "--bare", upstream]);
  await git(["init", "--bare", fork]);
  const tree = await git(["--git-dir", upstream, "write-tree"]);
  const base = await git(["--git-dir", upstream, "commit-tree", tree, "-m", "base"]);
  await git(["--git-dir", upstream, "update-ref", "refs/heads/master", base]);
  await git(["--git-dir", upstream, "push", fork, `${base}:refs/heads/master`]);
  const next = await git(["--git-dir", upstream, "commit-tree", tree, "-p", base, "-m", "next"]);
  const tip = await git(["--git-dir", upstream, "commit-tree", tree, "-p", next, "-m", "tip"]);
  await git(["--git-dir", upstream, "update-ref", "refs/heads/master", tip]);
  let sequence = 0;
  const synchronize = (sha, behindBy) => fastForwardWingetFork({
    token: "local-test", forkRepo: "publisher/winget-pkgs", branch: "master", sha, behindBy,
    createDirectory: async () => join(directory, `sync-${sequence++}.git`),
    run: (file, args, options) => exec(file, args.map((arg) => {
      if (arg === "https://github.com/microsoft/winget-pkgs.git") return pathToFileURL(upstream).href;
      if (arg === "https://github.com/publisher/winget-pkgs.git") return fork;
      return arg;
    }), options),
  });
  await synchronize(tip, 2);
  assert.equal(await git(["--git-dir", fork, "rev-parse", "refs/heads/master"]), tip);
  const forkTree = await git(["--git-dir", fork, "rev-parse", `${tip}^{tree}`]);
  const concurrent = await git(["--git-dir", fork, "commit-tree", forkTree, "-p", tip, "-m", "concurrent change"]);
  await git(["--git-dir", fork, "update-ref", "refs/heads/master", concurrent]);
  const newer = await git(["--git-dir", upstream, "commit-tree", tree, "-p", tip, "-m", "upstream change"]);
  await git(["--git-dir", upstream, "update-ref", "refs/heads/master", newer]);
  await assert.rejects(() => synchronize(newer, 1), (error) => {
    assert.match(error.message, /stdout:\n[\s\S]*\[rejected\].*(?:non-fast-forward|fetch first)/);
    return true;
  });
  assert.equal(await git(["--git-dir", fork, "rev-parse", "refs/heads/master"]), concurrent);
});
