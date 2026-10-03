import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));

// This checks run-script syntax, not the YAML schema or GitHub expression semantics.
// Current workflows use Windows/PowerShell, including steps with no explicit shell.
export function extractRunScripts(workflow) {
  const lines = workflow.replace(/\r\n/g, "\n").split("\n");
  const scripts = [];
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(/^( +)(- )?run:\s*(.*)$/);
    if (!match) continue;
    const line = index + 1;
    const runIndent = match[1].length + (match[2] ? 2 : 0);
    let script = match[3];
    if (/^[|>]/.test(script)) {
      if (!/^\|[-+]?\s*(?:#.*)?$/.test(script)) {
        throw new Error(`run:${line}: unsupported block style; use run: |`);
      }
      const body = [];
      while (index + 1 < lines.length) {
        const next = lines[index + 1];
        if (next.trim() && next.match(/^ */)[0].length <= runIndent) break;
        body.push(next);
        index++;
      }
      script = body.join("\n");
    } else if (/^['"]/.test(script)) {
      throw new Error(`run:${line}: quoted YAML scalars are unsupported; use run: |`);
    }
    scripts.push({ line, script: script.replace(/\$\{\{[\s\S]*?\}\}/g, "GITHUB_EXPRESSION") });
  }
  return scripts;
}

export function assertPowerShellSyntax(script, label, run = spawnSync) {
  const result = run("pwsh", ["-NoProfile", "-NonInteractive", "-Command", `
    $tokens = $null
    $parseErrors = $null
    [System.Management.Automation.Language.Parser]::ParseInput($env:DOCKMAPPER_SCRIPT_TO_PARSE, [ref]$tokens, [ref]$parseErrors) | Out-Null
    if ($parseErrors.Count -gt 0) {
      $parseErrors | ForEach-Object { [Console]::Error.WriteLine($_.ToString()) }
      exit 1
    }
  `], { encoding: "utf8", windowsHide: true, timeout: 30000,
    env: { ...process.env, DOCKMAPPER_SCRIPT_TO_PARSE: script } });
  if (result.error) throw new Error(`${label}: cannot start PowerShell syntax check: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label}: ${result.stderr || result.signal || "PowerShell syntax check failed"}`);
}

export async function checkWorkflowScripts() {
  const workflows = new URL("../workflows/", import.meta.url);
  for (const file of await readdir(workflows)) {
    if (!/\.ya?ml$/.test(file)) continue;
    const scripts = extractRunScripts(await readFile(new URL(file, workflows), "utf8"));
    for (const { line, script } of scripts) assertPowerShellSyntax(script, `${file}:${line}`);
    console.log(`${file}: ${scripts.length} PowerShell run scripts parsed (not executed)`);
  }
  for (const file of await readdir(new URL("./", import.meta.url))) {
    if (!file.endsWith(".mjs")) continue;
    const result = spawnSync(process.execPath, ["--check", fileURLToPath(new URL(file, import.meta.url))], {
      cwd: root, encoding: "utf8", windowsHide: true, timeout: 30000,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${file}: ${result.stderr || result.signal || "JavaScript syntax check failed"}`);
  }
  console.log("Workflow PowerShell and release JavaScript syntax checks passed");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await checkWorkflowScripts();
}
