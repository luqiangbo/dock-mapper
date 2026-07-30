# DockMapper 发布与 Winget 指南

## 原则

- GitHub Release 中的安装器一经正式发布就不再替换。
- 不删除、不移动、不复用已经公开的 tag。
- `microsoft/winget-pkgs` 是 Winget 清单唯一来源，本仓库不保存副本。
- 自动更新只使用 Release 资产中的签名 `latest.json`。
- Winget v1.0.5 PR 合并前不再推送改动；审核要求不是代码错误。

## 首次配置

在 GitHub 仓库 `Settings → Secrets and variables → Actions` 配置：

| Secret | 用途 |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri Updater 签名私钥 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 私钥密码 |
| `WINGET_TOKEN` | WingetCreate 提交 PR 的 GitHub PAT |
| `WINDOWS_CERTIFICATE` | 可选，Windows 代码签名证书 Base64 |
| `WINDOWS_CERTIFICATE_PASSWORD` | 可选，证书密码 |

在仓库 `Settings → General → Releases` 启用 immutable releases。该设置会在 Draft
正式发布后锁定 tag 与 Release assets。

## 发布新版本

先同步三处版本号并提交：

```powershell
pnpm version:sync 1.0.6
git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json
git commit -m "chore: bump version to 1.0.6"
git tag v1.0.6
git push origin main
git push origin v1.0.6
```

CI 按顺序执行：

1. `validate`：校验 tag 与三处版本一致，执行前端和 Rust 质量检查。
2. `publish-release`：创建 Draft、构建 NSIS、校验 Updater 签名与可选
   Authenticode 签名，然后正式发布。
3. `submit-winget`：使用已冻结安装器的 URL 更新 Winget；该 job 可单独重跑，
   不会重新构建或覆盖安装器。

失败时修复问题并发布一个新的补丁版本，例如 `v1.0.7`。不要删除或复用
`v1.0.6`。

## Winget 审核

- 自动校验全部通过后，`Review required` 表示等待具有写权限的维护者批准。
- `New changes require approval from someone other than the last pusher` 表示最后推送者
  不能批准自己的改动，作者无需为此修改清单。
- 只有出现验证失败、维护者明确请求修改或 `Needs-Author-Feedback` 时才继续推送。

合并 v1.0.5 后，可另开一次元数据增强 PR。必须从实际安装后的 Windows
“应用和功能”/卸载注册项核对 `Publisher`、`DisplayName` 与 `DisplayVersion`，
不要根据项目名猜测。随后再补充项目、支持、许可证、发行说明 URL、中文描述、
Tags、Scope 和 UpgradeBehavior。

## 本地验收

在 Windows Sandbox 中使用正式 Release URL 验证：

```powershell
winget install --id luqiangbo.DockMapper --exact --silent
winget upgrade --id luqiangbo.DockMapper --exact --silent
winget uninstall --id luqiangbo.DockMapper --exact --silent
```

同时检查“应用和功能”元数据、静默参数以及安装器 SHA-256 与 Winget PR 完全一致。
