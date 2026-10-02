import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execute = promisify(execFile);

export async function fastForwardWingetFork({ token, forkRepo, branch, sha, behindBy,
  run = execute, createDirectory = () => mkdtemp(join(tmpdir(), "dockmapper-winget-")) }) {
  const directory = await createDirectory();
  // Credentials stay in this subprocess environment, never in URLs, argv or Git config files.
  const authorization = Buffer.from(`x-access-token:${token}`).toString("base64");
  const env = {
    ...process.env, GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "credential.helper", GIT_CONFIG_VALUE_0: "",
    GIT_CONFIG_KEY_1: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_1: `Authorization: Basic ${authorization}`,
  };
  async function git(args) {
    try {
      await run("git", args, { env, timeout: 180000, maxBuffer: 1024 * 1024, windowsHide: true });
    } catch (error) {
      const detail = `${error.message}\n${error.stderr ?? ""}`
        .split(token).join("<REDACTED>").split(authorization).join("<REDACTED>");
      throw new Error(`Winget Git synchronization failed: ${detail}. Verify WINGET_TOKEN can write ${forkRepo} (fine-grained PAT: select this fork and Contents: write; classic PAT: public_repo). Updating upstream workflow files may also require Workflows: write or the workflow scope. Check branch protection, then retry.`);
    }
  }
  await git(["init", "--bare", directory]);
  // Include the fork's existing ancestor so pushing is not a disconnected shallow update.
  await git(["--git-dir", directory, "fetch", "--quiet", "--no-tags", `--depth=${behindBy + 1}`,
    "https://github.com/microsoft/winget-pkgs.git", sha]);
  // The server rejects any concurrent divergent change. Never use --force here.
  await git(["--git-dir", directory, "push", "--porcelain", `https://github.com/${forkRepo}.git`,
    `${sha}:refs/heads/${branch}`]);
}

// WingetCreate's merge-upstream request can return 422 for a stale fork.
// Both REST sync and reference APIs can fail for forks far behind upstream.
export async function syncWingetFork({ token = process.env.WINGET_CREATE_GITHUB_TOKEN, fetchImpl = fetch,
  gitSync = fastForwardWingetFork, log = console.log } = {}) {
  if (!token) throw new Error("WINGET_TOKEN is required to synchronize the Winget fork");
  async function api(path, method = "GET", body, allowMissing = false) {
    const response = await fetchImpl(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
        "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000),
    });
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) {
      const detail = (await response.text()).split(token).join("<REDACTED>");
      const error = new Error(`Winget fork ${method} ${path}: HTTP ${response.status} ${detail}. Check WINGET_TOKEN access and fork branch protection; synchronize the fork manually if needed.`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  const user = await api("/user");
  const forkRepo = `${user.login}/winget-pkgs`;
  const fork = await api(`/repos/${forkRepo}`, "GET", undefined, true);
  if (!fork) {
    log(`No accessible ${forkRepo} fork; WingetCreate will attempt to create it.`);
    return;
  }
  if (!fork.fork || fork.parent?.full_name?.toLowerCase() !== "microsoft/winget-pkgs") {
    throw new Error(`${forkRepo} is not a fork of microsoft/winget-pkgs; refusing to update it`);
  }
  const branch = encodeURIComponent(fork.default_branch);
  const upstreamBranch = encodeURIComponent(fork.parent.default_branch);
  const upstream = await api(`/repos/microsoft/winget-pkgs/git/ref/heads/${upstreamBranch}`);
  const sha = upstream.object?.sha;
  if (!/^[a-f0-9]{40}$/i.test(sha ?? "")) throw new Error("Winget upstream commit SHA is invalid");
  const comparison = await api(`/repos/microsoft/winget-pkgs/compare/${sha}...${user.login}:${branch}`);
  if (!Number.isSafeInteger(comparison.ahead_by) || comparison.ahead_by < 0 ||
      !Number.isSafeInteger(comparison.behind_by) || comparison.behind_by < 0) {
    throw new Error("Winget fork comparison did not return commit counts");
  }
  log(`Winget fork ${forkRepo}: ${comparison.ahead_by} ahead, ${comparison.behind_by} behind upstream.`);
  if (comparison.ahead_by > 0) {
    throw new Error(`${forkRepo}/${fork.default_branch} has unique commits; synchronize it manually before retrying. No forced update was attempted.`);
  }
  if (comparison.behind_by === 0) return;
  let updated;
  try {
    updated = await api(`/repos/${forkRepo}/git/refs/heads/${branch}`, "PATCH", { sha, force: false });
  } catch (error) {
    if (error.status !== 404 && error.status !== 422) throw error;
    log(`Winget reference API returned HTTP ${error.status}; attempting a non-forced Git fetch/push.`);
    await gitSync({ token, forkRepo, branch: fork.default_branch, sha, behindBy: comparison.behind_by });
    updated = await api(`/repos/${forkRepo}/git/ref/heads/${branch}`);
  }
  if (updated.object?.sha !== sha) throw new Error("Winget fork update did not return the expected upstream SHA");
  log(`Fast-forwarded ${forkRepo}/${fork.default_branch} to ${sha}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await syncWingetFork();
}
