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

配置 Windows 证书时，还需在 Actions 的 **Variables** 中设置
`WINDOWS_SIGNING_TIMESTAMP_URL`，值使用证书服务商提供的 HTTP/HTTPS 时间戳地址。
CI 检查证书私钥、代码签名用途和有效期，生成临时 Tauri 配置并将证书指纹传给
构建命令；安装包和应用 EXE 都必须通过 Authenticode 校验且使用该证书。

Updater 密钥必须使用 Tauri CLI 生成文件的**完整单行内容**，不要先做 Base64
解码，也不要只复制解码后的密钥正文：

```powershell
$privateKey = (Get-Content -Raw "$env:USERPROFILE\.tauri\dockmapper.key").Trim()
$privateKey | gh secret set TAURI_SIGNING_PRIVATE_KEY

$publicKey = (Get-Content -Raw "$env:USERPROFILE\.tauri\dockmapper.key.pub").Trim()
# 将 $publicKey 原样写入 src-tauri/tauri.conf.json 的 plugins.updater.pubkey
```

发布任务在全量构建前，用小文件试签并使用应用内公钥验签；私钥、密码错误或
公私钥不匹配会提前失败。这两个 Secrets 随后传给 Tauri Action。私钥与公钥必须来自同一次
`tauri signer generate`，否则客户端无法验证后续更新。

在仓库 `Settings → General → Releases` 启用 immutable releases。该设置会在 Draft
正式发布后锁定 tag 与 Release assets。

## 自动发布与版本

每次 main 提交自动检查，只发布最新候选，无需修改版本、提交 bump 或推送 tag。
版本统一为 v2026.1002.1（年.月日.当日修订号）；日期取目标提交的 committer 时间，
按 Asia/Shanghai 换算。同日编号从 1 开始，失败和过期草稿允许留下空缺。
版本和短提交号显示在“更新与关于”，提交号可打开对应 GitHub 提交。

CI 串行分配编号，tag 指向完整源码 SHA，草稿说明保存提交绑定。失败重跑复用
该提交的草稿及编号；创建 tag 后意外中断，也能恢复未绑定草稿的 tag。
正式发布后的重跑跳过构建，不覆盖安装包。版本只写入 CI 工作区的 Cargo 主包
和锁文件中本项目条目，不运行 cargo update，不升级依赖，也不提交回 main。
本地构建显示“开发版”，仓库 Cargo 版本不是下一次发布的版本。

流程：PR 检查 → main 检查 → 最新提交校验 → 分配/恢复草稿 → 构建前再次校验
→ NSIS 与 Updater 签名 → 安装包、更新清单、SHA-256 和源码绑定校验
→ 发布前再次校验 → 正式 Release → 独立 Winget 提交。
更新清单必须指向该版本安装包；build-info.json 保存版本、完整提交号及产物摘要。
`tauri-action@v1` 生成的清单可能使用 GitHub API 资产地址。CI 根据当前草稿中
对应安装包的真实资产 ID，将该地址转换为固定版本下载地址，再生成摘要、验签，
并上传校验后的 `latest.json` 和 `build-info.json`；其他资产地址或不同签名仍会失败。
Windows Authenticode 证书可选，配置时必须通过验证；Updater 签名私钥必需。
安装包构建仅在 GitHub 发布任务执行，本地不运行全量构建。

连续提交会淘汰尚未发布的旧候选，GitHub concurrency 只保留一个等待任务，
不承诺中间提交均发布。发布开始后不取消正在执行的任务。旧候选留下草稿，
不会替换正式更新入口。提交日期若导致版本低于已有正式版，流程明确失败。

## 合并保护和失败处理

在 Settings → Rules → Rulesets 为 main 创建规则，要求 Pull Request，禁止强推，
添加本仓库 Checks 工作流的 **Quality gate** 为必需检查；先运行一次 PR 检查，
再从 GitHub 展示的检查名称中选择。要求分支在合并前保持最新，避免测试旧基线。
保护规则是 GitHub 设置，提交 YAML 不会自动启用；本轮不启用 merge queue。

临时网络故障：Actions → 对应运行 → Re-run failed jobs。它仍使用原提交 SHA。
代码错误：修复 PR 或 revert PR 合并到 main，自动生成新的候选。
发布前失败：上一正式版继续可下载和更新，不自动回退 main。
发布后错误：发布更高版本的修复或回退内容，不删除、移动或覆盖旧版本。
Winget 失败：只重跑 Submit Winget update，不重新构建应用。
Release 支持 workflow_dispatch 手动补跑当前 main；旧提交使用原运行的重跑。

Winget 清单校验成功后出现 `The forked repository could not be synced with the
upstream commits`，表示提交 PR 前的 fork 同步失败，与安装器架构警告无关。
WingetCreate 1.12.13.0 在同步接口返回 HTTP 422 时报告这条错误。
工作流使用 `WINGET_TOKEN` 识别提交账号，提交前检查其 `winget-pkgs` fork，
对仅落后的默认分支通过 Git reference API 执行非强制快进；首次没有可访问的
fork 时继续交由 WingetCreate 创建。Winget 提交任务串行执行，避免互相更新分支。

若 fork 默认分支有独有提交，流程会停止，保留提交并要求手动同步；若权限不足、
分支保护阻止更新或 GitHub API 拒绝请求，日志会包含 HTTP 状态和响应。
检查 `WINGET_TOKEN` 是否能读写提交账号的 fork，而非仅能访问本项目。
不要删除 fork 或强制重置分支来自动处理失败。可在提交账号的
`winget-pkgs` 仓库使用 **Sync fork**，处理冲突后再重跑 Winget 任务。
已失败的旧运行仍使用旧提交中的工作流；本次修复合并后，新的发布运行才包含预检。

Tauri API 和已使用插件的 npm 包与 Rust 锁文件保持主、次版本一致，前端对应包
固定版本以避免漂移；CLI 单独版本不要求与 Rust crate 同号。自动版本流程不会
升级依赖。Quality gate 和签名预检都在构建前检查对应版本，发现漂移明确失败。
首次正式发布必须验证签名与旧版升级。

## Winget 审核

- 自动校验全部通过后，`Review required` 表示等待具有写权限的维护者批准。
- `New changes require approval from someone other than the last pusher` 表示最后推送者
  不能批准自己的改动，作者无需为此修改清单。
- 只有出现验证失败、维护者明确请求修改或 `Needs-Author-Feedback` 时才继续推送。

## 本地验收

日常改动仍只运行仓库规定的两项快速验证：根目录 `pnpm typecheck`，以及
`src-tauri` 目录 `cargo test -- --skip model`。准备合并或发布时，在仓库根目录运行：

```powershell
pnpm release:preflight
```

这会依次运行 Tauri 版本检查、前端类型与行为测试、发布规则测试、跳过模型的
Rust 核心测试；失败时立即停止。不运行全量构建、模型初始化或格式检查。

下载同一候选版本的安装包、安装包 `.sig`、`latest.json` 和 `build-info.json`
到仓库根目录的 `release-assets` 目录后，可按需运行以下轻量校验，不触发构建、安装或发布：
`release:verify` 不会创建产物目录，也不会生成 `build-info.json`；该文件由发布 CI
在构建后生成并上传。尚未下载产物时不要直接运行此命令。旧发布若没有
`build-info.json`，无法完成来源与摘要校验，应使用包含该文件的 CI 发布产物。

```powershell
pnpm release:verify
# 如果产物放在其他目录：pnpm release:verify .\其他目录
```

默认从更新地址读取仓库，从 `build-info.json` 读取版本，并要求其中的完整
提交号等于当前 `git HEAD`。验收其他提交的产物时，先切换到该提交，或显式传入
`pnpm release:verify <目录> <owner/repo> <版本> <完整40位提交号>`。
校验覆盖非空安装包、源码/版本绑定、两个产物的 SHA-256、Windows x64 平台项、
固定版本下载地址、清单与 `.sig` 一致性，以及应用公钥对安装包和可信注释的
实际 Minisign 验签。任一失败返回非零退出码。SHA-256 用于一致性检查，
`build-info.json` 本身没有独立签名，不能单独作为可信来源证明。
本地验签使用当前检出的 `tauri.conf.json` 公钥；验收旧版本时使用对应版本配置。

Windows 代码签名需要另行读取安装包状态；配置证书的版本应为 `Valid`，并核对
签名证书指纹与预期一致：

```powershell
Get-AuthenticodeSignature .\release-assets\DockMapper_<version>_x64-setup.exe |
  Select-Object Status, StatusMessage, SignerCertificate
```

工作流仍自动发布已校验的候选；上述本地校验不会暂停 CI，也不能证明真实安装
或更新成功。正式上线验收还需从旧版执行应用内更新、重新打开并确认版本和配置保留。

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
