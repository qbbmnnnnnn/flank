# 便签编辑器：统一 CodeMirror 6 实现

## 本轮定位

用户截图来自 **Dock 浮动便签**（`DockPanelView.vue`），不是资料库的 `NoteEditor.vue`。上一轮只修复资料库，漏掉了 Dock 内复制的 contenteditable 实现，因此不能把上一轮浏览器结果视为浮动便签已修复。

原实现存在三个相互关联的问题：

- 手工维护的空 span / BR 和 Range 与浏览器实际插入位置不一致，导致空行光标异常、内容并行或换行失败。
- placeholder 由 DOM class 手工开关，正文读取又依赖特定 `.editor-line-copy` 结构，浏览器插到其他节点的输入未必被识别。
- 勾选按钮和可编辑文本嵌套在同一手工布局中，点击状态与光标位置没有稳定的文档坐标对应。

## 实现与交互约定

两个入口现在统一使用 `src/components/MarkdownEditor.vue`，共享 `src/components/editor/noteEditor.ts`。删除两套手写 DOM 整理、选区恢复、粘贴拆行和快照历史逻辑。

- **正文是唯一数据源**：CodeMirror EditorState 的文本同步到 Vue 草稿；保存不再读取、修补或重建编辑区 DOM。
- **占位文字**：直接使用 CodeMirror `placeholder()`，随文档长度立即显示/消失，位于同一文字布局流中。正文非空（包括空行和空任务）不显示占位文字。
- **光标、输入法、剪贴板、历史**：交给 CodeMirror 的原生输入观察与事务处理。父组件保存反馈不会回写相同文本、打断选区或组词。
- **换行**：普通 Markdown 使用官方 Markdown 换行命令与普通换行后备；任务行延续未完成任务，空任务 Enter 退出。Shift+Enter 为普通换行。
- **任务控件**：`WidgetType` + `Decoration.replace` + `EditorView.atomicRanges`。按钮不可编辑，方向键跨过整个任务标记；点击后定位到对应行文字，同一行保留文字偏移。支持空格键和 Enter 激活。
- **任务光标几何**：真实浏览器测试发现单纯给按钮加 margin 会使空任务光标贴在按钮右边缘。改用包含 9px 文字间距的 28px 控件容器；自动断言光标至少在按钮右侧 5px，而不仅断言文档偏移。
- **存储兼容**：保留现有 `☐ / ☑`；同时支持标准 `- [ ] / - [x]`（也识别 `*`、`+`）。勾选保持原语法，不做整篇转换；代码块内标记保留为字面文本。
- **工具栏**：通过事务修改当前文档选区。任务按钮将当前行变为任务；已经是任务则定位到文字起点，不再制造额外空任务。格式和勾选操作各自隔离撤销边界。
- **生命周期**：Dock 新便签/编辑会话使用新组件 key，避免跨便签撤销；组件卸载销毁 EditorView。外部不同正文重置状态，相同正文回声不触碰状态。
- **滚动/动画**：保持原设计与 Dock 动画，不新增装饰动效；正文由 `.cm-scroller` 独占局部滚动。Dock 入场和原生窗口稳定后请求重新测量光标。

## 实际使用的开源代码

本轮不是仅参考资料，而是直接安装、使用 MIT 许可的 CodeMirror 6 官方包；检查了安装包中的实现：

- `@codemirror/view/dist/index.js`：`WidgetType`、`placeholder`、atomic ranges，及字体加载后重新测量逻辑。
- `@codemirror/lang-markdown/dist/index.js`：`insertNewlineContinueMarkupCommand` 的列表续行/退出和 fallback 约定。
- `@codemirror/state`、`@codemirror/commands`：事务、选区、原生历史；不再自己拼接 DOM 快照历史。
- `@codemirror/language`：语法树识别代码块，避免将代码示例误渲染为任务控件。

资料入口：
- https://codemirror.net/docs/guide/
- https://codemirror.net/examples/decoration/
- https://github.com/codemirror/view
- https://github.com/codemirror/lang-markdown

之前评估的 Milkdown / Tiptap 仍适合未来完整所见即所得需求，但本轮无需迁移便签存储格式或引入 ProseMirror 模型。

## 修改文件

- `src/components/MarkdownEditor.vue`：共用 Vue 编辑组件、样式与生命周期。
- `src/components/editor/noteEditor.ts`：CodeMirror 配置、任务控件及工具栏命令。
- `src/components/NoteEditor.vue`、`src/features/dock/DockPanelView.vue`：移除重复编辑实现，保留配色、预览和保存接口。
- `src/components/NoteEditor.test.ts`：两个入口各 8 项组件测试。
- `tests/note-editor.e2e.ts`、`tests/editor-layout.e2e.ts`：实际入口的浏览器交互与坐标测试。
- `playwright.config.ts`、`package.json`、`package-lock.json`：编辑依赖、Playwright 与 `test:e2e`。npm 将原 lockfile v1 自动升级为 v3；未新增其他包管理器锁文件。

## 验证结果

- `npm test`：7 个测试文件、**40 项通过**。
- `npm run test:e2e`：**20 项 Chromium 浏览器测试通过**。
  - 两个真实页面分别覆盖占位文字即时清理、连续空行、自动保存后继续输入、任务光标坐标、点击后输入、键盘勾选、撤销重做、选区粘贴、格式、方向键及删除、代码块、长文档滚动。
  - Chromium CDP `Input.imeSetComposition` / `Input.insertText` 验证组词、占位文字消失、提交后换行；不是通过手工修改 DOM 模拟输入。
  - Dock 保存→预览→再编辑保留首尾空行，新建会话不继承历史。
  - 720×700、1024×768、1280×800，设备比例 1.25，正常 Dock 入场动画后检查占位/任务光标与横向溢出。其他行为测试使用 reduced-motion。
  - 被测页面无未捕获 JavaScript 异常。
- `npm run build`：通过。仍有 Tauri core 混合导入警告；新编辑共享块约 509KB（gzip 177KB），触发 Vite 默认 500KB 提示，是引入成熟编辑内核的体积成本，未通过调高阈值掩盖。
- `git diff --check`：通过。
- 截图、失败时 trace 输出到 `.artifacts/editor-browser/`。

运行浏览器回归：首次执行 `npx playwright install chromium`，然后 `npm run test:e2e`。测试借助 Vue 开发实例的现有 Dock open handler 打开真实浮动面板，无生产测试入口、Tauri 全局伪装或真实数据库写入。

## 验证边界

未启动原生 Windows WebView2 做系统输入法候选窗口实测，也未回归真实数据库写入；浏览器测试不能替代这两项。当前仍是 Markdown 源码编辑 + 可操作任务控件，并不是完整所见即所得编辑器。
