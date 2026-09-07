# Session Workspace Specification

- Status: Approved for Phase 1 implementation
- Version: 1.0
- Updated: 2026-09-04
- Scope: Multi-project, multi-session, single-page continuous workflow
- Source of truth: This document

---

## Phase 1 必须完成（简要清单）

1. 左侧：Project / Session / 未关联项目 列表与切换。
2. 主区：当前 Session 内统一展示 Message、Execution、Artifact（时间线内）。
3. 底部固定 Composer。
4. 同一 Session 支持连续多轮执行（多次 Execution）。
5. 切换 Session 时上下文完全隔离。
6. 重启后恢复历史，running 转为 interrupted（可由用户继续新 Execution）。
7. 无 Project 的 Session 有独立工作目录。
8. 正式数据只来自 runtime snapshot；localStorage 仅保存 UI 偏好（如 `currentSessionId`、侧栏展开状态）。
9. 第一阶段全局只运行一个 Execution。
10. Skills、MCP、GitHub、完整 Git、语音、插件市场等不在本阶段范围。

---

## 核心原则（产品方向与信息结构）

- 一切以 `Session` 为中心：Session = 长期工作空间；Execution = Session 中的一次执行。
- 用户从提出需求、AI 分析、执行、查看文件成果、继续修改，全部在同一 Session 页面完成。
- 信息层级：
  1. Conversation（用户/AI 正式回复，视觉权重最高）
  2. Artifacts（AI 产生的文件、Diff、测试结果）
  3. Execution Details（Read/Search/Terminal/Patch 等过程，默认弱化并可展开）

> 说明：上述关系表示业务归属关系，不表示持久化时采用嵌套数组。正式 runtime snapshot 使用顶层规范化集合：`projects[]`, `sessions[]`, `messages[]`, `executions[]`, `artifacts[]`，通过 `projectId` / `sessionId` / `executionId` 进行关联。

---

## 界面总体结构（示意）

```
┌──────────────────────┬──────────────────────────────────────────────┐
│                      │  Project A / 修复 Runtime                 ··· │
│  PROJECTS            ├──────────────────────────────────────────────┤
│                      │                                              │
│  ▼ Project A         │  用户                                        │
│     修复 Runtime     │  帮我检查目前的迁移逻辑，并把问题修掉。       │
│     修改登录系统     │                                              │
│     UI 优化          │  AI                                          │
│  ▼ Project B         │  我检查了现有实现，发现主要有 4 个问题……     │
│     Maya 插件        │  下面开始修改。                               │
│  ▼ 未关联项目        │                                              │
│     临时会话         │  ┌────────────────────────────────────────┐  │
│     测试脚本         │  │ 执行过程（嵌入时间线，默认折叠）       ▾  │  │
│                      │  │ ✓ Read runtime/core.mjs                │  │
│                      │  │ ✓ 修改 storage.ts                      │  │
│                      │  │ ● Running tests...                     │  │
│                      │  └────────────────────────────────────────┘  │
│                      │                                              │
│                      │  本次修改 3 个文件                           │
│                      │  M runtime/core.mjs                          │
│                      │  M src/storage.ts                            │
│                      │  A src/SessionView.tsx                       │
│                      │  [查看 Diff]   [打开文件]   [打开位置]       │
│                      ├──────────────────────────────────────────────┤
│                      │  继续输入需求……                              │
│  设置               │  ＋（附件按钮暂不显示，若功能接入再开放）      │
└──────────────────────┴──────────────────────────────────────────────┘
```

说明：示意图移除 Skills/MCP/语音入口，并在第一阶段隐藏尚未接入的附件按钮（`＋文件` 不可见），避免误导用户。Execution 统一嵌入到时间线内，默认折叠，按需“显示更多”展开详细日志和 Patch。不要设计单独的任务页面或右侧执行页。

---

## 左侧：Project 与 Session

- 左侧列显示 Project 列表；每个 Project 下列 Session（可展开/折叠）。
- `未关联项目` 必须作为一级目录存在，用户无需创建 Project 即可长期使用 Session。
- 点击 Session：切换当前 Session，并同步主区显示对应 Messages / Executions / Artifacts。

---

## 中间主体：Conversation Timeline

- 时间线混合显示 User Message、Assistant Message、Execution（嵌入块，默认折叠）、Artifact（按 executionId 归属显示）。
- 用户最主要看到 AI 的正式回复与最终 Artifact，执行细节弱化并可展开。

---

## Execution（执行）规则

- Execution 是 Session 内的一次执行（不可等同于创建一个新 Session）。
- Execution 嵌入时间线，默认折叠，仅显示简要进度与最终状态（succeeded / failed / cancelled / interrupted）。
- “显示更多” 展开后显示：命令、完整日志、Tool Calls、Patch、stdout/stderr、错误详情等。

**停止行为补充**：点击“停止”表示尽力终止后续执行，但并不自动回滚已完成的修改。停止后必须记录并展示本轮已产生的 Artifact，并在执行摘要处提示“执行已停止，可能存在部分修改”。

---

## Artifact（文件成果）

- Artifact 必须归属具体 Execution（包含 `sessionId` 与 `executionId`），Artifact 列表仅展示该 Execution 实际产生的文件变更。
- Artifact 显示项目内的路径与状态；若文件不存在或路径不可访问，应提示“文件已不存在或路径当前不可访问”。
- 推荐 Artifact 运行时状态：`文件可用`、`文件已修改`、`文件已移动`、`文件不存在`、`工作目录不可访问`。

---

## 底部固定 Composer

- Composer 固定在页面底部，始终可见。
- 第一阶段 Composer 仅展示真实可用功能：发送、停止、模型选择（若可用）。
- 第一阶段不显示 Skills / MCP / 语音 / 尚未接入的附件入口。若附件能力接入后，再开放附件按钮。

---

## 执行并发与排队（第一阶段）

- 应用全局只允许一个 Execution 真正执行（全局单执行）。
- 当 `Session A` 正在执行时，若 `Session B` 用户发送新消息：
  - 消息会立即保存到 Session B 的时间线（用户可见）；
  - 对应 Execution 进入 `queued` 状态（显示为等待）；
  - Session A 完成后，系统自动从队列中取出下一项开始执行。
- 左侧会显示各 Session 的运行状态（queued / running / succeeded / failed / cancelled / interrupted）。

---

## Session 切换与上下文隔离

- 切换 Session 必须完全切换 Messages、Executions、Artifacts、AI 上下文、当前工作目录与 Project。
- 绝不允许左侧显示 Session B 而后台仍用 Session A 的上下文执行操作。

---

## 上下文恢复（可测试的要求）

重启后用户发起继续请求时，实际发送给模型的上下文应包含：
- 当前 Session 的 `contextSummary`；
- 最近 N 条相关 Message（可配置 N）；
- 相关 Execution 的摘要（id、状态、关键元数据）；
- 相关 Artifact 的路径引用（非文件二进制）。

开发在集成测试时应能验证发送给 API 的 payload 包含上述字段，而不是以主观回答相似度判断为验收标准。

---

## 异常关闭、重启与 interrupted 状态

- 如果应用关闭时某 Execution 状态为 `running`，重启后该 Execution 不应显示为 `running`（除非有可恢复的后台进程），应映射为 `interrupted` 并提示“上次执行因应用关闭而中断”。
- 禁止自动重新执行上一次命令；用户可主动选择“继续处理”，该操作应创建新的 Execution。

---

## 本地持久化与数据真源

- 正式的 Project / Session / Message / Execution / Artifact 数据只能来自 runtime snapshot（runtime 为单一可信源）。
- `localStorage` 仅可用于 UI 偏好：例如 `currentSessionId`、侧栏展开状态、UI 主题等；**绝不可把会话或执行数据写入 localStorage。**

---

## 附件与文件上传

- 第一阶段若附件能力尚未接入后端 API，请将附件按钮从 Composer 中隐藏；不要只显示按钮而无法实际上传或绑定。
- 若后续接入，文件上载必须具备状态：`上传中`、`已就绪`、`读取失败`、`不支持`，只有 `已就绪` 的附件才会随消息发送并绑定到本次 Message/Execution。

---

## 状态映射（第一阶段可视符号）

Execution 状态支持： `queued`、`running`、`waiting_user`、`succeeded`、`failed`、`cancelled`、`interrupted`。
UI 符号示例：
- ○ 等待（queued）
- ● 执行中（running）
- ◐ 等待用户（waiting_user）
- ✓ 完成（succeeded）
- ! 失败（failed）
- ■ 已停止（cancelled）
- ⚠ 已中断（interrupted）

---

## 第一阶段核心验收场景（必测项）

A. 无需添加 Project 即可：新建未关联 Session、生成文件并在工作目录中验证文件存在。
B. 同一 Session 内连续多次修改：保持单一 Session，包含多次 Execution，后续 Execution 能读取前次摘要与最近消息作为上下文。
C. Session 隔离：切换 Session 后上下文不交叉。
D. 切换 Session 时不停止其他执行，左侧仍显示运行状态；被排队的 Execution 按顺序执行。
E. 停止执行后显示 `cancelled`，并在执行摘要中展示停止前已产生的 Artifact；用户可在同一 Session 创建新 Execution。
F. 应用重启能恢复 Session 历史并继续工作（running → interrupted，用户可手动继续）。
G. 运行中异常关闭后，Execution 恢复为 `interrupted`，不会自动重试。
H. Artifact 真实性：Artifact 仅显示 AI 本次 Execution 实际修改的文件，不包括用户未被 AI 修改的文件。
I. Execution 失败后可在同一 Session 创建新的 Execution 以修复问题，原失败记录仍保留。

---

## 开发交付建议与流程

1. 将本文件作为第一阶段唯一的需求基线：`docs/session-workspace.md`。
2. PR / 通知仅包含简短摘要与该文档链接；不要分散维护多份正文。
3. 文档落盘后可以直接进入实现，不需再次等待确认（与下一轮 Session 主页面实现形成同一可验收 checkpoint）。
4. 第一轮实现范围（建议按此模块交付）：

```
SessionView
├─ SessionHeader
├─ MessageTimeline
│  ├─ UserMessage
│  ├─ AssistantMessage
│  ├─ ExecutionBlock (嵌入时间线，默认折叠)
│  └─ ArtifactBlock
└─ FixedComposer
```

5. 先接通 `currentSessionId`，从规范化顶层集合读取 Messages、Executions、Artifacts，并确保 Session 切换时主区同步显示。Execution 默认折叠，Artifact 必须按 `executionId` 归属。
6. 第一轮 Composer 仅展示真实可用的发送、停止和模型入口，不放占位功能或未接入入口。
7. 完成交付后请实际运行并报告：TypeScript 检查、全部 Node 测试、UI 测试、正式构建（`npm run build`），并提供真实的 PASS/FAIL、测试数量、修改文件清单与页面截图。

---

## 附加说明（小而重要的补充）

- 停止 Execution 不等同于回滚，请在 UI 提示中明确说明本次执行“已停止，可能存在部分修改”。
- 重启恢复上下文时，必须能验证发送到模型的上下文 payload 包含 `contextSummary`、最近 N 条消息、Execution 摘要与 Artifact 引用。
- Artifact 的“文件不存在/已移动”应有明确提示与可操作项（例如：打开工作目录、显示历史路径）。

---

*End of document.*
