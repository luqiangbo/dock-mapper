import test from "node:test";
import assert from "node:assert/strict";
import { candidateState, isNewerVersion, nextReleaseVersion, parseReleaseTag, releaseDay, reusableRelease, sourceMarker } from "./release-version.mjs";

const sha = "a".repeat(40);
test("上海午夜后使用下一天而不是 UTC 日期", () => {
  assert.equal(releaseDay("2026-10-01T16:00:00Z"), "2026.1002");
  assert.equal(releaseDay("2026-10-01T15:59:59Z"), "2026.1001");
});
test("跨月和跨年从当天第一版开始", () => {
  assert.equal(nextReleaseVersion("2026-10-31T16:00:00Z", ["v2026.1031.8"]), "2026.1101.1");
  assert.equal(nextReleaseVersion("2026-12-31T16:00:00Z", ["v2026.1231.8"]), "2027.101.1");
});
test("同日包含失败草稿的编号不被复用且允许空缺", () => {
  assert.equal(nextReleaseVersion("2026-10-02T00:00:00Z", ["v2026.1002.1", "v2026.1002.3"]), "2026.1002.4");
});
test("旧版本和非法日期标签不参与自动编号", () => {
  assert.equal(nextReleaseVersion("2026-10-02T00:00:00Z", ["v1.1.5", "v007", "v2026.1002.0", "v2026.230.9"]), "2026.1002.1");
  assert.equal(parseReleaseTag("v2026.230.9"), null);
});
test("失败重跑恢复绑定同一完整提交的草稿", () => {
  const draft = { tag_name: "v2026.1002.2", body: sourceMarker(sha), draft: true };
  assert.equal(reusableRelease([draft], sha), draft);
  assert.equal(reusableRelease([draft], "b".repeat(40)), null);
});
test("重复提交绑定会阻止发布而不是任意选择", () => {
  const draft = { tag_name: "v2026.1002.2", body: sourceMarker(sha), draft: true };
  assert.throws(() => reusableRelease([draft, { ...draft, tag_name: "v2026.1002.3" }], sha));
});
test("连续提交淘汰旧草稿候选", () => {
  assert.equal(candidateState("b".repeat(40), sha, { draft: true }), "stale");
  assert.equal(candidateState(sha, sha, null), "ready");
});
test("正式发布后的重跑不再构建且不受后续 main 提交影响", () => {
  assert.equal(candidateState("b".repeat(40), sha, { draft: false }), "published");
});
test("旧正式用户可升级日期版且不允许倒退", () => {
  assert.equal(isNewerVersion("2026.1002.1", "v1.1.5"), true);
  assert.equal(isNewerVersion("2026.1002.2", "v2026.1002.1"), true);
  assert.equal(isNewerVersion("2026.1001.9", "v2026.1002.1"), false);
  assert.equal(isNewerVersion("2026.1002.1", "v2026.1002.1"), false);
});
test("超过 Windows 修订号上限时明确失败", () => {
  assert.throws(() => nextReleaseVersion("2026-10-02T00:00:00Z", ["v2026.1002.65535"]));
});
test("不接受无效日期和短提交号", () => {
  assert.throws(() => releaseDay("invalid"));
  assert.throws(() => sourceMarker("abcdef0"));
});
