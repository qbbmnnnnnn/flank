# Noty Desktop

本地优先的跨平台桌面便签应用。

## 技术栈

- Tauri 2 / Rust
- Vue 3 / TypeScript / Vite
- Pinia / Vue Router
- SQLx / SQLite（内嵌 migration）

## 环境要求

- Node.js 20+
- pnpm 10+
- Rust stable
- 对应平台的 [Tauri 系统依赖](https://v2.tauri.app/start/prerequisites/)

## 开发

```powershell
pnpm install
pnpm tauri:dev
```

仅启动 Web 前端：

```powershell
pnpm dev
```

## 校验

```powershell
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
```

SQLite 数据库在 Tauri 应用数据目录中创建，启动时自动执行 `src-tauri/migrations`。前端通过 `src/services` 中的 typed Tauri service 调用 Rust，不直接访问数据库。

原交互原型保存在 `prototypes/noty-dock.html`。
