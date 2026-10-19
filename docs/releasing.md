# 版本发布指南

## 长期维护的文件

根目录 `CHANGELOG.md` 是面向用户的版本变更记录，不另建重复的 release 文件。

- 日常变化放入 `## [Unreleased]`，可按“新增、改进、修复、升级提示”分组。
- 发布前将本次变化归入 `## [版本号] - YYYY-MM-DD`，版本号不带 `v`，保留空的 Unreleased 章节。
- 说明描述用户能感知的变化，不直接堆砌提交标题；版本号同步、CI 和依赖锁定等内部调整通常省略。
- 可以由 AI 根据上一个版本以来的提交整理，再由维护者确认。
- 从 1.2.0 开始记录；不凭印象补写更早版本。

## 发布流程

1. 同步 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json` 的版本。
2. 在 `CHANGELOG.md` 增加该版本的完整说明，并运行 `npm run test:scripts`、`npm run build` 和相关功能测试。
3. 经维护者授权后提交并推送代码，再创建和推送对应标签，例如 `v1.3.0`。
4. `.github/workflows/release.yml` 在标签推送时触发：精确提取该版本的正文，交给 Tauri 构建步骤；先上传到草稿 Release，校验通过后再公开并设为 Latest。
5. 若文件、对应章节不存在或章节只有空标题/注释，使用 GitHub 自动生成的 Release Notes 兜底。该说明依赖 GitHub 的 PR、标签和发布历史，不等同于完整的人工整理提交日志；发布后应检查正文。
6. 重复版本章节、无效标签、读取文件失败（文件不存在除外）或 GitHub API 失败时中止，避免发布错误或空说明。
7. 工作流在公开前检查安装包、对应 `.exe.sig`、`latest.json` 是否齐全，并核对清单中的版本、`windows-x86_64`、下载地址和签名；校验失败时保留草稿，不切换 Latest。发布后仍应验证实际升级链路；产物一致性检查不等同于客户端安装验证。

`CHANGELOG.md` 的变化不会自动同步到已发布的 Release。修订历史说明时，先更新对应章节，再由维护者授权更新该 Release 正文；无需移动标签或重新打包。

## 签名

仓库 Secret `TAURI_SIGNING_PRIVATE_KEY` 用于更新签名。无密码私钥不需要配置 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`；不要把私钥写入版本说明、仓库或日志。

`src-tauri/tauri.conf.json` 必须保留 `bundle.createUpdaterArtifacts: true`。仅配置签名密钥和 `includeUpdaterJson` 不会生成签名；缺少此开关时 Tauri Action 会跳过更新清单，普通安装包仍可能成功发布。签名密钥必须与已安装版本内置的 `plugins.updater.pubkey` 对应，不能为修复更新而更换密钥。

已发布版本若只有安装包，旧客户端会报 `Could not fetch a valid release JSON from the remote`。仅修改本地配置不会恢复远端更新：需要使用原签名密钥为该安装包补齐签名和 `latest.json`，或发布产物完整的新版本。保留既有标签与安装包，不能直接重跑旧标签工作流（旧提交仍缺少产物开关）。

修复流程推送到默认分支后，可手动运行 `Repair updater metadata`，输入 `v1.2.1`。此流程只处理缺少 `latest.json` 的当前正式 Latest 版本：下载既有安装包并核对 GitHub SHA-256，用现有 Secret 签名，核对公钥并验证安装包的 Ed25519 签名，再依次补传 `.exe.sig` 和 `latest.json`。如果已有签名则验证后复用，已有清单则停止；不会重建或替换安装包、改动发布说明、移动标签或切换 Latest。产物补齐后，v1.2.0 的原更新地址即可发现 v1.2.1；仍需实际检查和安装验证。
