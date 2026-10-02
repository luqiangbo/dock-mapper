import { pathToFileURL } from "node:url";

// WingetCreate's merge-upstream request can return 422 for a stale fork.
// Update the Git reference directly, allowing only a fast-forward.
export async function syncWingetFork({ token = process.env.WINGET_CREATE_GITHUB_TOKEN, fetchImpl = fetch, log = console.log } = {}) {
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
      throw new Error(`Winget fork ${method} ${path}: HTTP ${response.status} ${detail}. Check WINGET_TOKEN access and fork branch protection; synchronize the fork manually if needed.`);
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
  if (!Number.isInteger(comparison.ahead_by) || !Number.isInteger(comparison.behind_by)) {
    throw new Error("Winget fork comparison did not return commit counts");
  }
  log(`Winget fork ${forkRepo}: ${comparison.ahead_by} ahead, ${comparison.behind_by} behind upstream.`);
  if (comparison.ahead_by > 0) {
    throw new Error(`${forkRepo}/${fork.default_branch} has unique commits; synchronize it manually before retrying. No forced update was attempted.`);
  }
  if (comparison.behind_by === 0) return;
  const updated = await api(`/repos/${forkRepo}/git/refs/heads/${branch}`, "PATCH", { sha, force: false });
  if (updated.object?.sha !== sha) throw new Error("Winget fork update did not return the expected upstream SHA");
  log(`Fast-forwarded ${forkRepo}/${fork.default_branch} to ${sha}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await syncWingetFork();
}
