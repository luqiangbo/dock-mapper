import test from "node:test";
import assert from "node:assert/strict";
import { extractRunScripts, assertPowerShellSyntax } from "./workflow-preflight.mjs";

test("单行与多行命令都检查，GitHub 表达式替换后保留 PowerShell 引号", () => {
  const scripts = extractRunScripts(`steps:\r\n  - run: node script.mjs\r\n  - run: |\r\n      if ($env:VERSION) {\r\n        Write-Host "\${{ github.repository }}"\r\n      }\r\n    env:\r\n      VERSION: example\r\n  - run: cargo test -- --skip model\r\n`);
  assert.equal(scripts.length, 3);
  assert.equal(scripts[0].script, "node script.mjs");
  assert.match(scripts[1].script, /Write-Host "GITHUB_EXPRESSION"/);
  assert.ok(!scripts[1].script.includes("VERSION: example"));
  assert.equal(scripts[2].script, "cargo test -- --skip model");
});

test("合法命令只解析不执行，缺失括号在构建前报告文件和行号", () => {
  assertPowerShellSyntax('throw "This must never execute"', "fixture.yml:10");
  assert.throws(() => assertPowerShellSyntax("if ($true) {", "fixture.yml:20"), /fixture\.yml:20/);
});

test("无法启动解析器时明确失败，不把缺失工具当作通过", () => {
  assert.throws(() => assertPowerShellSyntax("node script.mjs", "fixture.yml:1",
    () => ({ error: new Error("pwsh missing") })), /fixture\.yml:1.*pwsh missing/);
});

test("不支持的 YAML 命令形式拒绝跳过并给出替代写法", () => {
  for (const value of [">", '"node script.mjs"']) {
    assert.throws(() => extractRunScripts(`  run: ${value}`), /use run: \|/);
  }
});
