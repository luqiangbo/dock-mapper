export function releaseDay(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid commit timestamp");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "numeric", day: "numeric",
  }).formatToParts(date);
  const part = (name) => Number(parts.find((item) => item.type === name).value);
  return `${part("year")}.${part("month") * 100 + part("day")}`;
}

export function parseReleaseTag(tag) {
  const match = /^v([1-9]\d{3})\.([1-9]\d{2,3})\.([1-9]\d*)$/.exec(tag);
  if (!match) return null;
  const [year, monthDay, revision] = match.slice(1).map(Number);
  const month = Math.floor(monthDay / 100), day = monthDay % 100;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  if (!Number.isSafeInteger(revision) || revision > 65535) throw new Error("Release revision exceeds Windows version limit");
  return { day: `${year}.${monthDay}`, revision, version: tag.slice(1) };
}

export function nextReleaseVersion(timestamp, tags) {
  const day = releaseDay(timestamp);
  const revisions = tags.map(parseReleaseTag).filter((tag) => tag?.day === day).map((tag) => tag.revision);
  const revision = Math.max(0, ...revisions) + 1;
  if (revision > 65535) throw new Error("Daily release revision exhausted");
  return `${day}.${revision}`;
}

export function sourceMarker(sha) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Expected full commit SHA");
  return `<!-- dockmapper-source:${sha} -->`;
}

export function reusableRelease(releases, sha) {
  const matches = releases.filter((release) => release.body?.includes(sourceMarker(sha)) && parseReleaseTag(release.tag_name));
  if (matches.length > 1) throw new Error("Multiple releases bound to the same commit");
  return matches[0] ?? null;
}

export function candidateState(mainSha, sourceSha, release) {
  if (release && !release.draft) return "published";
  return mainSha === sourceSha ? "ready" : "stale";
}

export function isNewerVersion(candidate, published) {
  const left = candidate.replace(/^v/, "").split(".").map(Number);
  const right = published.replace(/^v/, "").split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return false;
}
