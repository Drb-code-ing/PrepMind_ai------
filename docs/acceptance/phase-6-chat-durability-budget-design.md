# Phase 6 Chat Durability and Budget Design

更新时间：2026-09-07
状态：可靠入队、deterministic Worker、bounded replay API、gate-on 产品 bridge/浏览器恢复和 ChatRunBudget 共享类型合同已实现；
全链路持久化 budget ledger、真正长连接 SSE push 和真实模型 Worker 仍未实现。实现证据见
[`phase-6-chat-turn-browser-replay.md`](phase-6-chat-turn-browser-replay.md) 与
[`phase-6-chat-run-budget-contract.md`](phase-6-chat-run-budget-contract.md)。

## 1. 当前问题

`POST /api/chat` 的 legacy 路径（bridge-off 或首轮无 conversation）在 Web 进程内完成 Router/Tutor/Retriever/Verifier/FinalResponse 编排并流式输出。回答完成后，浏览器再通过
`/chat-messages/sync` 回传完整消息 snapshot；Server 的 sync 会删除并重建该 conversation 的消息。

这条链路有三个明确边界：

1. Web 进程在模型完成、浏览器 sync 之前崩溃，模型回答没有服务端 durable owner。
2. 客户端断开会触发 request AbortSignal，生成可能被中止；如果回答已经产生部分内容，当前 sync 会拒绝不完整 assistant。
3. Trace 是 best-effort 旁路，不能承担回答持久化；单独在 `/api/chat` 里追加 Outbox 也不能覆盖 Web 进程崩溃、重复请求和 worker 重试。

这些限制仍适用于 legacy 路径。ticket 03/04 已在 gate-on 且 conversation ready 时改走 prepare/enqueue/`202` handoff 和浏览器
JSON replay/status recovery；该路径已有 deterministic Worker 断线恢复证据，但尚未接入真实模型 Worker。

## 2. 推荐生产链路

```text
authenticated request
  -> Server transaction:
       ChatTurn(QUEUED, ownerId, idempotencyKey, inputHash, conversationId)
       BackgroundJob(QUEUED, resourceType=CHAT_RESPONSE, resourceId=turnId)
       OutboxEvent(chat.response.requested, same transaction, idempotencyKey)
  -> Outbox dispatcher claims event and bridges to BullMQ
  -> worker claims owner-bound Turn/BackgroundJob
  -> worker loads owner-scoped input by turnId (never trusts payload owner)
  -> ChatRunBudget ledger reserves child scopes
  -> Router -> Tutor -> Retriever -> Verifier -> FinalResponse
  -> append assistant message + ChatTurn/BackgroundJob terminal state in one transaction
  -> OutboxEvent(chat.response.completed|failed, same transaction)
  -> Redis stream / SSE publishes bounded deltas and terminal cursor
  -> browser reconnects by turnId and replays from bounded cursor; expired/unavailable transport falls back to turn status/result
```

`BackgroundJob` 和请求 `OutboxEvent` 必须在同一个数据库事务中创建。BackgroundJob 负责任务状态、attempt、队列归属和用户可见进度；Outbox
负责把“请求已入队”和“终态已落库”可靠交给 dispatcher。当前 Worker 已把 assistant/Turn/Job/终态 Outbox 收束到一个完成事务；本
checkpoint 已增加独立 Redis Stream transport，但它仍不是 durable authority。两者不能一个成功、另一个失败，也不能把 provider 原文或
完整 prompt 放进 payload。

## 3. 数据与幂等合同

### 3.1 ChatTurn（已完成第一步）

建议新增 `ChatTurn`，而不是继续把完整 snapshot 当作写模型：

- `id`、`userId`、`conversationId`、`clientRequestId`（owner 范围唯一）
- `status`: `QUEUED | ACTIVE | SUCCEEDED | FAILED | CANCELLED`
- `inputHash`、`inputMessageIds`、`budgetPolicyVersion`
- `responseMessageId`、`errorCode`、`startedAt`、`finishedAt`
- `createdAt`、`updatedAt`

输入正文继续放在 owner-scoped `ChatMessage`/turn input 表中；队列 payload 只保存 `turnId`、版本、hash 和有限诊断。

已落地的第一步还包括 owner + conversation 复合外键、固定错误枚举、生命周期 CHECK、CAS repository 和幂等/跨 owner 测试；
实现与证据见 `docs/acceptance/phase-6-chat-turn-state-machine.md`。可靠入队实现与证据见
`docs/acceptance/phase-6-chat-enqueue-outbox.md`；Worker durable baseline 见
`docs/acceptance/phase-6-chat-response-worker.md`。

### 3.2 Idempotency

- `clientRequestId` 在同一用户下唯一；重复 enqueue 返回既有 turn/job，不再次调用模型。
- worker 通过 `updateMany(where: status=QUEUED)` 抢占；当前基线没有伪造 active lease，Outbox 重试会验证同 id Bull 记录，
  缺失时 fail-closed；真正的 lease 过期恢复仍需后续带 lease 的巡检/Replay 任务，不能并发生成两个 assistant。
- 完成写入以 `turnId + responseMessageId` 唯一约束保护；重复 `chat.response.completed` 只做幂等确认。
- Outbox 使用 `chat.response.requested:${turnId}` 与 `chat.response.completed:${turnId}` 两个唯一 key。

## 4. 全链路预算合同

当前 Router/Verifier、Tutor、FinalResponse 各自拥有局部 budget。共享 run-level ledger 已持久化，Worker 已通过 Server turn-bound runner
消费 `AgentBudgetPort`；下一步是将产品 Agent 执行与 Web 配置/HTTP 依赖解耦后迁入 Server，不能另造 Web 进程内账本：

```text
ChatRunBudget {
  maxCalls: 5,
  maxInputTokens: 10_000,
  maxOutputTokens: 2_800,
  maxCostCny: configured_cap,
  usedCalls/input/output/cost,
  policyVersion,
}
```

- ledger 由 Server/Worker 创建，子 Agent 只能取得不可变 scope view 和一次性 reservation；不能自行重置或扩大上限。
- 推荐 scope：Router+Verifier `2/2400/800`、Tutor `1/1200/300`、Rewrite `1/1200/160`、FinalResponse `1/2500/1200`；全链路最大值应大于等于实际可选路径，但 `maxCalls` 和 token/cost 必须由同一 ledger 结算。
- 每次 reservation 在 dispatch 前写入 Trace/ledger 的 bounded event；provider 原文、prompt、credential 不落库。
- 失败、abort、timeout、schema invalid 都释放“未使用”预算但不回滚已发生调用；重试必须新 turn 或显式 retry policy，不能隐式 replay。

共享合同位于 `@repo/types` 的 `chat-run-budget` API：policy、ledger、reservation、usage 和 bounded event 均为 strict Zod schema；对应
Prisma ledger/reservation/event 结构和 migration CHECK 已落地。
reservation 的 `RESERVED -> DISPATCHED -> SETTLED|UNCERTAIN` 与未 dispatch 的 `RELEASED` 生命周期、时间顺序、结算 usage 不得超过预留值、
以及 `used + held <= policy` 都在合同层校验。合同验收见
[`phase-6-chat-run-budget-contract.md`](phase-6-chat-run-budget-contract.md)。这只是 `implemented + mock/static validated`，不代表
生产数据库迁移、全链路 Agent CAS、Trace 对账或真实模型调用已完成。

## 5. 权限、Trace 与 Outbox 边界

- turn、job、message、outbox 全部以 `userId`/owner capability 绑定；worker 不接受客户端传入的 owner。
- 模型只消费 server 生成的 bounded projection；BackgroundJob/Outbox payload 只放 opaque ids、hash、枚举和版本。
- Trace 继续 best-effort，不作为回答 durable authority；`chat.response.completed` handler 负责 reconciliation，发现“已落库但 Trace 缺失”时只补 bounded 状态，不补 provider 原文。
- `chat.response.failed` 必须有固定 error enum；客户端可通过 turn 查询终态，不能仅依据 SSE 是否断开判断成功。
- Worker 默认 generation timeout/ Bull lock 为 `120s/180s`，env schema 要求 lock 至少比 timeout 长 30 秒；队列 provider 由
  `ChatResponseQueueModule` 单点注册。

## 6. 分阶段实施顺序

1. ~~新增 ChatTurn schema/migration 与 owner-scoped repository，补唯一键、状态机和 concurrency tests。~~ 已完成；详见 ChatTurn 验收文档。
2. ~~在同一事务新增 `BackgroundJob + chat.response.requested OutboxEvent`，补 crash-before-commit/duplicate enqueue tests。~~ 已完成；见
   `docs/acceptance/phase-6-chat-enqueue-outbox.md`。
3. ~~Worker 先实现 deterministic/mock 生成与 durable assistant commit，再接入真实模型 gate；不改变现有 `/api/chat` 默认 mock/off。~~
   已完成 deterministic durable baseline；真实模型 gate 仍后置。
4. ~~增加 bounded stream/replay 与浏览器断线恢复。~~ 已完成 Redis store、owner-scoped query/controller、Worker 发布、gate-on
   `/api/chat` admission/handoff 和 JSON replay/status consumer；不是长连接 SSE push，首轮和 gate-off 仍保留 legacy。
5. ~~冻结 ChatRunBudget 共享类型合同与生命周期边界。~~ 已完成；详见 ChatRunBudget 合同验收文档。
6. ~~实现 Prisma ledger/reservation/event 结构、Serializable/CAS repository 和 Worker 预留/结算最小接入。~~ 已完成；隔离 PostgreSQL
   并发/crash 证据已补齐，全链路 Agent stage 与 Trace 对账仍待完成。
7. ~~将 migration 部署到隔离验收数据库。~~ 已完成：隔离 PostgreSQL 同机多 client 并发与 post-commit crash/reconciliation 脚本通过。
   Router/Tutor/Retriever/Verifier/FinalResponse stage、Worker 真实模型 gate、usage/cost 和 legacy migration 仍待完成。
8. 进行 Docker、API、可见浏览器和真实模型 controlled smoke；每一步单独提交、推送、合并 main 后复验。

## 7. 本 checkpoint 的明确结论

- 当前 ChatTurn schema/migration 与 `ChatTurn + BackgroundJob + chat.response.requested` 同事务可靠入队已完成；没有触碰 Docker 数据。
- “BackgroundJob + Outbox 同事务”与 Worker durable terminal commit 已实现；gate-on `/api/chat` handoff 和浏览器 JSON status/replay
  已接入，真正 SSE push 尚未实现。
- 当前 Worker 的生成器是 `deterministic-worker-v1`，只证明执行与持久化骨架，不证明真实模型或语义质量。
- 本 checkpoint 已增加 runtime repository、Server turn-bound runner、Worker `WORKER` reservation 和终态对未 dispatch reservation 的释放；真实 PostgreSQL 同机多 client
  并发及子进程 post-commit recovery 已有脚本回执；完整 Trace reconciliation、跨节点/网络故障证据和其他 Agent stage 仍未完成。
