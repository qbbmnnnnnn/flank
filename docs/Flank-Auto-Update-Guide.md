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
| `bundle.targets` | `"all"`（Windows 会同时产出 NSIS + MSI） | ⚠️ 见 §3.3 |
| `bundle.createUpdaterArtifacts` | **未配置** | ❌ 必须加 |
| updater / process 插件 | **未安装** | ❌ 必须装 |
| 签名密钥 | **无** | ❌ 必须生成 |
| `capabilities/default.json` | 无 updater 权限 | ❌ 必须加 |
| 设置页"更新"区块 | `自动检查更新` 开关已存在；`检查更新` 按钮目前只是 `showToast` 占位 | ⚠️ 需接入真逻辑 |
| `AppInfo.version` | Rust 用 `env!("CARGO_PKG_VERSION")`（读 `Cargo.toml`） | ⚠️ 与 installer 版本要一致 |
| git remote | **`https://gitee.com/M_Fisher/noty_win.git`（Gitee，不是 GitHub）** | ❗关键决策点，见 §3.4 |
| CI | 无 `.github/workflows` | ❌ 需新建 |

---

## 2. 总体方案（推荐路线）

```
本地/CI 打 tag (v0.2.0)
        │
        ▼
tauri-action 构建 Windows 安装包
  ├─ Flank_0.2.0_x64-setup.exe          （给用户手动下载）
  ├─ Flank_0.2.0_x64-setup.nsis.zip     （给 updater 用）
  └─ Flank_0.2.0_x64-setup.nsis.zip.sig （签名）
        │
        ▼
上传到 GitHub Release，并生成 latest.json
        │
        ▼
客户端 updater 请求：
https://github.com/<owner>/<repo>/releases/latest/download/latest.json
        │
        ├─ 比对 version 是否 > 当前版本
        ├─ 下载 .nsis.zip
        ├─ 用内置公钥校验 .sig
        └─ 运行安装器 → 重启
```

---

## 3. 一次性准备工作

### 3.1 安装 updater 与 process 插件

```powershell
# 前端 JS 绑定
npm install @tauri-apps/plugin-updater @tauri-apps/plugin-process

# 或者用 Tauri CLI 自动改 Cargo.toml + lib.rs + capabilities
npm run tauri add updater
npm run tauri add process
```

> 本项目 AGENTS.md 规定只用 npm，所以不要用 `pnpm tauri add`。
> `tauri add` 会尝试自动改 `src-tauri/src/lib.rs`；但本项目的 Builder 实际在 **`src-tauri/src/app.rs`** 的 `run()` 里，需要手工确认插件是否注册到了正确位置。

**`src-tauri/Cargo.toml` 应新增：**

```toml
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
```

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

Tauri 要求更新包必须签名，客户端用公钥校验，防止被中间人替换成恶意安装包。

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

> ⚠️ **两条铁律**
> 1. 私钥丢了 → 以后**再也无法**给老用户推送更新（只能让用户手动重装）。
> 2. 私钥泄露 → 任何人都能伪造你的更新包。请把 `~/.tauri/flank.key` 和密码备份到安全的地方（密码管理器 / 离线）。
> 3. 建议把 `*.key` 加进 `.gitignore` 兜底。

---

### 3.3 修改 `src-tauri/tauri.conf.json`

```jsonc
{
  "productName": "Flank",
  "version": "0.2.0",             // 每次发版要改（见 §5）
  "identifier": "com.flank.desktop",
  // ...
  "bundle": {
    "active": true,
    "targets": "all",             // 见下方说明
    "createUpdaterArtifacts": true,   // ← 关键：没有它就不会生成 .nsis.zip 和 .sig
    "icon": [ /* 保持不变 */ ]
  },
  "plugins": {
    "updater": {
      "pubkey": "① 把 flank.key.pub 的内容整段粘贴到这里 ②",
      "endpoints": [
        "https://github.com/<owner>/<repo>/releases/latest/download/latest.json"
      ],
      "windows": {
        "installMode": "passive"
      }
    }
  }
}
```

**关于 `targets`：**
- 现在 `"all"` 在 Windows 上会同时出 **NSIS（`.exe`）** 和 **MSI（`.msi`）**。
- updater 在 Windows 上**用 NSIS** 那一份（`*.nsis.zip`）。
- 建议把 `targets` 收窄为 `["nsis"]`，减少构建时间和产物混淆；如果确实要发 MSI 给企业用户，就保留 `"all"`，并在 CI 里设 `updaterJsonPreferNsis: true`。
- **重要**：必须用 NSIS 装出来的版本运行，updater 才能工作。

**`pubkey` 内容格式**：直接粘贴 `flank.key.pub` 里的**整段文本**（一行 base64，形如 `dW50cnVzdGVkIGNvbW1lbnQ6...`），不要带文件名。

---

### 3.4 ❗托管位置决策（当前 remote 是 Gitee）

你的 remote 现在是 **Gitee**，但你说要把安装包发到 **GitHub Release**。这两件事需要先统一：

| 方案 | latest.json 从哪来 | 说明 |
| --- | --- | --- |
| **A. 主仓库迁/镜像到 GitHub（推荐）** | `tauri-action` 自动生成并作为 Release 附件上传 | 全自动，最省事。需要新建 GitHub 仓库，可继续用 Gitee 做镜像 |
| **B. 留在 Gitee，自己托管 latest.json** | 手工写 / 脚本生成，放到 Gitee Release 或任意 HTTPS 静态地址 | Gitee Release **不会**自动生成 `latest.json`，每次都要手工维护，容易出错 |
| **C. GitHub 只放 Release 产物，代码留 Gitee** | 手工把产物 + latest.json 传到 GitHub Release | 可行但每次手动，且 `latest` 链接要求"最新发布" |

**建议走 A**：把仓库推到 GitHub（Gitee 可保留为国内镜像），这样 CI 一条流水线就能发版。

> 如果你坚持只发 Gitee：Tauri updater 的 `endpoints` 只认 HTTPS 上的静态 JSON，Gitee 的 Release 附件直链也能用，但**每次发版你都要手写 latest.json**（见 §4.4 格式）。

---

### 3.5 新建 GitHub Actions 流水线

创建 `.github/workflows/release.yml`：

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
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
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
          releaseDraft: true          # 先出草稿，人工确认后再 Publish
          prerelease: false
          updaterJsonPreferNsis: true # 同时存在 NSIS/MSI 时，latest.json 指向 NSIS
          # 新版 tauri-action 默认就会上传 latest.json；
          # 旧版参数名为 includeUpdaterJson: true，新版为 uploadUpdaterJson: true
```

**在 GitHub 仓库 Settings → Secrets and variables → Actions 里新增：**

| Secret | 值 |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | `flank.key` 文件的**全部内容** |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 生成密钥时设的密码（没设密码就留空字符串） |

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
const updateState = ref<"idle" | "checking" | "available" | "downloading" | "error">("idle");
const availableVersion = ref<string | null>(null);
const updateProgress = ref(0);

async function runUpdateCheck() {
  updateState.value = "checking";
  try {
    const update = await checkForUpdate();
    if (!update) {
      updateState.value = "idle";
      showToast(t("当前已是最新版本"));
      return;
    }
    availableVersion.value = update.version;
    updateState.value = "available";
  } catch (cause) {
    updateState.value = "error";
    showToast(t("检查更新失败，请稍后重试"));
  }
}

async function installUpdate() {
  const update = await checkForUpdate();
  if (!update) return;
  updateState.value = "downloading";
  await update.downloadAndInstall((event) => {
    if (event.event === "Progress" && event.data.contentLength) { /* 计算百分比 */ }
  });
  await relaunch();
}
```

顶部的 `update-hero` 也应从写死的"当前已是最新版本"改成**真实状态**：

| 状态 | hero 标题 | 右侧徽标 |
| --- | --- | --- |
| 未知 / 检查中 | 正在检查更新… | 转圈 |
| 最新 | 当前已是最新版本 | 已是最新 |
| 有新版 | 发现新版本 {{version}} | 可更新 |
| 下载中 | 正在下载 {{percent}}% | 进度 |
| 就绪 | 新版本已就绪，重启生效 | 待重启 |

### 4.3 结合现有的"自动检查更新"开关

`AppSettings.automaticUpdates` 已经存在。建议在应用启动后（延迟几秒，避免和首屏抢资源）静默检查一次，且**只在开关为 on 时**执行：

```ts
// 启动后 5 秒静默检查，只有开启自动更新才跑
if (savedSettings.value.automaticUpdates) {
  setTimeout(() => { void runUpdateCheck({ silent: true }); }, 5_000);
}
```

### 4.4 `latest.json` 格式（如果走"手工托管"方案才需要手写）

```json
{
  "version": "0.2.0",
  "notes": "本次更新：\n- 修复……\n- 新增……",
  "pub_date": "2026-01-01T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<Flank_0.2.0_x64-setup.nsis.zip.sig 文件的内容>",
      "url": "https://github.com/<owner>/<repo>/releases/download/v0.2.0/Flank_0.2.0_x64-setup.nsis.zip"
    }
  }
}
```

要点：
- `version` 必须 **大于** 用户当前版本，且和 `tauri.conf.json` 的版本号体系一致（语义化版本）。
- `signature` 是 `.sig` 文件里的**单行文本**。
- `url` 必须是**能直接下载的 HTTPS 直链**（指向 `.nsis.zip`，不是 `.exe`）。
- `platforms` 的 key：Windows x64 = `windows-x86_64`。如果以后出 ARM64，再加 `windows-aarch64`。

---

## 5. 每次发新版本的操作清单（Checklist）

### 阶段一：改代码 + 提版本号

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
  Flank_0.2.0_x64-setup.nsis.zip
  Flank_0.2.0_x64-setup.nsis.zip.sig   ← 有 .sig 才说明签名成功
  ```
- [ ] 5. 装一个**旧版本**（比如 0.1.0），再装上面这个新版本，验证升级路径不丢数据（本项目数据在 `$APPDATA`，正常不会丢）。

### 阶段三：发布

- [ ] 6. 提交并打 tag（tag 名和版本号对应）：
  ```powershell
  git add -A
  git commit -m "release: v0.2.0"
  git tag v0.2.0
  git push origin master
  git push origin v0.2.0
  ```
- [ ] 7. 等 GitHub Actions 跑完，进入 Releases 查看**草稿**：
  - 确认有 `.exe`、`.nsis.zip`、`.nsis.zip.sig`
  - 确认有 `latest.json`，且里面的 `version` / `url` / `signature` 正确
- [ ] 8. 确认无误后 **Publish release**（草稿一旦发布，`/releases/latest/` 才会指向它，用户才开始能收到更新）。
- [ ] 9. 用一台装旧版本的机器验证：设置 → 更新 → 检查更新 → 能发现 → 能下载 → 重启后版本变新。

### 阶段四：收尾

- [ ] 10. 如果这次改了数据表结构，确认 migrations 是兼容升级的（本项目用 sqlx migrate）。
- [ ] 11. 如果发了坏版本：**不要删 Release**，直接发一个更高版本 `0.2.1` 修掉。删除会让 `latest.json` 指向错误/失效。

---

## 6. 常见坑与排查

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| `check()` 永远返回 null | ① 当前版本 ≥ latest.json 的 version；② endpoint 写错；③ 处于草稿 Release | 确认已 Publish、版本已递增、URL 可 curl 通 |
| 报签名校验失败 | `pubkey` 与签名用的私钥不是一对 | 重新核对 `flank.key.pub` 是否原样粘贴 |
| 找不到 `.sig` / `.nsis.zip` | 没设 `createUpdaterArtifacts: true`，或没设 `TAURI_SIGNING_PRIVATE_KEY` | 两处都补上 |
| `relaunch()` 报 `Operation not permitted` | capabilities 缺 `process:allow-restart` | 补权限后重新构建 |
| 更新后还是旧版本 | 跑的是 dev / portable 版本，或装的是 MSI 而 latest.json 指向 NSIS 产物 | 用 NSIS 安装版测试 |
| `latest.json` 404 | 用了 `/releases/latest/download/` 但最新 Release 是 draft / prerelease | Publish 正式版 |
| CI 构建没有签名 | `TAURI_SIGNING_PRIVATE_KEY` secret 名称拼错或多行格式不对 | 私钥要整段（含换行）粘贴 |
| Gitee 方案下更新不生效 | Gitee Release 没有自动 latest.json | 手工维护，或改走 GitHub |
| 担心 CSP 阻挡下载 | 不会——下载发生在 **Rust 侧**，不经过 WebView 的 CSP | 无需改 CSP |

---

## 7. 需要你确认的两个决策点

1. **托管平台**：继续用 Gitee（要手工维护 `latest.json`），还是把仓库同步到 GitHub（推荐，全自动）？
2. **目标读者形态**：只发 Windows NSIS，还是同时保留 MSI？

确认后，我可以直接在这个仓库里落地：装插件、改 `tauri.conf.json`、写 `capabilities`、新增 `updateService.ts`、把设置页"检查更新"接成真实逻辑、加 `.github/workflows/release.yml` 和版本号同步脚本。

---

## 附：相关文件清单（本次要动的）

| 文件 | 动作 |
| --- | --- |
| `package.json` | 加 `@tauri-apps/plugin-updater`、`@tauri-apps/plugin-process`；加版本同步脚本 |
| `src-tauri/Cargo.toml` | 加 `tauri-plugin-updater`、`tauri-plugin-process` |
| `src-tauri/src/app.rs` | `run()` 里注册两个插件 |
| `src-tauri/tauri.conf.json` | `bundle.createUpdaterArtifacts`、`plugins.updater` |
| `src-tauri/capabilities/default.json` | 加 `updater:default`、`process:allow-restart` |
| `src/services/updateService.ts` | 新建 |
| `src/features/settings/SettingsView.vue` | "更新"区块接真实逻辑 |
| `.github/workflows/release.yml` | 新建 |
| `.gitignore` | 兜底忽略 `*.key` |
| `~/.tauri/flank.key`（仓库外） | 生成并离线备份 |
