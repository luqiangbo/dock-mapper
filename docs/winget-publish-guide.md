# DockMapper 发布与 Winget 指南

## 原则

- GitHub Release 中的安装器一经正式发布就不再替换。
- 不删除、不移动、不复用已经公开的 tag。
- `microsoft/winget-pkgs` 是 Winget 清单唯一来源，本仓库不保存副本。
- 自动更新只使用 Release 资产中的签名 `latest.json`。
- NSIS 直装包会在缺少 Microsoft Visual C++ x64 运行库时静默安装它；Winget
  清单同时声明 `Microsoft.VCRedist.2015+.x64` 依赖。

## 首次配置

在 GitHub 仓库 `Settings → Secrets and variables → Actions` 配置：

| Secret | 用途 |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri Updater 签名私钥 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 私钥密码 |
| `WINGET_TOKEN` | WingetCreate 提交 PR 的 GitHub PAT |
| `WINDOWS_CERTIFICATE` | 可选，Windows 代码签名证书 Base64 |
| `WINDOWS_CERTIFICATE_PASSWORD` | 可选，证书密码 |

Updater 密钥必须使用 Tauri CLI 生成文件的**完整单行内容**，不要先做 Base64
解码，也不要只复制解码后的密钥正文：

```powershell
$privateKey = (Get-Content -Raw "$env:USERPROFILE\.tauri\dockmapper.key").Trim()
$privateKey | gh secret set TAURI_SIGNING_PRIVATE_KEY

$publicKey = (Get-Content -Raw "$env:USERPROFILE\.tauri\dockmapper.key.pub").Trim()
# 将 $publicKey 原样写入 src-tauri/tauri.conf.json 的 plugins.updater.pubkey
```

发布任务将这两个 Secrets 直接传给 Tauri Action。私钥内容或密码错误时，Tauri
会在构建更新器签名时直接报告失败。私钥与公钥必须来自同一次
`tauri signer generate`，否则客户端无法验证后续更新。

在仓库 `Settings → General → Releases` 启用 immutable releases。该设置会在 Draft
正式发布后锁定 tag 与 Release assets。

## 发布新版本

`src-tauri/Cargo.toml` 是唯一版本来源。输入一次新版本，脚本会同步 Cargo 主包并
刷新 `Cargo.lock`：

```powershell
$version = Read-Host "Version (x.y.z)"
pnpm version:sync $version
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore: bump version to $version"
git tag "v$version"
git push origin main
git push origin "v$version"
```

CI 按顺序执行：

1. `validate`：校验 tag、Cargo 主包与锁文件版本一致，执行前端和 Rust 质量检查。
2. `publish-release`：下载并校验固定 SHA-256 的微软 VC++ x64 运行库，将其打包进
   NSIS；安装时仅在系统运行库低于 `14.51.36247` 时升级；创建 Draft、构建
   安装器、校验 Updater 签名与可选 Authenticode 签名，然后正式发布。
3. `submit-winget`：使用已冻结安装器的 URL 生成清单，注入
   `Microsoft.VCRedist.2015+.x64` 依赖后提交；该 job 可单独重跑，不会重新构建或
   覆盖安装器。

失败时修复问题并发布一个新的补丁版本，例如 `v1.0.7`。不要删除或复用
`v1.0.6`。

## Winget 审核

- 自动校验全部通过后，`Review required` 表示等待具有写权限的维护者批准。
- `New changes require approval from someone other than the last pusher` 表示最后推送者
  不能批准自己的改动，作者无需为此修改清单。
- 只有出现验证失败、维护者明确请求修改或 `Needs-Author-Feedback` 时才继续推送。

## 本地验收

必须在未预装 Microsoft Visual C++ 运行库的干净 Windows Sandbox 中使用正式
Release URL 验证。先直装 NSIS 并启动应用，再验证 Winget 安装、升级和卸载：

```powershell
$installer = "DockMapper_<version>_x64-setup.exe"
Start-Process -FilePath ".\$installer" -ArgumentList "/S" -Wait
Start-Process "$env:LOCALAPPDATA\DockMapper\dock-mapper.exe"

winget install --id luqiangbo.DockMapper --exact --silent
winget upgrade --id luqiangbo.DockMapper --exact --silent
winget uninstall --id luqiangbo.DockMapper --exact --silent
```

确认 `dock-mapper.exe` 能持续运行，而不是以 `0xC0000135` 退出；同时检查“应用和
功能”元数据、静默参数、Winget PR 中的 VC++ 依赖，以及安装器 SHA-256 与 PR
完全一致。
