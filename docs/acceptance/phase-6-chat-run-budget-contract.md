# Phase 6 ChatRunBudget 合同验收

更新时间：2026-09-07
状态：共享类型、Prisma schema/migration、owner-scoped repository、deterministic Worker 预留/结算、终态对账与单 ledger 并发边界已实现；隔离 PostgreSQL crash/recovery 脚本已加入但因 Docker Desktop backend 当前不可用尚未执行。Trace 对账、产品 Agent stage 注入和真实模型验收仍未实现。

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

## 3. 验证证据

在分支 `drb/chat-run-budget-contract` 与后续终态对账分支执行：

```text
packages/types: 49 passed, 0 failed
typecheck: passed
Prettier: passed
```

追加验证：`apps/server` ChatRunBudget/Worker focused Jest `28/28`、`packages/agent` tests `1703/1703`、agent typecheck、Server/Web build、lint 和
`git diff --check` 均通过。此前隔离 synthetic owner/turn 上执行的真实 PostgreSQL `Promise.all` reservation 竞争为 `fulfilled=1/rejected=1`；
本轮新增的 dispatch 单胜者、终态 guard、terminal winner/replay、reserve/dispatch crash recovery 场景已由 repository/Worker 契约覆盖。
隔离 PostgreSQL 验收脚本 `apps/server/scripts/chat-run-budget-postgres-check.ts` 已加入，预期使用临时 tmpfs 容器；本轮 Docker daemon
不可用（`dockerDesktopLinuxEngine` pipe 缺失），因此未宣称该脚本通过。证据等级为 `implemented + mock/static validated`，并保留既有
`implemented + real PostgreSQL single-ledger concurrency` 证据；本次未读取 `.env` 凭据、未调用 DeepSeek/Qwen 或其他 Provider，也未清理
既有 Docker 容器、卷、Redis 或 MinIO。

## 4. 明确未完成项

这次已完成合同、数据库结构和最小运行时接入，但不代表已完成生产级全链路预算。后续 ticket 05 切片必须实现：

1. 恢复 Docker Desktop 后执行隔离脚本，封存跨节点并发、取消释放、dispatch 后 uncertain、重复请求幂等和 crash/recovery 证据；现有
   repository/Worker 契约已覆盖这些边界，但尚缺该次真实数据库脚本回执。
2. 扩展 Router/Tutor/Retriever/Verifier/FinalResponse 的 Agent stage 接入，结算真实 usage/cost，并与 terminal Outbox、Redis stream、Trace 做 bounded reconciliation。
   对 UNCERTAIN 仅允许带外部 usage 证据的显式 `settleUncertain`，不提供无证据释放路径。
3. 补 crash/recovery、跨节点竞争和产品链路回归；默认仍保持 mock/off，真实模型需另有授权和独立 controlled-Live 证据。

## 5. 复核入口

- 合同源码：`packages/types/src/api/chat-run-budget.ts`
- 合同测试：`packages/types/tests/chat-run-budget.test.mts`
- 设计与实施顺序：[`phase-6-chat-durability-budget-design.md`](phase-6-chat-durability-budget-design.md)
- Agent 矩阵：[`phase-6-agent-runtime-audit.md`](phase-6-agent-runtime-audit.md)
