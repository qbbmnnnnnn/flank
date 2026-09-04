# Flank Desktop 技术架构方案

> 状态：Architecture Decision v1.0  
> 对应 PRD：`docs/Flank-Desktop-PRD-Final.md`  
> 技术栈：Tauri 2 + Vue 3 + TypeScript + Rust + SQLite  
> 未来服务端：API Service + PostgreSQL

---

## 1. 架构结论

采用 **Tauri 2 作为跨平台桌面容器，Vue 3 + TypeScript 构建 Web UI，Rust 承担本地核心和系统能力，SQLite 保存本地数据**。

未来账号和云同步通过独立服务接入，服务端使用 PostgreSQL。SQLite 与 PostgreSQL 不追求 DDL 或数据库文件兼容，二者通过稳定的领域模型、版本化 DTO 和同步协议互通。

关键原则：

1. Vue 不直接访问数据库；
2. Rust 是业务写入、加密和数据一致性的唯一入口；
3. UI 状态、领域状态和持久化状态分层；
4. 从首版使用全局唯一 ID、revision、tombstone 和稳定排序键；
5. MVP 不实现同步，但 Repository、Outbox 和协议边界可扩展；
6. 通用框架无法满足窗口行为时，使用 Rust 平台模块调用 Win32 / AppKit，而不是牺牲产品体验。

---

## 2. 总体架构

```text
┌──────────────────────────────────────────────┐
│ Vue 3 + TypeScript                           │
│ Components / Views / Composables / UI Store │
└───────────────────┬──────────────────────────┘
                    │ typed Tauri commands/events
┌───────────────────▼──────────────────────────┐
│ Rust Application Layer                       │
│ Use Cases / Validation / DTO / Error Mapping │
└───────────────┬───────────────────┬──────────┘
                │                   │
┌───────────────▼──────────┐ ┌──────▼───────────────┐
│ Domain                   │ │ Platform             │
│ Note / Task / Sync Model │ │ Window / Tray / Keys │
│ Repository Traits        │ │ Startup / Secure Key │
└───────────────┬──────────┘ └──────┬───────────────┘
                │                   │
┌───────────────▼───────────────────▼──────────┐
│ Infrastructure                              │
│ SQLite / Crypto / Backup / Import / Export │
│ Future Outbox + HTTP Sync Adapter           │
└──────────────────────────────────────────────┘

Future Cloud:
Client Sync Adapter → Auth/Sync API → PostgreSQL
```

---

## 3. 前端方案

### 3.1 基础技术

- Vue 3 Composition API；
- TypeScript strict mode；
- Vite；
- Vue Router：仅用于 Library、Settings、Onboarding 等页面；
- Pinia：仅保存 UI / session 状态和缓存，不作为数据真相来源；
- GSAP：Dock 指针感应、开合和吸附反馈；
- CSS Custom Properties：主题、颜色和尺寸 token。

### 3.2 推荐目录

```text
src/
├─ app/
│  ├─ router/
│  ├─ stores/
│  └─ bootstrap/
├─ features/
│  ├─ dock/
│  ├─ editor/
│  ├─ capture/
│  ├─ library/
│  ├─ settings/
│  └─ transfer/
├─ components/
├─ composables/
├─ contracts/       # 由 Rust contract 或 schema 生成/校验的 TS 类型
├─ services/        # Tauri command client
├─ styles/
└─ test/
```

按业务功能组织组件，避免建立庞大的全局 `components` 和 `utils` 目录。

### 3.3 状态边界

**前端可持有：**

- 当前 Dock 状态；
- 当前选中便签 ID；
- 表单草稿；
- 短期查询缓存；
- 动画和焦点状态；
- 保存中的请求状态。

**前端不得作为真相来源：**

- 最终便签版本；
- 删除和归档事务状态；
- 加密密钥；
- schema 版本；
- 备份状态；
- 同步 cursor 和 Outbox 提交结果。

### 3.4 Tauri 调用规范

不要在组件内散落 `invoke()`。统一封装为 typed service：

```text
noteService.list(query)
noteService.get(id)
noteService.create(input)
noteService.update(command)
noteService.archive(id, expectedRevision)
noteService.delete(id, expectedRevision)
noteService.undoDelete(operationId)
```

所有 mutation 携带 `expectedRevision`，Rust 检测陈旧写入。错误返回稳定 code，不让 UI 解析 Rust 错误字符串。

建议错误结构：

```ts
interface AppError {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}
```

### 3.5 GSAP 使用约束

现有原型可继续使用 GSAP，但正式 Vue 组件必须：

- 在 `onMounted` 后创建动画；
- 使用组件根节点限定 `gsap.context()`；
- 在 `onUnmounted` 中执行 `context.revert()`；
- 指针高频更新继续使用 `gsap.quickTo()`；
- 优先动画 `x`、`y`、`scale`、`rotation` 和 `autoAlpha`；
- 避免高频动画 `top`、`left`、`width`、`height`；
- 只为实际动画元素设置 `will-change`；
- 使用 `gsap.matchMedia()` 响应 `prefers-reduced-motion`；
- Dock 不可见或窗口失焦时停止不必要动画。

---

## 4. Rust 本地核心

### 4.1 职责

Rust 负责：

- Tauri commands 与 events；
- 领域校验和业务用例；
- SQLite transaction 与 migration；
- 正文加密、密钥读取和缓存生命周期；
- 导入、导出和备份；
- 窗口、托盘、快捷键、开机启动；
- 平台原生 interop；
- 未来 Outbox 与同步客户端。

### 4.2 推荐 crate 模块

```text
src-tauri/src/
├─ main.rs
├─ app.rs
├─ commands/
├─ application/
│  ├─ notes.rs
│  ├─ search.rs
│  ├─ transfer.rs
│  └─ backup.rs
├─ domain/
│  ├─ note.rs
│  ├─ task.rs
│  ├─ repository.rs
│  └─ errors.rs
├─ infrastructure/
│  ├─ sqlite/
│  ├─ crypto/
│  ├─ backup/
│  └─ transfer/
├─ platform/
│  ├─ windows/
│  ├─ macos/
│  └─ common/
└─ sync/             # MVP 可仅保留 trait 与协议模型
```

### 4.3 数据访问：SQLx

确定使用 **SQLx + SQLite**，由 Rust Repository 统一访问；禁止 WebView 通过 SQL 插件直接查询。

实现约束：

- 使用 SQLx 内嵌 migration 管理 schema；
- 所有业务 mutation 使用显式 transaction；
- 启用 SQLite WAL、foreign keys 和合理的 busy timeout；
- 查询尽量使用 SQLx 编译期检查能力；动态搜索条件集中在 Repository 内；
- 密文、nonce 使用 BLOB，不在 SQL 层进行加解密；
- command handler 不直接编写 SQL，只调用 application service / repository；
- 集成测试使用独立临时数据库并完整执行 migration；
- 生产环境仅保留 SQLx 一套 DAL，不同时引入 rusqlite。

选择 SQLx 的原因是异步接口、事务模型、migration 和未来服务端 PostgreSQL 生态更统一；但客户端与服务端仍使用各自 Repository 和 SQL，禁止因为都使用 SQLx 而共享 DDL。

---

## 5. 本地数据库设计

### 5.1 表设计建议

```sql
CREATE TABLE notes (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  title_source     TEXT NOT NULL,
  body_ciphertext  BLOB NOT NULL,
  body_nonce       BLOB NOT NULL,
  body_key_id      TEXT NOT NULL,
  color            TEXT NOT NULL,
  created_at_ms    INTEGER NOT NULL,
  updated_at_ms    INTEGER NOT NULL,
  archived_at_ms   INTEGER,
  deleted_at_ms    INTEGER,
  sort_key         TEXT NOT NULL,
  text_direction   TEXT NOT NULL,
  revision         INTEGER NOT NULL,
  CHECK (revision >= 1)
);

CREATE INDEX idx_notes_active_sort
  ON notes(deleted_at_ms, archived_at_ms, sort_key);

CREATE INDEX idx_notes_updated
  ON notes(updated_at_ms, id);
```

附加表：

```text
app_meta              schema / installation metadata
settings              非敏感设置
undo_operations       有时限的撤销事务
backup_history        自动备份记录
import_jobs           导入摘要，不保存正文日志
sync_state             future: account, cursor, device id
sync_outbox            future: 待上传变更
```

### 5.2 为什么不直接复制 PostgreSQL DDL

SQLite 与 PostgreSQL 在以下方面不同：

- 布尔、时间、UUID 和 JSON 类型；
- 并发和锁；
- 自增机制；
- 索引与全文搜索；
- migration 和约束行为。

因此互通层应是 API contract，而不是共享 SQL。客户端表可以包含 UI、本地缓存和 Outbox 字段；服务端表可以包含 `user_id`、服务端 revision、cursor 和审计字段。

### 5.3 字段映射

| 语义 | SQLite | API | PostgreSQL |
|---|---|---|---|
| Note ID | TEXT | UUID string | UUID |
| 时间 | INTEGER 毫秒 | RFC 3339 或毫秒 | TIMESTAMPTZ |
| revision | INTEGER | unsigned integer | BIGINT |
| 正文密文 | BLOB | base64 | BYTEA |
| 枚举 | TEXT | stable string | TEXT / enum domain |
| 删除 | nullable INTEGER | nullable timestamp | nullable TIMESTAMPTZ |
| 排序 | TEXT sort key | string | TEXT |

API 只选择一种时间编码并固定；不要在同一协议中混用 RFC 3339 和毫秒。

---

## 6. 为云同步预留的数据模型

### 6.1 ID

- Note ID 使用客户端生成的 UUIDv7；
- User、Device、Operation 同样使用全局唯一 ID；
- 不使用 SQLite rowid 或 PostgreSQL sequence 作为外部 ID；
- ID 在离线创建时即可确定，上传后不重新映射。

### 6.2 Revision

- 每条便签本地业务修改使 `revision + 1`；
- mutation 携带 `expectedRevision`，防止窗口间陈旧覆盖；
- 服务端可维护独立 `server_revision` 或全局 change sequence；
- 客户端 revision 不等于服务端同步 cursor。

### 6.3 删除墓碑

未来同步不能立即物理删除，否则其他设备无法得知删除：

1. 本地设置 `deletedAt`；
2. 写入 Outbox；
3. 上传 tombstone；
4. 服务端确认并传播；
5. 超过保留期且所有条件满足后再清理。

MVP 无账号时，可在 10 秒撤销窗口后物理清理，但 Repository API 仍使用 soft-delete 语义。

### 6.4 稳定排序

不要使用浮点 `sortOrder` 作为跨设备排序依据。使用可比较的字符串 sort key：

- 在相邻项之间生成新 key；
- 多设备同时排序时以 `sortKey + updatedAt + id` 确定性兜底；
- 必要时由服务端执行 rebalance；
- P1 实现手动排序前完成算法和并发测试。

### 6.5 Outbox

未来本地变更与 Outbox 必须在同一 SQLite transaction 内提交：

```text
BEGIN
  update notes
  insert sync_outbox(operation_id, entity_id, kind, payload, created_at)
COMMIT
```

服务端以 `operation_id` 实现幂等，网络重试不得创建重复记录。

### 6.6 增量拉取

建议同步协议：

```text
POST /v1/sync/push
  operations[]

GET /v1/sync/pull?cursor=...
  changes[]
  nextCursor
  hasMore
```

cursor 是服务端不透明字符串。客户端不得解析其内部结构，也不得使用本地时间作为唯一增量边界。

---

## 7. 冲突策略

MVP 不实现云同步，但必须先确定不丢数据原则。

建议未来规则：

| 字段 | 默认冲突策略 |
|---|---|
| title | 较新字段版本；无法判断时保留冲突副本 |
| body | 不自动合并未知并发文本；保留双方版本并提示 |
| color | Last Writer Wins |
| archivedAt | 较新明确操作 |
| deletedAt | 删除优先，但允许在保留期内恢复为新 revision |
| sortKey | 确定性排序并允许后续 rebalance |
| textDirection | Last Writer Wins |

不能只依赖设备时钟做 Last Writer Wins。服务端接收顺序、版本向量或字段版本至少选择一种可靠机制。第一版同步可采用“服务端版本 + 冲突副本”，比复杂 CRDT 更容易验证。

---

## 8. 未来 PostgreSQL 服务

### 8.1 服务边界

```text
Auth Service / Module
- account
- session
- device
- token rotation

Sync Service / Module
- push operations
- pull changes
- conflict detection
- cursor issuance
- tombstone retention

PostgreSQL
- users
- devices
- notes
- note_changes / operation_log
- sync_cursors（如需要）
```

账号服务和同步服务可以首期部署为模块化单体，不需要提前拆成微服务。

### 8.2 PostgreSQL 核心字段建议

```text
notes
- id UUID PK
- user_id UUID NOT NULL
- title_ciphertext BYTEA
- title_nonce BYTEA
- body_ciphertext BYTEA
- body_nonce BYTEA
- key_id TEXT
- color TEXT
- created_at TIMESTAMPTZ
- updated_at TIMESTAMPTZ
- archived_at TIMESTAMPTZ NULL
- deleted_at TIMESTAMPTZ NULL
- sort_key TEXT
- text_direction TEXT
- client_revision BIGINT
- server_revision BIGINT
- source_device_id UUID
```

云端采用端到端加密：`title` 与 `body` 均保存密文；服务端不开发正文或标题全文搜索。客户端在本地解密后搜索。

### 8.3 多租户约束

- 所有用户数据查询必须带 `user_id` 范围；
- 唯一约束和索引按 `(user_id, ...)` 设计；
- API 不接受客户端传入的任意 owner 作为授权依据；
- operation 必须绑定认证用户和注册设备；
- 日志同样禁止保存明文正文和密钥。

---

## 9. 加密演进

### 9.1 MVP 本地加密

- 每次安装生成数据密钥；
- 正文使用 AEAD；
- macOS 通过 Keychain 保护密钥；
- Windows 通过 DPAPI 保护密钥；
- SQLite 只保存密文、nonce 和 key ID；
- Rust 解密后仅向需要显示的窗口返回正文。

### 9.2 云同步加密决策：端到端加密

确定未来同步采用 E2EE：

- 云端保存标题和正文密文，不持有可直接解密内容的密钥；
- 已授权客户端负责加解密和本地搜索；
- 账号认证密钥与内容加密主密钥分离，修改登录密码不重新加密全部便签；
- 每个账号使用随机内容主密钥，再为已授权设备安全封装；
- 新设备通过已登录设备批准或恢复密钥加入；
- 设备撤销后不得获得新的密钥材料与变更，但历史上已下载的数据无法远程抹除；
- 协议保留 `ciphertext`、`nonce`、`keyId`、`cryptoVersion`，支持轮换和算法升级；
- 恢复密钥只向用户展示，服务端只保存不可用于直接解密内容的材料；
- 丢失所有设备和恢复密钥时，产品必须明确告知内容不可恢复。

服务端正文搜索、服务端 AI 和明文内容审计不属于该架构。未来如需引入，必须作为隐私模型变更重新立项并获得用户明确同意。

---

## 10. 平台窗口层

Tauri 通用窗口 API 只负责常规能力。以下行为允许并预计需要平台代码。

### Windows

- 非激活窗口样式；
- Alt+Tab / 任务栏隐藏；
- `SetWindowPos`、显示器工作区和 Per-Monitor V2 DPI；
- Explorer 重启后的托盘恢复；
- 全局快捷键冲突；
- DPAPI；
- 前台窗口记录与恢复。

### macOS

- `NSPanel` / 非激活面板行为；
- Menu Bar agent 与 App Switcher / Dock policy；
- screen visible frame 与 backing scale；
- Keychain；
- Login Item；
- 前台 app 记录与恢复。

平台调用封装为相同 Rust trait，不在 Vue 中出现 `if windows / if macos` 的业务分支。

---

## 11. 窗口建议

建议使用多个职责明确的 Tauri window：

| Window | 特征 |
|---|---|
| Dock | 无边框、透明、边缘定位、非普通任务窗口 |
| Preview | 可与 Dock 合并或独立；默认不激活 |
| Editor | 可激活、可靠输入、保存失败时保持 |
| Quick Capture | 临时激活、完成后恢复原窗口 |
| Library | 常规窗口 |
| Settings | 常规窗口或 Library 子路由 |
| Onboarding | 常规首次启动窗口 |

Dock 和 Preview 是否同一个物理窗口由 Spike 决定。若分窗导致焦点、阴影、命中区或跨 DPI 问题，优先合并为一个透明窗口内的两个区域。

---

## 12. 测试策略

### 12.1 Rust

- Domain 单元测试；
- Repository contract tests；
- SQLite migration tests；
- 加密 round-trip 和损坏密文测试；
- Import golden fixtures；
- Backup / restore；
- Outbox 幂等模型测试；
- 冲突 fixture。

### 12.2 Vue

- 组件测试：编辑器、任务、自动保存状态；
- Store / composable 测试；
- typed service mock；
- Markdown 安全测试；
- 键盘和可访问性测试；
- GSAP reduced-motion 与卸载清理测试。

### 12.3 桌面集成

- Tauri command contract；
- 快捷键 → Capture → 保存；
- Dock 焦点与前台恢复；
- 托盘 / 菜单栏；
- 多屏与 DPI；
- 安装、升级、回滚、卸载；
- Windows 和 macOS 各自使用真实机器完成发布 Gate。

---

## 13. 第一阶段 Spike

在搭建完整页面前完成：

### Spike A：窗口与 Dock

- Vue 渲染现有 HTML Dock；
- GSAP 距离感应达到 60fps；
- 左右拖动吸附；
- 两平台 Preview 不抢焦点；
- Editor 得焦点并可恢复原应用；
- Alt+Tab / App Switcher 行为符合 PRD；
- 双屏和缩放验证。

### Spike B：编辑器

- Vue 编辑器；
- 中文 / 日文 IME；
- Undo / Redo；
- task 行；
- Markdown 预览；
- 自动保存与失败保留；
- VoiceOver / Narrator 基础读取。

### Spike C：数据契约

- Rust Repository trait；
- SQLite migration；
- UUIDv7、revision、sortKey、tombstone；
- AEAD + Keychain / DPAPI；
- TypeScript command 类型；
- 模拟 Outbox 和 PostgreSQL DTO round-trip 测试。

三个 Spike 通过后再进入完整 Alpha。

---

## 14. 明确禁止的实现

- Vue 组件直接执行 SQL；
- 在 localStorage 保存正式便签或密钥；
- 用 SQLite 文件作为跨设备同步载体；
- 为“兼容 PostgreSQL”而强行共享 DDL；
- 使用服务端自增 ID 作为 Note 外部 ID；
- 用浮点数作为长期跨设备排序依据；
- 以客户端时间戳作为唯一同步 cursor；
- 物理删除后再尝试通知其他设备；
- 同步冲突静默覆盖正文；
- 在 E2EE 模型下承诺或实现服务端标题/正文全文搜索；
- 在 Vue 中散落平台条件分支和裸 `invoke()`；
- 依赖 WebView 默认行为实现关键焦点和窗口策略；
- 动画布局属性代替 transform，或组件卸载后遗留 GSAP tween。

---

## 15. 下一步

1. 初始化 Tauri 2 + Vue 3 + TypeScript 工程；
2. 接入 SQLx SQLite、内嵌 migration 和临时数据库测试；
3. 冻结 Rust ↔ TypeScript command contract 生成方式；
4. 冻结本地 schema v1；
5. 明确 UUIDv7、时间编码和 sort key 库；
6. 为未来 E2EE 建立 crypto envelope 数据结构，但 MVP 不实现账号同步；
7. 完成 Window、Editor、Data 三个 Spike；
8. Spike 通过后再拆分 Alpha 开发任务。
