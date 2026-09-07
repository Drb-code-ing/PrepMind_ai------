# PrepMind AI 当前状态

更新时间：2026-09-07
用途：给开发者和协作 Agent 提供一个短、可核对的项目快照。阶段细节和原始证据仍以 `docs/acceptance/` 为准。

## 一句话结论

PrepMind 的产品基础和大部分 Agent 合同已经落地，但 **Phase 6 Agent 运行时总审计仍未结束**。当前最新维护任务恢复了本地
Worker readiness：BullMQ 保留的历史失败只有在已被更新成功覆盖时才不再阻断流量，失败计数仍可观测；本机 CLI 也已统一到
Bun。此前完成的 `/agent-trace` Mock/Live 切换和 durable ChatTurn 浏览器恢复仍有效。Worker 仍是 deterministic baseline，
也不是真实模型 Worker。

## 当前基线

- ticket 01 已补齐认证 `POST /chat-turns` durable admission；ticket 02 已实现 Web bounded adapter；ticket 03 已在默认关闭的
  gate 后接通 `/api/chat -> message prepare -> enqueue -> 202 handoff`；ticket 04 已接浏览器 JSON replay/status-only recovery，
  并完成 Mock Docker/可见浏览器验收。开始新任务前仍用 `git rev-parse main` 与 `git rev-parse origin/main` 核对当前主线。
- 默认运行模式仍是 `AI_PROVIDER_MODE=mock`、`AI_ENABLE_LIVE_CALLS=false`，不会自动产生 Provider 费用。本地 Docker Web 的
  Chat 链组件 gate 已预配置，`/agent-trace` 的 Mock/Live 控件默认可见；用户选择 Live 后才生成同一请求链共用的进程内有效配置，
  不再要求修改 `.env` 或重启。其他 Server Agent gate 仍按各自验收边界关闭。
- 业务事实权威：PostgreSQL；Redis/BullMQ 负责缓存和队列；MinIO 负责对象存储；Dexie 负责本地恢复/离线补偿。
- Docker 数据必须保留。验收只允许清理本次创建的合成数据和隔离浏览器状态。
- 本地 Compose 当前只有一组规范 Server/Web；Worker 为 `healthy`。历史 maintenance failure 仍保留在 BullMQ，readiness 通过
  更新的 PostgreSQL 成功时间证明已恢复，而不是删除失败证据。详见
  [`phase-6-worker-readiness-recovery.md`](acceptance/phase-6-worker-readiness-recovery.md)。

## 能力分层

| 能力                        | 当前结论                                                                                                      | 边界                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 产品基础                    | 已实现并有阶段验收                                                                                            | 真实部署仍需独立环境检查                                                            |
| RAG                         | Qwen `text-embedding-v4` / 1536；向量 + PostgreSQL full-text hybrid rank                                      | 当前没有 reranker；`fake` 只用于非生产测试                                          |
| Router / Verifier           | Router 已进入 Server Worker stage 路径；混合路径仍由确定性安全门优先                                                                              | Router 产品真实模型 smoke 与 Verifier Server 注入仍待完成 |
| Tutor / Organizer           | 受限 candidate、权限与本地 merger 已实现，历史语义/产品证据分开保存                                           | 真实模型质量与产品 gate 仍需逐项确认                                                |
| Review / Planner            | 只读建议与受限 candidate 已实现                                                                               | 共享 ledger、持续运行证据和独立产品 Live 仍待补齐                                   |
| Knowledge Dedup / Organizer | owner-scoped shortlist、受限 candidate 与 deterministic fallback 已实现                                       | 需要最新矩阵确认真实产品 smoke 状态                                                 |
| Retriever / FinalResponse   | Server 已提供 owner-bound Retriever projection，严格复用知识搜索结果映射为 Verifier chunks；Worker 尚未在 RAG 路径调用它 | 不能据此证明上游每个 Agent 或 SLA；embedding/provider 和 Worker product wiring 仍待验证 |
| Chat response worker        | Outbox -> BullMQ -> claim -> durable terminal commit；Stream contract、Redis bounded replay 和状态查询已实现  | 当前 generator 是 `deterministic-worker-v1`；全链路 ledger、真实模型 Worker 未完成  |
| ChatRunBudget 合同          | `@repo/types`、Prisma schema/migration、owner-scoped repository、Worker/Router reservation/settlement/terminal reconcile、显式 UNCERTAIN recovery、dispatch 单胜者、终态 guard、Server turn-bound stage runner、`@repo/agent` typed budget port 与隔离 PostgreSQL 同机多 client 并发及子进程 post-commit crash 验收已实现 | 多 Worker/跨主机/网络故障恢复、Tutor/Retriever/Verifier/FinalResponse stage 注入、Trace 对账和真实模型结算未完成 |
| ChatTurn product bridge     | gate-on 后 prepare/enqueue/`202`；浏览器 owner-bound status + JSON cursor replay、刷新恢复和 status-only 降级 | gate 默认关闭；首轮保留 legacy；当前不是长连接 BFF SSE push，也不是生产持续运行证据 |
| MemoryAgent                 | PostgreSQL 候选/确认/停用/删除流程已实现                                                                      | 当前无模型 gate、自动注入或完整分层记忆实现                                         |
| Tool-Using Orchestrator     | 未实现                                                                                                        | 仅在治理 catalog/规划中出现                                                         |

## 证据怎么读

1. `implemented`：源码和静态/单元合同存在。
2. `mock/static validated`：reviewed Mock 或确定性回归通过，不代表 Provider。
3. `controlled-Live`：绑定独立 source/tag/授权的一次性真实 Provider 运行，失败也必须封存且禁止重跑。
4. `product real-model smoke`：指定产品入口在指定配置下成功，不自动覆盖其他 Agent。
5. `production-used`：需要持续运行、观测和业务证据，目前不因一次测试宣称。

历史 controlled-Live、marker、journal、report、artifact 和 tag 均是只读证据；不要 retry、replay、backfill、移动或改写。

## 下一步顺序

1. 完成 Phase 6 Agent 审计：逐项确认通信、owner/权限、并发、预算 ledger、取消、Trace 和真实模型产品 smoke。
2. 继续补齐其他 Agent stage 和 Trace 对账（ticket 05），复用 Server turn-bound stage runner；Router 与 Retriever projection 已完成，下一步把 Retriever 接到 Worker RAG 路径，
   再接收真实 owner-bound chunks 后迁移 Verifier。ChatRunBudget 同机多 client 并发与子进程 post-commit crash/reconciliation 证据已封存，多 Worker/跨主机/网络故障恢复仍待专门验收。
3. 为 Chat Worker 接入独立真实模型 gate、usage/cost 记录和产品 controlled smoke（ticket 06）；继续保持默认 mock/off。
4. 以负载和延迟数据评估是否另做真正 SSE push；ticket 04 当前是 JSON replay/polling，不伪称 SSE。
5. 在全部 Agent 架构完成后，设计并实现分层记忆：瞬时上下文、短期会话缓存、长期持久化记忆；再按用户要求编写两篇独立面试博客。
6. 之后进入 Phase 8 性能/PWA、Phase 9 MCP Tool 体系和 Phase 10 生产部署。

## 权威入口

- Agent 矩阵与缺口：[`phase-6-agent-runtime-audit.md`](acceptance/phase-6-agent-runtime-audit.md)
- ChatTurn 入队 API：[`phase-6-chat-turn-enqueue-api.md`](acceptance/phase-6-chat-turn-enqueue-api.md)
- ChatTurn Web adapter：[`phase-6-chat-turn-web-enqueue-adapter.md`](acceptance/phase-6-chat-turn-web-enqueue-adapter.md)
- ChatTurn 产品 bridge：[`phase-6-chat-turn-api-bridge.md`](acceptance/phase-6-chat-turn-api-bridge.md)
- ChatTurn 浏览器恢复：[`phase-6-chat-turn-browser-replay.md`](acceptance/phase-6-chat-turn-browser-replay.md)
- Chat Stream 合同与回放：[`phase-6-chat-stream-replay.md`](acceptance/phase-6-chat-stream-replay.md)
- 本地 Mock/Live 模式切换：[`phase-6-local-ai-mode-switch.md`](acceptance/phase-6-local-ai-mode-switch.md)
- Worker readiness 恢复：[`phase-6-worker-readiness-recovery.md`](acceptance/phase-6-worker-readiness-recovery.md)
- 本地启动与运维：[`dev-start.md`](dev-start.md)
- 当前路线：[`roadmap.md`](roadmap.md)
- 数据流：[`data-flow.md`](data-flow.md)
- 功能验收清单：[`acceptance-checklist.md`](acceptance-checklist.md)
- 历史开发事实：[`../DEVLOG.md`](../DEVLOG.md)
