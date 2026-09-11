# Flank 自动更新实施指南（Tauri v2）

> 面向当前仓库 `noty_win`（productName: **Flank**，identifier: `com.flank.desktop`，Tauri v2）
> 目标：把新版安装包发布到 GitHub Release，让桌面端自动发现 → 下载 → 校验 → 提示重启。

---

## 0. 先回答核心疑问：Tauri 有没有"热更新"？

**结论：没有真正意义上的"不关软件就换掉代码"的热更新。**

Tauri v2 官方 `updater` 插件的机制是：

```
检查更新 → 下载新版安装包 → 用公钥校验签名 → 调起系统安装器 → 应用退出 → 新版本启动
```

它本质上是一个**"下载新安装包 + 重启换装"**的机制，不是进程内热替换（不像 React Native CodePush 那种推 JS 包）。原因：

- 本项目的**前端 `dist/` 是被编译进安装包/二进制里的**（`tauri.conf.json` 里 `frontendDist: "../dist"`，`beforeBuildCommand: "npm run build"`）。任何前端改动都等于"新版本"，必须发新安装包。
- 想做到"只换前端、不重启"，唯一办法是让 WebView 指向远程 URL 加载页面。但那会破坏本项目"本地优先、离线可用、数据不出本机"的定位，**不建议**。

**能优化到什么程度：**
Windows 上 NSIS 安装器支持 `installMode`：

| 模式 | 表现 |
| --- | --- |
| `basicUi` | 弹出安装向导，需要用户点击 |
| `passive` | 显示一个进度条，**无需用户点击**（推荐） |
| `quiet` | 完全静默，无界面 |

所以用户体验可以是：**后台下载 → 提示"新版本已就绪，重启生效" → 用户点一下 → 应用闪退重开**。打断感很小，但进程一定会重启。

---

## 1. 当前项目现状盘点

| 项目 | 现状 | 是否满足自动更新 |
| --- | --- | --- |
| Tauri 版本 | v2（`tauri = { version = "2" }`） | ✅ 支持 |
| `productName` / `identifier` | `Flank` / `com.flank.desktop` | ✅ |
| 版本号来源 | `tauri.conf.json` = `0.1.0`、`Cargo.toml` = `0.1.0`、`package.json` = `0.1.0` | ⚠️ 三处要同步 |
| 分发平台 | 目前只考虑 Windows；**新增 macOS（dmg 手动下载 + 自动更新）** | ⚠️ 见 §3.3 / §8.10 |
| `bundle.targets` | `["nsis"]`（只出 Windows NSIS） | ⚠️ 要改成 `"all"`，见 §3.3 |
| `bundle.createUpdaterArtifacts` | **未配置** | ❌ 必须加 |
| updater / process 插件 | **未安装** | ❌ 必须装 |
| 签名密钥 | **无** | ❌ 必须生成 |
| `capabilities/default.json` | 无 updater 权限 | ❌ 必须加 |
| 设置页"更新"区块 | `自动检查更新` 开关已存在；`检查更新` 按钮目前只是 `showToast` 占位 | ⚠️ 需接入真逻辑 |
| `AppInfo.version` | Rust 用 `env!("CARGO_PKG_VERSION")`（读 `Cargo.toml`） | ⚠️ 与 installer 版本要一致 |
| git remote | `origin` = `https://gitee.com/M_Fisher/noty_win.git`（Gitee）；`github` = `https://github.com/qbbmnnnnnn/flank.git` | ✅ GitHub 远端已存在，见 §3.4 |
| CI | 无 `.github/workflows` | ❌ 需新建 |

---

## 2. 总体方案（推荐路线）

```
本地/CI 打 tag (v0.2.0)
        │
        ▼
tauri-action 构建 Windows 安装包（createUpdaterArtifacts: true）
  ├─ Flank_0.2.0_x64-setup.exe       （NSIS 安装包；updater 直接下载它）
  └─ Flank_0.2.0_x64-setup.exe.sig   （签名）
        │
        ▼
上传到 GitHub Release，并由 tauri-action 自动生成 latest.json
        │
        ▼
客户端 updater 请求：
https://github.com/qbbmnnnnnn/flank/releases/latest/download/latest.json
        │
        ├─ 比对 version 是否 > 当前版本
        ├─ 下载 .exe
        ├─ 用内置公钥校验 .exe.sig
        └─ 运行安装器（passive 进度条）→ 应用退出 → 新版本启动
```

---

## 3. 一次性准备工作

### 3.1 安装 updater 与 process 插件

```powershell
# 前端 JS 绑定
npm install @tauri-apps/plugin-updater @tauri-apps/plugin-process

# 不要执行 npm run tauri add updater / process —— 原因见下方说明
```

> 本项目 AGENTS.md 规定只用 npm，所以不要用 `pnpm tauri add`。
>
> ❗ **本项目不要用 `tauri add`，全部手工改。** 它只会往 `src-tauri/src/lib.rs` 里插代码，而本项目的 `lib.rs` 只是个转发壳：
> ```rust
> pub fn run() { app::run(); }
> ```
> 真正的 Builder 在 **`src-tauri/src/app.rs`** 的 `run()` 里，`tauri add` 没有地方可插，容易注错位置或直接失败。请照本节手工改 `Cargo.toml` / `app.rs` / `capabilities` 三处。

**`src-tauri/Cargo.toml` 应新增：**

```toml
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
```

**`src-tauri/Cargo.toml` 的 `[dependencies]` 还要加 tokio（方案 B 的定时器需要）：**

```toml
tokio = { version = "1", features = ["time"] }
```

> 注意：原本 `tokio` 只出现在 `[dev-dependencies]`（features 为 `macros`、`rt-multi-thread`），方案 B 起它要进正式依赖。

**`src-tauri/src/app.rs` 的 `run()` 中注册**（放在现有 `.plugin(...)` 链上）：

```rust
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--background"]),
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())   // ← 新增
        .plugin(tauri_plugin_process::init())                   // ← 新增（用于重启）
        .setup(|app| { /* ... 现有代码不动 ... */ })
        // ...
}
```

**`src-tauri/capabilities/default.json` 的 `permissions` 追加：**

```json
"updater:default",
"process:allow-restart"
```

> `updater:default` 已包含 check / download / install 权限；`process:allow-restart` 是 `relaunch()` 必需的，缺了会报 `Operation not permitted`。

---

### 3.2 生成签名密钥（**必须，不可跳过**）

**先直接回答"一定需要私钥和公钥吗"：只要用官方 `tauri-plugin-updater`，就必须配，没有"关掉签名校验"的开关。**

- 官方文档原文：*"Tauri's updater needs a signature to verify that the update is from a trusted source. **This cannot be disabled.**"*
- 而且**"不配 `pubkey`" ≠ "跳过校验"**。我核对了插件源码：下载完成后一定会走 `verify_signature()`；`pubkey` 为空时会在 `PublicKey::decode("")` 处直接报错并向上传播，更新流程中止（fail-closed）。所以不配密钥的结果是**更新功能彻底不可用**，而不是"降级成不校验但能装"。
- 唯一的"完全不用密钥"的办法是自己写一套更新逻辑（自己下载 `.exe` 再拉起 NSIS 安装器），绕开 `verify_signature`。那等于放弃防中间人篡改，安全上不可接受，**不建议**。
- 结论：这对密钥是自动更新的**硬性前置条件**，必须生成、必须长期保存。

```powershell
# 生成到用户目录（不要在仓库里）
npm run tauri signer generate -w $HOME\.tauri\flank.key
```

会得到两个文件：

| 文件 | 用途 | 放哪 |
| --- | --- | --- |
| `flank.key` | **私钥**，用来签名安装包 | GitHub Secret `TAURI_SIGNING_PRIVATE_KEY`；**绝不提交进 git** |
| `flank.key.pub` | **公钥**，用来校验 | 写进 `tauri.conf.json` 的 `plugins.updater.pubkey` |

生成时还会让你设一个**私钥密码**，记为 GitHub Secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。

> ❗ **务必设一个非空口令，不要用"无密码"的密钥。** 本机实测（`tauri signer sign`）：
> - 口令缺失时，CLI 打印 `Signing without password.` 之后就**卡住不退出**；在 CI 里表现为 job 一直挂着直到超时，很难排查；
> - 只有显式给出 `--password=` 或 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 才能正常签完；
> - 而 GitHub **不允许创建空值的 Secret**，所以"无密码密钥 + 空 secret"这条路在 CI 上不可靠。
>
> 结论：生成密钥时就带一个强口令，本地与 CI 都用**同一个非空口令**。

> **怎么确认私钥和配置里的公钥是一对？** 在仓库里随便签一个文件：
> ```powershell
> $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $HOME\.tauri\flank.key -Raw
> $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "你的口令"
> npm run tauri signer sign -- README.md
> ```
> 把生成的 `README.md.sig` 内容做 base64 解码，取内层第二行的 base64 再解码，其第 3~10 字节按**小端**读出的十六进制，应该等于 `flank.key.pub` 注释里 key id 的**字节反转**。对不上的话，用户端会报签名校验失败。（验证完记得删掉 `README.md.sig`。）

> ⚠️ **配好之后有个连带副作用，必须提前知道：**
> 只要 `tauri.conf.json` 里填了 `pubkey`，**之后每一次 `tauri build` 都必须能拿到私钥**，否则构建直接失败（报 `A public key has been found, but no private key`）。也就是说：
> - 以后任何人本地打包（哪怕只是自测）都要先设好 `TAURI_SIGNING_PRIVATE_KEY`；
> - 团队里没有私钥的人**无法自行构建安装包**；
> - `npm run tauri:dev` 不受影响，日常开发照旧。

> ⚠️ **三条铁律**
> 1. 私钥丢了 → 以后**再也无法**给老用户推送更新（只能让用户手动重装）。
> 2. 私钥泄露 → 任何人都能伪造你的更新包。请把 `~/.tauri/flank.key` 和密码备份到安全的地方（密码管理器 / 离线）。
> 3. 建议把 `*.key` 加进 `.gitignore` 兜底。

> 密钥的日常运维（备份、轮换、丢失应急）见 **§8.6**。

---

### 3.3 修改 `src-tauri/tauri.conf.json`

**两个前置提醒：**
1. `tauri.conf.json` 是**严格 JSON，不能写注释**（只有文件名为 `tauri.conf.json5` 时才允许）。下面的代码块不含注释，讲解都写在块外。
2. 当前文件里**没有 `plugins` 这个顶层键**，需要新增；`targets` 已经是 `["nsis"]`，**不用动**。

```json
{
  "productName": "Flank",
  "version": "0.2.0",
  "identifier": "com.flank.desktop",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [ "…保持仓库现状，不动…" ],
    "security": { "…保持仓库现状，不动…" }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "createUpdaterArtifacts": true,
    "windows": {
      "nsis": {
        "installerIcon": "icons/icon.ico",
        "headerImage": "installer/nsis-header.bmp",
        "sidebarImage": "installer/nsis-sidebar.bmp",
        "languages": ["SimpChinese"]
      }
    },
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  },
  "plugins": {
    "updater": {
      "pubkey": "REPLACE_ME_WITH_THE_CONTENT_OF_flank.key.pub",
      "endpoints": [
        "https://github.com/qbbmnnnnnn/flank/releases/latest/download/latest.json"
      ],
      "windows": {
        "installMode": "passive"
      }
    }
  }
}
```

> 相比现状，本次**只新增** `bundle.createUpdaterArtifacts` 和顶层 `plugins` 两块；`version` 每次发版才改（见 §5）。

**`createUpdaterArtifacts` 到底产出什么？**（这是最容易搞错的一点，务必看清）

| 取值 | Windows NSIS 产物 | updater 下载的是 |
| --- | --- | --- |
| `true`（**推荐**） | `Flank_0.2.0_x64-setup.exe` + `Flank_0.2.0_x64-setup.exe.sig` | **直接是 `.exe`** |
| `"v1Compatible"`（仅从 Tauri v1 迁移时用，v3 会移除） | `…-setup.exe` + `…-setup.nsis.zip` + `…-setup.nsis.zip.sig` | `.nsis.zip` |

也就是说：**`true` 模式下不会再产出 `.nsis.zip`**，`latest.json` 里的 `url` 要指向 `.exe`，`signature` 用 `.exe.sig` 的内容。本文档统一走 `true`。

**关于 `targets`（现在要同时支持 Windows 和 macOS，所以改成 `"all"`）：**
- `"all"` 的含义是"**当前平台所有可用的打包格式**"。同一份配置，在两台机器上分别构建：
  - Windows 上 → NSIS（`-setup.exe`）+ MSI（`.msi`）
  - macOS 上 → `.app` + `.dmg`
- 如果保留 `["nsis"]`，在 Mac 上构建会因不支持 NSIS 而**直接失败**，所以必须改。
- 也可以用命令行临时覆盖：`npm run tauri:build -- --bundles nsis`（Win）/ `--bundles app,dmg`（Mac）。
- Windows 上会多出一个 `.msi`，不想给用户就不上传它；但 CI 自动生成 `latest.json` 时要打开 `updaterJsonPreferNsis: true`，让它指向 NSIS 而不是 MSI。
- **重要**：Windows 用户必须是用 **NSIS 安装器**装出来的版本，updater 才能正常工作。

**关于 macOS（先记住这一条，细节在 §8.10）：**
- macOS 的 updater **不使用 `.dmg`**。`createUpdaterArtifacts: true` 在 macOS 上产出的是 **`Flank.app.tar.gz` + `Flank.app.tar.gz.sig`**。
- `.dmg` 只是**给用户手动下载安装**用的，别把 `latest.json` 的 `url` 指向 dmg，否则校验/安装都会失败。

**`pubkey` 内容格式**：粘贴 `flank.key.pub` 里的**整段文本**（形如 `dW50cnVzdGVkIGNvbW1lbnQ6...`），**不能填文件路径**——官方明确说明 "It cannot be a file path!"。

> ❗ **仓库里现在是一个占位符，必须先替换才能真正发版：**
> 1. 跑一次 `npm run tauri signer generate -w $HOME\.tauri\flank.key`（见 §3.2），会得到 `flank.key` 和 `flank.key.pub`。
> 2. 用 `flank.key.pub` 的内容替换 `tauri.conf.json` 里那串 `REPLACE_ME_WITH_THE_CONTENT_OF_flank.key.pub`。
> 3. 没替换之前：`check()` 拿到的更新**会在校验阶段失败**（`PublicKey::decode` 报错），用户看到"安装失败"；CI 打包也会因为没有私钥而失败。`npm run tauri:dev` 不受影响。

---

### 3.4 ❗托管位置：已确定走 GitHub（仓库现状：双远端）

实测当前仓库已经有**两个 remote**，所以不用再纠结"要不要建 GitHub 仓库"：

| remote | 地址 | 用途 |
| --- | --- | --- |
| `origin` | `https://gitee.com/M_Fisher/noty_win.git` | 国内镜像 / 代码备份 |
| `github` | `https://github.com/qbbmnnnnnn/flank.git` | **发版主仓，GitHub Actions 跑在这里** |

> ⚠️ **注意：这个 GitHub 仓库目前是 Public（公开）。** 把代码推上去，**源码就公开了**。好处是 GitHub Actions 的 Windows/macOS runner 免费且不计分钟（见 §3.5）；如果你想保持源码私有，就把它转成 **Private**，但那时 Actions 会开始消耗额度（macOS 按 10× 折算），打包就得考虑走 §8.10 的手动双机方案。这个取舍要在第一次 `git push github` 之前想清楚。

**结论：走方案 A —— GitHub Release + `tauri-action` 自动生成 `latest.json`，Gitee 保留为镜像。** 这样每次发版全自动，不用手工维护 `latest.json`。

> ❗ **关键：打 tag 后必须推到 `github` 这个 remote。** 推到 `origin`（Gitee）**不会**触发 GitHub Actions，用户也收不到更新。见 §5 步骤 6 与 §8.2。
>
> 备选（不推荐）：只发 Gitee。Gitee Release **不会**自动生成 `latest.json`，每次都要手写并放到可直链的 HTTPS 地址，容易出错，格式见 §4.4，手工上传流程见 §8.3。


---

### 3.5 GitHub Actions 流水线（免费，建议保留）

**先回答"GitHub Actions 是否免费"：**

| 仓库可见性 | 标准 GitHub-hosted runner（含 Windows / macOS） | 说明 |
| --- | --- | --- |
| **Public（公开）** | ✅ **完全免费、不计分钟** | 官方 changelog 原文 "Runner usage in public repositories will remain free" |
| Private（私有） | ❌ 消耗额度：免费账户约 2000 分钟/月；且 **Windows 按 2× 折算、macOS 按 10× 折算** | 一次 15 分钟的 macOS 构建 ≈ 吃掉 150 分钟额度 |

**本项目 `qbbmnnnnnn/flank` 是 Public 仓库**，所以 Windows 和 macOS 的标准 runner **都免费**，`tauri-action` 可以照用，不必改成手动打包。（仍然收费的只有 larger runner、自定义镜像这类。）

> 如果哪天仓库转成 Private，或者你更想在本机控制整个打包过程，就走手动双机方案，见 **§8.10**。两条路文档里都写了。

创建 `.github/workflows/release.yml`（**一条流水线同时构建 Windows + macOS**）：

```yaml
name: Release

on:
  push:
    tags: ["v*"]        # 打 tag 就发版，例如 v0.2.0
  workflow_dispatch:     # 也支持手动触发

jobs:
  release:
    permissions:
      contents: write    # 允许创建 Release
    strategy:
      fail-fast: false
      matrix:
        platform: [windows-latest, macos-latest]
    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24   # 与 package.json 的 engines / @types/node 对齐
          cache: npm

      - uses: dtolnay/rust-toolchain@stable

      - uses: swatinem/rust-cache@v2
        with:
          workspaces: src-tauri

      - run: npm ci --include=dev

      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: "Flank ${{ github.ref_name }}"
          releaseDraft: true           # 先出草稿，人工确认后再 Publish
          prerelease: false
          uploadUpdaterJson: true      # 生成 latest.json（默认就是 true）
          updaterJsonPreferNsis: true  # Windows 同时有 NSIS/MSI，让 latest.json 指向 NSIS
          # 注意：旧参数名 includeUpdaterJson 已被移除，写了会被静默忽略。
```

矩阵（matrix）的要点：
- 两个 job 会往**同一个** Release 上传各自的产物。`tauri-action` 会自动处理"Release 已存在"，并把两个平台合并进**同一份 `latest.json`** —— 这正是双平台自动更新最省事的地方。
- `macos-latest` 目前是 **ARM64（Apple Silicon）** 机型，所以只产出 `darwin-aarch64` 的更新。要覆盖 Intel Mac，需要补一个 `macos-13`（最后的 Intel runner），或改成 universal 构建（`args: --target universal-apple-darwin`）。
- **macOS 未签名 / 未公证时，用户首次打开会被 Gatekeeper 拦截**（要右键"打开"）。要做成"双击即装"，得准备 Apple Developer 证书并在 CI 里配好 `APPLE_CERTIFICATE` 等 secrets —— 这也是很多人宁愿在 Mac 上**本地打包**的原因。

**在 GitHub 仓库 Settings → Secrets and variables → Actions 里新增：**

| Secret | 值 |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | `flank.key` 文件的**全部内容**（含换行的整段文本） |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 生成密钥时设的口令。**必须非空** —— 空 secret 在 GitHub 上创建不了，且凭证缺失会让 CLI 卡住（见 §3.2） |

> `releaseDraft: true` 是个安全设计：**草稿 Release 不会被 `/releases/latest/` 命中**，所以你不会不小心把半成品推给用户。确认产物和 `latest.json` 没问题后再点 Publish，更新才真正对用户生效。

---

## 4. 前端接入（把设置页的占位按钮换成真功能）

### 4.1 新增服务 `src/services/updateService.ts`

```ts
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isTauri } from "@tauri-apps/api/core";

export type UpdateProgress = {
  downloaded: number;
  total: number;
};

/** 检查更新；无更新时返回 null。非 Tauri 环境（浏览器预览）返回 null。 */
export async function checkForUpdate(): Promise<Update | null> {
  if (!isTauri()) return null;
  return await check({ timeout: 30_000 });
}

/** 下载并安装，随后重启应用。 */
export async function downloadInstallAndRelaunch(
  update: Update,
  onProgress?: (progress: UpdateProgress) => void,
): Promise<void> {
  let downloaded = 0;
  let total = 0;
  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? 0;
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress?.({ downloaded, total });
        break;
      case "Finished":
        onProgress?.({ downloaded: total, total });
        break;
    }
  });
  await relaunch();
}
```

### 4.2 在 `SettingsView.vue` 的"更新"区块接入

把现在的两个占位按钮：

```html
<button class="secondary-button" type="button" @click="showToast(t('正在检查更新…'))">{{ t('检查更新') }}</button>
```

改成带状态机的逻辑（示意）：

```ts
import type { Update } from "@tauri-apps/plugin-updater";
import { downloadInstallAndRelaunch } from "../../services/updateService";

const updateState = ref<"idle" | "checking" | "available" | "downloading" | "error">("idle");
const availableVersion = ref<string | null>(null);
const updateProgress = ref(0);
// 关键：把 check() 拿到的 Update 对象存下来复用，安装时不要再 check 一次
const pendingUpdate = ref<Update | null>(null);

async function runUpdateCheck(options: { silent?: boolean } = {}) {
  updateState.value = "checking";
  try {
    const update = await checkForUpdate();
    if (!update) {
      pendingUpdate.value = null;
      updateState.value = "idle";
      if (!options.silent) showToast(t("当前已是最新版本"));
      return;
    }
    pendingUpdate.value = update;
    availableVersion.value = update.version;
    updateState.value = "available";
  } catch {
    updateState.value = "error";
    if (!options.silent) showToast(t("检查更新失败，请稍后重试"));
  }
}

async function installUpdate() {
  if (!pendingUpdate.value) return;
  updateState.value = "downloading";
  await downloadInstallAndRelaunch(pendingUpdate.value, ({ downloaded, total }) => {
    updateProgress.value = total ? Math.round((downloaded / total) * 100) : 0;
  });
  // 正常情况下走不到这里：Windows 上安装器接管后应用会自动退出。
  // 保留 relaunch() 只是兜底。
  await relaunch();
}
```

> **实际落地的实现与上面示意的差异**（以仓库代码为准）：
> - `availableVersion` 不是局部 ref，而是从 `src/services/updateService.ts` 导出的**共享状态**——因为 Rust 后台检查也会写它（见 §8.5）。
> - `pendingUpdate` 用 `shallowRef`，避免 Vue 深度代理一个持有后端资源的 `Update` 句柄。
> - `installUpdate()` 在 `pendingUpdate` 为空时会**先补一次 `check()`**：后台检查只告诉了版本号，真正安装必须自己拿到 `Update` 句柄。
> - 平台标签由 `navigator.userAgent` 推导（`macOS` / `Windows x64`）；进度条只在 `downloading` 状态渲染。

顶部的 `update-hero` 也应从写死的"当前已是最新版本"改成**真实状态**：

| 状态 | hero 标题 | 右侧徽标 |
| --- | --- | --- |
| 未知 / 检查中 | 正在检查更新… | 转圈 |
| 最新 | 当前已是最新版本 | 已是最新 |
| 有新版 | 发现新版本 {{version}} | 可更新 |
| 下载中 | 正在下载 {{percent}}% | 进度 |

> 注意：**不要设计"新版本已就绪，重启生效"这个状态。** Windows 上 `downloadAndInstall` 一旦开始安装，NSIS 安装器（`passive` 模式）就会接管并让应用退出，前端不会有机会停留在"待重启"。上面的四种状态就够了。


### 4.3 让软件"定期去仓库拉取新包"

`AppSettings.automaticUpdates` 已经存在（Rust 侧 `AppSettings.automatic_updates`、前端 `contracts/app.ts`），设置页的开关也已经绑定了它。设置页文案写的是"**每天检查一次**"，所以不能只在启动时检查一次，要有一个可持续的调度。

> ✅ **本项目采用方案 B：把调度放在 Rust 侧。** 完整骨架、依赖改动和配套清单见 **§8.5**，本节下面的前端方案 A 仅作备选与对照。

**方案 A（备选）：前端调度器。** 新增 `src/services/updateScheduler.ts`，**只在 `main` 窗口启动它**：

```ts
import { savedSettings, settingsLoaded } from "./settingsService";
import { checkForUpdate } from "./updateService";
import type { Update } from "@tauri-apps/plugin-updater";

const STARTUP_DELAY = 5_000;                // 避开首屏，别抢资源
const CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24h，对应"每天检查一次"
const LAST_CHECK_KEY = "flank:last-update-check";

export function startUpdateScheduler(onUpdateAvailable: (update: Update) => void) {
  const run = async () => {
    if (!settingsLoaded.value || !savedSettings.value.automaticUpdates) return;
    const last = Number(localStorage.getItem(LAST_CHECK_KEY) ?? "0");
    if (Date.now() - last < CHECK_INTERVAL) return;
    try {
      const update = await checkForUpdate();
      localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
      if (update) onUpdateAvailable(update); // 静默：不弹窗，只在更新页/角标提示"可更新"
    } catch {
      // 静默失败，不要打扰用户
    }
  };

  setTimeout(() => void run(), STARTUP_DELAY);
  setInterval(() => void run(), 60 * 60 * 1000); // 每小时醒一次，用 lastCheck 兜住 24h
}
```

要点：
- 必须读 **`savedSettings`**（已持久化值），并且等设置初始化完成后再跑；不要用 `SettingsView` 里那个 `reactive` 快照，它只在该页面挂载时存在。
- `main` / `dock` / `dock-panel` 三个窗口的 WebView 都是常驻的，所以前端定时器可行；但**只能启动一个调度器**，否则会重复检查。
- `localStorage` 在 Tauri 下是持久化的（跟随 WebView2 用户数据目录）。如果不信任它，可以把"上次检查时间"存进 SQLite 的 settings 表。
- 用户关掉开关后，下一次 tick 自动就不检查了，不需要额外处理。
- 上一节这套前端调度器是**备选方案**；本项目实际采用的是 Rust 侧定时器（`tauri::async_runtime::spawn` + 定时 tick + `app.updater()`），即使某个 WebView 没加载也能检查。骨架与配套改动见 **§8.5**。

### 4.4 `latest.json` 格式（CI 会自动生成；手工托管/补发时才需要手写）

```json
{
  "version": "0.2.0",
  "notes": "本次更新：\n- 修复……\n- 新增……",
  "pub_date": "2026-09-11T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<Flank_0.2.0_x64-setup.exe.sig 文件里的整段内容>",
      "url": "https://github.com/qbbmnnnnnn/flank/releases/download/v0.2.0/Flank_0.2.0_x64-setup.exe"
    }
  }
}
```

要点：
- `version` 必须是**合法 SemVer**（`0.2.0` 或 `v0.2.0` 都行），并且必须 **大于** 用户当前版本才会提示更新。
- `signature` 是本次构建产出的 `.sig` 文件里的**整段文本**，**不能填路径或 URL**（官方明确说明）。每次构建签名都会变，必须用**这一次**的 `.sig`。
- `url` 必须是**能直接下载的 HTTPS 直链**，指向本次的 `.exe`。
- `platforms` 的 key 用 `OS-ARCH` 格式：Windows x64 = `windows-x86_64`。以后出 ARM64 再加 `windows-aarch64`。
- ⚠️ Tauri 会**先校验整个 JSON 文件、再看 `version`**。所以 `platforms` 里出现的每一个平台条目都必须**完整合法**（`url` + `signature` 都不能缺），哪怕那个平台暂时不发版。缺失会直接导致解析失败、更新功能整体不可用。
- 更完整的运维说明（怎么上传、怎么补发、怎么排错）见 **§8**。

---

## 5. 每次发新版本的操作清单（Checklist）

### 阶段一：改代码 + 提版本号

> ⚠️ **首次发版前的一次性检查**：确认 `tauri.conf.json` 里的 `pubkey` 已经不是占位符（见 §3.3）。没替换的话，更新会在校验阶段失败。

- [ ] 1. **三处版本号同步递增**（必须一致）：
  - `src-tauri/tauri.conf.json` → `"version"`
  - `src-tauri/Cargo.toml` → `[package] version`
  - `package.json` → `"version"`
  > 建议写一个 `scripts/bump-version.mjs` 一次性改三处，避免漏改。`tauri.conf.json` 的版本决定了 installer 版本，`Cargo.toml` 的版本决定了设置页显示的版本。
- [ ] 2. 在 `src/services/i18n` 里补好这次的更新文案（如果你要把 release notes 显示出来）。
- [ ] 3. 本地跑通验证：
  ```powershell
  npm run build        # 前端 + 类型检查
  npm test
  npm run tauri -- --version
  ```

### 阶段二：本地试构建（可选但强烈建议）

- [ ] 4. 本地带签名构建，确认能产出 updater 产物：
  ```powershell
  $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $HOME\.tauri\flank.key -Raw
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "你的密码"
  npm run tauri:build
  ```
  检查 `src-tauri/target/release/bundle/nsis/` 下是否有：
  ```
  Flank_0.2.0_x64-setup.exe
  Flank_0.2.0_x64-setup.exe.sig   ← 有 .sig 才说明签名成功
  ```
  > 因为 `createUpdaterArtifacts: true`，**不再有 `.nsis.zip`**；如果看到 `.nsis.zip`，说明误配成了 `"v1Compatible"`。
  > 也正因为 `pubkey` 已配置，**这一步不设环境变量会直接构建失败**，这是预期行为（见 §3.2）。
- [ ] 5. 装一个**旧版本**（比如 0.1.0），再装上面这个新版本，验证升级路径不丢数据（本项目数据在 `$APPDATA`，正常不会丢）。

### 阶段三：发布

- [ ] 6. 提交并打 tag，**推到 `github` 远端**（tag 名和版本号对应）：
  ```powershell
  git add -A
  git commit -m "release: v0.2.0"
  git tag v0.2.0

  # 代码推到 GitHub（触发 CI 的那个远端）
  git push github master
  git push github v0.2.0

  # 可选：同步一份到 Gitee 镜像
  git push origin master
  git push origin v0.2.0
  ```
  > ❗ 只推 `origin`（Gitee）**不会**触发 GitHub Actions，用户收不到更新。
- [ ] 7. 等 GitHub Actions 跑完，进入 GitHub → Releases 查看**草稿**：
  - 确认资产里有 `Flank_0.2.0_x64-setup.exe` 和 `Flank_0.2.0_x64-setup.exe.sig`
  - 确认有 `latest.json`，且里面的 `version` / `url` / `signature` 与本次产物一致
- [ ] 8. 确认无误后 **Publish release**（草稿一旦发布，`/releases/latest/` 才会指向它，用户才开始能收到更新）。
- [ ] 9. 用一台装旧版本的机器验证：设置 → 更新 → 检查更新 → 能发现 → 能下载 → 重启后版本变新。

> 完整的发布/上传/补发细则见 **§8.2 / §8.3**。

### 阶段四：收尾

- [ ] 10. 如果这次改了数据表结构，确认 migrations 是兼容升级的（本项目用 sqlx migrate）。
- [ ] 11. 如果发了坏版本：**不要删 Release**，直接发一个更高版本 `0.2.1` 修掉。删除会让 `latest.json` 指向错误/失效。
- [ ] 12. 发完版之后，在下一次改版本号之前，先确认 `git tag -l` 里没有重复 tag（tag 一旦推送就不要再移动，否则用户拿到的版本号和产物会对不上）。

---

## 6. 常见坑与排查

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| `check()` 永远返回 null | ① 当前版本 ≥ latest.json 的 version；② endpoint 写错；③ 处于草稿 Release | 确认已 Publish、版本已递增、URL 可 curl 通 |
| 报签名校验失败 | `pubkey` 与签名用的私钥不是一对 | 重新核对 `flank.key.pub` 是否原样粘贴 |
| 找不到 `.sig` | 没设 `createUpdaterArtifacts: true`，或没设 `TAURI_SIGNING_PRIVATE_KEY` | 两处都补上 |
| 只看到 `.nsis.zip` 没有 `.exe.sig` | `createUpdaterArtifacts` 被写成了 `"v1Compatible"` | 改成 `true` |
| 本地构建报 `A public key has been found, but no private key` | 配置了 `pubkey`，但构建时没提供私钥 | 见 §3.2，构建前设 `TAURI_SIGNING_PRIVATE_KEY` |
| `relaunch()` 报 `Operation not permitted` | capabilities 缺 `process:allow-restart` | 补权限后重新构建 |
| 更新后还是旧版本 | 跑的是 dev / portable 版本，或装的是 MSI 而 latest.json 指向 NSIS 产物 | 用 NSIS 安装版测试 |
| `latest.json` 404 | 用了 `/releases/latest/download/` 但最新 Release 是 draft / prerelease | Publish 正式版 |
| `latest.json` 里的 `url` 404 | 资产名对不上（GitHub 直链是大小写敏感的），或资产被删了 | 用浏览器打开该 `url` 验证；见 §8.3 |
| `check()` 报解析错误 | `platforms` 里有条目缺 `url` / `signature`（Tauri 会先校验整个文件） | 补齐所有平台条目 |
| CI 构建没有签名 | `TAURI_SIGNING_PRIVATE_KEY` secret 名称拼错或多行格式不对 | 私钥要整段（含换行）粘贴 |
| CI 一直挂着、日志停在 `Signing without password.` | 签名口令缺失或为空（空 secret 创建不了） | 给密钥设一个**非空**口令，并配到 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`，见 §3.2 |
| Gitee 方案下更新不生效 | Gitee Release 没有自动 latest.json | 手工维护，或改走 GitHub |
| 担心 CSP 阻挡下载 | 不会——下载发生在 **Rust 侧**，不经过 WebView 的 CSP | 无需改 CSP |
| 用户在国内下载很慢/超时 | GitHub Release 直链在国内网络不稳定 | 见 §8.9：把安装包托管到国内可访问的直链，`latest.json` 的 `url` 指过去 |
| Mac 用户收不到更新 | `latest.json` 的 `darwin-*` 指向了 `.dmg` | 改指向 `.app.tar.gz`，`signature` 用 `.app.tar.gz.sig` 的内容 |
| Mac 端签名校验失败 | Windows 和 macOS 用的不是同一份签名密钥 | 两端都必须用同一个 `flank.key` 构建 |
| Mac 上打开 app 报"已损坏 / 无法验证开发者" | app 未签名、未公证，被 Gatekeeper 拦截 | 先让用户右键"打开"；正式分发需 Apple 签名 + 公证 |
| 构建时报不支持 `nsis` / `dmg` | `targets` 与当前平台不匹配（如在 Mac 上仍配 `["nsis"]`） | 改成 `"all"`，或用 `--bundles nsis` / `--bundles app,dmg` |
| 两个平台只有一端能收到更新 | `latest.json` 里缺了另一端的 key | 双平台必须写全，见 §8.10.4 |

---

## 7. 已确认的决策

| 决策点 | 结论 |
| --- | --- |
| 托管平台 | **GitHub Release**（`github` remote 已存在）。Gitee 保留为代码镜像。全自动，无需手工维护 `latest.json` |
| 分发平台 | **Windows（NSIS）+ macOS（dmg 手动下载 + 自动更新）**，在两台机器上分别构建。`targets` 改为 `"all"` |
| 签名密钥 | **必须配置，不可跳过**。无密钥时官方 updater 整体不可用（见 §3.2） |
| 定期检查的实现 | **方案 B：Rust 侧定时器**（`app.rs` 里 `spawn`），不依赖任何 WebView。见 §8.5 |
| 是否用 CI | **用**。仓库 `qbbmnnnnnn/flank` 是 **Public**，Windows/macOS 标准 runner **免费且不计分钟**。手动双机打包作为兜底，见 §8.10 |

---

## 8. 更新运维手册（发布 / 上传 / 定期拉取）

> 前面 §3 讲的是"一次性准备"，这一节讲的是"以后每次发版照着做"，以及"怎么保证用户真的能拿到更新包"。

### 8.1 三个层次的分工

| 层次 | 频率 | 做什么 | 章节 |
| --- | --- | --- | --- |
| 一次性准备 | 只做一次 | 装插件、生成密钥、改 `tauri.conf.json`、加 capabilities、建 workflow、接前端 | §3、§4 |
| 每次发版 | 每个版本 | 改版本号 → 验签构建 → 打 tag → 推 `github` → 审草稿 → Publish | §8.2 |
| 兜底运维 | 出问题时 | 手工上传/补发、改下载源、密钥应急 | §8.3、§8.6、§8.8 |

### 8.2 标准发版流程（GitHub Release）

**前提：** `github` remote 已配好、Secrets 已配好、`.github/workflows/release.yml` 已提交。

| 步 | 操作 | 关键点 |
| --- | --- | --- |
| 1 | 改版本号：`tauri.conf.json` / `Cargo.toml` / `package.json` | 三处**必须一致**；建议用 `scripts/bump-version.mjs` 一次改完 |
| 2 | 本地验证：`npm run build`、`npm test` | 见 §5 阶段一 |
| 3 | 提交 + 打 tag：`git tag v0.2.0` | tag 名与版本号对应 |
| 4 | **推 `github`**：`git push github master && git push github v0.2.0` | ❗推 Gitee 不触发 CI |
| 5 | 等 Actions 跑完（Releases 里出现 **Draft**） | 构建约 10~20 分钟 |
| 6 | 审草稿资产（双平台）：Windows `.exe` + `.exe.sig`；macOS `.app.tar.gz` + `.sig` + `.dmg`；`latest.json` | 逐项核对，见 §8.3 与 §8.10.1 |
| 7 | 点 **Publish release** | Publish 之前用户完全不受影响 |
| 8 | 用旧版本客户端验证一次真实更新 | 设置 → 更新 → 检查更新 → 下载 → 重启后版本变新 |
| 9 | 可选：把 tag 同步推一份到 Gitee 镜像 | `git push origin master && git push origin v0.2.0` |

**为什么走"草稿 → 人工确认 → Publish"？**
草稿（draft）和预发布（prerelease）**都不会**被 `https://github.com/.../releases/latest/...` 命中。所以在草稿阶段，`latest.json` 对用户是不可见的，你可以放心检查产物、甚至删掉草稿重新构建，用户端毫无感知。只有点了 **Publish**，更新才真正对用户生效。

**Publish 之后多久用户能收到？**
下次客户端执行 `check()` 时就会拿到新清单——前提是它比对到 `version` 严格大于自身版本。GitHub 的 `releases/latest` 走 302 重定向，可能有几分钟 CDN 缓存，不必惊慌。

### 8.3 Release 上到底要放哪些文件

| 资产 | 必须 | 说明 |
| --- | --- | --- |
| `Flank_<版本>_x64-setup.exe` | ✅（Win） | 安装包：Windows 用户手动下载用它，updater 也下载它 |
| `Flank_<版本>_x64-setup.exe.sig` | ✅（Win） | 签名文件；内容要写进 `latest.json` 的 `signature` |
| `Flank.app.tar.gz` | ✅（Mac） | macOS 的**更新包**（注意不是 dmg） |
| `Flank.app.tar.gz.sig` | ✅（Mac） | macOS 的签名文件；写进 `darwin-*` 的 `signature` |
| `Flank_<版本>_<arch>.dmg` | ✅（Mac） | 仅给用户**手动安装**用；updater 不用它 |
| `latest.json` | ✅ | updater 的更新清单。**文件名必须就叫 `latest.json`**，不能改名 |
| `Source code (zip/tar.gz)` | — | GitHub 自动附带，与更新无关 |

> 双平台手工上传与 `latest.json` 合并写法见 **§8.10.4**。

> ✅ **正常情况这些由 `tauri-action` 自动上传，不用手工操作。** 只有下面几种情况才需要手工补：
> - CI 挂了 / 没配好；- 想给历史版本补一个包；- 需要在 GitHub 之外另发一份。

**手工上传 / 补发的完整步骤：**

1. 打开 `https://github.com/qbbmnnnnnn/flank/releases`，点 **Draft a new release**（或编辑已有 Release）。
2. `Choose a tag` → 输入 `v0.2.0` → **Create new tag**；Target 选 `master`。
3. 上传 `Flank_0.2.0_x64-setup.exe` 和 `Flank_0.2.0_x64-setup.exe.sig`。
4. 按 §4.4 的格式手写 `latest.json`：
   - `version` = `0.2.0`
   - `url` = `https://github.com/qbbmnnnnnn/flank/releases/download/v0.2.0/Flank_0.2.0_x64-setup.exe`
   - `signature` = **刚才那一次构建的 `.exe.sig` 文件内容**（整段文本，不是路径）
5. 上传 `latest.json`（名字不能改）。
6. **Publish release**。
7. 验证直链（浏览器即可打开）：
   ```
   https://github.com/qbbmnnnnnn/flank/releases/latest/download/latest.json
   ```
   应该直接返回 JSON 内容，而不是 404。

**如果有 `gh` CLI，第 3~6 步可以一条命令搞定：**

```powershell
gh release create v0.2.0 `
  .\Flank_0.2.0_x64-setup.exe `
  .\Flank_0.2.0_x64-setup.exe.sig `
  .\latest.json `
  --title "Flank v0.2.0" --notes "本次更新：…"

# 补传/覆盖单个资产
gh release upload v0.2.0 .\latest.json --clobber
```

**手工上传最常犯的错：**

| 错误 | 后果 |
| --- | --- |
| 资产名大小写与 `url` 不一致 | 下载 404（GitHub 直链**区分大小写**） |
| `url` 还指着 `.nsis.zip` | 下载/校验失败（v2 原生模式没有 zip） |
| `signature` 里填了文件路径 | 校验直接失败，官方明确说不接受路径 |
| 复用了上一个版本的 `.sig` | 签名不匹配，更新失败 |
| 忘了上传 `latest.json` | `check()` 404，所有用户都收不到更新 |
| 忘了 Publish（还是 draft） | 同上，用户收不到 |
| 在**已发布**的 Release 上替换 `.exe` | 与已缓存的 `latest.json`/`.sig` 不一致，用户端可能校验失败。改产物要发新版本 |

### 8.4 版本号与 `latest.json` 的硬规则

1. **三处版本号一致**：`tauri.conf.json`（决定 installer 版本）、`Cargo.toml`（决定设置页显示的版本）、`package.json`。
2. **必须严格大于用户当前版本**才会提示更新。用户是 `0.2.0`，你发 `0.2.0` 或 `0.1.9` 都不会有反应。
3. **每次构建 `.sig` 都可能变**，所以 `latest.json` 必须和**本次**产物配套。CI 会自动处理；手工补发时特别容易错。
4. 不要手改已发布 Release 里的 `latest.json` 去指向别处的包——那会让同一个版本的校验结果前后不一致。
5. 想撤回一个有问题的版本时，`latest.json` 的 `version` **不能用来"降级"**：客户端只认比自身新的版本。见 §8.8。

### 8.5 让软件定期去仓库拉取新包

> ✅ **本项目已决定采用方案 B（Rust 侧定时器）**，见 §4.3 的说明也已同步。方案 A 保留在下面作为备选/对照。

**方案 A（备选，改动小）：前端调度器**
按 §4.3 实现 `src/services/updateScheduler.ts`，在 `main` 窗口启动时调用一次。要点回顾：
- 读 `savedSettings.value.automaticUpdates`，开关关闭就不检查；
- 用 `localStorage` 记录上次检查时间，做 24h 节流；
- 启动延迟 5 秒，避开首屏；
- 每小时醒一次做节流判断，**不要**每小时真的去请求。

**方案 B（✅ 本项目采用）：Rust 侧定时器**
好处是不依赖任何 WebView 是否加载完成。骨架：

```rust
// src-tauri/src/app.rs（下面是已落地的实现，`now_ms()` / `last_update_check_ms()` 两个小助手略）
use tauri_plugin_updater::UpdaterExt;

const UPDATE_STATE_KEY: &str = "update-state";
const UPDATE_FIRST_CHECK_DELAY: std::time::Duration = std::time::Duration::from_secs(30);
const UPDATE_TICK_INTERVAL: std::time::Duration = std::time::Duration::from_secs(6 * 60 * 60);
const UPDATE_CHECK_INTERVAL_MS: i64 = 24 * 60 * 60 * 1000;

fn spawn_update_checker(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(UPDATE_FIRST_CHECK_DELAY).await;
        let mut ticker = tokio::time::interval(UPDATE_TICK_INTERVAL);
        loop {
            ticker.tick().await;
            check_for_updates(&app).await;
        }
    });
}

async fn check_for_updates(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<AppState>() else { return };
    let enabled = state.settings.read().map(|s| s.automatic_updates).unwrap_or(false);
    if !enabled { return; }
    if now_ms() - last_update_check_ms(&state.database).await < UPDATE_CHECK_INTERVAL_MS { return; }

    // 先记录时间：endpoint 挂掉时不能每个 tick 都重试
    let _ = state.database.save_setting(UPDATE_STATE_KEY, &now_ms().to_string()).await;

    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(error) => { eprintln!("Flank: updater unavailable: {error}"); return; }
    };
    match updater.check().await {
        // 只通知前端"有新版本"，绝不自动下载安装，避免打断用户输入
        Ok(Some(update)) => { let _ = app.emit_to("main", "update:available", update.version.clone()); }
        Ok(None) => {}
        Err(error) => eprintln!("Flank: update check failed: {error}"),
    }
}

// setup() 末尾加一行：
spawn_update_checker(app.handle());
```

> 三个关键设计，改动时别丢：
> 1. **只提示、不自动装** —— Rust 只 `emit`，下载安装永远由用户在设置页点按钮触发。
> 2. **先写时间戳再请求** —— 否则 endpoint 失败时每个 tick 都会重新请求。
> 3. **节流时间存 SQLite**（`settings` 表的 `update-state`），跨重启有效，比 `localStorage` 可靠。

> 补充：Rust 侧只 `emit` 版本号字符串。前端拿到后需要**自己再 `check()` 一次**取得 `Update` 句柄才能安装（`Update` 是后端资源，无法跨 IPC 传递）。

**配套改动（方案 B 的完整清单）：**
- `src-tauri/Cargo.toml` 的 `[dependencies]` 需要加 `tokio = { version = "1", features = ["time"] }`（现在 tokio 只在 `[dev-dependencies]` 里）。
- `src-tauri/src/app.rs`：加 `use tauri_plugin_updater::UpdaterExt;`，并在 `setup()` 末尾 `spawn` 上面这段。
- "上次检查时间"存进 SQLite：在 `database.setting("app")` 旁边加一个 `update_state` key（比 `localStorage` 可靠，跨重启有效）。
- 前端（`App.vue` 或 `SettingsView.vue`）：用 `listen("update:available", ...)` 接收事件，把 `pendingUpdate` 标记成"可更新"，**不要**自动下载。
- 用户在设置页**手动点"检查更新"**时走 §4.2 的 `runUpdateCheck()`，不要复用定时器路径。
- 用户在设置页**关掉"自动检查更新"**后，Rust 侧下一个 tick 读到 `automatic_updates == false` 会自动跳过，不需要额外通知机制。

**方案 A / B 对比：**

| | 方案 A（前端，备选） | 方案 B（Rust，✅ 已采用） |
| --- | --- | --- |
| 改动量 | 小，只加一个 ts 文件 | 中：app.rs + Cargo.toml + 一个 DB key + 前端 listen |
| 可靠性 | 依赖 `main` WebView 存活（常驻窗口，一般没问题） | 最高：由 Rust 进程驱动，不依赖任何 WebView |
| 适用 | 想先快速跑通 | 长期方案 |

**无论哪种方案，都要遵守两条产品承诺（设置页文案已经写了）：**
- "每天检查一次，不携带便签或设备内容" → 节流到 24h，只请求 `latest.json`，不带任何用户数据；
- "更新不会在你输入时强制重启应用" → **只提示、不自动安装**；安装必须由用户点按钮触发。

### 8.6 密钥运维（备份 / 轮换 / 应急）

**备份策略（生成当天就做完）：**

| 物件 | 放哪 | 备注 |
| --- | --- | --- |
| `flank.key`（私钥） | 密码管理器 + 离线介质（U 盘/加密盘），两处 | 丢了就只能让用户重装 |
| 私钥密码 | 密码管理器，**和私钥分开存** | 只有一个也没用 |
| `flank.key.pub`（公钥） | 仓库里的 `tauri.conf.json` + 备份一份 | 可以公开 |

**轮换密钥（比如私钥泄露时）：**
插件允许在运行时通过 Builder 覆盖公钥（`tauri_plugin_updater::Builder::new().pubkey(...)`，或 `app.updater_builder().pubkey(...)`），这正是为密钥轮换准备的。原理上要做"过渡版本"：

1. 生成新密钥对 `flank2.key` / `flank2.key.pub`。
2. 发一个**过渡版本 N**：仍然用**旧私钥**签名（这样老用户能校验通过、能装上），但该版本内置的**公钥换成新的**（改 `tauri.conf.json` 的 `pubkey`）。注意：版本 N 自己是被老用户机器上的**旧公钥**校验的，与它内置什么公钥无关。
3. 从 N+1 开始，全部用**新私钥**签名。
4. 过渡版本 N 必须让所有活跃用户都能升到，所以轮换要预留足够时间。

> ⚠️ 这套流程涉及"签名私钥与配置里的 pubkey 不是一对"的中间态，**务必先在一个测试仓库里完整演练一遍**再对正式仓库操作。轮换是一次性的、低频但高风险的动作。

**私钥丢失的应急：**
- 你**无法**再给已装旧版本的用户推送更新（他们的公钥校验永远不会通过）。
- 只能：在应用内/官网引导用户**手动下载新版安装包重装**。
- 所以：备份是唯一解，不要等出事才想。

### 8.7 发版后的验收清单

- [ ] `https://github.com/qbbmnnnnnn/flank/releases/latest/download/latest.json` 能直接打开，`version` 是本次版本
- [ ] `latest.json` 里的 `url` 用浏览器能下到 `.exe`
- [ ] `signature` 与 Release 里 `.exe.sig` 的内容一致
- [ ] 在装**旧版本**的干净环境里：检查更新 → 提示有新版本 → 下载有进度 → 安装（`passive` 进度条）→ 重启后版本变新
- [ ] 升级后**便签数据没丢**（数据在 `$APPDATA`）
- [ ] 关闭"自动检查更新"开关后，不再自动检查
- [ ] 设置页"更新"区块显示的版本号 = 本次版本

### 8.8 事故处理

| 情况 | 处理 |
| --- | --- |
| 已 Publish 才发现产物有问题 | ① **立刻发一个补丁版**（如 `0.2.1`）；② 可选止损：把有问题的 `0.2.0` Release 改成 **draft**（或删除），这样还没更新的用户会停在旧版本。⚠️ 注意 `releases/latest` 会回退到上一个正式版，所以**必须**跟进发布 `0.2.1`，否则已经装上坏版本的用户永远收不到修复 |
| CI 一直失败 | 先看 Actions 日志；若只是打包环境问题，用 §8.3 的手工流程先顶一次，别让发版卡死 |
| `latest.json` 内容写错（已发布） | 直接编辑该 Release 的 `latest.json` 资产并覆盖上传；若用户已经拉到错误清单，检查其 `version` 是否比当前大——如不大，需要发一个更高版本来"冲刷" |
| 用户反馈下载卡住 | 大概率是网络问题，见 §8.9 |
| 用户更新后仍显示旧版本 | 见 §6 排查表（多为 dev/portable 版本、或 MSI 与 NSIS 混装） |

### 8.9 国内网络与下载源优化

GitHub Release 的直链在国内部分网络下会很慢甚至超时，这会直接表现为"检查到更新但下载失败"。

可选的优化方式（按成本从低到高）：
1. 只优化**下载源**：把 `.exe` 传到国内可直链的对象存储（COS / OSS / R2 等），`latest.json` 的 `url` 指向该直链，`latest.json` 本身仍放 GitHub。签名校验与下载源无关，换源不需要重新签名。
   - 手工模式下：编辑 Release 里的 `latest.json` 即可；
   - CI 模式下：在 workflow 里加一步"上传到对象存储并生成 `latest.json`"，然后 `uploadUpdaterJson: false` 关掉自动生成，避免两份清单打架。
2. 加一个备用 `endpoints`：Tauri 会按顺序尝试，只有返回非 2XX 才继续下一个。所以可以配置成 `[国内源, GitHub源]`。
3. Gitee 全量方案：不推荐，Gitee Release 不会自动生成 `latest.json`。

> `endpoints` 是一个数组，可以写多个。生产环境强制 HTTPS，非 HTTPS 需要显式打开 `dangerousInsecureTransportProtocol`，**不要**为了图方便打开它。

### 8.10 双平台发布（Windows + macOS，两台机器）

你要在两台机器上分别出包：Windows 机器出 NSIS，Mac 机器出 dmg。这一节把差异和坑一次讲清。

#### 8.10.1 每个平台各产出什么

| 平台 | 自动更新用的产物 | 手动下载用的产物 | `latest.json` 里的 key |
| --- | --- | --- | --- |
| Windows x64 | `Flank_0.2.0_x64-setup.exe` + `.exe.sig` | 同一个 `.exe` | `windows-x86_64` |
| macOS（Apple Silicon） | `Flank.app.tar.gz` + `Flank.app.tar.gz.sig` | `Flank_0.2.0_aarch64.dmg` | `darwin-aarch64` |
| macOS（Intel） | `Flank.app.tar.gz` + `.app.tar.gz.sig` | `Flank_0.2.0_x64.dmg` | `darwin-x86_64` |

> ❗ **最容易踩的坑：macOS 的 updater 不用 `.dmg`。**
> `.dmg` 只是给用户**手动安装**用的；`latest.json` 里 `darwin-*` 条目的 `url` 必须指向 **`.app.tar.gz`**，`signature` 用 **`.app.tar.gz.sig`** 的内容。指向 dmg 会直接校验失败。
> （Windows 那边正好相反：updater 用的就是 `.exe` 本体，所以 Windows 只有一个包。）

#### 8.10.2 两台机器的共同前提

1. **版本号必须完全一致**：两台机器上的 `tauri.conf.json` / `Cargo.toml` / `package.json` 都要是 `0.2.0`。建议先把改版本号的 commit 推到 GitHub，在 Mac 上 `git pull` 到**同一个 commit**，再各自构建。
2. **两台机器都需要私钥**：`flank.key` + 密码要安全地同步到 Mac（密码管理器或加密 U 盘）。没有私钥，Mac 上也构建不出来。
3. `pubkey` 不用额外操心——它就是仓库里 `tauri.conf.json` 的值，两边拉同一个 commit 就一致。
4. 两边各设一次环境变量再构建：

```powershell
# Windows (PowerShell)
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $HOME\.tauri\flank.key -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "你的密码"
npm run tauri:build
```

```bash
# macOS (zsh / bash)
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/flank.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="你的密码"
npm run tauri:build
```

#### 8.10.3 macOS 侧的额外事项

- **未签名 / 未公证的 app 会被 Gatekeeper 拦截**。最低限度要告诉用户"右键 → 打开"；想做成一键安装，就得准备 Apple Developer 证书 + `notarytool` 公证。
- ARM Mac 默认产出 `aarch64`。要同时覆盖 Intel，两种做法：
  - 分别构建：再到 Intel 机器（或 CI 的 `macos-13`）构建一次，得到独立的 `.app.tar.gz` + `.dmg`；
  - 或构建 universal：`npm run tauri:build -- --target universal-apple-darwin`。此时 `latest.json` 的 key 通常是 `darwin-universal`，**以构建后实际生成的 `latest.json` 为准**（走 `tauri-action` 时它会自动填对）。
- macOS 上 `targets: "all"` 会产出 `.app` + `.dmg`，`createUpdaterArtifacts: true` 会额外产出 `.app.tar.gz` + `.sig`。
- macOS 的更新是**替换 `.app` 后重新启动**，没有 Windows NSIS 那种 `installMode` 概念，不需要配 `installMode`。

#### 8.10.4 手工发布：把两个平台的产物合并到同一个 Release

1. Windows 机器构建后拿到：
   ```
   src-tauri/target/release/bundle/nsis/Flank_0.2.0_x64-setup.exe
   src-tauri/target/release/bundle/nsis/Flank_0.2.0_x64-setup.exe.sig
   ```
2. Mac 机器构建后拿到：
   ```
   src-tauri/target/release/bundle/macos/Flank.app.tar.gz
   src-tauri/target/release/bundle/macos/Flank.app.tar.gz.sig
   src-tauri/target/release/bundle/dmg/Flank_0.2.0_aarch64.dmg
   ```
3. 把这 5 个文件一起上传到**同一个** GitHub Release（tag `v0.2.0`，先建 **Draft**）。
4. 手写 `latest.json`，**两个平台都要写全**：
   ```json
   {
     "version": "0.2.0",
     "notes": "本次更新：…",
     "pub_date": "2026-09-11T12:00:00Z",
     "platforms": {
       "windows-x86_64": {
         "signature": "<Windows 的 .exe.sig 内容>",
         "url": "https://github.com/qbbmnnnnnn/flank/releases/download/v0.2.0/Flank_0.2.0_x64-setup.exe"
       },
       "darwin-aarch64": {
         "signature": "<macOS 的 .app.tar.gz.sig 内容>",
         "url": "https://github.com/qbbmnnnnnn/flank/releases/download/v0.2.0/Flank.app.tar.gz"
       }
     }
   }
   ```
5. 上传 `latest.json`（文件名不能改），**Publish**。
6. 两端各验证一次：Windows 用旧 NSIS 版本、Mac 用旧 dmg 版本，分别"检查更新"。

> **只发某一个平台可以吗？** 可以，但不能把另一个平台的字段留空或写错——**要么完整写、要么整个 key 不出现**。Tauri 会先校验整份 JSON，任何一条非法都会导致整体解析失败、两端都收不到更新。

#### 8.10.5 用 CI 更省事

§3.5 的 matrix 流水线会自动把两个平台的产物连同**一份合并好的 `latest.json`** 一起传上去，你只需要复核 + Publish。所以推荐：

- **首选**：matrix CI（仓库是 Public，完全免费），你只负责打 tag；
- **兜底**：本机双机构建 + 手工合并 `latest.json`（即 §8.10.4）。

### 8.11 一页速查

```
准备（仅一次）：
  npm i 插件 → Cargo.toml → app.rs 注册 → capabilities
  → tauri.conf.json（targets: "all" + createUpdaterArtifacts: true + plugins.updater）
  → tauri signer generate 生成密钥 → GitHub Secrets → .github/workflows/release.yml
  → Rust 侧定时检查（方案 B，见 §8.5）

每次发版：
  1. 三处版本号 → 0.2.0（两台机器必须一致）
  2. npm run build && npm test
  3. git commit -m "release: v0.2.0"
  4. git tag v0.2.0
  5. git push github master && git push github v0.2.0   ← 必须是 github，不是 origin
  6. 等 CI（Windows + macOS 两个 job）→ Releases 里的 Draft
  7. 核对产物：
       Windows: .exe / .exe.sig
       macOS:   .app.tar.gz / .app.tar.gz.sig / .dmg
       latest.json 里 windows-x86_64 与 darwin-* 两个 key 都在
  8. Publish
  9. Windows 与 Mac 各用旧版本实测一次

手动打包（CI 不可用时）：两台机器各自带私钥构建 → 汇总 5 个产物 → 上传同一个 Release
  → 手写 latest.json（两个平台都写全）→ 上传 → Publish（详见 §8.10.4）

出问题：
  产物错 → 发 0.2.1
  只有 Gitee 收到更新 → 检查推的是哪个 remote
  Mac 上收不到更新 → 检查 latest.json 用的是 .app.tar.gz 而不是 .dmg
```

---

## 附：相关文件清单（本次要动的）

| 文件 | 动作 |
| --- | --- |
| `package.json` | 加 `@tauri-apps/plugin-updater`、`@tauri-apps/plugin-process`；加版本同步脚本 |
| `src-tauri/Cargo.toml` | 加 `tauri-plugin-updater`、`tauri-plugin-process`；`[dependencies]` 里把 `tokio` 提上来并加 `time` feature（方案 B 需要） |
| `src-tauri/src/app.rs` | `run()` 里注册两个插件；`setup()` 末尾 spawn 定时检查任务（方案 B，见 §8.5） |
| `src-tauri/tauri.conf.json` | `bundle.targets` 改 `"all"`、加 `bundle.createUpdaterArtifacts`、加 `plugins.updater` |
| `src-tauri/capabilities/default.json` | 加 `updater:default`、`process:allow-restart` |
| `src/services/updateService.ts` | 新建 |
| `src/services/updateScheduler.ts` | **仅方案 A 需要**；采用方案 B 时可省略（见 §8.5） |
| `src/features/settings/SettingsView.vue` | "更新"区块接真实逻辑；`listen("update:available")` 标记可更新 |
| `.github/workflows/release.yml` | 新建（Windows + macOS 双平台 matrix） |
| `.gitignore` | 兜底忽略 `*.key` |
| `~/.tauri/flank.key`（仓库外） | 生成并离线备份（见 §8.6） |
| `scripts/bump-version.mjs` | 新建（一次改三处版本号，见 §5） |

> 双平台（Windows + macOS）还需要准备：Mac 机器上能跑的 `flank.key`、macOS 的 `bundle` 配置（`targets: "all"` 已覆盖 dmg），以及是否做 Apple 签名/公证的决定。详见 **§8.10**。
