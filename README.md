# Flank Desktop

本地优先的跨平台桌面便签应用。

## 技术栈

- Tauri 2 / Rust
- Vue 3 / TypeScript / Vite
- Pinia / Vue Router
- SQLx / SQLite（内嵌 migration）

## 环境要求

- Node.js 22.22.2+（22.x）、24.15.0+（24.x）或 26+，推荐 24.15.0+；版本要求与锁定的间接依赖一致
- npm 11+（项目声明版本为 11.9.0）
- Rust stable
- 对应平台的 [Tauri 系统依赖](https://v2.tauri.app/start/prerequisites/)

## 开发

前端及 Node.js 项目统一使用 npm，不混用其他包管理器。本项目只维护 `package-lock.json`。
首次拉取或依赖目录损坏时运行 `npm ci --include=dev`；增删依赖使用 `npm install` / `npm uninstall`，并提交锁文件。

若提示 `tauri` 不是可运行命令，先执行 `npm ci --include=dev`，再用 `npm run tauri -- --version` 检查本地 CLI。不要通过全局安装 Tauri 掩盖项目依赖缺失。

```powershell
npm ci --include=dev
npm run tauri:dev
```

仅启动 Web 前端：

```powershell
npm run dev
```

## 校验

```powershell
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

SQLite 数据库在 Tauri 应用数据目录中创建，启动时自动执行 `src-tauri/migrations`。前端通过 `src/services` 中的 typed Tauri service 调用 Rust，不直接访问数据库。

原交互原型保存在 `prototypes/noty-dock.html`。

## 开发文档

- [Dock 与便签面板：Windows 窗口交互问题与解决方案](docs/Dock-Panel-Windows-Interaction-Guide.md)
