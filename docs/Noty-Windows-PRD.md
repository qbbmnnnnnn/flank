# Noty for Windows 产品需求文档（PRD）

> 文档状态：Draft v1.0  
> 调研日期：2026-09-02  
> 上游仓库：<https://github.com/aimen08/noty>  
> 研究基线：`main` @ [`200e9cb55065ce52c12d04031aa022e978934bdb`](https://github.com/aimen08/noty/tree/200e9cb55065ce52c12d04031aa022e978934bdb)（v1.4.0）  
> 目标平台：Windows 10 22H2、Windows 11，x64  
> 目标版本：Windows MVP 1.0  
> 说明：本文中的性能数值是待原型验证的目标，不是现有 macOS 版本的实测结果。

---

## 1. 文档摘要

Noty 是一款以“屏幕边缘便签组”为核心形态的 macOS 本地便签应用。它通过 `Rest → Fan → Expanded` 三态交互，将常用便签收纳在屏幕边缘；同时提供 Quick Capture、任务、轻量 Markdown、归档搜索、导入导出和本地正文加密。

Windows 版不应被定义为 Swift 源码的逐行移植，也不应退化为普通托盘记事本。项目目标是在 Windows 上重建以下核心价值：

1. **随叫随到**：从全局快捷键、托盘或屏幕边缘快速进入记录；
2. **低打扰**：预览不抢焦点，用完自动收起，不制造大量任务栏窗口；
3. **本地优先**：无账号、无云端笔记服务，正文加密存储；
4. **数据可迁移**：以经过验证的 `.stickies` 文件为 Mac → Windows 官方迁移路径；
5. **Windows 可靠性**：单实例、多显示器/混合 DPI、IME、崩溃恢复、签名更新达到可发布标准。

### 1.1 MVP 产品定义

> Noty for Windows 是一款驻留系统托盘、可通过快捷键和屏幕边缘快速召出的本地加密便签工具。用户可在不中断当前工作的情况下捕获内容，并通过边缘 Deck 浏览、编辑、固定、排序、归档和搜索便签。

### 1.2 MVP 必须交付

- 系统托盘、全局快捷键、可关闭的边缘 Deck；
- Rest / Fan / Expanded 三态；
- Quick Capture、新建、编辑、自动保存、删除与 10 秒撤销；
- 8 色、固定、拖动排序、归档、恢复；
- Library、All Notes / Archive、标题与正文基础搜索；
- 任务文本语义与 Markdown 原文无损存储；
- `.stickies v2` 导入和兼容导出，MD/TXT 导入导出；
- SQLite 本地存储、正文加密、滚动备份与故障恢复；
- 单实例、可选开机启动、安装签名、可控更新；
- Windows 10/11 x64、多显示器、Per-Monitor V2 DPI、中文 IME、键盘可达性。

### 1.3 MVP 明确不做

- 账号、云同步、多人协作；
- 提醒与重复提醒；
- 每条便签独立桌面浮窗；
- 将便签贴附到特定网页、文档或应用窗口；
- 文件夹、标签、附件、版本历史；
- ARM64 原生包；
- Microsoft Store 第二分发渠道；
- 直接复制 macOS `notes.db` / `note.key` 迁移。

---

## 2. 调研结论与项目依据

### 2.1 上游产品事实

基于锁定提交的 README 与源码：

- macOS 版使用 Swift、SwiftUI、AppKit、Carbon、SQLite、CryptoKit；最低 macOS 15；
- 不显示 Dock 图标，核心入口是屏幕边缘 Deck 与全局快捷键；
- 每个目标显示器可创建一个 Deck，状态为 Rest、Fan、Expanded；
- Quick Capture 支持 `Return` 保存、`Shift+Return` 换行、`Esc`/失焦取消；
- 输入停止 250ms 后自动保存，关闭前强制保存；
- 正文以 AES-GCM 加密，标题、颜色、时间、归档、顺序、固定和文字方向等元数据明文；
- 数据位于本地 SQLite，无账号、分析、遥测和笔记服务器；
- `.stickies` 是 Noty 自定义 JSON，不是 Apple Stickies 文件格式；
- 仓库采用 MIT License，迁移/修改/分发须保留版权和许可声明；Sparkle 亦为 MIT；
- 研究时仓库约 254 stars、42 forks、5 个开放 issue；已有公开 Windows 请求 [#17](https://github.com/aimen08/noty/issues/17)，说明存在方向性需求，但不能代替用户规模验证。

### 2.2 已确认的数据兼容缺口

[`Sources/ExportImport.swift`](https://github.com/aimen08/noty/blob/200e9cb55065ce52c12d04031aa022e978934bdb/Sources/ExportImport.swift) 中 `.stickies v2` 包含：

- `id`
- `title`
- `body`
- `color` / `colorName`
- `created` / `modified`
- `archived`
- `order`
- `textDirection`

**不包含 `pinned`。** 因此当前 Mac 导出不能无损迁移固定状态。Windows MVP 必须在导入摘要中明确提示“固定状态不会从 Mac 导入”，不得宣传为所有字段完整迁移。

### 2.3 Windows 竞品基线

| 产品 | 已验证的优势 | Noty 的差异化机会 |
|---|---|---|
| Microsoft Sticky Notes | 系统信任、列表搜索、跨微软账户设备 | 不支持始终置顶；缺少边缘 Deck 与低打扰瞬时召出 |
| Notezilla | 托盘、全局热键、提醒、窗口贴附、同步 | Noty 保持更轻、更少设置、默认离线与正文加密 |
| Simple Sticky Notes | 轻量托盘、多便签、提醒、多屏持续优化 | Noty 用 Deck、快捷捕获和隐私承诺竞争 |
| Stickies (Zhorn) | 稳定、备份、位置恢复、提醒与自动化 | Noty 聚焦现代交互与低窗口负担 |

**结论：** 托盘、快捷键、跨重启恢复和多便签管理是 Windows 基线；边缘 Deck、本地加密、快速收纳是 Noty 的主差异化。

---

## 3. 产品目标与成功标准

### 3.1 业务目标

1. 在 Windows 上建立可持续迭代的 Noty 原生桌面产品；
2. 保留 macOS 版的品牌心智，而不是复制传统桌面黄贴；
3. 为 Mac 用户提供可解释、可回滚的数据迁移路径；
4. 将本地隐私、召出速度与稳定性作为首发竞争力；
5. 为后续提醒、独立浮窗、ARM64、Store 分发预留扩展能力。

### 3.2 用户目标

- 在任意应用中，以一次快捷键快速记录；
- 不切换到大型笔记应用即可查看或修改常用便签；
- 用完自动收起，不长期遮挡当前工作；
- 重启、升级、显示器变化后不丢内容、不丢顺序；
- 能从 Mac 导入已有内容，并清楚知道哪些字段未迁移；
- 明确知道哪些数据加密、哪些元数据明文、何时会联网。

### 3.3 MVP 成功指标

产品公开发布后 30 天观察以下指标。默认不采集内容数据；如启用匿名产品指标，必须用户主动同意并经隐私评审。

| 指标 | 目标 |
|---|---:|
| 安装后 24 小时内成功创建至少 1 条便签的用户占比 | ≥ 65% |
| 创建过便签用户的 7 日留存 | ≥ 30% |
| Quick Capture / 全局快捷键完成率 | ≥ 98% |
| 无数据损坏会话占比 | ≥ 99.99% |
| 崩溃自由会话率 | ≥ 99.5% |
| `.stickies` 有效文件导入成功率 | ≥ 99% |
| 更新成功率 | ≥ 98% |
| 5–8 人可用性测试中独立完成“新建、查找、退出” | ≥ 6/8 |
| 正常办公中边缘热区误展开 | ≤ 1 次/30 分钟/人 |

> 若坚持“零遥测”，则用自愿反馈、公开 issue、可选诊断包和实验室测试评估上述指标，不得暗中收集。

---

## 4. 用户画像与核心场景

### 4.1 主要用户

**A. 键盘驱动的效率用户**  
频繁在浏览器、IDE、办公软件之间工作，希望不切换上下文就记下待办或信息。

**B. 隐私敏感的个人用户**  
不需要云协作，不愿创建账号或把工作碎片发送到服务器。

**C. Mac → Windows 迁移用户**  
已经使用 Noty，希望迁移正文、颜色、时间、归档、顺序和文字方向。

**D. 多屏工作者**  
常在不同 DPI 的双屏环境中工作，需要稳定召出、可见区域约束和热插拔恢复。

### 4.2 Jobs to Be Done

1. 当我正在其他应用工作时，我想立刻记录一个想法，以便不打断当前任务；
2. 当我需要回看常用信息时，我想从屏幕边缘快速浏览，以便不管理额外窗口；
3. 当便签增多时，我想搜索、归档和恢复，以便保持 Deck 简洁；
4. 当我更换平台时，我想导入旧便签并看到迁移结果，以便确认没有静默丢失；
5. 当系统重启或应用升级时，我想恢复到可靠状态，以便信任自动保存。

---

## 5. 产品原则

1. **捕获优先于组织**：新建路径必须比分类路径短；
2. **内容优先于装饰**：Markdown 样式可分阶段，原文与输入可靠性不可妥协；
3. **预览不抢焦点，编辑必须可靠得焦点**；
4. **热区是品牌入口，不是唯一入口**：快捷键和托盘必须完整兜底；
5. **静默成功，可行动失败**：正常保存不弹通知，保存失败绝不能静默消失；
6. **本地优先不是“绝不联网”**：只允许可解释、可关闭的更新请求；
7. **不夸大加密**：正文加密不等于标题、索引和导出文件全部加密；
8. **迁移不静默丢字段**：支持、转换、忽略、失败都必须在导入报告中呈现。

---

## 6. 信息架构

```text
Noty for Windows
├─ System Tray
│  ├─ 显示/隐藏 Deck
│  ├─ 新建便签 / Quick Capture
│  ├─ All Notes / Archive
│  ├─ 开机启动 / 设置
│  └─ 退出 Noty
├─ Edge Deck
│  ├─ Hidden
│  ├─ Rest：Pill + 颜色短条
│  ├─ Fan：前 5 条 Tab / Chip + Overflow
│  ├─ Preview：非激活预览
│  └─ Expanded：便签编辑器
├─ Quick Capture
├─ Library
│  ├─ All Notes
│  ├─ Archive
│  ├─ Search
│  └─ Detail Editor
├─ Settings
│  ├─ General
│  ├─ Shortcuts
│  ├─ Deck
│  ├─ Notes
│  ├─ Data & Privacy
│  └─ Updates
├─ Import / Export
├─ First-run Onboarding
└─ Feedback
   ├─ 10 秒删除撤销
   ├─ 导入结果
   ├─ 保存/磁盘错误
   └─ 更新或恢复异常
```

---

## 7. 关键产品决策（MVP 冻结值）

| 决策域 | MVP 决策 |
|---|---|
| 主入口 | 全局快捷键为最可靠入口；托盘负责发现、管理与退出；热区保留差异化且可关闭 |
| Deck 数量 | **单一 Deck**；召出时移动到目标显示器。MVP 不在多屏同时显示多套 Deck |
| 召出显示器 | 优先鼠标所在显示器；不可用时为活动窗口显示器；再回退主显示器 |
| Deck 的 Alt+Tab / 任务栏 | 不进入 Alt+Tab，不显示任务栏按钮；Library 与 Settings 正常进入 |
| 热区默认值 | 首次引导中默认建议开启，用户明确确认；无人值守/升级安装不自动开启 |
| 焦点 | Rest/Fan/Preview 不抢焦点；点击编辑或 Quick Capture 后取得输入焦点；完成后尽力恢复原前台窗口 |
| 关闭 | `Esc` 收起当前层级；Deck 的关闭按钮隐藏；`Alt+F4` 在 Deck/Quick Capture 上隐藏；托盘“退出”才终止进程 |
| 置顶 | 默认关闭；用户可置顶 Expanded。全屏应用中默认不覆盖，提供高级设置 |
| 启动 | 开机启动默认关闭；开启后静默进入托盘，不打开 Deck、不抢焦点 |
| 搜索 | MVP 保留 All Notes / Archive 分区内标题与正文子串搜索，不建持久化明文 FTS |
| Markdown | 原文无损；MVP 支持基础实时样式，但 marker 隐藏可在 IME 稳定后开启 |
| 更新 | 自动检查可关闭；下载/安装不在用户编辑时强制发生；正式包必须可信签名 |
| 遥测 | 默认无产品遥测；崩溃/诊断信息仅用户主动提交，且移除正文、标题、搜索词 |

---

## 8. 功能需求

优先级定义：**P0** = MVP 发布阻断；**P1** = MVP 后首批；**P2** = 候选增强。

### 8.1 首次启动与引导

#### FR-ONB-001 首次启动（P0）

首次启动展示不超过 3 步的轻量引导：

1. 介绍边缘 Pill → Fan → Expanded；
2. 让用户确认热区是否开启、位于左侧还是右侧；
3. 展示并测试 Quick Capture 和显示/隐藏快捷键；
4. 可选“从 Mac `.stickies` 导入”；
5. 说明关闭到托盘、托盘菜单真正退出；
6. 说明“正文加密；标题和部分元数据明文；兼容导出为明文”；
7. 询问是否开机启动，默认不勾选。

**验收：** 跳过引导后应用仍可用；引导可从 Help 再次打开；不阻止用户退出。

### 8.2 系统托盘与进程

#### FR-TRAY-001 托盘图标（P0）

- 启动后注册稳定 GUID 的托盘图标；
- 左键单击：显示/隐藏 Deck；
- 右键菜单：`新建便签`、`Quick Capture`、`显示/隐藏 Deck`、`All Notes`、`Archive`、`开机启动`、`设置`、`退出 Noty`；
- Explorer/任务栏重启后自动恢复图标；
- 托盘图标被系统收进溢出区时，全局快捷键仍有效。

#### FR-PROC-001 单实例（P0）

- 系统同一用户会话中只允许一个 Noty 实例和一个数据库写入者；
- 第二次启动把激活参数转交既有实例；
- 普通启动显示 Deck；协议/文件激活执行对应动作；
- 不产生第二个托盘图标。

### 8.3 全局快捷键

#### FR-HOTKEY-001 默认快捷键（P0）

建议默认值，须在技术原型和本地化键盘上验证：

| 动作 | 默认键 |
|---|---|
| 显示/隐藏 Deck | `Ctrl+Alt+Space` |
| 新建并打开 | `Ctrl+Alt+N` |
| Quick Capture | `Ctrl+Alt+Shift+Space` |
| All Notes | `Ctrl+Alt+A` |
| Archive | `Ctrl+Alt+L` |

- 使用系统级热键 API，不要求管理员权限和低级键盘钩子；
- 设置时即时检查冲突；失败则保留旧组合并显示占用错误；
- 禁止仅使用单个字母、数字或系统保留组合；
- 用户可清除非关键快捷键；显示/隐藏至少保留托盘兜底。

### 8.4 Edge Deck

#### FR-DECK-001 状态机（P0）

```text
Hidden
  ├─ 托盘/快捷键 → Rest 或 Fan
  └─ Quick Capture → Capture
Rest
  ├─ 指针进入热区 → Fan
  └─ 显式隐藏 → Hidden
Fan
  ├─ Hover → Preview
  ├─ Click Tab → Expanded(noteId)
  ├─ 超时/离开 → Rest
  └─ 显式隐藏 → Hidden
Expanded
  ├─ Esc/Close → Fan
  ├─ 外部点击/超时 → Rest（Pinned 例外）
  └─ 显式隐藏/退出 → flush → Hidden/Exit
```

#### FR-DECK-002 Rest（P0）

- 默认位于用户选择的左/右屏幕边缘与 50% 垂直位置；
- 显示窄 Pill 和活动便签颜色短条；
- 不抢焦点、不进入 Alt+Tab、不占任务栏；
- 热区宽度可调，默认候选值 14–18 DIP；
- 支持关闭热区，关闭后 Pill 可保持可见或完全隐藏，由设置决定。

#### FR-DECK-003 Fan（P0）

- 默认显示前 5 条活动便签；更多条目显示 `+N`，进入可滚动列表；
- 支持 Labelled Tabs 与 Colour Chips 两种样式；
- 显示新增按钮和设置入口；
- 指针离开后约 150ms 防抖，再在空闲约 4 秒后收起；参数可在可用性测试后调整；
- 鼠标按下、系统拖拽、全屏游戏/独占场景中不触发热区展开；
- 遵守系统“减少动画”，关闭逐项扇出与缩放动画。

#### FR-DECK-004 Preview（P0）

- 默认悬停约 180–250ms 显示预览；
- Preview 不激活应用、不抢键盘焦点；
- 显示标题、任务进度和正文片段；
- 不渲染可执行内容，不自动打开链接；
- 开启“悬停直接打开”后关闭 Preview，二者互斥。

#### FR-DECK-005 Expanded（P0）

- 点击 Tab 后横向展开便签；
- 编辑区可靠获得焦点；
- 顶部：保存状态、固定、任务、查找、文字方向；
- 底部：8 色、归档、删除、关闭；
- 外部点击或 60 秒空闲自动收起；固定便签不因外部点击/空闲收起，但 `Esc`、关闭、归档和删除仍有效；
- 关闭前强制保存；失败时保留可恢复草稿并显示明确错误。

#### FR-DECK-006 位置与多屏（P0）

- 单一 Deck 根据“鼠标屏 → 活动窗口屏 → 主屏”移动；
- 每块显示器保存边缘、垂直比例和最近位置；
- 不覆盖任务栏工作区；任务栏四边和自动隐藏均需处理；
- 显示器拔除后夹回可见工作区；再次接入可恢复该显示器位置；
- 声明 Per-Monitor V2 DPI aware；跨 100/125/150/200% 显示器时尺寸、字体和命中区一致。

### 8.5 Quick Capture

#### FR-CAP-001 快速捕获（P0）

- 从全局快捷键、托盘或 `noty://capture` 打开；
- 出现在鼠标所在显示器中央稍上方；
- 打开时可输入，但不把原应用最小化或重排；
- `Enter` 保存；`Shift+Enter` 换行；`Esc` 或失焦取消；重复快捷键关闭；
- 空白内容不创建便签；
- 保存后恢复原前台应用；
- 保存失败时不得关闭输入框，必须保留文本并提供“重试/复制内容”；
- 对连续触发设置约 350ms 防抖。

### 8.6 编辑器、任务和 Markdown

#### FR-EDIT-001 纯文本核心（P0）

- 正文逻辑存储为 UTF-8 文本；富文本粘贴转换为纯文本；
- 支持 Windows 标准快捷键：`Ctrl+C/X/V/Z/Y/A/F`；
- 支持 emoji、组合字符、代理对，不允许按字符删除造成损坏；
- 支持中文、日文 IME 组合输入，不在 marked/composition text 阶段错误同步样式；
- 每条便签可设 Automatic / LTR / RTL；
- 标题沿用“正文首个非空行派生”，导入显式标题时保留导入标题。

#### FR-EDIT-002 自动保存（P0）

- 输入停止 250–500ms 后保存；MVP 默认 250ms；
- 视图关闭、应用退出、系统注销、更新前立即 flush；
- UI 显示 `Saving…` / `Saved` / `Save failed`；正常保存不发系统通知；
- 单次写入采用事务；保存失败不覆盖上一个有效版本。

#### FR-TASK-001 内联任务（P0）

- 行首 `☐` / `☑` 为内部文本语义；
- 点击 checkbox 或快捷键切换；
- 完成项淡化并删除线；
- 非空任务回车续建未完成任务；空任务回车退出任务列表；
- Markdown 导出转换为 `- [ ]` / `- [x]`，导入执行逆转换。

#### FR-MD-001 Markdown（P0/P1）

P0：

- 无损存储用户原文；
- 支持标题、粗体、斜体、行内代码、删除线、引用、列表、链接的基础实时样式；
- 只允许 `http`、`https`、`mailto` 成为可点击链接；
- 普通点击定位光标，`Ctrl+Click` 打开链接；
- 样式异常不得修改正文或破坏 Undo 栈。

P1：

- 非当前行隐藏 Markdown marker；当前行 marker 淡化；
- 增量行级重绘与大文本性能优化。

若 IME/Undo 原型未通过，marker 隐藏必须延期，不得为了视觉一致牺牲输入可靠性。

### 8.7 便签管理

#### FR-NOTE-001 新建（P0）

- 新便签进入活动列表顶部；
- 默认颜色按产品设定轮换或使用上次颜色；
- 空便签在用户明确创建后允许存在；Quick Capture 空白则不创建。

#### FR-NOTE-002 排序与颜色（P0）

- 支持 8 色：Lemon、Peach、Rose、Lilac、Sky、Mint、Sand、Slate；
- Tab 拖动超过约 5 DIP 才进入排序，降低误触；
- 排序结果立即写入并跨重启恢复；
- 颜色不是唯一状态提示，固定/归档等须有图标或文本，满足色觉可达性。

#### FR-NOTE-003 删除撤销（P0）

- 删除后显示 10 秒撤销提示；
- 倒计时内支持 Undo；
- 应用异常退出时不得出现“UI 已删除、数据库状态未知”；
- MVP 不提供长期回收站，归档承担长期保留路径。

#### FR-NOTE-004 归档与恢复（P0）

- 归档后从 Deck 移除，进入 Library → Archive；
- 可恢复到活动列表；
- 恢复时保留正文、颜色、时间、方向和可迁移元数据。

### 8.8 Library 与搜索

#### FR-LIB-001 Library（P0）

- 提供 All Notes / Archive 分区；
- 左侧列表显示标题、修改时间、颜色和任务进度；
- 右侧提供编辑详情；
- 支持键盘导航、归档、恢复、删除；
- Library 是正常应用窗口，进入 Alt+Tab 并显示任务栏按钮。

#### FR-SEARCH-001 搜索（P0）

- 在当前 All Notes 或 Archive 分区，对标题与已解密正文做不区分大小写的子串匹配；
- 空查询显示当前分区全部；
- 典型数据集结果更新 p95 ≤ 100ms；
- MVP 不持久化明文正文索引；
- P1 可增加跨分区搜索，但需保持筛选状态清晰。

### 8.9 导入、导出与迁移

#### FR-MIG-001 Mac → Windows 官方迁移（P0）

官方路径：

```text
Mac Noty 导出 .stickies
→ Windows 选择文件
→ 解析与校验
→ 显示导入摘要及兼容性警告
→ 用户确认
→ 事务导入
→ 输出成功/跳过/失败报告
```

- 明确不支持直接复制 `notes.db`、`notes.db-wal`、`notes.db-shm`、`note.key`；
- 不修改原始导入文件；
- 未知高版本、损坏 JSON、关键字段缺失必须安全拒绝；
- 部分失败时已成功项可提交，但报告必须逐项列出失败原因；
- 重复 ID 默认“跳过并报告”，不覆盖本地条目；后续可提供“生成新 ID 作为副本”；
- 颜色越界回退 Lemon 并警告；
- 时间统一解析 ISO-8601，内部存 UTC，显示使用本地时区；
- v2 不含 `pinned`，导入摘要必须提示固定状态无法迁移。

#### FR-MIG-002 格式策略（P0）

1. **Mac 兼容交换格式**：`.stickies v2`，明文 JSON；保证当前上游可理解字段，不承诺固定状态；
2. **Windows 完整备份格式**：建议新增 `.notybackup`，版本化、默认加密，包含 `pinned`、设置和 schema 信息；
3. 不建议直接修改上游 v2 语义。若要建立 `.stickies v3`，须先与上游协作并补 Mac/Windows 双向 golden fixture。

#### FR-EXP-001 导出（P0）

- 支持逐条 Markdown、逐条 TXT、合并 Markdown、`.stickies v2`；
- 文件名清洗 Windows 非法字符，处理保留名（如 `CON`、`PRN`）和重名；
- 明文导出前展示“任何能访问此文件的人都可读取内容”；
- 原子写入，失败不留下伪完整文件；
- 导出日志不得包含正文。

### 8.10 设置

#### FR-SET-001 设置结构（P0）

- **General**：语言、开机启动、关闭行为、首次引导；
- **Shortcuts**：录制、冲突检测、恢复默认；
- **Deck**：样式、大小、左/右边、热区、位置、Preview、Hover-to-open、保持展开、全屏行为；
- **Notes**：字体、字号、便签尺寸、Markdown、文字方向默认值；
- **Data & Privacy**：数据位置、导入导出、备份、加密边界、诊断包；
- **Updates**：当前版本、自动检查、立即检查、更新状态。

设置即时生效；影响热键、显示器或窗口的改动失败时回滚并显示原因。

### 8.11 URL Scheme 自动化

#### FR-URL-001 `noty://`（P1，若首发延期须列入差异说明）

- `noty://new?text=...`
- `noty://capture`
- `noty://all`
- `noty://settings`

安全要求：仅将 `text` 作为内容，不执行命令；限制 URL 长度；非法编码安全拒绝；仅允许白名单 action；不得自动打开正文中的任意 scheme。

---

## 9. 数据与隐私需求

### 9.1 数据模型

```text
Note
- id: UUID string
- title: string (derived or imported)
- body: encrypted blob
- color: int [0..7]
- createdUtc: timestamp
- modifiedUtc: timestamp
- archived: bool
- sortOrder: double
- pinned: bool
- textDirection: automatic | ltr | rtl
```

无 Folder、Tag、Attachment、Account、Workspace 实体。

### 9.2 存储

- 数据库存放于每用户本地应用数据目录；打包应用使用应用私有 LocalFolder；
- SQLite 开启 WAL，保持单写者；
- 从首版使用 `PRAGMA user_version` 或等价机制进行版本化、事务化迁移；
- 数据库、备份、设置、日志分离；
- 日志禁止包含正文、标题、搜索词、剪贴板内容和完整本地路径。

### 9.3 加密边界

- 每次安装/用户生成随机 256-bit 数据密钥；
- 正文使用经过审计的 AEAD（AES-GCM）加密；
- 数据密钥由 Windows 用户级 DPAPI 或等价系统能力包裹；
- 标题、颜色、时间、状态、顺序等为明文元数据，以延续上游行为；
- 另一 Windows 用户或另一台机器不能仅凭内部数据库恢复正文；跨机恢复必须使用导出/备份；
- 不在 MVP 建立持久化明文正文 FTS 索引；
- `.stickies`、MD、TXT 为明文，导出时明确告知。

### 9.4 备份与恢复

- 每日首次成功写入后最多创建一次滚动备份；
- 版本更新/schema migration 前强制创建备份；
- 建议保留最近 7 份或 30 天，以先到者为准；达到配额后先删除最旧备份；
- 备份正文保持加密；内部备份仅同机同用户可恢复；
- 数据库校验失败时不覆盖最后有效备份，提示用户“自动恢复/选择备份/导出诊断”；
- 磁盘满时暂停非必要备份，保留当前草稿并提示释放空间；
- 不支持应用版本降级打开更高 schema，防止反向破坏数据。

### 9.5 网络与遥测

MVP 允许的自有网络行为仅为：

- 用户可关闭的更新检查；
- 用户主动打开的网页（发布说明、帮助）；
- 用户主动提交的诊断/反馈。

不得发送笔记正文、标题、搜索词、剪贴板或文件内容。若未来新增遥测，须单独更新隐私文档和 PRD，不得静默改变 local-first 承诺。

---

## 10. 非功能需求

### 10.1 性能（P0）

参考测试机须在 Gate 2 固定。每项至少测量 30 次：

| 项目 | 目标 |
|---|---:|
| 冷启动至托盘可用 | p95 ≤ 1.5s |
| 已驻留时快捷键至可输入 | p95 ≤ 150ms |
| 搜索结果刷新（典型数据集） | p95 ≤ 100ms |
| 自动保存 | 停止输入 250–500ms 内开始提交 |
| 空闲 CPU | p95 < 1%（无动画/更新） |
| 空闲工作集 | 原型后冻结，建议目标 ≤ 150MB |
| 动画 | 60Hz 屏幕无持续明显掉帧 |

典型数据集建议：500 条便签、平均正文 2KB；压力数据集：10,000 条、平均正文 10KB。最终上限由原型决定。

### 10.2 可靠性（P0）

- 输入停止 500ms 后强杀进程，重启后已保存内容完整；
- 自动化执行创建、修改、排序、归档、重启 100 轮，无重复 ID、丢失或顺序漂移；
- 单实例压力测试始终只有一个写入者；
- 更新/schema migration 失败后可回到升级前备份；
- Explorer 重启、休眠唤醒、远程桌面切换后托盘和窗口状态可恢复。

### 10.3 兼容性（P0）

- Windows 10 22H2 x64；
- Windows 11 当前受支持版本 x64；
- 标准用户账户，不要求管理员权限；
- 单屏/双屏、主副屏互换、热插拔；
- 100/125/150/200% 混合 DPI；
- 任务栏四边与自动隐藏；
- 中英文、日文 IME；Arabic/Hebrew 基础 RTL；
- 深色/浅色、高对比度、减少动画。

### 10.4 可访问性（P0）

- 所有核心动作可仅用键盘完成；
- Deck、Library、Settings 控件提供可访问名称、角色和状态；
- 焦点顺序可预测，焦点可见；
- 不以颜色作为唯一状态表达；
- 支持系统文本缩放、高对比度与减少动画；
- Screen Reader 能读取标题、任务状态、按钮名称和搜索结果；
- 当 Deck 不进入 Alt+Tab 时，托盘和全局快捷键仍提供可达入口。

### 10.5 安全（P0）

- 正式包和更新包使用受信任发布者签名，不使用自签正式包；
- 更新只接受同一 Publisher 且版本递增的有效签名包；
- URL scheme 输入按不可信数据处理；
- 不加载远程正文或远程脚本；
- 依赖固定版本并生成第三方许可清单；P1 生成 SBOM；
- 锁屏、切换用户、远程桌面断开时隐藏 Expanded 与 Preview（默认开启）。

---

## 11. 安装、更新与卸载

### 11.1 分发策略

MVP 推荐：

- x64 签名 MSIX；
- GitHub Release/HTTPS 托管 `.appinstaller`；
- 标准用户安装，不要求管理员权限；
- 首版即固定包名、Publisher Identity、协议名和签名主体。

P1：Microsoft Store 与 ARM64。若技术原型证明 MSIX 严重限制托盘/启动/更新，再评估签名 MSI/EXE + 单一 updater；MVP 不同时维护两套更新链路。

### 11.2 更新行为

- 默认每日检查，可关闭；
- 检查请求不携带笔记或设备内容；
- 不在用户输入时强制退出；
- 安装前 flush 并创建备份；
- schema migration 失败则恢复备份并保持旧版可运行；
- 至少测试从前两个正式版本升级到当前版本；
- 禁止不受支持的版本降级直接打开数据库。

### 11.3 卸载

卸载前或产品帮助中明确说明数据处理。MVP 建议：

- 默认保留可恢复数据需要技术验证，因为 MSIX 卸载可能清理应用私有目录；
- 若平台无法可靠保留，必须在卸载说明中提示先导出；
- 设置中提供“导出备份”和“删除所有本地数据”；
- 删除动作要求二次确认，并清理数据库、密钥、备份、日志和启动项。

---

## 12. 核心验收场景

### AC-01 首次使用

1. 标准用户安装并启动；
2. 完成或跳过引导；
3. 托盘图标可用；
4. 用户用快捷键创建便签；
5. 编辑后收起并重启；
6. 内容、颜色、顺序恢复；
7. 开机启动未获用户同意时保持关闭。

### AC-02 Quick Capture

1. 在其他应用输入中触发快捷键；
2. Capture 出现在鼠标所在屏；
3. 中文 IME 输入、`Shift+Enter` 换行；
4. `Enter` 保存；
5. 原应用恢复焦点；
6. 新便签出现在 Deck 顶部；
7. 模拟磁盘满时 Capture 不消失，文本可复制。

### AC-03 Deck 交互

1. 指针进入热区，Rest 展开为 Fan；
2. 悬停 Preview 不改变前台应用；
3. 点击便签后编辑器获得焦点；
4. 外部点击收起未固定便签；
5. 固定便签保持展开；
6. `Esc` 仍能关闭固定便签；
7. 禁用热区后托盘和快捷键仍完成全部核心任务。

### AC-04 Mac 数据迁移

使用锁定 Mac 版本导出的 golden fixtures，覆盖：

- 中文、日文、emoji、组合字符；
- Arabic/Hebrew RTL；
- 8 种颜色、活动/归档、顺序、时间、方向；
- 空正文、超长正文、多行任务；
- 重复 ID、未知版本、损坏 JSON、颜色越界；
- v2 固定状态缺失提示。

通过条件：已支持字段无损；不支持字段提前提示；未知高版本安全拒绝；原文件不变；部分失败有逐项报告。

### AC-05 多屏/DPI

在 100% 主屏 + 150/200% 副屏测试召出、跨屏、拔插、主副屏互换、任务栏自动隐藏：

- Deck 始终在工作区内；
- 文字清晰，命中区与视觉一致；
- 拔除目标屏后夹回可见屏；
- 再接入后恢复合理位置；
- 不产生多个 Deck 或托盘图标。

### AC-06 更新与恢复

1. 编辑中检测到更新，不强退；
2. 用户确认重启后 flush；
3. 创建升级前备份；
4. 正常迁移成功；
5. 人为制造 migration 失败，恢复旧数据；
6. 签名错误、Publisher 不同和版本倒退的包全部拒绝。

---

## 13. 技术实现建议（非产品硬约束）

### 13.1 推荐方向

鉴于核心难点是 HWND 焦点、非激活窗口、点击穿透、托盘、多屏 DPI 和编辑器，而非跨平台 UI，建议优先评估：

- **当前受支持的 .NET LTS + WPF**：成熟的 Windows 桌面窗口/文本/无障碍基础；
- **Win32 interop**：`RegisterHotKey`、`SetWindowPos`、`WM_NCHITTEST`、显示器/DPI、TaskbarCreated；
- **SQLite**：版本化事务 migration；
- **AES-GCM + DPAPI**：正文加密与密钥包裹；
- **MVVM**：单一 NoteStore、可测试的状态机和存储边界；
- **MSIX/App Installer**：签名安装和单一更新链路。

WinUI 3 可作为对照原型，但不能仅因“更新”而选择。框架最终选择必须以 Gate 2 的焦点、多屏和编辑器测试结果为依据。

### 13.2 模块建议

```text
Noty.Domain
  Note, NoteColor, Tasks, SearchSemantics, DeckState
Noty.Storage
  SQLite, SchemaMigration, AES-GCM, DPAPI, Backup
Noty.Transfer
  StickiesV2, Markdown, Text, ImportReport
Noty.Desktop
  Tray, Hotkeys, Activation, Startup, Update
Noty.UI
  Deck, Capture, Editor, Library, Settings, Onboarding
Noty.Tests
  GoldenFixtures, Storage, Migration, Editor, WindowMatrix
```

### 13.3 不建议做法

- 不建议直接复用/移植 Swift UI 层；
- 不建议用 WebView2 作为纯文本编辑器的默认方案，除非 IME、Undo、可访问性原型明显优于原生方案；
- 不建议用低级键盘钩子代替 `RegisterHotKey`；
- 不建议直接读取 macOS 数据库作为正式迁移路径；
- 不建议为了全文搜索落地明文 FTS；
- 不建议在 MVP 同时支持 MSIX、MSI、便携版和 Store 四套渠道。

---

## 14. 风险清单与 Gate

| 优先级 | 风险 | 缓解 / 发布 Gate |
|---|---|---|
| P0 | Preview 不抢焦点与 Expanded 可输入之间冲突 | 先做 HWND 原型，覆盖热区、点击、Capture、焦点恢复 |
| P0 | IME、RTL、Undo、Markdown 样式耦合 | 编辑器专项 spike；输入可靠性优先，marker 隐藏可延期 |
| P0 | `.stickies` 兼容误判 | 锁定 v1.4.0 fixture；确认 v2 不含 pinned；双向测试 |
| P0 | schema 更新失败导致不可启动 | 事务 migration、升级前备份、禁止降级写入 |
| P0 | 发布者身份或签名变更 | 首版前固定 Publisher、包名、证书和更新链路 |
| P1 | 热区与滚动条、贴靠、全屏冲突 | 延迟、拖拽抑制、左右切换、可禁用、误触测试 |
| P1 | 多屏混合 DPI 窗口越界/模糊 | Per-Monitor V2、逻辑坐标、完整显示矩阵 |
| P1 | DPAPI 导致换机无法解密 | 明确内部密文不可搬迁；提供兼容导出/加密备份 |
| P1 | 崩溃日志泄露内容 | 内容字段禁止日志化；用户主动生成脱敏诊断包 |
| P1 | MSIX 卸载清理用户数据 | 技术验证；必要时强提示导出和提供独立备份位置 |
| P2 | 缺少市场验证 | Windows #17 仅是信号；做 5–8 人原型测试与候补名单 |
| P2 | 名称、图标、资产权利 | MIT 不自动授予商标权；正式发布前确认名称和品牌授权 |

### 14.1 项目 Gate

**Gate 0 — 证据冻结**

- 锁定上游 commit；
- 生成真实 `.stickies v2` fixture；
- 明确 v2 不含 `pinned`；
- 保存 LICENSE 与第三方声明。

**Gate 1 — 范围冻结**

- 确认本 PRD 的单 Deck、入口优先级和 MVP 功能；
- 确认 Windows 10 22H2 与 x64；
- 确认无账号、无同步、无提醒。

**Gate 2 — 技术可行性**

- HWND 焦点/点击穿透/TopMost/Alt+Tab 原型通过；
- 多屏混合 DPI 原型通过；
- 中文/日文 IME、RTL、Undo 编辑器原型通过；
- 基准机性能达到或调整目标。

**Gate 3 — 数据与安全**

- `.stickies` golden tests；
- SQLite migration、DPAPI、备份恢复和磁盘满演练；
- 隐私文案与威胁模型评审。

**Gate 4 — 发布准备**

- Publisher、证书、MSIX、更新链路固定；
- 卸载数据行为验证；
- 从前两个版本升级测试方案就绪。

**Gate 5 — 发布验收**

- 功能、输入、多屏、可靠性、迁移、可访问性、签名更新全部通过；
- 已知差异公开；
- 支持与诊断流程可用。

---

## 15. 里程碑建议

不在 Gate 2 前承诺固定发布日期。建议按交付物而非日历推进：

1. **M0 调研与契约冻结**：Note 模型、`.stickies v2`、任务语义、隐私边界；
2. **M1 高风险原型**：Deck HWND、焦点、托盘、全局热键、多屏 DPI、编辑器 IME；
3. **M2 核心 Alpha**：存储/加密、Capture、新建编辑、自动保存、Deck 三态；
4. **M3 功能 Beta**：Library、搜索、归档、导入导出、设置、备份恢复；
5. **M4 Release Candidate**：引导、无障碍、签名 MSIX、更新、系统矩阵；
6. **M5 1.0 发布**：完成 Gate 5、公开隐私说明和迁移差异；
7. **M6 P1**：提醒、URL scheme 完整对齐、Markdown marker 隐藏、Store、ARM64。

---

## 16. 待产品负责人确认

以下问题不阻止形成 PRD，但必须在 Gate 1 前签字：

1. 是否接受 MVP 使用“单一 Deck 跟随召出屏幕”，而不是复刻 Mac 每屏一个 Deck？
2. 热区是否采用“引导中建议开启、用户确认”的策略？
3. 是否接受 Markdown 原文/基础样式首发，而 marker 隐藏视编辑器风险延期？
4. 是否将 `noty://` 放入 MVP，还是明确列为 1.1？
5. 是否坚持 Windows 10 22H2 支持；若不支持，可显著缩小测试矩阵；
6. 是否采用默认零遥测；若需要量化漏斗，允许收集哪些纯事件数据？
7. `.stickies v2` 缺失 `pinned` 是否接受明确提示，还是先推动上游定义 v3？
8. 正式发布能否使用 Noty 名称、图标和现有视觉资产；是否已获得商标/品牌许可确认？
9. 免费、付费、开源分发及后续商业化策略是什么？

---

## 17. 参考资料

### 17.1 上游一手资料

- [Noty repository](https://github.com/aimen08/noty)
- [README @ locked commit](https://github.com/aimen08/noty/blob/200e9cb55065ce52c12d04031aa022e978934bdb/README.md)
- [Core model and encryption](https://github.com/aimen08/noty/blob/200e9cb55065ce52c12d04031aa022e978934bdb/Sources/Core.swift)
- [SQLite store](https://github.com/aimen08/noty/blob/200e9cb55065ce52c12d04031aa022e978934bdb/Sources/Store.swift)
- [Deck controller](https://github.com/aimen08/noty/blob/200e9cb55065ce52c12d04031aa022e978934bdb/Sources/DeckController.swift)
- [Deck panel](https://github.com/aimen08/noty/blob/200e9cb55065ce52c12d04031aa022e978934bdb/Sources/DeckPanel.swift)
- [Editor](https://github.com/aimen08/noty/blob/200e9cb55065ce52c12d04031aa022e978934bdb/Sources/NoteEditor.swift)
- [Markdown style engine](https://github.com/aimen08/noty/blob/200e9cb55065ce52c12d04031aa022e978934bdb/Sources/EditorStyleEngine.swift)
- [Import/export schema](https://github.com/aimen08/noty/blob/200e9cb55065ce52c12d04031aa022e978934bdb/Sources/ExportImport.swift)
- [MIT License](https://github.com/aimen08/noty/blob/200e9cb55065ce52c12d04031aa022e978934bdb/LICENSE)
- [Windows request #17](https://github.com/aimen08/noty/issues/17)

### 17.2 Windows 官方资料

- [Notifications and the Notification Area](https://learn.microsoft.com/en-us/windows/win32/shell/notification-area)
- [Shell_NotifyIcon](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shell_notifyiconw)
- [RegisterHotKey](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registerhotkey)
- [App activation](https://learn.microsoft.com/en-us/windows/apps/develop/launch/activate-an-app)
- [High DPI desktop development](https://learn.microsoft.com/en-us/windows/win32/hidpi/high-dpi-desktop-application-development-on-windows)
- [Choose a packaging model](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/choose-packaging-model)
- [App Installer auto-update and repair](https://learn.microsoft.com/en-us/windows/msix/app-installer/auto-update-and-repair--overview)
- [Code signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)
- [CryptProtectData / DPAPI](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata)

---

## 18. 最终立项建议

**建议立项，但采用“原生重建 + 契约兼容”，不要采用“Swift 代码直接移植”。**

首个开发动作不应是搭完整 UI，而应并行完成两个 P0 spike：

1. Windows HWND Deck：不抢焦点预览、点击进入编辑、焦点恢复、Alt+Tab 隐藏、多屏 DPI；
2. 编辑器：中文/日文 IME、RTL、Undo、任务 checkbox 和 Markdown 样式共存。

同时锁定 `.stickies v2` golden fixtures，并接受“当前格式不迁移 pinned”的事实。只有上述原型通过后，才应冻结框架、工期和正式发布日期。
