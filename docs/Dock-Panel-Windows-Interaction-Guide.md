# Dock 与便签面板：Windows 窗口交互问题与解决方案

> 本文记录 Dock / `dock-panel` 在本轮调试中确认的问题、原因、最终方案和不可随意破坏的约束。适用于 Tauri 2 + Windows + WebView2。

## 1. 当前窗口结构

Flank 使用两个独立的原生窗口：

- `dock`：屏幕边缘的便签栏；
- `dock-panel`：预览或编辑便签的弹出面板。

核心文件：

| 责任 | 文件 |
| --- | --- |
| 原生窗口配置 | `src-tauri/tauri.conf.json` |
| 面板定位、窗口区域、无边框与层级 | `src-tauri/src/commands/system.rs` |
| 原生命令注册 | `src-tauri/src/app.rs` |
| Dock 状态、交互和样式 | `src/features/dock/DockView.vue` |
| 面板状态、动画和样式 | `src/features/dock/DockPanelView.vue` |
| 首帧透明背景 | `src/main.ts`、`src/styles/main.css` |
| 跨窗口事件 | `src/features/dock/bridge.ts` |

### 1.1 关键尺寸

当前尺寸都是**逻辑像素**：

- Dock 原生窗口与 `.dock-rail`：`104px`；
- Dock 便签纸：宽 `88px`，高 `126px`；
- Dock 便签横向隐藏量：`48px`；
- 相邻便签纵向重叠：`16px`；
- 面板卡片：`380px`；
- 面板静态配置宽度：`432px`；
- 面板运行时动画窗口：`536px = 432px + 104px Dock 区域`；
- 面板最终与屏幕边缘的距离：`104px`，即停在 Dock 内侧；
- Windows 顶部原生标题栏防护区域：`32px`。

这些常量目前分布在 Vue/CSS、Tauri 配置和 Rust 中。修改时必须同步检查，见文末“尺寸同步清单”。

---

## 2. 面板入场动画被窗口边界裁切

### 现象

面板旋转、回弹进入时，边缘会被原生窗口裁掉。

### 原因

CSS/GSAP 只能在 WebView 的原生窗口矩形内绘制。即使 DOM 使用 `overflow: visible`，也无法越过原生窗口边界。面板卡片宽 `380px`，旋转和回弹还需要额外缓冲空间。

### 正确方案

1. 面板静态窗口宽度由 `396px` 增加到 `432px`，为卡片旋转留出缓冲；
2. 入场时原生窗口扩展为 `536px`，覆盖“面板缓冲区 + Dock 区域”；
3. 只使用 GSAP 的 `x`、`rotation`、`autoAlpha` 做动画，不通过连续改变窗口宽度做动画。

### 不要这样做

- 不要依赖 CSS `overflow` 绕过原生窗口边界；
- 不要在动画过程中频繁调整原生窗口尺寸，这会产生 WebView2 重绘和闪动；
- 不要在动画结束后把窗口从 `536px` 缩回 `432px`，这已经验证会造成明显闪动。

---

## 3. 面板必须从屏幕边缘进入，并停在 Dock 旁边

### 目标行为

- Dock 在右侧：面板从右侧屏幕边缘出现，最终停在 Dock 左边；
- Dock 在左侧：面板从左侧屏幕边缘出现，最终停在 Dock 右边；
- 最终不能遮挡 Dock 便签及其鼠标移入后的伸出区域。

### 正确方案

原生窗口由 `show_dock_panel` 根据**当前显示器物理边界**定位：

- 左侧：窗口 `x = monitor.position.x`；
- 右侧：窗口 `x = monitor.right - staged_width`；
- `y` 继续跟随 Dock 窗口，保持垂直对齐。

面板 DOM 在动画窗口内预留 Dock 空间：

```css
.edge-staged.dock-right .note-panel { right: 104px; }
.edge-staged.dock-left .note-panel { left: 104px; }
```

因此，原生窗口可以延伸至屏幕边缘，卡片则停在 Dock 内侧。入场动画从屏幕边缘开始，而不是从 Dock 内侧边界开始。

### 注意

定位必须使用显示器的物理坐标和 `monitor.scale_factor()`。不要混用 CSS 逻辑像素和 Tauri `outer_position()` / `outer_size()` 返回的物理像素。

---

## 4. 面板保持宽窗口时，Dock 区域无法点击

### 现象

面板视觉上没有覆盖 Dock，但其透明原生窗口仍覆盖 Dock，导致 Dock 无法悬停或点击。

### 原因

CSS 的 `pointer-events: none` 只影响 WebView 内 DOM 命中，不等于让鼠标穿透到另一个原生窗口。透明的顶层原生窗口仍可能截获 Windows 命中测试。

### 正确方案：Windows 窗口区域裁剪

使用 `SetWindowRgn` 调整 `dock-panel` 的原生窗口区域：

- 入场和退场动画期间：使用完整横向区域，让面板可以从屏幕边缘绘制；
- 入场完成后：裁掉靠近屏幕边缘的 `104px` Dock 区域；
- 被裁掉的部分既不绘制，也不接收鼠标事件；
- 面板窗口宽度始终保持 `536px`，不做缩回操作。

相关命令：

- `show_dock_panel`：准备完整动画区域；
- `settle_dock_panel`：动画完成后裁掉 Dock 区域；
- `prepare_dock_panel_animation`：关闭前恢复动画区域；
- `hide_dock_panel`：退场完成后隐藏原生窗口。

### 关键约束

不要使用 `SetWindowRgn(hwnd, NULL, ...)` 恢复默认区域。窗口可见时恢复系统默认区域，可能触发 Windows 非客户区重绘，短暂出现标题栏和不透明背景。当前实现始终用 `CreateRectRgn` 创建显式矩形区域。

---

## 5. 面板刚弹出时 Dock 暂时不能悬停

### 现象

面板出现后的约 `0.86s` 内，鼠标移入 Dock 没有反应，动画结束后才恢复。

### 原因

入场动画由两段组成：

- `0.56s` 主进入；
- `0.30s` 回弹稳定。

在动画结束前，面板必须保留覆盖屏幕边缘的完整原生区域。此时它与 Dock 原生窗口重叠，会抢占鼠标命中。

### 正确方案：提高 Dock 层级但不抢焦点

面板显示并聚焦后，使用 Windows `SetWindowPos` 将 Dock 提升到面板之上：

- `HWND_TOPMOST`：保持 Dock 位于面板上层；
- `SWP_NOMOVE | SWP_NOSIZE`：不改变 Dock 位置和尺寸；
- `SWP_NOACTIVATE`：不抢走面板编辑器焦点。

这样无需缩短动画，也无需提前裁切动画内容，Dock 从第一帧起即可悬停和点击。动画完成后仍执行原生区域裁剪。

---

## 6. 切换便签时出现 Windows 默认标题栏

### 现象

首次打开正常，但点击另一个 Dock 便签切换面板时，窗口顶部短暂出现带有 `Flank Panel` 标题的 Windows 原生标题栏；外部点击关闭时不一定出现。

### 原因

这不是 CSS 边框，而是 Windows/WebView2 的非客户区。切换过程中涉及窗口区域、焦点和顶层窗口重绘，Windows 可能短暂恢复或绘制默认窗口样式。

只设置以下 Tauri 配置仍不总是足够：

```json
{
  "decorations": false,
  "transparent": true,
  "shadow": false
}
```

Dock 不易出现该问题，是因为 Dock 不主动聚焦，也不在切换时反复修改原生窗口区域；面板会聚焦并执行区域切换。

### 正确方案：三层防护

#### A. Tauri 基础配置

`dock-panel` 必须保持：

- `decorations: false`；
- `transparent: true`；
- `shadow: false`；
- `resizable: false`。

#### B. 强制移除 Windows 窗口样式

通过 `GetWindowLongPtrW` / `SetWindowLongPtrW` 移除：

- `WS_BORDER`；
- `WS_DLGFRAME`；
- `WS_THICKFRAME`；
- `WS_SYSMENU`；
- `WS_MINIMIZEBOX`；
- `WS_MAXIMIZEBOX`。

样式变化后使用 `SetWindowPos(... SWP_FRAMECHANGED ...)` 刷新非客户区，并使用：

```text
DWMWA_BORDER_COLOR = DWMWA_COLOR_NONE
```

禁用 DWM 边框颜色。面板聚焦前后、窗口区域变化后都应重新确认无边框状态。

#### C. 顶部区域硬防护

Windows 偶发非客户区绘制发生得非常短，仅靠样式更新可能赶不上该帧。因此原生窗口区域始终排除顶部 `32px × scaleFactor` 的空白带。

面板内容垂直居中，不使用这部分区域，所以不会裁切实际 UI；即使 Windows 尝试绘制标题栏，该区域也不属于窗口，无法显示。

### 同时减少不必要的非客户区重绘

- 窗口宽度已经是目标值时，不重复调用 `set_size()`；
- 窗口位置已经是目标值时，不重复调用 `set_position()`；
- 原生窗口已经显示时，不重复调用 `show()`。

这些优化不能替代无边框处理，但可以减少触发 Windows 回退帧的机会。

---

## 7. 透明背景首帧闪烁

### 现象

原生窗口本身透明，但 Vue/路由挂载前可能短暂显示应用默认页面背景。

### 原因

全局样式默认给 `:root` 和 `body` 设置了不透明背景；原先要等组件 `onMounted` 后才添加 `.dock-document`。

### 正确方案

在 `src/main.ts` 中、Vue 挂载前根据 Hash 路由同步添加透明类：

```ts
if (window.location.hash.startsWith("#/dock")) {
  document.documentElement.classList.add("dock-document");
  document.body.classList.add("dock-document");
}
```

同时保留：

```css
html.dock-document,
body.dock-document,
body.dock-document #app {
  width: 100%;
  height: 100%;
  background: transparent;
}
```

原生透明与 Web 页面透明缺一不可。

---

## 8. Dock 窗口宽度看起来比便签伸出宽度大

### 现象

便签纸本身较窄，但观察到 Dock 原生窗口约 `136px`，怀疑窗口过宽。

### 原因

1. Tauri 配置中的 `104px` 是逻辑像素；Windows 工具通常显示 DPI 缩放后的物理像素；
2. 原生窗口必须容纳便签悬停位移、邻近放大（最大约 `1.14`）、旋转和拖拽状态；
3. 便签纸宽度与承载动画的原生窗口宽度不是同一个概念。

### 正确方案

- `.note-tab` 保持 `88px`；
- `.dock-rail` 和原生 `dock` 窗口保持 `104px`；
- 不要把原生窗口同步缩到 `88px`，否则放大和旋转边缘会被裁切；
- 判断尺寸时先区分逻辑像素与物理像素。

---

## 9. Dock 便签尺寸、重叠与标题截断

### 目标

- 便签比旧版更窄、更高；
- 相邻便签重叠更多；
- 最多展示 5 个完整汉字，超出时显示省略号。

### 当前方案

标准模式：

```text
宽 88px
高 126px
右/左隐藏 48px
纵向重叠 16px
```

紧凑屏幕模式：

```text
高 104px
纵向重叠 14px
```

标题不能只依赖 CSS `text-overflow`，因为使用了竖排文本。当前由 `displayTitle()` 按 Unicode 字符截断：

```ts
const chars = Array.from(title);
return chars.length > 5 ? `${chars.slice(0, 5).join("")}…` : title;
```

`Array.from` 可避免直接按 UTF-16 code unit 切断代理对字符；如后续需要完整支持 ZWJ/组合字形，应改用 `Intl.Segmenter`。

---

## 10. 点击面板外部关闭后，Dock 便签仍保持展开

### 原因

关闭时只清空了 `activeNoteId`，但 GSAP `quickTo` 写入的 transform 是内联状态，不会因为 Vue 状态清空自动恢复。

### 正确方案

`closePanel()` 中按以下顺序处理：

1. 清空 `panelOpen`、`activeNoteId`、`isNewNotePending`；
2. 调用 `resetRail()`；
3. 向面板发送关闭事件；
4. 等待约 `240ms` 退场动画后隐藏原生窗口。

`resetRail()` 必须把所有便签恢复到 `scaleX/scaleY = 1`、`x = 0`，并清除 `nearest`、快捷操作和预览状态。

---

## 11. 面板失焦关闭与切换便签冲突

### 风险

点击另一个 Dock 便签时，面板会先失焦。如果失焦立即关闭，就会与“切换便签”竞争，造成误关闭或动画错乱。

### 当前协调方案

- 打开/切换前设置 `suppressBlurUntil = now + 260ms`；
- 失焦关闭延迟 `180ms`；
- 切换操作会清除待执行的关闭定时器；
- Dock 是面板原生窗口的唯一控制者；
- 使用 `panelToken` 防止旧的延迟隐藏任务关闭新打开的面板。

这些短延迟用于区分“点击另一个 Dock 便签”和“点击其他 Windows 区域”，不要与第 5 节的 Dock 悬停阻塞混为一谈。Dock 悬停阻塞已通过原生层级处理，不应通过删除失焦保护时间解决。

---

## 12. 顶部与底部控制按钮背景反复变色

### 原因

旧实现定时采样按钮附近的屏幕亮度，并在 light/dark 样式之间切换。桌面内容变化时，按钮视觉会持续改变。

### 正确方案

- 移除 `controlTones`、`sampleControlContrast()` 和周期采样定时器；
- 拖拽、新增和设置按钮统一使用固定深色半透明背景；
- Hover 只增强前景，不切换背景主题；
- 使用 `.selected` 提供边框、光环、内发光和图标变换；
- 拖拽状态、新建状态和设置点击反馈分别绑定选中态。

Rust 中屏幕亮度采样命令可能仍被其他功能保留，但 Dock 控件不应再次依赖它自动换色。

---

## 13. 动画和生命周期约束

- GSAP 动画使用 `x`、`rotation`、`scale`、`autoAlpha`，避免逐帧修改布局属性；
- 动画只在 DOM 挂载后创建；
- Vue 卸载时必须 kill/revert timeline、context 和 matchMedia；
- 使用 `prefers-reduced-motion` 时跳过主要位移动画，但仍要执行原生窗口区域的最终状态切换；
- 面板切换时先结束旧面板，再进入新面板；
- 不要用窗口 resize 代替 DOM transform 动画。

---

## 14. 尺寸同步清单

修改 Dock 宽度时，至少检查以下位置：

1. `src-tauri/tauri.conf.json`
   - `dock.width`
   - `dock.minWidth`
2. `src/features/dock/DockView.vue`
   - `--rail`
   - `snapNativeWindow()` 中 `railWidth`
   - `.note-tab` 宽度、隐藏 margin 和最大悬停位移
3. `src/features/dock/DockPanelView.vue`
   - `.edge-staged.dock-right .note-panel`
   - `.edge-staged.dock-left .note-panel`
4. `src-tauri/src/commands/system.rs`
   - `staged_width`
   - `set_panel_dock_passthrough()` 中 `clearance`

当前关系：

```text
Dock clearance = 104
Panel settled width = 432
Panel staged width = 432 + 104 = 536
```

如果只改其中一个值，会出现以下回归之一：

- 面板停靠位置错误；
- Dock 被面板覆盖；
- 点击透传区域不准确；
- 入场动画被裁切；
- 左右吸附不对称。

---

## 15. 验证方式

前端与 Rust 静态检查：

```powershell
npm run build
npm test
cargo check --manifest-path src-tauri/Cargo.toml
```

原生窗口行为不能只靠浏览器预览验证。每次修改以下内容后必须完全退出并重启 Tauri 应用：

- `tauri.conf.json`；
- Rust command；
- Win32/DWM 窗口样式；
- `SetWindowRgn`；
- 原生窗口尺寸、位置和层级。

建议手工回归：

1. 首次打开左右两侧 Dock 面板；
2. 连续快速切换多个便签；
3. 在面板入场过程中立即悬停和点击 Dock；
4. 点击桌面或其他应用关闭面板；
5. 确认关闭后 Dock 便签收回；
6. 新建便签并测试输入焦点；
7. 在 100%、125%、150% DPI 下测试；
8. 将 Dock 拖到另一侧或另一显示器后重复测试；
9. 检查是否出现默认标题栏、黑色背景、尺寸闪动或动画裁切。
