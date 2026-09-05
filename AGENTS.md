# 项目协作规范

- 前端与 Node.js 项目统一使用 npm；不要使用 pnpm、Yarn 或 Bun 安装依赖或运行脚本。
- 仅维护并提交 `package-lock.json`，不创建其他包管理器的锁文件或工作区配置。
- 安装已有锁定依赖：`npm ci --include=dev`；增删依赖：`npm install` / `npm uninstall`。
- 启动桌面开发：`npm run tauri:dev`；启动前端：`npm run dev`。
- 验证：`npm run build`、`npm test`；Tauri CLI 检查：`npm run tauri -- --version`。
- 使用项目本地 CLI，不以全局安装 Tauri/Vite 来绕过依赖安装问题。
