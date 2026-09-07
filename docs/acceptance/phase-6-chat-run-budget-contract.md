# Phase 6 ChatRunBudget 合同验收

更新时间：2026-09-07
状态：共享类型、Prisma schema/migration、owner-scoped repository、deterministic Worker 预留/结算、终态对账、Server turn-bound stage runner 与单 ledger 并发边界已实现；隔离 PostgreSQL crash/recovery 验收已通过。Trace 对账、其他产品 Agent stage 注入和真实模型验收仍未实现。

## 1. 目的

为一个 `ChatTurn` 建立 owner-bound、可审计且有界的 run-level 预算合同。该合同让 Router、Tutor、Retriever、Verifier、FinalResponse
和 Worker 使用同一组 calls、tokens、cost 上限，并把 reservation 的生命周期和 Trace 对账事实限制在安全字段内，避免各节点各算一套
预算或把 prompt/provider 原文写入数据库。

## 2. 本次实现

- 在 `@repo/types` 新增 `chat-run-budget` API contract，并从 package 根入口和子路径导出。
- 定义 policy、ledger、reservation request、reservation、usage 和 bounded ledger event 的 Zod strict schema 与 TypeScript 类型。
- 支持 `ROUTER`、`TUTOR`、`RETRIEVER`、`VERIFIER`、`FINAL_RESPONSE`、`WORKER` stage。
- 支持 `RESERVED -> DISPATCHED -> SETTLED|UNCERTAIN`、经显式 provider/运营证据确认后的 `UNCERTAIN -> SETTLED`，以及未 dispatch 时的
  `RELEASED` 生命周期；settled usage 只能在结算状态出现，UNCERTAIN 不允许自动退款。
- 成本以安全范围内的微 CNY 整数表示；owner、turn、ledger、reservation 绑定字段均为有界 ID。
- event 只允许 bounded ids、枚举、时间和 usage，strict schema 会拒绝未知字段及 prompt、provider response、API key 等原始载荷。
- Prisma 已新增 owner-bound `ChatRunBudget`、`ChatRunBudgetReservation`、`ChatRunBudgetEvent` 及复合外键、索引和生命周期 CHECK；迁移
  不携带 prompt、provider 原文或凭据字段。
- Server repository 使用 Serializable transaction + 条件 `updateMany` 做 reserve、dispatch、settle、release、uncertain、cancel 和终态
  reconcile；enqueue 在创建 ChatTurn/BackgroundJob/Outbox 的同一事务内创建 ledger，Worker 在生成前预留 `WORKER` scope，并在终态释放
  尚未 dispatch 的 reservation。重复 dispatch 不会再次授予执行许可；活跃/排队 turn 禁止提前终态对账；终态竞争失败方复用 durable winner。
- `@repo/agent` 新增与 Server 解耦的 `AgentBudgetPort`/`runBudgetedStage` typed capability：阶段可注入 reserve/dispatch/settle/uncertain/release，
  Provider 异常默认保留 `UNCERTAIN`。该 port 已有单元测试，但 Router/Tutor/Retriever/Verifier/FinalResponse 尚未由产品 composition root 注入。
- Server 新增 `ChatRunBudgetStageRunner`：按 `ownerId + turnId + policyVersion + attempt` 创建不可变 scope，仅暴露阶段运行和预算上限；Worker
  已通过该 capability 执行 `WORKER` reservation，不再在生产路径手写 reserve/dispatch/settle。该接入仍是 deterministic Worker baseline，不等于
  Router/Tutor/Retriever/Verifier/FinalResponse 产品 stage 已接入。

## 3. 验证证据

在分支 `drb/chat-run-budget-contract` 与后续终态对账分支执行：

```text
packages/types: 49 passed, 0 failed
typecheck: passed
Prettier: passed
```

前一切片验证：`apps/server` ChatRunBudget/Worker focused Jest `28/28`、`packages/agent` tests `1703/1703`、agent typecheck、Server/Web build、lint 和
`git diff --check` 均通过。此前隔离 synthetic owner/turn 上执行的真实 PostgreSQL `Promise.all` reservation 竞争为 `fulfilled=1/rejected=1`；
本轮新增的 dispatch 单胜者、终态 guard、terminal winner/replay、reserve/dispatch crash recovery 场景已由 repository/Worker 契约覆盖。
隔离 PostgreSQL 验收脚本 `apps/server/scripts/chat-run-budget-postgres-check.ts` 使用临时 tmpfs 容器通过，输出 `passed=true`、20 个 migration、
8 项 checks（cross-stage-cap、single-dispatch-winner、owner-isolation、cancel-race、active-turn-guard、reserve-crash-terminal-replay、
dispatch-crash-held、recovery-settles-once）；容器已停止且 tmpfs 丢弃。证据等级提升为 `implemented + mock/static validated + real PostgreSQL
isolated recovery`，仍不代表真实 Provider 或生产持续运行。本次未读取 `.env` 凭据、未调用 DeepSeek/Qwen 或其他 Provider，也未清理既有
Docker 容器、卷、Redis 或 MinIO。

### 3.1 Server Stage Runner（2026-09-07）

- 分支 `drb/chat-budget-stage-runner`，基线 `d3fe9827`。Worker -> turn-bound scope -> `runBudgetedStage` -> Repository 是当前实际调用链。
- Prisma `userId/Date` 显式转成共享合同的 `ownerId/ISO time`，经 Zod 校验；scope 不暴露 Repository、释放或带外恢复入口。
- 缺失、取消、owner/turn/policy 不一致的 ledger 拒绝执行；settlement 冲突不发布成功回答；重复 dispatch 的专用错误保持原任务事实。
- StageRunner/Worker/module focused `41/41`、Agent 全量 `1703/1703`、Agent typecheck、Server/Web build 和目标 lint/Prettier 通过。
- 同一隔离脚本增加两项，当前 `10/10`：`stage-runner-shared-cap` 在两个 scope 的 ROUTER/VERIFIER 竞争中只执行一次，
  `usedCalls=1 / heldCalls=0 / usedCostMicros=60`；`stage-runner-duplicate-no-execute` 拒绝已结算阶段的再次执行。
  这里执行的是 synthetic callback，不是 Router/Verifier 模型；原八项检查未删除或改写。

复核命令（仓库根目录；无需读取 `.env`）：

```bash
bun --no-env-file run test --runInBand chat-run-budget-stage-runner.spec.ts chat-response-worker.service.spec.ts chat-turns.module.spec.ts
bun --no-env-file apps/server/scripts/chat-run-budget-postgres-check.ts --run-isolated
```

边界：scope 仅供受信 Server 编排使用，每个 `stage + turn + attempt` 只有一个稳定 reservation key。当前 WORKER 预留上限仍为
原 deterministic 策略；不能直接叠加模型 stage。迁入其他 Agent 时必须划分实际子调用和预算分配，并基于模型 usage 结算。
没有向 Web 暴露预算 HTTP 接口，没有改变模型 gate，也未完成 Trace 对账。本次只创建并停止临时 tmpfs PostgreSQL 容器。

## 4. 明确未完成项

这次已完成合同、数据库结构和最小运行时接入，但不代表已完成生产级全链路预算。后续 ticket 05 切片必须实现：

1. 补多 Worker/跨主机、网络中断和数据库故障恢复证据；现有证据仅覆盖同机多 PrismaClient 竞争和子进程 post-commit 恢复。
2. 扩展 Router/Tutor/Retriever/Verifier/FinalResponse 的 Agent stage 接入，复用 Server turn-bound runner，结算真实 usage/cost，并与 terminal Outbox、Redis stream、Trace 做 bounded reconciliation。
   对 UNCERTAIN 仅允许带外部 usage 证据的显式 `settleUncertain`，不提供无证据释放路径。
3. 产品 Agent 编排仍在 Web；先将执行能力与 Web 配置/HTTP 依赖解耦，迁入 Server composition 后使用上述 scope，不能用只有测试调用的
   wrapper 宣称接入完成。默认仍保持 mock/off，真实模型 Worker 属于 ticket 06，需独立受控证据。

## 5. 复核入口

- 合同源码：`packages/types/src/api/chat-run-budget.ts`
- 合同测试：`packages/types/tests/chat-run-budget.test.mts`
- 设计与实施顺序：[`phase-6-chat-durability-budget-design.md`](phase-6-chat-durability-budget-design.md)
- Agent 矩阵：[`phase-6-agent-runtime-audit.md`](phase-6-agent-runtime-audit.md)
