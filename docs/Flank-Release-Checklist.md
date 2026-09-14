# Flank 发版操作清单

> 本文只讲一件事：**改完代码之后，怎么一步步把新版本发出去，并确保 GitHub Actions 被触发、Release 正确生成。**
> 原理与排错细节见 `docs/Flank-Auto-Update-Guide.md`（§5、§8）。

---

## 0. 一次性前提（已经配好，出问题时才回来查）

| 项 | 值 |
| --- | --- |
| 发版主仓 | `github` → `https://github.com/qbbmnnnnnn/flank.git`（**不是** `origin`，`origin` 是 Gitee 镜像） |
| 触发方式 | 推送形如 `v0.1.1` 的 tag 到 `github` |
| 工作流 | `.github/workflows/release.yml`（matrix：windows-latest + macos-latest） |
| 构建产物 | Windows `-setup.exe` + `.exe.sig`；macOS `.app.tar.gz` + `.sig` + `.dmg` |
| 更新清单 | `tauri-action` 自动生成 `latest.json`，两端 key 合并 |
| GitHub Secrets | `TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（**都必须非空**） |
| macOS 应用签名 | `bundle.macOS.signingIdentity: "-"`（ad-hoc 签名；无需 Apple Developer 账号，不影响 Windows） |
| 私钥 | `%USERPROFILE%\.tauri\flank.key`（口令在密码管理器里，**丢了就无法再给老用户推更新**） |
| 更新地址 | `https://github.com/qbbmnnnnnn/flank/releases/latest/download/latest.json` |

```powershell
# 确认远端配置正确
git remote -v      # 应看到 github 与 origin 两条
```

---

## 1. 日常发版：完整步骤

假设这次要发 **0.1.1**。

### 步骤 1｜改版本号（三处必须一致）

```powershell
cd h:/aigc/dailywork/noty_win
npm run bump-version -- 0.1.1
```

脚本会同时改 **4 个文件**并逐个打印结果：

- `package.json` → `"version"`
- `src-tauri/tauri.conf.json` → `"version"`（决定 installer 版本，也就是 `latest.json` 里的 version）
- `src-tauri/Cargo.toml` → `[package] version`（决定设置页显示的版本）
- `package-lock.json` → 两处根版本（顶层的和 `packages[""]` 的）

> 前面三处是"真相来源"，`package-lock.json` 必须跟着走，否则 CI 第一步 `npm ci` 会因为锁文件与 `package.json` 不同步而直接失败。
> `src-tauri/Cargo.lock` 不用手动改，下次构建会自动更新。

> ⚠️ 版本号必须**严格大于**用户当前版本，否则客户端不会提示更新。
> ⚠️ **先改版本号、再打 tag**。如果 tag 是 `v0.1.1` 而产物版本还是 `0.1.0`，`latest.json` 里的 `version` 会和 tag 对不上，用户收不到更新。

回头核对一下：

```powershell
(Get-Content package.json -Raw -Encoding utf8 | ConvertFrom-Json).version
(Get-Content src-tauri/tauri.conf.json -Raw -Encoding utf8 | ConvertFrom-Json).version
(Select-String -Path src-tauri/Cargo.toml -Pattern '^version\s*=').Line
```

### 步骤 2｜本地验证

```powershell
npm run build                      # vue-tsc 类型检查 + 前端构建
cargo check --manifest-path src-tauri/Cargo.toml
```

补充说明：
- `npm test` 目前有 **1 个既有的失败套件**（`src/features/settings/SettingsView.smoke.test.ts`，与更新功能无关），其余 8 个文件 55 个用例全绿。它**不影响 CI**，因为 CI 只跑 `npm run build`。
- 改了数据表结构时，确认 migrations 是兼容升级的（本项目用 sqlx migrate）。

### 步骤 3｜提交

```powershell
git add -A
git commit -m "release: v0.1.1"
```

> 安装包产物在 `src-tauri/target/` 下，已被 `.gitignore` 忽略，不会误提交。

### 步骤 4｜打 tag

```powershell
git tag v0.1.1
```

> tag 名必须是 `v` 开头，工作流的触发条件是 `tags: ["v*"]`。写成 `0.1.1` 不会触发。

### 步骤 5｜推送（**这步决定 Action 会不会跑**）

```powershell
git push github master
git push github v0.1.1        # 必须单独推 tag，git push 不带 tag
```

❌ 只推 `origin`（Gitee）**不会**触发 GitHub Actions。
❌ 忘了 `git push github v0.1.1` → Action 静默不跑，这是最常见的原因。

### 步骤 6｜盯构建进度

```powershell
gh run list --limit 3
gh run watch
```

或直接开 `https://github.com/qbbmnnnnnn/flank/actions`。两个 job（windows-latest / macos-latest）首次约 15~25 分钟。

### 步骤 7｜审核草稿 Release

跑完后 Releases 里会出现 **Draft**，逐项核对：

| 检查项 | 期望 |
| --- | --- |
| Windows 资产 | `Flank_0.1.1_x64-setup.exe` + `Flank_0.1.1_x64-setup.exe.sig` |
| macOS 资产 | `Flank.app.tar.gz` + `Flank.app.tar.gz.sig` + `Flank_0.1.1_aarch64.dmg` |
| `latest.json` | 存在，且 `version` = `0.1.1` |
| `latest.json` 的 platforms | **同时含 `windows-x86_64` 和 `darwin-aarch64`**（mac 是 ARM 机型；若是 `darwin-x86_64` 说明 runner 是 Intel，Apple Silicon 用户会收不到更新，需换 runner） |
| `latest.json` 的 url | 指向 `.exe` / `.app.tar.gz`，**不是** `.dmg`、**不是** `.nsis.zip` |
| 草稿状态 | 还是 Draft（草稿不会被 `/releases/latest/` 命中，用户此刻不受影响） |

macOS 首次或重要版本建议下载 `.dmg`，安装后验证 ad-hoc 签名：

```bash
codesign --verify --deep --strict --verbose=2 /Applications/Flank.app
codesign -dv --verbose=4 /Applications/Flank.app 2>&1 | grep 'Signature='
```

第二条命令应显示 `Signature=adhoc`。ad-hoc 签名不能获得 Apple 信任，首次打开仍可能需要前往“系统设置 → 隐私与安全性”点击“仍要打开”，但可避免 Apple Silicon 将完全未签名的下载产物直接判断为“已损坏”。

### 步骤 8｜发布

点 **Publish release**。Publish 之前用户完全收不到更新，可以放心核对、甚至关掉重来。

### 步骤 9｜验证清单地址可访问

```powershell
(Invoke-WebRequest "https://github.com/qbbmnnnnnn/flank/releases/latest/download/latest.json" -UseBasicParsing).Content
```

应直接返回 JSON（不是 404），里面 `version` 是本次版本。

### 步骤 10｜（首次/重要版本）端到端验证更新

在装了**旧版本**的机器上：打开应用 → 设置 → 更新 → 点 **检查更新** → 出现"发现新版本 0.1.1" → 点 **下载并安装 0.1.1** → passive 进度条 → 应用退出 → 重启后版本变新，且便签数据没丢。

> 手动按钮是立即检查。后台自动检查是"启动 30 秒后首次、之后每 6 小时醒一次、24 小时节流"，所以刚发版不要指望它马上弹提示。

---

## 2. 可直接复制的完整命令块

```powershell
cd h:/aigc/dailywork/noty_win

# 1) 版本号
npm run bump-version -- 0.1.1

# 2) 本地验证
npm run build
cargo check --manifest-path src-tauri/Cargo.toml

# 3) 提交 + 打 tag
git add -A
git commit -m "release: v0.1.1"
git tag v0.1.1

# 4) 推送（github！tag 要单独推）
git push github master
git push github v0.1.1

# 5) 盯进度
gh run list --limit 3
```

之后：Actions 跑完 → Releases 里审 Draft → Publish → 验证 `latest.json`。
可选：再把代码和 tag 同步一份到 Gitee 镜像（`git push origin master; git push origin v0.1.1`），它不参与发版。

---

## 3. "Action 没触发"排查

按顺序查这几条，覆盖 99% 的情况：

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| Actions 列表里什么都没有 | tag 只推到了 `origin`（Gitee） | `git push github v0.1.1` |
| 同上 | tag 名不符合 `v*` | 用 `v0.1.1`，不要用 `0.1.1` / `release-0.1.1` |
| 同上 | tag 没推上去 | `git push github --tags`，或 `git ls-remote --tags github` 确认 |
| job 一直挂着、日志停在 `Signing without password.` | 签名口令缺失或为空 secret（GitHub 建不了空 secret） | 检查 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 是否为非空口令 |
| 报 `A public key has been found, but no private key` | `TAURI_SIGNING_PRIVATE_KEY` 没配或名称拼错 | 重新粘贴私钥**整段内容**（含换行） |
| `latest.json` 里只有 Windows | macOS job 失败（多半是签名/依赖问题） | 看该 job 日志；先修 macOS，或临时把它从 matrix 里去掉再发 |
| macOS 下载后仍提示“已损坏” | ad-hoc 签名未生效，或签名后 `.app` 内容被修改 | 用 `codesign --verify --deep --strict --verbose=2` 检查；让用户优先下载原始 `.dmg`，不要重新压缩或修改 `.app` |
| macOS 提示“无法验证开发者” | ad-hoc 签名没有 Apple 信任链，属于预期行为 | 在“系统设置 → 隐私与安全性”点击“仍要打开”；要免除此步骤必须使用 Developer ID 签名并公证 |
| 改完代码想重跑 | —— | Actions 页面点 **Re-run all jobs**；草稿 Release 会被复用并覆盖资产 |

**重新发同一个版本**（CI 失败后修正重来）：因为 Release 还是草稿，可以删掉 tag 重推——

```powershell
git tag -d v0.1.1
git push github :refs/tags/v0.1.1
git tag v0.1.1
git push github v0.1.1
```

> 如果 Release **已经 Publish 过**，就不要再动这个 tag 了：直接改代码、`bump-version` 到 `0.1.2` 再发。已经装上 0.1.1 的用户只认比它更高的版本。

---

## 4. 发布后才发现有问题

| 情况 | 处理 |
| --- | --- |
| 刚 Publish 就发现包有问题，用户还没更新 | 先把 `0.1.1` Release 改成 **Draft**（或删除）止血，`releases/latest` 会回退到上一个正式版；**然后必须尽快发 `0.1.2`** |
| 已经有人装了坏版本 | 立刻发 `0.1.2` 修掉。**绝不能靠删 Release 解决**——`latest.json` 的版本必须递增，删掉只会让已装坏版本的用户永远收不到修复 |
| `latest.json` 内容写错（已发布） | 编辑该 Release 的 `latest.json` 资产并覆盖上传；若用户已拉到错误清单且其 `version` 不大于当前版本，需要发一个更高版本冲刷 |
| 版本号漏改了某一处 | 三处必须一致。`tauri.conf.json` 决定 installer 版本，`Cargo.toml` 决定设置页显示的版本 |

---

## 5. 绝对不要做的事

- ❌ 不要提交 `flank.key`（私钥）或把它贴到任何聊天/文档里；`.gitignore` 已兜底忽略 `*.key`
- ❌ 不要删除已 `Publish` 的 Release 来"撤回"版本
- ❌ 不要在已发布的 Release 上替换 `.exe` / `.app.tar.gz`（会让缓存的 `latest.json`/`.sig` 对不上）
- ❌ 不要把 `targets` 改成只含 `nsis`（Mac 上会构建失败）
- ❌ 不要为了图省事关掉签名校验——官方 updater 根本不支持关闭
