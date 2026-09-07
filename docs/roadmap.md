# PrepMind AI 路线图

> 这是当前路线的短版。旧阶段的逐次计划、失败回执和历史数字保留在
> [`docs/archive/roadmap-history.md`](archive/roadmap-history.md)、`DEVLOG.md` 与各阶段 acceptance 文档中；
> 不要把历史段落当作当前待办。

## 当前焦点

**Phase 6 Agent 运行时总审计**。最新原子任务已完成 ChatTurn/BackgroundJob/Outbox 到 BullMQ 的 deterministic Worker durable
baseline、认证 enqueue、`/api/chat` handoff，以及浏览器 owner-bound status + JSON cursor replay/polling、刷新恢复和 status-only
降级。下一步不是继续堆一次性 Live 脚本，而是补全链路预算和各 Agent 的真实模型证据。

当前基线（2026-09-05）：

- 文档入口分层整理已合并并推送；开始新任务前用 `git rev-parse main` 与 `git rev-parse origin/main` 核对当前主线。
- 基础模式默认 `AI_PROVIDER_MODE=mock`、`AI_ENABLE_LIVE_CALLS=false`，不会自动调用 Provider；本地 Docker Web 的五个 Chat 链
  gate 已预配置，`/agent-trace` 显式选择 Live 后才形成进程内有效配置。其他 Server Agent gate 仍默认关闭。
- `packages/agent/src/graph/index.ts` 是 `catalog_only` 治理目录，不是执行器；产品 Chat 编排在 Web/API composition。
- Tool-Using Orchestrator 尚未实现；MemoryAgent 仍是确定性候选策略。
- 历史 controlled-Live 只读且不可重跑；语义质量、产品可用性、billing 和 SLA 分开记录。
- ticket 01-03 已完成 durable admission、Web adapter 和 `/api/chat` handoff；ticket 04 已接入 JSON replay/status recovery。
  当前不是长连接 BFF SSE push，Worker 仍是 deterministic baseline。
- 本地 Worker readiness 已恢复：更新的 maintenance success 可覆盖仍被 BullMQ 保留的旧 failure，但失败计数继续可观测；
  direct CLI 已改用 Bun。该维护任务不替代 ticket 05 的全链路预算，也不提供 ticket 06 的真实模型证据。

## 阶段总览

| 阶段              | 主题                                                                                    | 状态                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Phase 0-3         | Monorepo、产品 MVP、鉴权、OCR、AI 讲题                                                  | 已完成并持续维护                                                                        |
| Phase 4           | FSRS 复习、今日任务、统计、计划与离线评分                                               | 已完成                                                                                  |
| Phase 5           | 文档处理、Qwen embedding、Hybrid RAG、知识库页面                                        | 已完成；持续做运行时回归                                                                |
| Phase 6.0-6.8     | Agent contracts、Router/Tutor/Verifier/Organizer/Review/Planner/Memory/Knowledge agents | 已实现基础能力；真实模型证据按矩阵分开                                                  |
| Phase 6.9.1-6.9.4 | Agent eval、ModelAgentRuntime、Router/Verifier 混合路径                                 | 工程与既有产品验收完成，默认 gate 关闭                                                  |
| Phase 6.9.5-6.9.6 | Review/Planner、Knowledge agents                                                        | 有受限 candidate 和历史验收；当前审计仍需确认持续/产品证据                              |
| Phase 6.9.7       | Tutor / WrongQuestionOrganizer schema recovery 与产品回放                               | 历史 lineage 已封存，主线不再拼接旧证据                                                 |
| Phase 6.9.8       | Retriever / FinalResponse、transport/schema recovery                                    | 部分工程收口；Task 9C/R5 质量门失败历史不可重跑，产品 turn-backed 仍待补齐              |
| Phase 7           | Worker、Outbox、Readiness、Admin、Audit 与导出                                          | 核心子阶段已完成；Chat response worker/Stream 为 deterministic baseline，产品切换待完成 |
| Phase 6.10        | 分层记忆（瞬时/短期/长期）                                                              | 待全部 Agent 架构和合同稳定后开始                                                       |
| Phase 8           | 性能优化与 PWA                                                                          | 计划中                                                                                  |
| Phase 9           | MCP Tool 体系                                                                           | 计划中                                                                                  |
| Phase 10          | 生产级部署与持续运维                                                                    | 计划中                                                                                  |

## 当前工作包

### A. Agent 运行时审计

以 [`phase-6-agent-runtime-audit.md`](acceptance/phase-6-agent-runtime-audit.md) 为唯一矩阵，逐项确认：

- typed communication edge、owner/canonical principal 和最小权限；
- 并发、取消、超时、共享 budget ledger 与跨节点 reservation；
- deterministic policy、model candidate、schema validator、fallback 和 Trace 的职责边界；
- Router、Verifier、Tutor、Retriever rewrite、FinalResponse、Review/Planner、Knowledge agents 的真实模型产品 smoke；
- MemoryAgent 的隐私、候选确认、预算、Trace 与长期持久化合同。

### B. Chat durability

已完成的基线：

```text
ChatTurn + BackgroundJob + chat.response.requested Outbox
  -> BullMQ bridge
  -> owner-scoped Worker claim
  -> assistant + Turn + Job + terminal Outbox 同事务提交
  -> bounded Redis Stream events / owner-bound replay API
```

仍需独立任务完成：

1. ~~完成 [`ChatTurn Enqueue API spec`](../.scratch/chat-turn-enqueue-api/spec.md) 的 ticket 01。~~ 已提供认证 HTTP 入队 seam，
   详见 [`phase-6-chat-turn-enqueue-api.md`](acceptance/phase-6-chat-turn-enqueue-api.md)；
2. ~~完成 Web enqueue adapter（ticket 02）。~~ 已实现 typed adapter、稳定 canonical identity、strict `202`、owner/abort/offline
   边界与 snapshot compatibility decision；详见
   [`phase-6-chat-turn-web-enqueue-adapter.md`](acceptance/phase-6-chat-turn-web-enqueue-adapter.md)；
3. ~~`/api/chat` turn-backed admission/handoff、owner/session 生命周期与旧 snapshot sync 兼容窗口（ticket 03）。~~ 已完成
   gated prepare/enqueue、临时 handoff 隔离、重叠提交阻止与 Mock Docker/可见浏览器验收；详见
   [`phase-6-chat-turn-api-bridge.md`](acceptance/phase-6-chat-turn-api-bridge.md)；
4. ~~将 bounded replay API 接入浏览器，并处理 cursor 过期与 PostgreSQL 状态恢复（ticket 04）。~~ 已完成 authenticated JSON
   cursor replay/polling、Dexie v10 checkpoint、身份 fence、status-only 和 Mock Docker/可见浏览器验收；详见
   [`phase-6-chat-turn-browser-replay.md`](acceptance/phase-6-chat-turn-browser-replay.md)。真正 SSE push 不在本 ticket 范围；
5. 全链路 ChatRunBudget ledger、Trace 对账和跨节点上限（ticket 05）；Router Server stage 已接入，其他产品 Agent 仍待迁移；
6. 真实模型 Worker 的独立 gate、usage/cost 和产品 smoke（ticket 06）。

### C. 分层记忆（Phase 6.10）

在 Agent 架构完成后按以下边界实现：

- 瞬时记忆：当前请求的受限对话上下文，不持久化敏感原文；
- 短期记忆：会话级缓存和摘要，带 owner、版本、过期和 CAS；
- 长期记忆：用户确认后写入 PostgreSQL/向量索引的结构化记忆，支持撤回、删除和审计；
- 任何自动注入都必须经过隐私、权限、预算、可解释性和降级门。

完成后分别编写《多 Agent 架构》和《记忆系统》两篇面试学习博客，不提前用博客替代工程验收。

## 交付顺序

每个原子任务都按同一顺序收口：

1. 从最新已推送 `main` 创建普通 `drb/*` 分支；
2. 先写合同/测试，再实现最小改动；
3. 跑 focused、静态和必要的 Docker/API/可见浏览器验收；
4. 同步 acceptance、`DEVLOG.md`、本路线和当前状态；
5. 一任务一提交，推送功能分支；
6. `--no-ff` 合并 `main`、推送远程，再在 merged-main 复验；
7. 只精确清理本轮合成数据，保留 Docker 卷和历史 evidence。

## 完成判定

不能仅凭“源码存在”或“Mock 通过”宣称完成。阶段收口必须同时写明：

- 实现范围与未实现范围；
- 测试、build、lint、typecheck、Docker/API/browser 证据；
- Provider/credential/evidence/business writes 计数及数据边界；
- gate、权限、预算、并发、失败和恢复行为；
- 分支、功能提交、merge 提交、远程 parity 和合并后复验结果。

## 相关入口

- 当前快照：[`docs/project-status.md`](project-status.md)
- Agent 矩阵：[`docs/acceptance/phase-6-agent-runtime-audit.md`](acceptance/phase-6-agent-runtime-audit.md)
- 本地运行：[`docs/dev-start.md`](dev-start.md)
- 数据流：[`docs/data-flow.md`](data-flow.md)
- 功能验收：[`docs/acceptance-checklist.md`](acceptance-checklist.md)
- 历史事实：[`DEVLOG.md`](../DEVLOG.md)
