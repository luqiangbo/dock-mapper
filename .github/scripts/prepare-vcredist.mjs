import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const downloadUrl =
  "https://download.visualstudio.microsoft.com/download/pr/ebdab8e5-1d7b-4d9f-a11b-cbb1720c3b12/843068991DAAA1F73AD9F6239BCE4D0F6A07A51F18C37EA2A867E9BECA71295C/VC_redist.x64.exe";
const expectedSha256 = "843068991DAAA1F73AD9F6239BCE4D0F6A07A51F18C37EA2A867E9BECA71295C";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const destination = resolve(
  repositoryRoot,
  "src-tauri/resources/runtime/vc_redist.x64.exe",
);

function sha256(content) {
  return createHash("sha256").update(content).digest("hex").toUpperCase();
}

async function readCachedRuntime() {
  try {
    return await readFile(destination);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

const cachedRuntime = await readCachedRuntime();
if (cachedRuntime && sha256(cachedRuntime) === expectedSha256) {
  console.log("Microsoft Visual C++ x64 运行库已存在且校验通过");
  process.exit(0);
}

if (cachedRuntime) {
  console.warn("本地 VC++ 运行库摘要不匹配，将从微软重新下载");
}

const response = await fetch(downloadUrl);
if (!response.ok) {
  throw new Error(`下载 Microsoft Visual C++ x64 运行库失败：HTTP ${response.status}`);
}

const downloadedRuntime = Buffer.from(await response.arrayBuffer());
const actualSha256 = sha256(downloadedRuntime);
if (actualSha256 !== expectedSha256) {
  throw new Error(
    `Microsoft Visual C++ x64 运行库摘要不匹配：${actualSha256}，预期 ${expectedSha256}`,
  );
}

await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, downloadedRuntime);
console.log(`Microsoft Visual C++ x64 运行库已下载并校验：${expectedSha256}`);
