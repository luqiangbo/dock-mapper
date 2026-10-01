import { appendFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { candidateState, isNewerVersion, nextReleaseVersion, parseReleaseTag, releaseDay, reusableRelease, sourceMarker } from "./release-version.mjs";

const repo = process.env.GITHUB_REPOSITORY;
const sha = process.env.GITHUB_SHA;
const mode = process.argv[2];
sourceMarker(sha);
if (!repo || !process.env.GH_TOKEN) throw new Error("GitHub release environment is missing");
async function api(path, method = "GET", body) {
  const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`GitHub ${method} ${path}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}
async function list(path) {
  const result = [];
  for (let page = 1; ; page++) {
    const items = await api(`${path}?per_page=100&page=${page}`);
    result.push(...items);
    if (items.length < 100) return result;
  }
}
async function output(values) {
  await appendFile(process.env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(""));
}
const main = await api("git/ref/heads/main");
const releases = await list("releases");
let release = reusableRelease(releases, sha);
const state = candidateState(main.object.sha, sha, release);
if (mode === "check") {
  await output({ build: state === "ready" });
  if (state !== "ready") console.log(`Candidate is ${state}; skipping build.`);
} else if (mode === "prepare") {
  if (state === "stale") {
    console.log("Newer main commit exists; skipping this candidate.");
    await output({ build: false, published: false });
  } else {
    if (!release) {
      const commit = await api(`commits/${sha}`);
      const tags = await list("tags");
      const orphan = tags.find((tag) => tag.commit.sha === sha && parseReleaseTag(tag.name)?.day === releaseDay(commit.commit.committer.date) && !releases.some((item) => item.tag_name === tag.name));
      const version = orphan?.name.slice(1) ?? nextReleaseVersion(commit.commit.committer.date, [...tags.map((tag) => tag.name), ...releases.map((item) => item.tag_name)]);
      const tag = `v${version}`;
      for (const item of releases.filter((item) => !item.draft && !item.prerelease)) {
        if (/^v?\d+\.\d+\.\d+$/.test(item.tag_name) && !isNewerVersion(version, item.tag_name)) {
          throw new Error("Commit date would regress the published version; correct the commit timestamp before releasing");
        }
      }
      // Create the immutable source reference before allocating its draft.
      if (!orphan) await api("git/refs", "POST", { ref: `refs/tags/${tag}`, sha });
      release = await api("releases", "POST", {
        tag_name: tag, target_commitish: sha, name: `DockMapper ${tag}`, draft: true, prerelease: false,
        body: `${sourceMarker(sha)}\n\n版本：${tag}\n\n[查看提交 ${sha.slice(0, 7)}](https://github.com/${repo}/commit/${sha})\n\n下载安装包，或运行：\n\n\`winget install luqiangbo.DockMapper\``,
      });
    }
    const tag = await api(`git/ref/tags/${release.tag_name}`);
    if (tag.object.type !== "commit" || tag.object.sha !== sha) throw new Error("Release tag does not match source commit");
    await output({ build: release.draft, published: !release.draft, version: release.tag_name.slice(1), tag: release.tag_name, release_id: release.id });
  }
} else if (mode === "publish") {
  if (!release) throw new Error("No allocated release for source commit");
  if (state === "published") await output({ published: true });
  else if (state === "stale") {
    console.log("Newer main commit exists; leaving verified candidate as a draft.");
    await output({ published: false });
  } else {
    const tag = await api(`git/ref/tags/${release.tag_name}`);
    if (tag.object.type !== "commit" || tag.object.sha !== sha) throw new Error("Source tag mismatch");
    for (const item of releases.filter((item) => !item.draft && !item.prerelease)) {
      if (/^v?\d+\.\d+\.\d+$/.test(item.tag_name) && !isNewerVersion(release.tag_name, item.tag_name)) {
        throw new Error("Candidate version must exceed every published stable version");
      }
    }
    const metadata = JSON.parse(await readFile("release-assets/build-info.json", "utf8"));
    const updater = JSON.parse(await readFile("release-assets/latest.json", "utf8"));
    const version = release.tag_name.slice(1);
    if (metadata.sha !== sha || metadata.version !== version || updater.version.replace(/^v/, "") !== version) throw new Error("Release provenance/version mismatch");
    for (const [name, expected] of Object.entries(metadata.sha256)) {
      if (name !== `DockMapper_${version}_x64-setup.exe` && name !== "latest.json") throw new Error("Unexpected provenance asset");
      const hash = createHash("sha256").update(await readFile(`release-assets/${name}`)).digest("hex");
      if (hash !== expected) throw new Error(`Asset checksum mismatch: ${name}`);
    }
    if (Object.keys(metadata.sha256).length !== 2) throw new Error("Incomplete provenance");
    const platforms = Object.values(updater.platforms ?? {});
    if (!platforms.length) throw new Error("Updater platforms missing");
    for (const platform of platforms) {
      const installerName = `DockMapper_${version}_x64-setup.exe`;
      if (!platform.signature || platform.url !== `https://github.com/${repo}/releases/download/${release.tag_name}/${installerName}`) throw new Error("Updater signature/URL mismatch");
      const signature = (await readFile(`release-assets/${installerName}.sig`, "utf8")).trim();
      if (signature !== platform.signature.trim()) throw new Error("Updater signature differs from installer signature asset");
    }
    // The last main check is the start of the non-cancellable publication section.
    if ((await api("git/ref/heads/main")).object.sha !== sha) {
      await output({ published: false });
    } else {
      await api(`releases/${release.id}`, "PATCH", { draft: false, make_latest: "true" });
      await output({ published: true });
    }
  }
} else throw new Error("Expected prepare, check or publish");
