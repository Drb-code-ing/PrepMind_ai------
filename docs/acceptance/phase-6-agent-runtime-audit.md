# Phase 6 Agent Runtime Audit

更新时间：2026-09-07
范围：Phase 6 全部 Agent、模型 gate、通信边界、权限、预算、Trace、降级和现有证据。  
结论级别：本文件是审计基线，不代表所有 Agent 已完成真实模型验收。

2026-09-05 的 Worker readiness 恢复任务已修正本地 Compose 的历史失败判定：Audit maintenance queue 会保留失败任务用于
排查，但只有 PostgreSQL `lastSucceededAt` 严格晚于最新 BullMQ failure 时，旧 failure 才不再阻断 readiness；更新失败或时间
不可验证仍降级。`readiness:worker` 同步切到 Bun，既有 direct CLI 历史失败已关闭。Docker Worker 已恢复 `healthy`，这不改变其
`deterministic-worker-v1` 模型边界。详见 `docs/acceptance/phase-6-worker-readiness-recovery.md`。

2026-09-02 Chat Stream 原子任务已将 `chat.response.requested` 通过 Outbox 幂等桥接到 BullMQ，Worker 可在 owner-scoped claim 后
以同一事务提交 assistant、ChatTurn、BackgroundJob 和终态 Outbox；随后以 `chat-turn-stream-v1` 合同发布有界 Redis Stream 事件，
并提供 owner-bound turn 状态/回放接口。2026-09-05 ticket 04 又让浏览器消费 authenticated status + JSON cursor replay/polling，
支持 Dexie checkpoint、刷新恢复和 Redis 故障后的 PostgreSQL status-only。当前生成器仍明确是 `deterministic-worker-v1`，当前
consumer 也不是真正 SSE push；完整 ledger 和真实模型 Worker 仍未完成。详细边界见
`docs/acceptance/phase-6-chat-response-worker.md`、`docs/acceptance/phase-6-chat-stream-replay.md` 与
`docs/acceptance/phase-6-chat-turn-browser-replay.md`。

2026-09-07 ticket 05 dispatch/recovery 切片进一步冻结 ChatRunBudget 运行时边界：重复 dispatch 不会再次授予执行许可，活跃/排队 turn
禁止提前终态对账，终态竞争失败方复用 durable winner，terminal replay 会再次执行 reconciliation；repository/Worker focused Jest `28/28`、
agent 全量 `1703/1703`、build/typecheck/lint 均通过。隔离 PostgreSQL crash/concurrency 脚本已加入但 Docker daemon 当前不可用，故该项
仍无本轮真实数据库回执；其他 Agent stage、Trace reconciliation 和真实模型结算仍未完成。
验收记录见 `docs/acceptance/phase-6-chat-run-budget-contract.md`。

2026-09-04 的 ticket 01 又在同一 durable 写边界之上补齐认证 `POST /chat-turns`：请求由 strict shared Zod contract
约束，owner 只来自 JWT，controller 仅委托 `ChatTurnEnqueueService`，并以 `202` 返回不含正文、hash、Outbox payload 或凭据的
安全投影。该 seam 只证明入队 admission，尚未把 Web 或 `/api/chat` 切换到 turn-backed/SSE，也没有调用 Provider。
功能分支和合并后的 Git 回执见 `docs/acceptance/phase-6-chat-turn-enqueue-api.md`。

同日 ticket 02 补齐 Web adapter：已持久化 `StoredMessage[]` 在浏览器内按 owner、顺序、id、时间、角色和正文生成稳定 SHA-256，
HTTP body 只携带 bounded ids/hash/budget facts；adapter 严格要求 `202` 并解析安全响应。conversation 未就绪或消息未持久化时只返回
显式 snapshot-sync compatibility decision；abort 与网络错误分开，避免用户取消或 session 切换后盲目重试。证据见
`docs/acceptance/phase-6-chat-turn-web-enqueue-adapter.md`。

2026-09-05 的 ticket 03 已将 authenticated `/api/chat` 接到默认关闭的 product bridge：conversation 已就绪时先通过
`POST /chat-messages/prepare` 做 owner-bound append-only 持久化，再调用 `POST /chat-turns` 并以 AI SDK data stream 返回
`202` handoff。首轮无 conversation id 或 gate-off 才走旧同步路径；无效身份/窗口和 admission 错误都 fail-closed。Mock
Docker/可见浏览器已证明 handoff、重叠提交阻止、Worker durable success、Redis initial replay 和刷新后的 PostgreSQL 恢复；浏览器
仍未主动消费 status/events，详见 `docs/acceptance/phase-6-chat-turn-api-bridge.md`。

同日 ticket 04 已补齐浏览器 consumer：handoff 进入 owner/conversation/turn-scoped Dexie v10 recovery，客户端按 cursor 读取
JSON event page，以 capped backoff 查询 status；Redis unavailable/cursor expired 时转 status-only，终态只信 PostgreSQL assistant
response。identity/conversation/token fence、absolute order、旧 snapshot sync 隔离和恢复期间 submit guard 均有回归；Mock Docker/
可见浏览器覆盖 Worker 延迟、刷新、Redis 暂停/恢复和恢复后的下一轮 enqueue。它不是 SSE push、真实模型或生产证据。

## 1. 结论摘要

- 产品 `/api/chat` 有两条受 gate 控制的链路：bridge-off 或首轮无 conversation 时继续同步
  Router/Tutor -> Retriever -> KnowledgeVerifier -> FinalResponse；bridge-on 且 conversation ready 时改为 prepare -> durable
  enqueue -> `202` handoff，不在 Web 进程调用模型链。
- `packages/agent/src/graph/index.ts` 当前只是 11 个节点的 descriptor，没有 edges、执行器、权限或预算 enforcement；它不是产品运行时的 source of truth。
- `Tool-Using Orchestrator` 在行为文档中被列为规划组件，但尚未进入 graph descriptor 或产品执行链。该项不能标记为已完成。
- 模型只能增强候选或生成受限 guidance；身份、owner、权限、业务事实、写操作和最终安全边界由确定性代码掌握。
- 目前有产品真实模型 smoke 的是 FinalResponse 主链（`/api/chat` 返回 `200 / mode=live / trace=true`）；这不等于 Router、Tutor、Retriever rewrite、Verifier、Review/Planner 或 Knowledge agents 都已逐项真实成功。
- 基础环境保持 `AI_PROVIDER_MODE=mock`、`AI_ENABLE_LIVE_CALLS=false`，不会自动调用 Provider。本地 Docker Web 预配置 Chat 链
  gates，并默认显示 `/agent-trace` 模式控件；只有用户显式选择 Live 后才生成统一的进程内有效环境。其他产品 Agent gate、独立
  controlled-Live 授权、预算和证据边界不变，不能把“方便切换”解释为新的真实模型验收。
- ChatTurn、可靠入队、deterministic Worker durable baseline 和 Chat Stream bounded replay API 已完成：请求 Outbox 幂等桥接到
  BullMQ，Worker 在 owner-scoped claim 后将 assistant/Turn/BackgroundJob/终态 Outbox 同事务提交，再发布可幂等回放的 Redis 事件；
  product bridge 已能 admission/handoff，浏览器也已接 JSON replay/status recovery；这仍不等于真实模型 Worker、SSE push 或生产
  持续运行。
- Worker readiness 已区分“保留的历史 maintenance failure”与“当前仍失败”：更新成功可以恢复 ready，但 retained count 继续
  暴露；最新失败、时间未知、队列暂停/不可读仍 fail closed。本机 CLI 与 subprocess 回归使用 Bun。
- Web enqueue adapter 已实现稳定 owner-bound request/hash、strict `202`、显式 snapshot fallback 和 abort/offline 分类；ticket 03 已由
  `/api/chat` 消费该 seam，ticket 04 已把严格 handoff 接到 owner-bound browser recovery。Redis preview 不是最终业务回答。

## 2. Agent 总矩阵

Chat 入队与后台执行的当前实现状态：`ChatTurnEnqueueService` 完成同事务 Turn/Job/Outbox，Chat Response Worker 完成 requested
bridge、claim、deterministic generation、terminal commit 和 bounded stream publication；`ChatTurnsController` 提供 owner-bound
status/replay 查询。active claim recovery、产品切换、真实模型和生产使用证据仍按下表推进。

| Agent                             | 职责与入口                                                                                                        | 模式与模型                                                                  | gate /预算 /超时                                                                                      | 权限与通信边界                                                                                      | Trace /证据                                                                                                            | 当前缺口                                                                                         |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| RouterAgent                       | `/api/chat` 内确定路由：`rag_answer`、`study_plan`、`review_analysis`、`wrong_question_organize`、`tutor`、`chat` | 确定性关键词/上下文为权威；可选 DeepSeek/OpenAI-compatible candidate        | `ROUTER_MODEL_ENABLED` + 全局 live 两项；共享 Router/Verifier `2 calls / 2400 input / 800 output`；5s | 只读 request/context；不得决定身份、owner、权限或写操作；输出 route contract 给编排器               | observation 可进 header/Trace；模型失败回退普通 Chat；无专属 product-live 逐项证据                                     | 与 graph descriptor 没有执行边；全链路预算未统一                                                 |
| TutorAgent                        | 为 `route=tutor` 生成 bounded 学习引导                                                                            | 确定性 Tutor strategy 为基础；可选真实模型只增强 guidance                   | 独立 `1 / 1200 / 300`；3s；显式非 tutor 或 gate-off 为 zero-call                                      | 只读最近上下文与 strategy；输出受限 guidance，不得替代最终回答                                      | degraded observation 进入编排结果；失败回退 deterministic strategy；无专属 product-live 证据                           | runtime/config 仍由 Web 编排层维护，未纳入 graph enforcement                                     |
| RetrieverAgent                    | owner-scoped 关键词+向量 hybrid search，返回 bounded evidence                                                     | 检索本体确定性；query rewrite 可选 DeepSeek `deepseek-v4-pro`               | `RETRIEVER_QUERY_REWRITE_MODEL_ENABLED` + 全局 live；4s，`1200/160`，cap `0.005 CNY`                  | canonical auth、owner、run/request/deadline 绑定；不得跨 owner 或写业务                             | query hash、命中数、延迟、rewrite disposition；失败可 `failed_no_rag`；历史 SR5 不是 quality authority                 | 没有单独 product-live rewrite 成功证据；budget 未跨节点聚合                                      |
| KnowledgeVerifierAgent            | 审查 Retriever evidence 的可信度                                                                                  | 先确定性 `verifyKnowledgeChunks`；模型只能收紧结论                          | `KNOWLEDGE_VERIFIER_MODEL_ENABLED` + 全局 live；共享 `2 / 2400 / 800`；4s                             | 只读 chunks；不得放宽安全边界或写知识库；输出 `trusted/suspicious/conflict/insufficient`            | conservative fallback；observation 进 Trace；无专属 product-live 证据                                                  | 与 Router 共用 bundle，缺少显式跨节点 capability/预算记录                                        |
| FinalResponseAgent                | 消费本地 projection、citation、bounded turns/guidance 并流式回答                                                  | 产品真实流式节点；DeepSeek `deepseek-v4-pro` non-thinking，mock/live 双路径 | `FINAL_RESPONSE_AGENT_MODEL_ENABLED` + 全局 live；20s，`2500/1200`，cap `0.015 CNY`                   | 只读 context-bound request；不得直接写业务或引入未授权 citation；必须产生唯一 terminal              | Trace finalize best-effort；已具备合并后 `/api/chat` live smoke                                                        | 现有 smoke 未逐项证明上游每个 Agent 成功；全链路预算/断连持久化仍待补强                          |
| ChatTurn product bridge           | `/api/chat` prepare/enqueue/`202`；浏览器消费 status + JSON cursor replay 并恢复 durable answer                   | 非模型 admission/recovery；Worker 仍是 deterministic baseline               | gate 默认 false；bounded tail `1000 / 2M`；replay page `100`；capped backoff；Redis op 默认 1.5s      | JWT owner；Dexie owner/conversation/turn；identity/token Abort fence；PostgreSQL terminal authority | API/adapter/bridge/recovery 回归 + Mock Docker/可见浏览器；ticket 04 acceptance                                        | 全链路 ledger 与真实模型 Worker 未完成；当前不是 SSE push                                        |
| WrongQuestionOrganizerAgent       | 组织单题/批量错题，并通过 command executor 执行受控写操作                                                         | 确定性 organizer 为权威；可选 DeepSeek candidate                            | 一次调用，`3500/800`，5s，cap `0.016 CNY`；worker 强制关闭                                            | JWT + owner snapshot/freshness/admission；模型不得直接写，必须经过 trace/admission/command          | AgentTrace best-effort；用户预修改文件不在本轮审计范围                                                                 | 需要独立产品真实模型 smoke；不能触碰当前 3 个用户 dirty 文件                                     |
| ReviewAgent                       | `GET /review-agent/suggestions`，生成复习分析/建议                                                                | 确定性 tasks/preferences/cards/logs 为权威；可选 Review candidate           | Review/Planner 共享 `2 / 1950 / 440`；默认 4.5s                                                       | JWT；只读业务快照；candidate 不得写业务                                                             | AgentTrace best-effort；AbortSignal 与外层 deterministic fallback 已有 focused `13/13`；无本轮产品 live endpoint smoke | 仍需独立真实模型产品验收、共享 ledger 与持续运行证据                                             |
| PlannerAgent                      | 同一 suggestions endpoint 的学习计划生成                                                                          | 确定性 `planStudy` 为权威；可选 Planner candidate                           | 与 Review 共享 `2 / 1950 / 440`；默认 4.5s                                                            | JWT；只读快照；输出计划候选，不得改任务数据                                                         | AgentTrace best-effort；AbortSignal 与外层 fallback 已修复；无本轮产品 live endpoint smoke                             | 仍需独立真实模型产品验收、并发预算与持续运行证据                                                 |
| MemoryAgent                       | `/memory-agent/*` 候选生成、接受/拒绝及用户记忆 CRUD                                                              | 当前 `generateCandidates` 为确定性 `analyzeMemory`；没有模型 gate           | 无 provider/gate/timeout/budget/Trace 合同                                                            | JWT；读取 60 日消息/cards/logs/preferences；接受需显式用户确认；写入事务化                          | 无 AgentTrace；accept/reject/update/delete 是明确业务写操作                                                            | 架构上是“代码存在但没有模型增强”的明显缺口；需先定义隐私、候选范围、预算和降级合同，再接真实模型 |
| KnowledgeDedupAgent               | `/knowledge-agent/suggestions` 中知识去重候选                                                                     | 确定性快照/重复判断 + 可选 DeepSeek `deepseek-v4-pro`                       | 每 agent 约 `3000/500`；共享 `2 / 6000 / 1200`；4.5s；cap `0.03 CNY`                                  | JWT、RepeatableRead owner snapshot、前后 stale revalidation；不直接写领域数据                       | Trace best-effort；异常 safe fallback；无本轮 product live smoke                                                       | 需要真实 endpoint smoke 与共享预算/并发证据                                                      |
| KnowledgeOrganizerAgent           | 同一 endpoint 中知识组织候选                                                                                      | 确定性组织 + 可选 DeepSeek `deepseek-v4-pro`                                | 每 agent 约 `3000/700`；共享 `2 / 6000 / 1200`；4.5s；cap `0.03 CNY`                                  | 与 Dedup 相同；模型结果必须经过 freshness fence                                                     | Trace best-effort；异常 safe fallback；无本轮 product live smoke                                                       | 同 DedupAgent                                                                                    |
| ConversationSummary（支持子系统） | `ConversationContextService.prepare` 的会话摘要与长期上下文压缩                                                   | 确定性 redaction/schema；可选 model runtime；不是 graph Agent               | 有 summary 专属 calls/input/output/timeout 配置                                                       | 只读当前会话与安全摘要；Serializable CAS 后才持久化；失败回退 previous/degraded                     | 尚未发现 AgentTrace stage；需决定纳入正式 trace taxonomy 还是保持独立                                                  | 应在记忆系统阶段明确它与瞬时/短期/长期记忆的边界                                                 |

## 3. 通信与权限审计

### 3.1 当前 Chat 组合

```text
HTTP request
  -> canonical /auth/me + owner binding
  -> ChatTurn bridge decision
       |- bridge-on + conversation ready
       |    -> message prepare -> durable enqueue -> 202 handoff
       `- bridge-off / first-turn compatibility
            -> Trace start (best-effort)
            -> Router/Tutor -> Retriever -> KnowledgeVerifier
            -> local evidence projector -> FinalResponse stream
            -> terminal Trace finalize (best-effort)
```

每个模型节点消费上游的 typed、bounded projection；模型不得读取原始数据库连接、凭据、其他用户数据或直接调用领域 command。

### 3.2 目前的架构断点

1. `packages/agent/src/graph/index.ts` 已升级为受治理 catalog：明确 `executionAuthority=catalog_only`、产品组合层权威、typed communication edges、模型模式、领域写权限和 planned Orchestrator；它仍不执行 Agent，也不伪造 owner capability、budget ledger 或 terminal policy。
2. `packages/agent/src/runtime.ts` 的通用运行时与产品 `/api/chat` 不是同一执行契约，不能用它证明产品链路已经串联。
3. 行为文档中的 Tool-Using Orchestrator 尚未实现，不能列入“已完成 Agent”。
4. Chat Trace 是旁路 best-effort，写入超时或失败不会阻断回答；Worker 与 Redis bounded stream 已建立 durable baseline，`/api/chat`
   已接 admission/handoff，浏览器 status/JSON replay 与断线恢复也已接入。真正 SSE push 仍未实现，但不作为 ticket 04 完成条件。
5. Review/Planner 的 HTTP AbortSignal 与 candidate 外层 fallback 已完成；共享预算 repository、Worker reservation/settlement 和 terminal
   reconciliation 已建立，但 Review/Planner 真实模型产品验收仍未建立。
6. Router/Verifier/Tutor/FinalResponse 各自持有局部预算；`@repo/agent` 现在提供 typed `AgentBudgetPort/runBudgetedStage`，但产品 composition
   root 尚未注入，因此仍需补跨节点上限、Trace 对账和越界测试，不能把 port 合同当成产品 enforcement。
7. `POST /chat-turns`、Web adapter、`/api/chat` bridge 和 browser recovery 都已实现；`202` 仍只表示 Worker 已接管，浏览器必须继续
   通过 authenticated status/JSON replay 取得结果。不得把该 polling consumer 误读为 SSE push 或 Provider 成功。

## 4. 证据分级

| 级别                     | 含义                                                                         |
| ------------------------ | ---------------------------------------------------------------------------- |
| implemented              | 源码存在且静态/单元合同通过，不代表产品接入                                  |
| mock/static validated    | reviewed mock 或确定性回归通过，不代表真实模型                               |
| controlled-Live          | 在独立 source/tag/授权下的一次性真实 Provider 证据；失败也要封存，禁止重跑   |
| product real-model smoke | 真实产品 endpoint 返回模型结果；只证明该入口和当次配置，不自动证明每个 Agent |
| production-used          | 需要额外的持续运行、可观测性和业务证据，本阶段不宣称                         |

当前已确认的 product real-model smoke 只有 `/api/chat` 主回答链；其余 Agent 的真实调用仍需逐项或组合式受控验收。历史 SR5 Retriever/FinalResponse controlled-Live 证据保持 `qualityAuthority=none`，不能反推语义质量。

## 5. 本审计后续顺序

1. ~~先修复并测试 Review/Planner 的 AbortSignal 与 candidate 外层 fail-safe。~~ 已完成：controller 将 HTTP `aborted` 映射为请求级 AbortSignal，service 传入两个 candidate；两个 candidate runner 额外有 deterministic 外层 fallback。`review-agent.controller.spec.ts` + `review-agent.service.spec.ts` 为 `13/13`，Server build 通过。
2. ~~定义 graph descriptor 与产品组合层的关系。~~ 已完成：catalog 明确不是执行器，补 typed edges、model mode、domain write permission、产品组合位置和 planned Orchestrator；graph focused `3/3`、Agent typecheck 通过。
3. ~~补齐认证 ChatTurn enqueue HTTP seam。~~ 已完成：`POST /chat-turns` 以 strict shared contract 校验 bounded facts，从 JWT
   取得 owner，复用 `ChatTurnEnqueueService` 的 Turn/BackgroundJob/Outbox 同事务，并返回 `202` 安全投影。Controller + Swagger
   `13/13`、ChatTurn `52/52`、types `44/44`、Server build、目标 ESLint/Prettier 通过；全量 Server Jest 的两个失败仍是既有
   readiness/integration 环境问题。功能提交 `4511d3ee` 已推送并以 `--no-ff` 合并为 `main=582f2aef`；merged-main
   focused/static 回归通过且 `main == origin/main`。详见 `docs/acceptance/phase-6-chat-turn-enqueue-api.md`。
4. ~~补齐 Web enqueue adapter。~~ 已完成稳定 canonical request/hash、bounded facts、strict `202`、snapshot compatibility decision、
   owner/abort/offline 边界和 Web 回归；详见
   `docs/acceptance/phase-6-chat-turn-web-enqueue-adapter.md`。
5. ~~补齐 `/api/chat` admission/handoff bridge。~~ 已完成 authenticated prepare、durable enqueue、`202` handoff、临时消息隔离、
   重叠提交阻止和 Mock Docker/可见浏览器验收；详见 `docs/acceptance/phase-6-chat-turn-api-bridge.md`。
6. ~~完成浏览器 status/replay（ticket 04）。~~ 已接 authenticated JSON cursor replay/polling、Dexie v10、identity fence、
   PostgreSQL terminal authority 和 Mock Docker/可见浏览器验收；不是 SSE push。继续完成全链路 ledger 与真实模型 Worker。
7. ~~恢复本地 Worker readiness 与 CLI。~~ 已关闭 retained failure 永久降级和 direct `ts-node` 入口失败，Docker Worker
   `healthy`；历史失败没有删除，真实模型 Worker 边界没有改变。
8. ~~冻结 ChatRunBudget 共享类型与生命周期合同。~~ 已完成；实现与边界见 `phase-6-chat-run-budget-contract.md`。
9. ~~在本地 PostgreSQL 部署 ChatRunBudget migration。~~ 已完成：`prisma migrate deploy` 应用 `20260905100000_chat_run_budget` 且 status up to date；仍需隔离数据库
   Serializable/CAS 并发、crash/recovery 证据，并补齐其他 Agent stages、Trace 对账。
10. 为 MemoryAgent 定义真实模型增强的隐私、候选确认、预算和 Trace 合同；完成 Agent 架构后再进入分层记忆实现。
11. 做独立 Review/Planner、Knowledge agents、Router/Verifier/Tutor/Rewrite 的产品验收，保持浏览器窗口可见并保留证据。
12. 所有代码/文档任务逐项提交、推送、`--no-ff` 合并 main，再在 merged-main 复验；全部 Agent 架构与真实验收完成后，才写两篇面试博客。
