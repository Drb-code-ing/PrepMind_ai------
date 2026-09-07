# PrepMind AI 开发日志

> 2026-09-07 — Ticket 05 Server turn-bound stage runner 原子切片：
>
> 从 `main=d3fe9827` 建立 `drb/chat-budget-stage-runner`。新增 `ChatRunBudgetStageRunner`，由 Server 固定 owner、turn、policy、attempt，
> Worker 实际复用 `@repo/agent` 的 `runBudgetedStage`，移除手写 reserve/dispatch/settle；Prisma 返回值显式映射并校验共享合同。
> 缺账本不再绕过预算生成，settlement 冲突不再被忽略，非法输出先拒绝再结算，重复 dispatch 不改写胜者事实。
>
> Server StageRunner/Worker/module focused `41/41`、Agent 全量 `1703/1703`、Agent typecheck、Server/Web build 和目标 lint/Prettier 通过。
> `bun --no-env-file apps/server/scripts/chat-run-budget-postgres-check.ts --run-isolated` 当前 `10/10`：新增两项验证 synthetic ROUTER/VERIFIER
> stage 共用一个真实 ledger，竞争仅执行一次、成本结算为 60 micros，并拒绝已结算 stage 重复执行。临时 tmpfs 容器已停止；不改项目卷、Redis、MinIO。
> 未查看或输出凭据、未调用 Provider；Next build 自动加载已有 `.env.local`。产品 Agent 尚未迁入 Server，WORKER 仍为 deterministic，
> scope 仅供受信编排使用且每 stage/turn/attempt 一个 reservation。接下来先解耦并迁入 Agent 执行，再分配 stage 预算及接 Trace；细节见合同验收 3.1。

> 2026-09-07 — Ticket 05 隔离 PostgreSQL recovery 证据：
>
> Docker Desktop 恢复后执行 `bun --no-env-file apps/server/scripts/chat-run-budget-postgres-check.ts --run-isolated`，临时 tmpfs PostgreSQL 应用 20 个 migration，同机两个独立 PrismaClient 的跨 stage 上限、single dispatch winner、owner isolation、cancel race、active-turn guard、reserve crash replay、dispatch crash held 和 recovery settle-once 共 8 项检查全部通过（`passed=true`）。临时容器已停止并丢弃 tmpfs；项目容器、卷、Redis、MinIO 未触碰，未读取 `.env` 或调用 Provider。该回执补齐 Ticket 05 的真实数据库并发与子进程 post-commit crash/reconciliation 证据，但不覆盖多 Worker/跨主机/网络中断，也不证明真实模型或生产持续运行。

> 2026-09-07 — Ticket 05 dispatch/recovery 原子切片：
>
> 修正重复 Bull 投递、终态提前对账和终态竞争失败三类生产边界。已 dispatch 的 reservation 不再授予第二次 provider 执行许可；`reconcileTerminal()` 仅接受 `SUCCEEDED/FAILED/CANCELLED` turn，并保留活跃 turn 的 held 预算；并发失败方复用已提交的 durable winner，terminal replay 会再次尝试预算对账。新增 repository/Worker 回归覆盖重复 dispatch、取消竞态、活动 turn guard、terminal winner 和 reserve/dispatch 后崩溃恢复语义。`apps/server` focused Jest `28/28`、`@repo/agent` 全量 `1703/1703`、build、typecheck、lint 和 `git diff --check` 通过。
>
> 新增 `apps/server/scripts/chat-run-budget-postgres-check.ts`，用于临时 tmpfs PostgreSQL 的跨节点竞争与 crash/recovery 验收；本轮 Docker Desktop daemon 不可用（`dockerDesktopLinuxEngine` pipe 缺失），未执行脚本，不影响既有容器/卷/Redis/MinIO，未读取 `.env` 或调用 Provider。证据等级为 `implemented + mock/static validated`，并保留既有真实单 ledger PostgreSQL 并发证据。功能分支待提交、推送、合并 `main` 后复验。

> 2026-09-05 — Ticket 05 真实 PostgreSQL 并发验收切片：
>
> 在现有本地 PostgreSQL（Docker 容器）中创建临时 synthetic user/conversation/turn，使用同一 `maxCalls=1` ledger 并发提交两个不同
> reservation。真实 Serializable/CAS 结果为 `fulfilled=1/rejected=1`，最终 ledger `heldCalls=1/usedCalls=0`；随后仅删除本次 synthetic user
> 级联数据，未触碰既有业务记录、卷、Redis 或 MinIO。该证据证明单 ledger 竞争上限生效，不代表跨节点 crash/recovery、Trace 或真实 Provider usage。

> 2026-09-05 — Ticket 05 Serializable retry 回归切片：
>
> 新增 repository 测试，注入一次 PostgreSQL `P2034` serialization conflict，确认事务重试后 reservation/event 只写入一次且不重复扣账。
> focused Server budget tests `6/6`、build 和 diff check 通过；这是 mock Prisma harness 证据，不等同于真实跨节点并发压测。未调用 Provider、未读取凭据、未触碰 Docker。

> 2026-09-05 — Ticket 05 Agent budget port 原子切片：
>
> 在 `@repo/agent` 增加不依赖 Prisma/Nest 的 `AgentBudgetPort` 与 `runBudgetedStage`，统一阶段的 reserve -> dispatch -> settle 生命周期；dispatch 失败释放，
> Provider/执行异常保留 `UNCERTAIN`，并提供显式 `settleUncertain` 能力供带外部 usage 证据的恢复流程使用。新增 2 个 Bun 单元测试，验证正常结算和异常不退款。
> Agent typecheck、lint 和 focused tests 均通过；本次未调用 Provider、未读取凭据、未触碰 Docker。证据等级为 `implemented + mock/static validated`。
> 当前 port 尚未由产品 composition root 注入 Router/Tutor/Retriever/Verifier/FinalResponse，Trace 对账与真实模型 usage 仍是后续切片。

> 2026-09-05 — Ticket 05 UNCERTAIN recovery 原子切片：
>
> 为已 dispatch 但 Provider 结果未知的预算 reservation 增加 `settleUncertain` 显式恢复入口。该入口要求带外部 usage 证据后才把
> `UNCERTAIN -> SETTLED` 并转移 held/used 计数，重复调用保持幂等；没有无证据释放路径，避免把未知费用误记为零。新增 repository 回归测试，
> 并同步合同与项目状态文档。Server focused budget tests `5/5`、build 和 `git diff --check` 通过；未调用 Provider、未读取凭据、未触碰 Docker 数据。
> 该提交误在当时已切换的 `main` 上完成并已推送为 `0840348e`，后续任务恢复从最新 `main` 建分支、功能分支提交后合并的规范。
> UNCERTAIN recovery 仍需真实 PostgreSQL 并发/crash 证据和产品级运营入口。

> 2026-09-05 — Ticket 05 ChatRunBudget 终态对账与本地数据库验收：
>
> 在 `drb/chat-run-budget-terminal-reconcile` 完成 Worker 成功/不可重试失败后的 terminal reconciliation：只释放仍为 `RESERVED` 的未 dispatch
> reservation，保留 `DISPATCHED/UNCERTAIN`，避免在 Provider 结果未知时伪造退款；同时追加 bounded `RELEASED` events 和 repository/Worker 回归测试。
> 分支提交 `6503f364` 已推送，随后以 `--no-ff` 合并并推送 `main=5fa5a10b`。合并后 Server focused Jest `17/17`、Server build、database tests
> `11/11`、`prisma migrate deploy`（新增 `20260905100000_chat_run_budget`）和 `prisma migrate status`（schema up to date）均通过，`main == origin/main`。
> Docker 仅读取既有容器状态，未清理数据、卷、Redis 或 MinIO；未调用 Provider，未读取或输出凭据。证据等级为 `implemented + mock/static validated`。
> 当前仍未完成 UNCERTAIN recovery、真实 PostgreSQL 并发/crash 证据、Router/Tutor/Retriever/Verifier/FinalResponse ledger 接入和 Trace 对账。

> 2026-09-05 — Ticket 05 ChatRunBudget 共享合同第一切片：
>
> 从已推送 `main=a53b0706` 创建普通分支 `drb/chat-run-budget-contract`，在 `@repo/types` 新增严格的 policy、run-level ledger、stage
> reservation、usage 与 bounded ledger event 合同，并从 package 根入口和子路径导出。合同绑定 owner/turn/ledger/reservation，覆盖
> Router、Tutor、Retriever、Verifier、FinalResponse、Worker，限制微 CNY、token、calls 数值范围，校验 reservation 生命周期和时间顺序，
> 禁止 settled usage 超过预留或 ledger `used + held` 超过 policy；事件拒绝 prompt、provider response、API key 等原始字段。
>
> `packages/types` 全量测试 `49 passed / 0 failed`、typecheck 和 Prettier 通过；本次未读取 `.env`、未调用 DeepSeek/Qwen 或其他 Provider，未
> 触碰 Docker 数据。证据等级为 `implemented + mock/static validated`，不代表 Prisma ledger、Serializable/CAS、跨节点预算 enforcement、
> Worker/Agent 接入、Trace 对账或真实模型结算完成。详见 `docs/acceptance/phase-6-chat-run-budget-contract.md`、更新后的预算设计和 Agent
> runtime audit。功能提交 `28d22f0d` 已推送，随后以 `--no-ff` 合并并推送为 `main=2eb15d50`；merged-main 的 types `49/49`、typecheck、
> `--end-of-line auto` Prettier 和 diff check 均通过，`main == origin/main`。本地 feature branch 已在合并复验后删除；七个用户预修改文件
> 仍未暂存。下一切片实现持久化 reservation/event 与并发服务。

> 2026-09-05 — Ticket 05 ChatRunBudget Prisma 结构第二原子切片：
>
> 在最新 `main=caa1350c` 创建普通分支 `drb/chat-run-budget-ledger`，新增 `ChatRunBudget`、`ChatRunBudgetReservation`、
> `ChatRunBudgetEvent` 三个 owner-bound Prisma 模型、stage/status/event enums、复合 owner 外键、turn 唯一约束和查询索引，并新增
> `20260905100000_chat_run_budget` migration。数据库 CHECK 覆盖非负值、`used + held <= max`、reservation 生命周期/时间顺序、settled
> usage 上限和 cancellation event 的 bounded 语义；没有 prompt/provider 原文或凭据字段。
>
> `packages/database` 测试 `11 passed / 0 failed`、Prisma schema validate/generate 通过；本次未执行 migrate deploy，未触碰现有 Docker
> 数据。Prisma CLI 自动加载了根 `.env` 以解析 schema，但没有输出或读取任何凭据值，也没有调用 Provider。证据等级为
> `implemented + mock/static validated`；runtime repository、Serializable/CAS、Worker/Agent 接入和 Trace 对账仍未完成。下一切片实现
> owner-scoped reservation repository/service。

> 2026-09-05 — Ticket 05 ChatRunBudget runtime baseline：
>
> 从 `main=0cc30e43` 创建普通分支 `drb/chat-run-budget-runtime`。新增 owner-scoped `ChatRunBudgetRepository`，以 Serializable transaction
> 和条件 CAS 实现 reserve、dispatch、settle、release、uncertain、cancel；同一 `ChatTurn + BackgroundJob + Outbox` 入队事务现在会创建
> ledger，Worker 在 deterministic generation 前预留并在成功后结算 `WORKER` scope，失败时保留 uncertain 事实，不伪造退款。
>
> Server focused tests `24/24`、Server build 通过；数据库 migration 未部署到现有 Docker，未执行真实 Provider 调用。证据等级为
> `implemented + mock/static validated`，仍不代表真实 PostgreSQL 跨节点并发、其他 Agent stages、Trace reconciliation 或真实模型
> usage/cost 已完成。功能提交 `14e0b8ee` 已推送，随后以 `--no-ff` 合并并推送为 `main=b2b56200`；merged-main focused `24/24`、Server
> build、database `11/11`、diff check 和 `main == origin/main` 均复验通过。本地 feature branch 已删除；七个用户预修改文件仍未暂存。
> 下一切片在隔离数据库部署 migration 并补并发/crash 回归。

> 2026-09-05 — Docker 冗余容器清理与 Worker readiness 恢复：
>
> 在 `drb/worker-readiness-recovery` 上先做只读归属审计，确认当前规范 Compose project 为 `docker`。精确删除了两个 10 天前
> 已退出的旧 Server 容器 `priceless_yonath`、`elated_wozniak` 和一个已退出的旧 Web 容器 `practical_fermat`；三者均无端口、
> 无挂载，当前 `docker-server-1`、`docker-web-1` 及数据服务未替换。
>
> `docker-worker-1` 修复前连续 healthcheck 失败 300 次，唯一问题是 Audit maintenance queue 保留
> `failed=1 / delayed=1`。失败任务源于一次 Prisma 5 秒 interactive transaction 超时，但后续 maintenance 已成功；旧 readiness
> 仅看 `failed > 0`，因此恢复后仍永久 `degraded`。现在有界读取最多 10 条近期失败任务的安全时间元数据、自行取最新时间，并与
> PostgreSQL
> `lastSucceededAt` 比较：更新成功可以恢复 `ready`，retained failed count 和说明仍保留；更新失败、时间未知、队列不可读/暂停
> 继续降级。`readiness:worker` 与真实 subprocess 回归改用 Bun，关闭 workspace `.ts` import 导致的既有 `ts-node` 入口失败；
> 同步修正上一个本地模式切换任务遗留的两条 Docker gate 旧断言。
>
> 自动化验证：Worker readiness `4 suites / 51 tests`、Docker boundary `4/4`、Server full
> `240 suites / 2262 tests passed`（另有 `3 suites / 30 tests skipped`）、Server build、目标 ESLint/Prettier 和 diff check 通过。
> 候选镜像从干净主线归档叠加本任务实现构建，只替换 Worker；最终 Worker `healthy`、readiness CLI exit `0`、Server
> `/health=200`、Web `/login=200`。PostgreSQL/MinIO 原 volume 保持挂载，没有删除 Bull failure、Redis key、数据库记录或对象。
>
> Compose 使用根 `.env` 注入既有 Worker 配置，但没有查看或输出凭据，没有调用 DeepSeek/Qwen/其他 Provider，费用为 0；没有
> 执行 prune、`down -v`、reset、flush 或 wipe。证据等级为 `implemented + mock/static validated + local Docker runtime
validated`；Worker 仍是 `deterministic-worker-v1`，不构成真实模型证据。详细验收见
> `docs/acceptance/phase-6-worker-readiness-recovery.md`。功能提交 `89e3a341728ff686498382ce168e72279668d06d` 已推送，随后以
> `--no-ff` 合并并推送为 `main=12824029ece8d7ebbea8afa1116acaa01e759957`；merged-main focused `55/55`、Server
> build、Worker `healthy`、CLI exit `0`、Server/Web `200/200` 和 `main == origin/main` 均复验通过。
>
> 2026-09-05 — 本地 Mock/Live 模式切换默认可用：
>
> 在 `drb/ai-mode-switch-defaults` 上恢复 `/agent-trace` 的 AI 模式控件，并把本地 Docker Web 配置改为开箱即用。控件在本地
> runtime 默认可见，只有显式 `AI_DEV_MODE_SWITCH_ENABLED=false` 才关闭；Live 不再因为基础环境保持
> `AI_ENABLE_LIVE_CALLS=false` 或启动时缺少 key 而禁用。选择 Live 后仅在当前 Web 进程内为后续 Chat 请求生成统一 effective
> environment，并传给 Router/Verifier、Tutor、Retriever query rewrite 和 FinalResponse；重启或切回 Mock 后恢复安全默认，
> 不写回 `.env`。本地 Docker 预配置五个 Chat 链 gate，三个 DeepSeek 组件专用 key 可回退到通用 `DEEPSEEK_API_KEY`；显式
> `MODEL_ENABLED=false` 仍然优先，普通 production runtime 也不会暴露该入口。
>
> 自动化验证：模式/Provider focused `22/22`、Chat 组件 config/runtime `52/52`、Web full `542/542`、Server Compose readiness
> `21/21`、Web lint 与 production build 通过。脱敏 Compose 检查确认基础模式仍为 Mock/off、五个 Chat gate ready，且没有向 Web
> 投影 Review/Planner/Organizer 的 server-only secrets。只重建 `web` 容器；headed 浏览器确认 `Mock -> Live -> Mock`，没有提交
> Chat 消息、没有读取或输出凭据、没有调用 DeepSeek/Qwen/其他 Provider，费用为 0。合成账号已退出并精确删除，目标
> `ChatTurn=0 / Outbox=0`；未清理容器、镜像、volume、PostgreSQL、Redis 或 MinIO。证据等级为
> `implemented + mock/static validated + Mock Docker/可见浏览器产品验收`，不代表真实模型质量或 production-used。详细边界见
> `docs/acceptance/phase-6-local-ai-mode-switch.md`。功能提交 `dc538cd3c648c4b31025e6febe6505112db2131e` 已推送，随后以
> `--no-ff` 合并并推送为 `main=6f94123c43c21102324bdef3d4deab77ae78fd73`。merged-main 再次通过 Web `542/542`、
> Server Compose readiness `21/21`、Web lint/build、Server build 和 committed diff check；只从主线重新构建并替换 `web`，
> 可见浏览器复验 `Mock -> Live -> Mock` 后保持 Mock。主线复验创建的合成账号均已退出并精确删除，最终
> `User/ChatTurn/ChatMessage/Trace/BackgroundJob/Outbox=0`；`main == origin/main`，七个用户预修改文件仍未暂存。
>
> 2026-09-05 — ChatTurn 浏览器恢复与 JSON cursor replay ticket 04：
>
> 在 `drb/chat-turn-browser-replay` 上把 ticket 03 的 authenticated `202` handoff 接入浏览器恢复链路。新增 Dexie v10
> `chatTurnRecoveries` owner/conversation/turn scoped 缓存、严格 status/events response adapter、JSON cursor replay/polling、
> bounded backoff、Redis unavailable/cursor expired 的 status-only 降级、identity/conversation/token Abort fence，以及按 PostgreSQL
> durable absolute order 原位替换 handoff placeholder 的终态合并。恢复期间隔离旧 snapshot sync、hydration 和重叠 submit，避免跨会话
> recovery 互相阻塞或造成 `409` order 漂移；Redis Chat Stream client 另加默认 `CHAT_STREAM_OPERATION_TIMEOUT_MS=1500` 有界等待。
>
> 分支验证：Web recovery focused `30/30`、Web full `538/538`、Web ESLint、Next production build/TypeScript、Server stream/config
> focused `94/94` 和 Server build 通过。Server full Jest 为 `2257 passed / 1 failed / 30 skipped`，唯一失败是既有 worker-readiness
> direct ts-node CLI 在入口编译阶段返回 1 而历史断言期望 2；不属于 ticket 04，未扩大范围改写。Mock Docker 与 headed 浏览器确认
> Worker 延迟刷新保留 USER/placeholder、Redis 暂停后进入 status-only、恢复后由 PostgreSQL 最终回答替换，以及下一轮 enqueue
> 正常；当前仍是 JSON polling，不是长连接 BFF SSE push。
>
> 验收期间保持 `AI_PROVIDER_MODE=mock`、`AI_ENABLE_LIVE_CALLS=false`、Agent gates=false，仅临时启用 ChatTurn bridge；未读取
> Provider credential、未调用 DeepSeek/Qwen/其他 Provider，费用为 0。合成账号 `cmtnr0irv0000my01lopx81py` 及其 User、Conversation、
> ChatMessage、ChatTurn、BackgroundJob、目标 Outbox、Bull job、Stream key 和浏览器 owner-scoped 数据已精确清理为 0；未执行
> `FLUSHDB/FLUSHALL`、数据库 reset、volume 删除、MinIO wipe 或 Docker prune。证据等级为 `implemented + mock/static validated +
Mock Docker/可见浏览器产品验收`；真实模型 Worker、全链路 ChatRunBudget ledger、SSE push 和 production-used 仍未完成。功能提交
> `711347470b297a30594239b7dcaec00097d988dd` 已推送到 `origin/drb/chat-turn-browser-replay`，随后以 `--no-ff` 合并并推送为
> `main=94677fa1aff9101e1e910a0887ed293d9159e19e`；merged-main recovery `24/24`、Server stream/config `94/94`、Docker/API
> health 和 `main == origin/main` 均复验通过。七个用户预修改文件仍未暂存。

> 2026-09-05 — ChatTurn `/api/chat` product bridge ticket 03：
>
> 从已推送 `main=9aa0acde` 的普通分支 `drb/chat-turn-api-bridge` 接通 authenticated `/api/chat` 的 durable
> admission。默认 gate `PREPMIND_CHAT_TURN_BRIDGE_ENABLED=false`；gate-on 且 conversation ready 时，Web BFF 先调用
> owner-bound、append-only 的 `POST /chat-messages/prepare`，再以 bounded ids/hash/request/budget facts 调用
> `POST /chat-turns`，并通过 AI SDK data stream 返回 `prepmind-chat-turn-handoff-v1` annotation 和 `202`。首轮无
> conversation id 或 gate-off 保留旧同步路径；无效身份/窗口、prepare/enqueue 失败均 fail-closed，不静默回退 Provider。
>
> prepare 使用 Serializable transaction；只对 `P2034`/PostgreSQL `40001` 有限重试，`P2002` 直接 `409`。长会话只取
> `1000 messages / 2M chars` 的连续尾窗并保留绝对 order，非零尾窗必须有 durable predecessor；数据库已有新版本时拒绝
> 过期客户端覆盖。handoff assistant 不写 Dexie/旧 snapshot sync，并阻止 pending turn 期间的重叠提交；在 ticket 04 自动恢复
> 尚未接入前，提示用户稍后刷新页面查看结果，不再暗示页面会自行解锁。
>
> 分支验证：Web `513/513`、Server affected `42/42`、ChatMessages `19/19`、Types `46/46`、Web production build/TypeScript
> 与 Server build 通过；交互修复后的 bridge/provider focused Web `37/37`、目标 ESLint/Prettier、Compose config、Markdown
> 结构/链接和 diff check 也通过。最终复审发现等待占位无法自行解除的交互误导，已改为明确刷新提示并补回归；修复后无未关闭
> blocker/P1/P2。Docker 以 Mock/live=false、全部模型 gate=false、仅 bridge=true 启动，
> server/worker healthy。保留的 PostgreSQL volume 缺少 `20260825090000_chat_turn_state_machine`，首次验收失败后只执行
> `prisma migrate deploy` 补迁移，没有 reset/删表/清卷；成功重跑得到唯一 Turn/Job terminal success、requested/completed
> Outbox success 和 Redis `started/delta/completed` 回放。
>
> 可见浏览器确认首轮兼容、第二轮 handoff、重叠提交阻止和刷新后 PostgreSQL 权威回答恢复。一个合成账号及其级联数据在验收后
> 精确清理为 0；浏览器窗口保留。未查看凭据值、未调用 DeepSeek/Qwen/其他 Provider、未产生真实模型费用，也未清理 Docker
> 容器、镜像、cache、volume、Redis 或 MinIO。证据等级为 `implemented + mock/static validated + Mock 产品链路验收`；浏览器
> status/SSE/replay、全链路 ledger 与真实模型 Worker 仍待 ticket 04-06。详细记录见
> `docs/acceptance/phase-6-chat-turn-api-bridge.md`。功能提交
> `5832b379c2b4091dd5202f11937e9eff8aa62ca8` 已推送到 `origin/drb/chat-turn-api-bridge`，随后以 `--no-ff`
> 合并并推送为 `main=dfdd35adb69be5ceeb5ea6c3fe39c71c0b855762`，`main == origin/main`。merged-main 最小复验再次确认
> `server/worker` healthy、Server `/health=200`、Web `/login=200`，可见浏览器正常呈现登录页；默认恢复
> Mock/live-off、全部 Agent gate=false、bridge=false。用户既有 7 个 dirty 文件保持未暂存、未进入提交。
>
> 2026-09-04 — ChatTurn Web enqueue adapter ticket 02：
>
> 从最新已推送 `main=ef74c4ac` 创建普通分支 `drb/chat-turn-web-enqueue-adapter`。新增 Web typed adapter，将 authenticated
> owner 的已持久化 `StoredMessage[]` 规范化为 `chat-turn-input-v1` SHA-256，并从 owner、conversation、input hash、message ids
> 和 budget version 派生稳定 `web-chat-turn-v1` 幂等 id。请求最终经过共享 strict schema，只发送 conversation/request/hash/message
> ids/budget 五类 bounded facts；正文只参与浏览器内存 hash，不进入 HTTP body。
>
> `prepareChatTurnSubmission` 在 conversation 未就绪或消息未确认持久化时显式返回现有 snapshot-sync 兼容路径；不会在 enqueue
> 失败后静默 fallback。API client 新增 expected-status 检查，ChatTurn adapter 只接受 `202` 和 strict safe response。独立 Standards/Spec
> review 发现 fetch/response body 两个阶段的 AbortError 分类与 retry 排除边界不完整；现统一映射为 `REQUEST_ABORTED`，确保用户取消、登出或会话切换不会被离线策略重试。
> 只有 network、`408/425/429` 和 `5xx` 可在同 owner/session 下复用稳定 request，4xx/schema/owner/conflict/local errors 均 terminal。
>
> 功能分支 focused API client + adapter `9/9`、Web full tests `499/499`、完整 Web ESLint、Next production build/TypeScript、
> targeted Prettier 和 `git diff --check` 通过；修复后的两路独立只读复审均无 blocker/P1/P2。功能提交
> `27ee08df` 已推送，随后以 `--no-ff` 合并为 `main=623a7dfa` 并推送。merged-main 再次通过 focused `9/9`、Web full
> `499/499`、完整 Web ESLint、Next production build/TypeScript、targeted Prettier、Markdown links 与 commit diff check。
> 证据等级为 `implemented` + `mock/static validated`。
> 本 ticket 没有改 `/api/chat`、`ChatRuntimeProvider`、BullMQ/Worker/Redis replay 或现有 `/chat-messages/sync`；没有调用 Provider，
> 没有启动/清理 Docker/API/browser 或写业务数据。用户既有 ReviewAgent、WrongQuestionOrganizer 和 triage-labels dirty 文件未暂存、
> 未提交。详细验收见 `docs/acceptance/phase-6-chat-turn-web-enqueue-adapter.md`。
>
> 2026-09-04 — ChatTurn Enqueue API ticket 01：
>
> 在 `drb/chat-turn-enqueue-api` 上完成认证 `POST /chat-turns`。新增 `@repo/types` strict Zod 请求/响应合同（bounded
> id、唯一 message ids、SHA-256 input hash、状态/时间约束），controller 从 JWT 取得 owner，只委托既有
> `ChatTurnEnqueueService`，以 `202 Accepted` 返回不含正文、prompt、hash、Outbox payload 或凭据的安全 turn/job projection。
> `(userId, clientRequestId)` 的幂等、冲突和跨 owner 行为继续由既有 durable service 掌握；没有新增事务、队列或 Provider 调用。
>
> 验证：ChatTurn `10 suites / 52 tests`、controller + Swagger `13/13`、`@repo/types` `44 tests`、types typecheck、Server build、
> 目标 ESLint/Prettier 和 `git diff --check` 通过。Server 全量 Jest 为 `237 passed / 2 failed / 3 skipped` suites；两个失败是既有
> readiness CLI 退出码断言和本地 `127.0.0.1:5433` integration 环境问题，另有 `@repo/types lint` 的既有 package-local eslint
> 可执行文件缺失。同步更新 ticket、project-status、Agent audit、data-flow、acceptance-checklist 和本 acceptance 文档。
> 本轮未读取 `.env`、未调用 DeepSeek/Qwen/其他 Provider、未启动或清理 Docker/PostgreSQL/Redis/MinIO，证据等级为
> `implemented` + `mock/static validated`；Web adapter、`/api/chat` bridge、真实模型 Worker 和浏览器验收仍未完成。
>
> 分支收口：从 `main=a8a0697a0087e68ae3369dd690bcccfa6b6a4c30` 创建 `drb/chat-turn-enqueue-api`，功能提交
> `4511d3ee9b2602b9f9b8e55d8c04c4a09c229a40` 已推送；随后以 `--no-ff` 合并并推送 `main=582f2aefc922edee9f31475424e09cbe93c83e42`。
> merged-main controller + Swagger `13/13`、types `44/44` + typecheck、Server build、目标 ESLint、CRLF-aware Prettier 和
> `git diff --check` 再次通过，`main == origin/main`。未启动 Docker/API/browser；用户既有 dirty 文件保持未暂存、未提交。

> 2026-09-02 — Phase 6 Chat Stream contract 与 bounded Redis replay：
>
> 从已推送 `main=fd133325` 新开普通 Git 分支 `drb/phase-6-chat-stream-replay`，未使用 worktree；保留用户预修改和既有 dirty 文件，
> 未读取根 `.env`、未调用 DeepSeek/Qwen、未清理 Docker/PostgreSQL/Redis/MinIO。新增 `chat-turn-stream-v1` strict Zod 合同，定义
> `response_started`、`text_delta`、`citations`、`response_completed`、`response_failed`、cursor、状态恢复和固定错误码。
>
> `ChatStreamStore` 复用既有 BullMQ Redis client，用 owner+turn SHA-256 key 和 Lua 原子脚本完成 sequence、event id/hash 幂等、
> terminal fence、事件数/字节数 trim 与 TTL；Redis 故障、坏 entry 和过期 cursor 均返回 bounded disposition，不影响 PostgreSQL
> durable 状态。新增 owner-bound `GET /chat-turns/:turnId` 与 `GET /chat-turns/:turnId/events`，状态接口校验 response owner、conversation
> 和 assistant role。Worker 在 claim 后发布 started/delta，durable success/failure transaction 后发布唯一 terminal event；terminal 重投
> 不再调用 generator。
>
> 当前 generator 仍是 `deterministic-worker-v1`，`/api/chat` 尚未 turn-backed，浏览器未接入 SSE/replay；因此证据等级仅为
> `implemented` + `mock/static validated`，不代表真实模型、产品断线恢复或生产 SLA。默认 stream bound 为
> `256 events / 512 KiB / 24h`，配置由 `CHAT_STREAM_MAX_EVENTS/MAX_BYTES/TTL_SECONDS` 约束。
>
> 验证：Chat Stream expanded `5 suites / 110 tests`、chat-turns `10 suites / 49 tests`、`@repo/types` `43 tests`、Swagger `8 tests`、
> Server build、目标 ESLint、CRLF-aware Prettier 和本机 Redis 唯一 key smoke 均通过；Redis smoke 已精确删除测试 key。功能提交
> `fc6f5fb8` 已推送，并以 `--no-ff` 合并、推送为 `main=87d26a7e`。merged-main 再次通过 chat-turns `49/49`、Swagger
> `8/8`、Types `43/43`、typecheck、Server build、目标 ESLint、CRLF-aware Prettier、`git diff --check` 和远程 parity。
> 功能实现时 Docker pipe 不可连接；收口时 daemon 已恢复但项目 Compose 服务仍停止，因此没有进行 Docker/API/可见浏览器验收，
> 没有读取 `.env`、调用 Provider 或写业务数据。用户既有六个 dirty 文件均保持未暂存、未提交。

> 2026-08-31 - 文档入口分层整理：
>
> 将 `AGENTS.md` 从重复的阶段回执改为启动必读规则，集中说明证据等级、Git 分支/合并流程、Docker 与凭据安全、工具选择、
> Agent 权限边界和文档同步要求。新增 `docs/project-status.md` 作为项目级短快照，避免把历史日志误读为当前进度。
>
> 将 GitHub 用 `README.md` 重写为项目介绍、能力/架构、快速启动、模型 gate、验证命令和路线入口；将 `docs/dev-start.md` 与
> `docs/roadmap.md` 改为当前可执行的短版，原有长篇历史分别保留在 `docs/archive/dev-start-history.md` 和
> `docs/archive/roadmap-history.md`。`CLAUDE.md` 改为兼容指针，`phase-6-agent-runtime-audit.md`、
> `docs/acceptance-checklist.md`、`docs/data-flow.md` 增加当前入口提示。
>
> 本次只改文档，没有读取 `.env`、调用 Provider、启动/清理 Docker 或修改用户预先修改的三个 WrongQuestionOrganizer 文件。
> Markdown 链接/标题/代码块、敏感值扫描和 `git diff --check` 已通过；新版文档的 Prettier 检查也已通过。功能提交
> `6fc0238c` 已推送，并以 `--no-ff` 合并、推送为 `main=57b09f9d`；合并后链接、代码块、diff check 与
> `main == origin/main` parity 再次通过。工作区仅保留三个用户预先修改且未暂存的 WrongQuestionOrganizer 文件。

> 2026-08-28 — Phase 6 Chat Response Worker durable baseline：
>
> 从已推送 `main=f26634f0` 新开普通 Git 分支 `drb/phase-6-chat-response-worker`，未使用 worktree，且保留三个用户预先修改的
> `wrong-question-organizer` 文件不提交。将已落库的 `chat.response.requested` Outbox 事件接到固定 BullMQ job：新增严格
> requested/completed/failed Zod payload、Outbox requested bridge、Bull add-race 恢复和 BackgroundJob link CAS；只有
> `SERVER_ROLE=worker|both` 注册 `ChatResponseProcessor`。
>
> Worker 重新按 owner/routing facts 加载输入，以 Serializable 事务 claim Turn/BackgroundJob，支持有限 serialization retry、
> AbortSignal/有界超时和 retryable/terminal failure 分类。成功在同一事务提交 assistant message、`ChatTurn=SUCCEEDED`、
> `BackgroundJob=SUCCEEDED` 与 `chat.response.completed` Outbox；终态失败同样提交 `ChatTurn/BackgroundJob=FAILED` 与
> `chat.response.failed` Outbox。重复消费、不同 Bull job、CAS 丢失、取消对账和 payload 额外字段均 fail-closed。
>
> 当前 generator 明确为 `deterministic-worker-v1`，只验证执行/持久化骨架，不代表真实模型；未读取根 `.env`、未调用 DeepSeek/Qwen，
> 未改变 `/api/chat` 默认 mock/off。功能分支初始 focused `6 suites / 42 tests`，加固后最终为 `9 suites / 137 tests`；Server build、目标 ESLint/Prettier/diff check 通过。
> Server 全量 Jest 仍只有既有 worker-readiness 退出码断言（期望 `2`、实际 `1`）和本地 `127.0.0.1:5433` 不可达 integration 失败；
> 当前统计为 `234 passed / 2 failed / 3 skipped` suites（`2228 passed / 2 failed / 30 skipped` tests）。
> Docker/Redis/MinIO 数据未清理。详细验收见 `docs/acceptance/phase-6-chat-response-worker.md`；Replay、`/api/chat` turn-backed 切换、
> 全链路 budget ledger 与真实模型 Worker 仍是后续任务。

> 2026-08-28 — Chat Response Worker 边界加固：
>
> 独立复审发现 Outbox dispatcher 可能在 Worker 已将 Turn/BackgroundJob claim 为 `ACTIVE` 后才重试请求事件；现在该路径
> 会验证同 id Bull 记录，缺失时以可重试 handler failure fail-closed，避免无 lease 重置造成并发重复生成。抽取
> `ChatResponseQueueModule` 作为 chat response 队列唯一注册点，消除 Outbox/ChatTurns 双注册。新增统一 worker 配置解析，
> 并在 env schema/Compose 强制 `lockDuration >= generationTimeout + 30s`（默认 `180s/120s`）。
>
> 加固后 focused `9 suites / 137 tests`、Server build、目标 ESLint/Prettier/diff check 通过；全量 Server Jest 为
> `234 passed / 2 failed / 3 skipped` suites（`2228 passed / 2 failed / 30 skipped` tests），仍只有既有 worker-readiness
> 退出码断言和本地 PostgreSQL integration 两个环境/历史失败。未读取根
> `.env`、未调用 Provider、未启动或清理 Docker/Redis/MinIO；合并 main 与合并后复验待本任务末节回填。

> 2026-08-28 — Phase 6 Chat 可靠入队边界：
>
> 从已推送 `main=82b693e0` 新开普通 Git 分支 `drb/phase-6-chat-enqueue-outbox`，未使用 worktree，且保留三个用户预先修改的
> `wrong-question-organizer` 文件不提交。新增 `ChatTurnEnqueueService`，在同一 `Serializable` 事务中按
> `ChatTurn(QUEUED) -> BackgroundJob(QUEUED) -> OutboxEvent(chat.response.requested)` 顺序写入；Job/Outbox 任一失败整体回滚。
> 新增 caller-owned repository/job transaction helpers、`CHAT_RESPONSE` resource type、固定幂等键和 bounded 四字段 outbox payload。
> `chat.response.requested` 暂不注册执行 handler，防止在 Worker 合同尚未完成时误消费事件。重复请求返回既有三件事实，同 owner 冲突、跨 owner、孤立配对、
> P2034/40001 重试均有回归覆盖。
>
> enqueue focused `8/8`，handler/repository/background-job 回归 `15/15` 与 `32/32` 通过，Server build、Prettier 和 diff check 通过。
> 全量 Server Jest 另有两个环境/历史失败：worker readiness CLI 退出码断言（实际 `1`、期望 `2`）和本地 `127.0.0.1:5433` 不可达的
> operator-audit integration；未将其归因或掩盖为本任务问题。全程未读取 `.env`、未调用 Provider、未启动或清理 Docker、未写业务数据。
> 本任务只完成可靠入队，不包含 Worker、Replay、`/api/chat` 切换、真实模型或完整断线恢复。详见
> `docs/acceptance/phase-6-chat-enqueue-outbox.md`。

> 2026-08-25 — Phase 6 ChatTurn 状态机与 owner-scoped repository：
>
> 从 `main=af1e385a` 新开普通 Git 分支，未使用 worktree。新增 `ChatTurnStatus`、固定 `ChatTurnErrorCode`、ChatTurn 表和迁移，
> 以 `(userId, clientRequestId)` 实现幂等，以 `(conversationId, userId)` 绑定会话 owner，并以 response message 的 owner/会话/角色校验
> 保护 durable response。Repository 使用 Serializable enqueue 重试、owner-scoped 查询和 expected-state CAS，覆盖 queued/active/
> succeeded/failed/cancelled 合法路径、竞争丢失、重复终态、跨 owner 与输入不一致。
>
> focused repository `10/10`、database schema/migration `9/9`、Server build、database typecheck/test、Prisma validate/generate 和
> `git diff --check` 通过。没有启动 Docker、没有读取 Provider credential、没有创建 BackgroundJob/Outbox、没有接入 Worker、Replay、
> `/api/chat` 或真实模型；产品仍不能宣称断线可恢复或任务不丢失。下一步是 BackgroundJob + `chat.response.requested` Outbox 同事务。
>
> 功能提交 `1ce14fc9` 已推送，并以 `--no-ff` 首次合并、推送为 `main=abca94ab`。merged-main repository `10/10`、database
> `9/9`、Server build、targeted ESLint、Prisma validate 与 commit diff check 再次通过；三个用户 dirty 文件保持未提交。

> 2026-08-19 — Phase 6 Agent 运行时总审计启动：
>
> 新建 `docs/acceptance/phase-6-agent-runtime-audit.md`，盘点 11 个 graph Agent 与 ConversationSummary 支持子系统，区分
> deterministic authority、模型增强、gate、预算、权限、通信、Trace 和证据等级。审计确认产品 `/api/chat` 与
> `packages/agent/src/graph` descriptor 不是同一执行器；Tool-Using Orchestrator 仍未实现；Review/Planner 缺少 HTTP
> AbortSignal；Chat 断连持久化和全链路预算 ledger 仍有待决策。当前只完成 inventory checkpoint，不能宣称 Phase 6 Agent
> 架构完成，也不能提前写面试博客。用户预先修改的三个 WrongQuestionOrganizer 文件未触碰。

> 2026-08-19 — Phase 6 Agent 审计 Task 1：Review/Planner 请求取消与 fail-safe：
>
> `ReviewAgentController` 现在监听 HTTP `aborted` 事件，将同一 `AbortSignal` 传入 Review 与 Planner candidate；请求完成后移除
> listener。Service 侧新增两个 candidate runner 的 deterministic 外层 fallback，意外 runtime throw 不再穿透 HTTP，observation
> 保留 bounded `fallback_runtime_error`。controller/service 回归共 `13/13`，Server build 与 diff check 通过。该修复只改变
> 取消和异常边界，不改变业务事实或写权限。

> 2026-08-19 — Phase 6 Agent 审计 Task 2：治理 catalog 与产品执行契约：
>
> `createAgentGraph()` 保留原有 11 节点兼容字段，同时新增 `executionAuthority=catalog_only`、产品 Web/Nest 组合层权威、
> 6 条 typed communication edge、每个 Agent 的模型模式与领域写权限，以及仅处于 planned 状态的
> `ToolUsingOrchestrator`。因此 graph 不再暗示自己执行整条产品链，也没有伪造统一 budget/owner/terminal enforcement。
> Graph focused `3/3`、`1197 expect()` 与 Agent typecheck 通过。

> 2026-08-19 — Phase 6 Agent 审计 Task 3：Chat durability/budget 设计 checkpoint：
>
> 现有 `/api/chat` 的模型生成在 Web 进程内完成，回答落库依赖浏览器后续完整 snapshot sync；Trace 是 best-effort，不能承担 durable
> answer authority。新增设计文档明确后续应由 Server 同事务创建 `ChatTurn + BackgroundJob + chat.response.requested OutboxEvent`，
> Worker 运行 owner-bound chain，并以 `chat.response.completed/failed` Outbox 和 turn replay 收口；BackgroundJob 与 Outbox 不能分开写。
> 同时定义 run-level budget ledger、scope reservation、幂等和不保存 provider 原文的边界。本 checkpoint 未修改 schema、Docker、业务数据，
> 不能宣称当前 Chat 已具备断线恢复。

> 2026-08-19 — Phase 6.9.8 真实模型产品运行时打通：
>
> `/api/chat` 首次 Live 启动暴露两类配置错误：server Compose 丢弃根 `DEEPSEEK_API_KEY`，Retriever/FinalResponse 又要求
> 重复配置组件专用 key。现在显式组件 key 保持最高优先级，本地 Docker 缺省时可回退到根 DeepSeek key；服务 allowlist、
> gate、timeout 和默认关闭边界不变。
>
> 修复后使用一次性合成账号完成真实 DeepSeek 请求，得到 `status=200 / mode=live / trace=true`，回答为模型生成的中文
> 幂等性解释。账号随后精确删除（`DELETE 1`）。独立复审后补齐“非法非空组件 key 必须 fail-closed、不得借 fallback
> 掩盖配置错误”的边界。Web `491/491`、Server Compose 边界 `25/25`、Compose quiet config、
> lint、生产 build 与 diff check 通过。验收后只重建 server/web 恢复 Mock 和全部相关 gate=false；没有清理 Docker 卷、
> 数据库、Redis 或 MinIO。该 smoke 证明真实模型产品链路可用，不替代完整语义、billing 或 SLA 评测。详见
> `docs/acceptance/phase-6-9-8-real-model-runtime-usability.md`。
>
> 功能提交 `be390e07` 已推送并以 `--no-ff` 合并、推送为 `main=b6df0150`。合并后构建首次命中已知 Docker Desktop
> Bake shared-key 异常，按手册仅在当前进程设置 `COMPOSE_BAKE=false` 并分开构建 server/web；没有清 cache 或卷。
> merged-main Live smoke 再次得到 `200/live/trace=true/non-empty`。首次清理命令因 PowerShell/psql 引号失败，随后使用
> stdin 精确删除同一账号，结果 `DELETE 1 / remaining=0`。最终 server/web 已恢复 Mock、live=false 和全部当前 Agent
> gate=false，server healthy。

> 2026-08-19 — Phase 6.9.8 SR6 Docker/API/Trace/可见浏览器功能验收完成：
>
> 从 `main=a1663ecf` 新开普通分支，未使用 worktree。Compose 静态配置通过；在不清理 Docker 数据的前提下启动
> PostgreSQL、Redis、MinIO、server、worker、web、admin。首次产品验收发现数据库卷缺少已提交的
> `20260805090000_realtime_agent_trace_lifecycle` 迁移，导致 `/api/chat` 仍能返回 Mock 流，但 Trace best-effort 写入失败、
> `/agent-traces` 查询 500。容器内执行标准 `prisma migrate deploy` 后复验恢复：Chat `200`、Mock、`traceRecorded=true`，
> Trace 为 `completed/route=chat/provider=mock/qualityAuthority=none`。
>
> 可见浏览器完成登录、Chat Mock 流式回答和 Agent Trace 调试台验收，并在 `390x844` 移动宽度检查无重叠；窗口保持打开。
> 本轮精确删除 7 个 `sr6-*` 合成账号及级联记录；未执行 `down -v`、prune、reset、flush 或 MinIO wipe。没有读取 Provider
> credential、真实模型调用或新的 semantic/billing/SLA authority。完整证据见
> `docs/acceptance/phase-6-9-8-sr6-docker-api-trace-visible-browser.md`。

> 独立文档审查随后修正了迁移命令的 credential 边界（改为目标 server 容器内 migrate deploy），并补入可复核的 Compose、
> migration status、health、Chat/Trace 输出与合并后复验记录。运行时复验在合并后的 `main` 完成；最终 `main` 与
> `origin/main` 一致；工作树仅保留
> 用户预先留下的 3 个 `wrong-question-organizer` 未提交修改。

> 2026-08-18 — Phase 6.9.8 Retriever/FinalResponse partial closure（zero-provider）完成：
>
> 用户明确降低当前质量门后，停止继续复制 V13 Provider runner。新增只读 closure CLI，先后两次运行 V12 strict validator，
> 中间校验固定 runId、controlled-Live authority、report logical SHA、artifact physical SHA 与 exact partial counts；V12
> marker/journal/report/artifact/tag/authorization 均不改写。
>
> closure 输出 `partial_completion_closed / retriever_final_response_v12_retrospective_transport_completion_authority`，
> planned/started/succeeded/response/usage/deferred/failed=`24/5/4/5/4/19/1`、guards=`8/8/0`。本进程
> Provider/credential/formal evidence/business/V12 mutation writes=`0/0/0/0/0`。质量 authority 仍为 `none`，semantic
> 仍 `not_established`，完整 token/cost 仍为 `null`；这是追溯式 transport completion，不是新 Live、完整语义、billing、
> 产品或 SLA 证据。focused gate+closure 为 `6/6`（`25 expect()`）。详见
> V10/V11/V12 compatibility + partial 为 `38/38`（`410 expect()`），Agent full 为 `1699/1699`
> （`25988 expect()`，`210 files`）；typecheck/lint/Prettier/diff check 与 V12 sealed validator 均通过。详见
> `docs/acceptance/phase-6-9-8-retriever-final-response-partial-quality-closure-zero-provider.md`。

> 2026-08-18 — Phase 6.9.8 Retriever/FinalResponse partial quality gate（zero-provider）实现：
>
> 为降低 V12 首个真实 candidate 合同失败造成的全链路阻塞，新增独立
> `phase-6.9.8-retriever-final-response-partial-quality-gate-v1` 投影。它绑定 V12 base report canonical SHA，记录
> started/succeeded/responsesObserved/usageVerified/deferred/failed 计数和 bounded failure reason；8/8 guard、安全失败为
> 0、存在 response 进展且失败均有 bounded reason 时满足算法条件；projector 自身始终保持 `authority=none`。
> 生产追溯式 authority 只能由 closure 绑定 exact V12 sealed artifact 后授予；
> reviewed Mock/zero-provider 明确保持
> `partial_gate_failed / synthetic_authority`。
>
> partial gate 的 `semantic.status=not_established`、`qualityAuthority=none`，budget 的 input/output/cost 固定为 `null`，
> `rawDataRetained=false`；因此不伪造 Retriever/FinalResponse 语义、billing、产品或 SLA authority，也不改写 V12
> report/journal/artifact/tag。新增 focused synthetic 回归 `1/1`（`13 expect()`）；Provider/credential/formal
> evidence/business writes=`0/0/0/0`，未读根 `.env`，未启动 Docker/API/browser，未执行 V12 重跑。验收见
> `docs/acceptance/phase-6-9-8-retriever-final-response-partial-quality-gate-zero-provider.md`。

> 2026-08-17 — Phase 6.9.8 SR5 V12 local-rejection postmortem（zero-provider）完成：
>
> 从 `main=93250de2` 新开普通分支 `drb/phase-6-9-8-sr5-v12-local-rejection-postmortem`。Task9 将旧 `baseInvalid`
> 拆成七类 fixed enum，并冻结优先级：invocation、adapter state、adapter wire、provenance、attempted、trace、candidate not
> applied。既有 `failureReason`、adapter category/stage 和历史 evidence 兼容性不变。
>
> `candidate_not_applied` 可选择性携带已有 strict bounded sidecar，只有 enum、bucket、shape fingerprint 与
> `rawDataRetained=false`。三种真实 candidate-local rejection `rewrite_safety_invalid / rewrite_unchanged /
protected_terms_drift` 已通过 synthetic fetch、candidate、runner、journal/report/artifact 与 validator；raw sentinel 不进入
> Error 或 durable evidence。成功、not-started、非 rewrite lane 和其他 boundary 均拒绝该 sidecar。
>
> 新增 focused `13/13`（`45 expect()`），兼容组 `36/36`（`402 expect()`）；Agent full `1693/1693`
> （`25960 expect()`，`208 files`），typecheck/lint/Prettier/diff check 通过。历史 V12 bundle 只读 validator 仍为
> `ok=true`，journal=`67`、final event=`evidence_published`，logical/physical SHA 未变化。
>
> Provider/credential/formal evidence/business writes=`0/0/0/0`；未读根 `.env`，未操作 Docker/API/browser，未写
> Trace/BackgroundJob/Outbox，`qualityAuthority=none`。本任务不反推 V12 根因，不创建新 tag 或执行 Live；后续真实质量门
> 必须使用新 lineage/tag/data-boundary/exact authorization。验收见
> `docs/acceptance/phase-6-9-8-retriever-final-response-schema-recovery-sr5-v12-local-rejection-postmortem-zero-provider.md`。

> 2026-08-17 — Phase 6.9.8 SR5 V12 controlled-Live 已失败封存：
>
> 唯一 run `49429392-857d-4635-80cc-0bca317cf9ff` 在 source/tag/object=
> `550bc864...dff4 / phase-...-live-v12-approved / 62d5d2d6...08ec` 上完成 runtime seal。direct-host/source admission
> 与 `8/8` zero-call guards 通过；credential reads=`3`，Provider calls=`5`（DeepSeek `2`、Qwen `3`），业务写入=`0`。
>
> `rewrite_01` 的 original Qwen、DeepSeek candidate、candidate Qwen 全部成功；`rewrite_02` original Qwen 也成功。第二个
> DeepSeek candidate 已收到 response，但在 Task9 typed verification/application 边界以
> `runtime_contract_invalid / adapterFailureCategory=unknown / stage=null / wire=1/1/1/0` 失败。现有投影把 candidate 未应用、
> provenance/trace、V7 state/counter 与 invocation mismatch 合并；candidate 未应用内部又有 safety scan、unchanged、
> protected-terms drift。封存证据不能选择其中一项。breaker 后其余 `19` 槽未启动。
>
> 终态 `schema_recovery_sr5_branch_quality_gate_failed / qualityAuthority=none`；validator=`ok=true`，journal `67` 条并以
> `evidence_published` 收口，report logical SHA=`86f4e84e...3654`，artifact SHA=`817bc897...e81`，无 recovery claim。
> V12 授权已消费且禁止重跑/恢复/追加 Provider 探测。未启动 Docker/API/browser，未写 Trace/BackgroundJob/Outbox/业务数据；
> 下一步仅为独立 zero-provider Task9/base-invalid/local-rejection diagnostic postmortem。验收见
> `docs/acceptance/phase-6-9-8-retriever-final-response-schema-recovery-sr5-v12-controlled-live-quality-failure-sealed.md`。

> 2026-08-17 — Phase 6.9.8 SR5 V12 direct-host recovery（zero-provider）：
>
> 从已推送 `main=4b7c663b` 新开普通分支 `drb/phase-6-9-8-sr5-v12-direct-host-recovery`。V12 建立独立 source/tag/
> authorization/evidence namespace，V10/V11 tag、validator、runtime 与历史终态保持不变。
>
> 根因修复不再只给 proxy preflight 传空对象：production launcher 会重入一个受控子进程，保留系统/V12 授权环境，按大小写
> 不敏感规则移除 `HTTP(S)_PROXY/ALL_PROXY/NO_PROXY`；共享 preflight 和真实 Provider transport 因而使用同一个 direct-host
> 环境。父 shell、`process.env`、根 `.env` 和 Docker 均不修改。authorization/source/preflight/credential/reservation/
> Provider 的原有门禁顺序保持不变。
>
> V10/V11/V12 focused `19/19`（`340 expect()`），最终 V12 focused `9/9`（`70 expect()`）；Agent full
> `1680/1680`（功能分支 `25911 expect()`，merged-main `25912 expect()`，`207 files`）、AI full `346/346`
> （`2667 expect()`，`28 files`），typecheck/lint
> 通过。Provider/credential/formal evidence/business writes=`0/0/0/0`；未读根 `.env`，未调用 DeepSeek/Qwen，未创建正式
> V12 evidence，未操作 Docker/API/browser，`qualityAuthority=none`。
>
> 功能提交 `4dec1299` 已推送，并以 `--no-ff` 合并提交 `d763f32f` 推送到 `main`；文档 closeout 提交 `2351a221` 随后
> 合并为 `bbe58918`。当前 `main == origin/main`，最终不可变 commit 由 V12 annotated tag 绑定。merged-main focused
> `19/19`、Agent `1680/1680`、AI `346/346` 与静态门全部通过。
> 下一步仅创建并核验 V12 annotated tag，再请求 fresh V12 数据边界与 exact authorization。当前没有执行 controlled-Live 或
> SR6 产品验收。验收见
> `docs/acceptance/phase-6-9-8-retriever-final-response-schema-recovery-sr5-v12-direct-host-recovery-zero-provider.md`。

> 2026-08-17 — Phase 6.9.8 SR5 V11 controlled-Live 在 proxy preflight 停止：
>
> `main == origin/main == c077d654` 时创建并推送 annotated tag
> `phase-6-9-8-retriever-final-response-schema-recovery-sr5-live-v11-approved`；tag object=`20e2abfc`，peeled commit=
> `c077d654`。用户接受 V11 数据边界并授权唯一入口后，production CLI 在 credential 与 Provider 前被 proxy preflight 阻断。
>
> Git Bash profile 注入 `http_proxy/https_proxy=http://127.0.0.1:7897`，端口无监听；结果为
> `loopback_proxy_unavailable / configuredProxyVariables=4 / listenerProbeCalls=1 / providerCalls=0`。credential/formal
> evidence/business writes=`0/0/0`，没有 marker/journal/report/artifact/runId，未读根 `.env`，未调用 DeepSeek/Qwen，未操作
> Docker/API/browser。本次授权入口不得直接重跑；后续必须先修复宿主 proxy，再从最新 `main` 建立新 source/tag 与 fresh
> authorization。
>
> 随后的 no-profile zero-provider diagnostic 返回
> `direct_ready / configuredProxyVariables=0 / listenerProbeCalls=0 / providerCalls=0`，证明失败只来自 login-shell profile
> 注入的失效 loopback proxy。后续新 lineage 应固定 no-profile/direct host；不得移动 V11 tag 或复用本次授权。

> 2026-08-17 — Phase 6.9.8 SR5 V11 diagnostic recovery（zero-provider）完成：
>
> 从 `main=610598c4` 新开普通分支 `drb/phase-6-9-8-sr5-v11-recovery`，功能提交 `1773625a` 已推送并以 `--no-ff` 合并为
> `main=7cf12916`；格式化与文档收口另在 `drb/phase-6-9-8-sr5-v11-closeout` 完成。V11 建立独立的 source lineage、tag、授权确认和
> evidence namespace，V10 sealed evidence 保持只读。DeepSeek direct adapter 新增版本化 V2 兼容合同，仅允许非思考模式的
> `reasoning_content: null`，非空 reasoning 仍拒绝；五类 DQ bounded diagnostic 通过 SR5 runner 进入 journal/report/artifact，
> raw sentinel 未泄漏。V11 focused bridge `8/8`（`68 expect()`），既有 SR5 live `28/28` 通过；V10 原 validator/runtime
> identity 已恢复，V11 CLI 与 package subpaths 已独立。
>
> 本轮仍 zero-provider：credential/provider/formal evidence/business writes=`0/0/0/0`，未读根 `.env`，未启动 Docker/API/browser，
> `qualityAuthority=none`。Agent full `1671/1671`（`25804 expect()`，`206 files`）、AI full `346/346`
> （`2667 expect()`，`28 files`）、typecheck/lint 已通过；格式化修复后目标文件以 CRLF-aware Prettier 与 diff check 通过，merged-main
> 全量回归保持通过。当前 zero-provider 原子阶段已完成，尚未进行新 V11 tag、fresh authorization、controlled-Live 或 SR6。
> 验收见 `docs/acceptance/phase-6-9-8-retriever-final-response-schema-recovery-sr5-v11-diagnostic-recovery-zero-provider.md`。

> 2026-08-17 — Phase 6.9.8 SR5 v10 diagnostic qualification DQ2（zero-provider）完成：
>
> 在不改生产实现的前提下，新增 `27` 个 held-out Provider response shape，覆盖 object/envelope missing `5`、content JSON
> parse `5`、rewrite type/schema `6`、non-thinking response audit `4`、usage validation `7`。所有样例均穿过 DQ1 的真实
> adapter/runtime/candidate/projection 链路，fetch=`1`、wire=`1/1/0`，逐 case raw sentinel 不泄漏。
>
> authority=`zero_provider_sr5_v10_diagnostic_qualification_dq2`，gate=
> `schema_adapter_diagnostic_robustness_not_evidence`，`qualityAuthority=none`。DQ2 focused `1/1`（`190 expect()`），
> DQ1+DQ2 `2/2`（`210 expect()`），Agent full `1663/1663`（`25706 expect()`，`205 files`），typecheck/lint/
> CRLF-aware Prettier/diff check 通过。
>
> Provider/credential/formal evidence/business writes=`0/0/0/0`；未读根 `.env`，未调用 DeepSeek/Qwen，未启动
> Docker/API/browser，未触碰 v10 sealed evidence。本结果不反推 v10 根因，不创建 tag、不接受授权、不执行 Live。验收见
> `docs/acceptance/phase-6-9-8-retriever-final-response-schema-recovery-sr5-v10-diagnostic-qualification-dq2-zero-provider.md`。
>
> 功能提交 `9209a8e7` 已推送，并以 `--no-ff` 合并并推送为
> `2c3bcd17d2fabccacdcf052185d5d8a670dcf998`。merged-main DQ1+DQ2 `2/2`、Agent full `1663/1663`、
> typecheck/lint、CRLF-aware Prettier 与 diff check 均通过。

> 2026-08-17 — Phase 6.9.8 SR5 v10 diagnostic qualification DQ1（zero-provider）完成：
>
> 新增 test-only synthetic fetch 入口，但生产 Live harness 仍固定使用不可注入的第一方 DeepSeek direct adapter。五类
> Provider-like response 实际穿过 direct adapter、ModelAgentRuntime、Retriever rewrite candidate、V7 diagnostic 与
> Task9 RuntimeError 投影，分别得到 `provider_json_parse`、`provider_object_missing`、`provider_type_validation`、
> `response_audit`、`usage_validation`；wire 均为 `1/1/0`，响应中的敏感哨兵不泄漏。
>
> authority=`zero_provider_sr5_v10_diagnostic_qualification`，gate=
> `schema_adapter_diagnostic_qualification_not_evidence`，`qualityAuthority=none`。focused `39/39`，Agent full
> `1662/1662`（`25516 expect()`，`204 files`），typecheck/lint/Prettier/diff check 通过。
>
> Provider/credential/formal evidence/business writes=`0/0/0/0`；未读根 `.env`，未调用 DeepSeek/Qwen，未启动
> Docker/API/browser，未触碰 v10 sealed evidence。本任务不创建 tag、不接受授权、不执行 Live，也不能反推 v10 根因或
> 宣称模型/产品质量。验收见
> `docs/acceptance/phase-6-9-8-retriever-final-response-schema-recovery-sr5-v10-diagnostic-qualification-dq1-zero-provider.md`。
>
> 功能提交 `243a4b97` 已推送，并以 `--no-ff` 合并为 `dde5c24a13274d3c647fa7830839de8923b97ed8` 推送到 `main`。
> merged-main DQ1 focused `39/39`、Agent full `1662/1662`、typecheck/lint、CRLF-aware code Prettier 与 diff check 均通过。

> 2026-08-14 — Phase 6.9.8 SR5 v10 schema/adapter postmortem（zero-provider）完成：
>
> 源码确认旧 DeepSeek rewrite harness 丢弃了 candidate trace/V7 adapter 的 bounded failure category，并将 JSON parse、
> object missing、type validation、response audit、usage 与本地合同失败统一写成 `schema_invalid`；Task9/SR5 还把
> `response_received` 错绑在 typed call 成功返回之后。因此 v10 sealed wire=`1/1/0/0` 不能证明没有 HTTP response，
> 也不能再精确归因 Provider shape。
>
> 修复后 RuntimeError 只携带允许枚举的 adapter category、structured stage 与 0/1 wire prefix；runner 在失败终态前补记
> 已观察到的 `response_received` durability stage，报告和 journal 可一致重算，raw content/field/value 仍不进入 evidence。
> focused `38/38`（`128 expect()`），Agent full `1661/1661`（`25496 expect()`，`203 files`），typecheck/lint/
> Prettier/diff check 通过。
>
> Provider/credential/formal evidence/business writes=`0/0/0/0`，未读 `.env`，未触碰 Docker/API/browser 或 v10 sealed
> bundle，`qualityAuthority=none`。验收见
> `docs/acceptance/phase-6-9-8-retriever-final-response-schema-recovery-sr5-v10-schema-adapter-postmortem-zero-provider.md`。

> 2026-08-14 — postmortem 功能提交 `6a11b37a` 已 `--no-ff` 合并并推送 `main`，merge=`1289d059`。merged-main focused
> `38/38`、Agent full `1661/1661`、typecheck/lint/diff check 全部通过；没有重新执行 Live 或产品验收。

> 2026-08-14 — Phase 6.9.8 SR5 v10 唯一 controlled-Live 已失败封存：
>
> clean/tag-verified source=`fb0e9534...`，run=`da94b83b-3638-4e23-aefc-9e3423bf4c77`，proxy=`direct_ready`。
> Qwen original retrieval 成功，wire `1/1/1/1`、usage `123/0`、verified cost `0.0000615 CNY`；DeepSeek v4-pro
> candidate 在 dispatch 后 bounded `schema_invalid`，wire `1/1/0/0`，无 verified usage/cost。首错 breaker 后其余 `22`
> Provider slots 未启动。总 external Provider calls=`2`、credential reads=`3`、business writes=`0`。
>
> Gate=`schema_recovery_sr5_branch_quality_gate_failed`、`qualityAuthority=none`；正式 semantic/budget aggregate 全为
> `null`。Journal `54` 条，以 `evidence_published` 收口；validator `ok=true`，report logical SHA=`bbd3f59e...2db6`，
> artifact SHA=`c0714172...ce39`。证据已正常 seal，不执行 recover；禁止重跑、追加 Provider 探测或改写 evidence。
>
> 未启动 Docker/API/browser，未写 Trace/BackgroundJob/Outbox/业务数据，SR6 继续阻断。下一任务只允许独立
> zero-provider schema/adapter postmortem。验收见
> `docs/acceptance/phase-6-9-8-retriever-final-response-schema-recovery-sr5-v10-controlled-live-quality-failure-sealed.md`。

> 2026-08-14 — Phase 6.9.8 SR5 v10 host-preflight contract（zero-provider）完成：
>
> 当前 Live tag/授权/数据边界/evidence namespace 全部升级到独立 v10，v9 不复用。CLI v2 对共享 preflight 结果执行
> strict schema 与 ready-state consistency 校验；合法失败只输出固定 code/mode/count/listener 元数据，malformed、extra
> field、URL/raw value 不反射且在 credential/reservation 前停止。测试还冻结 v2/v9 namespace 只读兼容与 v10 leftover
> fail-closed。
>
> runtime source manifest=`sha256:6723dc13...fb80`；focused `128/128`（`282 expect()`），Agent full
> `1658/1658`（`25478 expect()`，`203 files`），typecheck/lint/Prettier/diff check 通过。未读 `.env`/credential，
> Provider/formal evidence/business writes=`0/0/0`，未触碰 Docker/API/browser。下一步仅为分支 commit/push、
> `--no-ff` merge/push 与 merged-main zero-provider replay；tag 与 fresh V10 授权仍是后续独立停止门。验收见
> `docs/acceptance/phase-6-9-8-retriever-final-response-schema-recovery-sr5-v10-host-preflight-contract-zero-provider.md`。
>
> 后续 parity：功能提交 `8c5a2e60` 已合并/推送为 `95ea523a`；merged-main focused `128/128`、Agent full
> `1658/1658`、typecheck/lint、profile-free `direct_ready`、v10 evidence paths=`0` 通过。当前只剩独立 annotated tag、
> local/remote parity 与最终只读 Git verifier；尚未创建 tag 或取得 V10 Live 权限。

> 2026-08-14 — Phase 6.9.8 SR5 v9 proxy-preflight zero-provider 根因诊断完成：
>
> CodeGraph 确认 SR5 production wrapper 已正确注入共享 `runPhase697ArchitectureRecoveryProxyPreflight`；FastCtx/原生宿主
> 对照确认差异来自启动 shell。PowerShell 与 Git Bash `--noprofile --norc` 均为 `direct_ready`、代理变量 `0`、
> Provider `0`；Git Bash login profile 注入四项 HTTP(S) proxy 变量，脱敏端点为 `127.0.0.1:7897`，监听探测失败后
> 返回 `loopback_proxy_unavailable`。因此 v9 固定码 `proxy_preflight_not_ready` 是对该安全失败的上层收口。
>
> 本任务未读 `.env`/credential，未调用 DeepSeek/Qwen，未创建/改写 evidence，未触碰 Docker、PostgreSQL、Redis、
> MinIO、API、browser 或业务数据。共享 preflight 不应被绕过，v9 授权也不重跑；下一步只能决定新的 source/lineage，
> 固化 native/no-profile 启动边界与 bounded failure diagnostic 后再走 merge/tag/fresh authorization。验收见
> `docs/acceptance/phase-6-9-8-retriever-final-response-schema-recovery-sr5-v9-proxy-preflight-zero-provider-diagnosis.md`。

> 2026-08-14 — Phase 6.9.8 Retriever / FinalResponse Schema Recovery SR5 v9 controlled-Live 入口已停止：
>
> v9 feature、`--no-ff` merge、远程推送、merged-main zero-provider 回放、annotated tag local/remote parity 和最终只读
> Git verifier 均已完成。最终 source 为 `main == origin/main == 3ad7d7ce...`，tag object=`b0abb9a5...c1ff`，
> peeled commit=`3ad7d7ce...`，verifier=`ok=true`。
>
> 用户接受 v9 DeepSeek/Qwen 数据边界并授权唯一入口后，正式 CLI 在 source/tag/authorization admission 之后、credential
> projection 与 reservation 之前以 `proxy_preflight_not_ready` fail-closed。终态为 `providerCalls=0 /
credentialReads=0 / formalEvidence=0 / businessWrites=0`；没有 v9 marker、journal、report、artifact、recovery claim、
> dispatch lock、Trace、BackgroundJob、Outbox 或业务数据。没有 bundle 可 seal/recover，本次授权入口不得直接重跑、
> replay、backfill 或追加 Provider 探测。
>
> 这不是 DeepSeek/Qwen、账号、余额、模型权限、schema 或语义质量失败证据，也没有执行 Docker/API/可见浏览器产品验收。
> 下一任务仅为从最新 `main` 新开的独立 zero-provider proxy-preflight 诊断。完整记录见
> `docs/acceptance/phase-6-9-8-retriever-final-response-schema-recovery-sr5-v9-proxy-preflight-failure.md`。

> 2026-08-12 — Phase 6.9.8 SR5 run-bound source revalidation architecture recovery（zero-provider）：
>
> 修复 reservation 创建 self-marker 后 admission 再要求 namespace=0 的自拒绝。两个 capability 通过私有 runId binding
> 配对；运行中 namespace 只允许本 run marker/journal，marker 与 journal 使用共享 strict schema、hash chain、source
> binding 和打开文件身份校验。8 guards 后到首个 adapter 前增加一次性 dispatch capability/permit；late mutation 在
> `invokeCall=0 / wire.dispatches=0` 前停止。独占 lease 只作为遵守合同进程间的互斥，不冒充 Windows OS 全局锁。
>
> focused Live `25/25`（80 assertions），SR5 六文件 `50/50`（162 assertions）；全程未读 credential/根 `.env`，未调用
> Provider，未创建正式 evidence 或业务写入，未启动 Docker/API/browser。旧 v2 run/tag/evidence 保持 sealed，禁止重跑；
> 本任务不创建 tag、不取得授权、不执行 Live，SR6 继续阻断。验收见
> `docs/acceptance/phase-6-9-8-retriever-final-response-schema-recovery-sr5-run-bound-revalidation-zero-provider.md`。

> 2026-08-12 — Phase 6.9.8 Retriever / FinalResponse Schema Recovery SR5 唯一 v2 controlled-Live 已 recovery seal：
>
> 用户接受绑定 v2 source/tag 的 DeepSeek/Qwen 数据边界并授权唯一运行。run
> `9eb57600-97e2-4513-8654-8686b38e856e` 在 source、proxy、credential 与 reservation 前门后，以
> `live_runtime_or_evidence_io` 停止；credential reads=`3`，但 transport/DeepSeek/Qwen/external Provider calls 均为
> `0`，business writes=`0`。随后只执行 crash-only recovery，终态为
> `schema_recovery_sr5_branch_quality_gate_failed / qualityAuthority=none / completionMode=recovery`。strict validator
> `ok=true`，journal `49` 条并以 `evidence_published` 收口；report logical SHA=`5912a563...e087d`，physical artifact
> SHA=`a4ccb506...bb98b`。
>
> 正式 journal 在 `attempt_reserved` 后没有 guard/call/wire 事件。源码复核确认根因是 reservation 创建本 run marker 后，
> runner 消费 admission capability 又复用完整 namespace=0 source check，把自己的 marker 当作 source drift。这不是
> DeepSeek/Qwen、proxy、账号、schema 或语义质量失败。唯一名额已消费，禁止 retry/resume/replay/backfill、再次
> seal/recovery、curl、单 case或产品 API 追加 Provider 探测；正式 marker/journal/claim/report/artifact 不得改写。
>
> 本轮未启动 Docker/API/browser，未写 Trace、BackgroundJob、Outbox 或业务数据。SR6 产品验收继续阻断；下一任务仅为
> 独立 zero-provider run-bound source revalidation architecture recovery。验收见
> `docs/acceptance/phase-6-9-8-retriever-final-response-schema-recovery-sr5-live-recovery-sealed.md`。

> 2026-08-11 — Phase 6.9.8 SR5 production proxy port recovery（当前分支，zero-provider）：
>
> 定位到上一轮 `proxy_preflight_not_ready` 的确定性根因：生产 wrapper 已注入共享 `runProxyPreflight`，但
> `...sr5-live-cli-core.ts` 的 `createPorts` 无条件用 `PROXY_PREFLIGHT_PORT_NOT_BOUND` 抛错桩覆盖 override；因此独立
> preflight 的 `loopback_proxy_ready` 从未进入正式入口。修复为 `overrides?.runProxyPreflight ?? default fail-closed stub`，
> 保留没有注入 port 时的 fail-closed 安全默认值。
>
> 为避免移动已推送的 `live-v1` tag，当前 source contract 预留待创建的 immutable
> `phase-6-9-8-retriever-final-response-schema-recovery-sr5-live-v2-approved`，source manifest=`sha256:61afe007...fa2829`，
> Live manifest=`372abb46...df67a4`。新增 ready/not-ready 双向回归：SR5 Live focused `16/16`（63 assertions），
> SR5 + Task 9B boundary `54/54`（191 assertions），typecheck/lint/diff check 通过；
> Agent full `1529/1529`（25224 expect()，196 files）；
> `providerCalls=0 / credentialReads=0 / formalEvidence=0 / businessWrites=0`，未读取根 `.env`、未调用 DeepSeek/Qwen、
> 未创建 marker/journal/report/artifact，未启动或清理 Docker/PostgreSQL/Redis/MinIO/API/browser。验收见
> `docs/acceptance/phase-6-9-8-retriever-final-response-schema-recovery-sr5-live-proxy-port-recovery-zero-provider.md`。
>
> v2 Git tag 当前尚未创建。源码已变化，旧 SR5 tag/授权不可复用；上一轮失败未消费一次性名额。下一步是分支提交/推送、`--no-ff` 合并并推送
> `main`、合并后二次 zero-provider、创建新的 source-bound annotated tag并重新取得 exact authorization，再执行唯一一次
> controlled-Live。语义门通过后才另行授权启动 Docker/API/可见浏览器产品验收；当前产品验收尚未执行。

> 2026-08-10 — Phase 6.9.8 SR5 Live boundary hardening（当前功能分支，zero-provider）：
>
> 在 tag compatibility recovery 之后补齐两个宿主边界：生产 CLI 通过 own descriptor + `Reflect.get` 将 Bun/Windows
> accessor-backed authorization entries 物化为不可变 data-properties；Live source admission 对 root 与 `.tmp` 使用
> `lstat`/canonical-path fence，symlink/junction、非目录和读取错误统一 fail-closed，避免 namespace 扫描跟随链接。
>
> SR5 contract/source/Live focused `26/26`（102 assertions），Agent full `1527/1527`（25213 expect()，196 files），
> typecheck/lint、源文件 Prettier 与 diff check 全部通过。全程 `providerCalls=0 / credentialReads=0 / formalEvidence=0 /
businessWrites=0`，未读取真实 `.env`、未调用 DeepSeek/Qwen、未创建正式 evidence、未启动或清理 Docker/PostgreSQL/Redis/MinIO/API/browser。
>
> 当前仍在 `drb/phase-6-9-8-retriever-final-response-schema-recovery-sr5` 功能分支，尚未消费本轮授权；下一步是提交/推送、合并并推送
> `main`、合并后二次 zero-provider 回归，再在最终 parity commit 创建并推送独立 Live annotated tag，随后重新接受绑定该 tag/source
> 的 DeepSeek/Qwen 数据边界并提供 fresh exact authorization。controlled-Live 仍只允许一次，旧 tag/授权不可复用，Docker 数据不清理。
>
> 2026-08-10 — Phase 6.9.8 SR5 Live tag compatibility recovery（zero-provider）：
>
> 发现历史 annotated tag `phase-6-9-8-retriever-final-response-schema-recovery-sr5-approved` 仍固定指向修复前
> `ca9a9eb0`；直接移动或覆盖会破坏历史 admission/source manifest 的可复现性。新增独立 Live tag/ref
> `phase-6-9-8-retriever-final-response-schema-recovery-sr5-live-v1-approved`、strict Live source schema、Live Git-tree
> observation/admission 与 source-manifest binding；Live report/CLI/synthetic fixture 全部改为消费新 schema，历史 contract、
> tag 与 admission manifest SHA 保持不变。
>
> zero-provider 回归为 SR5 contract/source/Live `26/26`（102 assertions），Agent full `1527/1527`（25213 expect()，196 files），
> Agent typecheck/lint/Prettier/diff check 通过。
> Live source-manifest SHA=`sha256:d1129b3c...9ccdd`，Live manifest SHA=`bc7e1915...34d80`，policy SHA=
> `e979f30c...e6f74b1`。本阶段没有读取根 `.env`/credential、没有调用 DeepSeek/Qwen、没有创建正式
> marker/journal/report/artifact/recovery claim、没有业务写入，也没有启动或清理 Docker/PostgreSQL/Redis/MinIO/API/browser。
>
> 下一步必须提交并推送功能分支、合并并推送 `main`、完成合并后二次 zero-provider 回归，再在最终 parity commit 创建并推送
> 新 annotated tag；随后针对该 tag/source 重新接受 DeepSeek/Qwen 数据边界并发送新的两行 exact authorization，最后执行唯一一次
> controlled-Live。当前源码变更前的授权未消费且不可复用。详见
> `docs/acceptance/phase-6-9-8-retriever-final-response-schema-recovery-sr5-live-tag-compatibility-zero-provider.md`。
>
> 2026-08-10 — SR5 proxy snapshot fix main parity 收口：
>
> 修复提交 `b531adef` 与文档提交 `c0155ca1` 已以 `--no-ff` 合并到 `main`，merge=`671188bb`，并已推送 `origin/main`。合并后只做
> zero-provider 二次回归：SR5 Live + Task 9B `24/24`（85 assertions）、Agent typecheck/lint、CLI help/validate/recover 与
> `git diff --check` 通过；无正式 bundle 的 validate/recover 仍按预期 fail-closed。`main == origin/main`，formal namespace=0。
>
> 旧 approved tag 仍指向修复前 `ca9a9eb0`，不可移动或复用。下一步只在当前 `main`/功能分支 parity 完整后创建并核验新 annotated
> tag，再重新接受最终 source 的 DeepSeek/Qwen 数据边界并提供新的 exact authorization；在此之前不读 credential、不调用 Provider、不重试。
> Docker/PostgreSQL/Redis/MinIO 均保持原状。该顺序随后在 tag compatibility 入口中固定为权威流程。

> 2026-08-10 — Phase 6.9.8 SR5 controlled-Live proxy 前门诊断与修复：
>
> 在已授权的唯一入口尝试中，CLI 在 proxy preflight 处 fail-closed：`proxy_preflight_not_ready`。输出明确为
> `providerCalls=0 / credentialReads=0 / formalEvidence=0 / businessWrites=0`，没有 run id、marker、journal、report、artifact
> 或 recovery claim，因此不能归因 Provider、账号或模型质量，也没有清理 Docker/PostgreSQL/Redis/MinIO。
>
> 已确认一个 Bun/Windows 兼容缺陷：inherited `HTTP_PROXY`/`HTTPS_PROXY` 等项使用 accessor descriptor，SR5 CLI 仅读取 descriptor `value`，
> 不能把代理配置安全物化给共享 preflight；但生产输出将所有 preflight 异常压缩为同一个 code，不能把该缺陷断言为本次停止的唯一 subtype。
> 修复提交 `b531adef` 改为固定 allowlist + `Reflect.get` + 不可变 data-property，异常值写入
> `null` 后由 preflight fail-closed；新增 accessor-backed regression。修复后 focused Live zero-provider `11/11`（39 assertions），
> typecheck/lint/Prettier/diff check 通过，独立 preflight 为 `loopback_proxy_ready / configuredProxyVariables=4 / listenerProbeCalls=1 / providerCalls=0`。
>
> 修复已推送功能分支，尚未在新 source 上创建/移动 approved tag，也未重试 Live。下一步必须合并并推送 main，在最终 parity commit
> 创建并核验新 annotated tag，再重新接受该 source 的 DeepSeek/Qwen 数据边界并提供新的 exact authorization，之后执行唯一一次；旧授权不得复用。详见
> `docs/acceptance/phase-6-9-8-retriever-final-response-schema-recovery-sr5-live-proxy-snapshot-fix-zero-provider.md`。

> 2026-08-10 — Phase 6.9.8 SR5 Live implementation main parity 已完成（修复前历史 checkpoint）：
>
> `drb/phase-6-9-8-retriever-final-response-schema-recovery-sr5` 已以 `--no-ff` 合并到 `main`，merge=`1d0f798d`。
> 合并后在 main 完成 Agent 全量 `1523/1523`（25189 assertions，196 files）、SR5 + Task 9B boundary `48/48`
> （164 assertions）、Agent typecheck/lint、Live CLI help/validate/recover 与 `git diff --check`；help=`0`，无 bundle 的
> validate/recover 按预期 fail-closed（`1/1`）。
>
> 当前 main 仍保持 `approved tag=0 / providerCalls=0 / credentialReads=0 / formalEvidence=0 / businessWrites=0`；没有读取真实
> `.env`、没有调用 DeepSeek/Qwen、没有启动或清理 Docker/PostgreSQL/Redis/MinIO/API/browser。下一停止门是推送并确认
> `origin/main` parity，再重新接受绑定最终 source 的两行 exact authorization，创建 approved tag 后执行唯一一次 SR5
> controlled-Live。成功也只形成分支 semantic authority；失败必须 durable seal，禁止 retry/replay/curl/单 case/追加探测。

> 2026-08-10 — Phase 6.9.8 Retriever / FinalResponse Schema Recovery SR5 Live implementation 已完成（zero-provider，修复前）：
>
> 从历史 `main@0d624c9f` 新开普通 git 分支
> `drb/phase-6-9-8-retriever-final-response-schema-recovery-sr5`，实现提交 `14301d03` 已推送。新增独立 Live
> lineage/source manifest，固定 `8 guards + 6 rewrite pairs + 6 FinalResponse`，DeepSeek `12` + Qwen embedding `12`
> （共 `24` Provider slots），最大并发 `1`、pair-serial、single dispatch，预算 `37,600/8,800/0.176 CNY`，禁止
> retry/resume/replay/backfill。
>
> Live CLI 使用 `bun --no-env-file`，并按 `exact argv -> data-boundary/exact authorization -> current-namespace/source/tag -> proxy
preflight -> selective root .env projection -> single-use reservation -> marker/journal -> runtime -> validator`
> 顺序执行。只有三项 SR5 credential 在所有前门通过后才会被读取；credential、prompt、Provider 原文不写入 evidence。
> 旧 admission manifest SHA 保持不可变，Live source bundle SHA=
> `sha256:4aa3c6e8b6f66ad0c74dcaab932cbfa9bb04202f3219e38005a2571ae60853ef`，Live manifest SHA=
> `2eb786e19e3e6de2f26bcc9d4b4e1b1898ee1ee3eb87976090275f4468696608`，policy SHA=
> `e979f30c6979e1e4ff17a439f77820ff4ded5882189d58ba753fa02b9e6f74b1`。
>
> focused Live `10/10`（36 assertions）、SR5 + Task 9B boundary 组合 `48/48`（164 assertions）、Agent typecheck/lint 与 `git diff --check`
> 已通过。此提交仍是 implementation checkpoint：`providerCalls=0 / credentialReads=0 / formalEvidence=0 /
businessWrites=0`，未创建 approved tag，未启动 Docker/API/browser，未读取真实 `.env`，未调用 DeepSeek/Qwen。
> 文档、main merge、远程推送与二次回归完成后，必须重新接受绑定最终 source 的两行 exact authorization，才可执行唯一
> controlled-Live；成功也只形成分支 semantic authority。验收见
> `docs/acceptance/phase-6-9-8-retriever-final-response-schema-recovery-sr5-live-implementation-zero-provider.md`。

> 2026-08-10 — Phase 6.9.8 SR5 runner/durability main closeout 已完成：
>
> 功能提交 `d077bf9d` 已推送到
> `drb/phase-6-9-8-retriever-final-response-schema-recovery-sr5-runner`，随后从最新 `main` 以 `--no-ff` 合并为
> `b2b5b9c9`。合并后的 `main` 再次通过 SR5 focused `25/25`（82 assertions）、typecheck、lint、CLI help/run smoke 与
> `git diff --check`；CLI 仍为 `12/12/12/12` reservations/dispatches/responses/verifiedUsage、`12/0/0`
> succeeded/failed/notStarted，`providerCalls=0 / credentialReads=0 / formalEvidence=0 / businessWrites=0`。
>
> 本次只完成 zero-provider 工程边界与 main parity，不创建 approved tag、不读取 credential、不调用 DeepSeek/Qwen，不进入
> Docker/API/browser 或产品 Trace。下一步必须重新接受当次 DeepSeek/Qwen 数据边界，并为已推送 source/tag 提供 exact
> authorization；在新的 controlled-Live 授权前保持所有 gate 关闭。

> 2026-08-10 — Phase 6.9.8 Retriever / FinalResponse Schema Recovery SR5 runner/durability zero-provider checkpoint 已完成：
>
> 在已推送 `main@42abbbbd` 上新开普通分支
> `drb/phase-6-9-8-retriever-final-response-schema-recovery-sr5-runner`。SR5 admission contract 的 strict source/tag/bundle、
> DeepSeek/Qwen data-boundary、source-bound exact authorization、固定预算与 opaque single-use capability 已作为上游能力
> 绑定；本次新增固定 `8 guards + 6 rewrite + 6 FinalResponse` runner、pair-serial 单并发、首错 breaker、fsynced
> hash-chain journal、hard-link artifact、strict recomputing validator 与 crash-only recovery。
>
> 新增 runner CLI 明确只接受 zero-provider reviewed Mock、validate 与 crash-only recover token，不开放 live、credential、
> replay 或 backfill；approved tag 尚未创建，因此真实 `git_verified` source gate 保持关闭。focused `25/25`（82 assertions）、
> Agent typecheck/lint、CLI help/run smoke 与 `git diff --check` 通过；CLI runtime `12/12/12/12` wire、`12/0/0` 成功/失败/
> 未启动，`providerCalls=0 / credentialReads=0 / formalEvidence=0 / businessWrites=0`。临时 synthetic evidence 创建 1 次后
> 精确清理为 0；未读取根 `.env`、未调用 DeepSeek/Qwen、未启动 Docker/API/browser、未写 Trace/BackgroundJob/Outbox。
>
> runner manifest/policy/admission manifest SHA 分别为
> `d50e27729d873833fc857efe648ba8a56fda19a4d70212a22aa01dbe02b53ea3`、
> `ff05b647a4c00a3943c18c70d02650aad3d4b880209ac35f04e60d1d9e31f803`、
> `sha256:f71bdee19cf4509395566d8bf54d85ad1f37cf867ca2cbf37211b1daef8fa38b`。回归覆盖 tampered journal/artifact、
> crash-only prefix、terminal publication recovery、二次 seal、CRLF、foreign artifact 与 capability 二次消费。
>
> authority=`zero_provider_retriever_final_response_schema_recovery_sr5_runner_durability`、gate=
> `schema_recovery_mock_quality_not_evidence`、`qualityAuthority=none`。本 checkpoint 不是 controlled-Live，也不形成
> semantic/product/main/P95/SLA authority。完整验收见
> `docs/acceptance/phase-6-9-8-retriever-final-response-schema-recovery-sr5-runner-durability-zero-provider.md`。

> 2026-08-09 — Phase 6.9.8 Retriever / FinalResponse Schema Recovery SR4 reviewed Mock/static 已完成：
>
> 从已推送 `main == origin/main == 421015dbf472e008fad32200fa8a89e240818fcf` 新开普通 git 分支
> `drb/phase-6-9-8-retriever-final-response-schema-recovery-sr4`。SR4 沿用
> `phase-6.9.8-retriever-final-response-schema-recovery-v1` lineage，factory version 为
> `phase-6.9.8-retriever-final-response-schema-recovery-sr4-factory-v1`，factory SHA=
> `sha256:7bc32c8ed68c3c8d76c9c983b40e771f24c0181cda7976cbc97ab1fb4c26d157`。
>
> 本次修复了 reviewed Mock 直接把 object 交给 Zod、导致 extension 被误判为 schema failure 的链路。prompt-only responder
> 先根据实际 bounded prompt 生成 canonical query，再在内存构造 raw JSON，经 `parseModelAgentJsonContentWithPolicy`
> 完成有界 parser/projection；extension 字段只形成固定诊断并丢弃，raw content、raw hash、字段名和值不保留。解析失败统一
> 复用 SR3 runtime error 分类，避免把 schema/usage/transport/timeout/abort/cross-owner 混成 transport。
>
> 生产形状链路为 `Retriever original -> query-rewrite candidate -> bounded raw-content parser -> synthetic Qwen search
port -> evidence projector -> FinalResponse stream -> local merger -> SR3 runner`。固定 `8 guards + 6 rewrite + 6
FinalResponse = 20 report entries / 12 candidate invocations`、最大并发 `1`、single dispatch、no retry/replay；默认结果
> 为 guards `8/8`、runtime `12/12/12/12`、schema `4 canonical + 2 extension discarded + 0 rejected`、FinalResponse
> strict `6`、节点计数 `18/6/6/6/6`、synthetic Qwen port `18`，gate=
> `schema_recovery_mock_quality_not_evidence / qualityAuthority=none`。
>
> SR4 focused `11/11`（99 assertions）、SR1+SR2+SR3+Task9B+SR4 组合 `74/74`（734 assertions，15 files）、Agent full
> `1488/1488`（25020 expect()，190 files）、AI full `345/345`（2662 expect()，28 files）、Types `42/42 + tsc`、Web
> `487/487`、Server build、Agent/AI typecheck/lint 均通过；historical SR3 validator/SHA parity 由组合回放覆盖。全程
> `providerCalls=0 / credentialReads=0 / businessWrites=0 / formalEvidence=0`，不读根
> `.env`、不调用 DeepSeek/Qwen、不启动/清理 Docker/API/browser、不写 Trace/BackgroundJob/Outbox/业务数据。SR4 只解锁
> fresh SR5 admission；不形成真实模型、产品、main、P95/SLA 或博客 authority。完整验收见
> `docs/acceptance/phase-6-9-8-retriever-final-response-schema-recovery-sr4-reviewed-mock-static.md`。
>
> 随后已切回 `main`，以 `--no-ff` 合并 SR4；合并后二次 focused/组合/CLI/typecheck/lint 回放保持通过，并已推送
> `origin/main`。最终 `main == origin/main`（merge commit=`d5029f90`）。

> 2026-08-09 — Phase 6.9.8 Retriever / FinalResponse Schema Recovery SR3 zero-provider runner/source admission/durability 已完成：
>
> 从 `main == origin/main == 849af1c84231a4c0fbe54426ddae02d0a1b28a30` 新开普通 git 分支
> `drb/phase-6-9-8-retriever-final-response-schema-recovery-sr3`，沿用 lineage
> `phase-6.9.8-retriever-final-response-schema-recovery-v1`。固定 `8 guards + 6 rewrite + 6 FinalResponse`、
> `20` report entries、`12` candidate invocations、最大并发 `1`、pair-interleaved/no-retry/首错 breaker；预算 cap
> `37600/8800/0.176 CNY`。manifest SHA=`d14c08455126fad492f9f01ed07a1a4fd911241c62384fbd07537e4ffda1bede`，
> policy SHA=`6c1f1b0388b2b595f141061cb3d0d34607b6214a4772e7cb4a17309e431cebf8`。
>
> 实现包含 Git-verified 与 synthetic source admission、module-owned single-use capability、fsynced marker/hash-chain
> journal、strict recomputation validator、hard-link artifact、PID/start-identity guard、publication-prefix crash-only
> recovery，以及严格 run/validate/recover(seal) CLI。CLI 默认使用 OS 临时目录 reviewed Mock，并在退出时清理临时 root；
> validate/recover 的默认路径已固定解析到仓库根，避免从 `packages/agent/scripts` 误指向 `packages`；
> SIGINT/SIGTERM 映射为 AbortSignal。新增 SR3 focused `15/15`（49 assertions）、SR1+SR2+SR3+Task9B 组合回放
> `63/63`（635 assertions，14 files）、Agent full `1477/1477`（24908 expect()，189 files）、AI full `345/345`
> （2662 expect()），typecheck/lint 通过。
>
> 本阶段 authority=`zero_provider_retriever_final_response_schema_recovery_runner_durability`、gate=
> `schema_recovery_mock_quality_not_evidence`、`qualityAuthority=none`；`providerCalls=0`、`credentialReads=0`、
> `businessWrites=0`、formal evidence=`0`。未读取 root `.env`，未调用 DeepSeek/Qwen，未启动/清理 Docker/API/browser，未写
> Trace/BackgroundJob/Outbox/业务数据。它只解锁 SR4 reviewed Mock/static，不形成真实语义、产品、main、P95/SLA 或博客 authority。
> 完整验收见 `docs/acceptance/phase-6-9-8-retriever-final-response-schema-recovery-sr3-zero-provider-runner-durability.md`。

> 2026-08-09 — Phase 6.9.8 Retriever / FinalResponse Schema Recovery SR2 zero-provider robustness 已完成：
>
> 从已合并并推送的 `main == origin/main == 629acec49d9693f24ccded051d8d90cad77167cc` 新建普通分支
> `drb/phase-6-9-8-retriever-final-response-schema-recovery-sr2`，沿用
> `phase-6.9.8-retriever-final-response-schema-recovery-v1` lineage。SR2 authority=
> `zero_provider_retriever_final_response_schema_recovery_robustness / qualityAuthority=none`。
>
> 新增独立 fixture/responder（fixture SHA=`sha256:59010e16fd665df6d497517276dbeacb3f5973036a07e8cf00010569da171505`）：
> `5` 个 held-out、`24` 个 Provider-like shape（5 accepted/19 rejected）、`7` 个 fault、`4` 个 metamorphic case。
> 合成 runtime 固定为 `reviewed_mock/mock/mock`，在无网络条件下真实穿过 SR1 raw-content parser、canonical projection、
> local authority、sanitizer 与一次 dispatch/no-retry 边界；prompt-derived responder 不导入 expected/oracle/baseline/scorer。
>
> SR2 focused `12/12`（329 assertions），SR1+SR2/node/query-rewrite 组合 `43/43`（743 assertions）；Agent full
> `1462/1462`（24841 expect()，184 files）、AI full `345/345`（2662 expect()，28 files）、Agent/AI typecheck/lint 与
> `git diff --check` 通过；SR2-owned TS/JSON 使用 `--end-of-line=crlf` 的 Prettier 回放通过，历史 Markdown 保持
> Windows CRLF 换行风格。
> 全程 `providerCalls=0`、`credentialReads=0`、formal marker/journal/report/artifact/recovery claim=`0`，不读根 `.env`、
> 不调用 DeepSeek/Qwen、不启动或清理 Docker/API/browser、Trace、BackgroundJob、Outbox 或业务数据。
>
> 这一步只解锁 SR3 独立 runner/source admission/durability；不形成真实模型语义、产品、`main` 或 P95/SLA authority。
> 完整验收见 `docs/acceptance/phase-6-9-8-retriever-final-response-schema-recovery-sr2-zero-provider-robustness.md`。随后已在
> `17ce07ba` 以 `--no-ff` 合并回 `main` 并推送 `origin/main`；合并后 focused/组合/Agent/AI/typecheck/lint 回放保持
> 通过，远程 SHA 已复核一致。SR2-owned TS/JSON 以 CRLF-aware Prettier 回放通过，未对历史 Markdown 做换行重排。
>
> 2026-08-09 — Phase 6.9.8 Retriever / FinalResponse Schema Recovery SR1 zero-provider strict parser/projection TDD 已完成：
>
> 从已合并并推送的 `main == origin/main == e5d575214dce636c89db69a26c934019da06a013` 新建普通分支
> `drb/phase-6-9-8-retriever-final-response-schema-recovery-sr1`，沿用独立 lineage
> `phase-6.9.8-retriever-final-response-schema-recovery-v1`，authority=
> `zero_provider_retriever_final_response_schema_recovery_tdd / qualityAuthority=none`。新增 module-owned exact schema、
> bounded native JSON parser、duplicate-key scanner、canonical `{ rewrittenQuery }` projection、实际 candidate collector
> seam 与 usage/trace unknown fail-closed 诊断；diagnostic 只在 candidate outcome 顶层 sidecar，Retriever node/API boundary
> 丢弃，不进入产品 Chat、FinalResponse prompt、账单或 Trace。
>
> focused：contract `9/9`（153 assertions）、candidate `13/13`（171 assertions）、AI policy `4/4`（16 assertions）、
> Retriever node boundary `9/9`（90 assertions），合计 `35/35`（430 assertions）。Agent full `1450/1450`（24512 expect()，
> 181 files）、AI full `345/345`（2662 expect()，28 files）、typecheck/lint/Prettier/`git diff --check` 全部通过。
> 全程 `providerCalls=0`、`credentialReads=0`、formal marker/journal/report/artifact/recovery claim=`0`，不读取根 `.env`、
> 不调用 DeepSeek/Qwen、不启动或清理 Docker/API/browser、Trace、BackgroundJob、Outbox 或业务数据。
>
> SR1 acceptance：`docs/acceptance/phase-6-9-8-retriever-final-response-schema-recovery-sr1-zero-provider-tdd.md`。
> 本阶段只解锁 SR2 zero-provider Provider-like robustness；下一阶段必须从最新已推送 `main` 新开分支，未来任何
> controlled-Live 都需重新接受当次 DeepSeek/Qwen 数据边界并给出绑定新 source 的 exact authorization。

> 2026-08-09 — Phase 6.9.8 Retriever / FinalResponse Schema Recovery SR0 zero-provider 设计冻结：
>
> P1 L2 唯一 controlled-Live 已在此前提交中失败封存、合并到 `main` 并完成远程 parity 与二次 zero-provider 回归；本次
> 从 `main@6dbe96e2eb72382ba2c25522e86cbc7e17b2f610` 新建普通分支
> `drb/phase-6-9-8-retriever-final-response-schema-recovery-sr0`，不使用 worktree。新 lineage 为
> `phase-6.9.8-retriever-final-response-schema-recovery-v1`，authority=
> `zero_provider_retriever_final_response_schema_recovery_design / qualityAuthority=none`。
>
> SR0 只读复盘 P1 L2 的 bounded `rewrite_03 / schema / runtime_untrusted`，明确不能恢复 Provider 原文或具体字段，
> 也不归因网络、账号、余额、权限或服务端。冻结 Retriever 的 Provider content → envelope → canonical rewrite
> projection → local safety/authority 四步合同；extension 只在有界审计后丢弃并计数，alias/duplicate/wrapper/limit/
> unsafe/unchanged/protected-term drift 均 fail-closed。Diagnostic 只允许固定 stage/reason/type/bucket/enum hash，
> `rawDataRetained=false`；FinalResponse stream、owner、evidence projector、Qwen policy、Router、Trace 与产品写入权限不变。
>
> SR0 同时冻结独立 future SR3 marker/journal/report/recovery claim/artifact namespace，以及 PID reuse、SIGINT/SIGTERM、
> claim/event 单边崩溃、publication/artifact conflict、foreign temp、hard-link inode、二次 recovery 幂等和
> provider/credential zero-call 停止门。文档设计/计划/验收分别见
> `docs/superpowers/specs/phase-6-9-8-retriever-final-response-schema-recovery-design.md`、
> `docs/superpowers/plans/phase-6-9-8-retriever-final-response-schema-recovery.md`、
> `docs/acceptance/phase-6-9-8-retriever-final-response-schema-recovery-sr0-zero-provider-design.md`。
> 本阶段没有源码、credential、Provider、Docker/API/browser、Trace、BackgroundJob、Outbox 或业务数据变化；下一步只
> 解锁 SR1 strict parser/projection TDD。

> 2026-08-09 — Phase 6.9.8 P1 L2 唯一 controlled-Live 已质量门失败并 durable seal：
>
> 唯一 run `ff035203-500f-4744-b33c-3c375ae4c785` 在 branch
> `drb/phase-6-9-8-p1-l2-controlled-live`、approved source/tag `fa50292509d7c3e2e4ad017e7e730fd434a29cde`
> 上执行。8/8 guards 全部通过且 zero-call；`rewrite_01` strict 成功，`rewrite_03` 在第二次 DeepSeek 调用后以 bounded
> `schema` failure 打开 breaker，后续 10 条 lane 均 `not_started_quality_breaker`。最终
> `p1_l2_quality_gate_failed / qualityAuthority=none / semanticGate=none`。
>
> Provider/credential/Qwen calls=`2/2/0`，candidate invocations=`2/12`，usage=`343/40`，aggregate verified cost=`null`。
> `rewrite_01` 的独立 verified cost 为 `0.00069 CNY`，但 `rewrite_03` 没有可接受 cost，因此不能把成功前缀当成整轮费用。
> Journal `41` 条，以 `evidence_published` 收口；validator=`ok=true / bundle_valid`，recovery claim=`null`，report/root
> artifact SHA=`84eddcf6...d7f9 / 9b79c490...f58b`。
>
> 首次 CLI 入口曾因 clean porcelain 空字符串误判而在 source gate 返回 `source_admission_invalid`；该入口发生在
> credential/marker/Provider 前，不是 Live attempt。`146d2107` 修复并加入回归后，canonical tag 绑定 `fa502925`，唯一
> run 才进入 Provider。封存后 Agent full `1437/1437`（24317 assertions，180 files）、typecheck、lint 与
> `git diff --check` 通过；P1 L2 focused 仍为 `14/14`（47 assertions）。
>
> 完整验收见
> `docs/acceptance/phase-6-9-8-retriever-final-response-p1-l2-controlled-live-quality-gate-failure.md`。唯一名额已消费；禁止
> retry/resume/replay/backfill、recovery/seal、curl、单 case或追加 Provider 探测。该失败不形成 P1 semantic、产品
> Docker/API/browser、Trace、SLA、业务写入或 `main` 产品 authority。证据与文档已在 `1f3c0d9b` 提交，以 `--no-ff`
> 合并到 `main` 生成生产/证据 merge `f4fac048` 并推送 `origin/main`；文档 parity 随后以 `613cc772` 合并，最终合并后二次
> zero-provider 回归已通过。完整 main parity 记录见
> `docs/acceptance/phase-6-9-8-retriever-final-response-p1-l2-main-parity-zero-provider.md`。下一功能任务必须是从最新
> `main` 新建的独立 schema recovery/diagnostic lineage。

> 2026-08-08 — Phase 6.9.8 P1 L2 zero-provider admission contract 已完成：
>
> 在从已合并并推送的 `main / origin/main = 313d6e48` 派生的普通分支
> `drb/phase-6-9-8-l2-admission-contract` 上，新增独立 L2 admission parser、source/remote parity、协议 approved
> tag、冻结 S2 identity、DeepSeek/Qwen data-boundary receipt、exact lineage/source authorization、bounded budget 与
> WeakMap single-use capability。正常 tuple 输出 `mode=zero_provider_admission`、`providerDispatchAllowed=false`、
> `providerCalls=0`、`credentialReads=0`、`formalEvidence=0`；协议字符串不是用户授权，当前 approved tag 未创建，未读
> `.env`、未执行 proxy/network、Provider、Docker/API/browser、Trace、BackgroundJob、Outbox 或业务写入。
>
> focused `4/4`（19 assertions），G1+G2+S2+L2 focused `18/18`（142 assertions），typecheck/lint/`git diff --check`
> 通过。随后已完成文档同步、fast-forward 合并并推送 `main`，当前 `main == origin/main`（具体 HEAD 以
> `git rev-parse main origin/main` 为准）；
> 合并后 `@repo/agent` 全量回归 `1427/1427`（24263 assertions，178 files），typecheck/lint/diff check 再次通过。
> 完整验收见 `docs/acceptance/phase-6-9-8-retriever-final-response-p1-l2-admission-zero-provider.md`。
> 下一步只有重新接受当次 DeepSeek/Qwen 数据边界并给出精确绑定当前 source/lineage 的 exact authorization，才可执行唯一
> L2 controlled-Live。

> 2026-08-08 — Phase 6.9.8 P1 S2 reviewed Mock/static 已完成：
>
> 在从已推送 `main / origin/main = 0c2faf1d` 派生的普通分支
> `drb/phase-6-9-8-p1-s2-reviewed-mock` 上，新增 reviewed Mock 评测并把 G2 one-shot runner 接到实际
> Retriever original/query-rewrite、synthetic Qwen search port、verified-evidence projector、FinalResponse stream、
> strict validator 与 local merger。固定 `8` 条 zero-call guard、`6` 条 rewrite + `6` 条 FinalResponse lane、
> candidate invocation `12`、最大并发 `1`；正常 checkpoint 为 guard `8/8`、strict/wire/synthetic usage `16/16/16`、
> Tutor/Organizer/Combined semantic `1/1/1`。节点计数为 Retriever original `18`、candidate `6`、projector `6`、
> FinalResponse `6`、local merger `12`，synthetic Qwen port calls `17`。
>
> S2 gate=`p1_mock_quality_not_evidence`、authority=`zero_provider_retriever_final_response_p1_s2_reviewed_mock`、
> `qualityAuthority=none`。`usageAuthority=synthetic_estimate` 只用于 bounded diagnostic；
> `verifiedProviderUsageSamples=0`、`verifiedProviderCostCny=null`，不得解释为真实 Provider 计量或账单。
> factory SHA=`sha256:8ad0a12ae7bd6365873631cb4908b41888617b9599fdd6865cf7e45c788f0e7d`，report SHA=
> `cfb48cb8108768ace9b8e5c5714344f2be74e16300d6997a5e874085275b9db5`；final_11 compatibility SHA=
> `b492487db888a2e2d89810faac8cc7b0e50c36b464fb6eb6cfa9a4bc4680a532` 仅是冻结 contract 的 citation-recall
> diagnostic，不改写 G1/G2 authority。
>
> S2 focused `4/4`（73 assertions）、G1+G2 focused `10/10`（50 assertions）、Agent full `1423/1423`
> （24241 expect()，177 files）、typecheck/lint/Prettier/diff check 全通过。全程 `providerCalls=0`、
> `credentialReads=0`、formal marker/journal/artifact/recovery claim=`0`，未读取根 `.env`、未启动 Docker/API/browser、
> 未写 Trace/BackgroundJob/Outbox 或业务数据。完整验收见
> `docs/acceptance/phase-6-9-8-retriever-final-response-p1-s2-reviewed-mock-static.md`。
> 该条记录中的“下一步是完成相关文档 parity、推送并合并 `main` 后在 `main` 二次回归”是 S2 完成时的历史 checkpoint；
> 相关动作随后已完成。若申请 L2，仍必须重新接受当次 DeepSeek/Qwen 数据边界并给出新的 exact authorization，不能重跑既有封存 evidence。

> 2026-08-08 — Phase 6.9.8 P1 G2 zero-provider runner/durability 已完成：
>
> G2 从已合并 `main` `a12db738` 新建普通分支 `drb/phase-6-9-8-g2-runner-durability`，未使用 worktree。实现独立
> `phase-6.9.8-retriever-final-response-p1-g2-v1` source admission、opaque single-use capability、guard-first /
> pair-serial one-shot runner、exclusive marker、reservation-before-dispatch、fsynced hash-chain journal、strict lane/report
> validator、hard-link artifact publication 与 crash-only prefix recovery。固定 `8` guard + `6` rewrite + `6` FinalResponse，
> 最大并发 `1`，candidate invocation cap `12`；semantic mismatch 继续保留分母，contract/permission/safety/budget/
> transport/schema/usage/stale 首错打开 breaker，后缀不 dispatch、不 retry。
>
> focused `5/5`（23 assertions），Agent full `1419/1419`（24157 expect()，176 files），typecheck/lint/Prettier/
> `git diff --check` 均通过。synthetic CLI run `ca024a15-d202-45ce-8e89-948b8296d6e5` 得到 gate=
> `g2_runner_durability_ready`、candidateInvocations=`12`、journalRecords=`72`、final=`evidence_published`、validator
> `ok=true`；report SHA=`041e5c1feffb427985450eedc09c2d7f2d28d2a3f97e984028277b6d42fbd84b`，artifact SHA=
> `550b9729e15e218bb6619d7594ac25f1981336c8eae5a549bc1117ff456d995d`。全程 `providerCalls=0`、`credentialReads=0`、
> `formalEvidence=0`，未读根 `.env`、未启动 Docker/API/browser、未写 Trace/BackgroundJob/Outbox/业务数据；authority=
> `zero_provider_retriever_final_response_p1_g2_runner_durability / qualityAuthority=none`。详细验收见
> `docs/acceptance/phase-6-9-8-retriever-final-response-p1-g2-runner-durability.md`。该条是 G2 当时的历史 checkpoint；随后
> S2 reviewed Mock/static 已在独立分支完成，当前状态以本日志顶部的 S2 记录为准。

> 2026-08-08 — Phase 6.9.8 P1 G1 zero-provider contract/baseline/scorer 已完成：
>
> 当前分支 `drb/phase-6-9-8-g1-manifest-baseline-scorer` 从 clean `main`/`origin/main` `9a3c32e2` 派生；新增独立
> `phase-6.9.8-retriever-final-response-p1-v1` manifest、subset deterministic baseline、candidate-only projection 与
> strict scorer/gate。固定 `8` guards、`6` rewrite、`6` FinalResponse（20 entries / 12 semantic lanes），manifest/policy/
> baseline SHA 分别为 `f117f625...bb1ccb189`、`edaa07d1...37537f3`、`2c539b55...f5f611df`。scorer 重算 aggregate，
> 拒绝 self-reported metrics、重复/缺失/乱序 case、旧 lineage、unsafe breaker 与超过 `12` 次 candidate invocation；
> semantic mismatch 不打开 breaker，P95 固定 `null / insufficient_sample_size_6`。
>
> G1 authority=`zero_provider_retriever_final_response_p1_g1_contract_baseline`、`qualityAuthority=none`；
> `providerCalls=0`、`credentialReads=0`、Qwen/formal evidence/业务写入均为 `0`。focused `5/5`（27 assertions）、
> Agent full `1414/1414`（24108 expect()，175 files）、typecheck/lint/Prettier 通过；未启动 Docker/API/browser，未读取
> `.env` 或执行真实模型。下一原子任务为 G2 one-shot runner/durability；完整验收见
> `docs/acceptance/phase-6-9-8-retriever-final-response-p1-g1-contract-baseline-scorer.md`。

> 2026-08-08 — Phase 6.9.8 P1 zero-provider semantic-gate 设计已冻结：
>
> L1 的唯一三槽 transport canary 已以 `transport_reentry_v2_l1_controlled_canary_passed` 封存，但
> `qualityAuthority=none`，因此没有把 transport success 拼成语义质量。当前新分支
> `drb/phase-6-9-8-p1-semantic-gate-design` 从已合并 `main`（`3fdb9908`）派生，冻结独立 lineage
> `phase-6.9.8-retriever-final-response-p1-v1`，固定 `8` 条 zero-call guard、`6` 条 rewrite、`6` 条
> FinalResponse；manifest/policy/baseline anchor SHA 分别为
> `e7216d072eb20e47eaea469646b4c831c180bd9248fdaae059a335a22404fab2`、
> `ab6a453a60fad5bf7678d4f04b9f1e1c30a5ab5642580b0ea5615f4edd20d146`、
> `63748b92cfa5da4ba60c8c457c7d97e8f079a0add130adbc7698a70ccc2f503b`。
>
> P1 只冻结 owner/通信/权限、固定路由、最大并发 1、12 次 bounded synthetic candidate invocation、abort/stale/
> 丢失任务、首错 breaker/no-retry、strict/wire/usage/semantic/safety 质量门；不读 `.env`/credential，不调用
> Provider，不启动 Docker/API/browser，不写 Trace、BackgroundJob、Outbox 或业务数据。Mock gate 固定
> `p1_mock_quality_not_evidence / qualityAuthority=none`，六条语义 lane 不产生 P95/SLA authority。下一原子任务是
> G1 zero-provider manifest/subset baseline/scorer contract。设计、计划和验收分别见
> `docs/superpowers/specs/phase-6-9-8-retriever-final-response-p1-zero-provider-semantic-gate-design.md`、
> `docs/superpowers/plans/phase-6-9-8-retriever-final-response-p1-zero-provider-semantic-gate.md`、
> `docs/acceptance/phase-6-9-8-retriever-final-response-p1-zero-provider-semantic-gate.md`。

> 2026-08-08 — Phase 6.9.8 Transport Re-entry V2 L1 controlled-Live 已完成并 durable seal：
>
> 在推送 source `ee3dbf91c863a3a5cd95c810a9c0cec0b26f64c6` 上，fresh proxy 为 `direct_ready`，当次 DeepSeek/Qwen
> 数据边界与 exact authorization 通过后，唯一 run `ce0c3257-a5d9-4389-90ec-814d5e9cde34` 按
> `rewrite -> qwen -> final_response` 完成 `3/3` slots。Provider/credential reads=`3/3`，usage=`145/28/173`，
> verified cost=`0.000573 CNY`，breaker closed，recoveryRequired=`false`，gate=
> `transport_reentry_v2_l1_controlled_canary_passed`，authority=`controlled_live_transport_reentry_v2`、
> `qualityAuthority=none`。
>
> Journal `16` 条并以 `evidence_published` 收口，validator `ok=true`；logical report SHA=`fc0409acbc6446ae3ccaf6917905ac465678006384fbf2325c839715ff1a2685`，
> root artifact SHA=`472c727db12a0115a918440795ff72b59df980521867841d778373c91484718a`。这只形成 transport diagnostic authority，不证明 semantic/product/main；L1
> 一次性名额已消费，禁止 retry/resume/replay/backfill、recovery/seal 或追加 Provider 探测。完整验收见
> `docs/acceptance/phase-6-9-8-retriever-final-response-transport-reentry-v2-l1-controlled-live-sealed.md`。

> 以下两条 2026-08-08 记录是该 Live 前的历史 checkpoint，保留其当时的 zero-provider/configuration-only 事实：
>
> 2026-08-08 — Phase 6.9.8 L1 root `.env` admission diagnosis 与 compatibility recovery：
>
> 首次受控入口在 credential composition 返回 `credential_configuration_invalid / unknown_key`。根因是共享根 `.env`
> 同时承载数据库、Redis、MinIO、RAG、Chat 等正常项目配置，并使用宿主兼容 `Qwen_API_KEY`；这不是 Provider、网络或
> 账号故障。该次没有 marker/journal/report/artifact/recovery claim、credential read、Provider call 或业务写入，旧一次性
> 名额未消费。生产 launcher 现使用 selective root profile，只提取 `DEEPSEEK_API_KEY` 与
> `QWEN_API_KEY`/`Qwen_API_KEY`/`DASHSCOPE_API_KEY` 并归一化为 canonical `QWEN_API_KEY`；其它项目字段不进入
> projection，多个 Qwen alias 以 `alias_conflict` fail-closed。C1 strict synthetic parser 与历史验收不变。
>
> （历史 Live 前 checkpoint）修复当时仍是 zero-provider checkpoint，不是 Live 证据；随后已在新 source 上完成唯一
> controlled-Live。诊断验收见
> `docs/acceptance/phase-6-9-8-retriever-final-response-transport-reentry-v2-l1-root-env-diagnosis-zero-provider.md`。

> 2026-08-08 — Phase 6.9.8 Transport Re-entry V2 L1 implementation 与 zero-provider 回归已完成（Live 前历史 checkpoint）：
>
> 新增 production-shaped L1 launcher、固定 `rewrite -> qwen -> final_response` runner、source/proxy/data-boundary/
> authorization gate、deferred adapter handoff、strict dispatch/response/usage journal state machine、hash-chain
> validator、lineage formal-path fence、reserved/dispatch crash-only recovery、existing-artifact publication recovery
> 与 recovery-claim integrity check。真正 adapter constructor 只在 durable marker/reservation 后执行，marker 前只做
> capability shape/lineage/family/call preflight；raw key 不进入 report/journal/artifact/diagnostic。
>
> L1 focused `13/13`（44 assertions），C1+C2+S1+L1 `47/47`（224 assertions），Agent full `1409/1409`（24069
> expect()，174 files），targeted ESLint、Prettier 与 Bun build 通过。`tsc` 仍只受既有 Bun/Node/DOM 类型与 monorepo
> rootDir 环境问题阻断；新增 L1 除该环境类错误外无独立类型错误。真实 `.env`/credential、DeepSeek/Qwen、正式
> marker/journal/report/artifact/recovery claim、Docker/API/browser、Trace、业务写入均为 `0`。
>
> 本记录不是 Live authority。提交并推送当前 source 后，仍需对新 commit 重新接受 DeepSeek/Qwen 数据边界并给出 exact
> authorization，才可执行唯一一次 controlled canary；成功也只形成 transport diagnostic authority，不解锁
> semantic/product/main。验收见 `docs/acceptance/phase-6-9-8-retriever-final-response-transport-reentry-v2-l1-implementation-zero-provider.md`。

> 2026-08-07 — Phase 6.9.8 Transport Re-entry V2 S1 reviewed Mock/static 已完成：
>
> 三个 bounded synthetic first-party adapter（DeepSeek rewrite、Qwen embedding、DeepSeek FinalResponse）均通过同一个
> C2 `rewrite -> qwen -> final_response` runner seam；success wire 为 runner `3/3/3/3`、adapter/provider wire
> `3/3/3/3`，usage 为 `480/120/600`，synthetic port calls=`3`，正式 `providerCalls=0`、`credentialReads=0`。
> 首错 `timeout/transport/schema/usage` 与 `abort_before_qwen` fault matrix 全部 validator-valid，breaker/no-retry/
> suffix 不补发成立；临时 evidence root 每 case 精确清理。
>
> 初始 S1 reviewed Mock checkpoint focused 与 C2 合计 `21/21`（133 assertions），Agent full `1393/1393`（24008 expect()，173 files）；
> 后续 source-admission 修复回归的最终数字见下一条记录。package
> typecheck/lint、Prettier 与 `git diff --check` 通过。固定 factory SHA=`sha256:c50b257dd79cd0f9a36f6f93a375ac19deda8b1e9d15ef9cc0d845ad5f64cc20`，
> report SHA=`8538b13ca16e8c011f00fcec815ca10de60638cd3ddc7e543edeb2d49b96c068`；gate=
> `transport_reentry_v2_s1_mock_quality_not_evidence / qualityAuthority=none`。真实 `.env`/credential、Provider、正式
> marker/journal/artifact/recovery claim、Docker/API/browser、Trace、BackgroundJob、Outbox 与业务写入均为 `0`。
>
> 本轮三路只读子代理尝试均因服务端 `429 Too Many Requests` 超过重试上限，未形成独立复审证据；主代理完成静态
> contract/security/operations 复核，文档不虚报子代理通过。S1 不证明真实模型语义、Provider health、产品/API/browser、
> P95/SLA 或 `main`。提交推送后必须在 clean source 上重跑 S1 CLI，确认 branch/HEAD/upstream/origin parity；随后停止在
> V2 L1 的两条 exact authorization 门，不执行 Live、Docker、browser 或 main。
> 验收见 `docs/acceptance/phase-6-9-8-retriever-final-response-transport-reentry-v2-s1-reviewed-mock-static.md`。

> 2026-08-07 — S1 source-admission 修复回归已完成：
>
> 发现提交推送后的 S1 CLI 仍返回 `source_admission_invalid`，根因是 admission 将 `.tmp` 目录中所有历史运行文件误计为当前
> V2 formal evidence。修复后只按当前 V2 writable-path contract 统计 marker/journal/recovery/report/root artifact；历史
> T3/R5/Task 9C 文件与普通日志不再阻断 admission，`.tmp` 缺失按空目录处理，其他目录读取异常保持 fail-closed。新增回归覆盖
> 历史文件忽略、当前 lineage 路径占用、缺失 `.tmp` 与非 `ENOENT` 读取失败；focused（S1+C2）`22/22`（136
> assertions）、Agent full `1394/1394`（24011 expect()，173 files）、typecheck/lint/Prettier/`git diff --check` 均通过。
> 该修复不读取 credential、不调用 Provider、
> 不创建正式 evidence，也不改变 S1 gate/authority 或 L1 授权门。

> 2026-08-07 — Phase 6.9.8 Transport Re-entry V2 C2 zero-provider runner/durability 已完成：
>
> C2 将 C1 的三个 dedicated capability 收口为单次 opaque configuration capability，并在 synthetic root 中落地
> `rewrite -> qwen -> final_response` 固定三槽、exclusive marker、reservation-before-dispatch、fsynced hash-chain
> journal、hard-link artifact、strict validator 与 crash-only recovery。invalid C1 projection 在 marker 前失败；首错
> breaker/no-retry 覆盖 missing/invalid/conflict/abort/timeout/transport/schema/usage，publication interruption 只恢复
> 同一 terminal，不重放 port call。
>
> C2 focused `15/15`（88 assertions），synthetic CLI 的 success + 8 fault cases 与 publication recovery 全部通过；Agent
> full `1387/1387`（23957 expect()，172 files），typecheck/lint/Prettier 通过。真实 Provider、credential、正式
> marker/journal/artifact/recovery claim、Docker/API/browser、Trace 与业务写入均为 `0`。旧 T3/R5/Task 9C 只读 validator
> 仍分别为 `ok=true`，sealed SHA 未改变。authority=`zero_provider_transport_reentry_v2_c2 /
qualityAuthority=none`；（当时）下一原子任务为 S1 reviewed Mock/static，V2 L1 仍需新的数据边界接受与 exact authorization。
> 验收见 `docs/acceptance/phase-6-9-8-retriever-final-response-transport-reentry-v2-c2-zero-provider-runner-durability.md`。

> 2026-08-07 — Phase 6.9.8 Transport Re-entry V2 C1 zero-provider launcher/projection contract 已完成：
>
> 新增 bounded root-env parser、launcher-location root resolver、exact pre-credential gate 与 dedicated capability
> projection。parser 覆盖 UTF-8/BOM、CRLF/LF、引号、duplicate/unknown/empty/interpolation/multiline/non-ASCII/
> accessor hostile 输入；runtime core 不读取 `process.env`。generic `DEEPSEEK_API_KEY`/`QWEN_API_KEY` 只在内存中
> 投影为绑定 `lineage + family + callId` 的 module-owned WeakMap/WeakSet single-use capability，伪造/复用/跨界均
> fail-closed；consumer 只返回不含 raw key 的 opaque receipt，密钥不会暴露给 runtime/adapter 或写入 evidence。
>
> C1 focused `10/10`（38 assertions）、Agent full `1372/1372`（23864 expect()，171 files）、synthetic CLI
> `providerCalls=0 / credentialReads=0 / formalEvidence=0`，typecheck/lint/Prettier/`git diff --check` 全部通过；旧 T3
> 只读 validator 仍为 `ok=true / journal=7`，其 sealed
> bytes/authority 未改变。C1 未读取真实 `.env`/credential、未调用 Provider、未创建正式 marker/journal/artifact/
> recovery claim、未启动 Docker/API/browser 或写业务数据。C1 已由上方 C2 回执收口；其历史验收见
> `docs/acceptance/phase-6-9-8-retriever-final-response-transport-reentry-v2-c1-zero-provider-launcher-projection.md`。

> 2026-08-07 — Phase 6.9.8 Transport Re-entry V2 D0 zero-provider design 已完成：
>
> 在旧 T3 `configuration_invalid` 一次性失败封存后，冻结全新 lineage
> `phase-6.9.8-retriever-final-response-transport-reentry-v2`。新路线把根 `.env` operator input 与 runtime capability
> 分层：future root launcher 只在 exact args/source/T2+T3-C/proxy/data-boundary/authorization 通过后读取
> `DEEPSEEK_API_KEY`/`QWEN_API_KEY`，再投影为 module-owned、single-use dedicated capability；configuration failure
> 在 marker 前收口，不消费 V2 一次性 marker。
>
> 未来 L1 固定 `rewrite -> qwen -> final_response`、最多 3 calls、`0.024096 CNY` cap、4000/5500/20000ms hard
> timeout、首错 breaker 与 no-retry。D0 自身 Provider/credential/formal evidence/业务写入均为 `0`，authority=
> `zero_provider_transport_reentry_v2_design / qualityAuthority=none`；下一原子任务仅 C1 zero-provider
> launcher/projection contract，没有新数据边界接受和 exact authorization 前不得执行 L1。设计、计划与验收见
> `docs/superpowers/specs/phase-6-9-8-retriever-final-response-transport-reentry-v2-design.md`、
> `docs/superpowers/plans/phase-6-9-8-retriever-final-response-transport-reentry-v2.md` 与
> `docs/acceptance/phase-6-9-8-retriever-final-response-transport-reentry-v2-d0-zero-provider-design.md`。

> 2026-08-07 — T3 失败诊断口径复核：
>
> 对 Transport Evidence Recovery T3 的设计与验收文字做了独立证据复核。sealed fact 仅为
> `configuration_invalid` 出现在 durable reservation 后、首个 Provider slot 前，且 `providerCalls=0`；“未显式绑定
> 根 `.env`”现在明确标注为静态复盘得到的 configuration-composition 风险/修复假设，不再写成已被本次 artifact 唯一证明的
> 根因。该修订不改写 marker、journal、report、artifact 或一次性名额，也不解锁任何新 Live/产品验收。
>
> 2026-08-07 — Phase 6.9.8 Transport Evidence Recovery T3-C configuration composition zero-provider guard 已完成：
>
> 新增 `packages/agent/tests/phase-6-9-8-retriever-final-response-transport-evidence-t3-configuration.test.ts`，静态
> 验证 controlled package script 从 package cwd 使用 `bun --env-file=../../.env` 指向仓库根 `.env`，并验证 crash-only
> seal CLI 不携带 credential、`process.env`、fetch 或 Provider port。focused `2/2`（10 assertions）、typecheck/lint/
> `git diff --check` 通过；不读取真实 `.env`、不调用 Provider、不创建正式 evidence。authority=
> `zero_provider_transport_evidence_t3_configuration_guard / qualityAuthority=none`。
>
> 该 guard 只防止 T3 配置入口回归，不恢复已消费的一次性 T3 名额，也不解锁产品、main 或后续阶段。验收见
> `docs/acceptance/phase-6-9-8-retriever-final-response-transport-evidence-recovery-t3-configuration-zero-provider.md`。

> 2026-08-07 — Phase 6.9.8 Transport Evidence Recovery T3 controlled canary 已按用户一次性授权执行并 durable seal：
>
> 唯一 run `075e2d5f-682b-426d-847e-f5a6ce5b97c6` 在 source commit
> `2423baf3768c245d2e4d6ea0038c6fb1bf8f9bc7` 上通过 source/T2/direct-proxy/data-boundary/approval gate，并在
> late-bound credential gate 以 `configuration_invalid` 停止。固定顺序为 `DeepSeek rewrite -> Qwen embedding ->
DeepSeek FinalResponse stream`；planned/started/completed=`3/0/0`，breaker reason=`configuration`，三个 suffix lane
> 均为 `not_started_quality_breaker`，Provider calls=`0`、credential reads=`0`、verified usage/cost/semantic/P95 全为
> `null`。这属于 CLI/configuration composition 失败，不是 Provider transport 失败，不能归因 DNS、TLS、代理、账号、
> 余额、模型权限或服务端，也不能证明 Retriever/FinalResponse 真实语义或产品可用。
>
> Crash-only seal 已完成：authority=`controlled_live_transport_evidence_t3`、`qualityAuthority=none`，journal `7`
> 条并以 `evidence_published` 收口，validator `ok=true`；report logical SHA=`8d529bb78ce2fc18129e5561f1306855bbdaa6a40f8007921c3ffa0bd14875d1`，
> physical artifact SHA=`50beb053475f8bb6b652624ec533347728740c60c5a3902757fa71f3a247ee9c`。T3 一次性名额已消费，禁止
> retry/resume/replay/backfill、seal/recovery、curl、单 case、追加 Provider 探测或删除/改写 artifact。补充提交
> `3d903055` 已让受控 package script 显式加载仓库根 `.env`，并增加仅限 crash-only seal 的 CLI；该修复不能用于重跑本次
> T3。产品 Docker/API/browser、Trace、main、Phase 6.9.8 后续任务与 Phase 6.10 继续阻断。完整验收见
> `docs/acceptance/phase-6-9-8-retriever-final-response-transport-evidence-recovery-t3-controlled-canary-failure.md`。

> 2026-08-06 — Phase 6.9.8 Transport Evidence Recovery T3-A zero-provider admission/runner 已完成：
>
> 新增独立 source admission、T2 gate binding、branch/HEAD/upstream/origin parity、clean tree/formal artifact fence、
> source bundle SHA、admission/reservation 双 opaque single-consume capability、fresh proxy nonce 与 exact data-boundary/
> authorization reader。CLI gate 顺序固定为 `argv -> source -> T2 -> proxy -> boundary -> authorization -> runner`，
> proxy watchdog 为 `1000ms`，不暴露 credential/provider/fetch port。
>
> Zero-provider runner 固定 `rewrite -> qwen -> final_response` 三槽位、最多 3 slots、总预算 `0.024096 CNY`
> （`0.005 + 0.004096 + 0.015`，每个 slot 各一次；不复用 Task 9 的 32-call Qwen cap）；首个
> synthetic failure/timeout/abort 打开 breaker，未启动 suffix 保留在固定分母。T3-A focused `12/12`（49 assertions），
> Agent full `1360/1360`（23805 expect()，169 files），typecheck/lint/Prettier/`git diff --check` 均通过。Provider、
> credential、global fetch、formal evidence、业务/Trace 写入均为 `0`，authority 固定为
> `zero_provider_transport_evidence_t3_admission / qualityAuthority=none`。
>
> T3-A 不能证明 Provider health、真实 Retriever/FinalResponse 语义或产品可用性；这是 T3 controlled 之前的历史 checkpoint。
> 随后唯一 T3 已按新授权执行并以 configuration failure durable seal，不能重跑或追加探测。详见
> `docs/acceptance/phase-6-9-8-retriever-final-response-transport-evidence-recovery-t3-zero-provider-admission.md` 与
> `docs/acceptance/phase-6-9-8-retriever-final-response-transport-evidence-recovery-t3-controlled-canary-failure.md`。

> 2026-08-06 — Phase 6.9.8 Transport Evidence Recovery T2 robustness + durability static 已完成：
>
> 在 T0/T1 独立 lineage 上完成 `3 family × 8 cases + 6 boundary/capability/publication cases = 30` 个
> zero-provider case 与 `15` 个 bounded classifier fixture。T2 覆盖唯一 marker、严格 journal state machine、
> partial/terminal prefix crash-only recovery、幂等 report snapshot、artifact publication recovery、multiple-marker
> rejection、Windows/Bun fsync 兼容、hard-link artifact 与 strict validator；synthetic temp-root 在每个 case 后精确清理。
>
> focused `11/11`（39 assertions）、Agent full `1348/1348`（23746 expect()，168 files）、typecheck/lint/Prettier/
> `git diff --check` 全部通过；Provider、global fetch、credential、Docker/API/browser、正式 evidence 与业务写入均为
> `0`。authority 固定为 `zero_provider_transport_evidence_t2 / qualityAuthority=none`，gate 为
> `transport_evidence_t2_zero_provider_passed`。T2 只说明可以讨论是否值得申请新的最多 3-slot transport canary，
> 不自动解锁 T3、R6/R7、main 或产品验收；后续若申请 T3，必须重新接受当次 DeepSeek/Qwen 数据边界并给出全新 exact
> authorization。验收见
> `docs/acceptance/phase-6-9-8-retriever-final-response-transport-evidence-recovery-t2-zero-provider-robustness-durability.md`。
>
> 2026-08-06 — Phase 6.9.8 Transport Evidence Recovery T1 strict contract + TDD 已完成：
>
> 在 T0 独立 lineage 之上新增 strict no-raw diagnostic schema/parser，固定五阶段
> `preflight -> dispatch_started -> response_observed -> usage_observed -> terminal`、provider boundary、reason
> bucket 与 `providerWire/runnerWire` 单调关系；rewrite、Qwen、FinalResponse 各自持有 module-private single-consume
> WeakMap/WeakSet capability，跨 family/call、forged、reused、active 与 out-of-order 输入均 fail-closed。
>
> focused `8/8`（51 assertions）、Agent full `1337/1337`（23700 expect()）、typecheck/lint/Prettier 均通过；Provider、
> credential、global fetch、Docker/API/browser、formal marker/journal/artifact/recovery claim 与业务写入均为 0。未知
> 类别继续保持 `unknown`，不会把 R5 历史 `provider_dispatch / unknown` 反向归因。T1 验收见
> `docs/acceptance/phase-6-9-8-retriever-final-response-transport-evidence-recovery-t1-zero-provider-tdd.md`；该条是 T2
> 完成前的历史 checkpoint，当前以本日志最上方 T2 回执为准。
>
> 2026-08-06 — Phase 6.9.8 Transport Evidence Recovery T0 决策：
>
> R5 的 `provider_dispatch / unknown` 不能安全归因到 DNS、TLS、代理、账号、余额、权限或服务端，因此不重跑
> R5，也不直接进入产品验收。新 lineage `phase-6.9.8-retriever-final-response-transport-evidence-v1` 先做
> zero-provider 可判别性：3 个 family × 8 个固定边界/失败类，加 6 个 abort/capability/publication cases，共
> `30` cases；只保留 stage/reason/boundary/wire/opaque callId，`rawDataRetained=false`。
>
> T0 已冻结 ADR、contract、authority、停止条件和最多 3-slot canary 的决策门；T1 已完成，T2 随后也已完成，未读取 credential、未调用
> Provider、未创建 formal evidence，不解锁 R6/R7/main。T1 为 strict contract/TDD，T2 为 robustness/durability static，
> T3（可选）才是重新授权后的 transport-only canary。完整设计与计划见
> `docs/superpowers/specs/phase-6-9-8-retriever-final-response-transport-evidence-recovery-design.md` 与
> `docs/superpowers/plans/phase-6-9-8-retriever-final-response-transport-evidence-recovery.md`；T0 验收见
> `docs/acceptance/phase-6-9-8-retriever-final-response-transport-evidence-recovery-t0-zero-provider-design.md`；T1 验收见
> `docs/acceptance/phase-6-9-8-retriever-final-response-transport-evidence-recovery-t1-zero-provider-tdd.md`。
>
> 2026-08-06 — Phase 6.9.8 Retriever / FinalResponse Architecture Recovery R5 controlled-Live 已封存：
>
> 在 approved source/tag `6570ce05...`、clean source admission 和 `loopback_proxy_ready` preflight 后，按用户接受的
> DeepSeek/Qwen 数据边界执行了唯一一次 run `34eb99be-bdeb-41e5-85cf-3c651ecefc68`。16 guards 全部通过且 zero-call；
> 首个 rewrite pair 完成 Qwen original、DeepSeek rewrite、Qwen candidate，第二个 pair 的 DeepSeek rewrite 在
> `provider_dispatch` 以 bounded `reasonCode=unknown / providerBoundary=unknown / rawDataRetained=false` 失败，
> breaker 将剩余 59 slots 收为 not-started。最终 runner dispatch `5`、external Provider calls `4`、Qwen `3`、DeepSeek
> `1`，wire 为 Qwen `3/3/3/3`、DeepSeek `1/1/1/1`（runner DeepSeek `2/2/1/1`），gate 为
> `architecture_recovery_quality_gate_failed / qualityAuthority=none`；rewrite strict `1/16`、FinalResponse `0/16`，
> semantic/P95/verified aggregate usage 与费用全为 `null`。已观察前缀 usage 为 Qwen `326` input / `0.000163 CNY`、
> DeepSeek `178/23` input/output / `0.000672 CNY`，不能当作完整 run aggregate。Journal `237` 条以
> `evidence_published` 收口，recovery claim=`null`，strict validator `ok=true / bundle_valid`，artifact SHA=
> `423e3f2e4dcb442a71a346334624642ca7c14ed898c894b5180910d04943b1e5`。该证据不能归因具体 DNS/TLS/代理/账号/余额/
> 权限/服务端根因，也不能证明 Retriever/FinalResponse 语义或产品可用；R5 一次性名额已消费，R6 产品验收继续阻断。
> 正式 CLI 启动前曾因 `.env` UTF-8 BOM 发生一次环境加载退出；该过程没有进入 source admission/reservation、没有
> Provider call，也不计为 controlled-Live。随后执行并封存的上述 run 是唯一 R5 Live。
> 详见 `docs/acceptance/phase-6-9-8-retriever-final-response-architecture-recovery-r5-controlled-live.md`。
>
> 2026-08-06 — Phase 6.9.8 Retriever / FinalResponse Architecture Recovery R5（Live 前准备完成）：
>
> R5 独立 lineage 的 DeepSeek query rewrite、Qwen `text-embedding-v4` original/candidate retrieval、DeepSeek
> FinalResponse stream、三模块私有 observation、64-slot runner、source admission、reservation-before-dispatch、
> hash-chain journal、hard-link artifact、strict validator 与 crash-only seal 已落地。针对独立复审已补齐 FinalResponse
> citation coverage（缺失/多余/重复均 fail-closed）、固定检索 fixture（不从 query/context/oracle 构造 target）、
> `suspicious + verifier unavailable` 保守投影和 Qwen usage/cost 超预算诊断；reservation 后异常会明确
> `providerCalls=null / crashOnlySealRequired=true`。Focused `18/18`、R5 CLI `6/6`、Agent 全量 `1329/1329`，
> typecheck/lint/Prettier 通过。该 Live 前 checkpoint 当时尚未读取 credential、调用 Provider、创建
> approved tag/marker/journal/artifact，也未启动 Docker/API/browser；用户已接受 DeepSeek/Qwen 数据边界并授权
> 唯一一次 R5 controlled-Live。后续该唯一 run 已失败封存。详细验收见
> `docs/acceptance/phase-6-9-8-retriever-final-response-architecture-recovery-r5-controlled-live.md`。
>
> 2026-08-06 — Phase 6.9.8 Retriever / FinalResponse Architecture Recovery R4：
>
> R4 zero-provider reviewed Mock/static 已完成。Task 8 的 production Retriever/FinalResponse node、ledger 与
> prompt-only responder 先完成本地 bounded projection，再接入 R3 synthetic-admitted runner；固定 `16 guards + 16
rewrite pairs + 16 FinalResponse = 64 slots`。结果为 guard `16/16` zero-call、rewrite/FinalResponse `16/16`、
> runner/provider wire `64/64/64/64`、diagnostic `64 applied`，安全失败与未启动均为 `0`。Gate 固定
> `architecture_recovery_mock_quality_not_evidence / qualityAuthority=none`；Provider、credential、formal
> approved tag/marker/journal/artifact/recovery claim 与业务写入均为 `0`。
>
> DeepSeek synthetic accounting `8704/225`、Qwen `4096/0` 得到预算回归值 `0.02951 CNY`；由于没有 Provider
> verified usage，`aggregateVerifiedProviderCostCny=null`。prompt-only responder 只接收实际 bounded prompt，expected/
> oracle 只在后置 scorer 使用；三个模块的 observation 继续由私有 single-use WeakMap 签发并绑定
> `callId + phase + family`，forged/reused/cross-call/cross-family/out-of-order 均 fail-closed。
>
> R4 focused `5/5`（`32` assertions），与 R3 parity、Task 8 回归合计 `29/29` tests、`200` assertions；Agent 全量
> 回归为 `1323` tests / `165` files / `23579` expect() calls / `0` fail。Prettier、
> lint、`git diff --check` 与独立 Reader Testing 通过。新增验收见
> `docs/acceptance/phase-6-9-8-retriever-final-response-architecture-recovery-r4-reviewed-mock-static.md`；同步更新
> AGENTS、README、roadmap、acceptance checklist、dev-start、data-flow 与本计划/设计。该 R4 checkpoint 当时的
> R5 controlled-Live 尚未授权、未开始；后续唯一 R5 已失败封存，且仍未执行 Docker/API/browser、Trace 产品验收或
> main 合并。
>
> 2026-08-06 — Phase 6.9.8 Retriever / FinalResponse Architecture Recovery R3：
>
> 本任务以
> `zero_provider_retriever_final_response_architecture_recovery_runner_durability_admission /
qualityAuthority=none` 完成独立 report/runner、三模块 observation authority、source admission、durability、strict
> validator 与 zero-provider maintenance CLI。Runner 固定执行 `16 guards + 16 rewrite pairs + 16 FinalResponse =
64 Provider call slots`，分别记录 reservation/dispatch/harness-return/verified-result 的 `runnerWire` 与第一方
> executor/dispatch/response/verified-usage 的 `providerWire`。首个失败打开 breaker，后续不启动；分母不完整时
> semantic、P95、token 与 CNY aggregate 全为 `null`。
>
> 独立复审发现早期草案的共享 observation issuer 虽使用 WeakMap token，却仍是可导入函数，调用者可以绕过“只有
> 第一方模块签发”的边界。最终实现删除共享 issuer，改为 Rewrite/Qwen/FinalResponse 各自的模块私有 WeakMap
> 单次签发与消费；共享模块只校验从私有 map 取回的 bounded record。Capability 精确绑定
> `callId + phase + family`，forged/active/reused/cross-call/cross-family/out-of-order 全部 fail-closed，synthetic outcome
> 也不能升级为 controlled-Live authority。
>
> Source admission 绑定 branch、HEAD/upstream/origin/new approved ref、clean tree、formal evidence=0、旧 Task 9C
> identity 与完整 source bundle SHA，并用 admission/reservation 双 opaque capability 分权。Durability 已实现
> exclusive marker、reservation-before-dispatch、fsynced hash-chain diagnostic journal、exclusive temp + hard-link
> artifact、strict replay/recompute validator 与 crash-only seal。`run_terminal` 后和 `publication_started` 后崩溃可只
> 恢复 terminal publication；recovery claim 严格绑定 `recovery_claimed.previousHash`，即使重算后续 hash 的 tail drift
> 也被拒绝。旧 Task 9C namespace 有显式只读写围栏。
>
> R0--R3 focused `39/39 / 7 files / 455 assertions`、Agent full `1318/1318`、AI full `345/345`、Agent
> typecheck/lint、Prettier 与 `git diff --check` 通过。Task 9C 只读 validator 保持
> `ok=true / 134 / evidence_published`，report/artifact SHA 仍为
> `c612d6f7164d5491e54422abb2e8504cbb707aeea3b641e8c57285d957b8b4a4 /
7d45329debde6def4c5bc8bbda28609b507a71766ae06e00806e44eaf7b3614c`；没有运行旧 CLI/seal 或改写 sealed
> evidence。
>
> 独立 Reader Testing 对 8 个关键问题均能从 R3 design/plan/acceptance 准确回答，未发现坏链接或自相矛盾；
> Markdown 相对链接、current-status、secret 与正式 evidence=0 扫描通过。独立安全复审无 blocker，同时保留一个
> 诚实 residual boundary：标准 Node 文件路径检查不形成 hostile same-user 进程并发替换 `.tmp`/子路径、跨主机
> lease 或 Provider exactly-once authority；该边界不影响本次 zero-provider checkpoint，但未来生产 admission 必须
> 继续按受信单机 workspace 处理或另行强化。
>
> 本阶段 external Provider/DeepSeek/Qwen/credential/formal R3 tag/marker/journal/artifact/recovery claim、正式 R3
> validate/seal、Docker/API/browser 与业务写均为 0。公开 CLI 只接受 validate/seal 两个 zero-provider maintenance
> argv，不存在 Live/retry/replay/resume/backfill argv。R3 独立提交并推送后，下一原子任务仅 R4 zero-provider
> reviewed Mock/static；R5--R7、Task 10/11、main、Phase 6.9.9+ 和记忆/博客收尾继续阻断。验收见
> `docs/acceptance/phase-6-9-8-retriever-final-response-architecture-recovery-r3-runner-durability-admission.md`。回顾时可以
> 问：两层 wire 分别证明什么？为什么共享 issuer 不可信？为什么 recovery claim 要绑定
> `recovery_claimed.previousHash`？为什么 R3 完成仍不能进入 Live 或产品验收？
>
> 2026-08-06 — Phase 6.9.8 Retriever / FinalResponse Architecture Recovery R2：
>
> 本任务以
> `zero_provider_retriever_final_response_architecture_recovery_robustness / qualityAuthority=none` 完成 Qwen
> retrieval 与 DeepSeek FinalResponse stream 的第一方 wire diagnostics、recovery stage projection 和
> zero-provider robustness。新 `phase-6.9.8-provider-wire-diagnostics-v1` 把调用分成
> `qwen_retrieval/final_response_stream` 两个互斥 family；各自使用 module-owned WeakMap capability、single claim、
> 严格 stage sequence、terminal frozen snapshot 与从 stage 推导的 0/1 counter。
>
> Qwen 第一方 adapter 现在把 transport、HTTP、envelope、embedding count/index、dimension、finite/non-zero value
> 与 verified usage 分域；Provider `data` 顺序变化仍按 index 本地重建，missing/duplicate/out-of-range 不做修复。
> FinalResponse 第一方 stream adapter 则区分 transport/HTTP、stream event、terminal missing/duplicate/not-last、
> false-tool success、usage 与 abort。第一条实际 stream event 即使畸形，也只形成
> `response_observed + stream_event_invalid`；只有确实没有观察到 Response/event 才是
> `response_not_observed`，两者都不表示 success。
>
> `@repo/ai` 公共 barrel 只导出 wire create/read，claim/advance/fail/complete/set-shape mutation 仍留在第一方
> adapter 内。Qwen/FinalResponse recovery session 只接受真实、未使用、family 匹配且未重复绑定的 capability；
> forged/reused/active/cross-family/out-of-order 均 fail-closed。Diagnostic 只保留 fixed stage/reason/boundary/type-
> count bucket 与 `rawDataRetained=false`，不保存 raw、prompt/query、stream delta、credential/URL/error、unknown key
> 或 raw-derived hash。
>
> 包内 cost/ranking/citation/Trace/delivery/result mapper 仍只接收 fixed status，尚未与 source-admitted runner、
> strict validator 和 durability lifecycle 绑定，因此 R2 不形成数值、durability、Provider、语义、产品或 main
> authority；该边界留给 R3。R2 也没有新增 CLI、tag、admission、marker/journal/artifact/recovery claim、环境变量、
> gate、BackgroundJob、Outbox 或业务写入。
>
> 验证结果为 R1/R2 + affected Task 9 compatibility `58/58 / 10 files / 522 assertions`、AI full
> `345/345 / 28 files / 2651 assertions`、Agent full `1301/1301 / 161 files / 23364 assertions`；Agent/AI
> typecheck 与 lint 均通过。Task 9C 只读 validator 保持
> `ok=true / 134 / evidence_published`，report/artifact SHA 仍为
> `c612d6f7164d5491e54422abb2e8504cbb707aeea3b641e8c57285d957b8b4a4 /
7d45329debde6def4c5bc8bbda28609b507a71766ae06e00806e44eaf7b3614c`；没有运行旧 CLI/seal 或改写 sealed
> evidence。两路独立只读复审均无 blocking/high，测试复审建议的 HTTP 分类与 mid-stream abort 缺口已补齐。
> Post-format R2 focused `23/23 / 4 files / 258 assertions`、Prettier、`git diff --check`、CodeGraph 与仓库
> Markdown `365 files / 189 links / missing=0` 均通过；current-status、secret candidate 与 forbidden diagnostic
> field 扫描无未关闭命中。
>
> R2 external Provider/DeepSeek/Qwen/credential/formal evidence/Docker/API/browser/business writes 均为 0。下一原子
> 任务仅 R3 zero-provider source admission / runner / durability；R4--R7、Task 10/11、main 与后续阶段继续阻断。
> 验收见
> `docs/acceptance/phase-6-9-8-retriever-final-response-architecture-recovery-r2-zero-provider-robustness.md`。回顾时可以
> 问：为什么 Qwen/FinalResponse 必须分 family？为什么畸形首事件仍是 response observed？为什么 R2 mapper
> 通过后仍不是 durability 或数值 authority？
>
> 2026-08-05 — Phase 6.9.8 Retriever / FinalResponse Architecture Recovery R1：
>
> 本任务以
> `zero_provider_retriever_final_response_architecture_recovery_tdd / qualityAuthority=none` 完成 strict bounded
> diagnostic contract、module-owned opaque rewrite session、第一方 V7 wire snapshot 只读投影与 rewrite TDD。最终
> Provider observation 不再接受 caller-supplied dispatch/response/envelope/usage 状态；session 只能绑定一个真实、
> 未使用且未被重复绑定的 wire capability，forged/reused/active snapshot 均不能推进 Provider authority。
>
> Synthetic success/fault 用例真实穿过第一方 DeepSeek V4 Pro direct adapter 的 injected fetch，覆盖 transport、HTTP、
> envelope、usage、runtime result、candidate、local authority、Trace、cost、call result、hostile response 与单调阶段
> precedence；adapter provenance 固定为 `synthetic_test`，不读取 credential、不访问网络。`@repo/ai` 只新增 frozen
> snapshot reader；claim/advance/fail/abort/complete mutation 与所有 R1 transition 均不进入公共 Agent barrel。
>
> Diagnostic 只保留 fixed call phase/stage/reason/provider boundary/type-count bucket 与
> `rawDataRetained=false`。它拒绝 unknown field、raw/raw-derived hash、query/prompt/rewrite value、credential/URL/raw
> error、hostile getter/Proxy/symbol/non-plain value。`applied` 是单 call 唯一成功 terminal，但不表示整份 gate、产品
> 或 main 通过。包内 runtime/candidate/local-authority/Trace/cost/result mapper 尚未与 source-admitted runner/
> validator 绑定，因此 R1 不形成 durability 或数值 Provider authority；该边界留给 R3。
>
> 验证结果为 focused `11/11 / 152 assertions`、第一方 wire + AI export `25/25 / 361 assertions`、Agent full
> `1289/1289 / 159 files / 23185 assertions`，Agent/AI typecheck 与 lint 通过。Task 9C 只读 validator 仍为
> `ok=true / 134 / evidence_published`，report/artifact SHA 保持
> `c612d6f7164d5491e54422abb2e8504cbb707aeea3b641e8c57285d957b8b4a4 /
7d45329debde6def4c5bc8bbda28609b507a71766ae06e00806e44eaf7b3614c`；没有运行旧 CLI/seal 或改写 sealed
> evidence。
>
> R1 Provider/DeepSeek/Qwen/credential/formal evidence/Docker/API/browser/business writes 均为 0；没有新增 CLI、tag、
> admission、gate、BackgroundJob 或 Outbox。R1 收口时的下一原子任务仅 R2 zero-provider Qwen / FinalResponse
> robustness；该 R2 后续已独立完成，未改写本回执。R3--R7、Task 10/11、main 与后续阶段当时继续阻断。验收见
> `docs/acceptance/phase-6-9-8-retriever-final-response-architecture-recovery-r1-zero-provider-tdd.md`。回顾时可以问：
> 为什么 caller-supplied `response_observed` 不可信？为什么只读 snapshot 可以公开而 mutation 不能？为什么 R1
> `applied` 仍不是质量或产品 authority？
>
> 2026-08-05 — Phase 6.9.8 Retriever / FinalResponse Architecture Recovery R0：
>
> Task 9C 失败封存后，本任务没有重跑 Provider，而是以
> `zero_provider_retriever_final_response_architecture_recovery_design / qualityAuthority=none` 完成独立 R0
> 设计冻结。只读源码复盘确认：rewrite live harness 会把 runtime invocation、candidate disposition、provenance、
> Trace、usage 与第一方 wire counters 的任一不匹配统一抛为 `schema_invalid`；runner 的 call-result strict
> schema/phase mismatch 也使用同一错误。Runner 又只在 harness 成功返回后记录 `response_received`，因此 Task 9C
> 的外层 `wire 1/1/0/0` 不能单独证明 Provider 没有响应，也不能直接写成错误 JSON。
>
> 新独立 lineage 固定为 `phase-6.9.8-retriever-final-response-architecture-recovery-v1`。方案不是只修当前
> rewrite，而是同时覆盖 DeepSeek rewrite、Qwen retrieval 与 DeepSeek FinalResponse stream；分别冻结阶段机，
> 分离 `providerWire` 与 `runnerWire`，保留 16 guards、64 calls、双 Provider budget/accounting、质量阈值、owner/
> citation/local authority、no-retry 与 breaker 语义。
>
> Bounded diagnostic 只允许 fixed `stage / reasonCode / providerBoundary / type-count bucket /
rawDataRetained=false`。明确不保存 Provider completion、stream delta、prompt、query、chunk、answer、credential、
> URL、raw error、Zod issue/path/value、unknown key，也不保存 raw-derived hash；journal hash-chain 未来只证明记录
> 完整性，不对 Provider/业务 raw 计算 hash。Hostile getter/Proxy、oracle leakage、fake Trace/usage/cost/wire、
> cross-owner 与 durability tamper 均已进入后续 zero-provider fault matrix。
>
> R0 全程 Provider/DeepSeek/Qwen/credential reads=`0/0/0/0`；TypeScript、`.env`、Task 9C tag/marker/journal/
> artifact、正式 Recovery evidence、Docker/API/browser 与业务数据均未修改。R0 只解锁 R1 zero-provider strict
> diagnostic contract、opaque capability 与 rewrite TDD；R2--R7、Task 10/11、main 与后续阶段继续阻断。设计、计划与
> 验收分别见 `docs/superpowers/specs/phase-6-9-8-retriever-final-response-architecture-recovery-design.md`、
> `docs/superpowers/plans/phase-6-9-8-retriever-final-response-architecture-recovery.md` 与
> `docs/acceptance/phase-6-9-8-retriever-final-response-architecture-recovery-r0-zero-provider-design.md`。回顾时可以问：
> 为什么 runner response 与 Provider response 必须分开？为什么 FinalResponse 不能照搬 Tutor ordinal recovery？
> 为什么连 raw hash 和 unknown key 名也不能保存？
>
> 2026-08-05 — Phase 6.9.8 Task 9C 唯一 controlled-Live 质量门失败封存：
>
> 用户逐字接受 DeepSeek + Qwen fresh 数据边界并给出 exact one-shot authorization 后，先完成 zero-provider
> admission：branch/HEAD/upstream/origin/approved tag 全部绑定
> `66a009ddb40b14d5117cfc0ec785a0d328708c5b`，source bundle SHA 为
> `2c1b2bb3...e23cf8`，工作树 clean、正式 evidence=0；approved tag 已推送。Proxy preflight 为
> `loopback_proxy_ready / configured=4 / probe=1 / providerCalls=0`，无关 Agent/Chat gate 保持关闭。
>
> 唯一 run `28b5f92f-7b16-4ec7-b9fa-7a51aa0c2ff2` 已由正常 runtime 路径 durable seal。Guard
> `16/16` pass 且 zero-call；完整分母仍为 64 calls，实际为 `4 succeeded / 1 failed / 59
not_started_quality_breaker`。Qwen wire/usage 为 `3/3/3/3`，DeepSeek 为 `2/2/1/1`。`rewrite_01`
> 完整成功；`rewrite_02` original Qwen 成功后，DeepSeek rewrite 在 dispatch 后以
> `schema_invalid / wire 1/1/0/0 / 895.038ms` 失败，breaker 阻止剩余 59 次调用。没有
> retry/resume/replay/backfill、BackgroundJob 或 Outbox。
>
> 最终 rewrite strict `1/16`、FinalResponse strict `0/16`；正式语义、五项 P95、Provider token/CNY 与总费用
> aggregate 全为 `null`。四条成功 entry 的 verified usage/cost 不是 run aggregate，失败 dispatch 的 usage/cost
> 未知，不能写成 0。Gate 为 `task9_quality_gate_failed / qualityAuthority=none`；该结果不形成 Retriever/
> FinalResponse 质量、SLA、产品、Docker/API/browser、Trace、main 或 Phase 6.9.8 authority。
>
> Journal `134` 条，以 `run_terminal -> publication_started -> evidence_published` 收口；report/artifact SHA 为
> `c612d6f7...b8b4a4 / 7d45329d...3614c`，strict validator `ok=true`，recovery claim=`null`。当前
> `schema_invalid` 只能证明 dispatch 后未满足本地 strict rewrite schema/contract；sealed evidence 不含 raw，
> 不能归因具体字段、Provider 内容、DNS/TLS/proxy、账号、余额、权限或服务端。
>
> Task 9C 一次性名额已消费，禁止 retry/resume/replay/backfill、补跑、seal/recovery、删除/改写 artifact 或追加
> Provider 探测。Task 10/11 与产品/main、Phase 6.9.9/6.9.10/6.10、Phase 8/9、两篇博客继续阻断。若继续，
> 截至 Task 9C 封存时，下一原子任务只能是独立 zero-provider bounded-diagnostic Architecture Recovery 设计，
> 不是 Task 9C 重跑；该设计现已由上方 R0 回执完成。验收见
> `docs/acceptance/phase-6-9-8-task-9c-controlled-live-quality-gate-failure.md`。回顾时可以问：为什么
> `schema_invalid + 1/1/0/0` 不能直接等于错误 JSON？为什么四条成功费用不能冒充 run 总账？为什么正常
> `evidence_published` 后不能再 seal？
>
> 2026-08-05 — Phase 6.9.8 Task 9B Runner / Durability / Admission：
>
> 在 Task 9A Qwen strict transport 之后，本任务以
> `zero_provider_retriever_final_response_runner_durability / qualityAuthority=none` 完成正式 Task 9 eval 的
> report/gate、runner、source admission、durability、strict validator 与未来 9C production CLI。固定调度为先跑
> 16 个 zero-call guard，再串行推进 16 个
> `original Qwen retrieval -> DeepSeek rewrite -> candidate Qwen retrieval` pair，最后运行 16 个 DeepSeek
> FinalResponse；完整分母为 64 calls，Qwen/DeepSeek 各 32。
>
> Qwen cap 固定为 `262144 input tokens / 0.131072 CNY`，DeepSeek cap 为 `0.32 CNY`，总 cap 为
> `0.451072 CNY`。两 Provider 独立记录 attempt/dispatch/response/verified usage/token/CNY；任一分母、usage、价格
> 或 terminal 不完整时相关 aggregate=`null`。普通 semantic mismatch 留在固定分母中由最终 gate 失败；首个
> guard/runtime/schema/usage/budget/timeout/abort/durability contract failure 打开 breaker，后续 schedule 以
> not-started terminal 保留，禁止 retry/resume/replay/backfill。
>
> Source admission 固定 branch/HEAD/upstream/origin/approved-tag/clean-tree/formal-artifact-zero 与 exact-commit blob
> bundle SHA；runner 与 reservation 分别消费独立 WeakMap opaque capability，调用者不能伪造 authority/source/
> credentialReads。Reservation 前重新读取 Git observation，关闭 admission-to-marker source drift。正常 evidence
> 使用 exclusive marker、dispatch-before-call fsynced hash-chain journal、exclusive temp + hard-link artifact 与
> strict recomputing validator；crash-only seal 只解释 durable prefix，不读取 credential、不构造 transport、不继续
> 执行或重放调用。句柄 stat/path lstat dev+ino 围栏、journal/lineage/tail tamper、active owner、duplicate claim 与
> publication conflict 均 fail-closed。
>
> Reviewed Mock 真实穿过 Task 9 runner/wire/scorer：guard `16/16`，Qwen/DeepSeek wire+usage 均
> `32/32/32/32`，rewrite original/candidate Recall@5 `0.875/1`、nDCG@5 `0.56923614767/1`、uplift
> `0.43076385233`；FinalResponse strict `16/16`，grounded/citation/critical notice 均为 `1`，安全失败为 0。
> Factory/report SHA 为 `38e35703...a586 / 820d7b2a...f07`。Gate 固定
> `task9b_mock_quality_not_evidence / qualityAuthority=none`；synthetic cost `0.02951 CNY` 与 synthetic P95 不是
> Provider bill 或 SLA。临时目录完整 durable Mock 得到 64-call、372-record journal、hard-link artifact、validator
> `ok=true`，随后精确删除。
>
> Task 9B focused `27/27`、Agent full `1279/1279 / 23051 expect()`、AI full
> `337/337 / 2598 expect()`、Agent typecheck/source lint、Prettier、`git diff --check`、CodeGraph sync 与
> Markdown `344 files / 168 links / missing=0` 通过；authority/contract/durability/docs 四路独立终审均无
> blocker。
> 全程 Provider/credential/Qwen external calls=`0/0/0`；未读取根 `.env`，未创建 approved tag 或正式 marker/
> journal/artifact/recovery claim，未启动 Docker/API/browser，未修改业务数据或合并 main。验收见
> `docs/acceptance/phase-6-9-8-task-9b-runner-durability-admission.md`。
>
> 截至 Task 9B 完成时，唯一下一原子任务是 Task 9C fresh admission + 唯一 controlled-Live。必须先完成 Task 9B 提交/推送/
> 复审与 source parity，再单独取得 fresh DeepSeek/Qwen 数据边界接受和精确一次性授权；此前不得创建 approved
> tag、读取专用 credential 或调用 Provider。回顾时可以问：为什么 16 个 rewrite pair 产生 48 次调用？为什么
> 双 Provider 必须独立记账？为什么 evidence I/O failure 不能伪装为 Provider failure？为什么 crash seal 不能
> resume？为什么 Mock 的完整 `32/32/32/32` 仍是 `qualityAuthority=none`？
>
> 2026-08-05 — Phase 6.9.8 Task 9A Qwen Embedding transport / official price contract：
>
> Task 8 终审确认正式 Task 9 仍缺 Qwen 可核验 usage/CNY transport 与独立 runner/durability，不能在取得一次性
> Live 授权后才临时补代码。因此 Task 9 拆成 9A/9B/9C；本原子任务先以
> `zero_provider_qwen_embedding_transport_price_contract / qualityAuthority=none` 完成 9A，后续 9B 仍为
> zero-provider，只有 9C 才允许在 fresh 精确授权后执行唯一 controlled-Live。
>
> 2026-08-05 重新核对阿里云百炼官方 `text-embedding-v4` 模型页、OpenAI-compatible Embedding 接口与同步
> API：北京区普通文本输入为 `0.5 CNY / 1M tokens`，业务空间 endpoint 为
> `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`，官方 legacy 北京域名仍兼容；模型支持
> 1536 维、单文本 8192 tokens、单次最多 10 条，响应含相等的 `prompt_tokens/total_tokens`。据此冻结 price
> profile `qwen-text-embedding-v4-cn-beijing-cny-2026-08-05`、endpoint profile 与 Task 9 的 32 次单文本最坏
> `262144 input tokens / 0.131072 CNY` cap；北京/新加坡价格不得混用，unknown usage/price 不能按 0 处理。
>
> `@repo/ai` 新增 `qwen-text-embedding-v4-provider-v1` 隔离 direct transport：不读取 env、不 retry、不保存 endpoint/
> key/raw error；config 只接受北京业务空间/legacy host、exact path/model/dimensions/profile。请求固定
> `/embeddings`、float、redirect error、credential omit；response strict 校验 exact list/model/id/data/usage、唯一连续
> index、1536 维 finite non-zero vector、`prompt_tokens == total_tokens` 与 provider token 上限，再按官方 price
> 本地重算 CNY 并 deep-freeze。Injected fetch 永久标记 `synthetic_test`，不能被 runner 提升为 Live authority。
>
> Focused provider/export `8/8 / 179 expect()`、AI full `337/337 / 2598 expect()`、AI typecheck/lint、Prettier、
> `git diff --check`、全仓 `343 Markdown / 167 relative links / missing=0` 与正式 Task 9 tag/.tmp/tracked evidence
> `0/0/0` 均通过。两路独立只读复审中 security 无 blocker，contract 复审要求补齐官方可审计价格来源，现已由
> 源码 source URL 常量与 acceptance 第 2 节完成。本任务未读取根 `.env`/credential、未调用 Qwen/DeepSeek/其它
> Provider、未启动 Docker/API/browser、未创建 approved tag/正式 marker/journal/artifact/recovery、未修改业务数据
> 或合并 main。验收见
> `docs/acceptance/phase-6-9-8-task-9a-qwen-embedding-transport-price-contract.md`。
>
> 当前唯一下一原子任务是 Task 9B：独立 report/gate、16 guard + 16 original/rewrite paired retrieval + 16
> FinalResponse scheduler、DeepSeek/Qwen 独立 attempt/usage/CNY、source admission、exclusive marker、dispatch-before-
> call hash-chain journal、hard-link artifact、strict validator 与 crash-only seal。9B 完成、提交、推送和复审前不创建
> approved tag；截至 Task 9A 完成时，Task 9C fresh 数据边界接受与精确授权尚未开始。回顾时可以问：为什么产品 Qwen 已可用仍缺 eval
> usage authority？为什么北京/新加坡要分 price profile？为什么 injected fetch 只能是 synthetic？为什么 transport
> 不自己拥有 runner timeout/journal？
>
> 2026-08-05 — Phase 6.9.8 Task 8 Retriever / FinalResponse reviewed Mock/static：
>
> 在普通分支 `drb/phase-6-9-8-retriever-final-response-contract`、Task 7 基线
> `a60692c8bf26bf99f1a9d7ee40f736b7f176ce23` 之后，以
> `zero_provider_retriever_final_response_reviewed_mock_static` 建立独立
> `phase-6.9.8-retriever-final-response-v1` 48-case checkpoint。Manifest 固定为
> `16 guard + 16 query rewrite + 16 FinalResponse`；manifest/policy/Mock factory/report SHA 分别为
> `3734b698...31d8 / e7f19f34...1464 / d9fa0ddc...c51 / 02294586...1be`，并锚定 Task 3 original-query
> baseline manifest/report `8a1788aa...654d / a1478f22...6442`，但不混用两个数据集的分母。
>
> Guard 实际穿过正式 Retriever/candidate eligibility 与 exact context authority，得到 `16/16` pass、`16/16`
> zero-call。Rewrite 的 original/candidate 两侧都穿过 production Retriever node 与固定 fake ranked search；candidate
> 只把真实 bounded prompt 交给独立 prompt-only Mock runtime，再经过本地 validator/merger。结果 strict/usage/
> invocation 为 `16/16/16`，original Recall@5/nDCG@5 为 `0.875/0.56923614767`，candidate 为 `1/1`，nDCG
> uplift `0.43076385233`，critical target recall 与 intent preservation 均为 `1`，unsafe rewrite=0。
>
> FinalResponse 侧实际穿过 Retriever result、本地 evidence projector、strict request、prompt-only Mock executor、
> production FinalResponse node、local citation renderer 与 terminal ledger；expected 只进入后置 scorer。结果
> strict/terminal/accounted usage 为 `16/16/16`，grounded rubric、citation precision、required citation recall 与
> critical notice recall 均为 `1`，false tool success/citation 为 `0/0`。Report 不保存 prompt、回答、owner、chunk、
> credential 或 raw error，只保留固定计数、usage、synthetic cost 与 hash audit；canonical bytes validator 对 mutation、
> invalid UTF-8 和所有冻结 SHA 漂移 fail-closed。
>
> Gate 为 `mock_quality_not_evidence / passed=true / qualityAuthority=none`。Synthetic DeepSeek 估算为
> `0.027366 CNY`，不是 verified bill；没有真实 Qwen embedding，故 Qwen/aggregate verified cost 与 P95 authority
> 均为 `null`。Provider/credential/Qwen calls=`0/0/0`，正式 marker/journal/evidence/recovery=`0/0/0/0`；source
> admission 与 single-consume/no-retry capability 已落地。终审发现早期 admission 只验证 bundle SHA 格式，无法
> 证明其来自声明源码；现已改为核对 actual Git top-level/branch/HEAD/upstream/origin ref/clean tree，并从 exact
> commit 的固定 source blobs 独立重算 canonical bundle SHA，伪造 SHA/ref 漂移/dirty tree/缺 blob 均 fail-closed。
> 项目本地 Codex 状态目录已通过仓库 `.gitignore` 固定排除，因此 `.codex/` 不会让未来 Task 9 admission 永久
> 失败；目录内容仍不进入版本控制，除此之外的 untracked/任何 tracked 漂移仍会关闭 admission。
> 静态报告仍明确 `sourceAdmissionExecuted=false`，不冒充 Task 9 admission。
>
> Task 8 focused `8/8`、受影响 Agent/Web 回归 `47/47 + 24/24`、Agent full `1252/1252`、Agent typecheck/lint、
> CLI frozen report、Prettier、diff 与 tracked Compose default-off 静态检查通过；两路独立只读终审无 blocker。未读取/使用模型 credential，未调用 Provider，
> 未启动 Docker/API/browser，未创建 approved tag/正式 evidence，未修改业务数据，也未合并 main；`.codex/` 保持
> 本地未跟踪、由 `.gitignore` 排除且未暂存。验收见
> `docs/acceptance/phase-6-9-8-task-8-retriever-final-response-reviewed-mock-static.md`。
>
> Task 8 完成后按当时计划停止；当时记录的下一任务是 Task 9 fresh admission，且不能把 Mock checkpoint 升级为
> Live authority。后续审计发现正式 Qwen transport/runner 仍缺失，现已由上方 Task 9A/9B/9C 拆分取代该旧停止点。
> 回顾时可以问：为什么 Task 3 与 Task 8 original baseline 指标不同？为什么 prompt-only responder 不能导入 oracle？
> 为什么 synthetic CNY/P95 不能形成质量 authority？为什么 source admission schema 已实现仍要记录未执行？
>
> 2026-08-05 — Phase 6.9.8 Task 7 Chat composition / terminal Trace：
>
> 在普通分支 `drb/phase-6-9-8-retriever-final-response-contract`、Task 6 基线
> `415c31e2f09acbff2099547121cfd3b6ffbac34d` 之后，以
> `zero_provider_chat_composition_terminal_trace` 完成实时 Chat composition 与 terminal Trace。
> `/api/chat` 已按 canonical auth -> minimal RUNNING Trace -> context -> Router/Tutor -> Retriever/query rewrite ->
> Verifier -> 本地 evidence projector -> Trace prepare -> FinalResponse stream -> terminal finalize 串联 Task 0--6
> 正式能力；anonymous Mock 在 Provider config 与 Agent runtime 前直接返回。
>
> Realtime Trace 新增 `start/prepare/finalize` 三阶段 API。Start 只保存 run/modelCall/conversation/mode/time 与安全
> placeholder；prepare 以 digest 幂等写入脱敏 Agent steps；finalize 使用 CAS，并可在 prepare ACK 不确定时原子补写
> 同一 preparation。成功 terminal 必须具备 preparation 与唯一 FinalResponse completed step；早期 failed/aborted
> 可无 preparation。`modelCallId` 全局唯一，legacy POST、late prepare 和第二个 concurrent finalize 均 fail-closed。
>
> AI SDK data stream 只映射正文、本地 citation Markdown 与诚实失败提示；sequence、citation lockstep、terminal-last
> 和唯一 terminal 由本地 ledger 校验。`Response.body.cancel()` 先 abort request scope，再 cancel 底层 reader；父
> `Request.signal` abort 也主动 cancel reader，cleanup/single-cancel 处理竞态。Retriever transport/schema failure
> 安全降级为 no-RAG，`ragIncluded=false` 时 bundle/citation/Markdown 整层清零；cross-scope principal binding
> 返回 403，abort 返回 499，其它非法 composition 返回 400。
>
> Focused Web composition/stream/abort/Trace/wiring `17/17`、Server AgentTracesService `17/17`、Types
> `42/42 + tsc`、Server build 与受影响 Web/Server lint 已通过。完整 Web `tsc` 仍命中仓库既有 `.test.mts`
> 类型债；按本任务文件名过滤后只剩未修改的 `chat-rag-context.test.mts:599` type-identity 诊断，Task 7 新增文件
> 无诊断。数据库 E2E 已更新覆盖 minimal start、
> prepare 幂等/冲突、legacy 409、late prepare 409 与 concurrent finalize 单胜者，但本地 Redis `6379` 与
> PostgreSQL `5433` 均未运行，Nest 重连后命令被 120 秒工具上限终止，因此如实标记
> `environment_blocked`，不声称真实数据库迁移/E2E authority。
>
> Task 7 未调用 Qwen/DeepSeek/其它 Provider，Provider calls=0；模型 gate 保持 default-off，同步流不创建
> `BackgroundJob`/`Outbox`。早期 Prisma wrapper 曾加载根 `.env` 进程环境，但未读取、输出或使用模型 credential；
> 后续直接 CLI 未再次加载。本任务未启动 Docker/API/browser、未执行 48-case/controlled-Live、未修改业务数据，
> 也未合并 main；`qualityAuthority=none`。当前只解锁 Task 8 deterministic baseline/reviewed Mock/static，产品与
> main 继续阻断。验收见
> `docs/acceptance/phase-6-9-8-task-7-chat-composition-terminal-trace.md`。
>
> 2026-08-04 — Phase 6.9.8 Task 6 FinalResponseAgent / stream contract：
>
> 在普通分支 `drb/phase-6-9-8-retriever-final-response-contract`、Task 5 基线
> `5c778b7711ad2187b43a5daf03edb73492d934d9` 之后，以
> `zero_provider_final_response_stream_contract` 完成正式 FinalResponseAgent 与 streaming 工程合同。
> `@repo/ai` 新增独立 DeepSeek V4 Pro non-thinking streaming adapter，固定 exact
> `https://api.deepseek.com/v1/chat/completions`、`stream=true`、`stream_options.include_usage=true`、
> `max_tokens=1200`、strict compatibility、一次 step、no retry/tools/reasoning；step/final finish reason 与 verified
> usage 必须一致，warnings/source/file/tool 扩展一律 fail-closed。
>
> `@repo/agent` 新增 authenticated-only FinalResponse node。Request 必须绑定同一个 canonical execution context，
> latest user/recent conversation/Tutor guidance/evidence excerpt 完整安全扫描通过；config、parent abort、deadline、
> prompt token preflight 均先于 executor。运行边界固定 `20000ms / 1 call / 2500 input / 1200 output /
0.015 CNY`，Provider/timeout/schema/budget/abort 失败无 retry，也不创建 BackgroundJob/Outbox。
>
> 模型只生成正文，不拥有 citation、tool success、verified usage/cost 或 Trace terminal authority。Citation 只能从
> Task 4 本地 allowlist 投影；no-RAG/insufficient 不生成 citation，conflict 只生成保守提示。首 token 前失败返回固定
> 诚实不可用 terminal；首 token 后失败保留 partial text，但禁止 citation/tool success。Server ledger 校验连续
> sequence、terminal-last 与唯一 completed/failed/aborted terminal。
>
> 独立复审发现“citation 已发送、completed 网络投递失败”可能被旧实现追加冲突 aborted terminal；现已改为先在
> 本地 authoritative ledger 封存 citation + completed，再 best-effort 投递。断连只记录
> `client_disconnected / deliveryFailed=true`，不会改写 completed；该合同明确不声称网络 exactly-once。Parent
> abort、重复 timeout callback、mid-stream abort 和 transport rejection 均已有单 terminal/no-retry 覆盖。
>
> Web 新增 server-only default-off config/runtime 与 single-consume executor factory；只有 global Live、精确
> DeepSeek URL、组件 gate、20000ms 和专用 `FINAL_RESPONSE_AGENT_DEEPSEEK_API_KEY` 全部满足后才惰性读取
> credential。Tracked safe example 与 Compose 仅向 `web` 投影 FinalResponse gate/timeout/key，generic/sibling key
> 不可替代，默认始终为 false。
>
> 最终 focused Agent/contract/AI `30/30 / 263 expect()`、Web config/runtime `6/6`、Agent full
> `1244/1244 / 22851 expect()`、AI full `330/330 / 2433 expect()`、Web full `474/474`；Agent/AI typecheck 与
> lint、Web 受影响文件 lint、Compose safe-example quiet config、Prettier、diff 与文档链接检查通过。三路独立
> architecture/security/test 复审无 blocker。完整 Web `tsc` 仍有仓库既有 `.test.mts` 类型债；本任务新增文件
> 的 focused/runtime/lint 与 Agent/AI typecheck 均通过。
>
> 本任务未读取根 `.env`/credential、未调用 DeepSeek/Qwen/其它 Provider、未接 `/api/chat`、未启动产品
> Docker/API/browser、未执行 48-case/controlled-Live、未创建 Live artifact 或修改业务数据，也未合并 main；
> `.codex/` 保持未跟踪。Task 6 的 `qualityAuthority=none`，只解锁 Task 7 Chat composition 与 terminal Trace；
> Task 8 质量门、Live、产品/main 与后续阶段继续阻断。验收见
> `docs/acceptance/phase-6-9-8-task-6-final-response-stream-contract.md`。
>
> 2026-08-04 — Phase 6.9.8 Task 5 Retriever query rewrite candidate：
>
> 在普通分支 `drb/phase-6-9-8-retriever-final-response-contract`、Task 4 基线
> `c6705897f51462bbe438911a839b77b4cd71d96a` 之后，以
> `zero_provider_retriever_query_rewrite_candidate` 完成 Retriever query rewrite 工程合同。新增 DeepSeek V4 Pro
> non-thinking strict `{ rewrittenQuery }` candidate、Retriever node candidate seam、Web server-only default-off
> config/runtime、AI task allowlist、root/subpath export 与 Compose `web` 独立变量投影；尚未接入 `/api/chat`。
>
> Candidate 固定在 exact execution-context binding、authenticated principal、`requiresRag=true`、完整字段安全
> 扫描、多轮指代/context eligibility、abort/deadline、non-secret config 与 token preflight 全部通过后，才惰性读取
> 组件专用 credential/runtime factory。standalone/no-context、明确无需改写、anonymous、non-RAG、unsafe/
> credential/instruction、gate-off、invalid config、pre-abort、expired deadline 与 prompt 超预算均在 factory 前
> zero-call。每次调用使用独立 `1 call / 1200 input / 160 output / 0.005 CNY` 预算，最多一次调用、无 retry。
>
> 模型只建议 query；本地 validator 必须保留原 query 与上下文中的实体、公式、数字、约束和锚点，本地 merger
> 决定使用 original 或 rewritten query。owner、`topK=8`、`minScore=0.72`、`knowledge_document/DONE` filter、
> search port、稳定去重/排序、安全正文替换与 query SHA Trace 均保持本地 authority。runtime/schema/usage/abort/
> validator 失败只回 original query，不创建 BackgroundJob/Outbox 或后台重试。observation 不保存 query、recent
> turn、active context、prompt、owner、credential、endpoint 或 raw error；reviewed Mock 始终
> `qualityAuthority=none`。
>
> 根据独立复审补齐真正 `recentTurns=[]` 且无 active context 的 standalone zero-call、original/后续 recent turn/
> active question/active goal 分段安全扫描、跨调用预算隔离、普通 runtime throw/schema failure 恰好一次调用无
> retry，以及 cross-context 精确 `principal_binding_invalid`。三路 architecture/security/test review 均无
> blocker/high。
>
> 最终 Task 5 focused `18/18 / 223 expect()`、Web config/runtime `6/6`、Agent 串行 full
> `1234/1234 / 22730 expect()`、AI `325/325`、Web `468/468`、Types `21/21`、Agent/AI typecheck 与 lint、Web
> 受影响文件 lint、Compose safe example config 均通过。首次并行全量时一个历史 S3 发布测试因资源竞争越过
> 5 秒；该文件独立复跑 `14/14`，随后 Agent 串行全量通过，确认不是 Task 5 回归。
>
> 本任务未读取根 `.env`/credential、未调用 DeepSeek/Qwen/其它 Provider、未启动产品 Docker/API/browser、未
> 创建 Live artifact 或修改业务数据，也未合并 main；`.codex/` 保持未跟踪。Task 5 只解锁 Task 6
> FinalResponseAgent 与 stream contract；Task 7 composition、Task 8 48-case gate、Live、产品/main 与后续阶段
> 继续阻断。验收见
> `docs/acceptance/phase-6-9-8-task-5-retriever-query-rewrite-candidate.md`。
>
> 2026-08-04 — Phase 6.9.8 Task 4 VerifiedEvidenceBundle / evidence projector：
>
> 在普通分支 `drb/phase-6-9-8-retriever-final-response-contract`、Task 3 提交
> `3c0dd6ae23eace892f12c47e26cd14ff2486e989` 之后，以 `zero_provider_verified_evidence_projector`
> 完成本地证据 authority。Retriever node 的每个正式 result 现在通过 WeakMap 绑定 exact
> `AgentExecutionContextV1`；projector 只接受同一 context 的正式 result。正式 bundle、structured citation、
> FinalResponse request 与 model projection 继续绑定同一 context；低层 bundle constructor 只验证结构，clone、
> 伪造、cross-owner/context、缺失 context 以及 run/request/deadline 漂移均 fail-closed。
>
> Projector 先执行 deterministic owner/SafetyGuard，再应用 Verifier 五态。blocked/unknown safety、prompt
> injection、credential、high-risk、control character 与 cross-owner body 在 bundle 前删除；Verifier
> `trusted/suspicious/conflict/insufficient/skipped` 只能维持或收紧本地结果，`unavailable` 不能升级证据。正式
> bundle 最多 4 条，每条最多 700 UTF-16 code units；稳定 score/tie 排序与 Retriever 的
> `documentId + chunkId` citation identity 不受输入重排影响，模型只可见
> `citationId/sourceLabel/excerpt/trustLabel`，其中 label 固定为 `资料 1..N`。
>
> 本地 citation adapter 同时生成 strict allowlist 与 legacy UI 可消费的 Markdown fragment；这只是兼容投影，
> 尚未替换 `/api/chat` 的 legacy RAG composition。`ragIncluded=false` 时 bundle、allowlist、citation 和 Markdown
> 整层清零；伪造 citation 仍由 strict stream ledger 拒绝。Trace summary 只保存固定 disposition/status/reason、
> bundleId 与计数，不保存 evidence 正文、owner、token、credential 或 raw error。
>
> 最终 focused `30/30 / 250 expect()`、Agent full `1223/1223 / 22577 expect()`、Agent typecheck/lint、Web
> `462/462`、AI `325/325`、Types `42/42 + typecheck` 均通过。Types lint 仍受既有 Bun/PATH eslint 问题影响，
> 不属于 Task 4 回归。独立 architecture、security 与 test review 均无 blocker/high；同包任意代码执行者主动调用
> internal registrar 属于本 Task 外部输入威胁模型之外的防御性边界。
>
> 本任务未读取 `.env`/credential，未调用 Qwen/DeepSeek/Provider，未启动产品 Docker/API/browser，未创建
> Live marker/journal/artifact，也未修改业务数据或合并 main；`.codex/` 保持未跟踪。Task 4 只形成本地
> safety/permission/projection contract，只解锁 Task 5 Retriever query rewrite candidate；FinalResponseAgent、
> structured stream terminal、Chat composition、Mock/Live、产品与 main authority 均未形成。验收见
> `docs/acceptance/phase-6-9-8-task-4-verified-evidence-projector.md`。
>
> 2026-08-04 — Phase 6.9.8 Task 3 RetrieverAgent node / original-query deterministic baseline：
>
> 在普通分支 `drb/phase-6-9-8-retriever-final-response-contract`、Task 2 提交
> `9cc15eddad926d0aa45609a354018162a7e6cba9` 之后，以
> `zero_provider_retriever_original_query_deterministic_baseline` 完成正式 Retriever 地基。原
> `packages/rag/src/retriever.ts` throw stub 已替换为 WeakMap-backed opaque composition port；port 只允许创建时
> 绑定的同一 execution-context 引用调用，clone/forge/cross-scope 在 executor 前 fail-closed，ESM/CJS export
> 保持一致。
>
> `@repo/agent` 新增 `RetrieverAgent` node，固定 `topK=8 / minScore=0.72 / knowledge_document / DONE`。Task 3
> 只执行 original query，rewrite 固定 `gate_off/attempted=false`；anonymous、unsafe/credential、abort、deadline、
> policy/context drift 均在 search 前终止。Eligible path 最多一次 search；响应执行 bounded safe clone、strict
> schema、稳定去重/排序、score tie 和安全收紧，blocked chunk 正文替换固定占位符。Trace 只保存 query SHA、
> policy、hit count、latency 和固定 reason，不保存 query/chunk/owner/token。
>
> Web server-only adapter 继续调用 authenticated `/knowledge/search`，owner 不进入 body，由 Nest
> `JwtAuthGuard + CurrentUser` 从 canonical bearer 解析。bearer 每次执行时从 Task 2 access/request/context 三引用
> capability 临时读取；URL 只来自可信 server env，响应可选 `requestId` 若存在必须与当前请求精确一致。
> `packages/rag` / `@repo/agent` 没有依赖 Nest、Prisma 或复制 SQL。
>
> Frozen 16 guard + 16 original-query runtime manifest/report SHA 为
> `8a1788aa8973507555931ce358c08dcd739dd166636376f6ddcc2eff3a33654d` /
> `a1478f22a4a2fad154496c4ffbfd761532c102fe3ae9453d1916a10ba2c26442`。结果为 Recall@5 `1`、nDCG@5
> `0.813219437888`、Top1 `0.571428571429`、expected no-hit `1`、critical target recall `1`；16 guards 的
> fake-search calls=0，16 runtime 只调用固定 fake search，Qwen/rewrite/FinalResponse/Provider calls 全为 0。
> 该 authority 仅为 `deterministic_baseline_only`，不润色为 query rewrite uplift 或正式产品质量门。
>
> 最终 Agent/RAG focused `15/15`、Agent full `1215/1215`、RAG full `19/19`、两包 typecheck、Web adapter
> `5/5`、Web full `462/462`、同一 compiler options 下 Web 非测试源码 `165/0 diagnostics`、Server knowledge
> search service `7/7` 均通过。仅启动/复用 PostgreSQL/Redis/MinIO 基础设施，Prisma 17 migrations 无 pending；
> fixed fake 1536 embedding 的 knowledge documents E2E `12/12` 覆盖 401、A/B owner、DONE、safety、empty/minScore，
> Qwen attempt=0。Web `.mts` 测试使用仓库 Node `--experimental-transform-types` runner；完整 Web `tsc` 仍有既有
> 测试类型债，本任务只声明非测试源码结果。受影响文件 Prettier、`git diff --check` 与全仓 Markdown 相对链接
> `158 links / missing=0` 均通过。
>
> 本任务未读取 `.env`/credential、未调用 Qwen/DeepSeek、未创建 controlled-Live evidence，也未启动产品
> Web/Server Docker/API/browser 或清理 Docker volume；`.codex/` 保持未跟踪。Task 3 只解锁 Task 4
> VerifiedEvidenceBundle/evidence projector；query rewrite、FinalResponse、structured citation/terminal Trace、
> Mock/Live、产品、main 与后续阶段均未形成。验收见
> `docs/acceptance/phase-6-9-8-task-3-retriever-node-deterministic-baseline.md`。
>
> 2026-08-04 — Phase 6.9.8 Task 2 canonical principal / Chat access：
>
> 在普通分支 `drb/phase-6-9-8-retriever-final-response-contract`、Task 1 提交 `50f04b82` 之后，以
> `zero_provider_retriever_final_response_chat_access` 完成 Chat canonical owner 接线。新增
> `apps/web/src/lib/chat-agent-access.ts`：`/auth/me` 返回值必须先通过 strict `authUserSchema`，authenticated
> owner 唯一取 `AuthUser.id`；request body 显式拒绝 `userId/ownerId/principal`，固定 `web-chat-user` 已从生产
> route 删除。
>
> 无 token Mock 只创建 request-scoped anonymous context，认证调用为 0；无 token Live 在 Agent/runtime 前固定
> 401；任意非空 Mock/Live token 都必须恰好一次 `/auth/me`，invalid/expired/malformed 固定 401。raw bearer 只
> 存在 WeakMap capability，并与 Task 1 receipt 的同一 auth response、原始 Request、execution context 三个引用
> 绑定；clone、cross-owner、cross-request 或 forged access 均 fail-closed，不降级成 anonymous。
>
> `/api/chat` 现在先解析 bounded request/provider metadata，再完成 canonical auth 与 bearer binding，随后才检查
> provider configured、准备 Conversation context 并创建 Router/Verifier/Tutor runtime。Conversation、
> authenticated-only RAG 与 owner Trace 使用同一绑定 bearer；orchestration 不再接收可替换的
> `runId/userId/signal`，authenticated state 取 canonical owner，anonymous state 使用
> `anonymous_${requestId}`。pre-auth/auth-time abort 固定为 499；不同 owner 即使认证反序完成也不会串
> principal、token、state 或 budget。
>
> 最终 Task 2 focused Web `53/53`、Web full `457/457`、同一 compiler options 下 158 个非测试 Web 源文件
> `0 diagnostics`、受影响 Web lint、Server Auth `6/6`、Prettier、`git diff --check` 与全仓 Markdown 相对链接
> `missing=0` 均通过。完整 Web `tsc -p apps/web/tsconfig.json` 仍会命中既有 `.test.mts` 类型债，因此没有把
> 非测试源码结果写成全仓测试源码 typecheck 清零。identity/security 独立复审无 blocker；测试复审确认主矩阵
> 已覆盖，同时明确本 Task 没有真实 `POST /api/chat`、Docker 或浏览器产品运行 authority。
>
> 本任务未读取 `.env`/credential，未调用 Qwen/DeepSeek，未启动 Docker/API/browser，未创建
> marker/journal/artifact，也未修改数据库、Redis、MinIO 或业务数据；`.codex/` 保持未跟踪。Task 2 只解锁
> Task 3 RetrieverAgent node 与 original-query deterministic baseline；query rewrite、FinalResponse runtime、
> Mock/Live 质量门、产品验收、main 与后续阶段均未形成。验收见
> `docs/acceptance/phase-6-9-8-task-2-canonical-principal-chat-access.md`。
>
> 2026-08-04 — Phase 6.9.8 Task 1 shared communication contracts：
>
> 在普通分支 `drb/phase-6-9-8-retriever-final-response-contract`、Task 0 提交 `c6cd10a2` 之后，新增
> `packages/agent/src/contracts/realtime-chat.ts` 与 15 条 focused contract tests。Task 1 以
> `zero_provider_retriever_final_response_shared_contract` 落地 strict `AgentExecutionContextV1`、
> `AgentMessageEnvelopeV1`、`RetrieverRequest/ResultV1`、`VerifiedEvidenceBundleV1`、
> `FinalResponseRequest/StreamEventV1`，并从 `@repo/agent` root 与 `@repo/agent/realtime-chat` subpath 导出。
>
> 所有不可信 DTO 先经过 bounded plain clone，再执行 strict Zod、跨字段 invariant 与 deep-freeze；hostile
> getter/proxy、unknown key、非法 Unicode/control、NaN/unsafe integer、重复 message/reason/citation/evidence/
> direct usage attribution 均 fail-closed。authenticated owner 通过进程内 WeakMap receipt 与同一个 auth
> response/request/bearer 对象引用绑定；`AbortSignal` 只作为不可枚举进程内字段存在，不进入 JSON DTO。
> `skipped` envelope 不得携带 usageRef，同一 modelCallId 最多一个 direct attribution。
>
> Verified bundle 最多 4 条且只能由本地 constructor 创建；sourceLabel 固定为 `资料 1..N`。FinalResponse model
> evidence projection 精确只有 `citationId/sourceLabel/excerpt/trustLabel`，不含 documentId/chunkId/sourceRef/
> safetyCodes。stream validator 强制 sequence 连续、唯一 terminal 且 terminal-last、精确 citationId→sourceLabel
> allowlist，以及首 token 前/后 failure、abort、partial、citation 与 direct verified usage 不变量。
>
> 新增 package export 触发旧 SR5 测试暴露历史校验耦合：它原先从当前 worktree 重算已封存 runnable bundle，
> 会把合法后续演进误报为 SR5 drift。修复只调整测试，不修改 SR5 production source/artifact/marker/journal/
> 常量：approved tag 必须解析到 `67661f5f...d4441`，按 manifest 顺序哈希 approved Git blobs 得到
> `91b52eb2...04c56`，approved commit 内 detached anchor 仍为 `61e6bb60...d08c`。独立历史复审确认 sealed
> authority 未改写。
>
> 最终 Agent full 另暴露 SR2 source identity 的 Windows EOL 耦合：fixture 冻结的是 LF Git blob SHA，而
> `core.autocrlf=true` checkout 为 CRLF。五个文件的 approved Git blob SHA 均与 fixture 精确一致；测试只在
> 哈希前执行 `CRLF -> LF`，仍拒绝任何正文/空格/lone-CR drift。SR2 production source、fixture 与 sealed
> evidence 未修改，独立复审无 Critical/Important。
>
> focused realtime contract 为 `15/15`、`88` assertions，SR5 history parity 为 `8/8`、`64` assertions，SR2
> compatibility 为 `4/4`、`134` assertions，最终 Agent full 为 `1204/1204`、`22380` assertions；Agent
> typecheck/lint、17 文件 Prettier 与 diff check 通过，Markdown links 为 `350 files / 152 links / missing=0`；
> docs/current-status 与 authority/security 两路最终复审均 `APPROVED`，无 Critical/Important。本任务未读 `.env`/
> credential、未调用 Provider、未接 Web/Server runtime、未启动 Docker/API/browser、未创建正式 evidence 或
> 修改业务数据；`.codex/` 保持未跟踪。Task 1 只解锁 Task 2 canonical principal / Chat access，Retriever/
> FinalResponse runtime、Mock/Live、产品验收和 main authority 均未形成。验收见
> `docs/acceptance/phase-6-9-8-task-1-shared-communication-contracts.md`。
>
> 2026-08-04 — Phase 6.9.8 Task 0 RetrieverAgent / FinalResponseAgent contract freeze：
>
> 从已推送 main `185b8171772d43bf49cfde9bb31323c5fe4647d4` 新建普通分支
> `drb/phase-6-9-8-retriever-final-response-contract`，未使用 worktree。只读源码确认 `packages/rag` Retriever
> 仍是 throw stub；真实检索位于 Nest `KnowledgeSearchService`，使用 Qwen `text-embedding-v4` / 1536 与
> PostgreSQL vector + keyword hybrid search，并在两路 SQL 同时限制 Chunk/Document owner 与 `DONE`。Chat Agent
> orchestration 仍传固定 `web-chat-user`，FinalResponse 仍是 `streamText`，citation 以 Markdown 追加，Trace 在
> 最终 stream 前写入 finished/估算 token。`createAgentGraph()` 仍只是 descriptor。
>
> Task 0 以 `zero_provider_retriever_final_response_design` 冻结 `AgentExecutionContextV1`、
> `AgentMessageEnvelopeV1`、`RetrieverRequest/ResultV1`、`VerifiedEvidenceBundleV1` 与
> `FinalResponseRequest/StreamEventV1`。JWT/owner、topK/filter、安全 evidence、citation/tool status、verified
> usage/cost 与 Trace terminal 均保持本地 authority；query rewrite 只能建议 bounded query。FinalResponse model
> 最多看到 `citationId/sourceLabel/excerpt/trustLabel`，其中 sourceLabel 是本地非敏感 ordinal alias；模型不能
> 看到真实 document/chunk/source ref 或用户文档标题。owner context 必须与同一 auth receipt/request/bearer token
> 绑定并 deep-freeze，safe modelRef 也不得包含 endpoint、credential 或 provider raw metadata。
>
> 两条未来 Web-only 能力分别冻结独立 default-off gate、timeout 与 credential：Retriever rewrite 为
> `RETRIEVER_QUERY_REWRITE_MODEL_ENABLED / 4000ms / RETRIEVER_QUERY_REWRITE_DEEPSEEK_API_KEY`，FinalResponse
> 为 `FINAL_RESPONSE_AGENT_MODEL_ENABLED / 20000ms / FINAL_RESPONSE_AGENT_DEEPSEEK_API_KEY`；generic/其它
> Agent key 不得替代。当前 AI SDK streaming 尚未被写成已满足 V4 Pro exact endpoint、non-thinking、verified
> usage、abort 或 terminal contract，Task 6 必须专项验证 adapter。
>
> 固定 dataset `phase-6.9.8-retriever-final-response-v1` 为 16 guard + 16 rewrite paired runtime + 16
> FinalResponse runtime。冻结 Recall@5/nDCG@5/rewrite uplift、grounded/citation、P95、zero-critical 与 null
> aggregate 门；DeepSeek 32-call cap 为 `0.32 CNY`，paired search 最多 32 次 Qwen embedding。Qwen 正式价格
> profile/cap 未冻结时总成本保持 `null`，不得进入 controlled-Live admission。同步 stream 不创建
> BackgroundJob/Outbox；未来异步化必须同时设计 `BackgroundJob + Durable Outbox + idempotency key`。
>
> 本任务没有修改 apps/packages runtime，没有读取 `.env`/credential，没有调用 Provider，没有启动 Docker/API/
> browser，也没有创建正式 marker/journal/artifact。Task 0 只解锁 Task 1 shared strict Zod contracts；Task 2--11、
> Phase 6.9.9/6.9.10/6.10/8/9 与博客收尾继续阻断。设计、计划与验收见
> `docs/superpowers/specs/phase-6-9-8-retriever-final-response-agents-design.md`、
> `docs/superpowers/plans/phase-6-9-8-retriever-final-response-agents.md` 与
> `docs/acceptance/phase-6-9-8-task-0-retriever-final-response-contract.md`。
>
> 11 个本次 Markdown 文件 Prettier check、`git diff --check` 与全仓库 `349 files / 149 relative links /
missing=0` 检查通过；authority/security 与 docs/history 两路 Reader Testing 均 `APPROVED`，无未关闭
> Critical/Important。首次链接扫描发现一个已注销但仍残留的旧 Phase 6.9.5 `.worktrees` 目录；
> `git worktree list` 确认它不是活动 worktree，随后按用户既有清理授权精确删除，最终 `.worktrees` residue=0，
> 当前仍只使用普通功能分支。未触碰 Docker、数据库、Redis、MinIO 或 `.codex/`。
>
> 2026-08-04 — Phase 6.9.7 Full-gate Schema Recovery SR7 main/default-off 收口：
>
> SR6 功能提交 `64d4ff45` 已以 merge commit `510bbc94` 合并并推送 `main`。main default-off
> Docker/API/可见浏览器回放期间，Organizer 保持
> `local_deterministic / gate_disabled / degraded=false`、不创建 Trace，`/error-book` 显示“本地规则”；
> 没有启用 SR6 replay 或调用 Provider。
>
> 首次 Tutor 回放发现确定性 Router 未识别精确句“我算到 `f'(2)=4`，这一步对吗？请只检查这一步。”。
> 从最新 main 新建普通分支 `drb/phase-6-9-7-sr7-step-check-route`，只补充“这一步/这步”Tutor 关键词与
> 精确回归用例；功能提交 `43af2e85` 单独推送后，以 merge commit `006f54e9` 合并并推送 main。Router
> focused `6/6`、Web server-only 正确 Node runner `25/25`、受影响 Router/runtime/Chat 回归、Agent
> typecheck/lint/Prettier/diff 均通过。一次 Bun 混跑 server-only Web test 的失败已确认是错误 runner，不是
> 产品失败。
>
> 修复后可见 `/chat` 对同一句返回 `route=tutor / intent=step_check`；响应头与 Trace 同时证明 Tutor model
> candidate `attempted=false`、input/output token `0/0`、`LIVE_CALLS_DISABLED`、`pricing=unknown`，顶层 Trace
> 为 `mock / completed / cost=0`。顶层 `390/1200` 仅是本地 Mock 预算估算，不是 Provider verified usage。
> 四张本地截图 SHA 已写入 SR7 验收文档；错误路由截图与 Playwright page/console 临时文件已精确删除，
> 浏览器窗口保留。
>
> 两个 main 合成账号均已精确删除。首次账号删除前为 refresh token 7、错题 1、会话 1、消息 6、分组 1、
> 专题 1、关联项 1、Trace 3/steps 10；step-check 账号为 refresh token 2、会话 1、消息 2、Trace 1/steps 4。
> 删除后 User、全部用户关联与 tracked Outbox residue 均为 0。浏览器最终停在 `/login`，cookie/local/session/
> cache/service worker 为 0，自动重建的 5 个 IndexedDB store 行数均为 0。没有 database/volume reset、Redis
> FLUSH、MinIO wipe、`down -v` 或 prune。
>
> Docker server/web 逐个构建成功；正确携带 `--env-file .env` 精确重建后 server healthy、web
> `/login=200`、worker healthy。AI mode=mock、Live=false、全部 Agent/replay gate=false。SR7 只形成
> zero-provider main/default-off authority，不提升 SR5 semantic authority，也不证明真实模型最终产品回答、SLA
> 或生产部署。Phase 6.9.7 正式完成；下一原子阶段是 Phase 6.9.8 RetrieverAgent / FinalResponseAgent
> 正式化与通信 contract。验收见
> `docs/acceptance/phase-6-9-7-tutor-organizer-full-gate-schema-recovery-sr7-main-acceptance.md`。
>
> 2026-08-03 — Phase 6.9.7 Full-gate Schema Recovery SR6 分支产品验收：
>
> SR6 已在 `codex/phase-6-9-7-tutor-wrong-question-agents` 完成，且全程
> `providerCalls=0`。新增 `phase-6.9.7-sr6-product-replay-v1` 受限路径，必须绑定 SR5 physical artifact SHA
> `87dd826bf80fa2da4884ee8574beb6f8e252584c5edc8d1cc087e7d2b66f18be`、`AI_PROVIDER_MODE=mock`、全部
> Agent/Live gate 关闭、全部 Provider credential 为空、RAG=fake 与 exact component/request cap 才能启用。
> `sr5_sealed_replay` 不是读取/逐字重放 SR5 Provider response 或 Trace；它依据当前 bounded Tutor V6 /
> Organizer V9 prompt，从本地合法 eligible option 中生成 deterministic Mock output，再穿过当前产品
> validator/merger。`both` 已固定总 cap=2、每个 component 各 1 次。
>
> Tutor Web composition 已从 legacy candidate 切换到 Schema Recovery candidate；Organizer Nest single/batch 已
> 切换到 V9 ordinal-only candidate。本地 signal/depth/answer 权限与 owner/真实 ID/subject/topic/deck/locked
> name/stale/Trace/write command 继续权威。Replay Trace 只能是固定 mock identity，Tutor 不估价，Organizer
> 固定 `pricing=not_applicable / cost=0`，不能冒充 `production_live` 或计入 DeepSeek billing。Server env schema
> 同步补齐全部 Agent gate 和 DeepSeek/Tutor/Knowledge/Organizer/OpenAI/Qwen/DashScope credential 的
> zero-provider fail-closed 矩阵；Web Trace 测试也改为验证实际非负 duration，不再假设 Mock 恒为 `0ms`。
>
> 真实 Docker/API 验收中，Tutor `/api/chat` 使用登录态与 OCR structured context 得到
> `candidate_applied`；Organizer single/batch 得到 `hybrid_model / candidate_applied`，batch `3/3`，locked deck
> name 不变；跨账号为 404 且无写入。Forced failure 下 Tutor Chat 继续可用，Organizer 回到
> `local_deterministic / fallback_runtime_error`。可见 `/chat`、`/error-book`、`/agent-trace` 均通过，三张截图
> SHA 已固定在 SR6 验收文档。
>
> 本轮精确清理 3 个合成账号、6 道错题、2 个分组、2 个专题、5 个关联项、8 条 Trace/31 个 steps、8 条
> ChatMessage 与 16 个 refresh token；相关 residue、cookie/storage/IndexedDB/cache/service worker 均为 0，窗口
> 保留在 `/login`。没有 Redis FLUSH、MinIO wipe、database/volume reset、`down -v` 或 prune。最终源码 server /
> web 镜像分别以 `COMPOSE_BAKE=false` 构建成功并重建；server healthy、web `/login=200`、worker healthy，全部
> Agent/replay gate 已恢复 false，Qwen 仍为 `text-embedding-v4 / 1536`。凭据只核对存在性，未输出值。
>
> 定向 replay `4/4`、Tutor/Web `10/10`、Web `444/444`、Server env `87/87`、Agent typecheck、Server build、
> Docker server/web build 与 SR5 strict validator 均通过；四路只读复审 `APPROVED`。SR6 只形成 zero-provider
> 产品 composition/权限/Trace/降级/UI/清理证据，不提升 SR5 真实模型语义 authority，不证明真实模型产品质量、
> SLA、生产部署或 main。当前唯一下一原子任务是 SR7 main 合并、远程推送与 default-off 回放；不重跑 SR5，
> 不再次启用 SR6 replay。验收见
> `docs/acceptance/phase-6-9-7-tutor-organizer-full-gate-schema-recovery-sr6-product-acceptance.md`。
>
> 2026-08-02 — Phase 6.9.7 Full-gate Schema Recovery SR5 Controlled-Live：
>
> 已在 branch/upstream/remote 与 lightweight approved tag 全部固定到 admission source
> `67661f5f3a302b547e804c2c1839ec89898d4441` 后，执行并仅执行一次 SR5 controlled-Live。第一次 production
> CLI 前门因 `source_invalid` 在 marker/credential/Provider 前安全拒绝，`providerCalls=0`、未创建正式文件且未
> 消耗 reservation；zero-provider 分解复核通过后才创建唯一正式 reservation。
>
> 唯一 run `63f8a76b-1c2a-403d-b774-0235caae04cb` 以
> `schema_recovery_quality_gate_passed / schema_recovery_full_gate_semantic_gate` 收口：guard `24/24`
> zero-call，runtime `48/48/0/0`，wire `48/48/48/48`，strict `48/48`，schema
> `48 canonical / 0 extension / 0 rejected / 0 not-observed`。Tutor/Organizer/Combined semantic 为
> `0.9736111111111112 / 0.9515968406593407 / 0.962603975885226`，L2 anchor
> `0.9141666666666668 / 0.9041666666666667 / 0.9091666666666667`，paired P95 `2240ms`，usage
> `20966/789`，费用 `0.067632 CNY`；全部 safety/permission/mutation/write leakage 为 0。
>
> Marker、628 条 hash-chain journal 与 hard-link artifact 已由正常 runtime publication durable seal，final event
> 为 `evidence_published`，strict validator `ok=true`，recovery claim=0。Artifact SHA 为
> `87dd826bf80fa2da4884ee8574beb6f8e252584c5edc8d1cc087e7d2b66f18be`。SR5 一次性名额已经消费，禁止
> retry/resume/replay/backfill、Live/seal/recovery、curl、单 case、产品 API 或其它 Provider 探测。
>
> SR5 只证明固定 72-case/24-pair 分支评测的真实模型语义与 schema/usage/P95/预算门，不证明 Tutor Chat、
> Organizer single/batch、Trace、业务写入、Docker API、可见浏览器、SLA、main 或生产可用。旧 L3 仍为失败
> 封存，SR4 仍为 Mock-only。该 checkpoint 当时只解锁 SR6 分支产品验收；后续状态以上方 2026-08-03
> SR6 记录为准。验收见
> `docs/acceptance/phase-6-9-7-tutor-organizer-full-gate-schema-recovery-r5-controlled-live-quality-gate-pass.md`。
>
> 2026-08-02 — Phase 6.9.7 Full-gate Schema Recovery SR4 Reviewed Mock / Static：
>
> SR4 新增独立 `phase-6.9.7-tutor-organizer-schema-recovery-reviewed-mock-v1` factory，factory SHA 为
> `8f18c1c2a73790818f63b64e0da67852900d341c99b9f599e9838eba41c93d44`，checkpoint SHA 为
> `03bb81a65b0ae838646191fb58abf2dcf0af73f5e720812b5789a185afcb6960`。Reviewed Mock 真实穿过
> Schema Recovery Tutor envelope/parser/selection projection/strict merger、Organizer V9 option authority、两条
> 第一方 synthetic adapter 与 SR3 fixed-denominator runner；expected/oracle 只进入后置 scorer。
>
> 固定结果为 counts `72/24/48/24/32`，runtime `48/48/0/0`，wire `48/48/48/48`，schema
> `42 canonical + 6 extension discarded`，Tutor/Organizer/Combined semantic
> `1 / 0.9968750000000001 / 0.9984375000000001`，L2 anchor `1`，usage `17732/654`，费用
> `0.05712 CNY`。24 guards 全部实际 zero-call；六个 Tutor extension case 只形成 bounded no-raw diagnostic 并
> 丢弃扩展字段。Gate 固定 `schema_recovery_mock_quality_not_evidence / qualityAuthority=none`，不能证明
> Provider、真实模型语义、产品或 SLA。
>
> Fault/pre-abort 回归覆盖 malformed JSON、missing usage、transport reject、Organizer ordinal drift、sibling
> settlement、breaker 与固定 48-lane denominator；不完整时 schema/semantic/P95/CNY 继续 fail-closed。隔离临时
> root 的 SR3 publication/validator 通过，旧 full-gate 与 schema-recovery report 双向拒绝；旧 L3 validator/SHA、
> 正式 SR5 files/tag=0 与无 retry/resume/replay/backfill 边界保持。
>
> SR4 focused `9/9`（`506` assertions）、SR1--SR4/F1/F2/S3/small-sample compatibility `201/201`
> （`5734` assertions）、Agent/AI/Types/Web 全量门通过；Web `439/439`、lint 与 production build 通过。
> PostgreSQL 启动后 Server 全量 `227` suites passed / `3` skipped、`2154` tests passed / `30` skipped，
> operator-audit integration `1/1`、Organizer concurrency E2E `12/12`、Server build/lint 与 Compose
> default-off/static `24/24` 均通过。Reader Testing 与 Contract/Security 两路独立终审均
> `APPROVED`，无 Critical/Important/Minor。
>
> Web build 先暴露共享 `@repo/ai` barrel 误导出 Architecture Recovery Node-only diagnostic/durability 模块的
> 既有 BigInt/ES2017 边界问题；独立提交 `2f649a96` 只移除 root re-export，保留原文件、direct tests、scripts、
> sealed contract/SHA，并恢复 Web build。只启动既有 Docker Desktop、PostgreSQL 与 Redis 完成数据库回归；
> 未启动产品 server/web/worker/admin、未调用 Provider、未创建 SR5 admission/tag/artifact、未执行 API/browser，
> 未清理 Docker/volume/database/Redis/MinIO；`.codex/` 不提交。
>
> 该 SR4 checkpoint 当时的下一原子任务仅 SR5 fresh admission。开始前仍需 SR4 commit/remote parity、新 approved source tag、历史
> validator/SHA parity、fresh proxy preflight、当次 DeepSeek 数据边界接受与 exact authorization；当前不得
> 创建 tag、读取 credential 或调用 Provider。验收见
> `docs/acceptance/phase-6-9-7-tutor-organizer-full-gate-schema-recovery-r4-reviewed-mock-static.md`。
>
> 2026-08-02 — Phase 6.9.7 Full-gate Schema Recovery SR3 Runner / Lineage / Durability：
>
> SR3 以 `zero_provider_full_gate_schema_recovery_runner_durability` 建立独立
> `phase-6.9.7-tutor-organizer-full-gate-schema-recovery-v1` lineage。新增 report/runner/source/CLI、exclusive
> marker、append + fsync + SHA-256 hash-chain journal、hard-link artifact、strict recomputing validator 与
> crash-only recovery；source manifest SHA 为
> `1a811394b6e6c182ef33bb22c8aa5545400e8083a5f226d9d5eab5e7c40adfbb`。固定
> `72/24/48/24/32` 分母、guard-first/pair-serial 双 lane、single dispatch/no retry 与旧 full-gate 质量门不变。
>
> 新 journal 独立记录 `schema_stage_started/succeeded/failed`；Schema Recovery wrapper 私有保存该
> lifecycle，旧 F2 只作为非持久化 scheduler/metric kernel，不能把新 stage 写入旧 L3 lineage。Report/validator
> 重算 canonical/extension-discarded/rejected/not-observed、wire、usage、semantic/anchor/P95/CNY、breaker 与
> publication；分母不完整时正式 aggregate 全 `null`。截断/CRLF/hash/重排/duplicate terminal/raw field、
> marker/claim race、ABA/live owner/PID reuse、hard-link conflict 与 artifact mutation 均 fail-closed。
>
> Crash-only recovery 只解释 durable prefix，不创建 executor 或 retry/resume/replay/backfill。新增
> crash-after-usage 回归确认：`usage_validated` wire 已 durable、schema terminal 尚未 durable 时保留 wire
> `1/1/1/1`，但 lane usage 与 aggregate 仍为 `null`，schema 为 `not_observed`。公共 CLI 只开放 zero-provider
> bundle validation/crash-only seal，并对依赖结果做 exact-own-data 白名单；SR5 confirmation/approval/
> credential/source admission/marker reservation/harness/executor/fetch port 仍未开放，也没有 Live script。
>
> SR3 focused `23/23`、SR2/SR3/F2 compatibility `105/105`（`3633` assertions）、Agent full
> `1167/1167`（`21651` assertions）、AI full `325/325`（`2378` assertions）；Agent/AI typecheck/lint、
> Prettier、`git diff --check` 与独立 contract/security/test-coverage 终审通过。旧 L3 validator 仍为
> `ok=true / journalRecords=296 / evidence_published`，physical artifact SHA `e081939b...dbe5`；正式 SR5
> files/tag 为 0。本任务未读取 `.env`/credential、调用 Provider、执行正式 Mock/Live、启动 Docker/API/browser
> 或修改业务数据；`.codex/` 不提交。
>
> 下一原子任务仅 SR4 zero-provider reviewed Mock/static；验收见
> `docs/acceptance/phase-6-9-7-tutor-organizer-full-gate-schema-recovery-r3-runner-durability.md`。
>
> 2026-08-02 — Phase 6.9.7 Full-gate Schema Recovery SR2 Zero-provider Robustness：
>
> SR2 冻结独立 `phase-6.9.7-tutor-schema-recovery-sr2-robustness-v1` fixture 与 prompt-only
> anti-oracle responder，fixture SHA 为 `43248bfa7156c29eafa110b475a8998611209dd808847be79dacd1c02460d41e`。
> Responder 只读取 direct adapter 实际 bounded request 与 `eligibleIntents`，不导入 expected/oracle/scorer/
> production validator；24 个 frozen Tutor runtime（含 `tutor-v2-runtime-11`）均 exactly one synthetic
> dispatch，实际 request bytes 不含 case ID、oracle、baseline、quality gate 或 key。
>
> Provider-like matrix 覆盖 18 个 shape：canonical/whitespace/escaped key/key order、scalar/object/array/
> Unicode extension，以及 missing/alias/string/null/fraction/range、top-level array、double-encoded、wrapper/
> fence/BOM/trailing/duplicate；byte/depth/node/key limit 均 fail-closed。Transport、HTTP 429、non-thinking
> response-audit、missing usage、budget 与 pre/in-flight/post abort 均保持 bounded category、single dispatch、
> no retry。SR2 candidate 的 duplicate-key schema failure 接入 F2 memory runner 后得到 runtime
> `2/2/0/46`，Organizer sibling 成功收口，后续 46 lane 由 schema breaker 阻断；未创建 durability 文件。
>
> SR2 focused `9/9`（`484` assertions）、兼容 `51/51`（`1133` assertions）、Agent full `1144/1144`
> （`21463` assertions）、AI full `325/325`（`2378` assertions）；Agent/AI typecheck/lint、Prettier、
> `git diff --check` 与旧 L3 只读 validator 均通过，两路独立终审无阻断项。旧 L3 仍为 `full_gate_quality_gate_failed /
qualityAuthority=none / journalRecords=296`，artifact SHA `e081939b...dbe5`。本任务未读取 `.env`/
> credential、调用 Provider、执行正式 Mock/Live/production CLI、启动 Docker/API/browser、创建正式 tag/
> marker/journal/artifact/recovery claim 或修改业务数据；`.codex/` 不提交。
>
> 该 checkpoint 当时只解锁 SR3 zero-provider 独立 Runner、Lineage 与 Durability；SR3 后续已完成，当前下一
> 原子任务为 SR4 reviewed Mock/static。SR2 验收见
> `docs/acceptance/phase-6-9-7-tutor-organizer-full-gate-schema-recovery-r2-zero-provider-robustness.md`。
>
> 2026-08-02 — Phase 6.9.7 Full-gate Schema Recovery SR1 Zero-provider TDD：
>
> SR1 以 `zero_provider_full_gate_schema_recovery_tdd` 落地独立
> `phase-6.9.7-tutor-schema-recovery-contract-v1` / `candidate-v1`。`@repo/ai` 新增只绑定 exact schema
> identity 的 bounded raw-content parser capability；第一方 DeepSeek direct adapter 在该 capability 下先完成
> native JSON audit，再保持 `content_parsed -> provider_type_validation` wire 语义。Tutor contract 使用
> `8192 bytes / depth 8 / nodes 128 / keys 64` 限制，在任何 whole-document `JSON.parse` 前拒绝重复 key、BOM、
> fence/prose/trailing/multiple top-level 和结构超限。
>
> Selection projection 只读取 canonical own-data safe integer `intentIndex`，重新构造 strict
> `{intentIndex}`；扩展字段只形成 fixed stage/reason/projection/type/count bucket 与 shape fingerprint 后丢弃，
> `rawDataRetained=false`。Schema Recovery candidate 最多调用一次 runtime、不 retry，继续复用 Tutor V6 local
> signal、preferred depth、answer structure、`answer_direct` 权限与 merger；模型没有新增 depth、答案、route、
> tool、permission、真实 ID 或写权限。Contract SHA 冻结为
> `e2453faeb077faa76ab018a038790cd5a7e73f617be800c0958c098361511579`。
>
> RED 为新 public subpath/contract/candidate 尚不存在的 `0 pass / 3 fail`；GREEN 后 focused/direct
> `41/41`、V6/V8/V9/F1/S3 兼容 `70/70`、Agent `1135/1135`、AI `325/325`、Agent/AI
> typecheck/lint、Prettier 与 `git diff --check` 均通过。旧 L3 只读 validator 仍为
> `ok=true / journalRecords=296 / evidence_published`，physical artifact SHA
> `e081939bb7f4b17235b1d9afb61d78031879bb80b9d64c952e4b86531cd7dbe5`。
>
> 本任务未读取 `.env`/credential、调用 Provider、执行正式 Mock/Live、启动 Docker/API/browser、创建正式
> tag/marker/journal/artifact 或修改业务数据；`.codex/` 仍为本地未跟踪目录。旧 L3 bytes/tag/validator 未修改。
> 该 checkpoint 当时下一原子任务仅 SR2 zero-provider Provider-like/held-out/metamorphic/no-leak/fault matrix。验收见
> `docs/acceptance/phase-6-9-7-tutor-organizer-full-gate-schema-recovery-r1-zero-provider-tdd.md`。
>
> 2026-08-02 — Phase 6.9.7 Full-gate Schema Recovery SR0 Zero-provider 设计：
> 唯一 L3 `2b0ac3a0...` 继续保持 `full_gate_quality_gate_failed / qualityAuthority=none`，marker、journal、
> artifact、approved tag 与 source SHA 均未修改。SR0 只读对照 sealed report/journal、Tutor V6
> contract/candidate、第一方 direct adapter、F2 runner 与 S3 reviewed Mock，确认
> `tutor-v2-runtime-11` 已到 `content_parsed`，但未到 `schema_validated/usage_validated`；当前 evidence 无
> completion、Zod path/value 或字段诊断，因此不能断言具体 extra/missing/type/range 字段或 Provider 外部根因。
>
> 当前 Tutor V6 模型权限已经收敛为 strict `{intentIndex: integer 0..4}`，本地继续拥有 eligible intent、
> preferred depth、完整 TutorStrategy 与 `answer_direct` 权限。结构性缺口不是模型权限过大，而是
> `response_format=json_object` 与 strict Zod 之间缺少不可信 envelope -> 权威 selection 的隔离投影；第一方
> adapter 又把所有 schema failure 压缩为 `provider_type_validation`，S3 canonical responder 没有形成完整的
> Tutor Provider-like shape/diagnostic 证据。
>
> SR0 冻结新的两层合同：Provider content 先做 native JSON、duplicate key、byte/depth/node 与 top-level
> shape audit；selection projection 只读取 canonical own-data integer `intentIndex`。无权威 extension field 只
> 形成固定类型/数量桶后丢弃，随后重新构造 strict `{intentIndex}` 并继续走本地 authority/merger。缺失、alias、
> string/fraction/null/out-of-range、duplicate、wrapper/fence/prose/BOM/trailing data 仍 fail-closed；禁止
> coercion/default/clamp/retry。
>
> 新 bounded diagnostic 只允许 fixed stage/reason/projection/type/count bucket、枚举化 shape SHA 与
> `rawDataRetained=false`，不保存 raw output/hash、prompt、Zod path/value、unknown key 名、credential、用户正文
> 或 oracle。未来使用独立
> `phase-6.9.7-tutor-organizer-full-gate-schema-recovery-v1` lineage、source tag、approval、marker、journal、
> artifact 与 validator；旧 L3 不重解释、不补跑。
>
> SR0 authority 仅 `zero_provider_full_gate_schema_recovery_design`。本任务未修改 packages/apps 源码，未读取
> credential、调用 Provider、执行正式 Mock/Live、启动 Docker/API/browser、创建 tag/artifact 或修改业务数据。
> 只读 L3 validator 仍为 `ok=true / journalRecords=296 / evidence_published`。该 checkpoint 当时下一原子任务仅 SR1
> zero-provider TDD；完整设计、计划与验收见
> `docs/superpowers/specs/phase-6-9-7-tutor-organizer-full-gate-schema-recovery-design.md`、
> `docs/superpowers/plans/phase-6-9-7-tutor-organizer-full-gate-schema-recovery.md` 与
> `docs/acceptance/phase-6-9-7-tutor-organizer-full-gate-schema-recovery-r0-zero-provider-design.md`。
>
> 2026-08-02 — Phase 6.9.7 Tutor / Organizer Full-gate L3 Controlled-Live：
> 用户在本次 admission 中重新接受 DeepSeek 当前账号的数据保留/训练边界，并给出 exact authorization。
> S3 approved tag 已固定并推送到 source commit
> `3c5cc6c57fdf6d3366ac695d3305e2cc85fd2599`；HEAD/upstream/remote/tag、七个 candidate/adapter SHA、
> V1--V9/R3/Canary L1/L2 validators 与正式 artifact=0 前门均通过。Fresh zero-provider preflight 为
> `direct_ready / providerCalls=0`。
>
> 唯一 run `2b0ac3a0-631f-4c7f-9781-ce0cda94149a` 已由正常 runtime 路径 durable publication。24 guards
> 保持 zero-call；runtime reserved/terminal/orphan/not-started 为 `22/22/0/26`，wire
> executor/dispatch/response/verified usage 为 `22/22/22/21`，strict runtime success 为 `21/48`。
> `tutor-v2-runtime-11` 在 `provider_response_received -> response_audit_passed -> content_parsed` 后以
> `attempted_failed / schema` 收口；Organizer sibling 正常成功，pair close 后 breaker 以 `schema` 打开，剩余
> 26 lane 固定为 `not_started_quality_breaker`。
>
> 完整分母未完成，因此 Tutor/Organizer/Combined semantic、L2 anchor、四项 P95、token 与 CNY aggregate 全为
> `null`；安全/权限/mutation/broader fallback/locked-name/write leak 全 0。最终 gate 为
> `full_gate_quality_gate_failed / qualityAuthority=none`，不能声称真实 Tutor/Organizer 质量或产品可用。
>
> Marker/journal/artifact SHA 分别为 `ed0648d...8ebb8 / e8f9046a...d6ef / e081939b...dbe5`，report
> logical SHA 为 `595e9fce...74683`。Journal 共 `296` 条并以 `evidence_published` 收口；strict bundle
> validator `ok=true`，completion/publication 均为 runtime，recovery claim 为 0。根 `.env` credential 仅在
> 唯一独立进程内映射，未输出、写回、提交或进入 evidence。
>
> L3 名额已消费，禁止 retry/resume/replay/backfill、Live/seal/recovery、改删 evidence 或追加 Provider
> 探测；产品 Docker/API/browser、main、Phase 6.9.8 与后续阶段继续阻断。若继续，只能先建立新的
> zero-provider schema diagnostics/remediation 设计。完整验收见
> `docs/acceptance/phase-6-9-7-tutor-organizer-l3-controlled-live-quality-gate-failure.md`。
>
> 2026-08-01 — Phase 6.9.7 Tutor / Organizer Full-gate S3 Reviewed Mock / Static：
> S3 已在 zero-provider 边界完成。新增 full-gate reviewed Mock factory，真实穿过 Tutor V6、Organizer V9、
> 第一方 DeepSeek V4 Pro direct adapter 的 synthetic fetch seam、strict validator、本地 authority/merger 与
> F2 fixed-denominator runner；factory SHA 固定为
> `sha256:53bcf0d4378f9a6c36b867053201f41bebbc7b05bf14f94edd0f24fc9f22da55`。
>
> 正常结果为 `24/24` guard、runtime reserved/terminal/orphan/not-started `48/48/0/0`、wire/verified usage
> `48/48/48/48`、Tutor/Organizer/Combined semantic
> `1 / 0.9968750000000001 / 0.9984375000000001`、L2 anchor `1/1/1`，安全失败全 0；synthetic usage
> `17732/504`、estimated cost `0.05622 CNY`。Gate 固定为
> `full_gate_mock_quality_not_evidence / qualityAuthority=none`，global fetch 与外部 Provider 调用均为 0。
>
> Focused matrix `14/14` 覆盖 transport/HTTP/schema/usage、dynamic authority/write leak、semantic mismatch、
> pre-abort、locked-name/no-write、unknown fault fail-closed 与 anti-oracle。临时隔离 bundle 的 strict validator
> 通过，journal 为 24 guards、48 reservations、384 wire stages、48 lane terminals、24 pair terminals，并以
> `evidence_published` 收口；测试后精确删除，正式 full-gate bundle/tag/recovery claim 保持 0。
>
> S3 focused `14/14`、Agent `1122/1122`、AI `323/323`、Types `42/42 + tsc`、Web `439/439`、Server
> build/lint 与非数据库 226 suites/2153 tests 通过；历史 V1--V9、R3、Canary L1、Small-sample L2 validators
> 保持通过。`@repo/types lint` 因包内找不到 `eslint` 未通过；Server 完整 Jest 的数据库 suites 因本机
> PostgreSQL `127.0.0.1:5433` 未启动未通过，均未包装成全量成功。
>
> Server 回归同时发现 `@repo/ai` shared runtime barrel 不应重导出含 `import.meta` / top-level await 的可执行
> CLI。现已保留 CLI 文件/package scripts、让 CLI tests 直接导入文件，并从 runtime barrel 移除四个 CLI-only
> exports；修复后非数据库 Server 与 AI 全量通过。
>
> 本阶段未读 credential、未调用 Provider、未创建/移动 S3 approved tag、未启动 Docker/API/browser、未合并
> main。当时下一步仅独立 L3 admission，仍需 fresh 数据边界接受、exact authorization、专用 credential 与 source/
> tag parity；完整验收见
> `docs/acceptance/phase-6-9-7-tutor-organizer-s3-reviewed-mock-static.md`。
>
> 2026-08-01 — Phase 6.9.7 Tutor / Organizer Full-gate F2 Runner / Durability / Evidence：
> F2 已在 `zero_provider_full_runner_durability_evidence` authority 下完成；F1 的
> `phase-6.9.7-tutor-organizer-full-gate-v1` manifest/report/scorer/gate 继续作为唯一 aggregate 规则源，未复制或
> 改写 V1--V9、Recovery R3、Canary L1、Small-sample L2 的 sealed lineage。
>
> 新增固定 production CLI、full source admission、24-guard/24-pair runner、DeepSeek V4 Pro first-party
> composition、exclusive marker、fsynced hash-chain journal、hard-link artifact、strict bundle validator 与
> crash-only seal。Public CLI 只接收 `args + AbortSignal`；root/env/model/URL/fetch/runner/evidence ports 均固定。
>
> Admission 顺序为 exact args -> zero-provider proxy attestation -> source -> dedicated approval -> dedicated
> credential -> marker -> guards -> pairs -> publication。Source 要求固定分支、tracked clean、
> HEAD/upstream/remote/未来 S3 approved tag commit parity、七个 candidate/adapter SHA 与正式 evidence=0。S3 tag
> 当前不存在，因此 production path 仍在 credential/marker 前关闭；approval env 的值必须精确等于 L3 exact
> confirmation。
>
> Runner 先完成 `24` guards，再串行推进 `24` pairs；pair 内 Tutor/Organizer 最大并发 2，并各自持有 budget、
> AbortController、`3500/5000ms` hard timeout、wire capability 与 terminal。Semantic mismatch 不 breaker；
> contract failure 先收口 sibling，再让后续 lane 以 `not_started_quality_breaker` 保留在固定 48 分母。父请求取消
> 作为 `external_abort`，terminal append 失败不在进程内重试。
>
> `lane_reserved` 与每个 wire stage 在跨 delegate 前 durable append + fsync。Crash-only seal 不读取
> approval/credential、不构造 transport、不调用 Provider，只解释 durable prefix：当前开放/待锚定 pair 以
> zero-wire `attempted_aborted` 收口，后续 pair 固定 not-started；已有 run terminal 只允许原 report publication
> recovery。Validator 从 marker/journal/source/entries 重算 report、accounting、wire、semantic、P95、usage、费用、
> gate 与 logical/physical SHA，并拒绝 truncated/CRLF/hash rewrite、重复 claim 与额外正式文件。
>
> F2 focused `32/32`（2105 assertions）、Agent full `1108/1108`（20172 assertions / 132 files）、typecheck/lint、
> Prettier、`git diff --check`、历史 validators/SHA parity 通过；两路独立只读复审无阻断项。正式 approved
> tag/marker/journal/artifact/recovery claim 为 `0/0/0/0/0`，Provider/credential/Docker/API/browser 调用为 0。
>
> F2 本阶段未执行 S3 reviewed Mock、L3 controlled-Live、产品或 main；当时下一原子任务仅 S3 reviewed
> Mock/static checkpoint，后续 S3 已按上方日志完成。F2 完整验收见
> `docs/acceptance/phase-6-9-7-tutor-organizer-f2-runner-durability-evidence.md`。
>
> 2026-08-01 — Phase 6.9.7 Tutor / Organizer Full-gate F1 Contract / Baseline：
> F1 已在 `zero_provider_full_contract_baseline` authority 下完成；独立 lineage
> `phase-6.9.7-tutor-organizer-full-gate-v1` 继续与 V1--V9、R3、Canary L1 和 small-sample lineage 双向隔离。
>
> 新增 exact 72-entry manifest、未修饰 deterministic baseline、安全 baseline writer、strict
> report/scorer/gate 与 focused tests。固定分母为 `72 entries / 24 guards / 24 pairs / 48 runtime lanes / 32
Organizer decisions`，L2 anchor pairs 为 `0/7/9/11/14/18/22/23`。
>
> Manifest/source baseline/baseline authority SHA 精确复现 P2 冻结值
> `e68e6e27...12c78 / 0ce7c3ca...116ca / 2ab1030f...a5f2`；F1 新冻结 baseline logical report/physical
> file SHA `16c574b1...2c9 / 16aa1773...6f73`，eval policy 保持 `11371d16...f503`。Physical validator
> 直接 hash 原始 bytes，并拒绝 BOM、CRLF 与 byte/payload/source drift。
>
> Strict contract 从 entries 重算 full 与 L2 anchor semantic、安全、四维 wire、verified usage、预算和四项
> 24-sample nearest-rank P95；不完整分母时 semantic/anchor/P95/token/CNY 全为 `null`。Semantic mismatch 不
> breaker；contract/safety failure 只能在当前 pair terminal 后 breaker。Mock/synthetic 固定
> `full_gate_mock_quality_not_evidence / qualityAuthority=none`，只有完整 `deepseek_network` pass 才可能形成
> `full_gate_semantic_gate`。
>
> Baseline writer 使用 root containment、非 symlink parent、exclusive create、dev/inode identity、fsync 与写后
> 二次复核；exact import allowlist、credential/network 静态门与 runtime fetch spy 均通过，Provider 调用为 0。
> Focused `14/14`（87 assertions）、Agent full `1076/1076`（18048 assertions / 128 files）、typecheck/lint、
> Prettier 与 `git diff --check` 通过；四路独立复审均 `APPROVED`。
>
> 本阶段 approved tag、项目根 baseline、正式 marker/journal/artifact/recovery claim 为 `0/0/0/0/0/0`；未读
> credential、未调用 Provider、未启动 Docker/API/browser、未修改业务数据或合并 main。该检查点当时下一原子
> 任务仅 F2；后续 F2 已按上方日志完成。完整验收见
> `docs/acceptance/phase-6-9-7-tutor-organizer-f1-full-contract-baseline.md`。
>
> 2026-08-01 — Phase 6.9.7 Tutor / Organizer P2 Zero-provider Full-gate Design：
> 唯一 L2 继续保持 `small_sample_quality_gate_passed / small_sample_semantic_gate` sealed 终态且不得重跑；
> P2 没有读取 credential 或调用 Provider，只在任何新 full runner/Mock/Live 前冻结独立
> `phase-6.9.7-tutor-organizer-full-gate-v1` lineage。
>
> 完整 V2 dataset 现场复核为 `72 entries / 24 guards / 24 pairs / 48 runtime lanes / 32 Organizer
decisions`，dataset/policy SHA 保持 `42803d45...b437b / b3913403...f009d`。新 full manifest SHA 为
> `e68e6e27...12c78`；fresh deterministic baseline 仍为 `12/48`、Tutor/Organizer/Combined
> `0.6629642857 / 0.278125 / 0.4705446429`，source baseline SHA `0ce7c3ca...116ca`，新 baseline authority
> SHA `2ab1030f...a5f2`。
>
> Full eval policy SHA 冻结为 `11371d16...f503`：全量三个 semantic 均 `>=0.85`，两 lane 相对 full
> baseline 各提升 `>=0.15`；L2 八对作为同一次 full run 内的 anchor subset 再过原门，但不要求复现 L2
> 的随机实际分数。Guard/runtime/wire/verified usage 分母固定 `24/48/48/48`，安全/权限/mutation/locked-name/
> write leakage 全 0。
>
> P2 恢复四组 24-sample nearest-rank P95（第 23 值）：Tutor `<=2500ms`、Organizer/paired
> `<=4500ms`、Tutor local orchestration `<=6500ms`；executor hard timeout 为 `3500/5000ms`。预算冻结
> `48 calls / 112800 input / 26400 output / 0.55 CNY`，no retry/resume/replay/backfill。
>
> 并发/丢失边界固定 guard-first、pair-serial、pair 内最大双 lane、独立 sibling terminal、contract failure
> 收口当前 pair 后 breaker、dispatch 前 hash-chain+fsync、exclusive marker/hard-link publication 与 crash-only
> zero-wire seal。Candidate/adapter 七个内容 SHA 继续绑定 L2 source commit `4c608445...c22af1c4`；旧 approved
> tag 未移动或重建。
>
> 本阶段 formal full-gate marker/journal/artifact/recovery claim 为 `0/0/0/0`，未启动 Docker/API/browser、
> 未修改业务数据或合并 main。下一原子任务仅 F1 full manifest/baseline/report/scorer/gate 实现，仍为
> zero-provider；完整设计、计划与验收见
> `docs/superpowers/specs/phase-6-9-7-tutor-organizer-p2-zero-provider-full-gate-design.md`、
> `docs/superpowers/plans/phase-6-9-7-tutor-organizer-p2-zero-provider-full-gate.md` 与
> `docs/acceptance/phase-6-9-7-tutor-organizer-p2-zero-provider-full-gate.md`。
>
> 2026-08-01 — Phase 6.9.7 Tutor / Organizer Small-sample L2 唯一 Controlled-Live：
> 用户已重新接受本次运行时 DeepSeek 当前账号的数据保留/训练边界，并给出冻结 exact authorization。
> Approved source commit、HEAD、upstream、远程分支与 tag
> `phase-6-9-7-tutor-organizer-small-sample-s2-approved` 均解析到
> `4c6084455d0cea6b4a5ddd94511bce29c22af1c4`；tracked source clean、正式 artifact=0，fresh preflight 为
> `direct_ready / providerCalls=0`。既有根 `.env` credential 只映射到唯一子进程专用变量，未打印、写回或
> 进入 CLI、journal、artifact 与 Git。
>
> 唯一 run `6918df4f-a4ae-4de0-aa21-c7614ed5861d` 已由正常 runtime 路径 durable seal。Guard `8/8`；
> runtime reserved/terminal/orphan/not-started 为 `16/16/0/0`；wire executor/dispatch/response/verified usage
> 为 `16/16/16/16`；strict runtime `16/16`。Tutor/Organizer/Combined semantic 为
> `0.9141666666666668 / 1 / 0.9570833333333334`，相对冻结 baseline 的提升为
> `0.2071428571428573 / 0.7625`，安全失败全 `0`。
>
> Verified usage 为 input/output `7032/244`，费用 `0.02256 CNY`。8-pair 样本只记录 median/max，P95 仍为
> `null / insufficient_sample_size_8`，不产生 SLA 或产品性能 authority。最终 gate 为
> `small_sample_quality_gate_passed`，quality authority 为 `small_sample_semantic_gate`。
>
> 正式 marker/journal/artifact/recovery claim 为 `1/1/1/0`；journal `180` 条并以
> `evidence_published` 收口。Logical report SHA 为 `a981e188...eeb8`，physical artifact SHA 为
> `a1b51f05...eb0d`；只读 bundle validator 返回 `ok=true`。Approved tag 继续固定在实际运行源码 commit，
> 不随本次文档提交移动。
>
> L2 名额已消费，禁止 retry/resume/replay/backfill、Live/seal/recovery、单 case 或其它追加 Provider 探测，
> 也不得删除或改写 sealed artifact。本次未执行 48-case、产品 Docker/API/browser、业务数据、main 或后续
> phase。L2 收口当时只解锁 P2 zero-provider full-gate design；该 P2 后续已按上方日志完成。完整验收见
> `docs/acceptance/phase-6-9-7-tutor-organizer-small-sample-l2-controlled-live.md`。
>
> 2026-08-01 — Phase 6.9.7 Tutor / Organizer Small-sample S2 Reviewed Mock / Static：
> S2 已在 zero-provider 边界内完成。新增 reviewed Mock composition，真实穿过 Tutor V6、Organizer V9、
> 第一方 DeepSeek V4 Pro direct adapter 的 synthetic fetch seam、strict validator、本地 authority/merger 与 G2
> fixed-denominator runner。Mock responder 只读取实际 bounded prompt；`expected` 只进入后置 scorer，actual
> 由 model-owned decision 与本地 authority/merger 重建并与 runtime semantic axes 交叉核验。
>
> 正常路径为 guard `8/8` actual zero-call、runtime/wire/verified usage `16/16/16/16`、Tutor/Organizer/
> Combined semantic `1/1/1`、usage `5949/180`、synthetic estimated cost `0.018927 CNY`，gate 固定
> `mock_quality_not_evidence`。8-sample 不生成 P95 authority；本机 synthetic token、费用、median/max 不是
> Provider 账单、真实延迟或产品质量证据。
>
> Fault matrix 覆盖 25 类 transport/HTTP/response/schema/selection/usage failure、semantic axes drift、
> write-command shape、pre/mid abort、single-dispatch/no-backfill，以及 Tutor `3500ms` / Organizer `5000ms`
> hard timeout。locked-name/no-write 从实际结果重新观测，任一漂移都 fail-closed。
>
> S2 focused `35/35`（603 assertions）、G1+G2+S2 `87/87`（1595 assertions）、Agent full
> `1062/1062`（17953 assertions）、AI full `323/323`（2366 assertions）、Types `42/42 + tsc --noEmit`、
> Web `439/439`、Agent/AI typecheck/lint、Web lint、Prettier、baseline same-bytes 与 `git diff --check`
> 通过。V1--V9/R3/L1 validators 与 artifact SHA parity 保持；项目根正式 L2 marker/journal/artifact/
> recovery claim 为 0。三路独立 composition/security/fault 复审均 `APPROVED`，最终 Reader Testing 见 S2
> 验收文档。
>
> S2 未读取 `.env`/credential、未调用 Provider、未创建 approved tag、未启动 Docker/API/browser、未修改
> 业务数据、未合并 main。未来独立 L2 admission 只能在 S2 commit 已推送且 HEAD/upstream/remote parity 后
> 创建/绑定 approved tag，并仍需重新接受运行当时的数据边界和给出 exact authorization。完整验收见
> `docs/acceptance/phase-6-9-7-tutor-organizer-small-sample-s2-reviewed-mock-static.md`。
>
> 2026-07-31 — Phase 6.9.7 Tutor / Organizer Small-sample G2 Runner / Durability：
> G1 的 pure report/scorer/gate 已接入独立 one-shot execution/evidence 路径。新增固定 production CLI、
> source/approval/dedicated credential gate、guard-first/pair-serial 双 lane runner、Live composition、exclusive
> marker、fsynced hash-chain journal、hard-link artifact、strict bundle validator 与 crash-only seal；G2 全程
> zero-provider，未执行正式 Mock/L2。
>
> Public CLI 只接收 `args + AbortSignal`；root/env/clock/UUID/writer/model/URL/fetch/transport/retry 均由模块
> 固定。执行顺序为 preflight -> source -> approval -> dedicated credential -> marker -> guards -> pairs ->
> publication。Source admission 绑定固定分支、tracked clean、HEAD/upstream/remote、未来 L2 admission 创建/
> 绑定的 approved tag、正式 artifact=0 与 Tutor/Organizer/adapter SHA；G2/S2 均未创建该 tag，因此 L2
> 仍在 credential/marker 前关闭。
>
> Runner 先真实执行 8 guards，再串行推进 8 pairs；pair 内 Tutor/Organizer lane 各有独立 budget、
> AbortController、hard timeout、wire 和 terminal。Semantic mismatch 不开 breaker；transport/HTTP/schema/usage/
> timeout/abort 等 contract failure 会先保留 sibling terminal，再让后续 14 lane 保持 fixed-denominator
> `not_started_quality_breaker`。外部父请求取消已与 lane 内部 abort 分开，统一记录为 `external_abort`。
>
> Crash-only seal 不 preflight/source/approval/credential、不创建 harness/transport、不调用 Provider。两个关键
> anchor 均已覆盖：第一条 lane 已 durable reservation、sibling 尚未 reservation；以及 8 guards 已完成、首对
> lane 尚未 reservation。Recovery 只为当前开放/待锚定 pair 补零-wire reservation 并立即
> `attempted_aborted`，后续 pair 固定 quality breaker；这不是 resume/replay/retry。Runtime terminal 已 durable
> 时只允许原 report 的 publication recovery。
>
> Durability fault matrix 覆盖并发 marker、truncated/CRLF/hash rewrite、额外正式文件、live owner、dead-owner
> single-winner claim、claim-tail rewrite、`publication_started` 永久 fail-closed、历史 lineage 双向拒绝与非普通
> marker。Node 无跨平台 `openat/dirfd` 的同用户窄 TOCTOU 仍保留为 trusted single-user workspace 边界，不
> 宣称跨主机 lease、Provider exactly-once 或断电目录项 durability。
>
> 最终 G2 focused `32/32`（857 assertions）、G1+G2 `52/52`（992 assertions）、Agent full
> `1027/1027`（17337 assertions）、typecheck/lint、baseline `same_bytes`、V1--V9/R3/L1 validators 与 SHA
> parity 通过。项目根正式 L2 marker/journal/artifact/recovery claim 为 0；未读取 `.env`/credential、调用
> Provider、启动 Docker/API/browser、修改业务数据或合并 main。完整验收见
> `docs/acceptance/phase-6-9-7-tutor-organizer-small-sample-g2-runner-durability.md`。
>
> G2 authority 仅为 `zero_provider_runner_durability`，不证明 Agent 真实语义或产品可用。G2 当时的下一原子
> 任务仅 S2 reviewed Mock/static checkpoint；后续 S2 已完成。L2/48-case、产品 Docker/API/browser、main、
> Phase 6.9.8 与后续阶段继续阻断。
>
> 2026-07-31 — Phase 6.9.7 Tutor / Organizer Small-sample G1 Contract / Baseline：
> P1 设计已落成独立 zero-provider manifest、deterministic baseline、strict report/scorer/gate 与 fixed-path
> baseline CLI。新实现不读取 `.env`/credential，不导入 Provider/Mock/Live/candidate，不启动 Docker/API/
> browser，也没有创建正式 marker/journal/artifact 或修改业务数据。
>
> Manifest 继续固定 4+4 guards、8 pairs、16 runtime lanes、12 Organizer decisions，SHA 为
> `ae667f1c...edf61`。正式 baseline 复现 Tutor/Organizer/Combined
> `0.7070238095238095 / 0.2375 / 0.47226190476190477`；authority/logical report/physical file SHA 分别冻结为
> `d36d0789...d9f4e / ad3aa54d...d002 / e8bcbcb5...658b`，eval policy SHA 为
> `1cab7786...399a`。Baseline 文件内部只记录 logical report SHA，validator 对实际 bytes 单独返回 physical
> SHA，避免自引用 hash。
>
> Report 从 24 entries 重算 scheduler、wire、semantic、latency、usage、safety、breaker 与 gate。Guard
> dispatch 不进入 16-lane wire 分母但记 critical；pair 缺 lane、asymmetric terminal、breaker 后继续执行、
> aggregate/usage/wire 篡改与旧 V1--V9/R3/R4/L1 lineage 全 fail-closed。任一正式 evidence 不完整时
> semantic/latency/token/CNY aggregate 全 `null`；8-sample P95 永远 `null`；Mock 永远只能是
> `mock_quality_not_evidence`。
>
> Baseline writer 固定 `.tmp/phase-6-9-7-tutor-organizer-small-sample-baseline.json`，使用 exclusive-create、
> parent/final path realpath+lstat、handle/path dev+ino，并在写前与 sync 后重复核验；same-bytes 也经 readonly
> handle、strict bytes validator 与末次 identity 校验。Parent swap、existing symlink、post-sync swap 测试通过。
> Node 缺少跨平台 `openat/dirfd` 的同用户极窄竞态如实保留为 trusted-workspace 边界，不冒充对主动本地攻击
> 的完整防护。
>
> 最终 G1 focused `20/20`（135 assertions）、V2 baseline regression `11/11`（371 assertions）、Agent full
> `995/995`（16462 assertions）、typecheck/lint 与独立 contract/security 复审通过。Baseline CLI 最终返回
> `same_bytes` 且 logical/physical SHA 精确匹配。完整验收见
> `docs/acceptance/phase-6-9-7-tutor-organizer-small-sample-g1-contract-baseline.md`。
>
> G1 authority 仅为 `zero_provider_contract_baseline`，不证明真实 Tutor/Organizer 语义或产品可用。G1 验收
> 当时下一原子任务仅 G2；后续 G2/S2、唯一 L2 与 P2 zero-provider full-gate design 均已按上方日志完成。
> S3 reviewed Mock/static 后续已按上方日志完成；截至该条日志时下一任务仅独立 L3 admission。L3、产品
> Docker/API/browser、main 与 Phase 6.9.8 继续阻断。
>
> 2026-07-31 — Phase 6.9.7 Tutor / Organizer P1 Zero-provider Small-sample Semantic Gate：
> Provider Canary V2 L1 仍保持 `diagnostic_only / qualityAuthority=none` 且不得重跑；本任务只完成新的
> small-sample 路线设计，没有把 L1 fact-free health response 写成 Agent 语义证据。新 lineage 固定为
> `phase-6.9.7-tutor-organizer-small-sample-v1`。
>
> 从 frozen `phase-6.9-tutor-wrong-question-v2` / `42803d45...b437b` 固定选择 4+4 critical guards 与
> 8 个 runtime pairs（16 lanes / 12 Organizer decisions）；pair IDs 为 `01/08/10/12/15/19/23/24`，覆盖
> Tutor 全部 5 intents、zh/en/mixed/conflicting-signals，以及 Organizer 全部 6 subjects、create/reuse、
> single/batch、structured subject、locked-name/no-write。Manifest SHA 为 `ae667f1c...edf61`。
>
> 只读 deterministic subset 审计得到 Tutor/Organizer/Combined
> `0.7070238095238095 / 0.2375 / 0.47226190476190477`，baseline authority payload SHA 为
> `d36d0789...d9f4e`；Provider/token/cost 为 0。未来 G1 必须用正式 contract 复现并冻结 report SHA，
> 不能复用 72-case full baseline SHA 或 Mock `1/1/1`。
>
> 质量门固定为 guard `8/8` zero-call、runtime strict/wire/verified usage `16/16/16/16`、三个 semantic
> 均 `>=0.85`、Tutor/Organizer 各提升 `>=0.15`、critical/permission/mutation/broader fallback=0。8-sample
> 不伪造 24-sample P95，只记录 `3500/5000ms` hard timeout 与 median/max；L2 cap 固定
> `16 calls / 37600 input / 8800 output / 0.176 CNY`，no retry/resume/replay/backfill。
>
> 收口验证重算 manifest/baseline/source SHA 与 8 guards、8 pairs、16 lanes、12 decisions 全部精确匹配；
> 未修饰 deterministic functions 再现全部 subset baseline axes。14 个相关 Markdown 的 Prettier、96 个本地
> 链接、冲突标记、`git diff --check` 与掩码敏感赋值扫描通过；无上下文 Reader Testing 及独立一致性/安全
> 复审无剩余 Critical/Important。该验证仍只证明 P1 设计自洽，不是 G1 可执行证据。
>
> 本阶段没有读取 `.env`/credential、调用 Provider、运行小样本/Mock、启动 Docker/API/browser、创建正式
> marker/journal/artifact 或修改业务数据。本 P1 收口当时下一原子任务为 G1；后续 G1 已按上方日志完成。
> P1 验收当时要求 G2/S2 完成并推送前不得请求 L2；后续 G2/S2 与唯一 L2 均已完成。完整设计、计划与验收见
> `docs/superpowers/specs/phase-6-9-7-tutor-organizer-p1-zero-provider-semantic-gate-design.md`、
> `docs/superpowers/plans/phase-6-9-7-tutor-organizer-p1-zero-provider-semantic-gate.md` 与
> `docs/acceptance/phase-6-9-7-tutor-organizer-p1-zero-provider-semantic-gate.md`。
>
> 2026-07-30 — Phase 6.9.7 Architecture Recovery Provider Canary V2 L1 Controlled-Live：
> 用户重新接受运行时 DeepSeek 当前账号的数据保留/训练边界并给出冻结 exact confirmation 后，唯一 L1 run
> `dc09214c-0300-4153-8273-e548ac768d20` 在 source commit `8d463e8c...` 上执行并成功封存。Fresh
> zero-provider preflight 为 `loopback_proxy_ready / configured=4 / probe=1 / providerCalls=0`，source gate
> 确认 branch/tracked clean/HEAD-upstream-remote parity、正式 V2 artifact=0 与 R3 parity。
>
> 正式终态为 `complete / strict_response_with_verified_usage`，response/strict 均为 `true`，wire
> executor/dispatch/response/usage=`1/1/1/1`，usage input/output=`49/5`，费用 `0.00017700 CNY` 且低于
> `0.00200000 CNY` cap。Journal 共 `12` 条并以 `evidence_published` 收口；bundle validator
> `ok=true / evidenceCount=1`，V2 marker/journal/artifact SHA 分别为
> `c3e5ac...b287e5 / c19abf...903d7 / 98368de...a7e4`，无 recovery claim。R3 validator 仍 `ok=true`，
> 三份 SHA 保持 `6eef1a...89b6a / 426d64...7f7b / 56fb5b...e6c4`。
>
> 一条临时 launcher 命令曾在进入 Bun 前因 Bash 引号解析失败；当时再次确认正式 V2 文件为 0，未读取
> credential、创建 marker 或调用 Provider，因此不构成 L1 attempt。正式运行使用不含密钥的临时启动器；
> approval/credential 仅映射到授权进程，启动器在退出后删除，未写回 `.env` 或 evidence。
>
> 本次 artifact 仍为 `status=diagnostic_only / qualityAuthority=none`：只证明一次 fact-free request 的 strict
> response、verified usage 与 durability，不证明 Provider 长期健康、Tutor/Organizer 语义、RAG/写隔离或
> 产品可用。L1 名额已消费，禁止 retry/resume/replay/backfill、crash seal 或追加 Provider 探测。当时下一原子
> 任务仅为 P1 zero-provider 小样本 semantic gate 设计；小样本/48-case、Docker/API/browser、main、Phase 6.9.8
> 继续阻断。验收见
> `docs/acceptance/phase-6-9-7-architecture-recovery-provider-canary-v2-l1-success-diagnostic-only.md`。
>
> 2026-07-30 — Phase 6.9.7 Architecture Recovery Provider Canary V2 C2/S1 One-shot Durability：
> 已完成独立 V2 source、approval/credential gate、固定 production CLI、exclusive marker、fsynced
> hash-chain journal、bounded terminal、hard-link artifact/strict validator 与 crash-only seal。Public CLI 只
> 接收 `args + AbortSignal`；root/env/fetch/URL/model/proxy/timeout/clock/UUID/writer/output/retry 等注入均不
> 存在，test-only seam 也未从 package index 导出。
>
> 调用顺序固定为 preflight -> source -> approval -> dedicated credential -> marker -> single dispatch ->
> terminal -> publication。测试覆盖 preflight/source/credential zero-stop、single dispatch/no retry、abort/
> timeout/late completion、exclusive marker、wire monotonicity、terminal/publication race、活 owner 拒绝、死
> owner single-winner seal、terminal publication recovery、journal drift 与 `publication_started` 永久
> fail-closed；V2/R3 confirmation、filename、marker/schema 双向隔离。
>
> Fresh C2 focused `32/32`（`214` assertions）、Architecture Recovery `91/91`（`780` assertions）、AI
> full `323/323`（`2366` assertions）、typecheck/lint/Prettier/diff 与独立实现/安全/文档复审通过。所有
> runtime/publication 成功只发生在自动清理的系统临时测试根，项目根正式 V2 marker/journal/artifact/
> recovery claim 为 0。
>
> 本阶段未读取根 `.env`/真实 credential、调用 Provider、启动 Docker/API/browser 或触碰 V1--V9/R3
> sealed evidence。R3 validator 仍 `ok=true`，三份 SHA 保持 `6eef1a...89b6a / 426d64...7f7b /
56fb5b...e6c4`。C2/S1 已完成并推送后必须停在 L1；普通“继续/开始/同意”不授权。验收见
> `docs/acceptance/phase-6-9-7-architecture-recovery-provider-canary-v2-c2-one-shot-durability.md`。
>
> 2026-07-30 — Phase 6.9.7 Architecture Recovery Provider Canary V2 C1 Zero-network Contract：
> 已新增独立 V2 request、proxy-attestation、budget、report、fault-matrix 与 CLI identity；不导入或复用 R3
> 顶层 contract、marker、journal、artifact 或 recovery authority。Report 固定
> `synthetic_test / qualityAuthority=none / providerHealth=unknown / zeroNetwork=true`，V7 wire 为
> `not_started`，executor/dispatch/response/verified-usage 与 credential/source/marker/provider counter 全为 0。
>
> Proxy preflight ready 后只在进程内铸造空对象 capability，真实状态保存在模块私有 `WeakMap`；消费在异步
> 边界前同步完成，clone、伪造、replay 与 8 个并发消费者中的后 7 个均 fail-closed。Preflight failure/abort
> 不铸造 capability。有效 R2/R3 report 与 V2 report 已做双向 schema/version rejection。
>
> C1 CLI 只允许 `mock` 或 `fault-matrix`，拒绝 Live、credential、URL、proxy override、retry、output；closed
> fault matrix 覆盖 direct/loopback ready、unavailable、throw/hang、abort、hostile env、`NO_PROXY`、proxy
> conflict 与 capability 边界。Fresh focused `13/13`（`117` assertions）、Recovery regression `59/59`
> （`566` assertions）、AI full `291/291`（`2152` assertions）、CLI `15/15`、typecheck/lint/Prettier/diff
> 均通过；独立实现/安全/测试复审无未关闭 Critical/Important/Minor。
>
> 本任务未读取 `.env`/credential、调用 Provider/curl/DNS/TLS、创建 V2 source/marker/journal/artifact/
> recovery claim、启动 Docker/API/browser 或修改业务数据。R3 validator 仍
> `ok=true / runId=253a5df5-c443-4950-b517-849efb941728`，marker/journal/artifact SHA 保持
> `6eef1a...89b6a / 426d64...7f7b / 56fb5b...e6c4`。该 C1 checkpoint 当时下一原子任务仅 C2 zero-provider
> one-shot/durability/evidence；L1 仍未授权。验收见
> `docs/acceptance/phase-6-9-7-architecture-recovery-provider-canary-v2-c1-zero-network-contract.md`。
>
> 2026-07-30 — Phase 6.9.7 Architecture Recovery Provider Canary V2 D0 Re-entry Design：
> 宿主 Clash Verge core 按既有配置恢复 listener 后，只重跑了已验收的 zero-provider proxy preflight；结果为
> `loopback_proxy_ready / configured=4 / probe=1 / providerCalls=0`。本次没有手工清空/绕过或改写当前进程
> proxy/`NO_PROXY`，也没有读取模型 credential、调用 Provider、创建 marker/journal/artifact，或触碰
> Docker/业务数据。
> Listener ready 只证明当前本地 TCP 前置条件，不证明代理转发、DNS/TLS、DeepSeek、账号、余额、模型权限、
> 限流或服务端健康，也不能反向把 proxy 写成 R3 唯一根因。
>
> 新的独立 Provider Canary V2 D0 设计已冻结：不复用旧 R3/R4 confirmation、marker、journal、artifact、
> recovery 或版本 namespace；阶段改用 D0/C1/C2/S1/L1/P1。未来单次 fact-free canary 固定 DeepSeek V4
> Pro、5000ms、`1/512/16`、`0.00200000 CNY`、no retry，并强制
> `exact args -> 8-key proxy snapshot/preflight -> source parity -> dedicated credential -> marker -> one
dispatch -> bounded terminal -> exclusive publication`。Preflight 失败时 credential/source/marker/Provider
> 必须全部 0-call；success 也只生成进程内 single-consume attestation，不保存 proxy URL/port 或网络健康结论。
>
> R3 marker/journal/artifact 物理 SHA 仍为 `6eef1a...89b6a / 426d64...7f7b / 56fb5b...e6c4`，bundle
> validator `ok=true`。D0 authority 仅为 `design_checkpoint / diagnostic_only / qualityAuthority=none`；没有
> 实现或授权 controlled-Live。下一原子任务仅 C1 zero-network contract；C1/C2/S1 完成并推送后还必须停在
> L1 新数据边界与 exact confirmation 门前。设计、计划与验收见
> `docs/superpowers/specs/phase-6-9-7-architecture-recovery-provider-canary-v2-design.md`、
> `docs/superpowers/plans/phase-6-9-7-architecture-recovery-provider-canary-v2.md` 与
> `docs/acceptance/phase-6-9-7-architecture-recovery-provider-canary-v2-d0-reentry-design.md`。
>
> 2026-07-30 — Phase 6.9.7 Architecture Recovery Zero-provider Proxy Preflight：
> R3 failure seal 之后新增独立、未编号的 proxy preflight；它不复用 R3 confirmation、marker、journal、
> artifact 或 recovery claim。纯 contract 只允许无 proxy 的 direct 模式，或所有已配置 proxy 变量严格一致
> 指向显式 loopback HTTP URL；`NO_PROXY` 非空、uppercase/lowercase authority 冲突、userinfo、非 HTTP、
> 非 loopback、缺失/非法端口、path/query/hash、控制字符和 hostile getter/Proxy 均在 listener 前 fail-closed。
>
> Windows/Bun 的 `process.env` 使用 accessor descriptor，因此正式 CLI 只在 composition root 读取固定八个
> proxy/`NO_PROXY` key 并转成 own-data snapshot；不会枚举整份环境、读取根 `.env` 或模型 credential。
> listener probe 只连接已验证的 `127.0.0.1` / `::1`，250ms、无 payload、连接后立即销毁；核心 runner
> 自己强制 watchdog，永不 settle 或忽略 abort 的 probe 也会有界收口。输出只含固定 enum、boolean、计数，
> `providerCalls` 永远为 `0`。
>
> Focused `14/14`、R3 regression `18/18`、AI full `278/278`（`2035` assertions）、typecheck/lint、
> Prettier/diff 与三路独立复审通过。
> 实际 CLI 预期以 exit `1` fail-closed：`loopback_proxy_unavailable / configured=4 / probe=1 /
providerCalls=0`。这只证明当前 loopback listener 未就绪，不证明或否定 Provider、DNS/TLS、代理转发、
> 账号、余额、模型权限或服务端健康，也没有把 R3 相关性升级成唯一根因。本任务未调用 Provider/fetch、
> 未读取 credential、未创建新 marker/journal/artifact、未启动 Docker/API/browser 或修改业务数据；R3 仍
> 禁止重跑/Live/seal，R4、产品/main 与后续阶段继续阻断。完整证据见
> `docs/acceptance/2026-07-30-phase-6-9-7-architecture-recovery-proxy-preflight.md`。
>
> 2026-07-30 — Phase 6.9.7 Architecture Recovery R3 Controlled-Live Diagnostic Failure Seal：
> 用户重新接受 DeepSeek 数据边界并在 evidence-root 修复提交 `9c297da3` 推送后给出新的 exact
> confirmation。唯一 run `253a5df5-c443-4950-b517-849efb941728` 已消费授权并由正常 runtime 路径
> durable seal：`outcome=transport_failed`、`attemptDisposition=dispatched_no_response`、provider
> `transportSubtype=connection_refused`、wire `1/1/0/0`，最后完成阶段为 `provider_dispatch_started`。
> `responseObserved=false`，usage、actual token、estimated CNY 与 within-cap 全为 `null`，不能写成零费用。
>
> Marker、7 条 hash-chain journal 与 artifact 已完成 `runtime_terminal -> publication_started ->
evidence_published`；无 recovery claim，不需要也不允许 crash-only seal。Artifact SHA-256 为
> `56fb5b1d196d2af9cc4aab5476d766d87ca9d794896e3c93df9268d13e62e6c4`。独立复审重新核对 source、
> marker/report/evidence SHA、7 条 hash chain、wire/预算/null 聚合与 authority，无 Critical/Important/Minor。
>
> 封存后 zero-network 检查发现当前进程四个 HTTP(S) proxy 变量均指向 loopback `127.0.0.1:7897`，
> 当时本机该端口监听数为 0；根 `.env` 不定义这些变量。该条件与 `connection_refused` 高度一致，但 artifact
> 有意不保存 socket peer/raw error，因此只记录为未证实的最可能本地相关因素，不能归因 DeepSeek、DNS/TLS、
> 代理软件、路由、防火墙、凭据、账号、余额、模型权限或限流。
>
> 本轮没有 curl、DNS/TLS、清空 proxy、第二次 Provider、Tutor/Organizer 小样本/48-case、Docker/API/
> browser、业务写或 main。R3 不得 retry/resume/replay/backfill、删除/改写 artifact 或运行 seal。R4 与
> 后续阶段继续阻断；下一安全原子任务仅 zero-provider proxy/preflight 架构复盘。完整证据见
> `docs/acceptance/2026-07-30-phase-6-9-7-architecture-recovery-r3-controlled-live-failure.md`。
>
> 2026-07-30 — Phase 6.9.7 Architecture Recovery R3 Windows Evidence-root Pre-reservation Fix：
> 用户给出旧 R3 exact confirmation 并接受 DeepSeek 数据边界后，分支、tracked clean、`HEAD == @{u}`、
> 正式 artifact=0 与专用 credential 映射 preflight 均通过。唯一一次 CLI 进程随后返回
> `r3_live_once_already_consumed_or_evidence_io / evidenceSealed=false / exit=1`。失败发生在 reservation、
> marker/journal 创建和 Provider transport 之前：Provider invocation/dispatch=`0`，marker、journal、claim、
> artifact 仍全部为 `0`，因此不适用 crash-only seal，也没有任何 Provider health authority。
>
> 根因是 Windows 下由目录 URL 生成的默认 evidence root 自带尾部 `\\`；旧 `resolveRelative()` 又用
> `startsWith(root + "\\")` 做字符串围栏，拼出了双反斜杠并把合法 `.tmp` 子路径误判为越界。该问题与
> DeepSeek、DNS/TLS、代理、账号、余额、模型权限或服务端无关，因为 transport 根本没有构造或调用。
>
> 修复将 `requireRoot()` 统一经 `node:path.resolve()` 去除非根目录尾分隔符，并把子路径围栏改为
> `resolve + relative` containment；空 child、父目录逃逸与绝对逃逸均 fail-closed。新增真实目录 URL
> 尾分隔符回归。该围栏是受信工作区内的词法 containment，不宣称抵御恶意本地 symlink/TOCTOU。
>
> 修复后 R3 focused `18/18`（`123` assertions）、R2 regression `14/14`（`218` assertions）、AI package
> `264/264`（`1927` assertions），`@repo/ai` typecheck/lint、Prettier 与 diff check 通过；独立实现与安全
> 复审无 Critical/Important。正式 R3 artifact 仍为 `0`。旧 exact confirmation 已用于一次 CLI 进程且
> 源码已变化，不得复用；用户已重新接受本次 DeepSeek 数据边界，修复提交并推送后仍须新的 exact
> confirmation，才能执行新的唯一 canary。
>
> 2026-07-30 — Phase 6.9.7 Architecture Recovery R3 Controlled-Live Canary Zero-provider Checkpoint：
> 在 R2 fact-free request/report/预算基础上新增完全独立的 R3 report/artifact/marker/journal/recovery-claim/
> CLI identity。正式 CLI 只接受 exact confirmation，并固定检查
> `codex/phase-6-9-7-tutor-wrong-question-agents`、tracked worktree clean 与 `HEAD == @{u}`；只有专用
> `PHASE_6_9_7_ARCHITECTURE_RECOVERY_R3_CONTROLLED_LIVE_APPROVED=true` 和
> `PHASE_6_9_7_ARCHITECTURE_RECOVERY_R3_DEEPSEEK_API_KEY` 同时存在才允许继续。公开 CLI 已取消外部
> ports 注入，不能替换 fetch/transport/URL/model/writer/clock/UUID/source reader，也不接受 retry、resume、
> replay 或 output path。
>
> R3 复用 R2 固定 fact-free request、`1 call / 512 input / 16 output` 与 `0.00200000 CNY` hard cap，
> timeout 固定 `5000ms`。Provider dispatch 前先 exclusive-create 带 owner PID/token 的一次性 marker，并将
> marker SHA 写入 `attempt_reserved`。Wire stage、terminal、publication 使用独立 hash-chain journal；terminal
> 记录内嵌完整 bounded report，artifact 固定
> `authority=controlled_live / status=diagnostic_only / qualityAuthority=none`。Validator 会重新关联 source、
> marker/report/evidence SHA、terminal outcome/report、completion/publication mode、recovery claim 与原始 journal
> tail，拒绝重哈希后的语义篡改。
>
> 发布状态新增 durable `publication_started`；该事件之后任何 hard-link、journal、stdout 或 validator I/O
> failure 永久 fail-closed，不会再次发布。Crash-only sealer 只在 owner 已死亡时读取已有 marker/journal，
> 用 exclusive 单胜者 claim、dead stale-claim takeover、claim ownership 和 journal-tail fence 重建
> `not_dispatched / dispatched_no_response / response_observed`。它不读取 credential、不创建 transport、
> 不 retry/resume/replay/backfill Provider；活 owner、journal drift 和并发 loser 均安全拒绝。
>
> 该初始 checkpoint 当时的 R3 focused 为 `17/17`（`121` assertions），R2 regression `14/14`（`218` assertions），AI package
> `263/263`（`1925` assertions），`@repo/ai` typecheck/lint、Prettier 与 diff check 通过。实现、安全、测试缺口
> 三路复审均无未关闭 Critical/Important。测试覆盖 marker/journal/terminal/publication I/O、并发终态、
> terminal report 篡改、活/死 owner、单胜者/stale claim、crash-only seal 与已有 terminal publication recovery。
>
> 本任务全程 zero-provider：没有读取 `.env`/credential、调用 DeepSeek/curl/DNS/TLS、执行正式 R3 Live 或
> crash seal、启动 Tutor/Organizer 48-case、Docker/API/browser，亦未修改业务数据或 V1--V9 sealed
> artifact。仓库正式 R3 marker/journal/recovery claim/artifact 为 0。下一原子任务只是在用户另行给出
> `I_AUTHORIZE_PHASE_6_9_7_ARCHITECTURE_RECOVERY_R3_CONTROLLED_LIVE_ONCE` 并再次接受运行时 DeepSeek
> 数据边界后，执行唯一一次低成本 health canary；授权前不得读取 credential 或调用 Provider。即使 canary
> `complete`，也不自动证明 Tutor/Organizer 语义或产品可用。完整验收见
> `docs/acceptance/2026-07-30-phase-6-9-7-architecture-recovery-r3-zero-provider-checkpoint.md`。
>
> 2026-07-30 — Phase 6.9.7 Architecture Recovery R2 Zero-network Provider Health Canary：
> 在 R1 bounded transport subtype 基础上，新增独立版本的 fact-free request、每次调用预算、strict report 与
> diagnostic-only artifact contract。请求固定 `deepseek-v4-pro` non-thinking JSON、no tools/stream/retry，
> 输出只允许 `{ "ok": true }`；每次 canary 预算固定为 `1 call / 512 input / 16 output`，hard cap
> `0.00200000 CNY`，并显式标记 `scope=per_invocation`。
>
> Runner 只接受 `mode=synthetic + closed scenario enum + timeout + AbortSignal`。初版独立审查发现
> synthetic factory 仍可接收调用方任意 `fetch`，理论上可注入真实网络却继续标记 `synthetic_test`；本轮
> 未保留该脆弱设计，而是彻底移除公开 `fetch/createTransport` 注入口。最终 runner 只把 20 个固定场景映射
> 到模块内 `Response/throw/abort-wait` 脚本，并在内部校验精确 URL/header/request body；调用方额外注入
> `fetch`、transport、Live mode、输出路径、未知参数或 hostile object 均在 executor 前 fail-closed。
>
> Report 区分 `complete/response_observed/transport_failed/response_invalid/aborted/timeout/
budget_exceeded/config_invalid/harness_internal`，复用 R1 九类 transport subtype 与 V7 executor/dispatch/
> response/verified-usage 计数。取消与 timeout 必须绑定一致 wire terminal；成功 terminal 优先于迟到 abort，
> 避免 `aborted + succeeded wire`。CLI 只允许 `mock` 与 `fault-matrix`，没有 env reader、credential resolver、
> 文件 writer、artifact publish、retry、seal 或 recovery；hostile output port 只返回 exit code 1。
>
> RED 为三个新模块 export 不存在；最终 R2 focused 为 `14/14`（`218` assertions），AI package
> `246/246`（`1804` assertions），AI/Agent typecheck/lint 通过。安全 CLI Mock 为 `complete`，固定 fault
> matrix 为 `21/21`，覆盖九类 transport、四类 HTTP、non-Response、JSON/schema/usage、预算、pre-abort 与
> runner timeout，并逐项校验 wire、reservation、usage、冻结与 no-raw。该输出全部是
> `authority=synthetic_test`；synthetic token/结果不是 Provider telemetry，也不证明 DNS/TLS、代理、账号、
> 余额、模型权限、服务端或 DeepSeek 健康。
>
> 本任务没有读取 `.env`/credential、调用 Provider/curl/DNS/TLS、运行 V9 Live/seal/recovery、启动
> Docker/API/browser、修改业务数据或创建正式 canary artifact；V1--V9 封存文件未触碰。首次 `bunx
prettier` 只在包清单下载阶段 `ConnectionRefused`，随后使用仓库本地 Prettier；该现象仍不能作为外部
> transport 根因。当前停止在新的真实 canary 授权门前；下一步只有用户另行明确授权后，才允许设计并
> 执行一次低成本真实 health canary，不能直接启动 Tutor/Organizer 48-case、产品验收或 main。
> 完整验收见
> `docs/acceptance/2026-07-30-phase-6-9-7-architecture-recovery-r2-provider-health-canary.md`。
>
> 2026-07-30 — Phase 6.9.7 Architecture Recovery R1 Transport 可诊断边界：用户在 V9 失败封存后
> 明确决定停止 V10/V11 式整套重试，先定位故障链路，再判断是否需要调整 Agent 或 Provider 架构。
> 只读调用链与 sealed evidence 复核确认：V9 Tutor 已通过 config、request validation 与 durable dispatch，
> 在 `20.4014ms` 内、`3500ms` timeout 之前由 fetch delegate throw；Runner 只在 Tutor terminal 之后
> abort Organizer。因此当前最小故障域是 Bun `globalThis.fetch` 到 HTTP Response 之间，而不是 Tutor
> contract、V9 option authority、Runner 主动 abort、JSON/schema 或 semantic。
>
> R1 新增 `first-party-deepseek-v4-pro-transport-diagnostic-adapter-v1`，以独立 wrapper 复用且不修改
> sealed `first-party-deepseek-v4-pro-direct-v1`。新 diagnostic
> `first-party-deepseek-v4-pro-transport-diagnostic-v1` 只返回固定
> `aborted/timeout/dns/tls/proxy/connection_refused/connection_reset/network_unreachable/unknown` subtype；
> 公共 `providerFailureCategory` 继续为 `transport`，V1--V9 wire/report/schema/source identity/validator 与
> sealed artifact 不增加字段、不重算 SHA。默认 delegate 才可标记
> `first_party_deepseek_v4_pro_transport_diagnostic` provenance；任何注入 delegate 永久为 `synthetic_test`。
>
> 分类只读取 error/cause 链最多四个对象的 own data descriptor `code/name`，不调用
> accessor getter 或 `toString`，不读取或保存 `message/stack`、URL、header、body、prompt、
> credential 或 raw error；循环、primitive、超长/未知 code 均 fail-closed 为 `unknown`。JavaScript
> 反射无法保证 Proxy descriptor trap 不执行，但 trap 失败会被捕获且不会通过诊断结果暴露原始数据；首个
> subtype 不被后续错误覆盖。RED 为新 export missing；GREEN focused 为 `6/6`（`127`
> assertions）。最终 AI package 为 `232/232`（`1586` assertions），V7/V8/V9 direct adapter/fault/
> runner/V9 option-security 零网络合同为 `59/59`（`3555` assertions）；AI/Agent typecheck/lint 均通过。
> V7/V8/V9 历史 validator 均为 `ok=true/filesChecked=1`，三路独立复审无 Critical/Important。V9
> evidence/journal/marker 在只读 validator 前后 SHA-256 逐字节一致。首次未向 V7 validator 别名
> 传 artifact path 时按合同返回 `evidence_read_failed/filesChecked=0`；改为显式只读路径后通过，该命令
> 未写 artifact，也未运行 Live/seal/recovery。
>
> 本任务未访问 DeepSeek。首次格式化调用 `bunx prettier` 时，Bun 对包仓库立即
> `ConnectionRefused`；随后改用仓库本地 Prettier。该现象仅作为当前 Bun 出站路径的旁证，不等于 V9
> DNS/TLS/TCP 根因，也不回填 V9 evidence。没有读取/打印 credential，没有执行 Provider、curl、DNS/TLS、
> V9 Live/seal/recovery、Docker/API/browser 或业务写入。该 R1 checkpoint 当时的下一原子任务仅 Recovery
> R2 zero-network Provider health canary contract/runner；后续 R2 已完成并停在真实 canary 授权门前。
> 完整验收见
> `docs/acceptance/2026-07-30-phase-6-9-7-architecture-recovery-r1-transport-diagnostics.md`。
>
> 2026-07-30 — Phase 6.9.7 V9 R5 Controlled-Live 失败封存：从 clean/pushed
> `ce308da643bfb0b9c150f0612f0c5aa926442687` 开始，local HEAD、tracking ref 与 GitHub remote
> parity、V9 artifact=0、Phase 6.9.6 与 V1--V8 validators、focused/full/static 和独立复审前门均通过。
> 用户在运行当时重新接受 DeepSeek 当前账号的数据保留/训练边界，并精确授权唯一一次 V9 branch
> controlled-Live。授权仅由一个隔离 Bun 子进程消费：根 `DEEPSEEK_API_KEY` 只映射为 Tutor/Organizer
> component credential，根 `.env` 未修改或打印，其它 Agent gate 未开启。
>
> 唯一 run `c530ca02-3ece-4f11-898c-5695c8252bd5` 完成 `24/24` guard verified zero-call。
> pair 0 两条 lane 各完成一次 durable reservation、executor entry 与 Provider dispatch，但均没有收到
> Provider response。Tutor `tutor-v2-runtime-01` 固定为
> `executed_failure / fallback_runtime_error / provider_runtime / transport`；Organizer
> `organizer-v2-runtime-01` 在 sibling failure 后以
> `attempted_aborted / fallback_aborted / post_dispatch_abort` 收口，没有复制 Tutor 的 transport category。
> Runner 随即打开 `quality_gate_impossible` breaker，后续 46 runtime 未启动。
>
> 正式结果为 pair dispatched/completed `1/1`、runtime reserved/terminal/orphan/not-started
> `2/2/0/46`、wire executor/dispatch/response/verified usage `2/2/0/0`、strict `0/48`、critical/provider/
> permission/mutation/broader fallback `0/1/0/0/0`，最终 `quality_gate_failed`。因为没有 response 或
> verified usage，Tutor/Organizer/combined semantic、四项 P95、token 与 CNY aggregate 全部为 `null`；
> 不能写成 `0 CNY`，也不能把 transport 进一步归因为 DNS、TLS、代理、账号、余额、模型权限或服务端。
>
> Marker、journal 与 evidence 已由正常路径 durable seal；evidence 绑定 seal 前 journal sequence `37`，
> 物理 journal 最后一条为 sequence `38` 的 `evidence_sealed(completed_run)`。V9 bundle validator 返回
> `ok=true/filesChecked=1`，不存在 recovery claim。授权已消费，禁止 retry/resume/replay/backfill、再次
> `v9:live`、seal/recovery、删除/覆盖/改写 artifact，以及 curl、单 case、产品 API 等追加 Provider 探测。
>
> 本次没有启动或清理 Docker、API、浏览器或业务数据。R6 产品 Docker/API/可见浏览器、R7/main、
> Phase 6.9.8、Phase 6.10、Phase 8/9 与博客收尾均被阻断；当前只允许读取、校验、文档化和独立审查
> 已封存事实。完整验收见
> `docs/acceptance/2026-07-30-phase-6-9-7-tutor-organizer-v9-controlled-live-failure.md`。
>
> 2026-07-29 — Phase 6.9.7 V9 R4 Reviewed Mock / Full Checkpoint：从 clean/pushed
> `a88ff533` 开始，在同一 `codex/phase-6-9-7-tutor-wrong-question-agents` 分支完成 zero-provider
> 原子任务。新增 V9 evaluation runtime、reviewed Mock factory 与公开 package export；CLI `mock` 默认接入
> factory，`live` 继续硬拒绝为 `live_runtime_unavailable_until_r5`。
>
> Tutor 复用未修改的正式 V6 candidate；Organizer 穿过 V9 本地合法 option authority、exact
> `questionIndex + optionIndex` selection、V6 validator/merger 与第一方 direct adapter，只有 `fetch`
> delegate 为 synthetic。Responder 只读实际 bounded prompt，不读 expected/oracle 或生产 validator answer
> generator。Factory SHA 为
> `sha256:e0918cbfa23ee4463c569f49db69b026d97f47597ab7cf9621579bf10465bf08`。
>
> Fresh baseline 保持 `12/48`，Tutor/Organizer/combined semantic 为
> `0.6629642857142858/0.278125/0.4705446428571429`。Reviewed Mock run
> `f039a7d2-c3b2-4286-9630-fee49d365a33` 为 `24/24` guard、`48/48` strict、wire
> `48/48/48/48`、semantic `1/1/1`、synthetic usage `17732/504`、estimated `0.05622 CNY`，gate
> `mock_quality_not_evidence`，validator `ok=true/filesChecked=1`。Mock evidence 已精确删除；V9
> marker/journal/evidence/recovery artifact 均为 0。
>
> R4 focused `12/12`（`1717` assertions）、V9 full `62/62`（`2430` assertions）、Agent
> `969/969`（`16228` assertions）、AI `226/226`、Types `42/42 + typecheck`、Web `439/439`、Server
> `227 suites / 2154 tests / 30 skipped`、readiness `9/9`、Organizer PostgreSQL `12/12`、Docker static
> boundary contract `3/3`、Compose default-off、相关 typecheck/lint/build、Phase 6.9.6 与 V1--V8 validators、测试
> 账号残留 0 和两路独立终审通过。初始并发验证出现历史 5 秒 timeout、Web ENOMEM 与 readiness 子进程
> 噪声，保持产品合同不变后改为低并发串行全部通过；只恢复既有 PostgreSQL/Redis，没有重建、删除、
> prune 或清卷。
>
> 本任务未读取 `.env`/credential、调用 Provider、执行 Live、启动产品 Web/Server/Worker/Admin/MinIO、
> 调用 API/浏览器、修改业务数据、触碰 V1--V8 artifact 或合并 main。Mock 满分不证明真实模型质量、
> Provider P95/usage/费用或产品可用性。该 R4 checkpoint 当时的下一原子任务仅 R5 新的精确一次性 V9
> branch controlled-Live 授权门；后续唯一 R5 已失败封存。验收见
> `docs/acceptance/phase-6-9-7-tutor-organizer-v9-r4-static-mock.md`。
>
> 2026-07-29 — Phase 6.9.7 V9 R3 Runner / Lineage / Durability：从 clean/pushed
> `e288f19386f64331e641fc27dfcbee058685ee67` 开始，在同一
> `codex/phase-6-9-7-tutor-wrong-question-agents` 分支完成 zero-provider 原子任务。CodeGraph 已初始化，
> 但其它进程持有写锁；本轮没有反复争锁，源码、测试和文档结论均以 FastCtx 当前磁盘文件与实际命令
> 为准。
>
> 新增独立 V9 report/runner/CLI/approval/marker/journal/evidence/recovery/validator。Runner 固定
> `72 cases / 24 guard / 48 runtime / 24 pair / 32 Organizer decisions`、guard-first、pair 串行、pair 内
> 双 lane、single dispatch/no retry、首 runtime contract failure breaker 与 fixed denominator；任一 runtime
> 不完整时 semantic、四项 P95、token 和 CNY 聚合全部为 `null`。`runtimeAccounting` 显式记录
> reserved/terminal/orphaned/not-started，并强制 `terminal + orphaned = reserved`、
> `reserved + notStarted = 48`；recovery 的 `attempted_orphaned` 只计 orphaned，不与 durable terminal
> 重叠。sibling abort 只归属本 lane，不复制另一 lane 的 transport 或 diagnostic。
>
> Durability 要求 marker/initial journal 和每个 `lane_reserved` 均在 executor 前 append + fsync；正常
> reservation 恰好一个 `runtime_terminal`。Journal 使用 sequence + SHA-256 hash chain，evidence 使用
> fsync temp + hard-link final；dead owner 只能由单一 recovery claim 接管，crash-only recovery 只 seal
> 持久化事实，不创建 executor、不读取 credential、不 resume/replay/retry。First-party Live provenance 如果
> 缺少完整 lifecycle，会在 guard/executor 前以
> `PHASE_6_9_7_V9_DURABLE_LIVE_LIFECYCLE_REQUIRED` 拒绝，防止绕过 durable reservation。
>
> Source manifest SHA 为
> `sha256:dfb13b9dc97b0bb2c2d80920bdbb1147467a40a53eab24098d7d376788976651`；selection、runner
> runtime、V7 wire alias、diagnostic、eval policy、semantic authority SHA 分别为
> `85fdf2cd...f89050 / 86112145...226d3 / 6ff323df...91f17 / 8d66f5a1...ebba7f /
ab8ed353...86d74a / 1982561f...4c264f951`。Source manifest 现在记录实际 input estimator SHA，并在 module
> load 时将 prompt/estimator/option-rules actual SHA 与 frozen SHA 全部比较；V9 显式继承 V7 8-stage wire，
> 不伪造新的 AI export。V1--V8 双向 lineage rejection 与旧 validator 拒绝 V9 report 均有精确测试。
>
> 新增独立 zero-provider fault matrix，覆盖 guard failure 后 48 条 `not_started_case_guard`、transport/
> HTTP/schema/usage、selection/option authority、first/middle/last breaker、fixed denominator、single
> dispatch/no retry/no backfill、sibling abort 本地归属，以及 not-started/transport/abort 不伪造 option
> diagnostic。同步篡改 ledger/公开 terminal 计数也会被固定分母不变量拒绝，外层 report `safeParse`
> 正常返回失败而不从 refinement 抛异常。该 matrix 使用进程内 synthetic wire/executor，只验证
> runner/durability，不是 R4 reviewed candidate Mock。
>
> R3 focused 为 `29/29`（`393` assertions）；Agent 全量为 `967/967`（`14667` assertions）；AI 全量为
> `226/226`（`1459` assertions）；Agent typecheck/lint、仓库本地 Prettier 与 `git diff --check` 通过。
> Phase 6.9.6 validator 为 `ok=true/evidenceCount=4`；V1--V8 canonical sealed validators 各
> `ok=true/filesChecked=1`。正式 V9 marker/journal/evidence/recovery claim 精确检查为 0。Contract/security/
> durability 与 docs/history/lineage 双路终审无未关闭 Critical/Important。
>
> 本任务未读取 `.env`/credential、调用 Provider、执行正式 V9 Mock/Live、启动 Docker/API/browser、接
> 产品 gate/composition、修改业务数据、运行正式 seal/recovery、触碰 V1--V8 artifact 或合并 main。下一
> 原子任务仅 V9 R4 reviewed Mock/full checkpoint；R4 才允许 reviewed Mock 穿过正式 V6 Tutor、V9
> Organizer candidate 与 V6 merger。R5 controlled-Live 未授权。验收见
> `docs/acceptance/phase-6-9-7-tutor-organizer-v9-r3-runner-lineage-durability.md`。
>
> 2026-07-29 — Phase 6.9.7 V9 R2 Provider-like Robustness 与 Anti-overfit：从
> `577210ede1e9d50287e0ff757ce1404e8419fa4c` 开始，在同一
> `codex/phase-6-9-7-tutor-wrong-question-agents` 分支完成 zero-provider 原子任务。CodeGraph 已初始化，
> 但另一个 writer 长期持锁使 auto-sync disabled；本轮没有重复争锁，源码、测试和文档结论均以 FastCtx
> 当前磁盘文件与实际命令为准。
>
> 新增独立 fixture `phase-6.9.7-tutor-organizer-v9-r2-provider-shapes-v1`，冻结 SHA 为
> `sha256:0870799257dcd2b88841b286b9cc64e6410702fe2bcbe86c6e153d8af88a4200`。Fixture 只导入
> `node:crypto`，不读 V2 expected/oracle，也不导入生产 candidate/validator/merger 或 reviewed Mock
> responder。Synthetic responder 只解析实际 bounded user prompt；路径实际穿过第一方 DeepSeek V4 Pro
> direct adapter、ModelAgentRuntime、V9 candidate/selection 与 V6 local merger，provenance 固定为
> `synthetic_test`，没有网络访问。
>
> Provider-like matrix 覆盖 wrapper/prose/fence/BOM/type drift、字段缺失/增加、partial/duplicate/out-of-range
> selection、合法 whitespace/decision reorder；metamorphic matrix 覆盖 question/deck/keyword/knowledge-point
> reorder、NFKC duplicate、locked-name collision、24/question、144/request、mandatory action bucket 与 3500
> input-token cap。Estimator 直接覆盖 ASCII/CJK/emoji/combining/孤立 surrogate 和 `3499/3500/3501`；
> 本地 schema 另行拒绝 JSON 无法表达的 `NaN/Infinity/unsafe integer`，没有伪造 Provider JSON fixture。
>
> 安全与故障矩阵覆盖尾部 credential、Unicode `Cf`/control、递归敏感 key、owner/真实 ID/fingerprint/
> status/timestamp/locked name/write authority prompt no-leak，getter/Proxy/symbol/cycle/deep/wide/node overflow，
> pre/in-flight/post abort、pre/post stale 与 post-runtime rename/locked-name drift。Server 既有真实 PostgreSQL
> 最终写权限 3 suites/34 tests 继续证明 owner snapshot、事务内最终 fence、rename/move/remove/locked-name
> 并发边界未被 package 改动削弱。
>
> 测试驱动发现并修复三项真实缺口：V9 diagnostic collector 未标记 strict JSON content，导致 Markdown
> fence 可被兼容解析；`provider_type_validation` 被误归为 `fallback_runtime_error`；failure sanitizer 复用带
> observer side effect 的 schema，会在 `provider_json_parse` 失败时对 `undefined` 伪造
> `top_level_shape` diagnostic。现在 V9 exact schema identity 要求原生 JSON，static type failure 固定
> `fallback_schema_invalid`，sanitizer 使用无副作用 canonical schema；transport/static/selection failure
> 继续分层且 raw data 不保留。
>
> R2 focused + R1 companion 为 `24/24`（`407` assertions）；Agent `938/938`（`14255`
> assertions）；AI `226/226`（`1459` assertions）；Agent/AI typecheck/lint、Prettier 与
> `git diff --check` 通过。Phase 6.9.4.3 Mock、Attempts B--E、canonical JSON-mode Live 均按历史语义通过，
> Attempt A 继续按预期 `profile_mismatch`；Phase 6.9.6 与 V1--V8 sealed validators 通过，V9 marker/
> journal/evidence/recovery claim 仍为 0。两路独立终审无未关闭 Critical/Important。
>
> 本任务未读取 `.env`/credential、调用 Provider、执行正式 Mock/Live、创建 V9 artifact、启动 Docker/API/
> browser、接产品 gate/composition、修改业务数据、seal/recover 历史证据或合并 main；V1--V8 artifact/SHA、
> V2 dataset、R1 prompt/estimator/option-rules SHA、预算与产品接线不变。下一原子任务仅 V9 R3
> zero-provider runner/lineage/durability。验收见
> `docs/acceptance/phase-6-9-7-tutor-organizer-v9-r2-provider-robustness.md`。
>
> 2026-07-29 — Phase 6.9.7 V9 R1 Option Authority 与 Selection Contract：从 clean/pushed
> `780c5037435ea62b43417a8a5cae9577fe4c7abc` 开始，在同一
> `codex/phase-6-9-7-tutor-wrong-question-agents` 分支完成 zero-provider 原子任务。CodeGraph 因另一
> writer 持锁未重复同步，本轮源码与文档判断全部以 FastCtx 当前磁盘文件为准。
>
> 新增 `@repo/agent/wrong-question-organizer-v9`。本地 option authority 只接受 validated V5 shortlist，
> 为每题枚举完整 `resolvedSubject + subjectDecision + deckDecision`；`reuse_existing/create_topic` 必须同
> subject，canonical duplicate 与 locked-name create collision 被排除，结果稳定排序、canonical 去重并
> deep-freeze。Mandatory `(question, subject, action)` bucket 优先保留；每题 24、请求 144、Organizer
> 3500 input-token 任何一个 hard cap 无法满足时均在 Provider 前 fail-closed。
>
> 模型 exact contract 只允许原生 JSON `decisions[{questionIndex,optionIndex}]`，不回显 fingerprint，也不
> 输出 subject/action/target、真实 ID、locked name、confidence 或写命令。Selection 完整覆盖后由本地
> option 映射注入 V5 shortlist fingerprint，再执行完整 V6 validator/merger；预算、usage、Trace、abort、
> 前后 stale fence 与全部写权限保持本地。Prompt、estimator、option-rules SHA 分别为
> `ef2ff007cb55aedf5710c86a9a70e68368e24cc06afd8a09af84024f12e5586c`、
> `06caeb2d5b957ce122ea11db417b65c90e852e029f1fb1e2484dbffa6fbdbada`、
> `1013c43950c4b351e5ffa77286ec732ef522b38a4f294dd507ecac7a42c28eec`。
>
> Zero-option 固定为 `attempted=false / not_eligible / candidate_option_authority_empty`；mandatory
> coverage 超 cap 固定为 `fallback_budget_exceeded / candidate_option_authority_budget_exceeded`；authority
> 或 estimator identity 漂移固定 invalid-input fallback。Bounded diagnostic 只保存固定 reason、计数/
> type-shape hash 与 `rawDataRetained=false`，不保存原始 index、模型 output、prompt、ID、unknown key 或
> error 正文。文档同时纠正旧安全口径：V9 只接受 validated V5 authority；V5 允许的 model-facing 文本先
> 完整扫描再裁剪，`status/updatedAt` 不投影；`answer/userNote` 若出现会作为 strict schema 的未知额外字段
> 直接 `invalid_input`，不是被接受后再扫描；
> 未扩展 V5 schema，历史 fingerprint/SHA 不变。
>
> Focused 为 `11/11`（`124` assertions），Agent 全量为 `918/918`（`13885` assertions），Agent/AI
> typecheck/lint、仓库本地 Prettier 与 `git diff --check` 通过。Phase 6.9.6 validator 为
> `ok=true/evidenceCount=4`；V1--V8 sealed validators 各 `ok=true/filesChecked=1`。Phase 6.9.4.3 Mock 与
> canonical complete Live 通过，Attempts B--E 按历史语义为 valid incomplete；Attempt A 继续因已记录的
> filename identity mismatch 被拒绝，没有放宽 validator 或改写 evidence。Source/authority 与
> security/no-leak 两路实现复审均 `APPROVED`；最终代码/文档双路终审无 Critical/Important。
>
> 本任务未读取 `.env`/credential、调用 Provider、执行正式 Mock/Live、创建 V9 marker/journal/evidence、
> 启动 Docker/API/browser、修改业务数据或合并 main；V1--V8 immutable artifact 保持原字节。该 checkpoint
> 当时下一原子任务仅 V9 R2，后续已完成；R1 本身不授权 R3 runner、正式 Mock/Live、产品验收、main、
> Phase 6.9.8、Phase 6.10、Phase 8/9 或博客收尾。验收见
> `docs/acceptance/phase-6-9-7-tutor-organizer-v9-r1-option-authority.md`。
>
> 2026-07-29 — Phase 6.9.7 V9 R0 Zero-provider 复盘与设计：从 clean/pushed
> `6f37b34aa54642da43171e6e2e1a854cbd304d4b` 开始，只读对照 V8 sealed acceptance、V5 owner
> shortlist、V6 validator/merger、V8 fixed-shape contract/runtime adapter，以及 Server owner snapshot/
> service/command 权限链。CodeGraph project ensure 为 up-to-date；结构查询因另一个 writer 持锁报告 watcher
> auto-sync disabled，因此所有设计结论最终都以 FastCtx 当前磁盘文件为准，没有依赖冻结索引。
>
> V8 四条真实 response 均已通过 fixed-shape schema/usage；第二条 Organizer 的失败位于后续本地
> `dynamic_authority`。Sealed diagnostic 不能确定是 fingerprint、coverage、subject、action、deck/topic
> index 或 cross-subject 中的哪一项，R0 没有猜测或追加 Provider 探测。可以确认的结构性缺口是模型仍需
> 自由组合 `subjectIndex + deckAction + targetIndex`，静态合法字段不保证形成该题的合法权限组合。
>
> V9 冻结本地合法 option authority：从 validated V5 shortlist 为每题预枚举完整
> `resolvedSubject + subjectDecision + deckDecision`，canonical 去重、稳定排序，每题最多 24、请求最多
> 144，并受 Organizer 3500 input-token estimator fail-closed 约束。模型 exact output 只允许
> `decisions[{questionIndex,optionIndex}]`，不回显 fingerprint、不输出 subject/action/target/ID/confidence/
> command。模型仍在多个合法 option 间负责语义选择；本地注入 shortlist fingerprint、运行完整 V6
> validator/merger，并重建真实 ID、名称、confidence、reason 与 binding。
>
> Owner-scoped `REPEATABLE READ + READ ONLY` snapshot、Provider 前/后事务外双 fence、owner-lock
> `Serializable` 写事务内最终 fence、single/batch 单 dispatch、abort、Trace admission、locked-name、用户
> authority 与 Provider no-retry 均保持不变。OptionIndex 未知、覆盖不全、option set 漂移或 cap/token 无法
> 保留 mandatory subject/action bucket 时，均在无写入路径 fail-closed，不 clamp、repair、默认选择或补发。
>
> Reader Testing 首轮提出并已关闭四个 Important：有效 shortlist 任一题无合法 option 时固定
> `attempted=false / not_eligible / candidate_option_authority_empty`，保留完整 deterministic binding/
> suggestions；mandatory bucket 装不进 cap/token 时固定 degraded budget fallback。Prompt projection 只接受
> validated V5 authority；V5 允许的 model-facing 文本先完整扫描再裁剪，超过 16384 UTF-16、malformed
> Unicode、control/Cf、credential/instruction/tool/write 均整份拒绝，`status/updatedAt` 不投影。
> `answer/userNote` 是 V5 strict schema 的未知额外字段，出现即 `invalid_input`；公开 label 最多 80
> Unicode scalar。
>
> 3500 input cap 的 estimator 已精确冻结为
> `64 + ceil(utf8Bytes([system, canonical projection, schema].join('\n')) / 3)`，candidate/adapter 必须共用
> parts builder，不能把 estimate 当成 Provider verified usage。产品 Organizer 保持同步 HTTP，不写
> BackgroundJob/Outbox 或后台补发；未来 V9 runner 必须 durable 区分 reserved terminal、attempted orphan、
> guard/breaker/orphan 三类 not-started，并重算 executor/dispatch/response/usage 计数。复测结论为
> `APPROVED`，无 Critical/Important。
>
> 文档门使用仓库本地 Prettier `3.8.3` 对 9 个变更文件格式化并复核，`git diff --check` 通过。V8
> evidence/marker/journal physical SHA-256 重新计算后分别精确等于
> `377b82a7...71a85 / 85caaa57...a5da7 / 3caaa82d...efda`，V9 正式 artifact 仍为 0；当前 diff
> 只有 6 个既有文档和 3 个 V9 新文档，没有源码或历史 artifact 变化。Windows LF -> CRLF 提示经
> `git diff --numstat` 核对不是整文件换行改写。Source/security 与 docs/history/operations 两路最终只读
> 复审均为 `APPROVED`，无 Critical/Important；三份 V9 新文档将在本次 R0 提交中共同纳入。
>
> V1--V8 artifact/SHA、V2 dataset/baseline、预算、timeout、quality/P95/fixed denominator 均保持只读；V9
> 冻结独立 runner/approval/marker/journal/evidence/recovery/validator lineage 与 R1--R7 路线。R0 只新增
> design/plan/acceptance 并同步当前文档，没有修改 Agent/AI/Server/Web 源码、读取 `.env`/credential、调用
> Provider、执行 Mock/Live、启动 Docker/API/browser、修改业务数据或合并 main。下一原子任务仅 V9 R1
> zero-provider TDD。设计与验收见
> `docs/superpowers/specs/phase-6-9-7-tutor-organizer-v9-remediation-design.md`、
> `docs/superpowers/plans/phase-6-9-7-tutor-organizer-v9-remediation.md` 与
> `docs/acceptance/2026-07-29-phase-6-9-7-tutor-organizer-v9-r0-zero-provider-postmortem.md`。
>
> 2026-07-29 — Phase 6.9.7 V8 R5 唯一 Controlled-Live 失败封存：用户接受本次运行时 DeepSeek
> 当前账号的数据保留/训练边界，并授权唯一一次 V8 branch run。零 Provider preflight 确认分支 clean，
> HEAD、tracking ref 与 GitHub remote 都是 `b487ffe859ff75e5b8375791045da9ef21ddc9de`；V8 artifact=0，
> V1--V7 七份 sealed validator 全部 `ok=true/filesChecked=1`，Agent `907/907`（`13728` assertions）与
> Agent/AI typecheck/lint 通过。
>
> 第一次宿主启动把 PowerShell Bun shim 交给 `Start-Process`，在 Bun 进程创建前返回 invalid Win32
> application、PID=null。物理复核 marker/journal/evidence/recovery 仍为 0，因此没有进入 CLI、没有调用
> Provider，也没有消费 one-shot；随后只改用已验证 `bun.exe` 启动唯一 run
> `7ff09c36-50f2-445a-b309-dc9500e5e13c`。根 `.env` 未修改；通用 DeepSeek key 只在该子进程内映射
> 到 Tutor/Organizer component credential，未打印、写盘或进入 artifact/Git。
>
> 唯一 run 为 `24/24` guard zero-call、前两对 dispatched/completed、4 次
> executor/dispatch/response/verified usage。两个 Tutor 与第一条 Organizer 为 `candidate_applied`；第二条
> Organizer 已完成完整 8-stage wire、V8 fixed-shape schema 与 usage validation，但本地 dynamic shortlist
> authority 返回 `fallback_schema_invalid / dynamic_contract`，bounded diagnostic 为
> `dynamic_authority`、`rawDataRetained=false`。Runner 随即打开 `quality_gate_impossible` breaker，后续
> 44 runtime 未启动；最终 `3/48` strict，正式 semantic/P95/token/CNY 全 `null`，gate
> `quality_gate_failed`。这证明 V8 修复了 V7 static shape 问题，但没有证明模型能稳定组合本地允许的
> subject/deck/topic ordinal。
>
> Evidence/marker/journal physical SHA 分别为 `377b82a7...71a85`、`85caaa57...a5da7`、
> `3caaa82d...efda`；journal sequence `0..69`，最后一条为 `evidence_sealed`，bundle validator
> `ok=true/filesChecked=1`，无 recovery claim。V8 一次性名额已消费，不得 retry/resume/replay/backfill、
> seal/recovery 或追加 Provider 探测。R6 产品 Docker/API/可见浏览器、R7/main、Phase 6.9.8、Phase 6.10、
> Phase 8/9 与博客收尾继续阻断；该终态当时只允许建立新的独立 zero-provider R0，优先把 Organizer
> 改为只选择本地预枚举合法 option，而不是自由拼接多字段组合；后续 V9 R0 已完成。完整证据见
> `docs/acceptance/2026-07-29-phase-6-9-7-tutor-organizer-v8-controlled-live-failure.md`。
>
> 2026-07-28 — Phase 6.9.7 V8 R4 Reviewed Mock / Full Checkpoint：新增正式 V8 Mock factory 与
> `@repo/agent/phase-6-9-7-v8-mock` export。Tutor 复用未变化的 V7/V6 candidate；Organizer 穿过 V8
> fixed-shape candidate、strict schema、动态 authority、V6 本地 merger 与第一方 DeepSeek V4 Pro direct
> adapter。唯一替换点是进程内 synthetic fetch；executor/report provenance 固定为
> `synthetic_test/mock_synthetic`，responder 只读实际 bounded prompt，不读取 expected/oracle、真实 ID、
> owner、locked name、confidence 或写 command。
>
> 新 fault matrix 保留 V7 transport/HTTP/response/usage wire 前缀，并增加旧 V6 nested shape、decision
> extra/missing field、numeric string、`null` target，以及 fingerprint/duplicate question/subject/target
> authority drift。Static/dynamic contract failure 只记录 bounded reason/count/type-shape hash 与
> `rawDataRetained=false`；first/middle/last breaker、sibling abort、single dispatch/no retry、固定 48 分母与
> raw secret/error/body 泄漏扫描全部通过。
>
> Fresh baseline 保持 `12/48`、Tutor/Organizer/combined semantic
> `0.6629642857/0.278125/0.4705446429`。Reviewed Mock run
> `c8635a6a-0fbe-4d03-a7c9-9dd41c612d7c` 为 `24/24` guard、`48/48` strict、
> semantic/model-owned `1/1/1`、wire `48/48/48/48`，synthetic usage `23010/1459`、estimated
> `0.077784 CNY`，gate 固定 `mock_quality_not_evidence`。Validator `ok=true/filesChecked=1`；Mock
> evidence 已精确删除，V8 Live marker/journal/evidence/recovery claim 为 0。
>
> R4 focused `51/51`（`1787` assertions）、CLI/fault matrix `11/11`（`927` assertions）、Agent
> `907/907`（`13728` assertions）、AI `226/226`（`1459` assertions）、Types `42/42 + typecheck`、
> Server `227` suites / `2154` tests passed（`3` suites / `30` tests skipped）、Web `439/439`、
> Organizer PostgreSQL `12/12`、Docker boundary `3/3`、Compose default-off 与 V1--V7 validators 通过。
> 第一次 Server parallel full 的唯一 readiness subprocess 超时由 suite 并发负载触发；隔离 `9/9` 与
> `--runInBand` full 均通过，没有修改或放宽产品 timeout。Types package 没有独立 ESLint 工具，本轮未
> 伪称 Types lint 通过。Post-doc V8 regression `29/29`（`1114` expect calls）、artifact 物理检查、
> Prettier/diff 与 contract/security/wire、docs/history/operations 双路终审均通过，无未关闭
> Critical/Important。
>
> 全程未读取 `.env`/credential、调用 Provider、执行 V8 Live、启动/重建产品 Docker/API/browser、修改
> 业务数据或清空容器/镜像/卷。该 R4 checkpoint 当时的下一原子任务仅 R5 新的 V8 branch
> controlled-Live 授权门；普通“继续”不构成授权。后续唯一 R5 已失败封存，见顶部 2026-07-29 记录。
> R4 验收见
> `docs/acceptance/phase-6-9-7-tutor-organizer-v8-r4-static-mock.md`。
>
> 2026-07-28 — Phase 6.9.7 V8 R3 Runner / Lineage / Durability：新增独立 V8 report/runner/
> CLI/approval、一次性 marker、dispatch-before-call hash-chain journal、hard-link evidence、crash-only
> recovery 与 strict validator。固定 `72/24/48/24/32`、guard-first、pair 串行、single dispatch/no retry、
> 首 runtime contract failure breaker 与 incomplete semantic/P95/token/CNY 全 `null`。
>
> V8 schema remediation 不改变 Provider transport，因此底层显式复用 V7 已冻结的 8-stage wire，而不是
> 伪造不存在的 V8 `@repo/ai` export；report/runtime/marker/journal/evidence/recovery/source manifest 均使用
> 独立 V8 lineage，并与 V1--V7 双向拒绝。Source manifest SHA 为
> `sha256:3ccba6d4d258a4f7356ad448ee2a12ab16d6afd27093063a84b739a09cb2ff52`，绑定 V6
> dataset/semantic authority、V8 prompt/fixed-shape/diagnostic contract 与 wire identity。
>
> Runner 现在要求 Organizer 的 static `fallback_schema_invalid + structured_output /
provider_type_validation` 和 dynamic `fallback_schema_invalid + dynamic_contract` 必须携带 bounded
> diagnostic；guard、未启动、纯 transport/abort/orphan failure 保持 `null`，避免把未知原因伪装成字段
> 诊断。通用敏感字段扫描只对白名单安全 hash/boolean 字段 `organizerPromptSha256` 与
> `rawDataRetained=false` 放行，raw prompt/output/error/header/credential 扫描仍 fail-closed。
>
> 修复了一项实际 durability 缺口：完成态 journal 已记录 `guard_failed` 或
> `quality_gate_impossible` 时，recovery 过去仍把未 dispatch case 重建为 `not_started_orphaned`。V8 现在按
> breaker 终态分别重建 `not_started_case_guard` / `not_started_quality_breaker`；只有 run 未完成的 crash 才
> 使用 orphan，且 diagnostic 的 reason/fingerprint/count/`rawDataRetained` 会贯穿 report -> journal ->
> evidence -> recovery 并参与 drift 拒绝。
>
> R3 focused `24/24`（`215` assertions）、V8 focused `46/46`（`888` assertions）、Agent
> `902/902`（`12822` assertions）、AI `226/226`（`1459` assertions）、Agent/AI typecheck/lint、
> Prettier、V1--V7 sealed validators、正式 V8 artifact=0 与独立复审通过。全程未读取 `.env`/
> credential、调用 Provider、执行正式 Mock/Live、启动 Docker/API/browser、修改业务数据或合并 main。
> 该 checkpoint 当时下一原子任务仅 R4 reviewed Mock/full checkpoint，后续 R4 已完成。验收见
> `docs/acceptance/phase-6-9-7-tutor-organizer-v8-r3-runner-lineage-durability.md`。
>
> 2026-07-28 — Phase 6.9.7 V8 R2 Provider-like Robustness 与 Anti-overfit：新增独立
> `phase-6.9.7-tutor-organizer-v8-r2-provider-shapes-v1` fixture，冻结 SHA
> `sha256:f0a93a83000cb1f3515057482eca7ebbbb0ce0ef441cfd1cb7075073e000793f`。Fixture
> 手写中英混合 held-out source/canonical payload，只导入 `node:crypto`，不读取 V2 expected/oracle，
> 不调用 production candidate/validator/merger 或 reviewed Mock responder 生成答案。
>
> 新增按精确 schema identity 生效的 strict JSON content policy。V8 Provider message content 必须自身是
> 完整原生 JSON；Markdown fence、prose、BOM、trailing comma 与 single quote 在 schema 前拒绝。未标记的
> V7/历史 schema 保留 exact fence 兼容，不修改其 schema/prompt SHA。Synthetic fetch 穿过真实第一方
> direct adapter、ModelAgentRuntime、V8 candidate 与 V6 local merger，但 executor provenance 固定为
> `synthetic_test`，全程无网络/Provider。
>
> Provider-like matrix 覆盖 wrapper、顶层 array/null/double encode、旧 V6 nested Shape、snake_case、
> missing/extra/type drift、numeric string/float/negative/out-of-range、static malformed decision 首/中/尾、
> Unicode/reorder、动态 fingerprint/question/subject/deck/topic authority、pre/post stale fence、cycle/Proxy/
> wide no-leak。Provider `provider_type_validation` 在 V8 归一为 `fallback_schema_invalid`，原 attempted/
> budget/usage/Trace 与 reason tail 保留，不伪造 zero-call、不修复模型输出。
>
> Focused `24/24`（`680` assertions）、Agent `878/878`（`12579` assertions）、AI `226/226`
> （`1459` assertions）、Agent/AI typecheck/lint、Prettier、V7 compatibility、6.9.4.3/6.9.6 与 V1--V7
> sealed validators、独立复审均通过。全程未读取 credential、调用 Provider、执行正式 Mock/Live、启动
> Docker/API/browser、创建 V8 artifact、改动业务数据或合并 main。下一原子任务仅 V8 R3
> runner/lineage/durability，仍为 zero-provider。验收见
> `docs/acceptance/2026-07-28-phase-6-9-7-tutor-organizer-v8-r2-provider-robustness.md`。
>
> 2026-07-28 — Phase 6.9.7 V8 R1 Fixed-shape Contract 与 Bounded Diagnostic：新增
> `@repo/agent/wrong-question-organizer-v8`，把 Organizer 模型输出固定为
> `shortlistFingerprint + decisions[{questionIndex,subjectIndex,deckAction,targetIndex}]`。合同 SHA 为
> `b21a6dd357ecc19e87869541c7ae6cb52adff130ce32173fd8422ad2f6506545`，prompt SHA 为
> `9b85b0a9a310f128d35250e83b3927df8de87f159dac8aac8f412d1189ca6af9`。静态 schema 不执行
> coercion/repair；动态 validator 只接受当前 owner shortlist 暴露的 ordinal，并把合法结果转换为既有 V6
> validated decision 后复用原 merger。
>
> V8 runtime adapter 保留 V6 `1/3500/800` 预算、usage、Trace、abort 与调用前后实际 shortlist fence；
> fingerprint、subject/deck/topic、真实 ID、locked name、confidence 和写权限继续由本地掌握。新增 bounded
> diagnostic 只记录固定 reason、计数、类型/shape hash 与 `rawDataRetained=false`，不保存原始模型值、
> 未知字段名、prompt/output/error/credential；hostile getter/proxy、malformed runtime、stale 和 abort 均
> fail-closed。动态拒绝使用只供旧 V6 sanitizer 接收的 fingerprint-mismatch sentinel，原模型 decision 不会
> 被修复或进入 merger；V8 输入/authority/runtime 被拒时先替换为不可调用的本地 fallback runtime，旧 V6
> nested schema 不会获得 dispatch 机会。
>
> Focused `20/20`（`560` assertions）、Agent/AI typecheck/lint、Prettier、6.9.4.3/6.9.6 与 V1--V7
> sealed evidence validators 全部通过。全程未读取 `.env`/credential、调用 Provider、执行正式 Mock/Live、
> 启动 Docker/API/browser、创建 V8 artifact、修改业务数据或合并 main。下一原子任务仅 V8 R2
> Provider-like robustness/anti-overfit，仍为 zero-provider。验收见
> `docs/acceptance/2026-07-28-phase-6-9-7-tutor-organizer-v8-r1-fixed-shape-diagnostic.md`。
>
> 2026-07-28 — Phase 6.9.7 V8 R0 Zero-provider 根因复盘与设计：只读对照 V7 sealed evidence、
> V6 Organizer schema/prompt/validator/merger、V7 direct adapter、reviewed Mock 与 fault matrix，确认
> Organizer response 已完成 JSON parse，失败在 static Zod `safeParse`；dynamic fingerprint/count/subject/
> deck/topic authority 尚未运行。脱敏 evidence 无法恢复具体字段，因此没有猜测或读取 raw output。
>
> 工程缺口是 Provider 只受 `json_object` 约束，V6 输出使用 strict nested conditional union，而 V7
> Mock responder 直接构造 ideal canonical object，未覆盖 `null`、extra field、numeric string、wrapper、
> conditional index 等常见 shape drift。V8 冻结始终同形的
> `questionIndex/subjectIndex/deckAction/targetIndex` ordinal contract、只保存固定 reason/count/type-shape
> hash 的 bounded diagnostic，以及 Provider-like schema-negative/metamorphic/held-out/anti-overfit matrix。
>
> V8 使用独立 identity、approval、marker/journal/evidence/validator 与 R1--R7 路线；V1--V7 bytes/SHA、
> V2 dataset、V6 local authority/merger、预算、timeout、固定分母、质量/P95 与 no-retry 均不放宽。R0 未
> 读取 credential、调用 Provider、执行 Mock/Live、启动 Docker/API/browser、修改业务数据或合并 main。
> 下一原子任务仅 V8 R1 fixed-shape contract/diagnostic TDD。完整设计见
> `docs/superpowers/specs/phase-6-9-7-tutor-organizer-v8-remediation-design.md`，验收见
> `docs/acceptance/2026-07-28-phase-6-9-7-tutor-organizer-v8-r0-zero-provider-postmortem.md`。
>
> 2026-07-28 — Phase 6.9.7 V7 R4 唯一 Controlled-Live 失败封存：用户重新接受运行时
> DeepSeek 数据保留/训练边界并精确授权唯一一次 branch run。零网络 preflight 在 clean/pushed
> `df5ed8c7` 上确认 V7 artifact=0、V1--V6 validators/SHA 与 V7 focused `26/26` 全部通过；根
> `.env` 没有改写，底层 secret 只在授权 Bun 子进程内映射到 Tutor/Organizer component credential，
> key 未打印、写盘、进入参数、evidence 或 Git。
>
> 唯一 run `81529c2c-79f5-4c21-9cee-e536a2fe78e3` 完成 `24/24` guard zero-call。首对
> runtime 的 Tutor 与 Organizer 都完成 direct adapter dispatch/response：Tutor 完成完整 8-stage wire，
> `candidate_applied`，usage `532/8`、estimated `0.001644 CNY`；Organizer 已通过 response audit 与
> JSON parse，但在真实 V6 Organizer Zod schema 的 `provider_type_validation` 失败。Runner 收口当前
> pair 后打开 `quality_gate_impossible` breaker，后续 46 runtime 未启动。
>
> 最终 executor/dispatch/response/verified-usage 为 `2/2/2/1`、strict runtime `1/48`，正式
> semantic/P95/token/CNY 全为 `null`，gate `quality_gate_failed`；safety 为 24 verified zero-call、
> critical/permission/mutation/broader fallback 全 0。Evidence/marker/journal physical SHA 分别为
> `3cf3c077...bc9f` / `e7b9acc0...562d` / `1e84d624...82d`，journal 最后一条为
> `evidence_sealed`，bundle validator `ok=true / filesChecked=1`，无 recovery claim。
>
> V7 一次性名额已经消费，禁止 retry/resume/replay/backfill、额外 curl/单 case/产品 API 探测或
> 拼接 R3 Mock/Tutor 单条成功。R5 产品 Docker/API/可见浏览器、R6/main、Task 13 与后续阶段均被
> 阻断；下一原子任务只能先做新的独立 zero-provider 根因复盘与版本化 remediation 设计。完整验收见
> `docs/acceptance/phase-6-9-7-tutor-organizer-v7-controlled-live-failure.md`。
>
> 2026-07-28 — Phase 6.9.7 V7 R3 Zero-network Fault Matrix 与 Static/Mock Checkpoint：
> 新增 reviewed V7 Mock factory，48 条 runtime 全部从冻结 V2 dataset 派生并穿过真实 V6 Tutor/
> Organizer candidate、bounded projection、正式 prompt、strict schema、本地 authority merger 与 R1
> 第一方 DeepSeek V4 Pro direct adapter。网络边界只替换为进程内 synthetic fetch；responder 从实际
> bounded prompt 选择 ordinal，不读取 case expected/oracle、真实 ID 或写命令。
>
> Fault matrix 覆盖 fetch sync/reject、HTTP auth/rate-limit/client/server/异常 status、空或畸形
> response、non-thinking audit、completion parse、strict schema、usage missing/zero/negative/fraction/
> overflow、first/middle/last breaker 与 sibling abort 归因。每个预期 fault 精确断言 8-stage prefix、
> private failure category、usage disposition 与 executor/dispatch/response/verified-usage 四类 counter，
> 并递归扫描 synthetic key、raw body/error/reasoning/schema payload 泄漏。
>
> Fresh baseline 保持 `12/48`、Tutor/Organizer/combined semantic
> `0.6629642857/0.278125/0.4705446429`。Fresh Mock run `e09baa4a-6f48-41c3-bb48-607a72c300df`
> 为 `24/24` guard zero-call、`48/48` strict runtime、semantic/model-owned `1/1/1`、四类 wire
> counter `48/48/48/48`，synthetic usage `22949/1882`、estimated `0.080139 CNY`，gate 固定
> `mock_quality_not_evidence`。Validator `ok=true`；Mock evidence 已按精确 path 删除，V7 Live
> marker/journal/evidence/recovery claim 为 0，没有清空 `.tmp`。
>
> V7 focused `28/28`（`1028` assertions）、Agent `856/856`（`11881` assertions）、AI
> `224/224`（`1452` assertions）、Types `42/42 + tsc --noEmit`、Server `227` suites passed /
> `3` skipped、`2154` passed / `30` skipped、Web `439/439`、Organizer PostgreSQL `12/12`、
> Docker runtime boundary `3/3`、Compose default-off、V1--V6 validators/SHA，以及独立
> contract/security/wire 与 docs/history/operations 两路终审通过。PostgreSQL 只复用既有容器；
> synthetic users/questions/orphan
> groups/decks/items/traces 全为 0。Types package 仍没有独立 ESLint dependency/config，本轮没有伪称
> Types lint 通过或顺带新增配置。
>
> 全程未读取根 `.env`/credential、调用 Provider、执行 `v7:live`、启动产品 Docker/API/browser、创建
> V7 Live artifact、接产品 composition 或修改业务数据。该检查点当时下一原子任务仅 R4 精确授权门；
> 后续唯一 R4 已失败封存。完整验收见
> `docs/acceptance/2026-07-28-phase-6-9-7-tutor-organizer-v7-r3-static-mock.md`。
>
> 2026-07-28 — Phase 6.9.7 V7 R2 独立 runner、lineage 与 durable wire evidence：在 R1 第一方
> V4 Pro direct adapter 之上新增 V7 report/paired runner、CLI/approval、一次性 marker、
> dispatch-before-call hash-chain journal、hard-link evidence、crash-only recovery claim 与 strict
> validator。Runner 固定 `72/24/48/24/32` 分母、guard-first、pair 串行、pair 内最多双 lane、single
> dispatch/no retry 与首个 runtime contract failure breaker；未启动项继续留在 48 runtime 分母中。
>
> 每个 runtime lane 使用唯一 reservation、dispatch key 与 opaque capability。成功 terminal 必须复核
> `phase-6.9.7-v7-wire-diagnostics-v1`、完整 8-stage 前缀、`usageDisposition=verified`，以及
> executor/dispatch/response/verified usage 四类 `1/1/1/1` 计数；任一 runtime 不完整、usage unknown、
> terminal 缺失或 aggregate 篡改时，正式 semantic/P95/token/CNY 全部为 `null`。Synthetic Live 永远
> 不能打开生产质量门；R2 当时默认 Mock factory 仍返回 `mock_harness_unavailable`，正式 reviewed Mock
> 留给 R3，后续已完成。
>
> Marker/journal/evidence/recovery 使用独立 V7 identity，V1--V6 validators 与 V7 validator 双向拒绝旧
> runner/artifact token。回归补齐四类 wire/report counter 篡改、runtime snapshot 伪造、unknown/cross-lane
> dispatch key、递归旧 identity 注入、stale claim rename 后再次崩溃、CLI/marker/journal provenance drift 与
> evidence 跨仓库根路径污染。Recovery 只 seal durable prefix，不创建 adapter、不读取 key，也不
> resume/replay/retry/backfill Provider。
>
> Focused `22/22`（`184` assertions）、Agent `852/852`（`11041` assertions）、typecheck/lint、
> Prettier、diff、V1--V6 validators 与 V6 evidence/marker/journal physical SHA 复核通过。全程未读取
> `.env`/credential、调用 Provider、启动 Docker/API/browser、执行正式 V7 Mock/Live、创建仓库 V7
> artifact、接产品 composition 或修改业务数据。已知 durability 边界如实保留：只有文件 fsync、无父目录
> fsync；单机 PID/file fencing 不是跨主机 lease，不证明断电后的目录项持久性或 Provider exactly-once。
> 该 checkpoint 当时下一原子任务仅 R3，后续已完成。验收见
> `docs/acceptance/2026-07-28-phase-6-9-7-tutor-organizer-v7-r2-runner-lineage.md`。
>
> 2026-07-28 — Phase 6.9.7 V7 R1 第一方 V4 Pro direct adapter 与 wire diagnostics：在严格
> zero-provider 边界内，`@repo/ai` 新增 `first-party-deepseek-v4-pro-direct-v1` 与
> `phase-6.9.7-v7-wire-diagnostics-v1`。Adapter 只接受精确 DeepSeek 配置，直接构造
> `https://api.deepseek.com/v1/chat/completions` 请求，固定 `deepseek-v4-pro`、
> `thinking:{type:'disabled'}`、JSON-object、`stream=false`、无 tools/function/json_schema、无 retry；
> 默认 delegate 才能获得 `first_party_deepseek_v4_pro_direct` provenance，任何注入 delegate 永久标记
> `synthetic_test`，不能冒充生产传输。
>
> Wire capability 由 WeakMap 保存且只能 claim 一次；串行 reducer 固定 8-stage 单调前缀、
> first-terminal-wins、late response/rejection/abort drain，以及 executor/dispatch/response/verified usage
> 四类独立计数。Dispatch hook 必须在 delegate 前完成，hook 失败保持 delegate 0-call；HTTP、transport、
> response audit、structured output、usage、abort/timeout/harness 的私有 taxonomy 以穷尽映射进入既有公共
> Provider failure contract，不扩展历史 enum，也不把 raw error/body/header/prompt/output/key 放入 handoff。
> HTTP 1xx/3xx/越界或畸形 status、2xx 空 body、late settlement 与 complete/abort/timeout 竞态均已用
> zero-network barrier/matrix 固定。
>
> V6 Tutor/Organizer strict schema 与 prompt SHA
> `4f73ae60...a169` / `c5f1f662...3450` 保持兼容。Focused `66/66`（`852` assertions）、Agent
> `830/830`（`10839` assertions）、AI `224/224`（`1452` assertions），AI/Agent typecheck、lint、
> Prettier、diff 与独立代码/安全复审通过。全程未读取 `.env`/credential、调用 Provider、启动
> Docker/API/browser、修改 V1--V6 artifact 或接产品 composition；也未创建 V7 runner、CLI、env、
> marker、journal 或 evidence。R1 不构成 Live、语义质量或产品可用性证据；该 checkpoint 当时的下一
> 原子任务仅 R2，后续 R2 已完成。验收见
> `docs/acceptance/phase-6-9-7-tutor-organizer-v7-r1-zero-provider-adapter.md`。
>
> 2026-07-28 — Phase 6.9.7 V7 R0 零 Provider 根因复盘与 transport remediation 设计：在不读取
> `.env`/credential、不调用 Provider、不启动 Docker/API/browser、不修改源码或业务数据的边界内，
> 只读核对 V6 唯一失败 run `b18a0a13-a2a0-4cb0-8f9c-296271c0dfa8`、runner、candidate live
> harness、共享 AI SDK adapter、failure classifier、V4 Pro non-thinking middleware 与现有 V4 Flash
> first-party runtime。确认 V6 的 `dispatch_started` 在 harness operation 前持久化，2 次历史 Provider
> invocation 实际证明 candidate executor 尝试，均不能单独证明 HTTP 请求已发出或 DeepSeek 已接收；
> 当前 adapter 只识别官方 AI SDK error marker，middleware generic request/response safety error 与其它未
> 分类异常可能统一投影为 `unknown`，而安全 evidence 不保存 raw error/body/header/prompt/output，故不能
> 事后把 21ms 失败武断归因 key、网络、HTTP、SDK、模型或 Provider。
>
> V7 决定冻结复用 V2 dataset、V6 Tutor/Organizer prompt/candidate/local-authority bytes 与 SHA，不再
> 做 Live-driven prompt/dataset 调整。R1 将新增第一方 DeepSeek V4 Pro direct adapter，固定
> `executor_entered -> request_validated -> provider_dispatch_started -> provider_response_received ->
response_audit_passed -> content_parsed -> schema_validated -> usage_validated`，并把 executor、dispatch、
> response、verified usage 分开计数。Failure taxonomy 只保留 request/transport/HTTP/response audit/
> structured-output/usage/abort/timeout/harness/unknown 固定枚举，不保存敏感正文；dispatch hook 必须在
> fetch delegate 前 append + fsync，hook 失败保持 delegate 0-call。
>
> 原子路线压缩为 R1 direct adapter、R2 独立 runner/lineage、R3 真实 V6 schema/prompt zero-network fault
> matrix + static/Mock checkpoint、R4 新精确授权下唯一 Live、R5 仅在 Live 全门通过后的产品 Docker/API/
> 可见浏览器、R6 main merge/default-off replay。R3 除专门兜底 case 外出现非预期 `unknown` 就阻断
> Live。R0 当时只授权 R1 zero-provider adapter；V1--V6 artifact 保持不可变，R2--R6、Provider、产品
> 验收、Task 13/main 与后续阶段均未授权。设计、计划与验收分别见
> `docs/superpowers/specs/phase-6-9-7-tutor-organizer-v7-remediation-design.md`、
> `docs/superpowers/plans/phase-6-9-7-tutor-organizer-v7-remediation.md` 与
> `docs/acceptance/2026-07-28-phase-6-9-7-tutor-organizer-v7-r0-zero-provider-postmortem.md`。
>
> 2026-07-28 — Phase 6.9.7 V6 R5 唯一 controlled-Live 失败封存：用户已接受运行当时 DeepSeek
> 数据保留/训练边界并精确授权唯一一次 V6 branch run。零网络 preflight 确认分支 clean、V6 Live
> artifact=0、V1--V5 validators 与历史 SHA 均通过；根 `.env` 的底层 secret 只在同一授权 Bun 进程内
> 映射到 Tutor/Organizer component variables，没有打印、写盘、进入 artifact 或 Git。
>
> 唯一 run `b18a0a13-a2a0-4cb0-8f9c-296271c0dfa8` 使用 `deepseek-v4-pro` non-thinking JSON 与
> `deepseek_network` provenance。`24/24` guard zero-call 通过；第一对两个 lane 均完成 dispatch 记录，
> Tutor `tutor-v2-runtime-01` 在 executor `21.2116ms` 内得到 `provider_runtime / unknown`，不是
> `3500ms` timeout，也没有 structured-output stage；Organizer sibling 以 `post_dispatch_abort` 收口。
> Runner 随后打开 `quality_gate_impossible` breaker，后续 46 runtime 未启动。最终 2 次 Provider
> invocation、`0/48` strict runtime，正式 semantic/P95/token/CNY 全部为 `null`，gate 为
> `quality_gate_failed`。
>
> 脱敏 evidence 不保存 provider raw error、HTTP 状态、prompt 或 response，因此不能把 `unknown` 武断
> 归因于 credential、网络、模型、endpoint、SDK request shape 或 Provider response；它只证明当前固定
> classifier 未识别该异常并安全回退。任何额外 curl/单 case/CLI 都会形成事实重试，已按合同禁止。
>
> Evidence/marker/journal physical SHA-256 分别为 `beb9d460...21ea5e9`、
> `cbddba87...c99f988`、`be91b0c4...8c2a2f`；journal sequence `0..32`，最后一条为
> `evidence_sealed`，bundle validator `ok=true`，无 recovery claim。`.tmp` artifacts 保留且不纳入 Git；
> marker 的固定 `attempt_reserved` 是一次性 reservation schema，不覆盖 sealed terminal authority。
>
> V6 一次性名额已消费，不得 retry/resume/replay/backfill、删除或改写证据，也不得进入 R6 产品
> Docker/API/可见浏览器、R7/main、Task 13、Phase 6.9.8、Phase 6.10、Phase 8/9 或博客收尾。完整证据
> 见 `docs/acceptance/2026-07-28-phase-6-9-7-tutor-organizer-v6-controlled-live-failure.md`。
>
> 2026-07-27 — Phase 6.9.7 V6 R4 Static/Mock Checkpoint：新增 reviewed V6 Mock factory、
> `eval:phase-6-9-7:v6:baseline` 与 `eval:phase-6-9-7:v6:mock`。公共 Mock CLI 真实经过 V6 Tutor/
> Organizer candidate、strict validator、本地 authority merger 与正式 runner；24 条 guard 不构造
> runtime，48 条 runtime 各执行一次 synthetic invocation，无重试。Mock duration 使用单调时钟，
> output token 为正且受 cap 校验，费用固定 `0 CNY`，不冒充 Provider telemetry。
>
> Fresh V2 baseline 保持 `12/48`、semantic `0.6629642857/0.278125/0.4705446429`，dataset/
> baseline SHA 保持 `42803d45...b437b` / `0ce7c3ca...116ca`。Fresh V6 Mock run
> `88d72b3c-b1b9-4b4d-bb56-903b04b437b0` 为 `24/24` verified zero-call、`48/48` strict runtime、
> Tutor/Organizer/combined semantic `1/1/1`；model-owned Tutor intent `24/24`，Organizer subject/deck/
> target ordinal 各 `32/32`。四类 P95 为 `3/1/9.8304/4.1247ms`，usage `37020/1882`，report
> gate 固定 `mock_quality_not_evidence`。Organizer 实际 shortlist ordinal 到冻结 canonical ordinal 的
> 评分映射只修正 eval adapter，没有修改 dataset、expected、candidate、模型权限或本地事实 authority。
>
> V6 focused `36/36`（309 assertions）、Agent `828/828`（10826 assertions）、AI `199/199`、Types
> `42/42`、Server Docker boundary `3/3`、Web `439/439`、Organizer PostgreSQL `12/12`、Compose
> tracked example、typecheck/lint/build 均通过。V1--V5 validators 保持 `ok=true`；Mock evidence 已按
> 精确 run path 删除，V6 Live marker/journal/evidence/recovery claim 为 0，测试账号残留为 0。两路
> contract/security/concurrency 与 docs/history/operations 只读复审最终均 `APPROVED`、无 P0/P1；
> 文档复审发现的旧 V2 状态标题已修正，folded deck canonical ID 疑问经源码复核后撤销。
>
> 本 checkpoint 仍为 zero-provider：未读取 credential、调用 Provider、启动产品 Docker/API/browser、
> 接产品 composition 或把 V6 `3500ms` 接入产品 executor。Mock 满分只证明工程合同，不证明真实模型
> 语义、网络 P95、Provider token/账单或产品可用性。R3 的无父目录 fsync、claim tail 延后复核、缺
> stale-rename 后二次崩溃专测三项边界仍保留。该条记录 R4 当时停止在 V6 R5 授权门前；后续唯一
> R5 已于 2026-07-28 失败封存；
> 验收见 `docs/acceptance/2026-07-27-phase-6-9-7-tutor-organizer-v6-r4-static-mock.md`。
>
> 2026-07-27 — Phase 6.9.7 V6 R3 Runner / Lineage / Durability：新增原生 V6 report/case/
> evidence contract、paired runner、CLI/approval、一次性 marker、dispatch-before-call hash-chain
> journal、hard-link evidence、recovery claim 与 strict validator。Package 新增
> `eval:phase-6-9-7:v6:cli` / `eval:phase-6-9-7:v6:validate`。该检查点当时没有正式 `v6:mock`，
> 公共 Mock 入口会以 `mock_harness_unavailable_before_r4` 停止；后续 R4 已发布 reviewed factory。
>
> Runner 固定 `72 cases / 24 guards / 48 runtime / 24 pairs / 32 Organizer decisions`。24 guard
> 全部先行，之后 pair 串行、pair 内最多双 lane；每条 lane 只有一次 dispatch，首个 runtime contract
> failure 收口当前 pair 后打开 breaker，semantic/model-owned mismatch 不误熔断。Tutor/Organizer hard
> timeout 为 `3500/5000ms`，duration/overshoot 必须有限非负且单调；四类 P95 各需完整 24 样本。
> attempted orphan、sibling abort、usage unknown 或缺 terminal 会让正式 semantic/P95/token/CNY 全部
> 为 `null`，不得删除慢样本或用历史/Mock 补齐。
>
> Durability 顺序固定为 marker `wx` -> journal 初始化文件 fsync -> factory -> 每 lane
> `dispatch_started` append+fsync -> terminal/breaker/completion -> temp file fsync + hard-link evidence。
> Journal 使用 sequence/previous hash/record hash 与串行 append queue，close 等待 drain；live owner 不得
> 误封，dead owner 只有一个 recovery claimant，旧 appender、ABA 与 tail drift fail-closed。Recovery 只
> seal orphan/unknown usage，不 resume/replay/retry Provider。
>
> V6 validator 已补齐并拒绝 V1--V4 candidate/projection/prompt SHA、V3/V4 marker/journal/evidence/
> recovery、V4 bounded diagnostics 以及全部 V1--V5 runner/policy/artifact identity；五版历史 validator
> 同样拒绝 V6 envelope。`synthetic_test` 仅用于测试临时目录，production quality gate 强制要求
> `deepseek_network`，因此 synthetic Live 永远不能成为质量 authority。
>
> 最终 focused `32/32`（225 assertions）、Agent full `824/824`（10727 assertions）、typecheck/lint/
> Prettier 通过；三路只读复审无 P0/P1 阻断，lineage 无 P2 阻断。已知边界如实保留：只有文件 fsync、
> 没有父目录 fsync；claim 获取时 journal tail 校验延后到 appender/seal；缺少 stale claim rename 后
> 再次崩溃的专门测试。
>
> 本任务全程 zero-provider：未读取 `.env`/credential、调用 Provider、启动 Docker/API/browser、
> 创建仓库真实 V6 marker/journal/evidence/recovery claim、修改业务数据或接产品 composition。该检查点
> R4 已在后续完成；R5 新授权前仍不得读取 credential、创建 Live marker
> 或调用 Provider。
> 验收见
> `docs/acceptance/2026-07-27-phase-6-9-7-tutor-organizer-v6-r3-runner-lineage.md`。
>
> 2026-07-27 — Phase 6.9.7 V6 R2 Bounded Candidates：新增公开
> `@repo/agent/tutor-v6` 与 `@repo/agent/wrong-question-organizer-v6`。Tutor 的模型输出收敛为唯一
> `{ intentIndex }`，只允许在本地 eligible intent ordinal 中做语义选择；preferred depth、active-context
> 使用、guiding/final-answer boundary、answer structure 与完整 TutorStrategy 仍由本地 authority 重建。
> route/safety/明确教学指令/abort/预算失败都在 runtime 前 zero-call；eligible 路径最多一次调用、无重试，
> schema/runtime/usage/authority/post-abort 失败均回退原确定性策略。
>
> Organizer 复用 V5 实际 owner shortlist，只向模型暴露 shortlist fingerprint、question ordinal 与
> subject/deck/topic ordinal。Provider 前后都会重新派生实际 shortlist 并核对 owner domain、snapshot
> version/fingerprint 与 shortlist fingerprint；stale、ABA、cross-subject、重复/越界 ordinal、locked-name
> collision 或本地 association 漂移整批 fail-closed。真实 question/deck ID、locked name、confidence、
> reason/description、command binding 与写权限全部由本地重建。跨语言阅读 overlap 使用有界本地等价组，
> 不把任意 reuse 直接提升为 high confidence。
>
> 公共 Organizer merger 不再信任 validated-shaped 调用方对象：它先还原 raw ordinal decision，再重新执行
> 完整 strict validator，避免空 decision、重复 ordinal 或伪造 `resolvedSubject` 绕过。新增 hostile 顶层/
> runtime accessor 零读取、locked-name collision 不跳过、owner/snapshot ABA、reorder、六学科、双语/
> mixed/否定/引用干扰，以及 actual prompt 递归 leakage 与 deliberate contamination 反例。
>
> 冻结 Tutor/Organizer prompt SHA 为 `4f73ae60e708...a169` / `c5f1f662ba38...3450`，独立 robustness
> fixture SHA 为 `314543fe1694...904b`；V2 dataset SHA `42803d45...b437b` 与 baseline SHA
> `0ce7c3ca...116ca` 保持不变。最终 focused `24/24`（989 assertions），Agent full `792/792`
> （10458 assertions），typecheck/lint exit 0；两路只读代码/测试复审无 P0/P1/P2 阻断。测试中的 expected
> Mock 只证明 projection/validator/merger，不证明真实模型语义质量。
>
> 本任务全程 zero-provider：未读取 `.env`/credential、调用 Provider、创建 V6 Live artifact、启动
> Docker/API/browser 或修改业务数据；也没有产品 composition/gate/Trace persistence、runner、CLI、marker、
> journal、evidence、validator、Mock checkpoint 或 Live。该检查点当时下一原子任务仅 V6 R3
> runner/lineage/durability contract，后续 R3 已完成。验收见
> `docs/acceptance/2026-07-27-phase-6-9-7-tutor-organizer-v6-r2-bounded-candidates.md`。
>
> 2026-07-27 — Phase 6.9.7 V6 R1 Source Contracts：在 R0 冻结设计上新增独立 V6 dataset
> binding/eval policy、单调 deadline evidence、固定分母 model-owned scorer、Tutor preferred-depth
> local authority 与 WrongQuestionOrganizer confidence local authority。V2 dataset/expected/baseline bytes
> 不变；dataset binding/eval policy SHA 分别冻结为 `3306cc399730...`、`5066decfc88e...`，两条本地
> authority rules SHA 分别为 `b57a828e1429...`、`a46eda402e8c...`。
>
> Tutor executor hard-timeout policy 为 `3500ms`，candidate P95 仍为 `<=2500ms`；Organizer 仍为
> `5000/4500ms`。nearest-rank P95 强制恰好 24 个样本并取升序第 23 个值，调用方不能覆盖分母；
> executor/runtime trace/candidate orchestration/paired request 使用有限非负单调 duration 与 overshoot。
> 任一 lane 缺 terminal、timeout、NaN 或越界时，四类 P95 全部为 `null`。`null`、hostile accessor、
> clock rollback/jump 与 malformed observation 均 fail-closed，不传播 raw error。
>
> 模型职责继续保留：Tutor 后续只选择 eligible intent，固定 24 case 至少 `21/24`；Organizer 后续只
> 选择 subject decision、deck action、target ordinal，三个 32-decision 门各至少 `28/32`。Tutor depth/
> guiding/final-answer/structure 和 Organizer confidence 都由本地 authority 重建，不能抵消 model-owned
> failure。R1 的 Organizer fingerprint 仅为 source contract；实际 owner shortlist/fingerprint、pre/post
> stale、ABA、locked-name 与 ordinal association 明确留给 R2 composition，未冒充为已接 candidate。
>
> 验证：focused `15/15`、160 assertions；Agent full `768/768`、9430 assertions/85 files；Agent
> typecheck/lint exit 0；本地 Prettier 3.8.3 完成格式化；两路独立复审刷新当前文件后均 `APPROVED`。
> V5 `3000ms` timeout 与 frozen policy SHA 隔离测试通过。
>
> 本任务全程 zero-provider：没有读取 `.env`/credential、实现 candidate/runner/marker/Mock/Live、调用
> Provider、启动 Docker/API/browser 或修改业务数据。该检查点当时下一原子任务仅 V6 R2 bounded
> candidates、actual shortlist composition 与独立 robustness；后续 R2 已完成。R4 checkpoint 和新的精确授权前仍不得创建 Live artifact
> 或调用 Provider。验收见
> `docs/acceptance/2026-07-27-phase-6-9-7-tutor-organizer-v6-r1-source-contracts.md`。
>
> 2026-07-27 — Phase 6.9.7 V6 R0 零 Provider 复盘与设计：只读核对 V5 run
> `aa637d3a-f7c4-4549-a724-9cdbefdd89c8` 的 evidence/journal/marker 与三份 SHA，确认 Tutor
> runtime-06 的 runtime trace/candidate orchestration/paired duration 分别为
> `3021/3022.3072/3025.385ms`。前 5 条 Tutor strict latency 为 `887--1592ms`、均值
> `1120ms`；前 6 条 Organizer 为 `1859--2607ms`、均值 `2176.5ms`。当前 evidence 没有独立
> Provider/SDK/event-loop stage，不能把 21ms overshoot 唯一归因到任何一层。
>
> V6 将 Tutor executor hard timeout 从 `3000ms` 调整为 `3500ms`，但 Tutor candidate P95
> `<=2500ms`、Organizer hard timeout/P95 `5000/4500ms`、paired `<=4500ms` 与 Tutor
> orchestration `<=6500ms` 均不变。`3500ms` 来自 `2500ms SLA + 1000ms cancellation margin`，
> 不是按单个 Live case 调门槛；timeout 仍 fail-closed、无 retry、固定分母与 incomplete aggregate
> `null` 不变。nearest-rank P95 按 `sorted[ceil(0.95 * n) - 1]` 计算，四类 24-sample gate 都取
> 升序第 23 个值。
>
> 语义 ownership 同步冻结：Tutor 模型继续选择 eligible intent，preferred depth 与最终策略字段由
> 本地 authority 重建；Organizer 模型继续选择 subject/deck/topic ordinal，confidence 由本地 evidence
> authority 重建。新增 model-owned exact-match 门：Tutor intent 固定 24 case，`>=0.85` 即至少
> `21/24`；Organizer subject action/ordinal、deck action、target ordinal 各自固定 32 decision units，
> 每项 `>=0.85` 即至少 `28/32`。V2 dataset/expected/baseline bytes/SHA 不变；V6 使用独立 eval
> policy、prompt/authority、runner、approval、marker、journal、evidence 与 validator identity。
>
> 本任务只新增/同步设计、计划和 acceptance，没有修改业务源码、读取 credential、调用 Provider、启动
> Docker/API/browser 或修改业务数据。用户允许重新评估 Tutor 时延只属于设计许可，不是 Live 授权。
> 下一原子任务仅 V6 R1 deadline/eval-policy 与 local-authority contracts。设计见
> `docs/superpowers/specs/phase-6-9-7-tutor-organizer-v6-remediation-design.md`，验收见
> `docs/acceptance/2026-07-27-phase-6-9-7-tutor-organizer-v6-r0-zero-provider-design.md`。
>
> 2026-07-27 — Phase 6.9.7 V5 R6 Controlled-Live 失败封存：补齐 V5 真实 Live harness、默认
> DeepSeek V4 Pro non-thinking executor、marker 前配置 fail-closed、marker+journal fsync 后 executor
> 创建、`deepseek_network` / `synthetic_test` provenance 隔离，以及 component key/gate/URL/timeout/
> zero-call/no-retry/schema/provider/usage/abort/prompt 泄漏回归。根 `.env` 的通用 credential 仅在用户
> 授权的本次进程内映射为 Tutor/Organizer 两个组件变量，未打印、未写盘或进入 artifact；临时 launcher
> 已删除。
>
> 唯一 run `aa637d3a-f7c4-4549-a724-9cdbefdd89c8` 使用 `deepseek_network`，完成 `24/24`
> guard zero-call、6/6 paired requests、12 次 Provider invocation 与 `11/48` strict runtime。第 6 对
> Tutor `tutor-v2-runtime-06` 在 `3021ms` 越过冻结 `3000ms` timeout，记录 `runtime_timeout` 并打开
> `quality_gate_impossible` breaker；同对 Organizer strict success，后续 36 runtime 未启动。Safety、
> permission、mutation、broader fallback 与 Provider failure 均为 0，最终 `quality_gate_failed`。
>
> 因运行不完整，正式 Tutor/Organizer/combined semantic、四类 P95、aggregate token 与总费用全部保持
> `null`。11 条 verified entry 的 `9761/902 tokens`、`0.034695 CNY`，以及 Tutor `0.9`、Organizer
> `0.7083333333` executed-subset axis mean，只作为零 Provider 复盘 subtotal，不是正式质量/账单聚合，
> 不能与 Mock 或历史 run 拼接。
>
> Evidence SHA 为 `84487b448acd7bd5e65cd523eb7556cd9b3175bc9ba44572e06a78157c45b70a`；
> 58 条 journal、marker 与 evidence 已 durable seal，V5 validator 返回 `ok=true`，无 recovery claim。
> V1--V4 evidence SHA/validator 保持不变。V5 focused `78/78`（1961 assertions）、Agent
> `753/753`（9260 assertions）、AI `199/199`（1054 assertions）及 typecheck/lint 均通过，独立复审
> 无 P0/P1。
>
> 本轮没有启动 Docker/API/浏览器、创建产品账号或修改业务数据，也没有 prune、`down -v`、reset、
> flush 或 wipe。V5 R6 一次性名额已消费且不得重跑；R7、Task 13/main、Phase 6.10、Phase 8/9 与博客
> 收尾均不得开始。该终态当时只允许先做零 Provider 复盘并设计与 V1--V5 双向隔离的新版本。完整证据见
> `docs/acceptance/2026-07-27-phase-6-9-7-tutor-organizer-v5-controlled-live-failure.md`。
>
> 2026-07-26 — Phase 6.9.7 V5 R5 Static/Mock Checkpoint：新增 reviewed V5 Mock factory、公开
> `@repo/agent/phase-6-9-7-v5-mock` 与 `eval:phase-6-9-7:v5:mock`。CLI Mock 默认真实经过 Tutor
> local authority/V5 candidate/validator/local merger 和 Organizer owner-snapshot shortlist/ordinal
> candidate/validator/local merger；24 guard 不构造 runtime，48 runtime 各执行一次合成 Mock executor。
> Expected/oracle 只留在 eval-only responder 与评分闭包，actual prompt 不含 case ID、oracle 或 V1--V4
> identity；Live 无显式 factory 时继续 `runtime_factory_unavailable`，不创建 marker。
>
> Fresh deterministic baseline 使用冻结 V2 dataset/policy：`12/48` complete，Tutor/Organizer/combined
> semantic `0.6629642857/0.278125/0.4705446429`。Fresh Mock run `6eaf428c...` 为 `24/24`
> zero-call、`48/48` strict runtime、semantic `1/1/1`、P95 `246/328/328/276ms`；48 次 invocation 是
> synthetic Mock 计数，不是真实 Provider call，output/cost `0/0` 也不冒充真实 token/账单证据。Evidence
> 经 validator 通过后已按精确 run ID 删除。
>
> V5 focused `62/62`（1570 assertions）、Agent `745/745`（9200 assertions）、AI `199/199`、Types
> `42/42`、Server Docker boundary `3/3`、Web `439/439` 与 17-page production build、Organizer
> PostgreSQL E2E `12/12`、Compose quiet/default-off、V1--V4 SHA/validator、V5 Live artifact=0 与两路
> 独立终审均通过。Types 直接 lint 的既存工具解析缺口未冒充通过，本阶段按冻结矩阵使用 tests/typecheck。
>
> 本轮未读取 `.env`/credential、调用 Provider、接产品 gate、启动 Docker/API/browser 或修改业务数据。
> V5 R0--R5 已完成且仍为 zero-provider；下一步仅 R6。提交并推送功能分支后必须停止，重新取得
> DeepSeek 数据边界确认与唯一一次 V5 branch controlled-Live 精确授权前不得执行网络调用。完整证据见
> `docs/acceptance/2026-07-26-phase-6-9-7-tutor-organizer-v5-r5-static-mock.md`。
>
> 2026-07-26 — Phase 6.9.7 V5 R4 Runner / Lineage / Production Extreme Boundaries：新增原生
> `phase-6.9.7-tutor-organizer-runner-v5` report/case/evidence contract、独立 paired runner、CLI、一次性
> marker、dispatch-before-call hash-chain journal、hard-link evidence、recovery claim 与 V5 validator。
> 固定 72 cases / 24 guards / 48 runtime / 24 pairs / 32 Organizer decisions；24 guard 先行，每次只运行
> 一个 pair，pair 内最多双 lane，首个 runtime contract failure 熔断且其余 case 保留固定分母。
>
> Report schema 由 case entries 重算 canonical identity、decision denominator、semantic、usage、safety、
> latency 与 gate；usage/latency/semantic 不完整时 aggregate 保持 `null`。只有
> `executorProvenance=deepseek_network` 的完整 Live 才可能 `quality_gate_passed`，测试注入的
> `synthetic_test` Live 固定失败。V5 validator 递归拒绝 V1--V4 runner/dataset/run/artifact、partial
> metrics/usage/cost、source fields、getter/cycle/symbol key；历史 validators 也拒绝 V5。
>
> Durability 覆盖 marker/journal/evidence 任一失败消费唯一名额、发布失败、最终 seal append/fsync
> 失败、dispatch 后 terminal 丢失、sibling orphan、活 owner 防误封、dead owner 单胜者 recovery、同字节
> ABA、recovery claim 后 journal tail 漂移、same-byte 幂等与冲突字节拒绝。恢复只 seal，不 resume/replay
> Provider。Focused `26/26`（145 assertions）、Agent `741/741`（9128 assertions）、Agent
> typecheck/lint、Web/Server lint、Prettier、diff check、V1--V4 四份历史 evidence SHA/validator 与两路
> 独立复审均通过。
>
> 本轮未读取 `.env`/credential、调用 Provider、启动 Docker/API/browser、修改业务数据或创建任何 V5
> Live artifact。下一原子任务仅 V5 R5 static/Mock checkpoint；未获得新的精确授权前不得执行 V5
> controlled-Live。完整证据见
> `docs/acceptance/2026-07-26-phase-6-9-7-tutor-organizer-v5-r4-runner-lineage.md`。
>
> 2026-07-26 — Phase 6.9.7 V5 R3 WrongQuestionOrganizer Ordinal Shortlist：新增独立
> `wrong-question-organizer-shortlist-v5`、`wrong-question-organizer-model-projection-v5` 与 V5 strict
> candidate/local merger。Shortlist 从调用方提供的 owner snapshot 本地生成 structured/taxonomy subject、
> bounded topic 与 existing-deck ordinal；question/deck/knowledge point/keyword 稳定排序、规范化去重，
> 同 subject/规范化名称的 duplicate deck 折叠为最低 ID authority，全部 folded ID 仍进入 fingerprint。
>
> Fingerprint 绑定 owner domain、owner snapshot version/fingerprint、完整 question/deck/topic 序列、
> shortlist/rules version 与 provenance。Candidate 在 runtime 前后各调用一次 `revalidateSource`；pre-call
> stale 保持 zero-call，post-call stale/分页位移/ordinal ABA 不应用旧 ordinal、不重调 Provider。模型只
> 返回 `shortlistFingerprint/questionIndex/subjectDecision/deckDecision/confidence`，structured subject、
> same-subject association、locked name、真实 ID 与 command binding 全由本地 validator/merger 掌权，
> merger 不执行 mutation。
>
> Shortlist rules SHA 冻结为 `9747383ca2ad9dfdc143a55d23ccb62ba14dc7d84ff82d3c7bfe21f0371299d3`，
> model prompt SHA 为 `915084a80f1cf4f96fca08987d4dc228f0e73e1dc299bd1368033d37f6ac69ab`，
> 24 条独立 held-out fixture SHA 为
> `49336b123cb56741b3aab0fb23c2e9341e938a3f1b4c4e4f48774a94365ee097`。Fixture 固定
> `8 zh / 8 en / 8 mixed`，并覆盖冻结 V2 Organizer 全部 32 decision units、same/cross-subject batch、
> structured/taxonomy、locked/dedupe、reorder/分页/去重/ABA/stale、strict schema、zero-call、single-call/
> no-retry、输入不变与实际 prompt leakage。
>
> 独立复审无 Critical。代码复审提出 candidate preview budget 与 runtime budget 可能不一致；对照
> `ModelAgentRuntime` 源码确认 candidate reserve 是 fail-fast preview，runtime 必须接收未消费 caller
> budget 执行唯一 actual reservation，否则会双扣。已补代码注释与 request/result budget 回归。测试复审
> 提出的重复/越界、cross-subject runtime、输入 mutation、分页/ordinal drift 与 taxonomy 边界均已补齐；
> usage unknown/aggregate failure attribution 按冻结计划留给 R4 runner。
>
> R3 聚焦测试 `13 pass / 0 fail / 469 expect()`，Agent 全量
> `715 pass / 0 fail / 8965 expect()`；Agent typecheck/lint、根 Web/Server lint、Prettier、V1--V4 四个
> 历史 evidence validator 均通过。历史 dataset/runner/marker/journal/evidence/SHA 未改。
>
> 本轮未读取 credential、调用 Provider、接 product composition/gate/paired runner/Trace persistence、
> 启动 Docker/API/browser 或修改 PostgreSQL、Redis、MinIO/业务数据。下一原子任务仅 V5 R4
> runner、lineage 与生产极端边界；不得开始 Task 13/main、Phase 6.10 或博客收尾。完整证据见
> `docs/acceptance/2026-07-26-phase-6-9-7-tutor-organizer-v5-r3-organizer-ordinal-shortlist.md`。
>
> 2026-07-26 — Phase 6.9.7 V5 R2 Tutor Local-Signal Authority：新增独立
> `tutor-local-signal-authority-v1` 与 `tutor-model-projection-v5`。本地权威从 latest text 派生
> primary signal、negated signal、eligible intent/depth、confidence 与 reason，并把 precedence 冻结为
> `step_check > explain_solution > concept_bridge > socratic_hint > general_follow_up`。Active context
> 只影响 availability/depth，不能创建或提升具体 intent；引用语境中的 hint/answer 文本不会取得模型或
> 答案权限。
>
> Detector rules SHA 冻结为 `a1e9a3b0489e5be5f2c64205128231887cf26b6f151028c2cb8324ddb65f4892`，
> bilingual prompt policy SHA 为 `7c7442ffa96f78f23e75a34f8526e65c48f9dce5efe2b344d58cd68d5b6c5f87`。
> 模型 contract 只保留 `intent/depth/confidence`，删除自报 evidence；validator 同时校验 local authority
> SHA 与 canonical semantics，具体 primary 不能降级为 general。Merger 继续在本地重建完整
> TutorStrategy，模型没有 answer/route/tool/permission/write authority。
>
> 新增 32 条独立 held-out fixture，SHA 为
> `d08e8ed5a6c47f8b2fc2d0f1b108e309484814804232979a6ce6eba891d8ab55`，固定
> `13 zh / 12 en / 7 mixed` 与 positive/context/negative/quoted/conflict 配额；覆盖 detector FP/FN、否定、
> 引用 distractor、冲突 precedence、context 删除/空值/重排/噪声/单变量 mutation、authority 伪造、
> strict schema、zero-call、单调用/无重试、usage/abort、安全和实际 prompt leakage。冻结 V2 的 24 条
> Tutor runtime detector 对照为 `24/24`。
>
> R2 聚焦测试 `12 pass / 0 fail / 859 expect()`，Agent 全量
> `702 pass / 0 fail / 8478 expect()`；Agent typecheck/lint、Prettier、V1--V4 四个历史 evidence
> validator 均通过。两路只读终审最终无 Critical/Important；测试复审提出的 context mutation、覆盖
> 配额与重复运行完整等价缺口已补齐。
>
> 本轮未读取 credential、调用 Provider、接 Web product composition/gate、创建 V5 runner/Live artifact、
> 启动 Docker/API/browser 或修改 PostgreSQL、Redis、MinIO/业务数据。下一原子任务仅 V5 R3
> WrongQuestionOrganizer ordinal shortlist；不得开始 Task 13/main、Phase 6.10 或博客收尾。完整证据见
> `docs/acceptance/2026-07-26-phase-6-9-7-tutor-organizer-v5-r2-tutor-local-signal-authority.md`。
>
> 2026-07-26 — Phase 6.9.7 V5 R1 独立 Dataset Authority：在不修改 V1 cases/SHA 的前提下，
> 新建 `phase-6.9-tutor-wrong-question-v2`。72 cases 固定为 24 guard + 48 runtime、24 paired
> requests；Tutor/Organizer 各 12 guard + 24 runtime，Organizer 共 32 decision units。Tutor runtime
> 显式冻结 `12 zh / 10 en / 2 mixed`，每条 definition 绑定 language、exercise family、latest text
> 与同一道题的 active context；新的 `tutor-v2-runtime-06` 为中文线性方程 `2x=6` + 中文线性
> 方程 context，不再复现 V1 的英文 derivative 错配。
>
> 新增 fail-fast coherence authority，覆盖 dataset/version/count、ID、paired index 0..23、deep-freeze、
> language/family/context、Organizer structured/taxonomy subject、3-topic candidate ordinal、reuse deck
> 与 single/same-subject/cross-subject batch relation。Prompt-safe projection 不导出 expected、selected
> ordinal、case/owner/question/deck ID 或 V1 identity；topic candidates 是 R3 的本地输入 authority，
> expected topic ordinal 仅留在 oracle。
>
> V2 dataset SHA 冻结为 `42803d454fe59f2854ba1ccb115f2b813cc17cd9e26f3221a19b03fdd67b437b`，
> V5 eval policy SHA 为 `b39134038c22fe304cf3212da11da468d9a2d88a51a0162bbad1102186cf009d`。
> Candidate 前固定 Tutor/Organizer/combined semantic `>=0.85`、两 lane absolute improvement
> `>=0.15`、strict `48/48`、guard `24/24`、安全失败全 0、P95、usage、token 与
> `0.55 CNY` cap；不完整 aggregate 必须 `null`。门槛在后续 Mock/Live 后不得下调。
>
> Fresh deterministic baseline 为 `12/48` complete，Tutor/Organizer/combined semantic
> `0.6629642857142858/0.278125/0.4705446428571429`，Provider/input/output/cost 全 0；完整 report
> SHA 冻结为 `0ce7c3ca5f6f7d2c78f37f88c5f90c24c7f1ed19575d4e43d9edcd41341116ca`。
> 聚焦测试 `8 pass / 0 fail / 346 expect()`，Agent 全量 `690 pass / 0 fail / 7600 expect()`；
> Agent typecheck/lint、Prettier、diff check 与 14 个本轮 Markdown 文件的本地链接检查通过。V1--V4
> 四个历史 evidence validator 均为 `ok=true / filesChecked=1`；两路只读复审最终无未关闭
> Critical/Important。V1 canonical dataset 现场重算仍为 `7ac2f4b5...2207e`。
>
> 本轮未读取 credential、调用 Provider、实现 V5 candidate/paired Mock/Live runner、创建 Live artifact、启动
> Docker/API/browser 或修改 PostgreSQL、Redis、MinIO/业务数据。下一原子任务仅 V5 R2 Tutor
> local-signal authority，仍为 zero-provider。完整证据见
> `docs/acceptance/2026-07-26-phase-6-9-7-tutor-organizer-v5-r1-dataset-authority.md`。
>
> 2026-07-26 — Phase 6.9.7 V5 R0 零 Provider 根因取证与修复路线：对 V4 唯一失败 run 做源码、
> 冻结 dataset 与 bounded evidence 差分复核，确认问题不是单一验收 adapter bug。V1
> `tutor-runtime-06` 把中文代数步骤 `2x=6` 与英文微积分 active context 组合，并因
> `pairedRunIndex % 2` 被错误标成 `en`；fixture 的 context 由独立轮转生成，不符合产品
> latest message 与当前 OCR/学习上下文属于同一道题的不变量。V1 dataset bytes/SHA
> `7ac2f4b5...2207e` 保持不可变，新版本不得原地修补历史。
>
> 新增 `phase-6-9-tutor-wrong-question-v5-root-cause.test.ts`，使用 exact runtime-06 输入验证四组
> synthetic decision：`step_check + submitted_step` 以及附加 `contextual_reference` 都由产品
> `runTutorModelCandidate()` 应用；缺 primary 或使用 `concept_gap` 时由同一产品 candidate 返回
> `fallback_schema_invalid / invalid_evidence_association`，随后 canonical diagnostic 如实映射为
> `dynamic_contract`。结果为 `7 pass / 0 fail / 34 expect()`，排除了 V4 adapter 单独把合法结果
> 改成失败的假设。
>
> Agent 全量 `682 pass / 0 fail / 7244 expect()`，Agent typecheck/lint、Prettier 与 diff check
> 通过；V1--V4 四个专用 file validator 均为 `ok=true / filesChecked=1`，V4
> evidence/journal/marker SHA 与失败封存记录一致。三路只读复审补齐 local detector authority、
> shortlist fingerprint/ordinal ABA、固定取消/孤儿终态、跨版本递归隔离、lane failure attribution 与
> crash-only seal 后，均无未关闭 Critical/Important。
>
> 同时，V4 前 5 条 Tutor 的 bounded evidence 显示 3 个中文 hint 全部被判为
> `general_follow_up`、2 个英文 hint 均命中；Organizer 前 5 条只有 2 个 canonical topic 命中，且
> 第 5 条出现 `major -> computer`。因此坏 fixture 不推翻 V4 `quality_gate_failed`，也不能只修
> 验收脚本后重跑。已建立独立 V5 设计与 R1--R8 计划：R1 新建显式
> language/exercise-family/coherent-context 的 V2 dataset；R2 将 Tutor 改为本地 evidence authority +
> 模型有界 intent/depth 选择；R3 将 Organizer 改为本地 topic shortlist + ordinal-only；随后才建立
> V5 runner/evidence、static/Mock 和新的精确 Live 授权门。
>
> 本轮未读取 `.env`/credential、调用 Provider、创建 V5 Live artifact、启动 Docker/API/browser 或
> 修改 PostgreSQL、Redis、MinIO 与业务数据。V4 run `0fb47591...` 的 marker/journal/evidence 继续
> durable seal 且不得重跑。完整证据见
> `docs/acceptance/2026-07-26-phase-6-9-7-tutor-organizer-v5-r0-zero-provider-root-cause.md`。
>
> 2026-07-26 — Phase 6.9.7 V4 R6 唯一 controlled-Live 失败封存：用户重新接受当时 DeepSeek
> 账号的数据保留/训练边界并精确授权一次 V4 branch run。唯一 run
> `0fb47591-5ff4-4e46-bcf3-2cd267d1fb2f` 使用 `deepseek-v4-pro` non-thinking JSON；`24/24`
> guard 均为 verified zero-call。Runner 顺序完成前 6 个 pair，共启动 12 个 executor；前 5 对得到
> 10 个 strict runtime，第 6 对 Tutor 的 raw schema 虽有效，但 `step_check` evidence 在本地 V4
> `dynamic_contract` 命中 `invalid_evidence_association`，Organizer sibling 已发起调用后收到 abort，
> usage 只能记为 unknown。Breaker 随即打开，剩余 36 个 runtime 没有启动，最终为 `10/48`
> strict runtime、Tutor/Organizer/combined semantic
> `0.14410714285714285/0.10372596153846154/0.1239165521978022`、`quality_gate_failed`。
>
> 11 个 verified usage 合计 `9445/652` tokens，可核验部分费用 `0.032247 CNY`；由于另有 1 个
> attempted-aborted usage unknown，完整 pricing profile、total CNY 与四个 P95 均按合同保持 `null`，
> 不把部分样本伪装成整轮指标。Evidence/journal/marker SHA-256 分别为
> `6ec60be1fced72766253e237b892fabb8e1d4ceca555249593d693f5e2d94608`、
> `8cc65e21a17d870fbad1c582677526a78f2859de933f7e43cfbea6481103188e`、
> `601f62b6d328a805cfa8d7e3e681d2523551f4eaaba67d182323f9d1546cdae2`；58 条 journal
> 保留 dispatch-before-call、runtime/pair terminal、breaker、run completion 与 evidence seal，专用 file/
> bundle validator 均通过。V1/V2/V3 validators 与七个历史 SHA 仍不变。
>
> 根 `.env` 的通用 DeepSeek key 只在授权父进程内映射到两个 component key，未打印或写入证据；
> tracked mock/live、两个产品 gate 与 component credential example 均保持安全默认。R6 没有启动或
> 修改产品 Docker/API/browser、PostgreSQL、Redis、MinIO 或 synthetic 业务数据，也没有清空容器、
> 镜像或卷。V4 一次性名额已经消费且不得重跑；不得进入 R7--R9、Task 13/main、Phase 6.10 或博客
> 收尾。若继续只能先新建与 V1--V4 双向隔离的零 Provider remediation。验收见
> `docs/acceptance/2026-07-26-phase-6-9-7-tutor-organizer-v4-controlled-live-failure.md`。
>
> 2026-07-26 — Phase 6.9.7 V4 R5 static/Mock checkpoint：在
> `codex/phase-6-9-7-tutor-wrong-question-agents` 上完成 zero-network 分支收口。Fresh V4 Mock run
> `c1bdf998-6fae-4c32-a4e3-bd6bea053454` 为 `24/24` verified zero-call、`48/48` strict runtime，
> Tutor/Organizer/combined semantic `1/1/1`，P95 `246/328/328/276ms`，verified usage
> `21948/5647`，estimated cost `0.099726 CNY`；V4 validator 通过。由于 provenance 是
> `mock_synthetic`，报告按 Live-only authority 保持 `quality_gate_failed`。唯一 Mock evidence 已按
> run ID 精确删除，V4 marker/journal/recovery/evidence 均为 0。
>
> 分支静态门通过：V4/V3 focused `68/68`（`548 expect()`），Agent `674/674`（`7094
expect()`），AI `199/199`（`1054 expect()`），Types `42/42`，Server `227` suites passed / `3`
> skipped、`2154` passed / `30` skipped，Web `439/439` 与 17-route build，Organizer PostgreSQL E2E
> `12/12`，Compose tracked example quiet config、相关 typecheck/lint/build 均通过。测试账号残留为 0，
> tracked gates=false、component credential example empty；V1/V2/V3 validators 与七个历史 SHA 保持
> 不变。Server 首次仅因未注入测试 `DATABASE_URL` 在 Prisma 初始化前退出；使用测试文件公开的本地
> 默认连接串补跑后全量通过，不属于代码缺陷。
>
> 本轮未读取根 `.env` 或 component credential、未调用 Provider、未执行 V4 Live、未启动或重建产品
> Docker/API/browser，也未修改或清空 Docker 容器、镜像、卷、PostgreSQL、Redis 或 MinIO。V4
> R0--R5 已完成，Phase 6.9.7 仍未完成；该 R5 检查点当时停在 R6 新的精确一次性 V4 branch controlled-Live
> 授权门前。产品验收、Task 13/main、Phase 6.10 与博客收尾均未开始。验收见
> `docs/acceptance/2026-07-26-phase-6-9-7-tutor-organizer-v4-r5-static-mock.md`。
>
> 2026-07-26 — Phase 6.9.7 V4 R4 independent robustness 与 crash-safe evidence lineage：新增与
> 冻结 72-case authority 隔离的 versioned held-out/metamorphic/schema-negative fixtures，覆盖 Tutor
> 中英/混合改写、否定、干扰与 active-context 重排，Organizer authority drift、question/deck reorder、
> locked name、ordinal/topic/evidence/confidence/schema fail-closed，以及两 lane abort、独立预算、
> single-call/no-retry 和写权限隔离。测试直接扫描实际 V4 candidate prompt，确认不含 case ID、expected、
> accepted-label、oracle 或冻结答案表。
>
> 新增独立 `phase-6.9.7-tutor-organizer-runner-v4`、V4 report/evidence envelope、CLI/validator 与
> marker/journal/recovery/evidence durability。V4 marker 使用 `wx` 单胜者；journal 在 dispatch 前 append +
> fsync，并以 sequence/previous SHA/record SHA 验证固定 72/24/48 状态机；recovery claim 防活 owner
> 误封和 ABA takeover；orphan 只能零网络封存，不能 resume/replay/retry；evidence 使用 temp `wx` +
> fsync + hard-link final，same bytes 幂等、different bytes/tamper/cross-version 均 fail-closed。V4 Live
> CLI 在 R6 前固定返回 `live_not_available_before_r6`，本轮没有调用 Provider。
>
> V4 durability `6/6`（`41 expect()`），R4/V3 focused `68/68`（`548 expect()`），Agent 全量
> `674/674`（`7094 expect()`）、typecheck 与 lint 通过；V1/V2/V3 历史 validator 及七个
> marker/journal/evidence SHA 均保持不变。另修复历史 Organizer V2 prompt identity 漂移：
> `PHASE_6_9_7_ORGANIZER_PROMPT_VERSION_V2` 重新固定为
> `wrong-question-organizer-model-candidate-v2`，避免当前产品 V4 identity 污染封存 V2 validator。
> Contract/security/concurrency 与 docs/history/operations 两路只读终审均 PASS，无
> Critical/Important。
>
> 本轮未读取 `.env`/credential、调用 Provider、启动 Docker/API/browser、创建 V4 Live artifact 或修改
> PostgreSQL、Redis、MinIO、Docker volume/业务数据。V4 R0--R4 已完成；该检查点当时下一步仅 R5
> static/Mock checkpoint 与独立终审，后续已完成。V4 Live、产品 Docker/API/browser、Task 13/main
> 与 Phase 6.10 均未开始；该 R4 检查点当时仍须新的精确一次性 Live 授权。验收见
> `docs/acceptance/2026-07-26-phase-6-9-7-tutor-organizer-v4-r4-robustness-lineage.md`。
>
> 2026-07-26 — Phase 6.9.7 V4 R3 WrongQuestionOrganizer 语义单一规则源：新增深冻结
> `packages/agent/src/policies/wrong-question-organizer-policy.ts`，把 subject、deck、topic、evidence
> 与 confidence 收敛为一份可执行决策矩阵。已知 subject 只能 `keep_local +
structured_subject`，未知 subject 禁止 `keep_local`；`reuse_existing` 只能引用同学科 ordinal deck
> 并要求 `existing_deck_overlap`，`create_topic` 必须生成安全、精确且有题意依据的 topic。
>
> `semantic_topic`、`error_pattern`、`insufficient_signal` 与 high-confidence 支撑条件由同一 policy
> 同时供 formatter、validator 和 merger 使用。Merger 只应用已通过校验的 ordinal decision，不补
> evidence、不修正越权 subject、不清洗非法 topic；owner、question/deck ordinal、用户锁定名称、
> 前后 stale fence、单次调用、独立预算、abort 与 no-retry 边界保持不变。产品默认 identity 更新为
> `wrong-question-organizer-model-candidate-v4`。
>
> 历史 paired harness 显式走 `runWrongQuestionOrganizerModelCandidateV2`；V2 formatter SHA
> `e1489fb8...c257` 与 V3 Organizer prompt SHA `2947cea2...ffdffd` 保持不变，72-case
> dataset/SHA/baseline 及 V1/V2/V3 report/validator/evidence 未被重建或改写。R3 focused
> `45/45`、`571 expect()`，Agent 全量 `656/656`、`6896 expect()`，Server Organizer
> `50/50`、Agent TypeScript 与 Server production build 通过；两路只读复审均无
> Critical/Important。
>
> 本轮未读取 `.env`/credential、调用 Provider、创建 V4 runner/CLI/marker/journal/evidence、启动
> Docker/API/browser 或修改 PostgreSQL、Redis、MinIO、Docker volume/业务数据。该检查点当时下一步仅
> R4 independent robustness 与 V4 lineage，后续已完成；R5 checkpoint 后仍须重新取得一次精确
> V4 Live 授权。
> 验收见
> `docs/acceptance/2026-07-26-phase-6-9-7-tutor-organizer-v4-r3-organizer-semantics.md`。
>
> 2026-07-26 — Phase 6.9.7 V4 R2 Tutor 语义单一规则源：新增深冻结
> `packages/agent/src/policies/tutor-strategy-policy.ts`，统一五类模型 intent、primary/allowed
> evidence、compatible depth、default/active-context depth、guiding/final-answer 与 answer structure。
> V4 precedence 固定为
> `step_check > explain_solution > concept_bridge > socratic_hint > general_follow_up`；prompt formatter、
> validator、evidence resolver、depth compatibility、candidate merger 与本地
> `buildTutorStrategyFromIntent` 共用该 authority。
>
> active context 现在只能作为支持上下文，不能把本地已识别的具体 intent 降级为
> `general_follow_up`；merger 对 precedence downgrade 返回 fail-closed。`answer_direct` 继续保持本地
> provider 前 zero-call、模型 schema 禁止和本地答案权限；同时修复中英文否定句“不要/Don't just
> give me the answer”被误判为 direct-answer 的风险。V4 generic prompt 不包含 case ID、expected、
> accepted label、答案、route/tool/permission 或写能力。
>
> 冻结 deterministic detector/baseline 没有被新模型 precedence 重排；V2/V3 paired eval 改走显式
> `runTutorModelCandidateV2` 历史 policy，当前产品 candidate 使用
> `tutor-model-candidate-v4`。因此 deterministic `6/48`、Tutor semantic `0.4418666667` 与 V3 Tutor
> prompt SHA `sha256:91be5091...47fc6a` 均保持不变，没有让 V4 prompt 冒充旧 evidence。R2 focused
> `56/56`、`533 expect()`，Agent 全量 `647/647`、`6856 expect()`，Web Tutor 配置/编排
> `18/18`、Agent TypeScript、Agent/Web lint、Prettier、diff check 与 Markdown 相对链接门均通过。
>
> 本轮未读取 credential、调用 Provider、创建 V4 runner/CLI/marker/journal/evidence、启动
> Docker/API/browser 或修改 PostgreSQL、Redis、MinIO、Docker volume/业务数据。该检查点当时下一步
> 仅 R3 WrongQuestionOrganizer V4 语义单一规则源，后续已完成；R5 后仍须重新取得一次精确 V4
> Live 授权。验收见
> `docs/acceptance/2026-07-26-phase-6-9-7-tutor-organizer-v4-r2-tutor-semantics.md`。
>
> 2026-07-26 — Phase 6.9.7 V4 R1 bounded diagnostics 与历史兼容：新增独立
> `phase-6.9.7-v4-bounded-diagnostics-v1` case/report contract，将每个 case 互斥区分为
> `not_started / executed_contract_failure / executed_semantic_mismatch /
executed_semantic_match`。合同失败必须记录真实 stage：`provider_runtime / raw_schema /
dynamic_contract / local_merger / usage / latency / safety`；24 个 guard 必须保持
> `not_started/case_guard`，不能冒充模型成功或 schema failure。
>
> Tutor 只投影 intent、depth、evidence association、context、guiding、final-answer、answer-structure
> 七个布尔轴与 nullable primary-evidence suppression。Organizer validator 现在以唯一
> `context/index -> subject -> deck -> topic -> evidence -> confidence` 顺序返回固定
> `stage/axis/reason`；legacy API 只映射同一结果回旧 reason，产品 merger 直接复用已通过 validation，
> 不建立第二套排序，也不自动补 evidence、修正 subject 或清洗 topic。Organizer raw-schema/dynamic
> failure 必须携带精确 reason；Provider/usage 等失败只记录真实 stage，继续复用 V3 bounded runtime
> authority。
>
> 72-case aggregate 由 entries 重算并拒绝重复 ID、手改计数、跨 agent、guard/runtime 错配、额外字段
> 与 raw output。V1/V2/V3 的 V4 字段继续 absent，旧 strict validator 拒绝 V4，V4 validator 也拒绝
> 旧 report；synthetic 三版 report 在 projection 前后 SHA 不变。focused `32/32`、Agent 全量
> `635/635`、`6759 expect()`、typecheck/lint/Prettier/diff check 通过。history 复审 APPROVED；contract
> 复审发现的 contract-stage 缺口已修复并复审 RESOLVED；七个 V1/V2/V3 历史 artifact SHA 与 R0
> 记录 7/7 一致。
>
> 本轮未读取 credential、调用 Provider、创建 V4 runner/CLI/marker/journal/evidence、启动
> Docker/API/browser 或修改 PostgreSQL、Redis、MinIO、Docker volume/业务数据。该回执当时下一步仅
> R2 Tutor V4 语义单一规则源；后续 R2 已完成。R5 后依旧必须重新取得精确 V4 Live 授权。验收见
> `docs/acceptance/2026-07-26-phase-6-9-7-tutor-organizer-v4-r1-bounded-diagnostics.md`。
>
> 2026-07-26 — Phase 6.9.7 V4 R0 零 Provider bounded 复盘与设计：在 V3 失败 authority
> `ff2e1a54...` 不可变、不重跑的前提下，只读取已封存的安全 evidence。Tutor 前 14 个 runtime
> 全部 strict/usage verified；intent/depth/context/guiding/final-answer/structure 命中分别为
> `11/14、14/14、14/14、11/14、14/14、11/14`，三个可见偏差为两个
> `socratic_hint -> general_follow_up` 和一个 `step_check -> general_follow_up`。报告中的 10 个
> invalid Tutor case 是 breaker 后未执行项，不是已执行 schema failure。
>
> Organizer 前 14 个 runtime 为 13 success + 1 dynamic-contract failure；14 个 bounded decision
> 的 subject/action/accepted-topic/confidence/required-evidence 命中分别为
> `13/14、14/14、5/14、12/14、10/14`，7 个使用 `insufficient_signal`。首错
> `organizer-runtime-14` 只可确认在本地 subject authority 合同失败；semantic observation 的
> unexpected topic/空 evidence 不能倒推 raw model output 或 Provider 根因。
>
> V4 已冻结独立 runner/prompt/runtime-evidence/approval/marker/journal/evidence/validator identity，
> 以及 R1 diagnostics、R2 Tutor policy、R3 Organizer policy、R4 robustness/lineage、R5
> static/Mock checkpoint 路线。V3 的 guard/breaker/fixed denominator/lane/journal/seal 原则继续复用，
> 但 artifact 与授权绝不复用；dataset、`0.85/0.15` 质量门、权限、预算、no-retry 不变，merger 不
> 自动修正非法模型输出。
>
> 本任务没有修改 Agent 源码、读取 credential、调用 Provider、创建 V4 Live artifact、启动
> Docker/API/browser 或修改业务数据。该 R0 检查点当时下一步是 R1 zero-network bounded
> diagnostics，后续已完成；R5 通过后仍必须重新取得一次精确 V4 controlled-Live 授权。设计、计划
> 与验收分别见
> `docs/superpowers/specs/phase-6-9-7-tutor-organizer-v4-remediation-design.md`、
> `docs/superpowers/plans/phase-6-9-7-tutor-organizer-v4-remediation.md`、
> `docs/acceptance/2026-07-26-phase-6-9-7-tutor-organizer-v4-r0-zero-provider-postmortem.md`。
>
> 2026-07-25 — Phase 6.9.7 V3 R5 controlled-Live 失败封存：用户重新确认 DeepSeek 数据
> 保留/训练边界并精确授权唯一一次 V3 branch Live。零网络 preflight 在 clean `8167f9e3` 上通过
> V3 focused `50/50`、`360 expect()`、V1/V2 四 SHA/validator、V3 artifact=0、tracked
> gates=false 与 component credential empty；根 `.env` 只验证通用 key 可用，值未输出且文件未修改。
>
> 唯一 run `ff2e1a54-0cbd-494c-96b7-a0f366c6c3dc` 使用 DeepSeek V4 Pro non-thinking JSON。
> `24/24` guard 保持 provider 前 zero-call；执行到第 14 对时，Organizer
> `organizer-runtime-14` 的结构化对象在本地 `dynamic_contract` 命中
> `subject_authority_violation`，breaker 进入 `quality_gate_impossible`。最终 28 个 runtime 启动且
> usage 全部 verified，`27/48` strict runtime，剩余 20 个保持
> `not_started_quality_breaker`；Tutor/Organizer/combined semantic 为
> `0.5280555556/0.4376201923/0.4828378739`，最终 `quality_gate_failed`。
>
> Marker SHA 为 `b18a768...be412`，journal SHA 为 `df14187...d6cff`，evidence SHA 为
> `e24f4e6...22d25c`。98 条 journal 最后依次为 `breaker_opened`、`run_completed(failed)`、
> `evidence_sealed`；V3 file/bundle validator 均通过，recovery claim 为 0。28 个 runtime token
> `21771/1781` 可验证，但固定 48 分母不完整，P95、pricing profile 与 total CNY 按合同保持
> `null`，供应商账单仍是外部 authority。
>
> 本次没有 Provider failure category、critical、permission、mutation 或 broader fallback；这只证明
> 安全与 durable failure path 工作，不形成产品质量 authority。V3 一次性授权已经消费，不得重跑、
> 补跑或改写 V1/V2/V3 历史；R6--R9、产品 Docker/API/browser、Task 13/main、远程推送与 Phase
> 6.10 均不得开始。权威验收：
> `docs/acceptance/2026-07-25-phase-6-9-7-tutor-organizer-v3-controlled-live-failure.md`。
>
> 2026-07-25 — Phase 6.9.7 V3 R4 static/Mock checkpoint：在
> `codex/phase-6-9-7-tutor-wrong-question-agents` 上完成 R4 零 Provider 验收。fresh V3 Mock run
> `116cc321-962f-426c-8a91-f05ab8debc93` 为 `24/24` verified zero-call、`48/48` strict
> runtime、Tutor/Organizer/combined semantic `1/1/1`，P95 为 `246/328/328/276ms`，verified
> usage `21948/5647`，估算 `0.099726 CNY`；V3 validator `ok=true`。Mock 仍按 Live-only
> authority 固定为 `quality_gate_failed`，唯一 evidence 已按 run ID 精确删除。
>
> 独立 breaker/failure synthetic report 在 pair 0 注入 Tutor strict schema failure，只实际启动
> Tutor/Organizer 各一次，余下 46 个 runtime 为 `not_started_quality_breaker`，固定 runtime 分母仍为
> 48；P95、价格和费用因样本不完整而 fail-closed。没有 Provider 调用或 evidence 文件。
>
> V3 focused `50/50`、Agent `629/629`、AI `199/199`、Types `42/42`、Server `2154`
> tests、Web `439/439`、Organizer PostgreSQL E2E `12/12`、Compose quiet config、相关
> typecheck/lint/build 均通过。首次 Server full 只因 Docker 未运行而中断；随后仅启动现有 Docker
> Desktop 与 `docker-postgres-1` 补跑，不 prune、不删容器/镜像/卷。E2E 测试账号残留为 0。
>
> V1/V2 四个 SHA 与两版 validator 均保持不变，V3 Live marker/journal/evidence/recovery claim 为
> 0，两个 tracked gate=false、component credential example 为空。本任务没有读取根 `.env` 或真实
> key，没有调用 Provider、启动产品 API/browser、开始 Task 13/main 或 Phase 6.10。权威验收：
> `docs/acceptance/2026-07-25-phase-6-9-7-tutor-organizer-v3-r4-static-mock.md`。当前必须停止并
> 重新取得一次精确 V3 branch controlled-Live 授权。
>
> 2026-07-25 — Phase 6.9.7 V3 R3 crash-safe evidence 与不可重放恢复：在
> `codex/phase-6-9-7-tutor-wrong-question-agents` 上新增完全独立的 V3 CLI、确认词、授权变量、
> marker、journal、evidence prefix 与 validator；V1/V2 runner、文件和历史 authority 不接受 V3
> 字段，也没有被改写。
>
> Live marker 使用 `wx` 并记录 owner PID；marker 后、任何 executor 创建前，journal 必须完成初始化
> 记录写入与 fsync。runner lifecycle 又保证每条 `dispatch_started` fsync 早于对应 executor。journal
> 为 append-only JSONL，以单调 sequence、previous SHA 与 record SHA 组成 hash chain，并对 guard、
> dispatch、runtime/pair terminal、breaker、run complete 与 seal 执行严格状态机校验。
>
> 进程崩溃后只允许零网络 `seal`：已 dispatch 未 terminal 的 lane 固定为
> `attempted_orphaned + unknown_after_attempt`，从未 dispatch 的 lane 为
> `not_started_orphaned + absent_not_attempted`，已 terminal 结果保持不变；完整 72/24/48 分母不会
> 删除、补跑、resume、replay 或 retry。journal 缺失只能形成 marker-only 初始化失败证据。
>
> orphan sealer 会阻止活 marker owner，死 owner 通过 token 化 recovery claim 单胜者接管；同一
> claim 只能打开一个 appender，takeover 后旧 appender 被 fence。release 增加 canonical token
> 前置验证与“已明确失去 claim 时 rename=0”断言；其保证依赖单主机 PID liveness。它不承诺在
> false-liveness、测试 override 或跨主机文件系统上原子消除 `assertOwned -> rename` 的全部
> TOCTOU。writer close 会 drain 已接受 append；该机制不冒充跨主机分布式 lease。
>
> evidence 先过 strict schema、派生字段、敏感字段与 marker/journal SHA 校验，再通过随机 temp
> `wx` + fsync + hard-link 发布；final 只接受 same bytes 幂等，不同字节和路径冲突拒绝覆盖。R3
> durability `21/21`（`228` assertions）、V3 focused `50/50`（`360` assertions）、Agent full
> `629/629`（`6710` assertions）、AI full `199/199`（`1054` assertions）通过；Agent/AI
> typecheck/lint、V1/V2 validator、四个历史 SHA 与 V3 Live artifact=0 均通过。
>
> 本任务没有读取根 `.env`/credential、调用 DeepSeek 或其它 Provider、启动 Docker/API/browser、
> 创建真实 V3 Live marker/journal/evidence/recovery claim 或修改业务数据，也没有开始 Task 13、
> main 合并或推送。权威验收：
> `docs/acceptance/phase-6-9-7-tutor-organizer-v3-r3-crash-safe-evidence.md`。该检查点当时下一步仅 R4；后续 R4 已完成，唯一 V3 R5 又以 `quality_gate_failed` 封存。回顾时可以问：为什么 dispatch 必须
> 先 fsync？为什么崩溃后只 seal 不能 resume？为什么 hard-link 不等于 Provider exactly-once？
>
> 2026-07-25 — Phase 6.9.7 V3 R2 strict-gate breaker、双 Lane Ledger 与固定分母：在
> `codex/phase-6-9-7-tutor-wrong-question-agents` 上新增独立 V3 paired scheduler/report，不改写
> V1/V2 runner。24 条 guard 现在全部先执行；任一 guard 失败时 48 条 runtime 仍保留在报告固定
> 分母，但实际 provider dispatch 为 0。
>
> runtime 按 24 个 pair 顺序推进，同 pair 的 Tutor/Organizer 最多双并发并分别使用独立
> AbortController、预算和故障归属。`runtimeContractSuccess` 只检查 invocation、schema、
> disposition、canonical diagnostic、latency、usage/价格与安全边界，不读取 fixture expected 或
> semantic score；首个 contract failure 打开 `quality_gate_impossible`，收口当前 pair 后停止后续
> dispatch。semantic-only mismatch 不提前熔断，仍完整运行 48 条后由冻结 metric 判定。
>
> `(runId,agent,pairedRunIndex)` ledger 保证本进程单 dispatch。触发 lane 只 abort sibling，不能把
> 自己的 Provider category 复制给另一 lane；sibling 忽略 abort 时在 1000ms 有界窗口后记录为
> `attempted_orphaned + unknown_after_attempt`。后续未执行 case 记录
> `not_started_quality_breaker`，不 retry、不补跑、不借用另一 lane 预算；usage/P95/价格不完整、
> applied 后评测层 usage 校验失败和 report summary 篡改全部 fail-closed，raw harness canary 不进入
> report。
>
> focused V3 contract/runner `29/29`（`132` assertions）、Agent full `608/608`（`6479`
> assertions）、AI full `199/199`（`1054` assertions）通过；Agent/AI typecheck/lint、V1/V2
> validator、四个历史 evidence/marker SHA、V3 Live artifact=0、Prettier 与 diff 门均通过。两路独立
> 只读复审无未关闭 Critical/Important。
>
> 本任务没有读取根 `.env`/credential、调用 DeepSeek 或其它 Provider、启动 Docker/API/browser、
> 创建 V3 CLI/marker/journal/evidence 或修改业务数据，也没有合并 main 或推送。权威验收：
> `docs/acceptance/phase-6-9-7-tutor-organizer-v3-r2-breaker-lane-ledger.md`。该检查点当时下一步仅 R3
> 独立 CLI/journal/crash-only seal/evidence；后续 R3 已完成。回顾时可以问：为什么
> 首个 contract failure 可以熔断而 semantic mismatch 不可以？为什么 unknown usage 不能记为零费用？
>
> 2026-07-24 — Phase 6.9.7 V3 R1 安全诊断投影与零网络 compatibility：在
> `codex/phase-6-9-7-tutor-wrong-question-agents@06b14cf8` 上新增独立
> `runner-v3 / tutor-model-candidate-v3 / wrong-question-organizer-model-candidate-v3` identity；两个
> prompt identity 继续绑定 V2 深冻结 policy bytes，content SHA-256 固定为
> `91be5091...7fc6a` / `2947cea2...fdffd`，没有加入 case-specific oracle。
>
> `@repo/agent` 现在把 runtime Trace 中受信的八类 Provider failure category 与三个
> structured-output stage 投影为有界 V3 evidence；`lastCompletedStage` 只允许 config、executor、
> request、delegate、response audit、structured object、dynamic contract、local merger 与 applied
> 十个单调阶段，`executionOutcome / usageDisposition / runtimeInvocations` 必须满足 strict 组合。
> `structuredOutputStage` 在 sanitizer 后仍保留固定枚举，但 raw error、Provider response、URL、
> header、stack 与 credential 仍不会进入 candidate/evidence。
>
> paired harness 新增实际 invocation recorder：只有进入 delegate 才从 0 变为 1；outer safe
> wrapper 发生异常时按 recorder 写本地 `harness_internal_error`，dispatch 前保持 0，dispatch 后为
> 1 + unknown usage，不再由 catch 猜测或伪装 Provider category。canonical stage 只在前一层真正
> 完成后推进；V1/V2 report builder 继续完全丢弃 V3 字段，旧 strict schema 会拒绝被补字段的历史
> report。
>
> AI zero-network compatibility matrix 覆盖非法 config、provider factory failure、精确 V4 Pro
> non-thinking request shaping、response audit、schema handoff、abort/timeout；所有 delegate 都是
> sentinel/fake，不访问外部网络。focused `52/52`（`182` assertions）、Agent `596/596`
> （`6387` assertions）、AI `199/199`（`1054` assertions）通过；V1/V2 validator 均为
> `ok=true/filesChecked=1`，四个历史 evidence/marker SHA 保持
> `be044871...3f34b5 / 7cb443f1...f6ecffb / 0c645062...84c77 / ac65ac67...98504`，V3
> Live marker/journal/evidence artifact 为 0。
>
> 本任务没有读取根 `.env`/credential、调用 DeepSeek 或其它 Provider、启动 Docker/API/browser、
> 创建业务数据或 Live marker/journal/evidence，也没有合并 main 或推送。权威验收：
> `docs/acceptance/phase-6-9-7-tutor-organizer-v3-r1-diagnostics-compatibility.md`。该检查点当时下一步
> 仅 R2；后续 R2--R4 均已完成，唯一 V3 R5 又以 `quality_gate_failed` 封存。
>
> 2026-07-24 — Phase 6.9.7 V3 R0 零 Provider 失败复盘与设计：在 clean
> `codex/phase-6-9-7-tutor-wrong-question-agents@c23d593c` 上重新核对 V2 evidence/marker
> SHA-256，仍为 `0c645062...84c77` / `ac65ac67...98504`；V3 Live artifact 为 0，V1/V2
> history 未删除、覆盖或重建。
>
> 四路只读取证与主代理源码抽样确认：`@repo/ai` 已将受信 Provider 异常安全压缩为
> `http_auth/http_rate_limit/http_client/http_server/transport/structured_output/
invalid_response/unknown` 及三个 structured stage，并写入 runtime Trace；Tutor/Organizer
> candidate 可暂时保留 Trace，但 paired eval result/case builder 没有投影，外层 safe wrapper 又把
> 不同失败统一为 `runtimeInvocations=1/fallback_runtime_error/usage=null`。当前 scheduler 对 24
> 个 pair 顺序推进、每 pair 双并发，首个失败后仍会继续余下调用。这解释了 V2 证据为什么只有
> `fallback_runtime_error`，但仍不能指定 credential、网络、TLS、endpoint、model 或 adapter 为
> 单一真实根因。
>
> V3 现已冻结独立 runner/prompt/approval/confirmation/marker/journal/evidence identity；复用
> 现有安全 taxonomy，增加有界 `lastCompletedStage`、真实 dispatch outcome 与 usage 可知性。执行
> 先跑 24 guard，再按 pair 推进，最大网络并发 2。固定质量门要求 `48/48` strict runtime，所以
> 首个 runtime contract failure 后本轮已不可能通过：收口当前 pair 后立即停止后续派发，剩余 case 仍
> 保留在 48 分母并标记 not-started；Tutor/Organizer 不复制故障类别、不借 credential/预算，不
> 自动 retry、补跑或伪造零费用。
>
> marker 后先 durable 初始化 append-only hash-chain journal，再允许 dispatch；崩溃后只允许
> zero-network orphan seal，in-flight 记 unknown usage、未开始记 not-started，永不 resume/replay。
> evidence 继续使用 temp `wx` + fsync + hard-link final。后续压缩为 R1 diagnostics/preflight、
> R2 breaker/ledger、R3 journal/evidence、R4 static/Mock checkpoint 四个零 Provider 工程任务；
> R4 通过后必须停止并重新申请一次 V3 branch controlled-Live。
>
> 本任务只改文档，没有读取 `.env`/credential、调用 Provider、创建 V3 Live artifact、启动或清理
> Docker、修改数据库/Redis/MinIO/业务数据、合并 main 或推送。权威设计：
> `docs/superpowers/specs/phase-6-9-7-tutor-organizer-v3-remediation-design.md`；原子计划：
> `docs/superpowers/plans/phase-6-9-7-tutor-organizer-v3-remediation.md`；验收：
> `docs/acceptance/phase-6-9-7-tutor-organizer-v3-r0-zero-provider-design.md`。下一步仅 R1
> zero-network implementation。
>
> 2026-07-24 — Phase 6.9.7 V2 R7 唯一 controlled-Live 失败封存：用户重新接受 DeepSeek
> 当前账号的数据保留/训练边界并授权一次 V2 branch run。零网络 preflight 在 clean
> `8a3073f0` 上确认分支、V1 evidence/marker SHA、V2 artifact=0、默认 gate 与 V1 validator；
> V2 marker/evidence 并发 hardening `8/8` 通过。根 `.env` 只检测凭据存在性，同一底层 secret
> 仅在子进程映射为 Tutor/Organizer 两条 component-specific 变量，文件未修改；其它 Agent gate
> 显式关闭，Docker 未启动、停止、重建或清理。
>
> 唯一 run `67ce18dd-e2ed-4a05-8507-2a98898b8ede` 使用 runner-v2、冻结 dataset SHA、两个
> v2 prompt、`deepseek-v4-pro` non-thinking JSON 与 `deepseek_network` provenance。`24/24`
> guard zero-call 通过；Tutor/Organizer 各 24 个 runtime 全部为 `fallback_runtime_error`，最终
> `0/48` strict runtime、semantic `0/0`、absolute improvement
> `-0.4418666667/-0.278125`、critical `1`、verified usage `0`、pricing/cost 不可验证，gate 为
> `quality_gate_failed`。毫秒级 P95 只反映 runtime 提前失败，不是成功性能证据。
>
> 48 个失败都在结构化对象形成前，`canonicalValidationStage/Reason=null/null`；安全 evidence
> 不保存原始异常或 Provider 原文，因此不能武断归因于 credential、代理/TLS/网络、模型、
> endpoint、请求适配或 prompt。evidence/marker SHA-256 为
> `0c64506211d66570fdcf6a016a10885881985bdb0bc4628441c2e5b363d84c77` /
> `ac65ac67bd155f448e498a2c1dd9d7762d1efb4cc720a3cf1153083299c98504`，V2 validator
> `ok=true/filesChecked=1`。一次性名额已消费，V2 不得重跑；R8 Docker/API/browser、Task 13、
> main 合并与 Phase 6.10 均未开始。该 checkpoint 当时下一步只能先做零 Provider 失败复盘并另起 V3 identity；
> 新设计本身不授权网络调用。权威记录：
> `docs/acceptance/2026-07-24-phase-6-9-7-tutor-organizer-v2-controlled-live-failure.md`。
>
> 2026-07-24 — Phase 6.9.7 V2 remediation R6 static/Mock 与生产极端边界：在 R5
> runner/evidence 隔离之后，R6 先修复一次性执行与 evidence 的恢复语义。V2 marker 的真实
> 并发 `wx` 竞争只允许一个执行者；既有普通 marker 才返回 `live_already_attempted`，目录或
> 存储故障返回 `evidence_io_failed`。evidence temp 改用随机唯一 ID，旧 orphan 不阻塞；
> hard-link 成功即为 final authority，unlink cleanup failure 不再把已校验结果误报为丢失，
> `EEXIST` 与普通 I/O 故障分别处理。
>
> Chat 的 request signal 现已贯穿 Tutor orchestration 和最终 `streamText.abortSignal`。Organizer
> 新增 provider await 中 abort 无 Trace/command、command commit failure 同 runId failed Trace、
> 同题 normal/force 及 single/batch 并发的回归；PostgreSQL `12/12` 证明最终只有一个
> owner-scoped deck/item authority，后续读取路由可见。未写入题仍可由 batch 的
> `deckItems: none` 路径补偿。Organizer 是同步 API，不冒充 durable job；R6 不声明跨多实例
> provider exactly-once，但保证失败可见、无重复写、无越权和未写题可恢复。
>
> V2 focused `57/57`；Agent/AI/Types/Server/Web 分别 `578/194/42/2154/439`，Server
> `227` suites passed / `30` skipped，相关 typecheck/lint/build、Compose quiet、changed TypeScript Prettier、diff
> 均通过。baseline 保持 `6/48`、semantic `0.44186666666666674/0.278125`。fresh V2 Mock
> `593ee863-3743-4957-96e1-cb90e852a795` 为 `24/24` zero-call、`48/48` runtime、semantic
> `1/1`、P95 `246/328/328/276ms`、usage `21948/5647`、estimated `0.099726 CNY`；按
> Live-only authority 仍是 `quality_gate_failed`。V2 validator 通过，临时 evidence 精确删除，
> V1 SHA 不变，V2 Live marker/evidence 为 0，tracked gates=false、component key 为空、测试
> 账号残留为 0。
>
> contract/security/concurrency/routing 与 operations/acceptance/history 两路终审均
> `APPROVED`，无未关闭 Critical/Important。本任务没有读取真实 credential、调用 provider、执行产品 Docker/API/browser、合并 main 或
> 推送远程。权威记录：
> `docs/acceptance/2026-07-24-phase-6-9-7-tutor-organizer-v2-r6-static-mock.md`。下一步必须
> 停在 R7 新的 `Phase 6.9.7 Tutor/Organizer V2 branch controlled-Live` 精确授权门前。回顾时
> 可以问：为什么 marker 后崩溃不能自动重跑？为什么 hard-link 是发布 authority？single/batch
> 如何避免丢题和重复写？为什么 Mock semantic=1 仍不能证明产品可用？
>
> 2026-07-24 — Phase 6.9.7 V2 remediation R5 独立 runner/CLI/validator/evidence：R4
> 之前只证明 v2 prompt/contract 与 anti-overfit，公共 runner/CLI 仍固定生成 V1；直接切换默认
> 常量会破坏唯一 V1 failure evidence 的兼容性，也会让旧 marker 错误阻塞 V2。因此 R5 保留
> legacy V1 entry，新增长期并存的显式 `runPhase697TutorOrganizerPairedEvalV2`、V2 CLI、V2
> validator 和 package scripts。
>
> V2 report 固定 `phase-6.9.7-tutor-organizer-runner-v2` 与两个 v2 prompt identity；72 个
> entry 必须显式携带 bounded diagnostics，而 V1 仍要求字段完全 absent。新 Live confirmation、
> `PHASE_6_9_7_V2_CONTROLLED_LIVE_APPROVED`、V2 marker 与 evidence prefix 均与 V1 分离；
> marker 使用 `wx`，evidence 使用临时文件 + hard-link exclusive-create。旧 V1 marker 不阻塞
> V2，V1/V2 validator 双向拒绝对方 report/filename，第二次 V2 marker/evidence 写入被拒绝。
>
> 无网络 synthetic Live 即使 `48/48` applied 也只能记录 `synthetic_test`，共享 production gate
> 仍因 provenance 固定关闭；只有未来 CLI 自建的 `deepseek_network` 才可能通过。配置、授权或
> cross-agent gate 不完整时仍在 marker/executor 前失败，component credential 边界未改变。
>
> RED 为 V2 独立导出缺失；GREEN V2 isolation `5/5 / 40 assertions`，相关 focused
> `37/37 / 371 assertions`，Agent full `575/575 / 6323 assertions`，typecheck/lint 通过。
> fresh Mock run `d4fc9a3a-5825-47f2-a4d2-d0148c7ccaf4` 为 `24/24` zero-call、`48/48`
> strict runtime、semantic `1/1`、P95 `246/328/328/276ms`、usage `21948/5647`、estimated
> `0.099726 CNY`；V2 validator `ok=true/filesChecked=1`，V1 validator 正确拒绝。
>
> Mock evidence 已精确删除，V2 Live marker/evidence 仍不存在。V1 evidence/marker SHA-256
> 仍为 `be0448712b2567e572a27003937995700ef7f6e0d32ff210b3c1c7793c3f34b5` /
> `7cb443f18149de25628576a1e4969c423281776b5f3f6ffb1da6a8d39f6ecffb`。本任务没有读取
> credential、调用 provider、启动 Docker/API/browser、修改业务数据、合并或推送 main。
> 代码/合同/安全与 V1 历史不可变性两路独立复审均 `APPROVED`，无阻断项；hard-link
> 成功后若临时文件清理失败可能出现状态歧义是非阻塞低风险观察，不改变 R5 结论。
> 下一步 R6 分支静态/Mock checkpoint 与独立复审；R6 完成前不申请新 Live。回顾时可以问：
> 为什么 V1/V2 要保留两个 validator？为什么旧 marker 不能通过删除来“升级”？为什么 Mock
> semantic=1 仍是 `quality_gate_failed`？
>
> 2026-07-24 — Phase 6.9.7 V2 remediation R4 held-out/metamorphic anti-overfit：R2/R3
> 已让 prompt 与 validator 共用规则源，但仅在冻结 72-case 上取得工程满分仍可能隐藏
> case ID、expected output 或 accepted-label 答案表，也不能证明 ordinal、subject、deck 和
> context authority 变化时仍由本地规则掌权。R4 因此新增独立深冻结
> `phase-6.9.7-tutor-organizer-v2-robustness-v1` fixture，明确不进入原 dataset、Live 分母、
> 费用或 production quality authority。
>
> Tutor tests 覆盖中文/英文/混合语言同义改写、context reorder、无关安全句插入、context
> availability 变化、incompatible depth、`answer_direct` 与注入/凭据 zero-call；Organizer
> tests 覆盖六类新 subject、known/unknown authority、same/cross-subject deck、deck/question
> ordinal reorder、evidence 顺序/重复、越界 ordinal、locked-name 与 authority drift。语义不变
> 变换必须保持 canonical decision；authority 变化只能改变本地结果或 fail-closed。
>
> prompt leakage scanner 直接捕获 Tutor/Organizer 实际 candidate request，检查全部 frozen case
> ID、dataset identity、oracle key、完整 expected object 及 canonical/accepted topic labels；故意
> 注入 case ID、label 和 `acceptedTopicLabels` 的反例会被命中，真实 prompt 为 0 泄漏。
> formatter bytes 稳定，公共 runner/CLI 继续绑定 V1；既有 paired runner 的 synthetic 满分仍是
> `quality_gate_failed`，Mock 没有被升级为语义 authority。
>
> R4 focused `16/16`（`212` assertions）、Agent full `570/570`（`6283` assertions）、Agent
> typecheck/lint、新增 TypeScript 文件的 Prettier check 与 V1 evidence validator 通过。冻结 dataset SHA-256 保持
> `7ac2f4b5411831308d46a9df939907444285081897848aeb250944e43382207e`；V1
> evidence/marker SHA-256 仍为
> `be0448712b2567e572a27003937995700ef7f6e0d32ff210b3c1c7793c3f34b5` /
> `7cb443f18149de25628576a1e4969c423281776b5f3f6ffb1da6a8d39f6ecffb`，V2
> marker/evidence 匹配为 0。代码/安全与文档/历史边界两路独立复审均 `APPROVED`，无未关闭
> Critical/Important；固定 Mock responder 不验证真实模型语义，这与 R4 零 provider 范围一致。
>
> 本任务没有读取 credential、调用 provider、启动 Docker/API/browser、创建 V2 evidence、
> 修改业务数据、合并或推送 main。该 checkpoint 当时下一步是 R5，后续已完成；R6
> checkpoint 前不申请新 Live。回顾时可以问：为什么 held-out/metamorphic
> 满分不能替代 controlled-Live？为什么 deck reorder 必须按本地 ID authority 重映射？为什么
> prompt 泄漏扫描需要故意污染反例？
>
> 2026-07-24 — Phase 6.9.7 V2 remediation R3 Organizer prompt/contract precision：V1
> Organizer prompt 没有完整表达本地 validator 已执行的 known/unknown subject authority、
> same-subject deck、reuse/create evidence、confidence 与 topic-label 精度规则，容易让合法 JSON
> 在动态 contract 后被安全回退。R3 新增单一深冻结
> `WRONG_QUESTION_ORGANIZER_ASSOCIATION_POLICY`，由 contract validator 与稳定 prompt
> formatter 共用，完整覆盖 `keep_local + structured_subject`、
> `reuse_existing + existing_deck_overlap`、`create_topic` 的 evidence 选择、
> `high + insufficient_signal` 禁止、六类 subject taxonomy 和 medium/high confidence 语义。
>
> topic label 继续要求单一、短、精确且来源可证，并明确拒绝“知识点”“综合题”“学习资料”
> “错题整理”等泛标签；没有增加 dataset-specific alias map，也没有扩大
> `acceptedTopicLabels`。schema/projection 仍为 v1，ordinal、真实 ID、owner snapshot、
> locked deck 名称、Trace admission、写命令和最终 local merger authority 均未改变。
> `wrong-question-organizer-model-candidate-v2` identity 已由 package candidate、Server config、
> Agent Trace 与 future V2 report contract 共用；active public runner/CLI 仍为 V1，R5 前没有
> V2 marker/evidence 入口。
>
> R3/Phase 6.9.7 focused `40/40`（`582` assertions）、Agent full `554/554`（`6071`
> assertions）、Server Organizer `30/30`（`162` assertions）通过；Agent/AI
> typecheck/lint、Server lint/build 与 `git diff --check` 通过。两路独立只读复审无未关闭
> Critical/Important。V1 evidence/marker SHA-256 实际复核仍为
> `be0448712b2567e572a27003937995700ef7f6e0d32ff210b3c1c7793c3f34b5` /
> `7cb443f18149de25628576a1e4969c423281776b5f3f6ffb1da6a8d39f6ecffb`。
>
> 本任务为纯离线 R3：没有读取 credential、调用 provider、启动 Docker/API/browser、
> 创建 V2 evidence、修改业务数据、合并或推送 main。该 checkpoint 当时下一步是 R4
> held-out/metamorphic anti-overfit，后续已完成。回顾时可以问：为什么 prompt formatter 与 validator 必须共用 association
> policy？为什么 v2 identity 已接 Server/Trace 仍不等于 V2 runner 已发布？为什么泛标签禁区
> 不能替代 R4 的防答案表测试？
>
> 2026-07-24 — Phase 6.9.7 V2 remediation R2 Tutor prompt/contract 单一规则源：V1 Tutor
> prompt 只要求选择 intent/evidence/depth，却没有完整告诉模型本地 contract 实际执行的
> primary/allowed evidence 和 compatible depth；validator与 candidate 还各自保留一份规则，
> 后续容易漂移。R2 因此把五类 intent 的 evidence、depth 和通用选择语义收敛为一个
> 深冻结 readonly policy，contract validator、稳定 prompt formatter 与 local merger 共用同一
> authority。formatter 只包含固定 enum/规则，泄漏扫描确认不含 case ID、fixture 文本、
> expected output 或 canonical label。
>
> Tutor prompt identity 已升为 `tutor-model-candidate-v2`；Web server-only config 不再手写另一个
> version，而是从 `@repo/agent/model-candidates` 引用同一常量。future paired V2 identity
> 也引用该常量，但 active public runner/CLI 仍是 V1；R5 前没有 V2 marker/evidence
> 入口。`answer_direct` 仍不在模型 schema 中，schema/projection、dataset/SHA、质量门、
> 预算和权限均不变。depth compatibility 继续由 local merger 最终拒绝，以保留
> R1 `local_merger / incompatible_depth` 诊断语义。复审曾将 validator 未提前拒绝
> depth 列为 Important；对照冻结设计和实际 candidate 路径后该意见已撤回为测试
> 覆盖建议，并已补齐五类 intent 的逐项不兼容 depth merger fail-closed 矩阵。
>
> Tutor/package focused `25/25`（`375` assertions）、Phase 6.9.7 V1/diagnostics 兼容
> `33/33`（`656` assertions）、Web Tutor config `5/5`、Agent full `552/552`（`5827`
> assertions）与 Web full `438/438` 通过；Agent/AI typecheck/lint、Web lint 与
> `git diff --check` 通过。两路独立只读复审最终无未关闭 Critical/Important。V1
> evidence/marker SHA-256 实际复核仍为
> `be0448712b2567e572a27003937995700ef7f6e0d32ff210b3c1c7793c3f34b5` /
> `7cb443f18149de25628576a1e4969c423281776b5f3f6ffb1da6a8d39f6ecffb`。
>
> 本任务为纯离线 R2：没有读取 credential、调用 provider、启动 Docker/API/browser、
> 创建 V2 evidence 或修改业务数据，也没有合并/推送 main。该 checkpoint 当时下一步是 R3
> Organizer prompt/contract precision，后续已完成。回顾时可以问：为什么 prompt/validator 必须共用一个 policy？
> 为什么 depth 不在 validator 提前拒绝？为什么 Web 已显示 v2 identity 仍不等于 V2
> runner/evidence 已可用？
>
> 2026-07-24 — Phase 6.9.7 V2 remediation R1 bounded diagnostics：V1 只能看到
> `rawSchemaValid`、`candidateDisposition` 与 `canonicalSchemaSuccess`，无法安全区分 raw schema、
> dynamic contract、本地 merger 和最终 applied；同时又不能为了排障保存 provider 原文。本任务因此
> 新增 versioned bounded adapter，只输出 `raw_schema / dynamic_contract / local_merger / applied`
> 与受限 reason enum。Tutor/Organizer 的 dynamic reason 分开校验，未知或混合额外 reason
> fail-closed；`structuredObjectCaptured` 区分 schema-invalid object 与 structured object 形成前的
> transport/runtime failure，后者和 zero-call 均保持双 `null`。
>
> report contract 继续要求 V1 entry 的两个新字段完全 absent；runner-v1 只能绑定
> `tutor-model-candidate-v1` / `wrong-question-organizer-model-candidate-v1`，future runner-v2 必须同时
> 绑定两个 v2 prompt identity。当前公共 runner/CLI 仍只生成 V1，V1 evidence validator 明确拒绝
> V2 report，避免在 R2--R5 完成前形成伪 V2 evidence 入口。dataset、SHA、baseline、schema/
> projection、模型、价格、预算、timeout、质量门、分母和生产 gate 均未改变。
>
> RED/GREEN focused `19/19`；Agent full `548/548`（`5643` assertions）、typecheck、lint 与 V1
> bundle validator `{"ok":true,"filesChecked":1}` 通过。V1 evidence/marker SHA-256 仍为
> `be0448712b2567e572a27003937995700ef7f6e0d32ff210b3c1c7793c3f34b5` /
> `7cb443f18149de25628576a1e4969c423281776b5f3f6ffb1da6a8d39f6ecffb`；两路独立复审均
> `APPROVED`，无未关闭 Critical/Important。CodeGraph ensure 为 already up to date；update-check
> 的一次普通 exit 1 未盲目重试。`bunx prettier --check` 因本机未安装 prettier 且网络受限未能
> 执行，没有产生修改；权威 lint 已通过。
>
> 本任务没有读取 credential、调用 provider、发布 V2 evidence、启动 Docker/API/浏览器或修改业务
> 数据，也没有合并/推送 main。该 checkpoint 当时下一步是 R2，后续已完成；回顾时可以问：为什么
> transport failure 不能伪装成 schema failure？为什么 V1 字段必须 absent？为什么已有 V2 report
> schema 仍不等于 V2 runner 已可发布？
>
> 2026-07-24 — Phase 6.9.7 V2 remediation R0 零网络设计 checkpoint：V1 的 48 个 runtime entry 全部 `rawSchemaValid=true`，但 Tutor 只有 `9/24`、WrongQuestionOrganizer 只有 `18/24` `candidate_applied`，合计 strict runtime `27/48`。Tutor 15 个 invalid 集中在 `concept_bridge`、`explain_solution` 与局部 hint/step/follow-up；Organizer 6 个 invalid 为 `runtime-13..18`，已应用结果仍有 subject、topic label 与 evidence/confidence 精度缺口。由于安全 evidence 不保存 raw provider output，本轮明确只确认失败位于 raw schema 之后，不伪造具体 evidence/depth 根因。
>
> 源码复核证明，V1 prompt 没有把本地 validator 实际执行的 Tutor intent→primary/allowed evidence/depth 映射，以及 Organizer subject authority、reuse/create evidence、confidence/keep-local 规则完整提供给模型。V2 选择共享深冻结 policy：validator 与稳定 prompt formatter 使用同一规则源，同时保留 strict Zod、本地 merger、ordinal、owner、locked-name、Trace admission 和写隔离。新 report 只增加固定 `raw_schema / dynamic_contract / local_merger / applied` 阶段与枚举 reason，不保存 prompt、题目、模型原文或自由文本诊断。
>
> 新设计继续冻结 dataset `phase-6.9-tutor-wrong-question-v1`、SHA `7ac2f4b5...2207e`、baseline、全部质量门、模型/价格/预算/timeout/权限/分母；另加 held-out/metamorphic 防答案表测试。V2 使用独立 runner/prompt、授权变量、marker/evidence，V1 marker/evidence 字节保持不可变。计划拆为 R1--R11：R1--R5 纯离线，R6 仅允许既有本地 PostgreSQL/静态 Compose 门且保持外部 provider 零调用；R6 静态/Mock checkpoint 后必须停止并取得新授权；V2 任一门失败即封存，不做产品验收。权威设计见 `docs/superpowers/specs/phase-6-9-7-tutor-organizer-v2-remediation-design.md`，计划见 `docs/superpowers/plans/phase-6-9-7-tutor-organizer-v2-remediation.md`。R0 未改源码、读取 credential、调用 provider、启动 Docker/API/浏览器或修改业务数据；该 checkpoint 当时的下一步是 R1，后续已完成。
>
> contract/security 与 operations/acceptance 两路独立复审无 Critical/Important；Tutor 技术复审提出的唯一 Important 是 diagnostics 缺逐层 RED fixtures，现已补齐 schema-invalid、dynamic evidence、Tutor incompatible depth、Organizer projection association、applied、zero-call、V1 absent 与未知组合拒绝矩阵。无上下文读者测试为 `READER PASS`。V1 evidence/marker SHA-256 复核仍为 `be044871...3f34b5` / `7cb443f1...f6ecffb`，`git diff --check` 与引用/冲突扫描通过；Git 变更仅为文档。
>
> 2026-07-24 — Phase 6.9.7 Task 12 唯一 V1 controlled-Live 失败封存：在 `5f2cfcdc` clean hardening HEAD 上确认 marker/evidence 不存在、其它六个生产 Agent gate 与 Review/Planner 验收门关闭后，用户授权的唯一 branch Live 已执行。run `39a62241-0f51-45be-a423-0d13b0b60ae4` 使用 `deepseek_network`、冻结 dataset SHA `7ac2f4b5...2207e`，得到 `24/24` verified zero-call、`27/48` strict runtime；critical/permission/mutation/broader fallback 均为 0。Tutor semantic `0.3485119048`，比 baseline 下降 `0.0933547619`；Organizer semantic `0.7000000000`，虽提升 `0.4218750000` 但仍低于 `0.85`。最终 `quality_gate_failed`。
>
> 延迟门全部通过：Tutor/Organizer/paired/Tutor orchestration P95 为 `1359/2640/2641.6812/1360.8845ms`；48 个 usage case 全部可验证，provider 报告 `21288/3759` tokens，费用 `0.086418 CNY`。evidence validator 通过；evidence SHA-256 为 `be044871...3f34b5`，marker SHA-256 为 `7cb443f1...f6ecffb`。失败 case 保留固定分母，当前签名集中为 canonical association/merger 后的 `fallback_schema_invalid`，没有保存或泄露原始模型输出。
>
> 按 Task 12 固定顺序，只有 `quality_gate_passed` 才能进入产品验收，因此本轮没有启动/重建 Docker service、调用产品 API、打开浏览器或创建 synthetic 业务数据；也没有修改根 `.env`、删除容器/镜像/卷或清空任何 Docker 数据。V1 marker/evidence 不得重跑、覆盖、删除或拼接。Phase 6.9.7 尚未完成；该 V1 checkpoint 当时的下一步是零网络 V2 remediation 设计，而不是直接进入 Task 13/main 合并，后续已完成的 R0 设计见本文顶部。权威记录见 `docs/acceptance/phase-6-9-7-tutor-wrong-question-controlled-live.md`。

> 2026-07-24 — Phase 6.9.7 Task 12 controlled-Live 零网络 preflight hardening：用户已在 Task 11 后明确接受 DeepSeek 当前账号的数据保留/训练边界并授权一次 branch controlled-Live。执行唯一调用前核对 CLI 时发现，`OTHER_AGENT_GATES` 使用不存在的 `ROUTER_AGENT_MODEL_ENABLED` / `KNOWLEDGE_VERIFIER_AGENT_MODEL_ENABLED`，而产品真实 gate 是 `ROUTER_MODEL_ENABLED` / `KNOWLEDGE_VERIFIER_MODEL_ENABLED`。旧实现不能证明其它 Agent 全关，因此没有用“当前环境碰巧 false”绕过，也没有创建 marker 或调用 provider。
>
> 新参数化 RED 覆盖 Router、Verifier、Review、Planner、KnowledgeDedup、KnowledgeOrganizer 六个其它生产 gate；首个真实 Router gate 为 true 时旧代码进入 repo 外 synthetic Live，focused 得到 `6 pass / 1 fail`，证明漏检。修复两个名称后，六项任一 true 都在 marker/executor 前返回 `live_configuration_invalid`，invocation=0；GREEN `7/7 / 41 expect()`，Agent full `543/543 / 5598 expect()`、typecheck、lint 与 diff 门通过。独立复核确认全仓八个生产模型 gate 已完整覆盖且旧名称匹配为 0。
>
> RED/ GREEN 都只使用系统临时目录和 synthetic executor，finally 精确清理临时 marker/evidence；仓库 `.tmp` 的唯一 controlled-Live marker/evidence 仍未创建。没有读取/打印 credential、调用 provider、启动 Docker/API/Web 或浏览器，也没有修改业务数据或 Docker 卷。权威记录见 `docs/acceptance/phase-6-9-7-tutor-wrong-question-controlled-live.md`。下一步先在该 hardening 提交上完成 clean preflight，再执行唯一 72-case Live；只有 `quality_gate_passed` 才进入产品验收。

> 2026-07-23 — Phase 6.9.7 Task 11 分支全量 checkpoint：Task 9 的 strict paired runner 和 Task 10 的 Docker allowlist 分别证明局部评测合同与部署边界，但不能自动证明 Task 1--8 的 candidate、owner/write fence、Trace、API/UI 和仓库其它包在同一分支 HEAD 上没有回归。Task 11 因此在真实模型前固定一次分支级完整检查，并重新生成 deterministic baseline 与 fresh strict Mock，避免把旧报告或 Mock 满分冒充 Live authority。
>
> 同一 `3e85fcc4` 起点上，Tutor/Organizer focused 为 `97/97`；全量为 Agent `543/543`、AI `194/194`、Types `42/42 + tsc --noEmit`、Server `227 suites passed / 3 skipped、2152 tests passed / 30 skipped`、Web `438/438`，相应 Agent/AI/Server/Web typecheck/lint/build 均通过。Organizer PostgreSQL E2E `10/10`，测试账号残留为 `0`；tracked Compose `config --quiet` 无输出通过。Types package 没有独立 ESLint script，因此只记录其权威门 tests + `tsc`，不虚构 Types lint 结论。
>
> 未修饰 deterministic baseline 保持 dataset SHA-256 `7ac2f4b5411831308d46a9df939907444285081897848aeb250944e43382207e`、`6/48`、critical `0`、Tutor/Organizer/combined semantic `0.4418666667/0.278125/0.3599958333`，provider/token/cost 全为 0。fresh Mock run `0c33c01f-802a-4f53-a6e6-538b7af9abc7` 为 `24/24` verified zero-call、`48/48` runtime、三项 semantic `1/1/1`、P95 `246/328/328/276ms`、usage `21948/5647`、estimated `0.099726 CNY`；`quality_gate_failed` 是只接受真实 `deepseek_network` 的 Live-only gate 预期结果。validator 通过后仅删除精确 Mock evidence，`.tmp/phase-6-9-7-tutor-organizer-*` 与 Live marker/evidence 匹配数均为 0。
>
> contract/security 与 operations/acceptance 两路独立只读终审最终均为 `APPROVED`，无未解决 Critical/Important；唯一初审问题是验收文档仍保留终审占位，补齐结果后已复核关闭。本任务没有读取根 `.env`/credential、调用 provider、开启生产 gate、启动产品 Docker/API/Web 或浏览器，也没有清理既有容器、镜像或卷。两个 gate 继续默认关闭。权威证据见 `docs/acceptance/phase-6-9-7-tutor-wrong-question-agents.md`；该 checkpoint 当时停在 Task 12 新授权门前；后续 V1 失败终态见当前摘要，必须由用户重新接受 DeepSeek 当前账号的数据保留/训练边界并明确授权唯一 branch controlled-Live。回顾时可以问：为什么 Task 9/10 之后仍需全量 checkpoint？为什么 Mock `48/48` 仍是 `quality_gate_failed`？为什么 Types 只记录 tests + `tsc`？为什么 Task 12 不能沿用旧授权？

> 2026-07-23 — Phase 6.9.7 Task 10 Docker runtime boundaries：Task 5/7 已让 Tutor 与 WrongQuestionOrganizer 具备 default-off 产品 composition，但容器部署边界仍不完整。Task 10 开始前，Compose 的 `server` 没有投影 Organizer gate、5000ms timeout 与独立 credential，Docker API 无法按设计启用；`admin` 仍通过 service `env_file` 接收整份根环境，又与“后台不持有 Agent 能力或模型凭据”的最小权限边界冲突。本任务只收口部署权限、默认值和回滚合同，不打开模型或执行产品验收。
>
> Compose 现在只向 `web` 投影 Tutor gate/3000ms/`TUTOR_AGENT_DEEPSEEK_API_KEY`，只向 `server` 投影 WrongQuestionOrganizer gate/5000ms/`WRONG_QUESTION_ORGANIZER_AGENT_DEEPSEEK_API_KEY`；`worker/admin` 两组能力均 absent，且 worker 模块继续强制 Organizer gate=false。Admin 的整份根 env 注入已移除，只保留后台 API 与学习端 URL。`docker/.env.example` 固定 `AI_PROVIDER_MODE=mock`、`AI_ENABLE_LIVE_CALLS=false`、全部当前 Agent gate=false、两个 timeout 与空 component credential。应用 config 同时拒绝 generic key 和另一组件 key，避免错误配置绕过 Compose allowlist。
>
> 新 boundary test 先以 `3/3` RED 精确暴露 Organizer server projection、tracked defaults 和 Admin env 注入缺口，GREEN 为 `3/3`；与既有 Compose readiness 合跑 `24/24`，Server config/Compose focused `29/29`，Tutor config `5/5`。tracked `docker/.env.example` 的 `docker compose ... config --quiet`、Server build 与 Web production build 均通过。`config --quiet` 只证明 Compose 可安全解析，不证明容器、API、浏览器或真实模型可用。
>
> 本任务没有读取根 `.env`/credential、调用 provider、启动或重建 Docker service、执行 API/浏览器、创建业务数据或清理既有容器/镜像/卷；两个生产 gate 仍默认关闭。权威证据见 `docs/acceptance/phase-6-9-7-runtime-boundaries.md`。Task 10 完成时的下一任务是 Task 11；该 checkpoint 现已完成，该 checkpoint 当时停在 Task 12 新授权门前；后续 V1 失败终态见当前摘要。回顾时可以问：为什么应用层已有 worker-off 仍要做 Compose allowlist？为什么 CLI `--env-file` 不等于 service `env_file`？为什么 `config --quiet` 通过仍不是 Docker/真实模型验收？

> 2026-07-23 — Phase 6.9.7 Task 9 Tutor / WrongQuestionOrganizer strict paired eval：Task 1 的 deterministic baseline 不能证明 Task 3--8 的 candidate guard 真正 zero-call，也不能约束失败样本、usage、价格或延迟不被报告层修饰。本任务复用冻结 dataset `phase-6.9-tutor-wrong-question-v1` / SHA-256 `7ac2f4b5411831308d46a9df939907444285081897848aeb250944e43382207e`，建立 72-case strict report：Tutor/Organizer 各 12 zero-call + 24 runtime，48 runtime 组成 24 次并行 pair，Organizer 固定 32 decision units，任何 throw/schema/usage/质量失败仍留在分母。
>
> 24 条 zero-call 现在实际进入 candidate/preflight guard，独立 executor counter 必须为 0，observed reason 从 observation/条件推导，不能回显 expected 自证。报告重算 prompt/schema/projection identity、两个 semantic score、critical/permission/mutation、安全 fallback、nearest-rank P95、逐 case/aggregate usage 与 CNY。Mock 两次均为 `24/24` verified zero-call、`48/48` strict runtime、Tutor/Organizer/combined semantic `1/1/1`，P95 为 Tutor `246ms`、Organizer `328ms`、paired `328ms`、Tutor orchestration `276ms`，synthetic usage `21948/5647`、estimated `0.099726 CNY`；`executorProvenance=mock_synthetic`，因此 Live-only production gate 按设计保持 `quality_gate_failed`，不是 Mock contract 失败。
>
> 独立终审发现两项 Important 并已修复：旧 `chatProduct*` 实际只测本地 `buildTutorStrategy()` + Tutor candidate，未经过真实 Router、`/api/chat`、RAG 或最终流式模型，现准确更名为 `tutorOrchestration*`，产品 P95 延后 Task 12 Docker/API/可见浏览器验收；公共 Live CLI 不再接受注入 executor，无网络测试改用显式 `synthetic_test` provenance，production gate 只接受 CLI 自建 executor 的 `deepseek_network`，合成 executor 即使满分也不能伪装真实 DeepSeek authority。Live 仍要求 fresh 授权、精确确认词、完整双组件 conjunction、其它 Agent gate 关闭与一次性 marker；hard-link evidence、filename/mode/scope/runId、敏感字段和 duplicate runId 均由 validator 约束。
>
> focused contract/runner/CLI/validator `14/14`、Agent full `543/543`、AI full `194/194`、Agent/AI typecheck/lint、两次 Mock CLI、两份 bundle validator 和 `git diff --check` 均通过。两份临时 Mock evidence 在校验后仅按精确路径删除，没有清空 `.tmp` 或触碰 Live marker。没有读取根 `.env`/key、调用 provider、启动 Docker/浏览器或修改业务数据；两个生产 gate 仍默认关闭。证据见 `docs/acceptance/phase-6-9-7-tutor-wrong-question-paired-eval.md`。该检查点当时的下一任务 Task 10 已完成；Task 11 后续已完成；该 checkpoint 当时停在 Task 12 新授权门前；后续 V1 失败终态见当前摘要。回顾时可以问：为什么 baseline 零调用不能替代 guard zero-call？为什么 Tutor orchestration P95 不是 Chat 产品 P95？为什么 synthetic Live provenance 永远不能通过生产 gate？

> 2026-07-23 — Phase 6.9.7 Task 8 WrongQuestionOrganizer strict API runtime 与 `/error-book` 来源状态：Task 7 已完成受治理 candidate、Trace admission 和本地授权 command，但产品还不能安全解释一次整理究竟来自语义候选、本地规则，还是失败后的安全回退。本任务在 shared types 中增加 request-level strict runtime，只允许 `source / disposition / degraded / 可选 traceId`；`hybrid_model` 必须同时满足 `candidate_applied + degraded=false + persisted traceId`，本地路径不能携带 traceId，未知字段以及 provider error、API key、token、费用、prompt、owner/question/deck 映射全部 fail-closed。
>
> single 在 organized item 外返回 runtime；batch 只在 request 顶层返回一次，逐题 item 不重复泄露模型细节。最多 12 条 candidate scope 的 runtime 对整次 batch 有权威性：后续 deterministic remainder 只合并 items，不能覆盖 hybrid 或 degraded 结论。新增回归证明 candidate 失败且仍有本地余项时保持 `local_deterministic / fallback_runtime_error / degraded=true`；candidate 已完成 admission 并进入授权 command、但并发用户 authority 已存在时，返回用户权威事实，同时保留已持久化 candidate provenance，不把模型结果解释为覆盖用户或必然新增写入。
>
> Web API 在成功 envelope 解包后继续用 shared Zod schema strict parse；single 顶层 `providerError`、batch runtime `apiKey` 与 batch item `ownerId` 都会被拒绝。`/error-book` 只在用户主动批量整理成功后显示来源，下一次请求开始先清空旧状态；“安全回退”优先于“语义整理”，正常 default-off 显示“本地规则”。状态条使用 `w-full / min-w-0 / flex-wrap / break-words` 覆盖 390/510/1440px 静态布局，不显示 Trace ID、token、费用或 provider 信息，也没有模型重试、自动删除/移动/改名或新 mutation。
>
> focused 为 Types `3/3`、Web API/view/page `10/10`、Server service/controller `24/24`；全量为 Types `42/42`（含 typecheck）、Web `438/438`、Server `226/226 suites / 2149 passed / 30 skipped`，Organizer PostgreSQL E2E `10/10`，Web/Server lint/build 与 `git diff --check` 均通过。没有读取根 `.env`/key、调用 provider、执行 controlled-Live、启动 Docker 产品或打开可见浏览器；两个生产 gate 仍默认关闭，容器/镜像/卷未清空。证据见 `docs/acceptance/phase-6-9-7-wrong-question-organizer-api-source.md`。该检查点当时的下一任务 Task 9 和后续 Task 10 均已完成；Task 11 后续已完成；该 checkpoint 当时停在 Task 12 新授权门前；后续 V1 失败终态见当前摘要。回顾时可以问：为什么 batch 只返回一个 request-level runtime？为什么安全回退优先？为什么静态响应式断言不能替代可见浏览器验收？

> 2026-07-23 — Phase 6.9.7 Task 7 WrongQuestionOrganizer default-off runtime、Trace 与 HTTP abort：Task 4 已有 package candidate，Task 6 已隔离 owner snapshot 与 model-free command，但 NestJS 产品此前仍无法受控调用模型。本任务新增 server-only composition：固定 `deepseek-v4-pro`、non-thinking JSON、精确 `https://api.deepseek.com/v1`、5000ms、no tools/retry，只读取独立 `WRONG_QUESTION_ORGANIZER_AGENT_DEEPSEEK_API_KEY`。只有全局 Live 双开关、组件 gate、精确 URL、独立 credential 与已知价格同时成立才创建 executor；`SERVER_ROLE=worker` 强制关闭，通用 `DEEPSEEK_API_KEY` 不可替代。冻结请求预算为 `1 call / 3500 input / 800 output`，精确 CNY cap 为 `0.016`。
>
> single 请求最多一次 candidate；batch 先在最多 50 条未组织错题中挑选不超过 12 个低置信安全目标共享一次 candidate，其余按每 12 条执行本地 deterministic command。reservation 在 dispatch 前完成，candidate 后重新验证 owner fingerprint；stale、existing/high-confidence、unsafe、abort、配置/预算/usage/schema/Trace 失败都回到本地决策，不重复调用 provider。模型只给受限语义结果，最终 SubjectGroup/Deck/Item 写入仍必须经过 Task 6 的本地 merger、深冻结 command、owner advisory lock 与事务内第三 fence，provider 不进入任何事务或锁。
>
> 模型结果影响写入前，服务先以稳定 runId 原子落库 `wrong_question_organizer_command_pending` admission Trace；成功后才允许 candidate 进入本地 command，完成后用同一 runId 全量替换为最终 command step。admission 失败时模型结果不得写入；final Trace 事务失败时 PostgreSQL 回滚替换并保留 pending，不回滚已经授权完成的本地写入；跨 owner 相同 runId 无法替换。HTTP request `aborted` 信号贯穿 snapshot/candidate/command preflight，listener 在请求结束后清理；事务开始后只完成不可中断的最小本地 command。Trace 仅记录固定 disposition、usage 与 CNY，顶层 USD cost 保持 unknown/0，不保存题目、prompt、provider output、key、URL 或 raw error。
>
> focused 单测 `126/126`、真实 PostgreSQL AgentTrace/Organizer E2E `16/16`、Server full `226/226 suites / 2146 passed / 30 skipped`、Agent `529/529`、AI `194/194`、Agent/AI typecheck/lint、Server lint/build 与 diff 门均通过；Server lint 首轮发现的测试 spec 未使用 fixture、无必要 `async` 和未类型化 Jest call 已收口，受影响 Service spec `19/19` 复验通过。两路独立代码/测试复审无 Critical/Important。未读取根 `.env`/key、未调用真实 provider、未执行 controlled-Live、Docker 产品或可见浏览器验收；production gate 仍默认关闭，Docker 容器/镜像/卷未清空。证据见 `docs/acceptance/phase-6-9-7-wrong-question-organizer-runtime.md`。Task 7 完成当时的下一任务 Task 8 以及后续 Task 9/10 均已完成；Task 11 后续已完成；该 checkpoint 当时停在 Task 12 新授权门前；后续 V1 失败终态见当前摘要。回顾时可以问：为什么 Trace admission 是模型影响写入的前置条件？为什么 final Trace 失败保留 pending 而不回滚业务写入？为什么 batch 只允许一次 12-item candidate？

> 2026-07-23 — Phase 6.9.7 Task 6 WrongQuestionOrganizer owner snapshot 与授权写命令：Task 4 已能生成受治理语义建议，但 Organizer 最终会写 subject group、deck 和 item；若不隔离模型决策与数据库写入，候选运行期间发生的错题编辑、用户移动/重命名或并发整理可能被旧结果覆盖。本任务先完成 model-free 安全边界，不接 runtime/provider：最多 12 个目标在单个 `REPEATABLE READ + READ ONLY` 事务中形成深冻结 owner snapshot，raw userId 由 JWT secret 派生的域分离 HMAC 代替，完整 fingerprint 绑定目标错题、现有 item、最多 20 个 group/deck、名称/`nameLocked`/版本/关键词与 policy/projection version；missing 与 cross-owner 统一为 `404 / WRONG_QUESTION_NOT_FOUND`。
>
> 当前 deterministic decision 前后分别在事务外重建 fingerprint；随后本地构建不含 prompt/provider/key/userId 的 `wrong-question-organizer-command-v1`。短 `Serializable` 写事务按 owner HMAC 取得 advisory xact lock，并做第三次 revalidation；stale 不写入，已存在用户 item 时返回当前权威结果。rename/move/remove 也取得同一 owner lock，force path 先删除其它 relation 再按 `userId + wrongQuestionId` 唯一键 upsert。P2034/40001 只重试本地事务且最多 3 次，不重算或重调 provider；非 force batch 遇到任一用户 authority 时整批 fail-closed，留给 Task 7 用 fresh snapshot 重编排。
>
> 独立代码审查发现旧同名 deck 若落在 100 条 write preflight 窗口外可能被重复创建。最终实现先做不受窗口限制的精确名称查询，再扫描最近 100 个 canonical variant；若窗口溢出且无法安全证明不存在旧变体，则返回 stale，不冒险创建重复专题。focused `23/23`、Server full `2122 passed / 30 skipped`、真实 PostgreSQL Organizer E2E `9/9`、Database `7/7`、Server lint/build 和 `git diff --check` 均通过；E2E 覆盖同主题并发、统一 404、force 唯一、并发 rename/move 用户权威，测试数据精确清理。最终代码/安全与文档/验收两路独立复审均 PASS，无 Critical/Important。没有读取根 `.env`/key、调用 provider 或执行 controlled-Live/浏览器验收，Docker 卷保持原样。证据见 `docs/acceptance/phase-6-9-7-wrong-question-organizer-owner-command.md`。该检查点的下一任务 Task 7 现已完成，见本文顶部。回顾时可以问：三次 fence 分别防什么？为什么模型结果必须先变成 model-free command？为什么 canonical scan 溢出要 stale 而不能继续创建？

> 2026-07-23 — Phase 6.9.7 Task 5 Tutor Web server-only runtime：Task 3 的 package candidate 已能受限判断“怎么教”，但产品 `/api/chat` 仍没有 Tutor 专属 gate、executor、独立预算或模型 provenance。Task 5 因此先完成 default-off 静态/Mock composition，不打开真实 provider：固定 `deepseek-v4-pro`、`https://api.deepseek.com/v1`、non-thinking JSON、3000ms、无 tools/retry，并只读取 `TUTOR_AGENT_DEEPSEEK_API_KEY`。完整 Live conjunction 任一缺失、timeout/价格/依赖异常都返回 disabled bundle，绝不借用通用或其它 Agent credential。
>
> live access 与 conversation-context prepare 成功后，Route 只注册 Tutor bundle factory，再先取得 final canonical Router route；非 Tutor route 不创建 Tutor bundle/runtime，也不读取 Tutor component credential。Live executor/runtime 仅在 candidate 真正调用 `invokeStructured` 时以单请求 Promise memo 惰性构造；明确教学指令、不安全输入、abort、预算/配置失败保持 executor 前零调用。只有 implicit/contextual/conflicting Tutor intent 才可使用独立 `1 call / 1200 input / 300 output` 预算与 `0.006 CNY` cap；runtime/schema/usage/timeout/abort 失败仍保留原 Tutor route 和 deterministic strategy，不影响现有 RAG、Verifier、413、登录与最终 Chat streaming。该预算与 Router -> Verifier 共享预算隔离。
>
> 新增安全 Tutor observation/header/Trace：只记录固定 disposition/reason、正 usage、pricingKnown、CNY 与版本，不记录题目、active context、prompt、provider output、credential、URL、raw error 或 stack；Tutor CNY 不混入 AgentTrace 顶层 USD cost。Compose 仅向 `web` 注入 Tutor gate/timeout/key，server/worker/admin 不接收，默认 gate=false/key 空。最终 focused `27/27`、Web full `432/432`、Agent `529/529 / 5479 expect()`、AI `194/194 / 1020 expect()`、Web lint/build、Compose tracked-example `config --quiet`、diff 与两路独立复审均通过。未读取根 `.env`、调用 provider、启动 Docker/浏览器或创建业务数据。证据见 `docs/acceptance/phase-6-9-7-tutor-web-runtime.md`。该检查点当时的下一任务是 Task 6，后续 Task 6--10 均已完成；Task 11 后续已完成；该 checkpoint 当时停在 Task 12 新授权门前；后续 V1 失败终态见当前摘要。回顾时可以问：为什么 Tutor factory 必须等到 final route 后才执行、Live executor 又必须等到真实 invocation 才构造？为什么 Tutor 预算不能复用 Router/Verifier 预算？为什么静态接入完成仍不等于 Live 可用性验收？

> 2026-07-23 — Phase 6.9.7 Task 4 WrongQuestionOrganizer governed model candidate：既有确定性整理对知识点、分类和错因等结构化字段稳定，但无法可靠理解缺少 subject、同义专题复用或专业课术语；本任务因此只把低置信语义裁决交给受限 candidate，不改变 organizer 产品写入权威。先新增 candidate 测试并确认模块缺失时 RED 为 `0 pass / 1 fail / 1 module-not-found error`，随后实现最多 12 道错题、20 个已有专题和一次 `1 call / 3500 input / 800 output` 的 package runtime。
>
> 已有 item、精确结构化专题、非空 subject 且 deterministic confidence `>=0.72` 的知识点或 category+errorType、owner 不合格、snapshot stale、abort、预算不足、无语义正文与完整字段安全失败都在 runtime 前零调用。模型只可返回 question/deck ordinal、固定 subject/action/confidence/evidence 或安全 topic label；partial/重复/越界、跨 subject deck、自由写命令、非法 label、timeout、不可验证 usage 和 runtime throw 均整批 deterministic fallback，且不重试。
>
> 本地 merger 使用 candidate-only authority map 重建真实 question/deck ID、原 subject、用户锁定 deck 名称、reason/description、数值 confidence、signals 与全部写权限；模型不拥有 userId、数据库 command，也不能修改 WrongQuestion、Card、ReviewLog、ReviewTask 或 ReviewPreference。用户锁定名称在最终 `deckName` 原样保留，说明文本只展示最多 80 个 Unicode scalar，避免超长权威文本放大。
>
> 最终 focused + contract/projection/production companion 为 `24/24 / 220 expect()`，冻结 24 条 Organizer runtime fixture 均恰好调用一次并 `candidate_applied`；Agent full `529/529 / 5479 expect()`，AI full `194/194 / 1020 expect()`，Agent/AI typecheck 与 lint、Native Node ESM export、`git diff --check` 均通过。两路独立只读复审无 Critical/Important；未读取 `.env`/key、未调用真实 provider、启动 Docker/浏览器或修改业务数据。证据见 `docs/acceptance/phase-6-9-7-wrong-question-organizer-model-candidate.md`。Task 4 仍只是 package candidate；owner snapshot/写 command 与生产 composition 分属 Task 6/7。该检查点当时下一任务是 Task 5，后续已完成并见本文顶部。回顾时可以问：为什么 partial batch 必须整批回退？为什么 locked deck 可被选择却不能由模型改名？

> 2026-07-23 — Phase 6.9.7 Task 3 Tutor governed model candidate：先加入 `tutor-model-candidate.test.ts`，确认 candidate 模块缺失时 RED 为 `0 pass / 1 fail / 1 module-not-found error`。随后把 Tutor 强信号检测提取为 `detectTutorSignals()` 并由现有 deterministic policy 与 candidate 共用；五类明确教学指令、非 Tutor route、空输入、不安全/hostile 字段、abort 与预算不足保持 runtime 前零调用，只有隐含、上下文、真正冲突或带 active context 的 `general_follow_up` 才进入一次受治理调用。
>
> 新增 `ModelAgentTask=tutor_strategy` 与 `1 call / 1200 input / 300 output` 预算。candidate 先做不可变 admission preview，共享 runtime 对 caller snapshot 做唯一权威 reservation；结果继续经过 runtime sanitizer、strict schema、intent/evidence 动态关联和本地 depth compatibility。merger 重新构建 guiding/final/context booleans、有序 answer structure、固定 prompt/debug，`socratic_hint` 不含 final answer，`answer_direct` 既不能由模型输出，也不能通过公共 merger 改写。pre/post runtime abort、timeout、畸形 usage、schema/runtime throw 都回退原 deterministic strategy，observation 不含用户文本、active context、prompt 或 credential。
>
> RED/GREEN 后 focused `16/16 / 169 expect()`，其中冻结 12 条 zero-call 全部 runtime=0、24 条 runtime 全部恰好调用一次并命中 canonical local strategy；Agent full `518/518 / 5306 expect()`，AI full `193/193 / 1018 expect()`，Agent/AI typecheck/lint exit 0。两路独立复审最终无 Critical/Important；预算复核确认传 caller snapshot 是为了避免 runtime 双预留。仅使用 Mock/注入式无网络 runtime，没有读取 `.env`/key、调用真实 provider、启动 Docker/浏览器或修改业务数据。证据见 `docs/acceptance/phase-6-9-7-tutor-model-candidate.md`。Task 3 只是 package candidate，不代表 Chat 产品已启用模型；下一任务是 Task 4 WrongQuestionOrganizer candidate 与本地 merger。回顾时可以问：为什么明确教学指令 zero-call？为什么 `answer_direct` 需要 schema 与 merger 双重禁止？为什么 package candidate 完成仍不能声称产品已可用？

> 2026-07-23 — Phase 6.9.7 Task 2 strict contract / full-field safety projection：先加入 Tutor contract/projection 与 WrongQuestionOrganizer contract/projection 四份测试，确认生产文件缺失时 RED 为 `0 pass / 4 fail / 4 module-not-found errors`。随后实现两套 strict Zod schema 与独立动态关联 validator：Tutor 模型不能选择 `answer_direct`；Organizer 必须为每个投影 question 恰好返回一次决定，只能引用受限 question/deck ordinal、subject/action/confidence/evidence enum 与安全 topic label，重复/越界、跨 subject、部分 batch、本地 subject 权威冲突和危险 label 全批拒绝。
>
> 两条 projection 都先做普通自有属性 descriptor clone，再完整扫描、合并 safety metadata、裁剪、分配 ordinal、重验输入预算并深冻结。Tutor 只暴露有界 latest/context、deterministic intent/depth 和固定 ambiguity codes；Organizer 扫描 subject/category/knowledge point/error type/question/analysis/answer/userNote 与全部 deck name/keyword，但只暴露 `q0..q11` / `d0..d19`、有界摘要和安全结构字段。公开 projection 不含 UUID/owner/图片 URL/完整 answer/userNote/写能力；真实 ID map 只留在 candidate/merger 内部。
>
> 独立质量复审发现既有 Knowledge projection 在 Zod 上限前可能按超大稀疏数组工作，且空 summary 可形成无证据投影。统一有界 clone 后固定 `array<=256 / keys<=512 / nodes<=4096 / depth<=8`，Knowledge 改为至少一条 summary，并补超大数组、空 summary 与末尾高位 surrogate 回归。Task 2 focused `19/19`；含 Knowledge safety 为 `25/25 / 103 expect()`；Agent full `502/502 / 5126 expect()`，typecheck/lint exit 0。两路独立复审最终无 Critical/Important。没有读取 `.env`/key、创建 executor、调用 provider、启动 Docker/浏览器或修改业务数据。证据见 `docs/acceptance/phase-6-9-7-tutor-wrong-question-contracts.md`；该检查点当时的下一任务是 Task 3 Tutor candidate eligibility 与本地权威 merger，现已完成。回顾时可以问：为什么 schema strict 之后仍需要动态 ordinal/subject validator？为什么完整 answer 不投影却仍必须扫描？

> 2026-07-23 — Phase 6.9.7 Task 1 deterministic baseline：先新增 cases/metrics/baseline 三份测试并确认 RED 为 `0 pass / 3 fail / 3 module-not-found errors`，随后实现纯合成 dataset、可复算专项 metrics、未修饰 baseline runner、稳定 JSON CLI 与 package script。dataset `phase-6.9-tutor-wrong-question-v1` / SHA-256 `7ac2f4b5411831308d46a9df939907444285081897848aeb250944e43382207e` 固定为 72 cases：Tutor/Organizer 各 12 zero-call + 24 runtime，24 paired indexes，Organizer index `0..19` 各 1 条、`20..23` 各 3 条，共 32 decision units。
>
> 直接调用当前 `buildTutorStrategy()` / `organizeWrongQuestion()` 得到未修饰结果：完整命中 `6/48`、失败 `42/48`、critical `0`。Tutor intent/depth/context/pedagogy 为 `0.1973333333/0.7916666667/1/0.25`，semantic `0.4418666667`；Organizer subject/action/reuse/topic/evidence 为 `0.25/0.8125/0/0/0`，semantic `0.278125`；combined `0.3599958333`。provider invocation、input/output token、estimated CNY 均为 0。Organizer action 的 `0.8125` 主要来自统一 create，不代表 topic 或 semantic reuse 正确。
>
> 验证为 focused `14/14`（`514 expect()`）、Agent full `483/483`（`5035 expect()`）、typecheck/lint exit 0，baseline CLI 连续两次 stdout 字节一致。全程未读取 `.env`/key、未创建 executor、未调用 provider、未启动 Docker/浏览器或修改业务数据。24 条 zero-call 本任务只冻结，不能把 baseline 的 0 provider invocation 冒充未来 Task 9 的 guard counter。权威证据见 `docs/acceptance/phase-6-9-7-tutor-wrong-question-baseline.md`；该检查点当时的下一任务是 Task 2 strict output contract 与完整字段安全投影，现已完成。回顾时可以问：为什么 `6/48` 不等于规则完全不可用？为什么 action `0.8125` 仍不能说明 Organizer 有语义能力？

> 2026-07-23 — Phase 6.9.7 Task 0 专项设计与实施计划：从已推送且与 `origin/main` 一致的 `main@2af7e510` 创建普通分支 `codex/phase-6-9-7-tutor-wrong-question-agents`，CodeGraph 更新/项目同步成功。完成 Tutor policy、Chat 调用链、WrongQuestionOrganizer policy/API/owner-scoped 写路径、既有 Router/Verifier、Review/Planner、Knowledge 混合模型模板、评测工具和核心文档冲突盘点；未创建 worktree，未读取 `.env`/key，未调用 provider 或修改业务数据。
>
> 设计决定：Tutor 是最终 Chat 前的教学策略节点，不生成最终回答。明确的 direct/hint/step/concept/explain 指令继续 deterministic zero-call，只有隐含、上下文指代、冲突信号或 general follow-up 学习意图进入受限 DeepSeek V4 Pro candidate；`answer_direct` 不允许由歧义模型输出。本地继续重建 intent/depth/answerStructure/prompt。WrongQuestionOrganizer 的已有 item、高置信知识点/分类、精确 deck 与不安全输入 zero-call；低置信、安全、未组织错题在单次请求最多 12 条共享一次模型调用。模型只返回 question/deck ordinal、固定 subject enum 或有界 topic label；真实 ID、JWT/owner、用户锁定名称、reason/description、Trace admission 和组织层写事务保持本地权威。
>
> 固定计划：dataset `phase-6.9-tutor-wrong-question-v1` 共 72 cases，Tutor/Organizer 各 `12 zero-call + 24 runtime`；模型 profile 为 V4 Pro non-thinking JSON，两个独立 default-off gate 与两条 component-specific credential 入口，Tutor/Organizer timeout 分别为 `3000/5000ms`。Tutor reservation `1/1200/300`、0.006 CNY cap；Organizer `1/3500/800`、0.016 CNY cap；24-pair 唯一 Live 总 cap 0.55 CNY。独立 Reader Testing 补齐了子指标标签/分母/聚合、informational combined score、候选与产品 P95 计时窗口、`https://api.deepseek.com/v1`、`SERVER_ROLE=worker` 强制关闭、Organizer 两阶段 Trace admission 和批量 partial-output 全批回退边界；baseline 具体数值只由 Task 1 实际运行冻结。Task 0 是设计 checkpoint，Task 1--13 是 13 个原子执行/验收任务，一任务一提交。权威设计/计划分别为 `docs/superpowers/specs/phase-6-9-7-tutor-wrong-question-agents-design.md` 与 `docs/superpowers/plans/phase-6-9-7-tutor-wrong-question-agents.md`。下一步 Task 1 冻结未修饰 deterministic baseline；回顾时可以问：为什么 Tutor 和 Organizer 不能照搬同一种模型接入？为什么 Organizer Trace 失败时模型建议不能影响写入？

> 2026-07-22 — Phase 6.9.6 Task 13 main 收尾完成：分支文档提交 `33604040` 已通过 `--no-ff` 合并为 main `f31335c6`。main focused 验收为 Agent `118/118`、Types `1/1`、Server `50/50`、Web `7/7`，相应 typecheck/lint/build 全部通过。当前源码重新构建的 server/worker/web 容器健康；Compose BuildKit 在进入业务与数据步骤前两次因宿主 `x-docker-expose-session-sharedkey contains value with non-printable ASCII characters` 失败，改用 `DOCKER_BUILDKIT=0` 的同一 Dockerfile 构建并以 `--no-build --force-recreate` 启动成功，未改变验收代码或数据卷。
>
> main 可见 `/knowledge` default-off 回放使用一个独立合成账号，完成注册、TXT 上传、Qwen `text-embedding-v4` / 1536 处理、资料列表、混合检索和建议读取；HTTP 为 suggestions `200`、upload `201`、process `201`、search `201`。移动端 `390x844` 的 html/body 均为 `scrollWidth=clientWidth=390`，桌面 `1440x900` 为 `1430=1430`，两者均无横向溢出；页面显示“本地规则建议”、不显示“语义建议”，自动合并/删除/替换/重命名/分类控件为 0。控制台仅有登录前 refresh `401` 与普通账号访问 admin-only worker observability 的预期 `403`。main 移动/桌面截图 SHA-256 分别为 `626b8da913d3f581e2f4438d11bbcad7b7cad6cfbab6b337cb4e56479e9e60d9` / `b46fb4c40b913053813b92fed9b8b91e632af62b9a18d3871cde0ffc80f65d27`。
>
> 清理先通过 owner-scoped 正式删除 API 删除唯一 Document/Chunk 与精确 MinIO object，再删除唯一合成用户并级联清理 refresh token；User/Document/Chunk/ACCOUNT BackgroundJob/Trace/TraceStep/Session/RefreshToken 与匹配 object residue 全为 0。测试浏览器 cookie/localStorage/sessionStorage/IndexedDB/cache 全为 0，窗口保留在登录页。server 为 `mock / live=false / dedup=false / organizer=false / Review=false / Planner=false / Knowledge credential absent`；worker 不含 Knowledge gate/credential。`docker_pgdata`、`docker_miniodata` 均保留，没有 prune、`down -v`、reset、flush 或 wipe。最终 main 已推送并确认 `origin/main...HEAD = 0 0`。Phase 6.9.6 至此完成；下一阶段是 Phase 6.9.7，不提前进入 Phase 6.10 或博客收尾。回顾时可以问：为什么 main 不重跑 controlled-Live？default-off 回放证明什么？BuildKit 宿主会话错误为什么不影响业务验收 authority？

> 2026-07-22 — Phase 6.9.6 Task 13 R7 Docker/API 分支验收：在包含 PostgreSQL `ntile(?::integer)` 修复的 `1ce77ff` 镜像上，独立 run `38748577-f250-4a7a-ab17-8fd14a63b2a3` 完成 Dedup-only、Organizer-only、双开关、强制 provider 失败与 default-off 五种模式。四个实际模型结果均为 `candidate_applied`；总 usage `3770/446`，估算费用 `0.013986 CNY`。exact hash、credential、prompt injection、unsafe metadata 和跨账号 target 均在 provider 前零调用；API/Trace parity、worker credential/gate isolation、读取兼容性和只读 fingerprint 均通过。R7 evidence / marker SHA-256 为 `ad8b242562d73d2a697648e66cc9c6ac755d1ae7db00149e3a631f1191016468` / `0c62a62f210aedcf7348478ed6d60da565d5b89316e67da0b10370728d8bc9db`，不得重跑、删除、覆盖或与 V2 Live 拼接。
>
> R7 清理只删除本轮 2 个 synthetic owner、7 份 synthetic Document 和 2 个匹配 MinIO object；User/Document/Chunk/Object/BackgroundJob/Trace/TraceStep/Session/RefreshToken residue 全部为 0。API 已恢复 `AI_PROVIDER_MODE=mock`、live=false、Dedup=false、Organizer=false、Knowledge credential absent；worker 不含 Knowledge key/gate。`docker_pgdata` 与 `docker_miniodata` 保留，没有 prune、`down -v`、database/volume reset、Redis flush 或 MinIO wipe。R1--R6 仍是不可改写的独立历史，R7 成功不覆盖早期失败终态。两位独立复审均 APPROVED，无 Critical/Important。
>
> 2026-07-22 — Phase 6.9.6 Task 13 可见浏览器分支验收：发现 Docker `web` 仍是旧镜像，API 已返回来源状态但页面缺少新 badge；仅从 pinned HEAD 重建并替换 web 容器后恢复，不改 server authority 或数据卷。浏览器 run `012bc3ce-486e-4dce-be32-d29c246f47cd` 在真实 Docker 路径完成注册、TXT 上传、处理、列表和 Qwen 混合检索；default-off 显示“本地规则建议”，建议面板自动执行按钮为 0。semantic/degraded/error 状态使用绑定不可变 R7 response authority 的 strict UI replay，浏览器阶段新增模型调用为 0，不构成第二份语义质量 authority。
>
> 浏览器覆盖 1440、510、390px，390px 建议面板 `scrollWidth=clientWidth=357`，无横向溢出；local/semantic/degraded/empty/error、上传/处理/检索均通过。evidence / marker SHA-256 为 `5a9a4cba005ba3ec10e031ed17e5f41981a685dc62c6672695db41cabc024299` / `6a75430f8aebfa8c7278c641504ff5fa5d6d0502d103088c98cb3927846cfe79`。专用合成账号及 User/Document/Chunk/Job/Trace/Session residue、匹配 MinIO object、cookie/localStorage/sessionStorage/IndexedDB/cache 均为 0；两个独立复审无 Critical/Important。该分支浏览器 checkpoint 当时只剩 main default-off 回放与推送；其后已按本文顶部 main 收尾记录完成，且没有重跑 V2 controlled-Live 或 R7。

> 2026-07-22 — Phase 6.9.6 Task 13 V2 Live authority 与产品 shortlist 修复：唯一 V2 controlled-Live run `10ae2f36-69f6-422c-a99f-6bf6b3aeb226` 已以 `quality_gate_passed` 封存，72 cases、`24/24` zero-call、`48/48` runtime、semantic `0.9875`、费用 `0.117498 CNY`；evidence / marker SHA-256 分别为 `c0a6d06a94438dddedb24b78e271eb7b4df1bd6089949bd0b7692d8570c707ff` / `0940cee101cc219b8a691e8eba6ddc9dc33197e2eec20048ac46d269ef8d7ac5`，不得重跑、删除、覆盖或改写。
>
> Docker/API 产品验收 R1--R6 均保留独立失败终态。R1/R2 在 provider 前分别因外层 Docker 命令和 Knowledge-only Live 启动失败关闭；后者定位并修复 ConversationSummary 错误借用通用 DeepSeek credential。R3 未保存首个 endpoint runtime，因此只可证明 `unknown_zero_or_one`；R4 证明旧夹具因 exact hash 正确触发 `exact_hash_only` 零调用。R5 从 Git Bash 启动时缺少 loopback `NO_PROXY`，宿主 health probe 被错误送到 `127.0.0.1:7897`，在 fixture/provider 前以 `server_health_timeout` 关闭；R6 使用隔离语义夹具后仍返回 `no_semantic_pair / attempted=false / 0 token / 0 CNY`，但上传、处理、列表、检索、Qwen provenance/safety 和原始 cosine `0.957066` 均通过。
>
> R6 根因是 Prisma 将 `ntile(${6})` 的参数绑定为 PostgreSQL `bigint`，而 PostgreSQL 只提供 `ntile(integer)`；真实 source 查询抛出 `P2010 / SQLSTATE 42883` 后按设计 fail-closed 为空 shortlist。TDD 先新增 SQL-shape 断言得到 `11 pass / 1 fail`，再将参数改为 `ntile(${6}::integer)` 后 `12/12`；相关 Knowledge Server `32/32`、Server build、focused ESLint 与 diff gate 通过。真实 PostgreSQL 合成诊断在修复前为 source query `P2010/42883 + selected=0`，修复后同一 Qwen `text-embedding-v4 / 1536`、low/safe 数据为查询 `2 rows + 1 row`、selected chunks `2`、high pair `1`、score `0.957065639321`。每轮 synthetic User/Document/Chunk/MinIO/Trace/Job 均精确清理为 0；未执行 volume/database reset、Redis flush、MinIO wipe 或 Docker prune，当前 server 已恢复 `mock / live=false / dedup=false / organizer=false / credential absent`。
>
> 边界：上述修复只恢复既定 owner-scoped shortlist 的可执行性，不改变阈值、top-3 mean、provenance/safety/exact-hash guard、权限、预算、价格、只读 merger 或默认 gate。该修复 checkpoint 当时尚未完成 Phase 6.9.6，后续 R7、浏览器与 main 结果见本文更靠前的条目。回顾时可以问：为什么 Mock 能通过但真实 PostgreSQL 的 `ntile` 仍会失败？为什么 R6 的 raw cosine 高于阈值仍然是 provider 0-call？

> 2026-07-22 — Phase 6.9.6 V2 authorized-Live 零调用 preflight：用户已接受 DeepSeek 当前账号的数据保留/训练边界并授权唯一一次 V2 branch controlled-Live。执行前发现 standalone eval CLI 仍读取通用 `DEEPSEEK_API_KEY`，而 Task 11 已规定 Knowledge 必须通过独立 `KNOWLEDGE_AGENT_DEEPSEEK_API_KEY` 接入；若直接运行会绕过 server-only credential isolation。
>
> TDD 修复：新增 generic-only 拒绝测试后先得到 `7 pass / 2 fail`，证明旧 CLI 会错误接受通用 key，且新的 dedicated-only fixture 无法运行；CLI 改为只读取 `KNOWLEDGE_AGENT_DEEPSEEK_API_KEY` 后 focused `9/9`、Agent 全量 `469/469`、typecheck/lint 与 `git diff --check` 均通过。generic-only 现在固定在 marker/executor 前返回 `live_configuration_invalid`，provider invocation 为 0，V2 marker/evidence 仍不存在。
>
> 边界：本修复只对齐凭据入口，不修改 `knowledge-agents-v2` prompt、72-case dataset、schema、预算、价格、timeout、质量阈值、默认 gate、marker 或 evidence contract；根 `.env` 与 V1/V2 既有 evidence 均未改写。下一步沿用本次已取得的唯一 V2 授权，以进程级环境提供 dedicated credential 后执行一次 Live；marker 一旦创建即不得重跑。

> 2026-07-22 — Phase 6.9.6 V2 R4 静态/Mock checkpoint：Knowledge focused `117/117`；Agent 全量命令、typecheck 与 lint 均 exit `0`；Types `39/39` + typecheck、Server Knowledge `50/50` + build、Web Knowledge `7/7` + lint 均通过。V2 Mock run `05516dae-e8d3-42df-ba6b-3ffd41e99db6` 使用独立 evidence `.tmp/phase-6-9-6-knowledge-agent-branch-mock-v2.json`，覆盖 72 cases、`24/24` verified zero-call 与 `48/48` runtime；Dedup macro-F1/revision recall 和 Organizer subject/tag/collection 五项语义指标均为 `1`。
>
> 量化证据：P95 为 Dedup `286ms` / Organizer `348ms` / endpoint `348ms`，usage `14472/4185`，Mock estimated cost `0.068526 CNY`；strict validator 返回 `ok=true / evidenceCount=3`，V2 Mock SHA-256 为 `2dfa326018bba9912b8e8faf35b7fb9f2c41b33d7e655e4e5e8c8472ecc23958`。Mock report 仍为 `quality_gate_failed`，因为 production gate 固定只接受满足全部门槛的 DeepSeek V4 Pro Live；这不是 Mock contract 失败，也不是 V2 真实语义质量证明。
>
> 不可变与运行边界：V1 Live evidence/marker SHA-256 仍为 `9d56d4b474065b7476feb16a0509b755c032c6a346d63a894fe91b4b18f74923` / `228016fcd52ca2dc411e2d9e96c12d18d01aa63e87a8c8ef1605c1e973b0b246`。V2 Live evidence 与一次性 marker 均不存在；根环境没有显式设置两个 Knowledge gate，配置继续 default-off。只读核对确认既有 Docker 服务与 `docker_pgdata` / `docker_miniodata` 卷仍在；本轮没有调用 provider、执行产品 Docker/API/浏览器验收、启动或停止服务、创建业务数据，亦没有任何 prune/reset/flush/wipe。
>
> R4 到此停止。下一步必须由用户接受当前 provider retention/训练边界并使用新授权变量明确批准唯一一次 V2 branch controlled-Live；失败必须封存且不得重跑，只有全部固定门通过后才可进入 Docker API、可见 `/knowledge`、精确清理、main 回放与远程推送。回顾时可以问：V2 R4 修复了哪些语义缺口？为什么 Mock 五项全 1 仍不能打开生产 gate？V1 与 V2 的 evidence/marker 为什么必须完全隔离？

> 2026-07-22 — Phase 6.9.6 V2 R3 evidence/one-shot：current report identity 升级为 `knowledge-agents-v2`，但 validator 继续严格接受没有新字段的历史 V1 report。V2 runtime entry 只新增 `rawSchemaValid: boolean` 与枚举 `candidateDisposition`，zero-call 固定为 `null/null`；因此下一次若失败，可以区分原始 schema、动态 candidate 拒绝与已应用语义，同时仍不保存 prompt、provider response、raw error 或自由文本。
>
> 一次性边界：旧 `PHASE_6_9_6_CONTROLLED_LIVE_APPROVED` 不再授权 V2，必须使用新的 `PHASE_6_9_6_V2_CONTROLLED_LIVE_APPROVED=true`。V2 Mock/Live 使用独立文件名和 `.tmp/phase-6-9-6-knowledge-agents-v2-controlled-live.marker`；测试证明现有 V1 marker 不阻塞一次新授权的 V2，而第二次 V2 被 `live_already_attempted` 拒绝。focused CLI/contract/runner `17/17`、Agent typecheck/lint exit `0`，当前 V1 evidence bundle 仍为 `ok=true / evidenceCount=2`。
>
> V1 live evidence SHA-256 为 `9d56d4b474065b7476feb16a0509b755c032c6a346d63a894fe91b4b18f74923`，V1 marker SHA-256 为 `228016fcd52ca2dc411e2d9e96c12d18d01aa63e87a8c8ef1605c1e973b0b246`；两者未被修改。下一步是 R4 全量静态/Mock checkpoint，不会调用 provider。回顾时可以问：为什么新版本必须使用新授权变量和新 marker？为什么 V2 诊断只记录布尔/枚举而不记录 provider 原文？

> 2026-07-22 — Phase 6.9.6 V2 R2 Organizer 精度：V1 的 collection pair 已全对，实际缺口是 subject taxonomy 与 raw extra-topic scoring。V2 prompt 现在明确 math/english/politics/computer/major/other 边界，要求每份资料只给一个完整、来源可证的 topic phrase，并禁止“核心概念/复习重点/补充/课程/资料”等泛标签冒充 topic。
>
> 混合权威：模型仍负责语义分类和集合关系；本地只在安全 projection 中出现高置信学科词时纠正过宽 subject，不接收模型生成的 ID、写操作或权限。评测 topic 现在与产品 merger 一致，只计 subject/resource 之后实际会应用的首个 topic label；不会掩盖 subject、collection、schema 或安全错误。RED 复现 prompt 缺失、四类 subject 偏差和 raw extras 导致的 `semanticScore=0.95`，GREEN 为相关 `20/20`、Agent typecheck/lint exit `0`。
>
> 下一步 R3 将把新运行标识为 `knowledge-agents-v2`、增加有界失败诊断并使用独立 V2 一次性 marker；V1 evidence/marker 继续不可变。回顾时可以问：为什么 topic 评测必须对齐实际 merger，而不能惩罚产品不会应用的第二标签？为什么本地只能纠正高置信学科事实而不能取代模型的全部语义判断？

> 2026-07-22 — Phase 6.9.6 controlled-Live V1 verdict 与 V2 R1：唯一 V1 run `35cef6a3-97ee-4cb3-accb-ff8fa6bd59cd` 完成 `72` cases、`24/24` zero-call、`48/48` verified usage，安全失败为 `0`，endpoint P95 `2068.2995ms`，费用 `0.092604 CNY`；但 Dedup macro-F1 `0.6807692308`、revision recall `0`、Organizer subject `0.75`、tag F1 `0.6197183099`，因此不可变结论为 `quality_gate_failed`。V1 marker/evidence 保留，未做第二次调用，也未进入 Docker/浏览器产品验收。
>
> R1 修复没有放宽 schema、动态 evidence 校验或质量阈值：Dedup prompt 现在明确四类 relation 的允许/必需 evidence code；本地 version/timestamp 事实可把模型的 `semantic_duplicate` 安全重建为只读 `possible_revision`；paired harness 不再把不同更新时间错误压成 `same_time`，而是投影 `older/newer`。RED 覆盖 prompt contract、本地 revision authority 与时间投影，GREEN 为相关 `22/22`、Agent typecheck/lint exit `0`。
>
> 下一步是 V2 R2 Organizer 学科边界与 topic-label 精度；V1 数据集、baseline、预算、价格、权限、default-off gate 和 Docker 数据均未改变。回顾时可以问：为什么本地时间事实可以提升 revision 提示，但不能授权自动替换？为什么 evidence code 规则必须进入 prompt 而不能只依赖事后 Zod？

> 2026-07-21 — Phase 6.9.6 Task 12 分支静态/Mock checkpoint：Knowledge focused 为 Agent `114/114`、Types `1/1`、Server `50/50`、Web `7/7`；分支全量为 Agent `465/465`、Types `39/39`、Server `2110 passed / 30 skipped`、Web `413/413`，相关 typecheck/lint/build 与 `git diff --check` 均通过。为完成唯一数据库 integration gate，只启动 Docker Desktop 与既有 PostgreSQL service，保留原卷且没有进入 API/Web/worker 产品验收。
>
> 评测证据：未修饰 deterministic baseline 仍为 `12/48`、critical `0`、semantic `0.2322452551`；strict Mock 为 `24/24` verified zero-call、`48/48` canonical schema、semantic `1`、绝对提升 `0.7677547449`、P95 `286/348/348ms`、usage `14472/4185`、estimated `0.068526 CNY`，validator 返回 `ok=true`。Mock 的 `quality_gate_failed` 是 production gate 只接受 DeepSeek V4 Pro Live 的固定设计，不能把 Mock 满分冒充真实语义质量。
>
> 兼容性收口：`.gitattributes` 固定历史 acceptance evidence 字节，避免 Windows CRLF 破坏 SHA authority；V9 spec 只在测试侧归一化换行；V17--V22 bridge tests 注入 strict synthetic authority，production host 默认仍使用真实 Bun evidence authority 并 fail-closed；Knowledge 公共导出检查与 Web Node runner 命令也已补齐。没有改写历史 evidence、调用 provider、启用 Knowledge gate、创建账号/资料/对象/Trace 或执行可见浏览器验收。
>
> 阶段边界（Task 12 当时）：该 checkpoint 尚未完成 Phase 6.9.6，两个生产 gate 继续为 `false`；后续唯一 V2 Live、R7、浏览器与 main 结果见本文顶部当前状态。完整证据见 `docs/acceptance/2026-07-21-phase-6-9-6-knowledge-agents.md`。
>
> 回顾时可以问：为什么 Mock semantic=1 仍不能通过 production gate？为什么历史 evidence 要按字节固定？为什么测试可以注入 synthetic authority 而生产不能放宽？为什么仅启动 PostgreSQL 不等于 Docker 产品验收？

> 2026-07-21 — Phase 6.9.6 Task 11 API-only Docker/运维边界：Compose 只向 Nest `server` 注入 `KNOWLEDGE_AGENT_DEEPSEEK_API_KEY`、Dedup/Organizer 两个独立 default-off gate 与两个 4500ms timeout；worker/web/admin 均不接收。Knowledge composition 不再借用通用 Chat 或 Review/Planner 产品凭据，Review/Planner 产品 acceptance 也拒绝 Knowledge key/gate 同时开启，避免跨能力串用和轮换耦合。
>
> TDD 与安全：先用 Compose boundary、API positive control、generic-key isolation 和 worker zero-executor 测试观察 RED，再补 env schema/composition。有效路径仍要求全局 Live 双开关、精确 DeepSeek HTTPS、独立 credential、已知价格、owner eligibility 与冻结 reservation；两个候选共享 `2 calls / 6000 input / 1200 output`，request cap `0.03 CNY`。缺条件、worker role 或 executor 构造失败都回到 Mock/default-off。
>
> 运维文档：同步 server-only allowlist、独立 rollback、synthetic-only controlled-Live、provider retention/训练设置前置、default-off/key 清空和精确 synthetic cleanup。禁止 `down -v`、Docker prune、volume/database reset、Redis flush 或 MinIO wipe。本任务没有启动容器/浏览器、读取 key 或调用 provider；下一步是 Task 12 分支静态/Mock 验收并停下重新申请 controlled-Live 授权。
>
> 回顾时可以问：为什么 Knowledge 要有独立 credential 而不能借 Review/Planner 的 key？为什么 worker 即使被注入 live/gate/key 也不能创建 executor？为什么 `--env-file` 不等于 service `env_file`？为什么本地 cleanup 不能承诺删除供应商日志？

> 2026-07-21 — Phase 6.9.6 Task 10 Knowledge paired eval：新增固定 72-case 的 strict Mock/Live runner、CLI 与 evidence validator。24 条 zero-call 不再按 expected reason 自报：候选级样本实际穿过 exact-hash、projection safety、abort 和 budget guard，并用独立 executor counter 证明 provider 0 调用；48 条 runtime case 按 24 个 paired index 并行运行 Dedup/Organizer，失败仍保留在质量分母。
>
> 证据边界：报告重算 dataset/prompt/projection/shortlist 版本、case identity、语义指标、exact-hash、安全计数、单 Agent/endpoint P95、正 usage、逐 case 与总 CNY 成本。Mock 满分仍固定 `quality_gate_failed`，只有 `mode=live + deepseek + deepseek-v4-pro` 且全部阈值通过才可开启生产结论。validator 递归拒绝 prompt、filename、summary、chunk、embedding、provider body/header/response、credential、API key 与 raw error key，并强制 evidence filename 与 mode/scope/runId 一致，拒绝重复或跨 scope 复用 runId、未知 usage/price 和成本公式篡改。
>
> Live 安全门：CLI 需要 fresh `PHASE_6_9_6_CONTROLLED_LIVE_APPROVED=true`、全局 live 双门、Knowledge 双 gate、精确 DeepSeek URL、有效 key 和合法 timeout；配置不完整时不会创建 marker 或触发 executor。一次性 marker 使用 `wx`，Live evidence 通过 hard-link 不可变发布，stdout 只有 runId、版本、聚合 counts/metrics/latency/usage/cost/gate 与 evidence path。focused `16/16`、Agent typecheck/lint、Mock CLI/validator 和两轮只读复审通过；没有读取 `.env`/API key、调用真实 provider、启动 Docker/浏览器或修改业务数据，双 gate 仍默认关闭。下一步是 Task 11 API-only Docker 配置与运维文档。
>
> 回顾时可以问：为什么 Mock 满分仍不能打开生产 gate？为什么 zero-call 不能回显 expected reason？为什么 endpoint latency 必须不低于两个并行 Agent 的样本？为什么 Live evidence 要用 hard-link 而不是先建空文件再 rename？

> 2026-07-21 — Phase 6.9.6 Task 9 `/knowledge` 只读来源状态：Knowledge suggestions 现在把后端 strict runtime metadata 收敛为三个用户可理解的状态。任一 Dedup/Organizer runtime `degraded=true` 时优先显示“本地规则建议”与安全回退说明；否则任一 `hybrid_model / candidate_applied` 显示“语义建议”；default-off、not eligible 或纯本地结果显示“本地规则建议”。
>
> UI 与权限：来源 badge/description 位于原有资料建议内容上方，API 已返回但没有有效建议时也会说明当前来源。loading、request error、empty、上传、处理、替换、删除和检索路径保持不变；页面不展示 token、cost、Trace ID、provider error 或 document UUID，也没有语义重试、自动整理或任何新增写操作。移动端通过 `flex-wrap`、`min-w-0` 与 `break-words` 安全换行。
>
> TDD/验收：先观察 helper/export 和页面来源渲染缺失的 RED，再实现三态映射与 UI。API fixture 已纳入 strict runtime metadata，并显式证明未知 `providerError` 字段被拒绝；混合 hybrid+degraded 用例证明 degraded 优先级。Web `413/413`、lint、production build、focused `5/5` 与 `git diff --check` 通过；质量/安全复审 APPROVED，规格复审的两项 Minor 测试证据补齐后 PASS。没有读取 `.env`/API key、调用 provider、启动 Docker/浏览器或修改业务数据；双 gate 仍默认关闭。下一步是 Task 10 paired runner、CLI 与 evidence validator。
>
> 回顾时可以问：为什么 degraded 必须压过 semantic？为什么空建议也要显示来源？为什么页面不提供“重试语义建议”或“自动整理”？API 为什么要拒绝额外的 provider error 字段？

> 2026-07-21 — Phase 6.9.6 Task 8 Knowledge candidate 生产编排：把 Task 3/4 的 Dedup/Organizer 受治理 candidate 与 Task 7 runtime bundle 注入 `KnowledgeAgentService`。两个 gate 独立 default-off；Dedup `3000/500` 与 Organizer `3000/700` 的冻结 reservation 在任一 Promise 启动前一次性建立，eligible candidate 通过 `Promise.all` 并行，disabled candidate 保持 zero-call。HTTP `aborted` 使用同一 AbortSignal 传播到两个候选，并在 controller `finally` 移除 listener。
>
> 权限与一致性：模型前重验 owner-scoped snapshot，两个 candidate 结束后再做第二次完整 fingerprint fence；post-candidate 漂移会丢弃两份模型值。target 只进入 Dedup deterministic input，Organizer 不接收 target 扩展。candidate 仍只裁决本地 ordinal，本地 merger 重建 document ID、标题、reason、recommendation、标签/集合与权限；接口不写 Document / Chunk / 分类表，也不自动删除、替换、合并、改名或分类。
>
> API 与 Trace：`KnowledgeAgentSuggestionResponse` 增加 strict additive runtime metadata，只有 verified positive usage、精确 CNY price、`candidate_applied` 与已持久化 Trace 同时成立时才显示 `hybrid_model`；default-off、not eligible、safety、abort、budget、schema、usage、runtime、stale 或 Trace unavailable 都返回本地只读建议与固定 disposition。每次模型编排记录一个 parent + 两个 candidate step，含固定 agent/version、reason、latency、usageRef 去重、usage 与 `cost_cny` provenance；现有 Agent Trace 顶层 `costEstimate` 是 USD 语义，因此保持 `pricingKnown=false / costEstimate=0`，不伪造汇率。
>
> TDD/验收：API contract、Trace、Service parallel barrier、独立 gate、冻结预算、target、二次 stale fence、Trace failure 和 HTTP abort 均先观察 RED 再 GREEN。Knowledge focused `47/47`、Types `39/39`、Server lint/build、Types typecheck 与 `git diff --check` 通过；规格复审与质量/安全复审均 PASS，无 Critical/Important。没有读取 `.env`/API key、调用 provider、启动 Docker/浏览器或修改 Knowledge 业务数据；双 gate 仍默认关闭。下一步是 Task 9 `/knowledge` local/hybrid/degraded 来源状态。
>
> 回顾时可以问：为什么两个 candidate 要先冻结 reservation 再并行？为什么模型完成后还要第二次 stale fence？为什么 Trace 写失败必须丢弃模型建议？为什么 CNY 费用不能直接写入现有 USD Trace 顶层字段？

> 2026-07-21 — Phase 6.9.6 Task 7 Knowledge production composition 地基：新增 Dedup/Organizer 两个独立 server gate，默认均为 `false`，timeout 默认 4500ms、只接受 1000..15000ms。真实 runtime 只有在 `AI_PROVIDER_MODE=live`、`AI_ENABLE_LIVE_CALLS=true`、对应组件 gate=true、精确 `https://api.deepseek.com/v1`、有效 DeepSeek credential 与已知精确价格同时成立时才创建；worker-only role 强制两个组件 gate 关闭。
>
> 模型与 transport：Knowledge 候选固定 `deepseek-v4-pro`、prompt `knowledge-agents-v1`、`deepseek_v4_pro_nonthinking_json`，复用共享 OpenAI-compatible executor 的 non-thinking JSON object、`maxRetries=0`、no-tools 与 abort deadline。API key 只进入 composition closure，不进入安全 config、budget 或返回值；unknown/被篡改 pricing、missing credential、错误 base URL、executor construction 异常、hostile env/price getter 或 Proxy 都关闭双 gate/返回 null，不把异常正文向外传播。
>
> 预算与价格：在任何并行 Promise 启动前，从冻结的 `2 calls / 6000 input / 1200 output` request budget 纯函数预留 Dedup `3000/500` 与 Organizer `3000/700` 两个隔离 budget；任一 reservation 不可证明时两者都不调用。固定非缓存价格为 `3 CNY / 1M input`、`6 CNY / 1M output`，理论最坏 `0.0252 CNY`，request cap `0.03 CNY`；未知价格、usage 非正/不可验证、超过 reservation/总 token ceiling 或 cost cap 都必须 fail-closed。
>
> TDD/验收：缺失模块与 env keys 得到预期 RED，hostile getter/Proxy 与 over-cap 也先 RED 后修复；focused `90/90`、Server lint/build 与 `git diff --check` 通过。规格复审 PASS；质量复审发现的 getter/proxy Important 已关闭并复审 APPROVED。没有读取 `.env`/API key、调用真实 provider、启动 Docker/浏览器或创建/修改业务数据。runtime provider 已注册但尚未注入 `KnowledgeAgentService` dispatch，产品仍返回 deterministic 建议；下一步是 Task 8 并行编排、API metadata 与安全 Trace。
>
> 回顾时可以问：为什么组件 gate=true 仍不一定允许真实调用？为什么两个并行 Agent 必须在启动前一次性预留共享预算？为什么 `0/0` usage 不能显示为零成本成功？为什么 Task 7 已有真实模型 runtime 仍不能说产品已经在用真实模型？

> 2026-07-21 — Phase 6.9.6 Task 6 owner-scoped pgvector semantic shortlist：把 owner snapshot 中最多 20 份资料收敛为可供 Dedup/Organizer 裁决的 bounded 语义候选。只纳入当前 owner 的 `DONE` Document，以及显式 `riskLevel=low`、`safeForPrompt=true`、1536 维且 provenance 精确为 Qwen `text-embedding-v4` 的 Chunk；新处理 Chunk 会持久化 provider/model/dimensions，旧 Chunk 缺少可信 provenance 时不会被猜测为可用，仍返回 deterministic 建议。
>
> 采样与评分：每份资料按 `index/id` 通过 `ntile(6)` 稳定取最多 6 个 Chunk；跨文档 pair 取最高 3 个 cosine similarity 的均值，`>=0.78` 才入选，`>=0.9` 标记 high，按 score 与 code-unit document ID 稳定排序后最多 12 对。exact non-empty content hash 在向量计算前排除；target 请求只保留包含 target 的 pair。无关的 PENDING/PROCESSING/FAILED 资料不会压制其他 DONE pair，但 target 自身非 DONE 时仍 fail-closed。
>
> 安全与一致性：两侧 Chunk 和 Document 都绑定 canonical owner，所有原始 SQL 使用 Prisma tagged `$queryRaw`/`Prisma.join`，hostile owner/document ID 只作为 bound values；查询结果不返回 embedding、正文、文件名、metadata 或 raw owner。selected Chunk identity/full-content hash/safety 与 pair score/evidence band 加入 snapshot fingerprint，provider 前重建可发现选择、内容、安全或语义分数漂移；畸形、越界、重复、跨 owner 或 DB 异常整批回到冻结空 shortlist。
>
> TDD/验收：focused `44/44`、Server lint/build 与 `git diff --check` 通过；规格复审 PASS、质量复审 APPROVED，均无 Critical/Important。没有读取 API key、调用真实 provider、启动 Docker/浏览器或创建/修改业务数据。下一步是 Task 7 default-off gates、DeepSeek runtime、集中价格与不可变共享预算。
>
> 回顾时可以问：为什么 1536 维还不能证明 embedding 来自 Qwen？为什么 exact hash 必须在 pgvector 前排除？为什么选 top-3 mean 而不是只看最大相似度？为什么 shortlist 已完成仍不能说 Knowledge Agent 已经使用真实模型？

> 2026-07-21 — Phase 6.9.6 Task 5 单一 owner snapshot 与 stale fence：把原先“先独立查 target、再查列表、必要时第三次补 target”的 TOCTOU 链路收敛为一个 bounded PostgreSQL interactive transaction。事务以 `REPEATABLE READ` 运行并先执行 `SET TRANSACTION READ ONLY`，所有 target ownership、Document 与所选 Chunk 读取都绑定 canonical `userId`；请求 `limit` 即使为 50 也最多取 20 份，target 在窗口外时占用一个名额而不是形成第 21 份，缺失或跨 owner 仍返回同一个 404。
>
> 快照与安全边界：`knowledge-owner-snapshot-v1` 不保留 raw user ID，而是使用必需 JWT secret 作为服务端密钥材料生成域分离 HMAC；该 HMAC 只用于本次请求的 owner fingerprint，JWT secret 轮换只会改变后续瞬时快照。完整 canonical fingerprint 覆盖 target binding、所有影响 prompt/policy/merger 的 Document 字段、selected chunk identity/order、全文 SHA-256、safety schema 版本与完整 canonical safety hash，以及 shortlist 版本。返回对象、Document、chunk 和嵌套数组全部深冻结，数据库 mock 行在 load 后被修改也不会改变快照。
>
> provider-preflight：模型调用不会放在数据库事务内；事务结束后，短 owner-scoped 查询重跑相同 chunk 选取并重建完整 fingerprint。Document 删除/改 owner/改名/换 hash/状态或时间变化，Chunk 删除/替换/改 index/全文/safety/选取集合变化，以及 DB 异常或快照篡改都返回 stale=false 并只保留 deterministic 本地建议。Task 8 才增加公开 runtime metadata 和实际双候选 dispatch，因此 Task 5 不提前伪造 `snapshot_stale` API 字段，也没有 provider 调用。
>
> TDD/验收：新模块缺失时得到预期 RED；随后 owner snapshot 与 Service focused `13/13`、Server build 通过。测试覆盖只读事务顺序、20 条边界、target 内联 ownership、HMAC/raw owner 隔离、canonical fingerprint、deep freeze、完整 stale 矩阵、事务结束后 revalidation、异常 fail-closed 与 root/transaction 两侧零写入。本任务没有读取 API key、启动 Docker/浏览器、调用真实模型或创建/修改业务数据；下一步是 Task 6 owner-scoped pgvector semantic shortlist。
>
> 回顾时可以问：为什么 `REPEATABLE READ` 事务结束后还要 provider 前 revalidation？为什么 owner hash 要用域分离 HMAC 而不是普通 SHA？为什么 target 补入必须占用 20 条上限？为什么 Task 5 已有 stale fence 但还不能说 Knowledge Agent 已接入真实模型？

> 2026-07-21 — Phase 6.9.6 Task 4 Organizer 受治理候选：目标是让 `KnowledgeOrganizerAgent` 能理解词表之外的资料主题与集合关系，同时继续只做建议。候选至少需要 1 份通过完整字段扫描与 safety metadata 的 ordinal-only projection；模型只能选择固定 subject/resource type、最多 2 个 topic label、最多 5 个集合及每组 2..8 个有序唯一成员。真实 document ID、中文 subject/resource labels、reason、description、confidence、signals 和全部权限由本地 merger 重建，最终每份资料最多 3 个标签。
>
> 安全与降级：schema 之后仍对 topic label/collection name 做 URL、Markdown、HTML、instruction、credential 和控制字符检查，任一非法值都会整批回退，不部分应用。重复/越界 document index、乱序或重复 member index、超过数量上限、unsafe projection、abort、预算不足、timeout、invalid usage、schema invalid 或 runtime throw 都只返回既有 deterministic Organizer 结果；observation 不携带文件名、摘要、prompt、provider body、raw error、真实 ID map 或凭据。模型没有持久化 tag/collection、自动分类、删除、替换、改名或合并权限。
>
> TDD/验收：缺失 candidate 模块得到预期 RED，随后 Organizer focused `12/12`、AI `192/192` 通过，Agent/AI typecheck 与 lint、`git diff --check` 均 exit 0；规格与代码质量复审无 Critical/Important。测试覆盖本地 ordinal→owner ID 映射、最终标签/集合上限、post-schema 指令拦截、成员范围/顺序/唯一性、provider 前 zero-call guard、无网络 timeout/usage failure 与 caller input/budget 不变。
>
> 本任务仅使用 Mock responder 和注入式无网络 executor；没有读取 API key、调用真实 provider、启动 Docker/浏览器或创建业务数据。Task 3/4 现在只完成 package 级候选与本地 merger；owner-scoped `REPEATABLE READ` snapshot、stale fence、pgvector shortlist、server composition/gates、Trace/API/UI、paired eval 和生产验收仍未完成。下一步是 Task 5 单一不可变 owner snapshot 与 provider 前 stale revalidation。
>
> 回顾时可以问：为什么模型返回 documentIndex 而不能返回 document ID？为什么 schema 通过后还要再次扫描 label？为什么 Organizer 失败必须整批回退而不是保留一部分标签？为什么 package candidate 完成不等于产品已使用真实模型？

> 2026-07-21 — Phase 6.9.6 Task 3 Dedup 受治理候选：目标是让 `KnowledgeDedupAgent` 在 exact hash 本地权威不变的前提下，具备受限语义关系判断能力。候选先生成 ordinal-only 安全投影，再只允许返回 `semantic_duplicate / possible_revision / complementary / unrelated` 与固定 evidence code；真实 document ID、标题、原因、严重度、置信度、recommendation、signals 和全部写权限均由本地 merger 重建。`semantic_duplicate` 是独立只读建议并固定 `review_manually`，不伪装成新版；`possible_revision` 缺少本地版本 token 或时间顺序证据时会降级为人工复核并标记 `insufficient_version_evidence`；`complementary` 只建议 `keep_both`，`unrelated` 不生成条目。
>
> 为什么 exact hash 必须留在本地：相同 `contentHash` 已是确定事实，交给模型既增加成本与延迟，也可能被语义输出覆盖。因此即使 exact-hash pair 误入 semantic shortlist，候选也会在 runtime 前剔除，并保留 deterministic `exact_duplicate / use_existing`；没有剩余语义 pair 时 counting runtime 证明 provider 调用数为 0。公开 `projectKnowledgeSnapshot()` 只返回 ordinal 投影，ordinal→真实 ID map 不再从 `production.ts` 暴露，只在候选内部 merger 使用。
>
> TDD/验收：先增加公开 projection 不得携带真实 ID map 的回归并观察预期 RED，再完成修复；Dedup/Projection focused `22/22`、AI `191/191`、Types `39/39` 通过，Agent/AI/Types typecheck、Agent/AI lint 与 `git diff --check` 均 exit 0。timeout、abort、budget、schema、invalid usage 和 runtime throw 全部回退 deterministic；最大只展示 5 条，不产生删除、替换、合并或分类写操作。规格与质量复审最终均无 Critical/Important；质量复审还复核了候选 preview reservation 与共享 runtime 唯一真实预留的边界，避免误改成双重扣减。
>
> 本任务只使用 Mock/runtime fixture 和注入式无网络 executor；没有读取 API key、调用真实 provider、启动 Docker/浏览器或创建业务数据。整套 24 条 zero-call 尚未跑 paired runner，不能写成 24/24 已验证；Organizer candidate、owner snapshot、pgvector shortlist、server gate、Trace/API/UI、paired eval 与生产验收仍未完成。下一步是 Task 4 Organizer candidate 与本地权威 merger。
>
> 回顾时可以问：为什么 exact hash 不应该交给模型？semantic duplicate 为什么不能伪装成 revision？本地版本证据不足时为什么仍保留人工复核而不是相信模型？preview reservation 与 runtime 真正记账怎样避免超卖和双重扣减？

> 2026-07-21 — Phase 6.9.6 Task 2 Knowledge 模型安全边界：新增 strict Dedup/Organizer 输出合同。Dedup 只允许最多 12 个本地 pair index、四类语义关系、medium/high confidence 和固定 evidence code；Organizer 只允许最多 20 份资料的学科/资料类型、每份最多 2 个受限 topic label、最多 5 个集合及 2..8 个有序唯一成员。schema 之外的动态 validator 会整批拒绝重复/越界索引与关系-evidence 错配，模型没有 exact-hash 覆盖、删除、写库或任意字段能力。
>
> `knowledge-model-projection-v1` 为什么需要：文件名和摘要都属于不可信文本，若先裁剪后扫描，凭据或 prompt injection 可以藏在截断区；若先分配真实 ID，模型边界又会无谓暴露 owner 数据。实现先用 property descriptor 把普通自有数据克隆到隔离对象，hostile getter/proxy 只得到固定 `invalid_input`；随后逐个扫描完整 filename 和每段 summary 的 malformed UTF-16、控制字符、credential、instruction/system prompt 与持久化 safety metadata。字段全部通过后才裁剪、分配 `d0...` ordinal、重建 surviving pair 并深冻结。unsafe non-target 整份排除，unsafe target 固定 `target_projection_blocked`，输出不含 document ID、owner、storage、chunk、向量或写权限。
>
> TDD/验收：两份模块先以缺失导入得到预期 RED，再完成 focused `10/10` GREEN；Agent typecheck/lint exit 0，规格复审与代码质量/安全复审均无 Critical/Important。没有读取 API key、调用 provider、启动 Docker/浏览器或创建业务数据。Task 2 只是 schema 与投影地基，Dedup/Organizer candidate、runtime counter、usage/cost、Trace、shortlist 和产品接入均未完成；下一步是 Task 3 Dedup candidate 与本地权威 merger。
>
> 回顾时可以问：为什么 Zod 的静态 `max(11)` 不能替代按本次 shortlist 长度做动态越界检查？为什么 hostile getter 需要 descriptor clone 而不是普通展开？为什么非目标 unsafe 文档可以排除，但目标文档必须整体 fail-closed？为什么此时仍不能声称 24/24 zero-call 已验证？

> 2026-07-21 — Phase 6.9.6.1 Knowledge Agent baseline：目标是先把 KnowledgeDedup/Organizer 的当前能力变成不可修饰、可复现的比较基准，再接模型，避免“为了让结果好看”边做 candidate 边改 expected。`phase-6.9-knowledge-agents-v1` 固定 72 条合成 case：Dedup 40、Organizer 32；24 条定义未来 provider 前零调用的 gate/safety/owner/budget/abort 场景，48 条语义质量 case 按 `pairedRunIndex=0..23` 形成 24 个 Dedup/Organizer 请求对。
>
> 结果与原因：原有 deterministic policy 在 48 条 runtime case 中完整通过 `12` 条，critical `0`，Dedup relation macro-F1 `0.3343653251`、revision recall `0`、unrelated false-positive rate `0`；Organizer subject top-1 `0.25`、topic tag micro-F1 `0`、collection pairwise-F1 `0.4347826087`；固定加权 semantic score 为 `0.2322452551`。这说明规则对明显互补/无关资料较保守，但无法理解换名语义重复、新旧版本和词表外专业主题，正是后续 embedding shortlist + 受限模型裁决需要解决的差距。
>
> 工程与边界：case、嵌套 fixture 和预期均深冻结；指标拒绝非法数值、固定四类 macro-F1、case-scoped tag/collection micro-F1 和 24 样本 nearest-rank P95，第 23 个值为 P95。focused tests `13/13`、Agent typecheck/lint 均通过，baseline CLI 复现相同结果。没有读取 key、调用 provider、启动 Docker/浏览器或创建业务数据；24 条 zero-call 当前只是合同，candidate 尚未实现，不能声称已实际 24/24 零调用。完整证据见 `docs/acceptance/phase-6-9-6-1-knowledge-agent-baseline.md`。
>
> 回顾时可以问：为什么 baseline 不能边跑边修 expected？为什么 72 条只有 48 条进入 semantic score？为什么 revision recall 为 0 但 unrelated false-positive rate 为 0？为什么 zero-call case 此时只能叫合同？下一步 `knowledge-model-projection-v1` 为什么必须先扫描完整字段再裁剪？

> 2026-07-21 — Phase 6.9.6 Knowledge Agent 设计检查点：目标是把 `KnowledgeDedupAgent` 从 hash/文件名/小词表判断升级为“exact hash 零调用 + Qwen Chunk embedding 候选 + DeepSeek V4 Pro 受限关系裁决”，并把 `KnowledgeOrganizerAgent` 升级为真实语义标签和集合顾问。为什么需要：当前 policy 能识别明显副本和固定学科词，却不能可靠区分换名后的语义重复、新旧版本、互补资料或词表之外的专业课主题；继续只靠规则会让“Agent”缺少真正的语义大脑。
>
> 主要设计：选择复用现有 Qwen `text-embedding-v4` / 1536 Chunk embedding，不在本阶段新增 Document embedding 表或把全部资料直接塞给模型。owner-scoped shortlist 最多 12 对，模型只看到本地 ordinal、受限文件信息和脱敏短摘要；Dedup 只能返回四类关系与固定 evidence code，Organizer 的标签/集合受数量、长度、字符和成员索引约束，本地 merger 重建真实 ID、时间、recommendation、reason 和权限。两个 server gate 独立且默认关闭；candidate 并行共享 `2 calls / 6000 input / 1200 output` 预算，单请求 CNY cap `0.03`，未知 pricing/usage/Trace 均 fail-closed。
>
> 评测与边界：数据集固定为 `phase-6.9-knowledge-agents-v1` 共 72 case，24 条验证 provider 前零调用、48 条进入 runtime；同时固定 Dedup macro-F1/revision recall、Organizer subject/tag/collection 指标、P95、CNY 1.00 controlled-Live 总 cap、critical/越权/写操作为 0 等门槛。API 和 `/knowledge` 继续只读，不写 Document / Chunk / 分类表，不自动删除、替换、合并、改名或分类；模型路径尚未实现，本检查点没有读取 key、调用 provider、启动 Docker/浏览器或产生合成数据。完整设计见 `docs/superpowers/specs/2026-07-21-phase-6-9-6-knowledge-agents-design.md`。
>
> 书面设计审阅已经通过，实施计划已固定在 `docs/superpowers/plans/2026-07-21-phase-6-9-6-knowledge-agents.md`。计划按 TDD 拆成 13 个“一任务一提交”单元：先冻结 baseline/Mock 和安全 contract，再接 owner snapshot、pgvector shortlist、生产 composition、Trace/API 与前端，最后完成分支静态/Mock 验收。Task 12 必须暂停并重新获取 controlled-Live 授权；Task 13 才允许真实模型、Docker API、可见浏览器、精确清理、`--no-ff` 合并 main、main default-off 回放与远程推送。当前仍未开始业务实现，也没有读取 key 或调用 provider。
>
> 回顾时可以问：两个 Knowledge Agent 分别做什么？为什么 exact hash 必须零调用？为什么复用 Chunk embedding 而不新增 Document embedding 表？为什么模型只能返回 ordinal 和受限关系？72-case 如何同时证明语义质量、权限、成本和降级？

> 2026-07-21 — `/today` Review/Planner “先完成今日复习”主操作修复：目标是让同页建议卡产生可感知、可访问的结果，而不是重新跳转当前 `/today` URL。根因是建议卡对首个 Planner block 一律渲染 Next `Link`；当目标同为 `/today` 时，路由没有页面或焦点变化。修复为可选的 `onPrimaryAction`：仅当标准化目标确为 `/today` 时，`/today` 才以本地回调平滑滚动并聚焦第一张 `PENDING` 复习卡；`/error-book`、`/plan` 等跨页建议与未传回调的调用方仍保持原有安全 Link 导航。空任务 notice 只在已成功读取且确实无待复习卡时显示；加载和失败保留原状态，离线或暂停查询显示“暂不可用”而非空态。浏览器复验发现实际滚动目标是首张待复习卡 wrapper，而非 section；因此 wrapper 与无任务 section fallback 均使用 sticky-header scroll margin，避免焦点卡被页头遮挡。该操作不评分、不跳过、不创建或修改任何 ReviewTask。
>
> 验收：先以 `review-agent-ui-integration.test.mts` 观察两个 RED（缺少本地 action contract、缺少同页焦点 contract），最小实现后 Web `409/409`、lint 和 production build 均通过。浏览器使用一次 synthetic 账号、1 条错题、1 张到期 Card 和 1 条 `PENDING` ReviewTask：首次 `/today` 初始 `scrollY=0`，点击后为 `scrollY=767`，焦点为第一张卡的 `DIV[tabindex=-1]`，从而暴露 wrapper 顶部为 `0px` 的 offset 缺口；补齐 wrapper margin 后重新回归为 `scrollY≈671`、焦点仍为该 `DIV[tabindex=-1]`、其包含 review card 且顶部为 `96px`。复验新增控制台错误为 0。无待复习卡的正常 Planner 结果会把主目标改为错题/计划页，因而不会自然渲染本按钮；loaded-empty guard 由回归 contract 覆盖，不伪造浏览器响应。
>
> 运行边界与清理：本轮 Docker Web BuildKit 因会话 header 含不可打印 ASCII 被 Docker Desktop 阻断，未替换容器、未改动卷或数据。为验收当前分支，仅短暂停止 `web` 容器，在 CORS 允许的 `127.0.0.1:3000` 运行本地 Next Web 并连接健康 Docker API；随后停止本地 Web，恢复原 Docker Web，`/login` 返回 200。synthetic User 删除后 `users/wrongQuestions/cards/reviewTasks=0/0/0/0`；独立浏览器上下文的 localStorage、sessionStorage 和 IndexedDB 均为 0，并停留在 `/login`。未执行 prune、`down -v`、volume/database reset、Redis flush 或 MinIO wipe。
>
> 回顾时可以问：为什么同页 Link 会让用户感觉按钮无效？为什么焦点要落在第一张待复习卡而不是只滚到区域？为什么加载中不能提示“没有复习任务”？为什么本轮 Web 运行验收与 Docker BuildKit 镜像重建必须分开记录？
> 2026-07-20 — Phase 6.9.5 main 回放与最终收口：分支已以 `--no-ff` 合并为 main `3aff6cc`。main 上的 Server build、Web `409/409`、Web build、Compose config 均通过；关闭 Compose Bake 自动层后，server/web main 镜像构建成功并仅重建这两个容器。server health=ok，容器内为 `mock`、live/Review/Planner/product gates=false、request limit=0。可见 `/plan` 页面显示“Agent 学习建议”，接口中 Review/Planner 都为 `attempted=false / not_eligible / local_deterministic / 0+0`；本轮合成账户与 Trace 精确清理为 `0/0`，浏览器保留打开。V22 仍是不可重跑的 `operation_failed -> recovered` 历史，独立 DeepSeek V4 Pro 验收不被改写为 V22 retry。Phase 6.9.5 至此完成，下一步为 Phase 6.9.6。

> 2026-07-20 — Phase 6.9.5 Review/Planner 分支生产验收收口：V22 的唯一 branch product 因把 API aggregate duration 与 Trace candidate-step duration 做精确相等比较而终止，唯一 recovery 已封存为 `recovered`。修复仅解除该独立计时耦合，仍严格校验 provider/model、candidate state、正 duration、step topology 与双向 usage。随后在用户授权下完成一次独立 DeepSeek V4 Pro Docker API 与可见 `/plan` 验收：API 为 Review `candidate_applied / 945ms / 225+7`、Planner `candidate_applied / 732ms / 222+8`；浏览器为 Review `1329ms / 225+7`、Planner `839ms / 222+8`，页面实际渲染“Agent 学习建议”。Docker server 已恢复 `REVIEW_AGENT_MODEL_ENABLED=false`、`PLANNER_AGENT_MODEL_ENABLED=false`、`AI_ENABLE_LIVE_CALLS=false`；合成账户与 Trace 清理复核为 `0/0`。下一步必须先提交并复验分支，再 `--no-ff` 合并到 `main`；只在 `main` 的 HEAD 上进行 default-off replay、复核和推送，才可标记阶段最终完成。完整证据见 `docs/acceptance/2026-07-20-phase-6-9-5-review-planner-production.md`。

> 2026-07-20 — V21 最小运行时切换：V20 `preflightOnly` 已通过，但唯一 product 在真实 `acquireOwner` 前安全关闭。根因是 owner/ledger 的 Windows reparse-safe I/O 依赖 `bun:ffi`，Node runner 不能执行它。V21 仅将受控 product/recovery/preflight lifecycle 改为 Bun 直接执行，保留 profile、确认、权限、预算、default-off、清理和 V10 authority 的既有边界；V21 product/recovery、Docker、浏览器、API 与 provider 尚未运行，gate 仍 false。

> 2026-07-20 — V20 离线收口：V19 的只读 Node preflight 已返回 `ready`，证明 runner/parser/default host 可执行；但其唯一 branch product 仍在 owner 前返回固定 `default_off`，没有 owner、ledger、Docker、浏览器、API、provider、合成资源或三类 roots，故不可重跑且 recovery 不适用。V20 建立独立 namespace，并在 public product execute 内增加 `preflightOnly`：它保留真实 confirmation/default ports/default host，只把 owner 固定为 `owner_active`，因而在 reservation 前零资源验证 exact execute path。V20 product/recovery、Docker、浏览器、API 与 provider 均未运行，两个 gate 继续 false。详见 `docs/acceptance/phase-6-9-5-review-planner-v19-closure-v20-plan.md` 与 `docs/superpowers/specs/2026-07-20-phase-6-9-5-v20-product-lineage-design.md`。

> 2026-07-20 — V19 离线收口：V18 的唯一 branch product 在 owner 前返回固定 `default_off`，没有 owner、ledger、Docker、浏览器、API、provider、合成资源或三类 roots，故不可重跑且 recovery 不适用。argv probe 已确认严格 confirmation 与 environment 两参数正确；差异仍是 Node-runner product preflight 与直接 Bun host `ready` 的运行时 parity，不能猜测后再消耗新 product。V19 建立独立 namespace，并新增只读 `preflight:review-planner:v19:product`：它使用同一 Node runner、严格 parser 与 root-bound default host，却在 owner 前停止且不创建资源。V19 product/recovery、Docker、浏览器、API 与 provider 均未运行，两个 gate 继续 false。详见 `docs/acceptance/phase-6-9-5-review-planner-v18-closure-v19-plan.md` 与 `docs/superpowers/specs/2026-07-20-phase-6-9-5-v19-product-lineage-design.md`。

> 2026-07-20 — V18 离线收口：V17 的唯一 package command 在确认 parser 前停止，根因是 Bun 将标准首位 `--` 原样转发，而 V17 parser 正确地只接受 confirmation 与 environment 两个参数。V17 没有 owner、ledger、Docker、浏览器、API、provider、合成资源或三类 roots，仍作为不可重跑、不可恢复历史封存。V18 建立新的 confirmation、schema、ledger/recovery/execution/browser/public-evidence namespace，保留 V17 的 CWD、allowlist、resolver 和只读 V10-authority bridge；唯一变化是在 allowlisted entry 后最多剥离一个 separator，其他参数仍严格 fail-closed。V18 product/recovery、Docker、浏览器、API 与 provider 均未运行，两个 gate 继续 false。详见 `docs/acceptance/phase-6-9-5-review-planner-v17-closure-v18-plan.md` 与 `docs/superpowers/specs/2026-07-20-phase-6-9-5-v18-product-lineage-design.md`。

> 2026-07-20 — V17 preflight 关闭：唯一 V17 branch package command 返回固定 `default_off`，没有 owner、ledger、Docker mutation、浏览器、API、provider 或合成资源，public/recovery/execution roots 均为空，故不可重跑且 recovery 不适用。直接 Node host preflight 已返回 `ready`；后续确定 command-only 差异为 Bun separator forwarding，严格 parser 从未收到有效的两参数确认，故以 V18 新 lineage 处理，不能据此宣告 Phase 6.9.5 完成、合并 main 或 push。两个 gate 继续 false。

> 2026-07-20 — V17 离线收口：V16 唯一 branch command 在 root-absent preflight 安全停止，未创建 owner、ledger、Docker mutation、浏览器、API、provider 或合成资源，故不得重跑或 recovery。根因不是 default-off：V16 Node runner 从 `apps/server` CWD 启动，而 V10 immutable authority 受设计保护使用默认 `process.cwd()`，从错误目录读不到 evidence。V17 建立全新 namespace，并在加载两个精确 allowlisted entry 前切换并复核仓库根；既有 source roots、两个 bridge、resolver boundary 不放宽。它继承 V16 的受限 URL/model receipt 与 recovery boundary，V11--V16 sentinel 不变。此时 V17 gate=false，尚未运行 product/recovery、Docker、浏览器、API 或 provider。详见 `docs/superpowers/specs/2026-07-20-phase-6-9-5-v17-product-lineage-design.md` 与 `docs/acceptance/phase-6-9-5-review-planner-v16-closure-v17-plan.md`。

> 2026-07-20 — V16 离线收口：V15 的唯一 branch command 在 `default_off` preflight 安全停止，未创建 owner、ledger、Docker mutation、浏览器、API、provider 或合成资源，三类 V15 root 均为空，故不得重跑或 recovery。根因是普通 Compose 的安全官方 URL `https://api.deepseek.com/v1` 与 V15 receipt 固定根 URL 不匹配。V16 建立全新 confirmation、Node runner、ledger/recovery/execution/browser namespace，并只允许官方根 URL或 `/v1`、Flash/Pro；mock、live、两 gate、credential、capability、max-request 与重复受控键仍严格 fail-closed。default-off receipt 持久重读 `baseUrl`/`model`，V16 recovery 显式注入自己的 validator，V11--V15 sentinel 保持不变。此时尚未运行 V16 product/recovery、Docker、浏览器、API 或 provider，两个 gate 继续 false。详见 `docs/superpowers/specs/2026-07-20-phase-6-9-5-v16-product-lineage-design.md` 与 `docs/acceptance/phase-6-9-5-review-planner-v15-closure-v16-plan.md`。

> 2026-07-20 — V15 离线收口：V14 已在 root-absent `default_off` preflight 封存，绝不重跑。其根因是普通 Compose Chat 安全地使用 `deepseek-v4-flash`，而旧 receipt 错将 `deepseek-v4-pro` 固定为关闭态前提。修复只允许 Flash/Pro 两个明确模型值；`mock`、live=false、两 gate=false、空 credential/capability、maxRequests=0 仍逐项严格校验，受控 Docker 环境键重复也 fail-closed。V15 以独立 confirmation、Node runner、ledger/recovery/execution/browser roots 与 V11--V14 native sentinel 建立；reservation 后、diagnostics 前发生异常时，仅在可证明零资源、零 checkpoint 的情况下回滚，否则保持 `failed` fail-closed。此时尚未运行 V15 product/recovery、Docker、浏览器、API 或 provider，两个 gate 仍为 false。详细边界见 `docs/superpowers/specs/2026-07-20-phase-6-9-5-v15-product-lineage-design.md` 与 `docs/acceptance/phase-6-9-5-review-planner-v14-closure-v15-plan.md`。

> 2026-07-20 — V14 preflight 关闭：在 `b808d97` 离线收口与 Docker mock/default-off 复验后，唯一 V14 branch CLI 返回固定 `default_off`，未进入 owner、ledger、Docker mutation、浏览器、API、provider 或合成资源；public/recovery/execution roots 均仍不存在，故没有 recovery-admissible terminal。根因是历史 V8 strict default-off receipt 将 `AI_MODEL=deepseek-v4-pro` 作为关闭态前置条件，而普通 Compose server 保留 Chat 的 `deepseek-v4-flash`；live/gate/credential 均保持关闭。V14 不得重试，必须由用户在修复 strict default-off contract 并建立新 lineage或其他路线之间作出新决定。详见 `docs/acceptance/phase-6-9-5-review-planner-v14-preflight-blocked.md`。

> 2026-07-20 — 当前更正（二）：V13 唯一 branch product 在只写入 reservation 后被 Bun 1.3.14 segmentation fault 中断；未产生 execution manifest、checkpoint、failure terminal、Docker/API/browser/provider 或合成资源，且 default-off 已复验，因此 V13 不可重试也不满足 recovery preflight。V14 已使用新 root 建立独立 lineage，并用 native sentinel 证明不写 V11/V12/V13。V14 的唯一 host 命令由 Node CommonJS TypeScript runner 执行：仅 allowlist 两个 V14 入口，并在内存转译 canonical path 位于 scripts/review-agent approved roots 或两个精确 workspace bridge（`packages/database/src/index.ts`、`packages/agent/src/review-planner-diagnostics.ts`）的相对依赖；V7/V8/V9 evidence 已改为 diagnostics subpath，避免加载 Agent barrel，保留每个模块原始 `__dirname`，不生成 bundle；继承/未知入口、越界依赖和 bootstrap 失败都只输出固定 `default_off`，以绕开已观察的 Bun host-process crash；详细边界见 `docs/acceptance/phase-6-9-5-review-planner-v13-closure-v14-plan.md`。

> 2026-07-20 — 当前更正：V12 已消费唯一 branch product，因 `review_api_trace_canonicalize` 的 Trace 总耗时/候选步骤耗时错误关联而安全终止，随后已完成唯一 recovery；V12 永久封存为 `recovered`，不得重跑或改写证据。根因已由生产 DTO 回归测试修复，V13 已建立完全独立的 confirmation、ledger/recovery/execution/browser namespace，并已证明不写 V11/V12 根。V13 尚未运行 Docker、浏览器、API 或 provider，两个业务 gate 继续为 `false`；下一步是在最终静态与镜像门禁后执行唯一 V13 branch product。详见 `docs/acceptance/phase-6-9-5-review-planner-v12-closure-v13-plan.md` 与 `docs/superpowers/specs/2026-07-20-phase-6-9-5-v13-product-lineage-design.md`。本条替代下方 V12 离线 checkpoint 的“尚未执行”当前态描述，保留其作为执行前历史记录。

> 2026-07-20 — Phase 6.9.5 V12 已完成离线 checkpoint：独立 profile、four-slot durable ledger、attempt binding、最早安全 recovery、V8 adapter 和真实 default-off host boundary 已就位；V11 public/recovery root 的 native SHA sentinel 保持不变。此 checkpoint 没有执行 V12 product/recovery CLI、Docker、浏览器、API 或 provider；V12 roots 为空，两个 Review/Planner gate 继续为 `false`。V10 仍是唯一语义质量 authority，V11 仍是不可复用的 `operation_failed / recovery-only` 历史。两项相互独立的 contract/operations review 已无未关闭 P0/P1；下一步仍须一次新的单独用户授权，才可运行唯一 V12 branch product。完整记录见 `docs/acceptance/phase-6-9-5-review-planner-v12-offline-checkpoint.md`。

> 2026-07-20 — V11 branch product 已封存为 `operation_failed / recovery-only`：安全终态停在 `review_api_activate / not_started`，未到 provider 调用。首 checkpoint 前的严格 attempt state 曾被 recovery preflight 误拒；`cfd15b1` 只修复该 recoverability 缺口，随后一次有效 recovery 完成，server 已验证回到 mock/default-off、两个 gate=false、容器无 DeepSeek key。V11 不重跑、不进 main；下一次产品验收必须使用独立 lineage。完整记录见 `docs/acceptance/phase-6-9-5-review-planner-v11-product-recovery.md`。

> 2026-07-20 — Phase 6.9.5 V11 execution bridge 已完成离线 checkpoint：V10 controlled-Live 仍是唯一语义质量权威，V10 product terminal 仍为 recovery-only。V11 CLI、私有 manifest、success ledger、默认关闭与精确 recovery selector 已就位；未执行 V11 Docker、浏览器或真实模型，产品 gate 继续为 `false`。

> 2026-07-20 — 对齐遗留 Review/Planner server 测试 fixture 与 index-only candidate contract：只更新 V1/V4/V6/V7 controlled-eval 和 service mock 输出及过时负例，未改生产、Agent、AI 或 V11 行为；该修复恢复全量 server 静态门禁，不产生新的 Live/Docker/browser 证据。

> 2026-07-20 — 修正 V11 branch product preflight 对安全默认 Chat 配置的误拦截：仅在 `mock/default-off` 且所有 gate、密钥与产品能力均关闭时，允许当前 Chat 的 `deepseek-v4-flash`（并保留恢复目标 `deepseek-v4-pro`）；V8/V10 恢复与 activation 断言未放宽，尚未执行 V11 runtime。

> 2026-07-20 — 收紧 V11 product runtime 的密钥边界：server Compose 不再持久映射根 `DEEPSEEK_API_KEY`，只在受控 activation 期间由内存中的 root key 注入一次性产品变量；default-off 与 cleanup 均显式清空。常规 Docker server Chat 继续 mock 默认，worker/web 和 OpenAI 路径未改，未执行 V11 runtime。

> 2026-07-20 — 修正 V11 owner-held revalidation 的 self-lock 误拦截：初始 preflight 仍要求 public/recovery/execution 三根为空；仅同一活跃 product owner 的 revalidate 可见并验证 recovery 根中唯一的 `owner.lock`。任何额外 recovery leaf、public/execution 内容、伪造/关闭/跨环境 owner 都 fail-closed，未执行 V11 runtime。

> 维护规则：`DEVLOG.md` 记录阶段级里程碑、关键工程决策和验收结果，不写逐提交流水账。每个关键阶段必须保留“目标 / 为什么 / 主要内容 / 边界 / 验收 / 回顾时可以问”，方便接手、复盘和面试表达。精简只压缩重复和噪声，不能删掉理解项目所需的动机、关键步骤和决策依据。完整路线看 `docs/roadmap.md`，当前数据边界看 `docs/data-flow.md`，面试复盘看 `docs/blogs/`，具体实现追溯看 `git log`。

## 当前快照

更新时间：2026-07-24

当前阶段：Phase 7 工程化已经完成；Phase 6.9.4.4 Router/Verifier、Phase 6.9.5 Review/Planner 与 Phase 6.9.6 KnowledgeDedup/Organizer 均已完成生产验收并恢复默认关闭。Phase 6.9.7 Task 0--11 已完成；Task 12 唯一 V1 Live run `39a62241...` 已使用真实 `deepseek_network` 执行并以 `quality_gate_failed` 封存。`24/24` zero-call、安全、延迟、usage 与费用通过，但 strict runtime 仅 `27/48`，Tutor/Organizer semantic 为 `0.3485119048/0.7`。因此产品 Docker service/API/可见浏览器未启动，两个生产 gate 的 tracked defaults 继续关闭；V1 不得重跑。下一步是零网络 V2 remediation，不进入 Task 13/main 合并或 Phase 6.10。

| 阶段                   | 状态     | 关键词                                                                                                                                                  |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0                | 已完成   | Monorepo、Prisma 初稿、Docker 基础设施                                                                                                                  |
| Phase 1                | 已完成   | 前端 MVP、AI 聊天、OCR、错题本、Dexie                                                                                                                   |
| Phase 2                | 已完成   | NestJS、Auth、PostgreSQL、业务 API 迁移、MinIO                                                                                                          |
| Phase 3                | 已完成   | OCR structured output、讲题 prompt、多题保存                                                                                                            |
| Phase 4                | 已完成   | FSRS、ReviewTask、离线评分、学习统计、复习计划                                                                                                          |
| Phase 5                | 已完成   | RAG 数据模型、文档处理、检索、Chat RAG、`/knowledge`                                                                                                    |
| Phase 6                | 补强中   | 多 Agent 基础、Trace 与业务 policy 已落地；真实模型 Agent、通信、权限、Orchestrator 与可执行 LangGraph 继续推进                                         |
| Phase 6.9.1            | 已完成   | Agent eval contract、32 个 seed cases、deterministic baseline、paired eval 模板                                                                         |
| Phase 6.9.2            | 已完成   | 共享 ModelAgentRuntime、结构化 Mock/Live contract、预算、超时取消、脱敏 Trace                                                                           |
| Phase 6.9.3.1          | 已完成   | ConversationSummary / ConversationState strict contract 与 PostgreSQL/Prisma 地基                                                                       |
| Phase 6.9.3.2          | 已完成   | ConversationState、Redis 降级缓存、prepare API 与 Chat history state 恢复                                                                               |
| Phase 6.9.3.3          | 已完成   | 12 条/70% 滚动摘要、ModelAgentRuntime、凭据防护、source hash 与 CAS                                                                                     |
| Phase 6.9.3.4          | 已完成   | conversationId/prepare 编排、分层 assembler、Dexie v9 sanitized state、安全 headers/Trace                                                               |
| Phase 6.9.3.5          | 已完成   | Docker Mock/Live、DeepSeek JSON structured output、Trace 分层 token、清理与阶段证据                                                                     |
| Phase 6.9.5            | 已完成   | V10 语义质量 authority、V22 recovered 历史、独立真实模型 Docker API/浏览器验收、main default-off 回放与两轮合成数据清理                                 |
| Phase 6.9.6.1          | 已完成   | 72-case contract、24/48 zero-call/runtime、deterministic `12/48`、semantic `0.2322452551`、无 provider                                                  |
| Phase 6.9.6 Task 2     | 已完成   | strict schema、动态关联校验、完整字段先扫描、ordinal-only 安全投影、hostile accessor fail-closed；无 provider                                           |
| Phase 6.9.6 Task 3     | 已完成   | Dedup 受治理 candidate、本地权威 merger、exact-hash provider 前 0-call、全失败 deterministic fallback；仅无网络 executor                                |
| Phase 6.9.6 Task 4     | 已完成   | Organizer 受治理 candidate、本地权威 merger、标签/集合限制、post-schema 安全扫描、全失败 deterministic fallback；仅无网络 executor                      |
| Phase 6.9.6 Task 5     | 已完成   | `REPEATABLE READ` + `READ ONLY` owner snapshot、HMAC fingerprint、provider 前 stale fence；无 provider                                                  |
| Phase 6.9.6 Task 6     | 已完成   | Qwen pgvector semantic shortlist、6 Chunk/资料、top-3 mean、最多 12 pair、provenance/safety/fingerprint 漂移门；无 provider                             |
| Phase 6.9.6 Task 7     | 已完成   | default-off 双 gate、DeepSeek V4 Pro non-thinking runtime、精确价格/cap、冻结共享预算；尚未编排到 API                                                   |
| Phase 6.9.6 Task 8     | 已完成   | 独立 gate 并行 dispatch、二次 stale fence、strict runtime metadata、parent+2-step Trace、HTTP abort；无 provider                                        |
| Phase 6.9.6 Task 9     | 已完成   | `/knowledge` 语义/本地/降级来源 badge、空建议来源说明、移动端换行、无 retry/mutation/敏感 metadata                                                      |
| Phase 6.9.6 Task 10    | 已完成   | 72-case strict paired runner、24 条实际 guard zero-call、48 runtime/24 pair、Mock/Live CLI 与 evidence validator；无 provider                           |
| Phase 6.9.6 Task 11    | 已完成   | API-only Knowledge credential/gate/timeout、worker zero-executor、独立回滚与 provider retention/安全清理文档；无 provider                               |
| Phase 6.9.6 Task 12    | 已完成   | 分支 focused/full/static、deterministic/Mock/validator、Windows evidence 字节与历史 bridge hermetic 修复；无 provider/产品 Docker/浏览器验收            |
| Phase 6.9.6 V2 Live    | 已完成   | 唯一 run `10ae2f36...`：72 cases、24/24 zero-call、48/48 runtime、semantic `0.9875`、`quality_gate_passed`；不可重跑                                    |
| Phase 6.9.6 Task 13    | 已完成   | R7 Docker/API、可见浏览器、只读/权限/Trace/清理与独立复审保持不可变；main default-off 回放、零残留和 push 已通过                                        |
| Phase 6.9.7 Task 0     | 已完成   | Tutor/Organizer 混合模型专项设计、权限/预算/72-case/生产验收路线冻结；无 provider                                                                       |
| Phase 6.9.7 Task 1     | 已完成   | 72-case/32-decision baseline：`6/48`、Tutor `0.4418666667`、Organizer `0.278125`；无 provider                                                           |
| Phase 6.9.7 Task 2     | 已完成   | strict contract、动态关联、完整字段扫描、ordinal-only 投影与 descriptor clone hardening；无 provider                                                    |
| Phase 6.9.7 Task 3     | 已完成   | Tutor governed candidate、冻结 12+24 eligibility、`1/1200/300`、strict runtime 与 local merger；仅无网络 Mock，未接产品                                 |
| Phase 6.9.7 Task 4     | 已完成   | WrongQuestionOrganizer governed candidate、最多 12 题/20 deck、`1/3500/800`、ordinal-only strict runtime 与 local merger；仅无网络 Mock，未接产品       |
| Phase 6.9.7 Task 5     | 已完成   | Tutor Web server-only default-off runtime、Chat 编排、独立预算与安全 Trace；无 provider/产品 Live                                                       |
| Phase 6.9.7 Task 6     | 已完成   | Organizer owner snapshot、事务外双 fence、advisory-lock 第三 fence、model-free command、用户 authority 与并发 E2E；无 provider                          |
| Phase 6.9.7 Task 7     | 已完成   | Organizer server-only default-off runtime、single/batch 单次 dispatch、两阶段 Trace、HTTP abort 与真实 PostgreSQL Trace contract；无 provider/产品 Live |
| Phase 6.9.7 Task 8     | 已完成   | Organizer strict request-level API runtime、`/error-book` local/hybrid/degraded 来源状态与移动端安全展示；无 provider/产品 Live                         |
| Phase 6.9.7 Task 9     | 已完成   | 72-case strict paired runner、24 条实际 guard zero-call、48 runtime/24 pair、Mock/Live CLI 与 evidence validator；无 provider/Docker/浏览器             |
| Phase 6.9.7 Task 10    | 已完成   | Tutor→web、Organizer→server Docker allowlist、tracked default-off example、worker/admin 隔离与运维回滚；无 provider/Docker service/API/浏览器           |
| Phase 6.9.7 Task 11    | 已完成   | focused/full/static、baseline、fresh strict Mock、Organizer PostgreSQL E2E、Compose quiet config 与双路终审；无 provider/Live/产品 Docker/浏览器        |
| Phase 6.9.7 Task 12 V1 | 失败封存 | 唯一 `deepseek_network` run：24/24 zero-call、27/48 strict runtime、Tutor/Organizer semantic `0.3485119048/0.7`、`quality_gate_failed`；未进入产品验收  |
| Phase 7.0              | 已完成   | BackgroundJob 控制面                                                                                                                                    |
| Phase 7.1              | 已完成   | BullMQ 文档处理队列、inline / queue 双模式                                                                                                              |
| Phase 7.2              | 已完成   | RAG SafetyGuard、prompt injection chunk 过滤                                                                                                            |
| Phase 7.3              | 已完成   | EventBus 失败隔离、后台任务 summary、`/knowledge` 任务摘要                                                                                              |
| Phase 7.4              | 已完成   | Swagger / OpenAPI debug docs、`/api-docs`、response envelope                                                                                            |
| Phase 7.5              | 已完成   | Swagger 中文说明、核心写接口 request body 示例                                                                                                          |
| Phase 7.6              | 已完成   | API / worker 启动拆分、worker-only application context                                                                                                  |
| Phase 7.7              | 已完成   | Worker Observability、Redis heartbeat、队列 backlog                                                                                                     |
| Phase 7.8.1            | 已完成   | RAG Eval Baseline、固定评估集、recall / top1 / safety 指标                                                                                              |
| Phase 7.8.2            | 已完成   | Hybrid Retrieval、向量候选 + PostgreSQL full-text 融合排序                                                                                              |
| Phase 7.8.3            | 已完成   | RAG Eval Smoke、本地 API 级上传/处理/检索/eval 串联                                                                                                     |
| Phase 7.8.4            | 已完成   | RAG Eval Smoke 收尾增强、case guard、keep-data 开关                                                                                                     |
| Phase 7.9.1            | 已完成   | Durable Outbox 地基、claim / retry / dead-letter 状态机                                                                                                 |
| Phase 7.9.2            | 已完成   | Outbox Dispatcher 最小闭环、handler registry                                                                                                            |
| Phase 7.9.3            | 已完成   | Outbox Dispatcher worker-only 受控运行、防重入 tick                                                                                                     |
| Phase 7.9.4            | 已完成   | Outbox Summary / Metrics、worker observability 只读指标                                                                                                 |
| Phase 7.10             | 已完成   | Outbox Ops 后端闭环、脱敏列表/详情、安全 requeue                                                                                                        |
| Phase 7.11             | 已完成   | Worker Readiness、`/worker-readiness`、部署前 CLI                                                                                                       |
| Phase 7.12             | 已完成   | Docker worker healthcheck、容器级 readiness                                                                                                             |
| Phase 7.13             | 已完成   | Docker Web 镜像、Next standalone、全栈 Compose 验收                                                                                                     |
| Phase 7.14.1           | 已完成   | Operator 权限与操作审计设计文档                                                                                                                         |
| Phase 7.14.2           | 已完成   | OperatorGuard、系统级诊断入口 admin-only                                                                                                                |
| Phase 7.14.3           | 已完成   | `OperatorAuditLog`、审计 service、脱敏 metadata 与来源 hash                                                                                             |
| Phase 7.14.4           | 已完成   | Outbox requeue 成功/失败审计接入                                                                                                                        |
| Phase 7.14.5           | 已完成   | `GET /operator-audit-logs`、admin-only 脱敏审计查询 API                                                                                                 |
| Phase 7.14.6           | 已完成   | `/operator-audit` 管理员审计台、ADMIN 侧边栏入口、脱敏列表筛选                                                                                          |
| Phase 7.15             | 已完成   | 管理员审计台真实运行验收、Docker dev 诊断开关、`127.0.0.1` hydration 修复                                                                               |
| Phase 7.16             | 已完成   | 独立桌面端 Admin Console、Outbox Ops 操作页、审计/Worker 页面、学习端后台入口                                                                           |
| Phase 7.17             | 已完成   | Docker Admin Console service、`3100` 独立容器、全栈 Compose 验收                                                                                        |
| Phase 7.17.1           | 已完成   | 管理员后台返回学习端 host 对齐、loopback 登录态排障记录                                                                                                 |
| Phase 7.18             | 已完成   | Admin Outbox Ops 产品化、事件详情分区、requeue 后续验证                                                                                                 |
| Phase 7.19             | 已完成   | Admin Console 控制台数据化、真实运维总览、后台管理复盘博客                                                                                              |
| Phase 7.20             | 已完成   | Operator Audit 详情闭环、审计详情双栏、脱敏详情 API                                                                                                     |
| Phase 7.21             | 已完成   | Admin Ops 交互收口、自定义筛选控件、Outbox requeue 原因必填                                                                                             |
| Phase 7.22             | 已完成   | Docker Admin Ops 真实验收、普通用户 403 拦截、测试数据清理、后台 favicon 收口                                                                           |
| Phase 7.23.1           | 已完成   | 180 天审计保留、异步 ZIP 证据包、事务型 Outbox、fail-closed 下载审计设计                                                                                |
| Phase 7.23.2           | 已完成   | strict export contract、Prisma export/maintenance 模型、ACCOUNT/SYSTEM job、生产关闭配置                                                                |
| Phase 7.23.3           | 已完成   | Serializable 申请事务、strict audit、HMAC 指纹、Outbox-only BullMQ 投递                                                                                 |
| Phase 7.23.4           | 已完成   | 单并发 ZIP Worker、REPEATABLE READ、formula-safe CSV、lease/CAS、attempt-fenced MinIO                                                                   |
| Phase 7.23.5           | 已完成   | 小时级维护、24h/180d 清理、active-export 水位、stale repair、crash janitor、三队列 readiness                                                            |
| Phase 7.23.6           | 已完成   | 系统级 ADMIN 查询/详情、稳定游标、binary envelope bypass、strict 下载审计                                                                               |
| Phase 7.23.7           | 已完成   | `/audit` tabs、证据包申请/查询/详情、幂等重试、authenticated Blob 下载、a11y                                                                            |
| Phase 7.23.8           | 已完成   | API/Worker Docker 拓扑、下载/过期/清理 smoke、真实浏览器验收、面试博客                                                                                  |

## 近期关键记录

### 2026-07-19 - V10 branch product-acceptance terminal recovery

结果：V10 的唯一 branch product-acceptance ledger 在 `slot-01-review-api` durable claim 后、结果 leaf 之前以脱敏 `operation_failed` 终止。后续 recovery-only 已成功将 server 恢复为 mock/default-off，且用精确 selector 清理合成账号、fixture、Trace 与临时浏览器 profile；recovery 本身为 `0` provider invocation、`0` acceptance request、`0` browser continue。

边界：这是一条独立的 V10 product 终态，不是 V10 controlled-Live 失败，也不能重跑、reset、补写、重用或解释为 zero-call / zero-cost。原 runner 将 trace baseline、API dispatch、response schema、Trace 读取和 slot 写入统一折叠为 `operation_failed`，所以不能从此安全证据逆推原始根因。

下一步：先设计和实现新的 V11 product-acceptance lineage。它只增加 fixed failure checkpoint、component/slot 与保守 provider-call state，不落 prompt、response、raw error、credential、token、用户 facts 或单次 usage。在 Mock/fake 验证与复审通过前，两个 product gate 继续 default-off。完整证据见 `docs/acceptance/phase-6-9-5-review-planner-v10-product-acceptance-recovery.md`。

### 2026-07-19 - V10 product-acceptance 隔离 lineage

目标：在不重跑已通过的 V10 controlled-Live、也不改写 V8 `recovery_only` 历史的前提下，为后续 branch 产品验收建立独立的 V10 命名空间。

主要内容：新增不可变 profile，统一 V8/V10 的 public ledger 根目录、recovery 临时根目录、可见浏览器 profile 路径与 product/recovery 确认令牌；新增 V10 product/recovery CLI 与 package 命令。V10 branch 只读取已经封存的 V10 Live authority；V8 与 V10 使用不同 owner lock、ledger 与 recovery 目录，四请求上限、default-off 恢复、owner、ledger、recovery 与 cleanup 约束不变。两条 lineage 复用同一份严格 wire schema（数据语义没有变化），本次隔离的是运行和证据命名空间，不进行 schema migration。

验收边界：Windows native 测试先完成 V8 `recovery_only`，再成功获取 V10 owner 并预留 V10 branch ledger，证明旧终态不会授权、阻断或写入新 lineage。该提交不运行 Docker、浏览器、真实模型，不修改 `.env`、V8/V10 evidence，也不打开产品 gate。

回顾时可以问：为什么 V10 不能复用 V8 的 recovery-only ledger？V10 CLI 如何拒绝 V8 confirmation？新的 namespace 如何保留原有 cleanup/default-off 安全边界？

### 2026-07-19 - V8 branch product-acceptance recovered archive

结果：旧 V8 branch 产品验收先因遗漏 preflight 参数在 provider 前以 `0-call` 失败；随后首次实际分支尝试暴露 runner parse bug，并写入 recovery-only terminal。恢复过程没有新 provider 调用，cleanup 为零。

边界：该证据仅归档历史失败，既不是 V10 controlled-Live failure，也不能 reset、重用或扩展。旧 V8 evidence 保持只读，产品 gate 继续默认关闭；下一步必须建立新的隔离 V10 product-acceptance lineage，不能直接进入 Docker、浏览器、main 或 push。

### 2026-07-19 - Phase 6.9.5 V10 唯一 controlled-Live outcome

目标：在不扩大模型权限、不开启产品 gate 的前提下，验证只返回 `focusIndexes` / `blockOrder` 的 V10 真实模型路径。

结果：唯一 CLI exit `0`；public reader 五次 fresh read 均为 `complete / passed`。安全 aggregate 为 V10 v3，`23` provider attempts、`22` paired admissions、`48/48` strict/quality、critical `0`、P95 `1465ms`、usage `5764/232`、CNY `0.018684/1.00`；schema、quality、P95、usage、attempt、admission 与 cost 全通过。V1--V9 manifest 保持 `36` entries / `61a6e4a956784a59a8b8639d4c94d6fd870bce5dd8549a026abf02a0e7cb769d`。

边界：根 `.env` 未改，普通环境继续 mock/default-off；V10 evidence/success seal 已封存且不得改写、重跑、删除或拼接。两条产品 gate 仍为 `false`，没有运行 Docker、浏览器、main merge、replay 或 push。下一步是逐组件的分支 Docker/headed-browser 验收，结束后恢复默认关闭。完整证据见 `docs/acceptance/phase-6-9-5-review-planner-v10-offline-checkpoint.md`。

回顾时可以问：为什么 V10 的质量门只评价产品实际合并的两个字段？为什么 Live passed 后仍要保持产品 gate 关闭并单独做产品验收？

### 2026-07-19 - Phase 6.9.5 V10 offline checkpoint

目标：以最小修复让模型的可见 contract 与产品实际合并的 Review `focusIndexes` / Planner `blockOrder` 一致，同时不扩大模型权限。

边界：V9 仍是不可改写的 `quality_gate_failed` 历史。V10 还没有 evidence directory、once marker 或 success seal；产品 gate 均为 `false`，没有运行 Live、Docker、浏览器、main replay 或 push。V10 writer/reader 只发布 strict safe lane aggregate，拒绝 prompt、snapshot、model output、raw error、URL、credential、cookie、stack 和 per-case timing/usage。

验收：V10/V8/V9/composition Jest `266/266`、Agent `409/409` 与 typecheck、server lint/build、V10 native `3/3` 和 `git diff --check` 已通过；V1--V9 fresh manifest 为 `36` entries / `61a6e4a956784a59a8b8639d4c94d6fd870bce5dd8549a026abf02a0e7cb769d`。唯一 Live 仅可从根目录 `--env-file=.env` 注入凭据，在独立进程中开启 V10 eval gate 并显式关闭 V8/V9 eval 与两条产品 gate；固定 `deepseek-v4-pro`、JSON-object non-thinking、`4500ms`、`23/22` 和 CNY `1.00`。完整记录见 `docs/acceptance/phase-6-9-5-review-planner-v10-offline-checkpoint.md`。

回顾时可以问：为什么 V10 只评估产品真正使用的两个字段？为什么 V9 的质量失败不能用 V10 离线通过抵消？为什么 `.env` 只能用于命令注入而不能写入 gate？

### 2026-07-19 - Phase 6.9.5 V9 Task 1--5 离线 checkpoint

目标：在不改写 V1--V8、不运行新 provider 调用和不开启产品 gate 的前提下，为 V8 未形成 durable terminal aggregate 的缺口建立独立 V9 lineage，并让产品验收只依赖 V9 committed success。

为什么：V8 CLI stdout 的 23 attempts 没有形成可供产品 admission 使用的 durable success。继续读取 V8 provisional/public projection、拼接历史计数或用 `git show` 构造成功都会破坏 one-shot 与证据权威边界。V9 因此必须拥有独立 eval gate、aggregate diagnostic、durable evidence、once-only CLI 和 product authority。

主要内容：`ef0cf5f` 固定 V9 strict safe aggregate contract，`36fb988` 捕获同一次 paired run 的 aggregate，`25b1a3e` 增加 durable evidence，`697ca9f` 增加 controlled-Live CLI，`683a209` 将 product acceptance 改绑 V9。Authority 仅接受 `finalized / complete / closed / passed`、23 provider attempts、22 paired admissions 与 lowercase 64-hex evidence SHA；完整 V9 leaf 集合必须全部为 Git ordinary `H`，并在读取前后保持 leaf、commit、branch、clean 一致。任何 pending、`evidence_io`、未知 profile、非法 hash、assume-unchanged、skip-worktree、缺失/额外 leaf 或漂移都在 ledger、Prisma、Docker、浏览器前关闭；无 legacy V8 reader 或 `git show` 回退。

边界：本段是 V9 运行前的离线 checkpoint；实际 Live 终态见下一条。V1--V8 继续只读；离线阶段的 V9 eval gate、`REVIEW_AGENT_MODEL_ENABLED` 与 `PLANNER_AGENT_MODEL_ENABLED` 均缺省关闭，产品继续 deterministic。

验收：V9 focused `136/136`；Server `1381 passed / 30 skipped`；Review E2E `3/3`；Web `409/409`；AI `190/190`；Agent `406/406`；shared types typecheck exit 0；Review/Planner Windows native 按各自正确 cwd 合计 `133/133`，其中 V5/V6 cwd 是命令入口契约而非代码失败；product acceptance `131/131`；lint/build/Compose/diff 均 exit 0。contract/security 复审 PASS，无未关闭 Critical/Important。完整边界见 `docs/acceptance/phase-6-9-5-review-planner-v9-offline-checkpoint.md`。

回顾时可以问：为什么 V9 offline 通过仍不能写成 Live success？为什么 product authority 必须绑定完整 ordinary-`H` leaf 集合和前后 Git snapshot？为什么 eval gate 为 true 也不能打开 Review/Planner 产品 gate？

### 2026-07-19 - Phase 6.9.5 V9 唯一 controlled-Live 终态

目标：在不启用产品 gate 的前提下，用独立 durable V9 lineage 验证 Review/Planner 真实模型建议的质量、权限、预算和性能。

结果：首次 workspace 入口因根 `.env` 未传播到 `apps/server` 而 `preflight_invalid / 0-call`，没有消费 V9。根 `.env` 显式注入后的唯一运行完成 `23` provider attempts、`22` paired admissions、`26` verified zero-call、`48` strict successes；durable reader 返回 `finalized / invalid_attempted / closed / quality_gate_failed`。P95 `1396ms`、usage `7943/510`、CNY `0.026889/1.00` 和 attempt/admission/schema gates 全通过，但 quality `30/48`、semantic `4/22`、critical `2` 未达门槛。

边界：V9 once/evidence 已消费且不可重跑、覆盖或删除；没有 success seal，产品 authority fail-closed。因此没有 Docker、浏览器、Trace、合成账号、main replay 或 push。Review/Planner 产品 gate 已恢复缺省关闭，产品仍 deterministic。下一步只能以最小质量根因修复建立新 lineage。

> Lineage 边界：以下 V6--V9 均是 **Phase 6.9.5 Review/Planner** 的历史记录，与当前
> **Phase 6.9.7 Tutor/Organizer V7** 不是同一 lineage。不得把下文任何 Live 终态、marker、授权或后续
> 计划用于当前 Phase 6.9.7；后者已完成 R0--R3 zero-provider checkpoint，唯一 R4 随后以
> `quality_gate_failed` 封存且不得重跑，R5/R6/main 被阻断。

### 2026-07-18 - Phase 6.9.5 V8 唯一 controlled-Live 终态

目标：在两个产品 gate 保持关闭的前提下，只执行一次 V8 DeepSeek V4 Pro non-thinking 评测，并仅依据 durable committed evidence 决定能否进入产品验收。

结果：零网络 preflight 为 `ok=true`，工作树 clean，V8 目录不存在，V1--V7 snapshot 为 20 entries / `6078891e6c962bc5c8e57471017d7f64e210c5f4ffd867c96136e33983ac2bd6`。唯一命令执行 23 次 provider attempt 后返回 `invalid_attempted / closed / usageKnown=false / invalid_response`。durable marker 连续到 `.stage-080-paired-returned`，没有 `.stage-090-report-validated`、candidate 或 success seal；因此失败位于 paired evaluator 已返回、report/cost/admission 完整成功门尚未通过的边界。

落盘 231-byte 文件仍为 provisional `state=attempted / providerAttemptCount=0 / usageKnown=false / transport`，SHA-256 为 `82813d58d70a438fb3942358c1ab49f85a52c17e319ca4261c98f7f56c39e0a7`；89-byte once marker SHA-256 为 `c014e04a7aa9a695971fe307a5b9909e0172c2e9cb0af7a1dcf0b39d5ff9733d`。public reader 则返回 `invalid_attempted / closed / 0 / false / evidence_io / lastStage=.stage-080-paired-returned`。因此 23/`invalid_response` 只有本次 CLI safe stdout 支撑，未被 finalizer durable commit；落盘与 public reader 的 0 都不能解释为 zero-call、零成本或否认已发生的外部尝试。

边界：V8 不可重跑，不拼接 V1--V7，不把 23 attempts 推导为 strict/quality/P95/usage/cost 通过，也不把 public reader 的 0 推导为零费用。由于没有 committed success，branch Docker/API/可见浏览器/Trace acceptance、main 合并、main replay 与 push 均禁止。两个产品 gate 继续 `false`。

回顾时可以问：`.stage-080` 精确证明了什么？为什么 CLI stdout 的 23/invalid_response、provisional 文件的 0/transport 与 public reader 的 0/evidence_io 必须分开记录？为什么没有 `.stage-090` 就不能读取或补写质量 counters？

### 2026-07-18 - Phase 6.9.5 V8 最终离线工程 checkpoint

目标：在不运行唯一 V8 controlled-Live 的前提下，把 stage evidence、provider composition、产品 admission、branch/main durable ledger、recovery 和真实产品 runner 收口到可执行、可恢复、可审计的同一边界。

为什么：只验证 Mock 或单个 adapter 不能证明真实 runner 会遵守正式 evidence contract。最终复审发现实际 `acceptance.json` 曾使用 ledger 私有简化 schema，绕过正式 strict schema；按 TDD 增加 fresh ledger 集成 RED 后，normal finalize、preseal 与 fresh complete reader 已统一到 exported official schema/serializer，防止 branch/main 产物缺字段或逃逸禁存约束。

主要内容与边界：V8 使用 15-stage durable marker、V1--V7 immutable snapshot、DeepSeek V4 Pro non-thinking one-shot CLI；产品路径使用 server-only component/capability admission、每环境四 slot durable ledger、owner lifetime lock、Docker container identity/health attestation、owner-scoped Prisma facts、authenticated API、headed Chrome exact profile、Trace/facts/default-off/cleanup receipts。两个产品 gate 仍为 `false`，真实 V8 evidence/once marker 与产品 acceptance 目录均未创建；本 checkpoint 没有 provider、Docker recreate 或浏览器副作用。

验收：Server `1265 passed / 30 skipped`，Review E2E `3/3`，Web `409/409`；Windows durable I/O、V8 stage evidence、product ledger native，Agent/AI/types，Server/Web lint/build，Compose `config --quiet` 与 `git diff --check` 全部 exit 0。official-schema 修复后 native ledger `55/55`、相关 Jest `138/138`；contract/security 与 acceptance/operations 复审均无未关闭 Critical/Important。实现 checkpoint 为 `faa97a8`。

回顾时可以问：为什么实际写盘 `acceptance.json` 必须与正式 schema 共用同一个 serializer？为什么 branch/main 产品验收需要 durable slot ledger 和 recovery owner lock，而不能靠内存计数？为什么离线门全绿仍不能称为 Review/Planner 真实模型可用？

### 2026-07-18 - Phase 6.9.5 V8 stage-diagnostics completion 设计

目标：在不重跑或改写 V7 的前提下，为新的 one-shot lineage 建立可定位的 durable stage evidence，并把真实模型质量门、产品验收、main 复验、推送和安全关机串成完整完成条件。

为什么：V7 的 `evidence_io` 同时覆盖 paired-result/orchestration 和 finalization/history 多个边界，23 attempts 不能证明 paired report 返回或质量通过；只给 terminal JSON 增加 stage 又无法覆盖 terminal write 自身失败。现有运维文档还把 Review/Planner 回滚错误地指向 `web`，且没有冻结 main 复验语义、精确产品 fixture 与关机前凭据/进程收口。

主要设计：V8 使用 15 个固定文件名、零字节、append-only、exclusive-create stage markers；success seal 绑定完整 stage manifest、candidate、历史 tree 与 commitment。保留 DeepSeek V4 Pro non-thinking、48/26/22、23 attempts、4500ms、CNY 1.00 和两个产品 gate `false` 的质量边界。V8 complete 后按 Review-only -> 重建 default-off `server` -> Planner-only -> 再次 default-off 的顺序验收 API、`/plan`、`/today`、Trace、owner isolation 和只读事实；已消费 paired lineage 不在 main 重跑。

实现复审补强：native close-failure RED 证明“直接写公开 marker/seal，再把 close 成功作为 committed 条件”无法被跨进程 reader 从相同字节验证。V8 因此让 once、15 个 stage 与 seal 都先写 fixed private prepare leaf 并 durable-close，再在同一 no-reparse directory HANDLE 下 existing-only 重开并用 `NtSetInformationFile` exclusive rename 到各自 public leaf；rename 是唯一 commit 点，之后 handle close 仅是 cleanup，不删除或撤销已提交 leaf。路径型 `MoveFileExW`、rename 后新增成功门、失败删除/补偿与 provider 重跑均禁止。

durability 口径同时收紧为 local fixed NTFS 上的 process crash/restart，不宣称物理断电或其他文件系统；实现必须有 volume preflight 与 rename 前/后 child hard-exit evidence。prepare leaf 由 committed leaf 内部唯一派生，V8 只允许 once/15-stage/success 固定目标。任一 prepare/public leaf 遗留都阻断后续 reservation；若失败发生在首个 prepare 创建前，只能证明本 invocation 零重试/零 provider，任何新 invocation 仍需用户重新授权。

安全边界：stage marker 无正文，不含 prompt、response、case id、token、cost、credential、URL 或 raw error；V1--V7 全部只读。最终只允许 `docker compose stop` 保留容器/镜像/volume/data，禁止 `down`、`down -v`、prune、reset、flush 或 wipe。

验收：设计自检无 TBD/TODO/未定项；两条独立只读审计已分别覆盖 contract/security 与 acceptance/operations。Task 1 durable I/O 与 Task 2 V8 evidence/state machine 已按 TDD 提交，但 native close-failure 复审又暴露 final publication 悖论，当前正在按本节 rename commit amendment 补 RED/GREEN；尚未创建真实 V8 evidence/once marker、调用 provider、启动 Docker 或浏览器。

回顾时可以问：为什么零字节 append-only markers 比 terminal `diagnosticStage` 更可靠？为什么 Review/Planner gate 恢复必须重建 `server` 而不是 `web`？为什么 main 不能重跑已经消费的 paired lineage？

### 2026-07-18 - Phase 6.9.5 V7 controlled-Live 终态关闭

目标：在不启用产品 gate 的前提下，执行获批的唯一 V7 DeepSeek V4 Pro controlled-Live，最多一个 canary + 22 个 paired runtime。

主要事实：根 Bun 进程仅对本轮显式设置 Live/eval gate，两个产品 gate 固定为 `false`。零网络 preflight 确认 `deepseek-v4-pro / deepseek-v1 / nonthinking JSON / 4500ms`、V1--V6 18-entry tree hash 与 CNY 1.00 hard cap。唯一运行耗时约 49.7s，终态 stdout 与 public reader 都为 `invalid_attempted / closed / providerAttemptCount=23 / usageKnown=false / evidence_io`。

证据：once marker SHA-256 `1920c68d8fd10d77af1cf63731e46ed8e9c02270093a024302b24eb97fa85bda`；JSON `review-planner-live-20260717T161356046Z-e26f821fdc46.json`，245 bytes，SHA-256 `79c07fed05a011a6344e7df3aecd9c616824c6a7cd07873693f3ddfaab1a63ba`。无 success seal、无 aggregate token/cost，V1--V6 tree hash 运行后仍为 `9f8cc9a7d5ba83d630fa5806f19aaa74066352de92bb04631813c17feaa230ba`。

根因边界：两个独立只读复核将问题收窄到“全部 23 个允许的 provider attempts 被安全计数后，paired-result/orchestration failure 或 evidence finalization/history I/O failure 被折叠为 `evidence_io`”。当前字节可以排除已 committed success、纯 seal-create failure、preflight/canary 前失败和 `success_candidate` 的 downgrade-write failure；但无法唯一区分 paired-result failure、CLI final history verify、finalizer internal verify/terminal replace、candidate 后瞬时 history failure + 成功 downgrade，也不能反推 provider 质量、usage 或账单。

边界：V7 once marker 已消费，严禁重跑、删除或重建 evidence。任一门失败按设计停止 Docker/浏览器/main/push，两个产品 gate 保持 `false`。

回顾时可以问：为什么 23 attempts 不等于 22 个 paired case 质量通过？为什么 `evidence_io` 的有损脱敏使得子阶段不可唯一恢复？为什么没有 success seal 必须停止产品验收？

### 2026-07-17 - Phase 6.9.5 V7 Task 7 独立复审与 success seal 收口

目标：完成 contract/security 与 acceptance/operations 两轮独立离线复审，并关闭 terminal evidence replacement 后历史漂移可能留下假成功证据的 TOCTOU 窗口。

为什么：旧顺序在写入 `complete` 后检测到 V1--V6 漂移时，若降级替换本身再失败，磁盘可能残留可被误读的 `complete` JSON。仅检查 boolean 无法解决，必须把“存在候选 JSON”与“证据已成功提交”分离。

主要内容与边界：成功先写成公开 schema 不接受的私有 `success_candidate`，单次 25ms quiescence 后 fresh 复核 V1--V6，再 exclusive-create 与 evidence leaf、candidate SHA-256、历史 tree hash 和 nonce commitment 绑定的无数值 success seal。唯一公开 reader 只有在 once marker、candidate、seal、hash/commitment 与 fresh history 全部一致时才投影逻辑 `finalized/complete`；任一缺失、伪造、reparse、降级写失败或 seal 创建失败都固定返回不含 token/cost 的 `evidence_io`。无 provider/file retry loop，reservation 仍只公开 `relativePath/markAttempted`，产品 gate 未改变。

当时验收：缺陷回归先观察到 RED；修复后 evidence Jest `5/5`、Windows native `15/15 / 130 assertions`、targeted ESLint、Server build 与 diff check 通过。contract/security 和 acceptance/operations 复审均为 PASS，Critical/Important/Minor 均为 0。该离线复审时尚未运行 V7 package script、controlled-Live、Docker 或浏览器，未创建真实 V7 marker/evidence，未开启业务 gate；后续唯一 Live 终态见上文 2026-07-18 记录。

回顾时可以问：为什么 standalone `complete` JSON 不再是成功证据？为什么 downgrade 写失败后没有 success seal 仍能 fail-closed？为什么 Task 7 离线通过当时仍不构成 Live 授权，而该唯一授权在 2026-07-18 消耗后不得再次运行？

### 2026-07-17 - Phase 6.9.5 V7 全量离线验收

目标：在不接触 provider、Docker 运行态或浏览器的前提下，对 V7 transport、factory、evidence、CLI、composition、权限和项目构建做一次完整、可复核的离线收口。

为什么：局部 97-token 回归或 48-case fake 成功只能证明一个 contract；只有把 AI/Agent/Server/Web/types、不可变历史、默认关闭 gate 和只读 merger 一起检查，才能在申请下一次 Live 前排除工程漂移，同时仍不把离线结果冒充 provider 证据。

主要内容与边界：focused gate 为 AI 190、Server 86、Windows native evidence 9/40 assertions；V1--V6 snapshot 为 integrity-v3、18 entries、aggregate tree hash `9f8cc9a7d5ba83d630fa5806f19aaa74066352de92bb04631813c17feaa230ba`，并固定 V6 marker/JSON 哈希。全量 gate 为 AI 190、Agent 406、Server 980 passed/30 skipped、Web 409；AI/types typecheck、AI/Server/Web lint、Server/Web build、Compose 静态 `config --quiet` 与 diff check 均 exit 0。Compose 没有执行 `up/build/down` 或输出渲染配置。V7 package script、controlled-Live、Docker 服务、浏览器、真实 key、provider、真实 V7 evidence/marker 均未触达。

当时结论：V7 offline engineering ready；controlled-Live not run and not authorized。Review/Planner product path remains deterministic because both model gates are false。该结论只描述 2026-07-17 的离线收口；后续唯一 V7 Live 已于 2026-07-18 终态关闭，不能按当时设想继续产品验收。

回顾时可以问：为什么 190/86/9 的 focused gate 与 190/406/980/409 的全量 gate 都不能证明 provider 质量？为什么只读读取 V1--V6 tree hash 不会消费 V7 once marker？为什么 Compose `config --quiet` 不是 Docker 启动验收？

### 2026-07-17 - Phase 6.9.5 V7 Mock 与 production-composition parity（离线）

目标：证明 V7 诊断使用的 DeepSeek V4 Pro non-thinking transport 与产品候选 composition 对齐，同时继续隔离评测 gate、产品 gate、模型输出和本地写权限。

为什么：仅在 evaluator 测试里看到相同 model 字符串不足以证明生产一致性；直接暴露 executor config 又会泄露 URL/key。另一方面，fake executor 的 48-case 成功如果被标成 Live，会把工程回归误写成 provider 质量证据。

主要内容与边界：新增 sanitized composition identity，仅返回 `deepseek / deepseek-v4-pro / deepseek-v1 / deepseek_v4_pro_nonthinking_json / 4500ms / review-model-candidate-v1`，对象冻结且不含 URL、凭据、pricing 或 executor；同一测试把它与 production private/public resolver 逐字段 cross-compare，并把 schemaId 锚定到 canary 实际使用的 canonical schema。V7 eval gate 不在 production allowlist；业务 gate 缺失或均为 `false` 时，即使 eval gate 为 true 也不会构造 executor，只返回 deterministic Mock suggestions。直接 Mock runner 的 48-case 决定固定为 `mock_quality_not_evidence`；strict fake 穿过 V7 evaluator 的另一条回归仅用于 live-shaped engineering contract，外层固定标为 `mock_quality_not_live_evidence`。两条离线证据计数均为 `26` verified zero-call、`22` runtime、`48` strict、`48` quality pass、`0` critical，均不能充当 provider evidence。模型 schema 只允许选择本地 snapshot 的 index/order，不能生成或修改 FSRS、minutes、links、owner facts、persisted records 或 write permissions。

当时验收：focused factory/config/runtime 61/61、`@repo/agent` 406/406、ReviewAgent owner-scope server 7/7；静态扫描确认 V7 eval gate 未进入 Docker、Web、worker 或 server config allowlist。该离线验收时没有运行 V7 package script、Live、Docker 或浏览器，没有创建真实 V7 marker/evidence，也没有开启 Review/Planner 产品 gate；后续唯一 Live 终态见上文 2026-07-18 记录。

回顾时可以问：为什么 parity helper 使用 `deepseek-v1` identity 而不返回真实 URL？为什么 48/48 Mock 仍不能说明 provider 可用？为什么 eval gate 为 true 也不能开启产品 Review/Planner runtime？

### 2026-07-17 - Phase 6.9.5 V7 one-shot CLI（离线）

目标：为新的 V7 usage-parity profile 提供唯一、显式且可审计的 orchestration 入口，同时保证普通测试、构建、服务启动和业务请求都不会隐式触发真实模型。

为什么：V7 evidence 是一次性 capability。若 CLI 对确认参数、历史完整性、attempt marker、evaluator 构造、canary、paired eval 或 finalizer 的顺序处理不严，可能造成 evidence 被重复消费、失败后继续调用 provider，或把不完整结果误记为质量通过。

主要内容与边界：新增精确参数 `--confirm-controlled-live-v7-deepseek-v4-pro-usage-parity` 与显式 package script；CLI 依次执行 preflight、历史快照、reservation、历史复核、mark attempted、evaluator、canary、paired eval 和 final seal。preflight 异常在 reservation 前固定关闭；reservation 后任一失败最多 terminal finalize 一次。evaluator construction 异常保留为 `executor_init`，其余 evidence/orchestration 异常为 `evidence_io`；failed canary 永不进入 48-case paired eval。成功摘要必须同时满足 23 次 provider attempt、48 case、26 个 verified zero-call、22 个 runtime、48 strict/quality pass、0 critical、P95 与精确 CNY 记账约束。process wrapper 只序列化 strict safe projection，不输出 prompt、response、凭据、URL、header、raw error、stack 或失败 token 数值。

当时验收：dependency-injected CLI regression 20/20、V7 factory 27/27、五个 Task 4 相关文件 targeted ESLint exit 0、Server build exit 0、`git diff --check` exit 0。测试覆盖错误 confirmation、credential-bearing preflight throw、snapshot/reserve/历史复核/mark/evaluator/paired/finalize 失败、精确成功顺序、failed canary 截止和非法 aggregate。该 CLI 离线验收时没有执行 V7 package script，没有读取真实 key、调用 provider、创建真实 marker/evidence、启动 Docker/浏览器或开启产品 gate；后续唯一 Live 终态见上文 2026-07-18 记录。

回顾时可以问：为什么 evaluator construction 使用 `executor_init` 而不是通用 `evidence_io`？为什么 reservation 后所有失败都必须 terminal seal？为什么 CLI 文件存在不等于已经运行 V7 Live？

### 2026-07-17 - Phase 6.9.5 V7 preview/actual usage parity 设计

目标：停止继续更换 provider/transport 参数，修复 V6 把工程 input preview 错当 provider actual usage 上限的 contract 违例，并为下一次 profile 补充不含数值的 usage-shape 诊断。

为什么：V6 evidence 为安全只保留最小终态，无法区分 provider 缺 usage、SDK 归一化丢失或更早的 response/schema 失败。继续原样发 canary 只会产生第七份同样模糊的 terminal evidence。

主要内容与边界：代码追踪发现 canary 使用 `estimatedInputTokens=96`，随后又要求 `provider inputTokens <= 96`；离线 executor fixture 返回合法 `97/4` 时稳定复现 `usage_unverifiable`。V7 保留 exact DeepSeek V4 Pro non-thinking OpenAI-compatible executor，允许正安全 actual input 超过 preview、仍限制 output cap、整轮 aggregate reservation 与 CNY hard cap；cloned-response audit 只新增 `missing/invalid/positive` usage shape，用于区分 provider telemetry 与 SDK normalization。V7 使用独立 profile/schema/marker/evidence/CLI，并在 provider 前复核 V1--V6 immutable tree；Review/Planner 权限、facts、本地 merger、预算、超时、deterministic fallback 与默认关闭 gate 均不改变。

替代方案：只删除 96-token 检查虽然能修复复现，但下一次缺 usage 时仍无法定位来源；改用 direct-fetch 或 Qwen 会同时改变 transport/provider，扩大变量。采用“最小 parity 修复 + 安全 usage-shape audit”，既保持 production parity，也避免 generic terminal evidence。

设计当时验收：已完成代码数据流复核与 `97/4` 离线复现，当时尚未修改实现或创建 V7 evidence/marker。其后 Task 1--6 已按 TDD 计划完成，离线结论见上文“V7 全量离线验收”；当时这些离线结果不构成 Live 授权，唯一 V7 授权已于 2026-07-18 消耗并终态关闭。

回顾时可以问：为什么 input preview 不能限制 provider actual usage？为什么 97/4 fixture 不能改写 V6 历史 provider 事实？为什么 V7 Live 通过仍不等于产品 gate 自动开启？

### 2026-07-17 - Phase 6.9.5 V6 离线验收与 Live 授权边界（历史记录，已由终态关闭替代）

目标：把 V6 已完成的非网络工程事实、不可跨越的真实模型边界和下一次唯一授权动作统一写入项目记录，避免把 fake CLI、Mock、静态测试或历史 v1--v5 evidence 误称为真实模型通过。

主要内容与做法：V6 仅让精确 `deepseek-v4-pro` + `https://api.deepseek.com/v1` 的 Review/Planner candidate 使用 typed non-thinking JSON transport；delegate 前固定写入 `thinking:{type:'disabled'}`，本地拒绝 tool/schema drift 与 reasoning-content response。业务 gate 继续默认关闭，普通 Chat 与 V4 Flash `json_object` 不变。factory audit 的 complete evidence 只接受 `not_reported` 或 `reported_zero` reasoning projection，并按完整 provider completion aggregate 计算 CNY，不从 output 中扣减 reasoning detail。V1--V5 evidence tree/marker 使用 immutable no-reparse snapshot；V6 reservation 是 private owner-bound one-time terminal capability，安全 provisional 写入后才可按 terminal outcome seal。离线 fake CLI 历史回归为 31/31；hardening 后 focused V6 suite 为 61/61、native evidence 为 15/15。一次 fresh Mock proof 为 48 cases / 26 verified zero-call / 22 Mock runtime / 48 strict / 0 critical，固定决定 `mock_quality_not_evidence`，临时 `.tmp` 输出已删除。

历史边界：在这份离线记录写入时，尚未运行 V6 CLI、provider、Docker、浏览器或产品 API，且 V6 evidence 目录和 once marker 均不存在。最多预算固定为 1 个 fact-free canary + 22 个 paired case，即 23 次，worst-case reservation CNY `0.18726`、hard cap CNY `1.00`；它不是实际费用、供应商账单、Live passed 或 production enabled。两个业务 gate 始终保持 `false`，不自动回退 Qwen。

历史验收：lint-style 修复提交后重新运行 AI、Agent、Server、shared types、Web 的测试/lint/build，`docker compose --env-file .env -f docker/docker-compose.dev.yml --profile worker config --quiet` 与 `git diff --check` 均 exit 0；当时尚无 V6 marker/evidence。其后用户已授权并执行唯一一次 V6 canary，终态结果见下节“V6 controlled-Live 终态关闭”；该命令现已消耗，任何后续动作不得重跑 V6。

回顾时可以问：为什么 V6 的 complete evidence 只允许两种 reasoning aggregate，却仍以完整 completion 记账？为什么 V6 private provisional/seal 能防止一次性 evidence 被伪造为成功？为什么 `48/48` Mock 和 CNY `0.18726` reservation 都不能说明项目已能使用真实 Review/Planner 模型？

### 2026-07-17 - Phase 6.9.5 V6 controlled-Live 终态关闭

目标：在已完成 Task 1--6 的独立 V6 non-thinking profile 上，按用户明确授权执行唯一一次 fact-free provider canary，并在任何 usage 不可验证时保留安全、可审计且不可重跑的终态，而不是把失败伪装成零调用或继续推进产品验收。

主要内容与边界：精确 V6 CLI 只在一个子进程中临时配置 Live；根 `.env` 的默认 Mock 配置与两条业务 gate 都未改写，未启动 Docker 或浏览器。runtime evidence 与同目录 once marker 已封存，最终字段为 `state=finalized / status=invalid_attempted / gate=closed / providerAttemptCount=1 / usageKnown=false / diagnosticCode=usage_unverifiable`。V1--V5 evidence/marker 没有工作区改动；V6 JSON 仅保留白名单终态字段，不含 prompt、用户事实、模型输出、凭据、URL、HTTP 元数据、raw error、stack、token 或成本。

为什么：provider boundary 已被触达但 usage 未能验证时，任何质量、成本或可用性说法都没有证据基础。fail-closed 能避免把未知计费、未知 response 或未知质量写成 `candidate_applied`、zero-call 或零成本成功。

验收：独立解析 V6 JSON，确认上述六个最终字段；检查 once marker 存在；扫描 evidence 禁止内容无命中；`git status` 显示 V1--V5 evidence 无改动。V6 的 48-case、Docker authenticated suggestions/plan、可见浏览器、main 合并、main 复验和远程推送均未执行。

当时后续状态：V6 不能重跑；截至该记录写入时，V7 已完成 Task 1--6 离线实施，仍需 Task 7 两轮复审与新的单独 Live 授权。后续唯一 V7 Live 已于 2026-07-18 终态关闭，当前仍保持两个业务 gate 为 `false`，不得重跑 V7。

回顾时可以问：为什么 `usageKnown=false` 不能被记为零成本？为什么新的诊断必须拥有自己的 marker/evidence 而不是重跑 V6？

### 2026-07-17 - Phase 6.9.5 V6 non-thinking evidence 隔离（离线）

目标：为 V6 这条独立 DeepSeek V4 Pro non-thinking lineage 预先冻结一次性、安全且可审计的 evidence 边界，同时以字节级历史快照保护 v1--v5，避免新的受控实验覆盖、重用或误解释旧 evidence。

主要内容与边界：新增独立 V6 profile/schema/once-lock 常量与严格 `reserved`、`attempted`、`finalized` records。完整记录只允许固定的 23 次尝试、CNY token/cost/cap、48/26/22/48 固定质量计数，以及 `not_reported` 或 `reported_zero` 的安全 non-thinking aggregate；关闭记录只保留有界诊断，`thinking_not_disabled` 也只能保留 reasoning 枚举、布尔值和非负安全 token 计数。V1--V5 的所有目录和 marker 都以 native HANDLE-relative、existing-only、no-reparse 清单 hash 在 reserve 前、executor 前、provider 前及 finalization 后复核；V6 writer 唯一可写范围是新的 runtime V6 tree、其 once marker 和安全 JSON。reservation 对调用方只暴露 `relativePath` 与 `markAttempted`；terminal capability 仅由模块私有 WeakMap 绑定给原始 object，并以一次性 owner claim、safe-provisional 写入和唯一 terminal replacement 串行化，伪造/clone 或重复 handle 在任何写入前 fail-closed。finalization 的第一个 durable record 固定是 closed `evidence_io`，最后一次 history check 通过后才允许覆盖为请求的 terminal summary 并 seal；history mismatch 或任一 writer failure 都只 seal 已有的 safe attempted/finalized record，绝不留下 durable `complete`。这不是不可能的跨目录原子锁声明：枚举仅提供不可信 leaf names，已绑定目录及每个重新相对打开的 leaf 都禁止 reparse/DELETE，下一次 fresh snapshot 负责检测并发新增或变更。

验收：先运行新增 evidence spec，因 V6 evidence module 不存在而得到 module-not-found RED；独立复审发现旧顺序在 final hash mismatch 且 corrective writer failure 时会遗留 `complete`，新增组合回归先 RED，再改为 safe-provisional ordering。第二次复审发现公开 reservation 可直接 terminal-write，新增 public-surface regression 先 RED，再将 capability 收进 WeakMap；clone 进入受控 finalizer 时不发生写入。后续复审补强使公开 controlled finalizer 也只能由一个 owner 执行：并发或完成后的第二次调用均不能重写 finalized record。本次补强后 focused Jest 3/3（61 tests）和 Windows Bun native 15/15 通过。native tests 覆盖 V1--V5 历史的 added/changed/removed/renamed、late concurrent entry、junction/reparse、duplicate V6 marker、native writer denied、final history mismatch 的 sealed `evidence_io`、private capability 与 forged-handle fail-closed，以及四个边界的 hash 复核。旧的 call-count 注入式 terminal writer failure test 已移除，因为它需要重新暴露或伪造私有 writer capability；实际 native writer denied 与 sealed-record 可观察断言保留，不设置 test-only public write backdoor。所有 fixture 只位于 OS 临时目录；未创建仓库实际 V6 evidence 目录或 marker，未读取 `.env`、未调用 provider、未运行 V6 CLI、Docker 或浏览器。该离线 writer 不构成 Live、质量通过、费用结论或生产启用。

回顾时可以问：为什么 V6 必须将 v1--v5 的完整目录和 once marker 都纳入 snapshot，而不能只保护 marker？为什么 post-finalization hash failure 必须覆盖为 `evidence_io` 才能 seal？为什么 V6 evidence 只保留 reasoning 的安全 aggregate，而不能保存 provider response 或调试文本？

### 2026-07-17 - Phase 6.9.5 V6 non-thinking evaluator（离线）

目标：在不重跑 v1--v5、不创建 V6 profile/marker/evidence 且不接触 provider 的前提下，先冻结 V6 的一次 canary、22 个 paired runtime 尝试、非 thinking 审计和 CNY 费用上限。

主要内容与边界：factory 只接受全局 live gate、独立 V6 gate、精确 DeepSeek V4 Pro `/v1` 与两个 Review/Planner 业务 gate 显式为 `false` 的测试配置。它把 `deepseek_v4_pro_nonthinking_json` config 与只在 evaluator 闭包中的 audit callback 交给 executor；callback 仅归约 reasoning 枚举、布尔值和安全 token 整数，绝不写入 Agent Trace、公开配置或原始 response。完成路径对 evidence 只暴露冻结的 `not_reported` / `reported_zero` 聚合（缺失时为前者）；positive、invalid、content 与 provider 原始数据绝不越过 evaluator，且任一非合规审计都会关闭路径。canary 必须是一次、正安全整数 usage 且无 audit 违规；缺失/零/小数/负 usage、reasoning content、正 reasoning tokens 或非法 detail 都立即以 V6 本地域 `thinking_not_disabled` 或受限诊断关闭，不能进入 paired。paired 仍使用原 48-case 的 zero-call guards，最多 22 个 runtime calls，且只有 canary 加 22 个 paired delegate attempts 恰好等于 23 时才可接受 report；全部运行时 strict success、26 个 verified zero-call、零 critical、P95 不超过 4500ms、语义质量不少于 90%、正 aggregate usage 与 CNY 不超过 1 仍缺一不可。CNY 始终按完整 completion tokens 计算，`reported_zero` 不扣减 output；它不进入现有 USD Trace。

验收：先运行新增 factory spec，因 V6 factory 模块不存在而 RED（仅 module-not-found，0 tests executed）；最小实现后 V6 focused 18/18、V6+封存 V5 factory 27/27、`bun --filter @repo/agent test` 与 `bun --filter @repo/ai test` 181/181 均通过。全部 executor/provider 路径由注入 fake 覆盖；未读取 `.env`、未调用真实模型、未运行 V6 CLI、Docker 或浏览器，也未创建或修改 V1--V5/V6 evidence 或 marker。Task 3 只是离线 evaluator，不是 Live、质量通过或生产启用结论。

回顾时可以问：为什么 V6 要把 48 个 contract strict successes 中的 26 个 zero-call 与 22 个 runtime strict successes 分开验证？为什么 non-thinking audit 只能留在 evaluator 闭包，且不允许从 completion token 中扣除 reasoning detail？为什么 24th delegate 必须在 provider 前被阻断？

### 2026-07-17 - Phase 6.9.5 V6 Review/Planner resolver 精确绑定（离线）

目标：让已封闭的 DeepSeek V4 Pro non-thinking transport 只能由 Review/Planner 的精确 production composition 选择，同时保持两个业务 gate 默认关闭。

主要内容与边界：`resolveReviewPlannerLiveExecutorConfig` 仅在 `provider=deepseek`、`model=deepseek-v4-pro` 与 trim 后仍精确 `https://api.deepseek.com/v1` 同时成立时返回 `deepseek_v4_pro_nonthinking_json`；尾随斜杠、显式端口、query、其他 DeepSeek host、错误 provider credential 或输入 `schemaProfiles` / `onNonThinkingAudit` 一律 fail-closed。V4 Flash 仍使用通用 `json_object`。两条业务 gate 都是 `false` 时 factory 不构造 executor，公开 `ReviewPlannerModelConfig` 序列化不含 credential 或 base URL；没有新增环境变量、audit callback、普通 Chat 改动或 provider 调用。

验收：先以 focused server Jest 观察到 V4 Pro 仍解析为 `json_object` 且 unsafe 变体仍构造 executor 的 RED；最小 resolver 修复后 config/factory 28/28 GREEN。V6 profile、marker、evidence、CLI、Docker、浏览器与 Live 均未创建或运行，后续仍须先完成 factory/evidence/CLI/Mock/独立复审并取得新的用户明确 Live 授权。

更正：V5 是已封存的 `json_object` lineage；V6 transport 绑定后，exact old V5 env 在 preflight 立即返回 `PreflightInvalid`，旧的 mock diagnostic/paired-execution 断言已退役，且 `createExecutor` 必须保持零调用。这只更新离线测试边界，不改写 V5 evidence、marker 或一次性 provider 结论。

回顾时可以问：为什么 V4 Pro transport 必须比较原始 canonical base URL，而不是仅按 host allowlist？为什么 `schemaProfiles` 必须在 Review/Planner composition boundary 直接 fail-closed？为什么 gate 关闭时甚至不应构造 executor？

### 2026-07-17 - Phase 6.9.5 V6 non-thinking typed transport（离线）

目标：在 V5 的 `structured_output` 终态后先验证一个可证伪的 transport 根因假设：DeepSeek V4 Pro 默认 thinking 是否需要在真实 JSON candidate request 上显式关闭；本记录只确认本地 SDK wire 与权限边界，不声称真实模型已经通过。

主要内容与边界：`@repo/ai` 新增封闭的 `deepseek_v4_pro_nonthinking_json` mode。它只接受 `provider=deepseek`、`model=deepseek-v4-pro` 与精确 `https://api.deepseek.com/v1`；通过 Vercel AI SDK 官方 custom `fetch` middleware，在 delegate 前验证 `POST /v1/chat/completions`、`response_format:{type:'json_object'}`、无 tools/tool_choice/functions/function_call/json_schema，拒绝预置 `thinking`，然后只写入固定 `thinking:{type:'disabled'}`。未知 `providerOptions.openai.thinking` 的零网络对照实验证实不会出现在 SDK wire，因而不能被当作关闭 thinking 的实现。middleware 对返回值只暂态归约 reasoning 是否出现和安全整数 detail；它不读取或保存 `message.content`，也不向 Trace/HTTP/文档投影 prompt、candidate、chain-of-thought、endpoint、header、凭据或原始错误。发现 reasoning content、正 reasoning token 或非法 detail 时在本地 fail-closed，现有 runtime 仍回落 deterministic suggestion。

验收：先观察到 transport module/mode 缺失的 RED；实现后 direct transport 18/18、provider wire 33/33、完整 `bun --filter @repo/ai test` 181/181、`bun --filter @repo/ai typecheck`、`lint` 与 `bun --filter @repo/server build` 均通过。所有 provider responses 均由 fake fetch 构造；未读取 `.env`、未调用 DeepSeek、未创建 V6 evidence/once marker、未启动 Docker/浏览器，`REVIEW_AGENT_MODEL_ENABLED` 和 `PLANNER_AGENT_MODEL_ENABLED` 仍未改变。V6 的 factory、evidence、CLI、Mock、独立复审和用户明确的一次 Live 授权仍在后续任务。

回顾时可以问：为什么通用 `providerOptions` 不能作为 DeepSeek thinking 开关？为什么 middleware 必须在 delegate 前验证完整 JSON request？为什么 response audit 只允许保留安全计数而不能记录 reasoning/content 原文？

### 2026-07-17 - Phase 6.9.5 DeepSeek V4 Pro v5 一次性 Live 关闭

目标：以与生产候选一致的 JSON-object executor 验证 Review/Planner 真实模型只读建议是否可进入 48-case 和项目验收。

结果：离线全量验证后仅执行一次 `deepseek-v4-pro` provider 尝试，v5 独立 evidence 记录为 `invalid_attempted / closed / providerAttemptCount=1 / usageKnown=false / structured_output`。48-case、Docker、浏览器、main 合并和推送均未执行；两个业务 gate 继续 `false`。证据不含 provider 原文、prompt、候选、凭据或 endpoint，不能被解释为普通 Chat 不可用、零成本、质量结论或阶段完成。

回顾时可以问：为什么与生产 executor 对齐的 v5 仍须在 structured-output 关闭后停止？为什么 `providerAttemptCount=1` 不能让我们继续 48-case？为什么新的根因设计必须先于任何新 profile？

### 2026-07-17 - Phase 6.9.5 DeepSeek V4 Pro v5 once-only CLI 与 Mock 边界

目标：把独立 v5 的真实模型入口约束为单一、可审计且不可重试的 server-only 命令，同时先用不触网的 Mock 再次证明冻结 48-case 数据集、zero-call 边界和安全汇总可运行；本条不记录任何 Live 成功结论。

主要内容与做法：新增 `eval:review-planner:live:v5:deepseek` 与精确确认参数 `--confirm-controlled-live-v5-deepseek-v4-pro`。CLI 在 provider 边界前依序验证配置、快照并复核 v1--v4 历史 evidence、reserve 独立 v5 evidence/marker，再标记 attempted；它只执行一个 canary，且只有 `complete / usageKnown=true / providerAttemptCount=1` 时才允许 22 个 eligible runtime case 继续。最终状态必须同时满足 `quality_gate_passed`、48 entries、26 个实际 verified zero-call、22 runtime、23 total attempts、P95 不超过 4500ms、正数 provider usage，以及 DeepSeek V4 Pro 非缓存 CNY 聚合费用不超过 CNY 1；否则严格关闭。序列化与脚本 stdout 都只投影状态、计数、受限 CNY 聚合和质量摘要，不会写出 prompt、candidate、凭据、endpoint 或 raw provider 输出。

离线证据：V5 CLI Jest 覆盖 confirmation/preflight、初始历史 hash、reservation、一次 marker、canary 失败、exact 48-case 开放条件、P95/费用关闭与安全序列化；`phase-6.9-review-planner-v2` Mock 运行得到 48 cases、26 verified zero-call、22 runtime、48 strict successes、0 critical failures、`mock_quality_not_evidence`。Mock 不会消费 v5 marker、不调用 provider，也不会改变 `REVIEW_AGENT_MODEL_ENABLED=false` 与 `PLANNER_AGENT_MODEL_ENABLED=false` 的默认业务状态。

回顾时可以问：为什么 v5 必须先 reserve evidence 再创建 evaluator？为什么 canary 的正数 usage 和一次调用数是进入 48-case 的前置条件？为什么 v5 的 CNY price profile 不能写进现有 USD Trace？

### 2026-07-17 - Phase 6.9.5 DeepSeek V4 Pro v5 证据隔离

目标：为 DeepSeek V4 Pro v5 的一次性受控验收建立独立 evidence/once-marker 与历史完整性边界，保证 v1--v4 的目录树、marker 和字节内容不会被 v5 写入、覆盖或静默改写。

主要内容与边界：v5 只可通过 Windows HANDLE-relative writer 创建 `phase-6-9-5-controlled-live-v5-deepseek-v4-pro` 目录及其专属 marker；evidence 是严格白名单 JSON。关闭结果只保留状态、gate、调用计数、usage 标记和受限诊断码；完整开放结果才可保留固定 CNY price profile、受限 token/CNY 聚合、硬上限和质量计数。它不保存 prompt、candidate、模型原文、凭据、endpoint、header、raw error 或 stack。v1--v4 在每次外部边界前后按目录项名称、类型、字节长度和 SHA-256 重新核对；缺失、追加、改写、普通文件外的节点或 reparse/junction/symlink 都 fail-closed。

验收：先以缺少 v5 模块确认 RED；随后 focused Jest 3/3 与 Windows Bun native 5/5 通过，覆盖正常 reserve/mark/finalize、历史树字节哈希不变、历史改写/追加/reparse 和 v5 marker 冲突。此任务未读取凭据、未调用真实模型、未启动 Docker 或浏览器，也没有创建任何受控 Live evidence；Review/Planner 业务 gate 仍默认 `false`。

回顾时可以问：为什么 v5 evidence 必须与 v1--v4 的 once marker 彻底分离？为什么历史验证既要比较 hash，也要拒绝 reparse point？为什么 CNY 聚合不能进入 USD Trace？

### 2026-07-17 - Phase 6.9.5 DeepSeek V4 Pro v5 受控评测工厂

目标：为 ReviewAgent / PlannerAgent 建立一条与生产候选相同、但仍默认关闭且只读的 DeepSeek `deepseek-v4-pro` JSON-object 受控评测入口，避免把历史 v1--v4 的 direct-fetch 结构化输出失败误写成“DeepSeek Chat 不可用”。

主要内容与边界：v5 工厂只接受 `AI_PROVIDER_MODE=live`、全局 live gate、独立 v5 gate、精确的 `https://api.deepseek.com/v1` / `deepseek-v4-pro` 绑定，且两个业务 gate 必须显式为 `false`。它复用实际生产的 OpenAI-compatible `json_object` executor（无 tools、无 strict-tool、`maxRetries=0`），模型只产生 canonical Review/Planner candidate；本地 schema、facts merger、FSRS、任务、权限、持久化与失败 fallback 仍为权威。canary 与后续 22 个 runtime case 都必须具备正安全整数 provider usage；非法、零、缺失、超限或第 24 次请求均 fail-closed，绝不让额外 provider 调用穿透。

成本：用户提供的 V4 Pro 价格快照为非缓存输入 CNY 3/百万、输出 CNY 6/百万。v5 预留 `42,996` 输入与 `9,712` 输出 token，最坏估算 CNY `0.18726`，低于批准上限 CNY `1.00`。该 CNY profile 仅供 v5 evidence 使用；在线 Agent Trace 的金额字段仍是 USD，故没有把 CNY 写入其中或编造汇率。

验收：红灯测试先证明 factory 缺失；实现后 `review-planner-controlled-live-eval-v5-deepseek.factory.spec.ts` 18/18 与 `bun --filter @repo/ai test` 161/161 通过，均未读取真实凭据或调用 provider。此记录只代表离线 factory；v5 evidence、CLI、Mock、唯一 Live、Docker、浏览器、main 复验和推送仍未发生。

回顾时可以问：为什么 v5 必须复用 production JSON executor 而非第四次 direct-fetch adapter？为什么 CNY 价格不能直接写进 USD Trace？为什么第 24 次请求必须在 delegate 前被拒绝？

### 2026-07-17 - Phase 6.9.5 DeepSeek V4 Pro v5 evidence 隔离

目标：把即将发生的 v5 唯一真实调用和已消耗的 v1--v4 历史调用彻底隔离，使新证据既可审计，也不能覆写、拼接或误读旧证据。

主要内容与边界：新增独立 profile、严格 safe-summary schema、专用 once marker 与 Windows HANDLE-relative writer。v5 只可写自己的 evidence 目录；complete evidence 只含 provider 尝试数、正 usage 状态、CNY price profile、聚合 token/CNY cap 与质量计数，closed evidence 不携带费用或质量字段；成功 evidence 的 token 必须为正数且 CNY 必须精确匹配固定非缓存公式。任何 prompt、candidate、key、endpoint、header、raw output/error 或 stack 都会被 schema/deny-list 拒绝。v5 在 provider 边界前后通过 existing-only 的 native HANDLE-relative reader 对 v1--v4 完整 evidence tree 与 marker 做 SHA-256 清单验证；文件增删改、reparse point、缺 marker 或已存在 v5 marker 都 fail-closed，历史扫描绝不创建目录。

验收：evidence schema Jest 3/3、原生 Bun evidence 测试 5/5 与 Server lint 通过；原生测试覆盖历史 tree 字节级保持、内容/新增文件/reparse 篡改和 marker 冲突。没有运行 CLI、真实模型、Docker 或浏览器，业务 gate 继续关闭。

回顾时可以问：为什么不只 hash 四个 marker，而要 hash 整个历史 evidence tree？为什么 complete 与 closed evidence 必须是不同的严格 schema？为什么 v5 writer 必须限制在 HANDLE-relative 的专属目录？

### 2026-07-17 - Phase 6.9.5 离线评测与 telemetry 可信度补强

目标：在不启动任何新的 provider 调用、不改变 Review/Planner 默认业务 gate 的前提下，让后续独立 profile 的 48-case 评测、zero-call 边界和成本 Trace 可以作为可审计证据，而不是由报告字段或 `0/0` usage 冒充成功。

主要内容：

- `phase-6.9-review-planner-v2` 保持 48 条 case（26 条 provider 前 zero-call、22 条 runtime）。26 条 zero-call 现在实际穿过 candidate 入口并覆盖 not-eligible、safety-blocked、budget-exhausted 与 aborted；只有 runtime 计数仍为 0、strict/rubric 均通过且 `zeroCallVerified=true` 才能通过 report contract。意外 runtime 调用固定产生 `zero_call_boundary_failed`，不能再由直接构造的成功记录掩盖。
- 22 条 runtime fixture 扩展为不同的 Review diagnosis / focus 组合与 Planner strategy / block order，而不是重复同一个弱点或排序夹具。Mock 仍只证明 contract，固定决策仍为 `mock_quality_not_evidence`。
- `ModelAgentRuntime` 的 live 成功路径现在要求 provider-reported input/output usage 都是正安全整数。缺失、非整数、负数或 `0/0` 统一成为 `PROVIDER_ERROR / invalid_response`，保留调用前已预留预算，并让 Review/Planner 回退本地只读建议；失败结果里的 `0/0` 是固定脱敏失败值，绝不表示已验证的 provider usage 或零费用。
- Review/Planner Trace 复用集中定价表，但只有全部成功 Trace 具有正安全整数 usage 且每个模型都有已知单价时才标记 `pricingKnown=true` 并写入估算成本。未知单价、失败 Trace 或不可验证 usage 一律显示未知定价和成本 `0`，不回填历史 evidence，也不替代供应商账单。
- Docker Compose fixture 改为最小 OS 运行环境白名单，而不是克隆再删除部分 `process.env`；host-only `QWEN_API_KEY` canary 证明 Compose 解析全部服务时不会把宿主 Qwen/RAG/JWT 等插值变量带入临时 config。该变更只修复测试隔离，未将 Review/Planner gate、timeout 或凭据投影到 Web/镜像。

验收：未读取或调用任何新的真实模型。fresh Mock artifact 为 `.tmp/phase-6-9-5-v2-mock-20260717T080000Z.json`，结果为 48 entries / 26 verified zero-call / 22 Mock runtime / 48 strict / 48 quality / 0 critical，决策固定为 `mock_quality_not_evidence`。`bun --filter @repo/agent test`、`bun --filter @repo/ai test`、`bun --cwd packages/types typecheck`、`bun --filter @repo/server test -- --runInBand`（89 suites、826 passed、30 skipped）、`bun --filter @repo/server lint`、`bun --filter @repo/web test`（409 passed）、`bun --filter @repo/web lint`、server/web build 与 `git diff --check` 均通过。历史 v1--v4 controlled-Live evidence 和 once marker 完全未改写，两个业务 gate 继续默认 `false`。

回顾时可以问：为什么 zero-call 必须实际穿过 candidate safety gate？为什么 provider 返回 `0/0` usage 不能被解释为零成本成功？为什么集中定价仍不能替代供应商账单？

### 2026-07-17 - Phase 6.9.5 Review / Planner v4 controlled-Live 关闭记录

目标：在独立的零网络封闭式 JSON 归一化和 stage-provenance 边界复审后，以新的 v4 profile 确认 provider 结构化输出是否能取得进入 48-case 与项目内验收的资格；不扩大模型权限，也不复用任何历史 profile。

为什么：v1/v2/v3 的关闭 evidence 已经证明“不能把失败写成 zero-call 或通过”，但不能授权无边界重试。v4 因此使用新的 evidence schema、目录和 once marker，并将已受信的内部阶段保持在最小脱敏范围，避免覆盖旧证据、保存 provider 原文或以 Docker/浏览器成功冒充模型质量。

主要内容与做法：

- v4 以独立目录、`phase-6.9.5-review-planner-controlled-live-evidence-v4` schema 和 `.review-planner-controlled-live-v4.once` marker 运行；v1/v2/v3 evidence 与 marker 未改写、未复用、未拼接。
- 唯一一次 v4 provider 尝试终态为 `invalid_attempted / closed / 1 / false / structured_output / provider_json_parse`。`provider_json_parse` 仍只是受信 runtime 内部阶段，未进入业务 API、Trace、浏览器或 DTO。
- evidence 只写白名单状态、schema version 与 marker；不写 prompt、用户学习事实、candidate JSON、模型输出、凭据、endpoint、HTTP metadata、raw error、stack、token 或成本。默认 `REVIEW_AGENT_MODEL_ENABLED=false`、`PLANNER_AGENT_MODEL_ENABLED=false` 未改变。

边界：v4 不重试，不运行 48-case controlled-Live、Docker authenticated suggestions/plan 或可见浏览器验收；它不是质量通过、zero-call、零成本或账单结论。没有创建合成账号或 Trace，故没有清理动作；main 复验和远程推送仍未开始。

验收：v4 evidence 与 once marker 均存在，evidence 为 parseable 的白名单 JSON，保留 `invalid_attempted`、`closed`、`providerAttemptCount=1`、`usageKnown=false`、`structured_output` 与 `provider_json_parse`；v1/v2/v3 未改写；默认业务 gate 仍关闭。

回顾时可以问：为什么 v4 必须使用新 evidence/marker，而不是重试 v3？为什么 `provider_json_parse` 可以留在脱敏 evidence，却不能进入 Trace 或浏览器？

### 2026-07-17 - Phase 6.9.5 Review / Planner v3 controlled-Live 关闭记录

目标：在不扩大模型权限、不读取或记录 provider 原文的前提下，验证 v3 专用受控诊断能否通过新的安全内部阶段分类，取得继续 48-case 与项目内验收的资格。

为什么：v1/v2 的泛化 `structured_output` 已经安全地阻断后续验收，但不能区分运行时已知的结构化输出阶段。v3 通过独立 profile、evidence schema 和 once marker 保留一个最小、脱敏的阶段值，避免以重试、raw error 或模糊记录替代根因证据。

主要内容与做法：

- v3 以独立目录、`phase-6.9.5-review-planner-controlled-live-evidence-v3` schema 和 `.review-planner-controlled-live-v3.once` marker 运行；v1/v2 evidence 与 marker 均保持字节级历史记录，不覆盖、不复用、不拼接。
- 唯一一次 v3 provider 尝试终态为 `invalid_attempted / closed / 1 / false / structured_output / provider_json_parse`。`provider_json_parse` 仅是受信 runtime 内部阶段，未进入业务 API、Trace、浏览器或 DTO。
- evidence 只写严格白名单字段；不写 prompt、用户学习事实、candidate JSON、模型输出、凭据、endpoint、HTTP metadata、raw error、stack、token 或成本。默认 `REVIEW_AGENT_MODEL_ENABLED=false`、`PLANNER_AGENT_MODEL_ENABLED=false` 未改变。

边界：v3 失败不是 48-case 质量结论，也不是 zero-call、零成本或账单结论；不重试 v3，不运行 48-case controlled-Live、Docker authenticated suggestions/plan 或可见浏览器验收。v1/v2 同样不重跑；没有创建项目内合成账号或 Trace，因此没有相应清理动作；main 复验和远程推送仍未开始。

验收：v3 evidence 与 once marker 均存在，evidence 为 parseable 的白名单 JSON，保留 `invalid_attempted`、`closed`、`providerAttemptCount=1`、`usageKnown=false`、`structured_output` 与 `provider_json_parse`；v1/v2 没有改写；默认业务 gate 仍关闭。

回顾时可以问：为什么只将 `provider_json_parse` 作为 v3 私有 evidence 字段，而不保存 provider 原文？为什么一次失败后仍必须保留 consumed marker 并停止 48-case、Docker 和浏览器验收？

### 2026-07-16 - Phase 6.9.5 Review / Planner v2 controlled-Live 关闭记录

目标：在 v1 暴露本地 probe 与 canonical Review candidate schema 不匹配后，先完成零网络 schema-contract 修复与复审，再以完全隔离的 v2 profile 验证可满足 schema 的无事实诊断请求；不改变 ReviewAgent / PlannerAgent 的只读、权限和本地 facts 边界。

为什么：v1 的 `structured_output` 不能被误写成 provider 语义质量失败，也不能靠覆盖 v1 evidence 或直接重试来消除。独立 v2 profile 让修复后的本地 contract 与旧证据可审计地分开，同时仍以 provider 实际结果决定是否允许继续。

主要内容与做法：

- v2 使用单独的 evidence schema、目录和 `.review-planner-controlled-live-v2.once` marker；v1 evidence 与 `.review-planner-controlled-live.once` 保持只读、不覆盖、不复用且不合并计数。
- v2 仍固定单 provider attempt、零 retry、4500ms timeout、无用户事实和 JSON-object + canonical schema；业务 `REVIEW_AGENT_MODEL_ENABLED` 与 `PLANNER_AGENT_MODEL_ENABLED` 始终为 `false`。
- v2 最终结果仍是 `invalid_attempted / structured_output`，`providerAttemptCount=1`、`usageKnown=false`、`gate=closed`。只记录严格脱敏的状态摘要，不记录 prompt、candidate JSON、用户事实、模型输出、凭据、endpoint、HTTP metadata、raw error、stack、token 或成本。

边界：v2 结果不与 v1 合并成质量、调用次数或成本结论；不得重跑任一 profile，也不得启动 48-case controlled-Live、Docker authenticated suggestions/plan 或可见浏览器。没有创建合成账号或 Trace，故没有相应清理动作；不执行 main 复验或远程推送。

验收：v1/v2 evidence 与两个 marker 均存在且只含允许字段；v2 summary 为 `invalid_attempted / closed / 1 / false / structured_output`；Nest 默认业务 gate、Compose 默认投影和当前文档结论均为关闭。

回顾时可以问：为什么修复 v1 的本地 schema-contract 后仍需要独立 v2 evidence？为什么两个失败 profile 不能相加后解释为质量、zero-call 或成本结果？

### 2026-07-16 - Phase 6.9.5 Review / Planner v1 controlled-Live 历史记录

目标：在不放开 ReviewAgent / PlannerAgent 的事实或写权限前，使用一次 server-only 受控诊断确认真实模型路径是否具备进入后续 48-case 与项目内验收的资格。

为什么：受限 candidate、Mock 和静态门只能证明工程 contract，不能证明 provider 实际 structured output 可用；同时，已发生的 provider 尝试不能被错误记成 zero-call、零成本或模型质量通过。

主要内容与做法：

- 诊断只允许一次精确 `--confirm-controlled-live` 调用，业务 `REVIEW_AGENT_MODEL_ENABLED`、`PLANNER_AGENT_MODEL_ENABLED` 均保持 `false`；模型无权读写用户业务请求或改变本地 merger 的 facts、FSRS、分钟数、链接和任务。
- 原生 evidence 使用受信目录约束与 once marker。最终文件只保留固定状态、`providerAttemptCount`、`usageKnown`、固定诊断码和 schema version；不写 prompt、用户学习事实、模型输出、API key、endpoint、HTTP metadata、raw error、stack 或 token/cost 数值。
- v1 尝试结果为 `invalid_attempted / structured_output`，`providerAttemptCount=1`、`usageKnown=false`、`gate=closed`。这说明存在一次 provider 尝试，但没有可验证 usage，也没有 quality pass 或生产启用结论。该历史 evidence 保持原样；后续 v2 在单独 profile 中记录，不能倒写或拼接。

边界：v1 不重跑，不跑 48-case controlled-Live，不启动 Docker authenticated suggestions/plan 或可见浏览器；不创建合成账号/Trace，因此没有相应清理动作；不执行 main 复验或远程推送。不得删除、替换 v1 marker 或将 v1 evidence 与 v2 或任何历史 run 拼接。

验收：检查 native evidence 与 marker 只包含允许字段；检查 Nest 默认 gate、Compose 默认投影和文档结论均为关闭。开发测试与 Mock 的既有通过结果仍只证明工程回归，不能覆盖本次 Live 失败。

回顾时可以问：为什么一次 provider 尝试且 `usageKnown=false` 不能按 zero-call 或零成本处理？为什么 `invalid_attempted` 必须停止，而不是直接重试并把后续成功当作同一轮证据？

### 2026-07-15 - Agent-first 路线、12 组件边界与双博客决策

目标：把“先完成全部 Agent 架构，再进入记忆系统”的顺序写成权威开发路线，并为 11 个当前逻辑节点加 Tool-Using Orchestrator 固定职责、通信、权限和初步模型路径。

为什么：旧文档把 Agent 模型化、长期/情景记忆和 Orchestrator 交叉排在 Phase 6.9.5～6.9.7，容易误判 Router/Verifier 收尾等于整个多 Agent/记忆阶段结束；部分文档还把 Review/Planner、KnowledgeDedup/Organizer 的当前 deterministic baseline 写成长期目标，并把 Phase 6.9.4.3 的 Router 延迟失败写成永久结论。

主要内容与做法：

- 新增 `docs/superpowers/specs/2026-07-15-phase-6-9-agent-architecture-completion-design.md`，明确 12 个受治理组件、实时 Chat 主链、阈值/显式业务链、版本化通信 DTO、后端身份权威、按风险授权写操作和失败不扩大权限。
- 确认 Router、Tutor、Verifier、WrongQuestionOrganizer、Retriever 使用模型/规则混合；Review、Planner、KnowledgeDedup、KnowledgeOrganizer、FinalResponse、Memory 候选提取和 Orchestrator 必须有真实模型参与。
- 记录当前工程事实：`createAgentGraph()` 仍只是 descriptor；Retriever/FinalResponse 隐含于 RAG/Chat 链路；Orchestrator 尚未实现。后续必须补成可执行、可恢复、可观测的 LangGraph。
- 重排后续为 Phase 6.9.5～6.9.10 先完成全部 Agent，Phase 6.10 再做结构化长期记忆注入与 Episodic Memory。
- 博客拆为《多 Agent 架构》和《记忆系统》两个独立交付物，题目与结构由用户届时确认，不提前收尾。

边界：本次只修订路线与开发文档，不改变代码、数据库、Docker 状态或历史验收 evidence。Phase 6.9.4.4 仍需完成 Task 8～10 才能标记完成。

验收：检查核心文档中的旧 handoff、永久 deterministic 和单篇合并博客措辞；执行 Markdown diff/空白检查，并由无上下文读者复核职责、阶段和权限是否可独立理解。

回顾时可以问：为什么 Review/Planner 和 Knowledge Agent 需要模型参与但不能让模型掌握事实与写权限？为什么 MemoryAgent 候选提取属于 Agent 阶段，而记忆注入和 Episodic Memory 属于 Phase 6.10？

### 2026-07-11 - Phase 7 Maintenance：Smoke 资源关闭与可见浏览器验收规范

目标：收掉 Phase 7.23.8 质量审查留下的非阻塞技术债，让审计证据包 smoke 在 Queue/Prisma 资源
关闭失败时给出安全、可判断的失败结果，并把真实浏览器验收默认使用可见窗口写入仓库规范。

为什么：业务链路即使已经 PASS，`Queue.close()` 或 `Prisma.$disconnect()` 失败仍说明进程资源没有
正常收口；完全吞掉 rejected result 会让脚本误报成功。但 close failure 不能覆盖更早的下载、清理
等主要错误。另一方面，headless 自动化便于回归，却不能让协作者同步观察真实页面操作。

主要内容与做法：

- `Promise.allSettled()` 结果进入显式 failure selection：使用 `hasFailure` 而不是 truthy 判断，任意
  falsy Promise rejection 也会先规范化为安全 Error。没有更早错误且任一 close rejected 时返回
  `stage=close/code=RESOURCE_CLOSE_FAILED`；已有主链路或 cleanup 错误时保留原错误，不复制 raw close
  reason、token 或依赖消息。
- 新增 RED/GREEN 单测覆盖 close rejected、安全输出、既有错误优先和全部 fulfilled；聚焦 smoke
  27/27 与定向 ESLint 通过。
- 真实 Docker API/Worker/MinIO smoke 再次 PASS：records=4、request/download audit 各 1、
  EXPIRED=true、objectDeleted=true；本轮 ADMIN/STUDENT 临时账号已删除。
- `AGENTS.md` 与验收清单新增 headed 约定：真实页面验收默认把浏览器窗口保持可见；headless 只做
  自动化补充，必须明确标注，不能替代用户要求的可见验收。

边界：本次不新增 Phase 7 能力、不改变证据包业务状态机、API、数据库或 Docker 拓扑；纯 CLI
资源关闭路径没有新增必须通过浏览器操作的页面。

回顾时可以问：为什么资源关闭错误不能被静默吞掉，又为什么不能覆盖更早的业务/cleanup 错误？

### 2026-07-11 - Phase 7.23.8 Audit Evidence Export Delivery Closure

目标：在真实 Docker PostgreSQL、Redis、MinIO、API、Worker、Web 和 Admin Console 上完成审计
证据包从申请、可靠投递、ZIP 生成、下载审计到过期删除的最终验收，并留下可重复运行的安全 smoke
和面试复盘文档。

为什么：

- 申请返回 202 只证明 PostgreSQL facts 已提交，READY 也不足以证明下载 headers/字节、strict audit、
  MinIO 删除和浏览器 Blob 行为正确；最终阶段必须验证跨进程、跨存储真实链路。
- 完整 Compose 同时启动 `server` 与 `worker` 时，如果 API 容器仍用 `both`，会重复注册 processor；
  worker 镜像用户与 tmpfs owner 不一致还会让 crash janitor 因 EPERM 失效。
- 手工验收难以稳定覆盖 STUDENT 403、ZIP 精确内容、manifest/hash、24 小时逻辑过期与 cleanup，
  因此需要确定性脚本锁住最终交付边界。

主要内容与做法：

- Compose 的 `server` 默认改为纯 `api`，Dispatcher/export/maintenance gates 只交给独立 worker；
  worker 运行用户收口为 `1001:1001`，192 MiB tmpfs 同步设置 `0700,uid=1001,gid=1001`。
- 修复 `minio-init` 的 shell argv 结构，让完整 lifecycle script 成为 `/bin/sh -c` 第三个参数；真实 MinIO
  核对到 2 条规则，包含 2 天 expiration/noncurrent、delete-marker 与 incomplete multipart 边界。
- 新增 `smoke:operator-audit-export`：只接收环境变量中的临时 ADMIN/STUDENT token，支持正确的
  `BULLMQ_PREFIX`（默认 `prepmind`），串联申请、轮询、下载、ZIP/CSV/manifest/SHA、审计、维护、
  410 和对象删除；失败只输出安全 stage/code，`finally` 默认精确清理本次合成 facts 和对象。
- Outbox Ops e2e 修正过期 fixture：STUDENT 明确断言 403，后续 200 路径使用已提升的 ADMIN token。
- 中文路径构建流程拆为从 `P:` 只执行 build、从原始 `E:` 工作区执行 runtime Compose；不再使用
  `--project-directory P:\`，避免 lifecycle bind mount 被错误解析到 `P:\minio`。

边界：

- Docker Hub/镜像源无法拉取 `minio/mc` 时，本次只在本机创建未提交的兼容镜像，以真实 MinIO SDK
  执行 Compose 所需四条命令并核对 lifecycle。它不是官方镜像拉取成功，也不是生产方案。
- production 的 export/maintenance/diagnostic gates 仍默认关闭；本地 fallback HMAC secret 不可复用。
- SHA-256 是完整性校验，不是数字签名或不可抵赖；HMAC 来源指纹仍是可关联数据，不是匿名数据；
  证据包是工程上一致的观察结果，不是法律级数据库快照、WORM 或 legal hold。

验收：

- 合同/类型共 14/14；focused Server 35 suites、371 passed、2 个明确 integration skip；完整 e2e
  16 suites、56/56；smoke/config 26/26；Compose contract 13/13；Admin 56/56。database test、
  targeted ESLint、Server/Admin build 与 Admin lint 均通过，migration 无待部署项。
- 配额、幂等与恢复边界用以下聚焦门禁复核：

  ```powershell
  bun --filter @repo/server test -- operator-audit-export-request operator-audit-export-archive operator-audit-maintenance operator-audit-export-requested operator-audit-export-temp-janitor worker-readiness --runInBand
  ```

  结果为 12 suites、130 tests 通过，1 个需显式 Redis integration flag 的 suite/test 跳过。用例明确覆盖
  same actor/clientRequestId 同 hash 只产生一份 facts/一条 request audit、不同 hash 409、每管理员
  active=2/小时=10/全局 active=10 时 429；Redis enqueue failure 回到 Dispatcher retry/dead-letter；
  DEAD 24 小时内保留、超过窗口转 `DELIVERY_ABANDONED`；pre-count=50,001、archive byte limit=64 MiB、
  temp disk 不满足严格余量时均 fail-safe；janitor 只清安全失效 token 且不碰 active Bull job。

- 真实 API/queue/storage smoke 输出 `Operator audit export smoke: PASS`，记录数 1，request/download
  audit 各 1，EXPIRED=true、objectDeleted=true。浏览器在 Docker Admin Console 完成真实申请、下载、
  审计、过期与普通用户拦截：ZIP 777 bytes，console/page error 0，body 横向溢出 0；匿名 refresh
  401 是预期登录探测，不计为页面错误。
- 清理后合成 exports 7、audits 13、outbox 7、SYSTEM jobs 7、users 2 均删除，MinIO objects 0；
  worker `healthy`、failing streak 0，maintenance state 为 `SUCCEEDED`。未停止用户现有 Docker 基础设施。
  这组清理计数来自真实验收 helper，不是 smoke 单独负责删除用户；smoke 只精确清本轮 export facts、
  Bull jobs 与对象，预先准备的 ADMIN/STUDENT 账号在整轮浏览器验收后另行删除。
- 功能分支在 cleanup/固定 API role 修复后 smoke 记录数 4；再补 maintenance terminal wait 后最终
  smoke 记录数 5。两次均 request/download audit 各 1、EXPIRED=true、objectDeleted=true；按 export id
  查询 users/export/outbox/audits 为 `0|0|0|0`。容器内 readiness 为 `ready`：knowledge/export queue 均 waiting/active/delayed/failed=0，
  maintenance queue 仅保留 1 个预期 repeatable delayed job，maintenance current、online worker=1、
  outbox dead=0/backlog=false、issues=none。

回顾时可以问：为什么证据包真实验收必须同时覆盖 API/Worker 拓扑、ZIP 字节、下载审计、
维护删除和 cleanup，而不能把 202 或 READY 当成完成？

### 2026-07-11 - Phase 7.23.7 Admin Audit Evidence-Package Workspace

目标：在独立 Admin Console `/audit` 内完成“审计记录 / 证据包”工作台，让管理员沿用同一组脱敏筛选申请证据包、观察异步状态、查看安全详情并下载 READY ZIP。

为什么：

- 网络或 5xx 可能发生在服务端已提交之后；每次点击生成新 UUID 会把重试变成重复申请，但表单变化后复用旧 UUID 又会造成同 id 不同 hash 冲突。
- ZIP 不是 JSON envelope，下载仍需携带管理员 Bearer token，并显式约束文件名、哈希和 object URL 生命周期。
- 五态异步任务需要非颜色状态解释、active-only polling 和合法的同级交互控件。

主要内容与做法：

- `/audit` 提升共享 `AuditFilterState`，用支持 ArrowLeft/ArrowRight/Home/End 的 `tablist/tab/tabpanel` 切换审计记录与证据包；证据包申请默认继承 action/status/target/actor filters。
- create/list/detail 全部经过 `@repo/types` shared strict Zod schema；list 只序列化批准的 query。通用 API client 新增 authenticated POST Blob path，安全解析 attachment 文件名和 `X-Content-SHA256`；失败响应才解析 JSON envelope，普通 JSON 行为不回归。
- 申请带明确 31 天/50,000 条边界与 reason/date `aria-describedby` 错误关联。pending request 保存 `clientRequestId` 与继承筛选签名：网络/5xx 且完整表单未变时重用，任一字段或父 filters 变化时清理，成功后清理并只说明排队中。
- 列表支持稳定 cursor 加载并按 id 去重，只在存在 QUEUED/PROCESSING 时每 5 秒更新。固定 detail aside 展示筛选、reason、SYSTEM BackgroundJob id、记录数、文件大小、CSV/ZIP SHA-256、时间线与安全错误。
- FAILED 提示缩小范围；EXPIRED 说明文件已删除且没有恢复/延长动作；仅 `READY && canDownload` 显示同级 Download/Copy icon buttons。Blob 下载用临时 `<a download>` 触发，`finally` 始终 remove anchor 并 revoke object URL。

边界：

- 不改后端 API/contract，不使用 presigned URL，不展示 objectKey、processingToken、requestHash、payload、metadata 或 lease，不提供延长、恢复文件或编辑对象。
- 浏览器验收使用 Admin dev server + Playwright route interception + local ADMIN session，不代表真实 PostgreSQL/Redis/Worker/MinIO/下载审计全链路；Phase 7.23.8 继续真实 Docker 验收。

验收：

- TDD 将申请 pending/reuse/reset 决策与 cursor page merge 提取为纯函数，持久测试覆盖 network/5xx 同签名复用、reason/date/父 filters 变化清理且改回旧值不复活、成功/终态失败清理，以及重复 id 保留最新页版本和首次顺序。源码 contract 只负责静态安全/wiring 边界；jsdom + Testing Library 真实渲染生产共用 tabs/row，验证 ArrowLeft/Right/Home/End、焦点、单一可见 panel 和无嵌套 button。Admin 完整测试 56/56，ESLint、Next build、types typecheck、Server build 通过。
- Headless Chromium 1440×900 与 1024×768 均完成 QUEUED→PROCESSING→READY、tabs 键盘、错误关联、长 id/hash、固定轨道及 download/copy；两尺寸 console error 0、page error 0、横向溢出 0。临时脚本、截图、dev server 与 next-env 已清理。

回顾时可以问：前端为什么要在网络失败后复用 clientRequestId，而不是每次点击都生成新 UUID？

### 2026-07-11 - Phase 7.23.6 Operator Audit Query and Fail-Closed Download API

目标：为 Phase 7.23.5 已生成并维护的审计证据包提供受支持的系统级 ADMIN 查询、详情与安全 ZIP 下载入口，同时保证内部 MinIO/fencing 字段不越过 API 边界，任何下载字节都不能绕过 strict operator audit。

为什么：

- 没有 list/detail API 时，管理员无法发现其他管理员申请的系统级证据包，也无法用稳定游标安全翻页；仅暴露对象 key 或 presigned URL 会把存储实现和凭据边界推给浏览器。
- 下载审计如果写在打开 MinIO 流之前，会记录并未准备成功的下载；写在返回字节之后，又可能先泄露内容再发现审计失败。因此必须先确认对象流可读，再 fail-closed 写 strict audit，最后才交给 HTTP 响应。
- 全局 response envelope 适合 JSON，但不能包装 ZIP；浏览器还需要明确的安全文件名、哈希、长度、缓存与 CORS exposed header 合约。

主要内容与做法：

- 新增 `OperatorAuditExportQueryService`：list/detail 都是经过既有 audit gate、export gate、JWT、OperatorGuard 的系统级 ADMIN 视图，不按 current admin 限定 `requestedByUserId`。列表按 `createdAt desc, id desc` 排序，cursor 先按 id 找回 createdAt，再使用 `(createdAt,id)` 复合小于谓词；未知 cursor 返回空页，不退化为不稳定 offset。
- 每个 list/detail 响应只读取一次数据库 `clock_timestamp()`；`canDownload` 仅在 READY、`expiresAt > DB now` 且内部 objectKey/fileName/archiveSha256 完整时为 true。objectKey 仅以最小内部 select 参与布尔派生，显式 mapper 再经过 shared strict response schema，绝不进入 DTO；requestHash、processingToken、leaseExpiresAt、payload、metadata 等不 select/不返回。
- 新增 `POST /operator-audit-exports/:id/download`，不使用 presigned URL。服务端净化文件名为 `[A-Za-z0-9._-]`，无安全字符时固定回退 `prepmind-operator-audit-export.zip`；响应为 `application/zip`、`Cache-Control: no-store, private`，并携带 `Content-Disposition`、`Content-Length` 与 `X-Content-SHA256`。全局 interceptor 对 Nest 同一运行时的 `StreamableFile` 原样旁路，普通 JSON 仍保持 envelope；CORS 只新增暴露文件名与 SHA-256 两个响应头。
- 下载 service 严格按 load export → database now → 校验 DB archiveSize 为正数且不超过配置上限 → open MinIO stream → 核对 MinIO stat size 与 DB 完全一致 → strict `AUDIT_EXPORT_DOWNLOAD` → return stream 执行。size mismatch 与 strict audit 失败都会先销毁已经打开的 stream；对象 confirmed missing 会 best-effort 记录失败审计并用 `id + READY + exact objectKey` CAS 标记 `FAILED/EXPORT_FILE_MISSING`，MinIO 暂时不可用只返回安全 502、不错误降级数据库事实，也不泄露 raw storage error。size mismatch、strict audit failure 与 missing CAS persistence failure 只记录固定 warning，不拼接 raw error、objectKey、连接信息、用户正文或实际/预期 size。
- 状态边界固定为 not found 404、QUEUED/PROCESSING/FAILED 409、EXPIRED 或 READY 已到期 410、文件不可用 502、strict audit 失败 503。成功下载审计表示服务端已经授权并准备好对象流，不表示浏览器一定持久化了全部字节。

边界：

- 本阶段未实现 Phase 7.23.7 Admin UI、Phase 7.23.8 Docker 全栈/博客，不启用 production gate，也不引入 presigned URL。
- 下载是 POST，ZIP 是全局 JSON envelope 的唯一新增二进制例外；错误响应仍使用安全 JSON envelope。

TDD 与验收：

- query、download、storage、controller/module、response envelope 与 bootstrap 均先取得预期 RED 再实现 GREEN；focused 总集合 5 suites / 50 tests、最终 download 20/20，storage+download 合计 50 tests 通过。
- 新增真实 PostgreSQL API e2e 1 suite / 9 tests，覆盖 gate-off 认证前 404、无 token 401、STUDENT 四入口 403、ADMIN B 下载 ADMIN A、ZIP signature/非 JSON、安全 headers、download audit actor、410/409/502/503、missing CAS、strict audit 流销毁、内部字段不泄露与 legacy/HMAC 指纹 opaque correlation。
- Server full test 69 suites / 626 tests 通过，2 个 opt-in suites / tests 按预期跳过；Server build、changed-file ESLint/Prettier 与 `git diff --check` 通过。e2e 清理后测试用户、export 与 fingerprint audit 残留均为 0；测试使用 API role 与 StorageService override，未写入 MinIO、Redis 或明文 temp。

回顾时可以问：

- “为什么下载必须在打开对象流之后、返回字节之前 fail-closed 写审计？”
- “为什么 objectKey 可以被 query service 最小读取来派生 canDownload，却绝不能进入 response mapper？”
- “为什么 confirmed missing 要 CAS 标记 FAILED，而 MinIO unavailable 不能直接改写 READY？”

### 2026-07-10 - Phase 7.23.5 Operator Audit Retention Maintenance

目标：把 Phase 7.23.4 生成但尚未自动回收的证据包和审计历史接入可恢复、可观测的小时级维护闭环，同时保证 180 天清理不会踩到刚申请或长时间执行的导出。

为什么：

- `expiresAt` 只能表达 24 小时逻辑失效，不能代替 MinIO 物理删除、失败 attempt orphan 回收和终态 metadata 清理；维护暂时故障时还需要 48 小时 lifecycle 兜底。
- 直接按 `now - 180 days` 删除会和导出申请/读取形成竞态。申请与维护必须共享 retention advisory lock，维护还要把最早 `QUEUED/PROCESSING.startAt` 纳入 active-export 水位。
- 只按任务年龄修复僵尸状态会误杀仍在 BullMQ active 的 Worker；只按目录年龄清理明文则可能删除仍持有有效 processing token 的归档。

主要内容与做法：

- 新增每小时 `operator-audit-maintenance` scheduler，payload 严格固定为 `{schemaVersion:1}`，processor 本地 `concurrency=1` 且只调用 `maintenance.run()`；仅 `worker|both + maintenance gate` 注册，并在应用 bootstrap 把 maintenance queue 的 BullMQ global concurrency 固定为 1，使多个 worker replica 也只能串行维护。不接受 actor/user/filter，也不创建账号 BackgroundJob 或 OperatorAuditLog。
- `run()` 全程以 database clock 为准并持久化 singleton `RUNNING -> SUCCEEDED/FAILED`。READY 到 24 小时后先删除 selected object、列举严格 export prefix 并清 orphan，成功后才 CAS 为 `EXPIRED/objectKey=null/expiredAt`；missing 幂等，MinIO unavailable 保留 DB 事实等待重试。FAILED/EXPIRED prefix 与 180 天前终态 metadata 同样遵循“对象先空、数据库后删”。
- 审计日志每批最多 1,000、每次最多 20 批；每批使用新的短事务重新取得 retention advisory xact lock、DB clock 和 `effectiveCutoff=min(now-180d, oldestActive.startAt)`，再按 `(createdAt,id)` 删除。真实 PostgreSQL 交错测试证明 request 校验后、commit active watermark 前维护无法越过共享锁。
- Outbox `DEAD` 保留 24 小时人工 requeue 窗口，超窗后同事务把 Export/SYSTEM job 标为 `FAILED/DELIVERY_ABANDONED`。PROCESSING 只有超过一小时、lease 已过期且 Bull job 非 active 时才以双表 CAS 修复；Redis active 时保持原状。
- crash janitor 在 worker module init 及每次 maintenance 后运行，只接受严格 `prepmind-audit-export-<safeExportId>-<uuidToken>`，并同时验证 DB token/lease、Bull job state 和 realpath 仍在安全 temp root 下；绝不只按年龄删。默认明文根改为 `os.tmpdir()/prepmind-audit-exports`，POSIX 0700，Compose worker 用 192 MiB tmpfs 承载，为严格 `free > 2 * 64 MiB` preflight 留出余量。
- Worker heartbeat 固定声明 knowledge、audit export、audit maintenance 三队列。Readiness/Observability/CLI/Admin Worker 页分别展示三队列和 maintenance freshness；启用后超过两小时未成功为 fail，paused queue not-ready，failed job degraded，关闭 export/maintenance 不拖垮健康的 knowledge worker。
- Compose 新增 `minio-init` 导入 `operator-audit-exports/` 2 天 expiration、2 天 noncurrent、1 天 incomplete multipart 与 expired delete-marker 规则；这是 48 小时物理兜底。production 若启用 versioning，仍需在部署验收中确认 noncurrent/delete marker 真正清理。

边界：

- 本阶段没有实现 Phase 7.23.6 list/detail/download API 或 fail-closed 下载审计，也没有实现 Phase 7.23.7 证据包管理 UI；Admin 只扩展既有 Worker 健康页。
- 24 小时是 API/领域逻辑过期，小时任务负责正常物理清理，48 小时 lifecycle 只是故障兜底，不能把 lifecycle 延迟描述成可继续下载的 TTL。
- production gates 继续默认关闭；local Compose 显式开启只服务开发验证。维护失败仅持久化 `sanitizeJobError().slice(0,240)`，日志和 readiness 不输出路径、payload、用户内容或连接串。

TDD 与验收：

- 首批 maintenance/scheduler/processor/janitor RED 因模块不存在失败，GREEN 11/11；terminal selected object 回收用例先 RED 后修正，最终 maintenance 4 suites 13/13，含20批上限、terminal metadata、状态 counters 和真实 PostgreSQL 锁交错。
- 追加质量复审先以启动契约 RED 证明 maintenance 缺少 global concurrency provider，再新增 bootstrap `setGlobalConcurrency(1)`；真实 Redis 双 Worker/双 job 阻塞验证 1/1 通过，第二个 job 在首个释放前保持 waiting，最大 active 始终为 1。既有 export queue 的 global concurrency=1 与 global-first paused Worker 启动顺序保持不变。
- Readiness strict contract 先拒绝三个新字段；server readiness 首轮 11 failures、observability 首轮 11 failures、heartbeat queue list 1 failure 均按预期 RED，补三队列独立采集与 freshness 后 GREEN。Docker source contract 先因 lifecycle JSON 缺失 RED；archive bounded temp root 先因 helper 缺失 RED，随后归档/janitor/Docker 25/25。
- 阶段聚焦验证 12 suites 71/71；Admin 34/34，Server/Admin build 与 Compose config 通过。完整 Server 为 66 suites / 578 tests 通过、1 个显式 opt-in integration 跳过，types/database/frozen-lock 均通过。

回顾时可以问：

- “活跃导出水位如何避免 180 天清理与长时间导出互相踩踏？”
- “为什么 DEAD 事件要保留 24 小时恢复窗口，而 PROCESSING 又必须结合 lease 和 Bull job state？”
- “24 小时逻辑过期、小时级物理清理和 48 小时 lifecycle 分别解决什么问题？”
- “crash janitor 为什么不能只看目录年龄？”

### 2026-07-10 - Phase 7.23.4 Operator Audit Export Fenced ZIP Worker

目标：把 Phase 7.23.3 已可靠投递的 `operator-audit-export` BullMQ job 变成真正可执行的单并发证据包 Worker，在固定快照内生成脱敏 CSV + manifest ZIP，并保证失去 lease 的旧 Worker 无法覆盖新证据包。

为什么：

- BullMQ lock 只保护 Redis delivery；进程暂停、网络抖动或 lock/lease 丢失后，旧进程仍可能继续写 PostgreSQL 或 MinIO。仅靠 job id 幂等不能阻止“旧 attempt 最后完成并覆盖新 attempt”的僵尸写入。
- 审计 CSV 会被 Excel 等表格软件打开；只做 RFC CSV quoting 不能阻止 `=`, `+`, `-`, `@` 公式注入，也不能防住 tab、CR、NBSP 或全角空格前缀绕过。
- 证据包必须对应一个稳定的审计快照，且不能把 `metadata`、原始来源、secret 或任意用户正文带入归档；本地 plaintext 和未被数据库选中的对象也不能长期残留。

主要内容与做法：

- 新增 strict Bull payload，仅允许非空 `exportId/backgroundJobId`。状态仓库每次使用 `clock_timestamp()`，在同一事务内复核 Export 与 `scope=SYSTEM/userId=null` BackgroundJob 的 queue/job/resource 关联事实，并用随机 processing token、lease 和 `updateMany` CAS 同步执行 claim/renew/retry/fail/ready；任一事实 CAS 丢失都会回滚，旧 token 不能选择 object key。
- Worker 仅在 `SERVER_ROLE=worker|both` 且 export、Outbox Dispatcher、maintenance 三个 gate 都显式为 `true` 时注册。BullMQ 本地 concurrency 固定为 1；processor 先以 `autorun=false` 注册，应用 bootstrap 再先写入 queue global concurrency=1、后启动 Worker，避免多副本突破生产单并发不变量。`worker.run()` 的 Promise 会立即绑定 rejection handler；若初始化或主循环退出，只记录不含 raw error/连接信息的固定 fatal 日志，设置 `exitCode=1` 并发送 `SIGTERM`，signal 失败则显式 `exit(1)`，让编排器重启而不是留下在线但不消费的进程。600 秒 Bull lock 不变；live lease 通过 `moveToDelayed(leaseExpiresAt + 1000)` + `DelayedError` 延迟，已用 BullMQ 5.79.2 + 真实 Redis 验证 delayed 状态 `attemptsMade=0`。处理中每 `lease/3` 由 interval 续租；归档完成后/上传前以及上传后分别同步 renew/recheck。失败状态 CAS 的数据库结果不确定时同样 delayed 到 lease 恢复窗口，不消耗当前或最后一个 Bull business attempt。
- 归档查询使用 Prisma interactive transaction + `RepeatableRead`、`SET TRANSACTION READ ONLY` 和仅由已验证数字配置生成的 `SET LOCAL statement_timeout`。effective end 为 `min(endAt,snapshotAt)`；先 count，再按 `createdAt ASC,id ASC` 的复合 keyset 每页 1,000 条流式读取，pre-count 与 streamed count 都执行 50,000 条上限，select 明确排除 `metadata`。
- CSV 固定 13 列、UTF-8 BOM、CRLF 和末尾 newline；先复用 secret sanitizer，再逐字符跳过 Unicode 空白与将被移除的非法 C0/DEL 控制字符，检查首个有效字符是否为公式前缀；之后规范 CRLF、移除非法控制字符并在必要时加单引号，由 `csv-stringify` 负责成熟 quoting。manifest v1 固定包含 range、null filters、query timestamps、record count 与 CSV SHA-256。
- 使用 `archiver@7.0.1` level 9 只写 `records.csv/manifest.json`。最初安装的 archiver 8 是 ESM-only，与当前 CommonJS Jest/Nest 加载边界不兼容；固定成熟的 7.0.1 并对齐 `@types/archiver@7.0.0`，避免把 Jest VM 绕过逻辑带入生产代码。归档 byte-count transform 同时计算实际 archive SHA-256 并在超过 64 MiB 时安全终止。
- plaintext temp 路径位于 `os.tmpdir()/prepmind-audit-export-<exportId>-<token>`；创建前要求可用空间严格大于 `2 * maxArchiveBytes`，内部失败自动清理，成功则由 processor `finally` 清理。`0700/0600` 只在 POSIX/Linux 容器形成明确权限保证；Windows 本地沿用临时目录继承 ACL，不能把 mode 数字等同于 Windows ACL，且 production export gate 默认关闭。
- MinIO key 固定为 `operator-audit-exports/<exportId>/attempts/<processingToken>.zip`，id/token 和 read/delete/list 都重新执行严格 grammar。只有当前 token 的 `markReady` CAS 能把 attempt key 写成数据库权威 object key；若 PostgreSQL commit 已成功但 ACK 丢失，Worker 会读取 Export + SYSTEM BackgroundJob 双事实：`READY + SUCCEEDED + 同 objectKey` 视为已提交并保留对象；明确仍是当前 token、已由其它 token 接管或终态未选择该 key 时才允许删除。reconciliation 不可用或结果不确定时保留对象并 delayed，未被权威 key 选中的 orphan 由 Phase 7.23.5 维护回收。missing 白名单为 NoSuchKey/NoSuchObject/MinIO 8 bodyless NotFound/HTTP 404，其余统一为不复制 raw message 的 unavailable。

边界：

- 本阶段没有实现 Phase 7.23.5 保留维护、stale repair/readiness 指标、Phase 7.23.6 list/detail/download API、fail-closed 下载审计、Admin UI 或 Docker 运行验收；production gates 仍默认关闭。
- safe DTO 仍不返回 object key、processing token、payload 或 metadata；MinIO export prefix 不进入既有公开图片/资料读写路径。下载前的对象存在性、range、响应头和下载审计属于后续阶段。

TDD 与验收：

- State RED 因 payload/repository 缺失失败，GREEN 11/11；CSV RED 因模块缺失失败，GREEN 5/5；Archive RED 因 service 缺失失败，首轮 GREEN 解决 ESM/CJS 依赖兼容后为 6/6，补充 1,001 行复合 keyset 后为 7/7。
- Storage RED 为 6 个新行为失败、18 个既有行为通过，GREEN 24/24；Processor RED 因模块缺失失败后 GREEN 10/10，role-bound provider RED 为 1 failed + 10 passed，首轮 GREEN 11/11。
- 交付前只读审查新增 RED 5 failed + 22 passed：精确复现 interval renew exception 静默完成、C0 清理后公式显露、MinIO ACK-lost orphan、manifest secret 与 archiver warning 缺口；修复后 CSV 5/5、Archive 9/9、Processor 13/13，共 27/27 GREEN。
- 质量复审按 TDD 新增 12 个 RED：覆盖 READY commit-ACK ambiguity、reconciliation 不可用、retry/final 状态 CAS 数据库失败、三 gate 注册矩阵、MinIO 8 `NotFound` 与 concurrency>1 配置；首轮 GREEN 后 4 suites 93/93。随后为消除启动竞态再新增 lifecycle RED，确认缺少 `onApplicationBootstrap`，改为 paused Worker + global-first bootstrap 后 Processor 18/18 GREEN。
- Worker run rejection 复审继续按 TDD：lifecycle RED 为 1 failed + 18 passed，证明 `run()` 未附加 catch；立即绑定 handler 后 19/19 GREEN。fatal service/process control RED 为 3 failed + 18 passed，接入固定日志与受控 SIGTERM 后 21/21 GREEN；最后用 signal-failure RED 证明原始错误会逃逸，补 `exit(1)` fallback 后 Processor 22/22 GREEN，测试全程 mock process control，未真实终止测试进程。
- BullMQ delay integration 首次运行已经证明 delayed 时 attempt 不增加，同时纠正了“成功 delivery 完成后仍应为 0”的过严测试假设；最终真实 Redis 1/1 通过并清理唯一测试 queue、job、Worker、QueueEvents 与连接。该 spec 只在显式文件 pattern 或 `test:integration:audit-export-delay` opt-in 时连接 Redis；质量修复后的默认完整 unit suite 为 61 suites、552 tests 通过，仅该 1 suite/1 test 跳过；另用 BullMQ 正式 `setGlobalConcurrency/getGlobalConcurrency` 对真实 Redis 验证 queue global concurrency 为 1。
- 聚焦 env/归档/状态/CSV/processor/storage 6 suites 共 112/112 通过；`main...HEAD` 全部 15 个 changed Server TS 定向 ESLint/Prettier 与 Server build 通过。依赖分类、temp/Redis cleanup、敏感串断言和 Phase 7.23.5+ 越界均已自审。

回顾时可以问：

- “processing token 如何阻止失去 lease 的旧 Worker 覆盖新证据包？”
- “为什么 attempt-fenced key 还必须配合数据库选中的 object key，而不能只依赖 MinIO 覆盖写？”
- “为什么公式检测必须早于 tab/CR 等控制字符清理？”
- “为什么审计查询选择只读 REPEATABLE READ，而申请事务仍使用 Serializable？”

### 2026-07-10 - Phase 7.23.3 Operator Audit Export 事务型可靠投递

目标：让 PostgreSQL commit 成为审计证据包申请的唯一成功边界，并由 Outbox Dispatcher 独占 PostgreSQL -> Redis/BullMQ 桥接，消除“数据库成功但 Redis enqueue 失败”的双写窗口。

为什么：

- request path 若在数据库事务之外直接调用 `queue.add()`，PostgreSQL 与 Redis 任一侧失败都会留下“有任务无队列”或“有队列无事实”的不可原子恢复状态。
- 证据包申请是高权限操作；Export、SYSTEM BackgroundJob、可靠投递事件和 `AUDIT_EXPORT_REQUEST` 必须同生共死，审计写失败不能像普通运维观测那样吞掉。
- Dispatcher 面对 retry、进程崩溃和重复 claim 时，必须用 deterministic Bull job id 和数据库关联事实复核来保证重复投递安全。

主要内容与做法：

- 新增 `POST /operator-audit-exports`，guard 顺序为 Operator Audit gate、export gate、JWT、Operator；export gate 关闭时认证前返回 404。body 使用 strict shared schema，非法 UUID/reason/date/unknown field 转为安全领域 400，不暴露 Zod issues；strict request audit 写失败回滚并返回安全领域 503。Swagger 明确完整 body properties/formats/length/enums、`additionalProperties:false` 与安全 202/400/409/429/503 样例。
- request service 在事务前生成 export/job UUID；Serializable 事务内依次以 `$executeRaw` 取得 retention/quota advisory locks，再用 database clock 校验 `start < end`、31 天上限、180 天下界、未来 end，并执行每管理员 active 2 / 每小时 10 / 全局 active 10 配额。Prisma 无法反序列化 advisory lock 的 `void` 返回，因此锁不能使用 `$queryRaw`。
- 首条 advisory lock 等待会在释放前固定 Serializable snapshot；整个 interactive transaction 没有事务外副作用，因此事务任意阶段（包括 strict audit create）只有 P2034、raw PostgreSQL 40001、明确 target 为 `OperatorAuditExport.[requestedByUserId,clientRequestId]` 的 P2002 才最多重跑 5 次。normalized input 与预生成 export/job UUID 跨 attempts 复用，每次 attempt 重新取锁与 DB clock；其它唯一冲突/错误原样失败。
- actor + clientRequestId + stable normalized request hash 支持幂等重放；lookup 先于滚动 retention/future 窗口校验，因此旧请求越过 180 天边界后同 hash 仍返回既有 DTO 且不重复写审计，不同 hash 仍优先返回 `OPERATOR_AUDIT_EXPORT_IDEMPOTENCY_CONFLICT`/409。只有 lookup 未命中的新申请才执行窗口、配额校验，并按 Export -> SYSTEM BackgroundJob -> OutboxEvent -> strict audit 顺序写入同一事务。
- `OutboxService.enqueueInTransaction()` 只使用传入 transaction client 且不 catch/root fallback；既有 `enqueue()` unique-key recovery 不变。Outbox payload 严格只有 `exportId/backgroundJobId`。
- `OperatorAuditService.recordSuccessStrict()` 可使用 transaction 或 root Prisma client 并传播错误；既有 success/failure 入口仍 warning-only，所以申请 audit 是 fail-closed/strict，Outbox requeue audit 仍 best-effort。来源指纹改为 `OPERATOR_AUDIT_FINGERPRINT_SECRET` 驱动的 `hmac-sha256:<64 hex>`。
- 注册 `operator-audit-export` queue 和 injectable bound-arrow handler。handler 严格校验 payload、Export 与 linked SYSTEM BackgroundJob；FAILED/EXPIRED、已交付的 PROCESSING/READY + ACTIVE/SUCCEEDED、已有 Bull job 都 no-op，只有 QUEUED export + QUEUED BackgroundJob 才以 BackgroundJob id 作为 Bull job id 投递，其余未批准状态组合按 invalid payload 进入 retry/dead-letter；Redis 错误原样传播。

边界：

- 当前没有 ZIP processor、CSV/manifest、MinIO 上传、保留维护、list/detail/download API、fail-closed 下载审计或 Admin UI；queue 中的 generate job 还没有消费者，不能把可靠投递理解成证据包已经能生成。
- export/maintenance production gates 继续默认关闭；本阶段没有新增 migration、没有改变知识库 queue-first + best-effort observer 语义，也没有让 API request path 直接接触 Queue。
- DEAD 事件仍可通过既有受审计 requeue 在设计的 24 小时投递恢复窗口内恢复；申请审计严格失败关闭，但既有 Outbox requeue 审计继续 best-effort。

验收：

- RED：指定 service 命令 4 个 suite 失败，分别证明 request service/handler、transactional enqueue、strict audit 与 HMAC 能力缺失；既有 15 项仍通过。
- GREEN：聚焦事务/handler/controller/audit/outbox 回归 11 个 suite、126 项通过；完整 Server 回归 57 个 suite、491 项通过；真实 PostgreSQL concurrency e2e 3/3 通过，三个场景均捕获 Prisma `P2034`、`target=undefined` 并由 bounded retry 恢复。定向 ESLint、changed-file Prettier 与 Server build 通过。
- 覆盖精确七步事务顺序、rollback 传播、同 hash replay/异 hash conflict、四类时间边界、三类配额、无 Queue 依赖、guard 顺序、strict payload、linked SYSTEM facts、Bull job 幂等/no-op 和 Redis 失败传播。

回顾时可以问：

- “事务型 Outbox 如何消除 PostgreSQL 成功但 Redis enqueue 失败的双写窗口？”
- “为什么 Serializable + advisory lock 需要 bounded whole-transaction retry，而不是改成 Read Committed？”
- “为什么 request audit 要 fail-closed/strict，而 Outbox requeue audit 仍然 best-effort？”
- “为什么 Dispatcher enqueue 前还要复核 Export 与 SYSTEM BackgroundJob，而不是只信 Outbox payload？”
- “领域 400/503 如何避免 Zod issues 与原始数据库错误进入响应？”

### 2026-07-10 - Phase 7.23.2 Operator Audit Export Contract 与持久化地基

目标：先固定证据包申请/查询的安全 contract、可恢复的导出领域事实和跨用户生命周期的 SYSTEM 后台任务语义，让后续可靠投递、Worker、维护任务和 API 建立在同一组数据库不变量上。

为什么：

- 账号级 `BackgroundJob` 原本通过 `userId` 外键级联删除，若直接承载审计导出，请求人删除会同时破坏仍需保留的导出事实与执行事实。
- 导出 DTO 必须在 API 实现前严格排除 object key、request hash、processing token、payload 与 metadata，避免内部投递/存储字段进入公共 contract。
- lease、BullMQ lock、stale repair 与 query timeout 有顺序约束；production 任一审计查询、Outbox 操作或导出路径开启后都必须具备至少 32 字符的 fingerprint secret，因此错误组合要在 bootstrap 时 fail fast。

主要内容与做法：

- 新增 `@repo/types/api/operator-audit-export` strict Zod contract：五种状态、UUID 幂等键、递增 ISO range、3~240 字符 reason、nullable filters、安全 detail/list 与稳定 cursor；`OperatorAuditAction` 增加 request/download actions。
- Prisma 新增 `OperatorAuditExport` 与 singleton maintenance state；`backgroundJobId` 唯一但无外键，`requestedByUserId` 删除时 `SET NULL`。`BackgroundJob` 增加 ACCOUNT/SYSTEM scope，数据库 CHECK 强制 ACCOUNT 有 user、SYSTEM 无 user，既有用户外键继续 `ON DELETE CASCADE`。
- 账号 `BackgroundJobsService` 的 create/find/count/update/list/summary，以及知识库 direct active count、create、active find、enqueue-failure update 全部显式带 `scope=ACCOUNT`，required `userId` 签名和 DTO 不变。数据库 e2e 使用隔离用户与定向清理，真实验证 FK、CHECK、`SET NULL` 和 service scope。
- export/maintenance gates 在所有环境默认关闭；worker/both 开启 export 时必须同时开启 Dispatcher 与 maintenance。配置层约束 `lease < Bull lock < stale` 且 `query timeout < stale`；production 显式开启 Operator Audit、Outbox Ops 或 audit export 任一路径都必须提供 trim 后至少 32 字符的 secret，非 production fallback 也满足长度要求。本阶段只做配置门禁，不实现 HMAC hashing。
- export list query 拒绝 `createdFrom > createdTo` 并允许相等边界；strict nested filters characterization 证明内部 `objectKey` 不能藏进 filters。
- Docker server 镜像以 `NODE_ENV=production` 运行，而 dev Compose 显式开启 Outbox Ops 与 Operator Audit；因此只在 `docker-compose.dev.yml` server environment 提供可覆盖的 `local-dev-audit-fingerprint-change-me` fallback。`Dockerfile.server` 不烘焙该 secret，真实 production 必须提供独立值并禁止复用本地 fallback。

边界：

- 没有实现导出申请事务、Outbox 可靠投递、BullMQ queue/handler、ZIP Worker、MinIO、180 天保留清理、HTTP API、下载审计或 Admin UI。
- request/download actions 只是 contract/enum 预留，export/maintenance 表没有运行时写入者；两项 production gate 保持关闭，不能把 schema 落库理解成已交付运行能力。

验收：

- RED：contract 因缺失模块/actions 失败；env/account-scope 定向测试 13 项按缺失 key/scope 失败；数据库 e2e 3 项按 Prisma 不认识 scope、SYSTEM 仍要求 user 失败；首次 Server build 发现旧审计 row type 仍只接受 `OUTBOX_REQUEUE`。
- Quality review RED：env 定向测试分别暴露 production Outbox Ops、API-role export 与短 secret 未拒绝；list query reversed window 未拒绝；知识库 direct BackgroundJob count/create/find/update 都缺少 ACCOUNT scope。
- Characterization：nested filters strict test 首次即通过；两条数据库负例首次运行时 PostgreSQL 已通过 `BackgroundJob_scope_user_check` 拒绝，只需把断言从不存在的 Prisma `P2004` code 改为匹配真实 constraint wrapper。
- Spec re-review RED：`docker-compose-readiness` 10 项通过、1 项失败，定位到 dev Compose 在 production runtime 下开启审计 gates 却没有提供新要求的 fingerprint secret；修复后 suite 11 项通过，并确认 secret 只属于 server service、未写进 production Dockerfile。
- GREEN：contract 14 项与 types typecheck 通过；required Server focused gate 64 项通过；migration 在本地 `5433` PostgreSQL 成功部署；database typecheck、background-job-scope e2e 5 项与 Server build 通过。
- e2e 证明两种非法 scope/user 组合都被数据库拒绝、ACCOUNT job 随 user 删除、SYSTEM job 与 export 在 requester 删除后保留、`requestedByUserId` 置空且 `backgroundJobId` 不变，并证明账号 service 不能读取 SYSTEM job。

回顾时可以问：

- “为什么 `OperatorAuditExport.backgroundJobId` 唯一但不建立外键？”
- “ACCOUNT job 的 `userId + scope` 双重过滤和数据库 CHECK 分别防什么？”
- “为什么 export/maintenance 在所有环境默认关闭？”
- “lease、BullMQ lock、stale repair 和 query timeout 为什么必须有严格相对顺序？”

### 2026-07-10 - Phase 7.23 实施计划就绪

目标：把已审阅通过的审计保留与证据包设计拆成能够逐阶段 TDD、独立提交、合入 `main` 并再次验收的实施路线，避免把事务、Worker、维护任务、下载安全和 Admin UI 一次性堆进不可审查的大提交。

为什么：

- 这条链路跨 PostgreSQL、Outbox、Redis/BullMQ、MinIO、二进制 HTTP 和 Admin Console；只写功能清单无法约束双写窗口、僵尸 Worker、保留清理竞态和 fail-closed 审计。
- 仓库要求一步一提交、任务后同步文档、合并 `main` 后复验，而且新任务必须从最新 `main` 开分支；计划需要把这些要求变成每阶段的执行门禁。
- 设计中有 31 天、50,000 条、64 MiB、24/48 小时、180 天等相互关联的边界，必须提前固定类型名、队列名、测试命令和预期结果，避免实现时各模块自行解释。

主要内容：

- 正式计划：`docs/superpowers/plans/phase-7-23-operator-audit-retention-export.md`。
- Phase 7.23.2 ~ 7.23.8 分别覆盖 contract/Prisma、事务型 Outbox、ZIP Worker、保留维护、查询下载 API、Admin 证据包 UI、Docker 验收与面试博客。
- 每个阶段使用独立 `codex/phase-7-23-*` 分支和一个实现提交；阶段验收后 `--no-ff` 合入 `main`，在 `main` 重跑同一验证门禁后才能开下一分支。
- 计划写明 RED/GREEN 命令、关键签名、数据库约束、BullMQ 5.79.2 delayed 行为验证、CSV 公式注入样本、MinIO lifecycle、二进制 envelope 旁路和普通用户 403 验收。

边界：

- 本次只新增实施计划和进度索引，没有修改 Prisma、API、Worker、MinIO、Admin UI 或运行时配置。
- Phase 7.23.2 仍未开始，当前项目不具备证据包申请、生成、下载或自动保留清理能力。
- 计划不改变现有 Outbox requeue 的 best-effort 审计，也不加入 legal hold、预签名下载、数字签名或全库导出。

验收：

- 已从最新 `main` 创建独立计划分支；计划包含 writing-plans 要求的 agentic-worker 说明、checkbox 步骤、精确路径、TDD 失败/通过预期和逐任务提交。
- 已按设计逐项覆盖三份事实、SYSTEM job、事务型 Outbox、lease/token fencing、REPEATABLE READ、保留水位、fail-closed 下载、Admin Blob 下载和 Docker 主分支复验。
- 已执行占位词、类型/名称一致性、路径引用和 `git diff --check` 自审；实现阶段仍必须以每个任务的新鲜测试输出为准。

回顾时可以问：

- “为什么 Phase 7.23 要拆成 7 个从 `main` 开始的阶段，而不是一个长期功能分支？”
- “计划如何把双写、僵尸 Worker、保留清理和二进制下载分别放进可验证的任务？”
- “实现时为什么每次合并 `main` 后还要重复验收？”

### 2026-07-10 - Phase 7.23.1 Operator Audit 保留周期与证据包导出设计

目标：为现有 `OperatorAuditLog` 补上明确的 180 天保留边界，并设计一条 ADMIN 可控、脱敏、可校验、24 小时过期的事故证据包导出链路。

为什么：

- 审计日志如果没有保留周期会持续增长，也无法解释数据为什么仍被保存。
- 当前 Admin Console 只能在线查看审计记录，事故复盘时缺少安全交接方式；数据库裸导出会绕过 DTO 脱敏边界。
- BackgroundJob 只能证明数据库里存在任务，不能消除 PostgreSQL commit 成功但 Redis enqueue 失败的双写窗口。
- 导出文件本身也是敏感数据，必须有独立 TTL、下载审计和自动清理，不能把 MinIO 临时目录当长期档案库。

主要内容：

- 明确第一版定位为事故排障证据包，不做通用 BI、legal hold、WORM、数字签名或长期合规归档。
- 默认保留 `OperatorAuditLog` 180 天；证据包最多覆盖 31 天、50,000 条记录，ZIP 在 MinIO 保留 24 小时。
- 设计 `OperatorAuditExport` 领域模型，和 `BackgroundJob`、`OutboxEvent` 分别承担导出事实、执行事实和可靠投递事实。
- 导出申请在同一 PostgreSQL 事务内创建 Export、BackgroundJob、OutboxEvent 和 `AUDIT_EXPORT_REQUEST` 审计；Outbox Dispatcher 是 BullMQ enqueue 的唯一桥接入口。
- `BackgroundJob` 设计增加 `ACCOUNT / SYSTEM` scope 与 nullable user 关系，避免请求人删除时级联破坏系统级导出任务；Worker 使用 processing token + lease 恢复硬崩溃后的 stalled attempt。
- ZIP 固定包含脱敏 `records.csv` 与 `manifest.json`，提供 CSV / archive SHA-256；CSV 需要防 formula injection，SHA-256 不宣传成数字签名。
- 导出申请和下载使用 fail-closed audit；现有 Outbox requeue audit 继续保持 best-effort，不被本阶段意外改变。
- 维护任务使用活跃导出水位保护 180 天边界数据，分批清理到期 ZIP、历史审计和导出元数据。
- 导出申请与 retention batch 共享 PostgreSQL advisory lock，查询使用 REPEATABLE READ；MinIO prefix lifecycle、crash janitor 和持久 maintenance state 补齐物理清理与 readiness 兜底。
- Admin Console `/audit` 规划“审计记录 / 证据包”标签页；实现拆为 Phase 7.23.2 ~ 7.23.8，每项单独提交并同步文档。

边界：

- 本提交只落设计，不修改 Prisma、contract、API、Worker、MinIO、Admin UI 或运行时配置。
- 不导出 `metadata`、Outbox payload、aggregateId、用户正文、prompt、RAG chunk、模型回答、API key、token、cookie、原始 IP 或原始 User-Agent。
- 不提供全库导出、手动延期、恢复过期文件、删除审计记录、编辑 payload 或绕过 OperatorGuard 的入口。

验收：

- 开始新任务前先把 Phase 7.17 ~ 7.22 合入 `main`；合并后复验发现 5 处 Prettier 问题，修复提交后定向 Server lint 与 107 项相关测试通过，Web 294 项和 Admin 33 项测试、相关 build/typecheck/Compose config 也通过。
- 设计按“背景 / 目标 / 非目标 / 数据模型 / 事务型 Outbox / Worker / 保留清理 / API / Admin / 测试 / 验收 / 实施拆分”完整记录。
- 正式 spec：`docs/superpowers/specs/phase-7-23-operator-audit-retention-export-design.md`。

回顾时可以问：

- “为什么 BackgroundJob、OperatorAuditExport 和 OutboxEvent 不能互相替代？”
- “当前知识库 requested outbox 为什么不能防止 BullMQ enqueue 丢失？”
- “为什么审计导出要 fail-closed，而 Outbox requeue audit 仍然 best-effort？”
- “维护任务如何避免删掉仍被活跃导出需要的 180 天边界数据？”
- “CSV formula injection 和 SHA-256 的能力边界分别是什么？”

### 2026-07-09 - Phase 7.22 Docker Admin Ops 真实验收收口

目标：在 Docker 全栈环境里用真实管理员账号完整跑一轮 Admin Console 运维闭环，确认 Phase 7.21 的筛选控件和 requeue guard 不只在 mock / 静态测试里成立，也能在真实容器、真实 API、真实 PostgreSQL 数据上工作。

为什么：

- Admin Console 是给管理员排障用的，不验 Docker 全栈就无法证明 `admin -> server -> postgres / redis / worker` 的真实链路可用。
- Outbox requeue 是系统级状态变更，必须确认普通用户不能访问、管理员操作必须写审计、worker readiness 能反映 backlog 并在测试数据清理后恢复。
- 本轮验收还发现后台缺少 favicon 会产生浏览器 404 噪声，因此顺手补齐后台图标，让调试控制台更干净。

主要内容：

- 使用 Docker Compose dev 栈启动 `postgres / redis / minio / server / worker / web / admin`，管理员后台访问 `http://127.0.0.1:3100`，API 访问 `http://127.0.0.1:3001`。
- 创建临时 ADMIN 账号和临时普通账号；ADMIN 账号登录后台并完成 `/outbox -> requeue -> /audit -> /worker` 浏览器验收，普通账号直接请求 `/outbox-events` 返回 `403`。
- 在数据库中插入安全的 `knowledge.document.processing.requested` 失败 outbox 事件，页面里确认自定义状态筛选是 `combobox`，没有回退到原生 `<select>`；requeue 按钮在填写 reason 和勾选确认前不可用。
- requeue 成功后在 `/audit` 看到 `OUTBOX_REQUEUE / SUCCEEDED` 审计记录，并能点开右侧详情；在 `/worker` 看到因为临时 pending outbox 导致的 degraded 信号，清理测试数据后容器内 readiness CLI 恢复 `ready`。
- 新增 `apps/admin/public/favicon.svg` 并在后台 `metadata.icons` 中声明，减少后台浏览器调试时的 favicon 404 噪声。

边界：

- 本阶段不新增后端 API、不新增批量 requeue、不新增删除 / 跳过 / 立即 dispatch / payload 编辑。
- 测试 outbox、审计记录和临时账号在验收后清理，不污染本地长期数据。
- 前端 reason + confirm 仍是产品层防误操作；真正安全边界仍是后端 feature gate、`JwtAuthGuard`、`OperatorGuard` 和服务层状态机。

验收：

- Docker 浏览器验收：`http://127.0.0.1:3100/login` 登录 ADMIN，进入 `/outbox` 完成筛选、详情、reason + confirm requeue；进入 `/audit` 查看审计记录详情；进入 `/worker` 查看 readiness。
- 普通用户 API 验收：临时普通账号携带 token 访问 `GET /outbox-events?status=FAILED` 返回 `403`。
- 容器 readiness 验收：`docker compose --project-name docker -f P:\docker\docker-compose.dev.yml --project-directory P:\ exec -T worker bun apps/server/dist/scripts/worker-readiness.js` 输出 `Worker readiness: ready`。

回顾时可以问：

- “为什么 Phase 7.21 做完后还要单独做 Docker 全栈验收？”
- “Outbox requeue 后为什么 worker readiness 会短暂 degraded？”
- “普通用户 403 和前端隐藏入口分别证明了什么？”
- “为什么验收数据要清理，哪些数据可以清理，哪些生产审计不能随便清理？”

### 2026-07-09 - Phase 7.21 Admin Ops 交互收口

目标：把管理员后台的 Outbox / Audit 筛选和 requeue 操作体验再收紧一层，解决原生下拉框割裂、requeue 原因可省略导致复盘信息不足的问题。

为什么：

- 后台管理不只是“能调接口”，还要让管理员在高压排障时快速判断、谨慎操作、事后能复盘。
- 浏览器原生 select 在 Windows 上会出现系统蓝色高亮和粗边框，和当前 Admin Console 的低干扰视觉语言割裂，显得像临时 demo。
- requeue 会改变系统级 outbox 状态，即使后端允许 reason 可选，前端运维工作流也应该引导管理员填写原因，便于后续在 `/audit` 详情里解释这次操作。

主要内容：

- 新增 `apps/admin/src/components/admin-filter-select.tsx`，提供后台专用自定义筛选控件，支持 `combobox / listbox / option` 语义、label 关联、`aria-selected`、`aria-activedescendant`、上下键切换、Enter 选择、Escape 关闭、外部点击关闭和低干扰滚动样式。
- `/outbox` 和 `/audit` 替换原生 `<select>`，状态筛选统一使用 Admin Console 的轻量 popover 风格。
- `/outbox` requeue 前端增加 `reasonRequired` guard：必须填写 reason 并勾选确认后，按钮才可用；切换事件或筛选条件时清空 reason，避免把 A 事件的原因误带到 B 事件；成功后仍刷新 outbox、audit 和 worker readiness。
- 新增静态 contract test，防止页面回退到原生 select，防止 requeue 操作绕过 reason guard。

边界：

- 不新增后端 API，不改变 `POST /outbox-events/:id/requeue` contract；后端仍只做安全状态机和审计。
- 不新增批量 requeue、删除事件、跳过事件、立即 dispatch 或 payload 编辑。
- 前端 reason 必填是产品化防误操作，不替代后端 `JwtAuthGuard + OperatorGuard + OutboxOpsService` 的真实安全边界。

验收：

- `bun --filter @repo/admin test`
- `node --experimental-strip-types --test apps/admin/src/lib/*.test.mts`
- `bun --filter @repo/admin lint`
- `bun --filter @repo/admin build`

回顾时可以问：

- “为什么后台管理页面不直接用浏览器原生 select？”
- “为什么 requeue reason 在后端可选，但前端要做必填？”
- “前端防误操作和后端状态机安全边界分别负责什么？”
- “如何用静态 contract test 防止 UI 回退和危险入口回归？”

### 2026-07-09 - Phase 7.20 Operator Audit 详情闭环

目标：把 Admin Console 的 `/audit` 从“能查审计列表”升级为“能追踪一次管理员诊断写操作全过程”的审计详情页，让 requeue 后的复盘更完整。

为什么：

- Phase 7.19 已经让控制台能发现风险，Phase 7.18 已经让 Outbox Ops 能处理风险，但 Audit 如果只有列表，管理员仍然很难看清一次操作的完整上下文。
- 高权限诊断写操作需要可复盘：谁操作、操作了什么 target、为什么操作、请求指纹是什么、失败时错误摘要是什么。
- 面试表达上，这一步能把后台管理闭环讲成“发现问题 -> 处理问题 -> 验证恢复 -> 审计复盘”，而不是只讲一个 requeue 按钮。

主要内容：

- `@repo/types/api/operator-audit` 新增 `operatorAuditLogDetailResponseSchema`，详情 DTO 复用脱敏列表 item 字段。
- 后端新增 `GET /operator-audit-logs/:id`，经过 `OPERATOR_AUDIT_ENABLED` feature gate、`JwtAuthGuard` 和 `OperatorGuard`。
- `OperatorAuditService.getDetail()` 使用显式 `select`，继续排除 `metadata`，不存在时返回 `OPERATOR_AUDIT_LOG_NOT_FOUND`。
- Admin Console `/audit` 改成列表 + 详情双栏；点击左侧记录后，右侧展示操作上下文、目标对象、来源指纹和错误摘要。
- 列表选中态增加 `aria-pressed` 和左侧强调条；列表与详情区域都使用独立滚动。
- `operator-audit-page-contract.test.mts` 增加静态契约，防止页面退回纯列表或展示 `metadata`、payload、原始 IP / User-Agent 等敏感内容。
- `docs/blogs/admin-console-ops-platform.md` 补充“审计详情为什么重要”。

边界：

- 不新增审计导出、保留周期配置、更细 operator role、批量操作或审计删除。
- 详情 API 不返回 `metadata`、payload、aggregateId、用户正文、prompt、RAG chunk、模型回答、API key、token、cookie、原始 IP 或原始 User-Agent。
- 前端详情页只是运维体验层，不承担最终鉴权；真正安全边界仍是后端 feature gate、`JwtAuthGuard` 和 `OperatorGuard`。

验收：

- `bun test packages/types/tests/operator-audit.test.mts`
- `bun --cwd packages/types typecheck`
- `bun --filter @repo/server test -- operator-audit --runInBand`
- `bun --filter @repo/server build`
- `node --experimental-strip-types --test apps/admin/src/lib/*.test.mts`
- `bun --filter @repo/admin lint`
- `bun --filter @repo/admin build`
- Docker 重建 `server / admin` 后访问 `http://localhost:3100/audit`，点击审计记录，确认右侧详情展示操作上下文、目标对象、来源指纹和错误摘要，且不展示敏感原始字段。

回顾时可以问：

- “为什么审计列表不够，需要审计详情？”
- “审计详情为什么复用脱敏 DTO，而不是把 metadata 也返回前端？”
- “Operator Audit 如何记录 requestId、IP hash 和 User-Agent hash？”
- “前端审计详情和后端 OperatorGuard 的安全职责怎么分工？”
- “这一步如何补齐后台管理的复盘闭环？”

### 2026-07-09 - Phase 7.19 Admin Console 控制台数据化

目标：把独立管理员后台首页从“能跳转到各个运维页面”的入口页，升级成管理员一打开就能看到系统当前状态的真实运维总览。

为什么：

- Phase 7.16 ~ 7.18 已经有独立 Admin Console、Docker admin service、Outbox Ops、操作审计和 Worker Readiness，但首页如果只是静态导航，就不像真正的企业后台。
- 管理员进入后台时，第一眼应该知道“现在有没有需要处理的任务链路风险”，而不是先逐个页面点进去找。
- 面试表达上，这一步能把后台管理讲成一套运维产品闭环：总览发现风险，Outbox 处理事件，Audit 复盘操作，Worker Readiness 验证恢复。

主要内容：

- `/` 控制台使用 TanStack Query 读取 `workerReadinessApi.get()`、`outboxApi.list(FAILED / DEAD)` 和 `operatorAuditApi.list(OUTBOX_REQUEUE)`。
- 新增 `admin-dashboard-view.ts`，把 readiness、outbox 和 audit 信号聚合为顶部状态、关注项数量、FAILED / DEAD 数量和最近审计数量。
- 顶部状态区根据 read error、`not_ready`、DEAD outbox、`degraded`、FAILED outbox 和审计失败生成不同严重度。
- 中部三块信号继续对应 `/worker`、`/outbox`、`/audit`，但展示真实状态摘要，而不是静态说明。
- 最近关注区按风险优先展示 DEAD / FAILED 事件、readiness issue 和最近审计结果。
- 同步补了一篇面试学习博客 `docs/blogs/admin-console-ops-platform.md`，覆盖今天整个后台管理产品化链路，而不是只写控制台首页。

边界：

- 不新增后端 API，不改变权限模型，不放宽 CORS、feature gate、`JwtAuthGuard` 或 `OperatorGuard`。
- 控制台只读取脱敏 DTO，不展示 payload、aggregateId、用户正文、prompt、RAG chunk、模型回答、API key、token 或 cookie。
- 不新增批量 requeue、删除事件、跳过事件、立即 dispatch 或 payload 修改。
- 数据读取失败时显示异常状态，不使用假数据伪装健康。

验收：

- `node --experimental-strip-types --test apps/admin/src/lib/*.test.mts`
- `bun --filter @repo/admin lint`
- `bun --filter @repo/admin build`
- Docker 使用 `subst P: "E:\PrepMind_ai智能备考助手"` 映射路径后重建 `admin`，浏览器访问 `http://localhost:3100/`。
- 浏览器验收确认控制台读取真实 Worker readiness、FAILED / DEAD Outbox 数量和最近审计记录；内部入口跳转到 `/worker` 正常。

回顾时可以问：

- “为什么后台首页不能只是导航页？”
- “控制台如何聚合 Worker Readiness、Outbox 和 Operator Audit？”
- “为什么读取失败要作为一个明确运维状态，而不是静默兜底？”
- “Admin Console 前端总览和后端 OperatorGuard 的安全边界怎么分工？”
- “今天的后台管理链路如何从发现问题、处理问题到复盘问题形成闭环？”

### 2026-07-09 - Phase 7.18 Admin Outbox Ops 产品化

目标：把独立后台里的 `/outbox` 从“能查列表、能点 requeue”的工程调试页，升级成管理员能理解失败原因、判断是否适合重新入队、执行安全 requeue，并知道后续去哪里验证恢复的单事件操作工作流。

为什么：

- Outbox requeue 会改变系统级事件状态，如果页面只给一个按钮，管理员很容易把 handler missing、invalid payload 这类根因未修复的问题误当成“重试一下就好”。
- Phase 7.15 ~ 7.17 已经把权限、审计、Worker Readiness 和独立 Admin Console 搭起来了，下一步需要把这些能力串成真正可操作、可解释、可复盘的后台流程。
- 面试表达上，这一步能讲清楚“后台运维页面不是堆 API 返回值”，而是把状态机、错误分类、审计和后续观测做成产品化闭环。

主要内容：

- `apps/admin/src/lib/outbox-view.ts` 增加 Outbox 展示 helper：只允许 `FAILED / DEAD` 进入 requeue 流程；`PENDING / PROCESSING / SUCCEEDED` 给出只读原因；handler missing、invalid payload、Redis/数据库/超时和未知错误给出不同处理建议。
- `/outbox` 详情页重构为五个分区：生命周期、事件身份、诊断建议、重新入队操作、后续验证。
- 重新入队操作保留“操作原因 + 显式确认 + 按钮禁用”三段式保护；requeue 成功后刷新 outbox 列表、详情、operator audit 和 worker readiness 缓存，避免 20 秒 staleTime 内看到旧信号。
- 后续验证区直接给出 `/worker` 和 `/audit` 入口，让管理员知道 requeue 后要看 Worker Readiness、Outbox backlog 和操作审计，而不是以为按钮点完就代表任务已经执行完成。
- 列表选中态增加 `aria-pressed` 与左侧强调条，不再只依赖背景色判断当前选中事件。
- 增加静态 contract test，防止页面暴露完整 payload 或增加批量 requeue、删除、跳过、立即 dispatch、payload 修改等危险入口；浏览器验收中发现 aftercare 文案容易暗示危险操作名后，补充测试并改成“不会改写事件数据或事件结果”。

边界：

- 本阶段不改后端 API contract，不新增权限模型，不绕过 `JwtAuthGuard + OperatorGuard`。
- 页面仍只展示脱敏 DTO、`payloadHash`、错误 code / preview、状态和时间戳，不展示完整 payload、aggregateId、用户正文、prompt、RAG chunk、模型回答、API key、token 或 cookie。
- requeue 仍只是安全状态流转：`FAILED / DEAD -> PENDING`，不立即执行 handler，不改写事件数据，不改写事件结果。
- 不做批量操作、删除事件、跳过事件、立即 dispatch、payload 修改、审计导出或保留周期策略。

验收：

- `node --experimental-strip-types --test apps/admin/src/lib/outbox-page-contract.test.mts apps/admin/src/lib/outbox-view.test.mts`
- `bun --filter @repo/admin lint`
- `bun --filter @repo/admin build`
- Docker 使用 `subst P: "E:\PrepMind_ai智能备考助手"` 规避中文路径 BuildKit header bug 后，重建并启动 `admin`，浏览器访问 `http://localhost:3100/outbox`。
- 浏览器验收覆盖：管理员登录态可进入 Outbox Ops；FAILED 事件详情展示五个分区；详情不展示完整 payload；invalid payload 提示先修生产方/数据契约；Redis timeout 事件提示依赖恢复后再 requeue；原因和确认未满足时按钮禁用；requeue 后事件回到 `PENDING`、attempts 重置、后续验证区更新；`/audit` 能看到脱敏 requeue 审计；清理测试数据后 `/worker` 回到 `Ready` 且 `backlog=false`。

回顾时可以问：

- “为什么 Outbox Ops 页面不能只做一个 requeue 按钮？”
- “handler missing、invalid payload 和 Redis timeout 三类错误为什么要给不同操作建议？”
- “requeue 为什么只是状态机里的 `FAILED / DEAD -> PENDING`，而不是立刻执行 handler？”
- “为什么 requeue 成功后要同时刷新 outbox、audit 和 worker readiness？”
- “前端页面隐藏危险入口和后端 `OperatorGuard` 的安全职责有什么区别？”

### 2026-07-09 - Phase 7.17.1 管理员后台返回学习端登录态修复

目标：修复从独立管理员后台点击“返回学习端”后，学习端看起来又要求重新登录的问题，并把本机 `localhost` / `127.0.0.1` 混用导致的登录态排障经验沉淀到文档里。

为什么：

- Phase 7.16 / 7.17 已经把学习端和管理员后台拆成两个 Next app，用户会在 `3000` 和 `3100` 两个端口之间跳转。
- 本机浏览器会把 `localhost` 和 `127.0.0.1` 当成不同 host；如果后台通过 `localhost:3100` 打开，却硬跳回 `127.0.0.1:3000`，前端状态、refresh cookie 和 API 请求 host 就可能不一致。
- 这个问题表面像“鉴权失效”或“后台返回后掉登录”，但根因不是后端 `JwtAuthGuard` 坏了，而是本机 loopback host 混用让 session recovery 链路不稳定。

主要内容：

- 后台“返回学习端”不再硬编码 `http://127.0.0.1:3000`，而是优先使用 `NEXT_PUBLIC_LEARNING_APP_URL`，未配置时跟随当前页面的 `window.location.hostname` 跳回对应的 `3000`。
- 学习端和管理员后台的 API client 在浏览器端会对齐 loopback host：当页面是 `localhost` 时，把本机 API base 也解析为 `localhost:3001`；当页面是 `127.0.0.1` 时，则解析为 `127.0.0.1:3001`。
- 新增回归测试覆盖后台返回 URL、admin API base 和 web API base 的 loopback host 对齐规则。
- `docs/dev-start.md` 补充管理员后台和学习端跳转时的 host 选择建议，避免后续手动验收再次踩坑。

边界：

- 这次不改变后端鉴权模型、不改变 cookie 策略、不放宽 CORS 和 `OperatorGuard`。
- `NEXT_PUBLIC_LEARNING_APP_URL` 仍可用于显式覆盖学习端地址；自动对齐只处理本机 `localhost` / `127.0.0.1` 场景，不改外部域名。
- 前端 host 对齐只是本地开发和 Docker dev 验收体验修复，真正权限仍由后端 session、access token、`JwtAuthGuard` 和 `OperatorGuard` 控制。

验收：

- `node --experimental-strip-types --test apps/admin/src/lib/*.test.mts`
- `node --experimental-strip-types --test apps/web/src/lib/api-client.test.mts apps/web/src/lib/sidebar-nav.test.mts`
- `bun --filter @repo/admin lint`
- `bun --filter @repo/web lint`
- `bun --filter @repo/admin build`
- `bun --filter @repo/web build`
- Docker 重建并启动 `web / admin / server` 后，浏览器访问 `http://localhost:3100/worker`，确认“返回学习端”链接为 `http://localhost:3000`，点击后直接进入 `http://localhost:3000/chat`，没有回到登录页。

回顾时可以问：

- “为什么 `localhost` 和 `127.0.0.1` 在浏览器登录态里不能随便混用？”
- “为什么这个问题看起来像鉴权失败，但根因其实是前端 host 和 refresh cookie 链路不一致？”
- “后台返回学习端为什么要跟随当前 hostname，而不是固定写死 `127.0.0.1`？”
- “Docker dev、本机 dev 和生产域名场景下，前端 API base 应该怎么区分？”

### 2026-07-09 - Phase 7.17 Docker Admin Console Service

目标：把 Phase 7.16 的独立管理员后台从“只能本机 `bun run dev:admin` 启动”推进到 Docker Compose 一等服务，让本地全栈部署形态和我们讲的架构边界一致。

为什么：

- Phase 7.16 已经把学习端和管理员后台拆成两个 Next app，但 Docker 里还只有 `web / server / worker`，部署拓扑不完整。
- 管理员后台应该能像企业项目一样单独启动、单独暴露端口、单独验收，而不是永远依赖学习端 dev server。
- 面试讲架构时可以清楚解释：`web` 是学生学习 PWA，`admin` 是 operator 控制台，`server` 是 API，`worker` 是后台任务进程。

主要内容：

- 新增 `docker/Dockerfile.admin`，用 Bun workspace + Next standalone 构建 `@repo/admin`，容器端口为 `3100`。
- `docker/docker-compose.dev.yml` 新增 `admin` service，依赖 `server`，浏览器访问 `http://127.0.0.1:3100`。
- Docker `web` service 增加 `NEXT_PUBLIC_ADMIN_CONSOLE_URL=http://127.0.0.1:3100`，学习端 ADMIN 侧边栏“后台管理”默认跳转到管理员后台容器。
- Docker `server` CORS 默认补充 `http://localhost:3100` 和 `http://127.0.0.1:3100`。
- 修复 `Dockerfile.web` / `Dockerfile.server` 的 workspace manifest 缺口：根 workspace 是 `apps/*`，所以 deps 层必须复制 `apps/admin/package.json`，否则 `bun install --frozen-lockfile` 会失败。
- 新增/扩展 Docker 静态契约测试，覆盖 admin Dockerfile、admin compose service、web 管理后台 URL 和 workspace manifest 完整性。

边界：

- 本阶段不新增新的后台业务页面，不新增新的后端 API 或权限模型。
- 不做生产域名、TLS、反向代理、镜像推送或 Kubernetes 配置。
- 管理员后台前端只是体验层，真正安全边界仍是后端 `JwtAuthGuard + OperatorGuard`。

验收：

- `bun --filter @repo/server test -- docker-compose-readiness --runInBand`
- `docker compose -f docker/docker-compose.dev.yml --profile worker build admin`
- `docker compose -f docker/docker-compose.dev.yml --profile worker build web`
- `docker compose -f docker/docker-compose.dev.yml --profile worker build server`
- `docker compose -f docker/docker-compose.dev.yml --profile worker build worker`
- `docker compose -f docker/docker-compose.dev.yml --profile worker up -d --build postgres redis minio server worker web admin`
- `docker compose -f docker/docker-compose.dev.yml --profile worker ps`：`web` 暴露 `3000`，`admin` 暴露 `3100`，`server` 暴露 `3001`，`worker` 为 `healthy`。
- 浏览器验收：`http://127.0.0.1:3000` 学习端可加载；`http://127.0.0.1:3100` 管理员后台可加载；管理员可看控制台、Outbox Ops、操作审计和 Worker Readiness；普通用户请求 `/operator-audit-logs`、`/worker-readiness`、`/outbox-events` 均返回 403。
- 中文路径下 Docker Compose `--build` 仍可能触发 Docker Desktop gRPC non-printable ASCII，本次使用 `subst P: "E:\PrepMind_ai智能备考助手"` 映射 ASCII 路径完成全栈验收。

回顾时可以问：

- “为什么 `admin` 要做成独立 Docker service，而不是继续塞进 `web`？”
- “Docker 里的 `web / admin / server / worker` 各自承担什么职责？”
- “为什么 Dockerfile 的 deps 层必须复制所有 workspace package.json？”
- “管理员后台前端门禁和后端 OperatorGuard 的安全边界有什么区别？”

### 2026-07-09 - Phase 7.16 桌面端 Admin Console 第一版

目标：把管理员诊断能力从学习端移动页面里抽出来，形成独立的桌面端后台管理入口，让 Outbox requeue、审计查询和 worker readiness 更像企业项目里的运维后台。

为什么：

- 全部堆在学习端侧边栏会让普通学习产品变臃肿；管理员工具应该和学生学习路径分离。
- `/operator-audit` 适合作为移动端/轻量审计入口，但 Outbox requeue 需要详情、确认、原因输入和错误建议，更适合电脑屏幕。
- 后续如果继续加 operator 页面，例如 outbox 详情、任务重放、告警、导出、保留周期配置，独立 admin app 更容易扩展。

主要内容：

- 新增 `apps/admin` Next.js workspace，包名 `@repo/admin`，默认端口 `3100`，根命令 `bun run dev:admin`。
- 新增后台登录、会话恢复和 `ADMIN` 前端门禁；真正安全边界仍由后端 `JwtAuthGuard + OperatorGuard` 保证。
- 新增后台控制台、`/outbox`、`/audit`、`/worker` 页面。
- `Outbox Ops` 复用 `GET /outbox-events`、`GET /outbox-events/:id` 和 `POST /outbox-events/:id/requeue`，支持筛选、脱敏详情、原因输入、显式确认和 requeue。
- `Outbox Ops` 对 `OUTBOX_HANDLER_NOT_FOUND` / handler missing 类错误给出“先修复代码，不要盲目重新入队”的提示。
- `操作审计` 复用 `GET /operator-audit-logs`，展示 `OUTBOX_REQUEUE` 的成功/失败、target、reason、actor、错误摘要。
- `Worker Readiness` 复用 `GET /worker-readiness`，展示 Redis、BullMQ queue、worker heartbeat 和 outbox readiness。
- 学习端保留 `/operator-audit`；ADMIN 用户在移动端和桌面端侧边栏都会看到“后台管理”入口，普通用户和匿名用户不显示；后台应用本身仍是桌面优先布局。

边界：

- 本阶段不新增独立 Docker `admin` service；本地用 `bun run dev:admin` 启动，后端仍可连接 Docker PostgreSQL / Redis / MinIO。
- 不新增后端接口、不放宽鉴权、不做批量 requeue、不删除 outbox event、不编辑 payload、不直接执行 handler。
- 前端隐藏入口只是体验层，不作为权限边界；所有系统级诊断仍以后端 guard 为准。

验收：

- `node --experimental-strip-types --test apps/admin/src/lib/*.test.mts`
- `node --experimental-strip-types --test apps/web/src/lib/sidebar-nav.test.mts`
- `bun --filter @repo/admin lint`
- `bun --filter @repo/admin build`
- `bun --filter @repo/web lint`
- `bun --filter @repo/server test -- outbox-ops.controller operator-audit.controller worker-readiness.controller --runInBand`
- 浏览器验收：访问 `http://127.0.0.1:3100`，验证管理员登录、控制台、Outbox Ops、审计、Worker 页面；普通账号只能看到无权限状态。

回顾时可以问：

- “为什么这次选择独立 `apps/admin`，而不是继续往学习端侧边栏塞页面？”
- “Outbox requeue 为什么必须有原因输入和确认框？”
- “为什么 handler missing 的 DEAD event 不应该盲目 requeue？”
- “后台管理前端和后端 OperatorGuard 的职责边界是什么？”

### 2026-07-09 - Phase 7.15 收尾：审计筛选控件与 requeue 手动排障说明

目标：把管理员审计台从“能用”继续推进到“手动排障时不容易误操作”，同时把用户反馈的原生下拉框视觉问题收掉。

为什么：

- `/operator-audit` 是移动端优先的管理诊断页，原生 `<select>` 在浏览器里会弹出系统样式蓝色选项框，视觉上割裂，也不像 App 内部控件。
- requeue 是会改变 outbox 状态的高权限操作，必须让开发者知道什么时候该重试、什么时候不能重试，以及它不会绕过状态机直接执行 handler。
- Phase 7.15 验收中出现过 `OUTBOX_HANDLER_NOT_FOUND` 类测试事件导致 worker readiness 降级，这正好说明“看到 DEAD 就盲目 requeue”是不对的，必须先判断根因。

主要内容：

- `/operator-audit` 的 action / status 筛选从原生 `<select>` 改为自定义 `FilterSelect`，使用 button + listbox + check icon，保留 44px 触控目标、焦点样式和 `aria-haspopup/listbox/option` 语义。
- `apps/web/src/lib/operator-audit-ui-integration.test.mts` 增加防回归断言：页面必须包含 `FilterSelect` 和 `role="listbox"`，且不能再出现原生 `<select>`。
- `docs/dev-start.md` 增加 Outbox requeue 手动排障流程，明确 `FAILED / DEAD -> PENDING`、需要先修根因、不要对 unknown handler / invalid payload 盲目 requeue，并给出 PowerShell API 调试示例。
- `docs/dev-start.md` 增加中文路径下 Docker build 的 `subst P:` 规避方案；直接在中文路径 build 仍会触发 Docker gRPC non-printable ASCII，但通过 ASCII 映射路径加 `--project-name docker` 可成功重建 server/web 镜像。

边界：

- 本次不新增前端 outbox 列表页或一键 requeue 按钮；当前 requeue 仍是 admin-only 后端诊断 API，审计台负责查看 requeue 审计记录。
- requeue 不编辑 payload、不直接执行 handler、不强制成功、不删除事件。
- UI 只改善筛选控件，不改变 `/operator-audit-logs` 查询 contract 或后端鉴权。

验收：

- `node --experimental-strip-types --test apps/web/src/lib/operator-audit-ui-integration.test.mts`
- `node --experimental-strip-types --test apps/web/src/lib/operator-audit-view.test.mts`
- `bun --filter @repo/web lint`
- `bun --filter @repo/web build`
- `docker compose -f docker/docker-compose.dev.yml --profile worker exec -T worker sh -lc "bun apps/server/dist/scripts/worker-readiness.js"`
- `docker compose --project-name docker -f P:\docker\docker-compose.dev.yml --project-directory P:\ --profile worker build server web`

回顾时可以问：

- “为什么 requeue 不是直接执行 handler，而是回到 PENDING 等 worker 正常消费？”
- “为什么 unknown handler 的 DEAD event 不能靠 requeue 解决？”
- “审计筛选控件为什么要用自定义 listbox，而不是浏览器原生 select？”
- “为什么中文路径下 Docker compose build 会失败，而 `subst P:` 后可以成功？”

### 2026-07-09 - Phase 7.15 Operator Audit 真实运行验收与本地诊断收口

目标：把管理员审计台从“代码和单元测试完成”推进到“真实前后端可以跑、管理员能用、普通用户被拦截、审计记录可查”的验收状态。

为什么：

- Phase 7.14 已经补齐 `OperatorGuard`、审计写入、审计查询 API 和前端页面，但真实运行时仍可能被环境、旧镜像、登录态或前端 hydration 问题挡住。
- Docker server 镜像运行态是 `NODE_ENV=production`，而 Outbox Ops / Operator Audit / Worker Readiness / Worker Observability 默认 production 关闭；本地 dev compose 如果不显式打开，就会表现为管理员也访问 404。
- Next dev server 在 `127.0.0.1` 下会阻止 dev resource；如果项目文档让用户访问 `127.0.0.1:3000`，就必须允许这个 dev origin，否则页面 SSR 能看见，但 React 事件不挂载，登录表单会像“点了没反应”。

主要内容：

- `docker/docker-compose.dev.yml` 为 server service 显式设置 `OUTBOX_OPS_ENABLED=true`、`OPERATOR_AUDIT_ENABLED=true`、`WORKER_READINESS_ENABLED=true`、`WORKER_OBSERVABILITY_ENABLED=true`，保证本地 Docker dev 栈的诊断入口可验收。
- `apps/server/src/worker-readiness/docker-compose-readiness.spec.ts` 增加 compose 回归测试，防止本地诊断开关和 `127.0.0.1` dev origin 再被漏掉。
- `apps/web/next.config.ts` 增加 `allowedDevOrigins: ['127.0.0.1']`，修复从 `127.0.0.1:3000` 打开 dev 前端时客户端 hydration 不完整的问题。
- 创建本地验收账号：管理员 `phase715-admin-20260709000525@example.com`、普通用户 `phase715-student-20260709000525@example.com`；通过 Docker PostgreSQL 只把管理员测试账号升级为 `ADMIN`。
- 通过真实 `POST /outbox-events/:id/requeue` 生成 `OUTBOX_REQUEUE / SUCCEEDED` 审计记录，再用 `/operator-audit` 页面读取脱敏列表。

边界：

- 这次不新增审计详情页、导出、保留周期、批量操作或更细 operator role。
- 前端“审计”入口只是体验层；真正权限仍由后端 `JwtAuthGuard + OperatorGuard` 控制。
- Docker build 在当前中文路径下触发 Docker gRPC header 非 ASCII 问题，未把 Docker server/web 镜像重建作为完成条件；改用本机前后端 + Docker PostgreSQL/Redis/MinIO 验证最新源码，数据仍使用同一个 Docker 数据库。
- 浏览器登录态验收优先使用 `localhost:3000` 与 `localhost:3001` 保持 cookie host 一致；`127.0.0.1` 已单独验证 hydration 正常。

验收：

- `bun --filter @repo/server test -- docker-compose-readiness --runInBand`
- `GET /operator-audit-logs`：管理员返回 200，普通用户返回 403。
- `POST /outbox-events/:id/requeue`：管理员返回 201，并写入一条脱敏 `OUTBOX_REQUEUE` 审计记录。
- 浏览器验收：普通用户侧边栏不显示“审计”；普通用户直达 `/operator-audit` 显示无权限且不请求 `/operator-audit-logs`；管理员侧边栏显示“审计 管理员操作留痕”；管理员点击入口进入 `/operator-audit`，审计筛选和最近记录可见。

回顾时可以问：

- “为什么 Docker dev compose 里要显式打开诊断 feature gate，而不是依赖 `NODE_ENV` 默认值？”
- “为什么普通用户访问审计页时前端不请求审计 API，但后端仍必须返回 403？”
- “为什么 `127.0.0.1` 页面能看到 SSR 内容，却可能因为 dev origin 限制导致按钮事件不生效？”
- “为什么本地验收账号改成 ADMIN 后必须重新登录？”

### 2026-07-08 - Phase 7.14.6 收尾：Prisma Studio 排障与 Admin 导航入口

目标：把本地查看数据库和管理员审计入口从“知道内部命令的人才能用”调整为更接近真实开发者体验。

为什么：

- 用户用 `bun --cwd packages/database prisma studio` 打开 Studio 时，Prisma CLI 可能读不到根目录 `.env`，从而报 `DATABASE_URL` 缺失或在 Studio 里弹 `Prisma Client Error`，容易误判为“数据库没有数据”。
- 本地数据库当前确实有 `User` 数据；问题核心是命令运行目录、环境变量读取和 migration 状态，而不是账号数据丢失。
- `/operator-audit` 已经具备 admin-only 页面和后端 guard，管理员仍要手动输入地址不符合产品使用习惯；但普通用户不能看到这个入口。

主要内容：

- 新增 Prisma CLI 包装脚本，`db:studio` / `db:status` / `db:generate` / `db:migrate` 会优先读取根目录 `.env`，减少 `DATABASE_URL` 因工作目录不同丢失的问题。
- 新增 `bun run db:status`，用于快速确认当前 Prisma 连接的数据库和 migration 状态。
- 对当前 Docker PostgreSQL 执行安全 migration deploy，补上 `OperatorAuditLog` migration；没有执行 reset，没有清库。
- `/operator-audit` 从“隐藏手动地址”调整为“管理员侧边栏可见入口”；普通用户和未登录用户不展示该按钮，页面本身仍保留前端 ADMIN 拦截，后端 `JwtAuthGuard + OperatorGuard` 仍是真正安全边界。
- `docs/dev-start.md` 顶部补充 Prisma Studio、psql 改 admin、命令差异和侧边栏入口说明。

边界：

- 前端导航只负责体验分流，不替代后端权限。
- `migrate dev` 如果提示 reset，不能为了省事清库；本地已有数据时优先分析 drift，必要时只用 deploy 应用未执行 migration。
- Prisma Studio 是数据库查看/编辑工具，不是升级管理员账号的唯一方式；快速改角色更适合用容器内 psql。

验收：

- `bun run db:status`
- Docker PostgreSQL `User` 表确认有 45 条账号记录。
- `bun apps/web/src/lib/sidebar-nav.test.mts`

回顾时可以问：

- “为什么同一个数据库，用 Prisma Studio 看不到数据不一定代表数据丢了？”
- “`bun run db:studio` 和 `docker compose exec postgres psql ...` 分别解决什么问题？”
- “为什么 admin 导航可以前端隐藏，但真正鉴权必须在后端？”
- “为什么看到 Prisma 要 reset 时不能直接照做？”

### 2026-07-08 - Phase 7.14.6 Operator Audit Hidden Admin Page

目标：给已经完成的 Operator Audit 查询 API 补一个受控的前端查看入口，让管理员不用直接连数据库或手写请求，也能在产品里查看脱敏审计记录。

为什么：

- 只有后端 API 时，排障仍然需要 Swagger、curl 或数据库查询，对本地验收和面试展示都不够直观。
- 审计页面不能出现在普通学习用户导航里，否则会让用户误以为这是普通功能，也会暴露不必要的运维入口。
- 前端可以做体验拦截和空状态提示，但真正权限必须继续由后端 `OperatorAuditEnabledGuard -> JwtAuthGuard -> OperatorGuard` 控制。

主要内容：

- 新增 `apps/web/src/lib/operator-audit-api.ts`，复用 `@repo/types/api/operator-audit` Zod schema 解析 `/operator-audit-logs` 响应。
- 新增 `operatorAuditQueryKeys` 与 `useOperatorAuditLogs()`，只有当前会话 `currentUser.role === 'ADMIN'` 时才启用请求。
- 新增隐藏页面 `/operator-audit`，不加入普通侧边栏或个人中心主导航；管理员可手动访问。
- 页面支持按 `action`、`status`、`targetType`、`targetId`、`actorUserId` 筛选，展示审计时间、操作者、目标、原因、requestId、错误码、脱敏错误预览和 IP/User-Agent hash。
- 普通用户访问时展示无权限说明，不主动请求审计 API；未登录仍由 `(main)` layout 的 `AuthGuard` 处理。
- 页面只展示脱敏字段，不展示 payload、metadata、aggregateId、prompt、RAG chunk、模型回答、API key、token、cookie 或用户正文。

边界：

- 前端页面不是安全边界，只是体验层；不能用它替代后端 OperatorGuard。
- 本轮不做审计详情页、不做导出、不做审计删除/编辑、不做保留周期策略、不新增更细的 operator role。
- 当前分页使用“下一页”读取下一批结果，不做复杂无限列表缓存，避免 React effect 合并分页带来的状态副作用。

验收：

- `node --experimental-strip-types --test apps/web/src/lib/operator-audit-api.test.mts`
- `node --experimental-strip-types --test apps/web/src/lib/operator-audit-query-keys.test.mts`
- `node --experimental-strip-types --test apps/web/src/lib/operator-audit-view.test.mts`
- `node --experimental-strip-types --test apps/web/src/lib/operator-audit-ui-integration.test.mts`
- `bun --filter @repo/web lint`

回顾时可以问：

- “为什么 `/operator-audit` 不放进普通导航？”
- “前端 ADMIN 拦截和后端 OperatorGuard 的职责有什么区别？”
- “这个页面为什么只展示脱敏 DTO，不展示 metadata 或 payload？”
- “为什么第一版选择隐藏页面和筛选列表，而不是完整管理后台？”

### 2026-07-08 - Phase 7.14.5 Operator Audit Query API

目标：把已写入数据库的 operator 审计日志变成可受控查询的后端 API，回答“谁在什么时候做了什么、为什么做、结果如何”。

为什么：

- 高权限诊断写操作不能只靠“有权限”，还要能追踪、复盘和排障。
- 只写审计日志但没有受控查询入口，事故时仍要手动连数据库查，不适合生产化。
- 查询入口必须只返回脱敏字段，避免排障入口变成敏感数据泄露入口。

主要内容：

- 新增 `@repo/types/api/operator-audit` contract，包含 action/status、列表 query 和脱敏 response DTO。
- `packages/types/package.json` 增加 `./api/operator-audit` 子路径导出，修复 NodeNext 下 server 无法解析新增 contract 的问题。
- `OperatorAuditService.list()` 支持 `action`、`status`、`targetType`、`targetId`、`actorUserId`、`limit`、`cursor` 过滤。
- 分页按 `createdAt desc, id desc` 使用复合 cursor，避免同时间戳数据漏查。
- 新增 `GET /operator-audit-logs`，guard 顺序为 `OperatorAuditEnabledGuard -> JwtAuthGuard -> OperatorGuard`。
- 新增 `OPERATOR_AUDIT_ENABLED`：默认非 production 开启、production 关闭，关闭时在认证前隐藏为 404。

边界：

- 不做前端页面、不做审计导出、不提供详情接口、不支持删除或编辑审计日志。
- 查询结果不返回 `metadata`、outbox payload、aggregateId、用户正文、prompt、RAG chunk、模型回答、API key、access token、refresh token、cookie、原始 IP 或原始 User-Agent。

验收：

- `bun test packages/types/tests/operator-audit.test.mts`
- `bun --cwd packages/types typecheck`
- `bun --filter @repo/server test -- operator-audit.controller operator-audit.service env --runInBand`
- `bun --cwd apps/server eslint src/operator-audit src/config/env.ts src/config/env.spec.ts src/app.module.ts`
- `bun --filter @repo/server build`

回顾时可以问：

- “Operator Audit 查询 API 为什么要单独加 feature gate？”
- “`GET /operator-audit-logs` 返回哪些字段，为什么不返回 metadata？”
- “这里的复合 cursor 是怎么避免翻页漏数据的？”
- “为什么权限和审计是两层不同的生产安全能力？”

### 2026-07-08 - Phase 7.14.3 / 7.14.4 OperatorAuditLog + Outbox Requeue Audit

目标：在 OperatorGuard 之后补上操作审计地基，并把 `POST /outbox-events/:id/requeue` 接入成功/失败留痕，避免审计 service 变成死码。

为什么：

- `requeue` 会改变后台事件状态，属于 operator 诊断写操作，需要留下可追责记录。
- 审计写入要 best-effort，不能因为审计系统异常阻断原本的修复操作。
- 审计日志要长期保留，即使 actor user 后续被删除，也不能丢失历史操作链路。

主要内容：

- Prisma 新增 `OperatorAuditAction`、`OperatorAuditStatus`、`OperatorAuditLog` 和 migration。
- `OperatorAuditService` 支持 `recordSuccess()` / `recordFailure()`。
- metadata 改为 allowlist，只允许 `previousStatus`、`nextStatus`、`attemptsBefore`、`attemptsAfter`、`payloadHash`、`lastErrorCode`、`source` 等安全字段。
- reason / requestId / errorCode / errorPreview 均做脱敏和截断。
- `OperatorAuditLog.actorUserId` 使用 nullable + `onDelete: SetNull`，actor 删除后审计记录保留。
- `OutboxOpsController.requeue()` 成功记录 `OUTBOX_REQUEUE / SUCCEEDED`，失败记录 `OUTBOX_REQUEUE / FAILED` 后继续抛出原错误。

边界：

- 不新增前端页面，不开放审计查询接口，不保存 payload、prompt、chunk、API key、token、cookie 或原始 IP/User-Agent。

验收：

- `bun --filter @repo/server test -- operator-audit.service outbox-ops.controller --runInBand`
- `bun --cwd apps/server eslint src/operator-audit src/outbox/outbox-ops.controller.ts src/outbox/outbox-ops.controller.spec.ts`
- `bun --filter @repo/server build`
- `bun --cwd packages/database test`
- `bun run db:generate`

回顾时可以问：

- “OperatorAuditLog 为什么 actorUserId 要 nullable + SetNull？”
- “审计 metadata 为什么用 allowlist，而不是黑名单过滤？”
- “Outbox requeue 成功和失败分别怎么记录审计？”
- “审计写入失败为什么不能影响 requeue 主流程？”

### 2026-07-08 - Phase 7.14.2 OperatorGuard

目标：把 Outbox Ops、Worker Observability、HTTP Worker Readiness 从普通登录用户可访问的诊断入口升级为 admin/operator-only。

为什么：

- 这些接口暴露的是系统级队列、worker、readiness 或 outbox 状态，不是普通学生账号应看到的业务数据。
- feature gate 只能控制入口是否开放，不能替代角色权限。
- 后续 requeue、审计查询等高权限能力都需要统一 operator 权限地基。

主要内容：

- 新增 `OperatorGuard`，基于 `request.user.role === 'ADMIN'` 判断权限。
- `AuthModule` 注册并导出 `OperatorGuard`。
- `OutboxOpsController`、`WorkerObservabilityController`、`WorkerReadinessController` 的 guard 顺序统一为 feature gate -> JWT -> operator。
- feature gate 仍优先返回 404，避免关闭时暴露诊断面。

边界：

- 不新增审计表，不记录 requeue 操作日志；审计写入留给 Phase 7.14.3 / 7.14.4。
- 不影响 Worker Readiness CLI、Docker healthcheck、Chat、RAG、Agent Trace 或普通业务 API。

验收：

- `bun --filter @repo/server test -- operator.guard outbox-ops.controller worker-observability.controller worker-readiness.controller --runInBand`

回顾时可以问：

- “OperatorGuard 和 JwtAuthGuard 的职责有什么区别？”
- “为什么 guard 顺序要 feature gate -> JWT -> Operator？”
- “为什么关闭诊断入口时返回 404 而不是 403？”
- “普通用户访问 worker observability 会有什么风险？”

### 2026-07-08 - Phase 7.13 Docker Web / Full Stack Compose

目标：把 API / worker / readiness 容器链路扩展到 Web 容器，完成本地 Docker Compose 全栈启动与浏览器验收。

为什么：

- 之前只验证了 API / worker，不能证明用户从浏览器访问 Docker Web 容器的完整链路可用。
- Next standalone 在 monorepo + Bun workspace 下容易出现依赖复制和 tracing root 问题，需要真实容器构建验证。
- 本地 compose 全栈能让后续验收更接近部署形态。

主要内容：

- `docker/Dockerfile.web` 迁移到 Bun workspace + Next standalone。
- `apps/web/next.config.ts` 开启 `output: 'standalone'` 并设置 monorepo tracing root。
- Compose dev 栈拉起 `postgres / redis / minio / server / worker / web`。
- Web 容器支持本地 dev AI mode switch 展示，受 `PREPMIND_LOCAL_DEV_TOOLS_ENABLED=true` 约束。
- 修复 server Dockerfile 的 Bun workspace runtime 布局，避免内部 `@repo/*` 包或 `.bun` store 链接在容器内解析失败。

边界：

- 本轮是本地 Docker Compose 验收，不引入 Kubernetes、生产域名、TLS、CI 镜像推送或云部署。

验收：

- `bun --filter @repo/web lint`
- `bun --filter @repo/web test`
- `bun --filter @repo/web build`
- `docker compose -f docker/docker-compose.dev.yml --profile worker up -d --build postgres redis minio server worker web`
- HTTP smoke：`http://127.0.0.1:3000` 返回 200，`http://127.0.0.1:3001/health` 返回 `status=ok`。
- Playwright 浏览器验收：注册临时账号后跳转 `/chat`，刷新后仍保持登录态。

回顾时可以问：

- “Docker Web 镜像为什么要用 Next standalone？”
- “monorepo 下 Dockerfile.web 需要复制哪些 workspace 文件？”
- “为什么本地 Web 容器也要支持 mock/live 开关展示？”
- “这轮 Docker 全栈验收证明了什么，没证明什么？”

### 2026-07-08 - Phase 7.12 Docker Worker Healthcheck

目标：把 worker readiness CLI 接入 Docker Compose worker service，让容器编排能看到 `healthy / unhealthy`。

为什么：

- worker-only 进程不监听 HTTP，不能靠 `/health` 判断它是否能处理后台任务。
- 容器层 healthcheck 能让 Docker Compose 直接暴露 worker 健康状态，降低本地部署排障成本。
- readiness CLI 已经存在，复用它比再写一套容器专用检查更一致。

主要内容：

- `docker/docker-compose.dev.yml` 的 `worker` service 新增 healthcheck。
- 容器内 healthcheck 使用 `bun apps/server/dist/scripts/worker-readiness.js`。
- 新增 `WORKER_READINESS_CLI_TIMEOUT_MS` 和 healthcheck interval/timeout/retries/start_period。
- 新增 docker compose readiness 回归测试。
- 更新启动文档，区分本机 CLI 与容器 healthcheck。

边界：

- 不改 Chat、RAG prompt、Tutor 输出或 live model 链路，不需要真实模型 smoke。
- 不引入 Kubernetes readiness probe、Prometheus 指标或生产部署平台配置。

验收：

- `bun --filter @repo/server test -- worker-readiness docker-compose-readiness`
- `bun --cwd apps/server eslint src/worker-readiness`
- `bun --filter @repo/server build`
- `docker compose -f docker/docker-compose.dev.yml --profile worker config`
- `git diff --check`

回顾时可以问：

- “worker-only 为什么没有 HTTP health endpoint？”
- “Docker healthcheck 调的是本机 CLI 还是容器内构建产物？”
- “`docker compose ps` 里的 healthy 到底代表什么？”
- “readiness CLI 和容器 healthcheck 的区别是什么？”

### 2026-07-08 - Phase 7.11 Worker Readiness

目标：在 `/health` 和 `/worker-observability/summary` 之外，补一个适合机器和部署系统使用的 worker readiness 判断。

为什么：

- `/health` 只能说明 API 进程活着，不能说明后台 worker 链路可接流量。
- `/worker-observability/summary` 面向开发者排障，信息更细；readiness 要给机器一个明确可判断结论。
- 部署前检查需要稳定退出码和安全摘要，不能打印连接串、payload 或原始依赖错误。

主要内容：

- 新增 `@repo/types/api/worker-readiness` contract。
- 新增 `WORKER_READINESS_ENABLED`，默认非 production 开启、production 关闭。
- 新增 `WorkerReadinessService`，组合 Redis、BullMQ queue counts、worker heartbeat 和 outbox summary。
- 新增 HTTP 入口 `GET /worker-readiness` 和 CLI `bun --filter @repo/server readiness:worker`。
- CLI 使用最小只读 Nest module，不导入 `AppModule`，不启动 HTTP、worker processor、heartbeat 或 outbox dispatcher。
- readiness 输出区分 `ready / degraded / not_ready`，异常或超时退出码为 2。

边界：

- Readiness 不替代 `/worker-observability/summary` 的详细排障信息，也不替代 `/health` 的 API liveness。
- CLI 只读检查，不消费 BullMQ、不 dispatch outbox、不 requeue、不修改业务数据。

验收：

- `bun --filter @repo/server test -- env`
- `bun --cwd packages/types typecheck`
- `bun --filter @repo/server test -- worker-readiness`
- `bun --cwd apps/server eslint src/worker-readiness scripts/worker-readiness.ts`
- `bun --filter @repo/server build`
- `git diff --check`

回顾时可以问：

- “`/health`、worker observability、worker readiness 三者怎么分工？”
- “readiness CLI 为什么不能导入 AppModule？”
- “退出码 0 / 1 / 2 分别代表什么？”
- “readiness 输出为什么不能打印原始错误？”

### 2026-07-07 - Phase 7.10 Outbox Ops

目标：给 durable outbox 补上安全的后端操作闭环，让开发者能在不暴露 payload 的前提下查看失败事件，并在修复根因后手动 requeue。

为什么：

- durable outbox 有了持久事件和重试状态后，必须能安全查看失败事件，否则排障仍然只能查数据库。
- dead / failed 事件需要可控 requeue，但 requeue 不能绕过状态机或直接执行 handler。
- outbox payload 可能间接关联业务上下文，诊断 API 必须默认隐藏敏感内容。

主要内容：

- 新增 `@repo/types/api/outbox` contract。
- 新增 `OUTBOX_OPS_ENABLED`，默认非 production 开启、production 关闭。
- 新增 `OutboxOpsService` / `OutboxOpsController`，支持脱敏列表、脱敏详情和 `FAILED / DEAD` requeue。
- 列表分页按 `updatedAt desc, id desc` 使用复合 cursor。
- `lastErrorPreview` 复用 `sanitizeJobError()`，覆盖 Bearer、access/refresh token、cookie、`sk-...`、Qwen/DashScope/OpenAI key 等形态。
- requeue 使用条件 `updateMany` 做 compare-and-swap，只把 `FAILED / DEAD` 重置为 `PENDING`，不立即执行 handler。

边界：

- 不返回 payload、aggregateId、用户正文、prompt、RAG chunk、模型回答、API key、token 或 cookie。
- 不支持删除、强制成功、跳过、payload 编辑或直接 dispatch。

验收：

- `bun --cwd packages/types typecheck`
- `bun --filter @repo/server test -- outbox-ops env`
- `bun --filter @repo/server test -- outbox-ops job-error-sanitizer`
- `bun --cwd apps/server eslint src/outbox src/jobs/job-error-sanitizer.ts src/jobs/job-error-sanitizer.spec.ts`
- `bun --filter @repo/server build`
- `bun --cwd apps/server jest --config ./test/jest-e2e.json --runInBand --testTimeout=30000 --forceExit --verbose outbox-ops`

回顾时可以问：

- “Outbox Ops 为什么只返回脱敏列表和详情？”
- “requeue 为什么用 updateMany 做 compare-and-swap？”
- “FAILED / DEAD -> PENDING 为什么不直接执行 handler？”
- “`sanitizeJobError()` 主要防什么泄露？”

### 2026-07-06 / 2026-07-07 - Phase 7.9 Durable Outbox

目标：把关键内部事件从纯 in-process 链路推进到可重试、可观测、可受控消费的 durable outbox 地基。

为什么：

- in-process EventBus 失败后无法跨进程持久重试，适合轻量通知，不适合需要可靠投递的内部事件。
- outbox 可以把“业务事务”和“异步事件”连接起来，为后续生产化 worker 链路打地基。
- dispatcher runner 需要受控开启，避免生产部署后未经确认消费历史事件。

主要内容：

- Phase 7.9.1：新增 `OutboxEvent`、enqueue / claim / success / retry / dead-letter 状态机。
- Phase 7.9.2：新增 dispatcher service 和显式 handler registry，先接入 `knowledge.document.processing.requested`。
- Phase 7.9.3：新增 worker-only dispatcher runner，支持生产默认关闭、防重入 tick、batch size 和 lock timeout。
- Phase 7.9.4：新增 outbox summary / metrics，接入 worker observability。

边界：

- 不替换 BullMQ、`BackgroundJob` 或现有 in-process EventBus。
- dispatcher handler 不保存用户正文、prompt、chunk、API key、token 或 cookie。
- production 默认不自动消费历史 outbox，需要显式开启。

验收：

- `bun --filter @repo/server test -- outbox`
- `bun --filter @repo/server test -- outbox-dispatcher`
- `bun --filter @repo/server test -- outbox-dispatcher-runner`
- `bun --filter @repo/server test -- outbox-metrics worker-observability`
- `bun --filter @repo/server build`

回顾时可以问：

- “Durable Outbox 和 EventBus / BullMQ 的区别是什么？”
- “claim / retry / dead-letter 状态机怎么防重复消费？”
- “为什么 dispatcher 要显式 handler registry？”
- “为什么 production 默认不自动开启 dispatcher runner？”

### 2026-07-06 - Phase 7.8 RAG Eval / Hybrid Retrieval

目标：给 RAG 检索质量建立可回归的评估基线，并把检索从单纯向量召回升级为 hybrid retrieval。

为什么：

- fake embedding 只能验证工程链路，不能证明真实语义检索质量。
- 没有固定评估集时，每次改检索排序都很难判断是变好了还是变差了。
- 纯向量召回容易漏掉关键词明确的问题，hybrid retrieval 能补充关键词候选。

主要内容：

- Phase 7.8.1：新增固定检索评估集和 `recall@k`、`top1Accuracy`、`safetyPassRate`、`noHitPassRate` 指标。
- Phase 7.8.2：`/knowledge/search` 支持 vector candidates + PostgreSQL full-text keyword candidates 融合排序。
- Phase 7.8.3：新增 `bun --filter @repo/server smoke:rag-eval`，串联注册、上传、处理、检索和 eval。
- Phase 7.8.4：新增必需 case id guard，避免评估集改名或缺失时误报 PASS；支持 `RAG_EVAL_SMOKE_KEEP_DATA=true`。
- 补充 Qwen embedding 配置与真实检索 smoke 说明。

边界：

- fake eval 只证明工程回归，不证明真实语义质量。
- smoke 默认不进 CI、不保存 API key、token、cookie、embedding 向量或完整 hit content。

验收：

- `bun --cwd packages/types typecheck`
- `bun --filter @repo/server test -- rag-eval`
- `bun --filter @repo/server smoke:rag-eval`
- `bun --filter @repo/server build`

回顾时可以问：

- “RAG Eval 的 recall@k / top1 / safety / no-hit 指标分别看什么？”
- “Hybrid Retrieval 怎么融合向量候选和关键词候选？”
- “fake eval 和真实 embedding smoke 分别证明什么？”
- “为什么要有 case id guard 防误报？”

### 2026-07-02 / 2026-07-05 - Phase 7.3 ~ 7.7 Observability / OpenAPI / Worker Split

目标：把后台任务、接口文档和 worker 进程边界做成更可调试、更适合本地验收和面试讲解的工程化能力。

为什么：

- Phase 7 开始后，后台任务、worker、诊断 API 增多，如果没有观测和文档入口，开发者很难知道系统现在发生了什么。
- Swagger 用来帮助本地调试和面试展示，但不能变成第二套 contract 来源。
- API / worker 拆分能让后台任务进程独立部署和独立观测。

主要内容：

- Phase 7.3：EventBus handler 失败隔离，新增 `GET /background-jobs/summary` 和 `/knowledge` 后台任务摘要轮询兜底。
- Phase 7.4：新增 Swagger / OpenAPI debug docs，入口 `/api-docs` 和 `/api-docs-json`。
- Phase 7.5：核心写接口补中文 request body 示例，Swagger 顶部说明中文化。
- Phase 7.6：拆分 `SERVER_ROLE=api | worker | both`，worker-only 不监听 HTTP。
- Phase 7.7：新增 Redis heartbeat、BullMQ queue counts、worker observability summary 和 `/knowledge` 健康状态条。

边界：

- Swagger 是调试/展示层，不替代 `@repo/types` contract。
- worker observability 默认 production 关闭，不返回 payload、prompt、chunk、API key、token 或 cookie。
- 这组改动不改 Chat prompt / RAG prompt / live model 策略。

验收：

- `bun --cwd packages/types typecheck`
- `bun --filter @repo/server test -- event-bus background-jobs worker-observability`
- `bun --filter @repo/web test -- background-job knowledge-view`
- `bun --filter @repo/server build`
- `bun --filter @repo/web build`
- `docker compose -f docker/docker-compose.dev.yml --profile worker config`
- `git diff --check`

回顾时可以问：

- “EventBus 失败隔离解决了什么问题？”
- “Swagger 为什么只是展示层，不是 contract 事实源？”
- “`SERVER_ROLE=api | worker | both` 分别适合什么场景？”
- “Worker Observability 的 queue counts、heartbeat、BackgroundJob summary 各代表什么？”

### 2026-06-30 - Phase 7.0 / 7.1 / 7.2 Background Jobs + RAG SafetyGuard

目标：把知识库文档处理从同步接口升级为可切换的后台任务链路，并把用户上传资料视为低信任 RAG 证据。

为什么：

- 文档解析、分块、embedding 可能耗时，同步接口会拖慢用户请求，也不利于失败重试。
- 用户上传资料可能包含恶意 prompt injection，RAG 不能把检索片段当成可信指令。
- inline / queue 双模式可以兼顾本地简单开发和后台任务生产化。

主要内容：

- 新增 `BackgroundJob` 数据模型和 `@repo/types/api/background-job` contract。
- `KNOWLEDGE_PROCESSING_MODE=inline | queue` 控制文档处理模式。
- queue 模式创建 `BackgroundJob` 并投递 BullMQ；worker 处理时持续校验 `status + storageKey + contentHash` 快照。
- `/knowledge` 展示文档后台处理状态，只在活跃处理时轮询。
- `@repo/rag` 增加 deterministic chunk safety classifier。
- 文档处理时写入 `metadata.safety`，检索 API 返回 safety metadata。
- Chat RAG prompt 组装前过滤 high-risk chunk；medium-risk chunk 只作为可疑引用。
- `KnowledgeVerifierAgent` 对高风险或 `safeForPrompt=false` 的资料输出保守 guidance。

边界：

- Redis 是 queue 链路必需依赖。
- BackgroundJob 只保存脱敏任务元数据，不保存完整文件、prompt、RAG chunk、API key 或 token。
- SafetyGuard 不执行检索片段里的指令，只把资料当证据。

验收：

- mock / e2e 覆盖固定 prompt-injection 样本。
- live/browser smoke 记录在 `docs/ai-behavior-acceptance.md`。
- Trace 和 BackgroundJob 仍只保存脱敏元数据。

回顾时可以问：

- “为什么知识库处理要支持 inline / queue 双模式？”
- “BullMQ 在文档处理链路里负责什么？”
- “RAG SafetyGuard 怎么判断高风险 chunk？”
- “Chat prompt 前为什么要过滤 high-risk chunk？”

### 2026-06-20 ~ 2026-06-29 - Phase 6 Multi-Agent

目标：落地多 Agent 协作亮点，并保持确定性 policy、可观测和只读建议边界。

为什么：

- 单一 Chat 链路难以承载讲题、资料核对、错题组织、复习规划、长期记忆等多种职责。
- 多 Agent 能把复杂任务拆成可解释的策略层，但当前阶段要先保证确定性和可验收。
- 只读建议和人审确认能降低自动写库、自动误分类、自动污染记忆的风险。

主要内容：

- Phase 6.0 / 6.1 / 6.2：新增 Agent Runtime contract、RouterAgent、TutorAgent 策略层，`/api/chat` 输出 route headers。
- Phase 6.3：`KnowledgeVerifierAgent` 在 RAG 命中后评估资料可信度，并注入保守使用 guidance。
- Phase 6.4：`WrongQuestionOrganizerAgent` 推荐学科组与专题 deck，`/error-book` 升级为学科 -> 专题 -> 错题下钻结构。
- Phase 6.5：`ReviewAgent` / `PlannerAgent` 提供只读学习建议，不创建未来 `ReviewTask(source=PLANNER)`。
- Phase 6.6：`MemoryAgent` 生成长期记忆候选，必须用户确认后才成为 active memory。
- Phase 6.7：Agent Trace 持久化脱敏 route、step、token 和估算成本元数据。
- Phase 6.8：`KnowledgeDedupAgent` / `KnowledgeOrganizerAgent` 提供资料重复、新版、互补、集合和标签建议。

边界：

- 当前 Phase 6 Agent 都是确定性 policy，不直接调用真实模型。
- Review / Planner / Memory / Knowledge agents 都遵循“只读建议或人审确认”，不在每次 Chat 中自动写库或自动注入。
- Agent Trace 不保存完整 prompt、完整回答、完整 RAG chunk 或 API key。

验收：

- fixed deterministic eval set 覆盖当前确定性 Agent policy。
- mock 验证工程链路；涉及 Chat 输出体验时按 `docs/ai-behavior-acceptance.md` 做 live 小样本验收。

回顾时可以问：

- “Phase 6 每个 Agent 各自负责什么？”
- “为什么这些 Agent 当前是 deterministic policy，不直接调用真实模型？”
- “RouterAgent / TutorAgent / KnowledgeVerifierAgent 在 Chat 链路里的顺序是什么？”
- “MemoryAgent 为什么必须用户确认后才成为长期记忆？”

## 早期里程碑索引

> 说明：2026-06-05 ~ 2026-06-19 的早期 DEVLOG 曾经按日记录，后来在多轮文档清理中被压缩。这里按 `git log -- DEVLOG.md` 恢复成阶段索引，详细内容可用对应提交追溯。

| 日期       | 阶段                | 主要进展                                                                                 | 回顾时可以问                                                      | 追溯线索                                              |
| ---------- | ------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------- |
| 2026-06-05 | Phase 0             | 新增 DEVLOG，记录 pnpm / monorepo 恢复与项目初始化。                                     | “项目最初的 monorepo 和 Docker 基础怎么搭的？”                    | `2f9c2cb`、`ef1a580`                                  |
| 2026-06-06 | Phase 1             | 登录模块、AI 聊天、上下文传递规划、开发博客更新。                                        | “Phase 1 的登录和聊天 MVP 怎么组织状态？”                         | `2797be2`、`8311a6a`、`af62415`                       |
| 2026-06-07 | Phase 1             | Day 3 开发日志，规划 Phase 1 -> Phase 2 存储迁移。                                       | “为什么从本地存储逐步迁移到后端权威数据？”                        | `31b6649`                                             |
| 2026-06-08 | Phase 1             | Dexie 迁移、OCR 流式、错题本 CRUD、今日任务静态版、Phase 1 收官。                        | “Dexie 在 Phase 1 里承担了哪些离线和本地恢复职责？”               | `9f59fbf`、`4a92f87`、`b64b94d`、`a8d864f`、`375e2cb` |
| 2026-06-09 | Phase 2.1           | 后端基础与 Auth/User API 收口，准备 Phase 2.2。                                          | “NestJS 后端和 Auth/User API 是怎么作为后端地基落地的？”          | `b2fb4b9`                                             |
| 2026-06-11 | Phase 2.2           | Auth flow、refresh token reuse detection、WrongQuestion API、前端接入和动态 CORS。       | “登录态为什么改成后端 session 权威控制？”                         | `65ad246`、`8ebc04f`、`cc132b5`、`d022234`、`6a68627` |
| 2026-06-12 | Phase 2.3           | OCRRecord、ChatMessage sync、MinIO 图片链路、chat streaming 稳定性和 Phase 2.3 handoff。 | “WrongQuestion / ChatMessage / OCRRecord 如何迁移到 PostgreSQL？” | `12614a4`、`265ba42`、`909260d`、`53802c9`、`3d6f99b` |
| 2026-06-13 | Phase 2.3 / 2.5     | Phase 2.3 稳定化，Chat-first 产品壳层和体验打磨。                                        | “为什么产品壳层改成 Chat-first？”                                 | `122aea2`、`537e458`、`c723e0b`                       |
| 2026-06-14 | Phase 3 / 4.1 ~ 4.3 | AI 讲题结构化、FSRS 复习流、学习统计、ReviewTask 任务流。                                | “OCR structured output 和 FSRS 复习闭环是怎么连起来的？”          | `7a1dc6e`、`34b779c`、`c2a57bc`、`f27f054`            |
| 2026-06-15 | Phase 4.4           | 离线评分队列、浏览器验证和复习评分流。                                                   | “ReviewTask 评分为什么需要 clientMutationId 幂等？”               | `332ffa4`、`b15131e`                                  |
| 2026-06-16 | Phase 4.5.1         | 复习计划预览、统计图表、review pressure model 初步规划。                                 | “复习计划预览和学习统计页面怎么计算压力？”                        | `c08ed16`、`031fc90`、`ed55e12`                       |
| 2026-06-17 | Phase 4.5.2 / 5.0   | ReviewPreference、加权压力模型、Phase 5 RAG 规划。                                       | “ReviewPreference 如何影响 7/14 天复习计划？”                     | `1c00f76`、`9294416`                                  |
| 2026-06-18 | Phase 5.1 / 5.2     | RAG 数据模型、知识库上传 API、wrong-question organizer 规划。                            | “RAG 的 Document / Chunk 模型和上传 API 怎么设计？”               | `9d38faf`、`1031872`、`f844b3e`                       |
| 2026-06-19 | Phase 5.3 ~ 5.6     | 文档处理、检索 API、Chat RAG、`/knowledge` 页面、live AI guard、Phase 6 多 Agent 规划。  | “文档解析、分块、embedding、检索和 Chat RAG 是怎么串起来的？”     | `1ec1644`、`2038e6a`、`ae97b49`、`542df8d`、`631c6c1` |

## 当前验证基线

常用全量验证：

```powershell
bun --filter @repo/web lint
bun --filter @repo/web test
bun --filter @repo/web build
bun --filter @repo/server lint
bun --filter @repo/server build
bun --filter @repo/server test
bun --filter @repo/server test:e2e
bun --filter @repo/server readiness:worker
bun --cwd packages/types typecheck
bun --cwd packages/database test
bun --cwd packages/fsrs test
```

当前 Phase 7 operator / worker / outbox 方向常用定向验证：

```powershell
bun test packages/types/tests/operator-audit.test.mts
bun --cwd packages/types typecheck
bun --filter @repo/server test -- operator-audit outbox-ops worker-readiness worker-observability env --runInBand
bun --cwd apps/server eslint src/operator-audit src/outbox src/worker-readiness src/worker-observability src/config
bun --filter @repo/server build
git diff --check
```

AI 行为验收规则：

- mock 验工程链路。
- live 小样本验真实输出体验。
- fake embedding 不证明 RAG 语义命中质量。
- 改 Chat prompt、RAG prompt、Tutor 输出或真实模型策略时，必须按 `docs/ai-behavior-acceptance.md` 做 live smoke。
- 纯后台任务、API contract、UI 状态和文档更新不需要 live 模型验收。

## 2026-07-11 — Phase 6.9.1 Agent Evaluation Baseline

### 为什么做

Phase 6.0 ~ 6.8 的 Agent 都是确定性 policy，只有 `/api/chat` 最终回答会调用真实模型。为了避免
后续凭主观感受把所有 Agent 替换为 LLM，先固定统一评测 contract 和当前能力 baseline，让模型
候选必须证明质量收益，同时满足安全、延迟和成本门槛。

### 做了什么

- 新增 deterministic/Mock/Live run、summary 和模型路径启用决策纯函数。
- 新增 `phase-6.9-seed-v1`：Router、Verifier、Memory 各 8 个可执行 case，Orchestrator 8 个
  expectation-only case。
- 当前 deterministic 结果为 21/24，pass rate 87.5%，token/cost 为 0。
- 如实保留 3 个失败：混合“笔记+讲题”路由歧义、短正确片段被判不足、含示例 API key 的
  “以后请记住”被 MemoryAgent 误提取为偏好。其中最后一项是 critical failure。
- 新增 paired eval 报告模板；明确最终 60/40/40/40 数据集在对应 Agent 实施阶段扩充。
- 修复 `@repo/agent lint` 只有脚本却没有 workspace 级 ESLint 依赖和配置的问题，使 Agent 语义 lint 不再隐式借用 web/server 工具链；历史格式差异不在本任务批量重写，本次新增文件另做 Prettier check。
- 独立审查后补 fail-closed：非法指标返回 `invalid_metrics`；baseline 测试锁定 21/24 与失败 case；任意 detail 改为受限结构码 outcome，疑似 prompt/provider 原文统一 redacted。
- 同步 AGENTS、README、roadmap、data-flow 和统一 AI 验收入口。

### 边界

- 本阶段不调用真实模型、不改 Chat 输出、不实现 Orchestrator，也不修饰 baseline 失败结果。
- Critical failure 不会被总体准确率抵消；MemoryAgent 接模型前必须先有确定性敏感信息 guard。
- 后续候选未达到质量、安全、延迟或成本门槛时继续使用 deterministic。
- Phase 6.9.7 收尾时写详细面试学习博客，汇总哪些 Agent 启用模型及其数据依据。

### 验收

- Phase 6.9 contract/baseline、原 Phase 6.7 eval、`@repo/agent` 全套测试、typecheck 和 lint。
- 该任务无真实页面、数据库或模型调用，因此不启动 Docker、浏览器或 Live AI。
- 详细基线：`docs/acceptance/2026-07-11-phase-6-9-1-deterministic-baseline.md`。

### 回顾时可以问

- “Phase 6.9.1 seed baseline 与最终 paired eval 有什么区别？”
- “为什么 Orchestrator 目前只有 expectation-only cases？”
- “为什么模型路径不能只看准确率决定？”
- “MemoryAgent 的敏感凭据 case 为什么是 critical failure？”

## 2026-07-11 — Phase 6.9.2 Shared Model Agent Runtime

### 为什么做

Phase 6.9.1 先固定了 deterministic baseline，但 Router、Verifier、Memory、摘要和 Orchestrator
后续如果各自直接拼装 AI SDK 调用，会重复实现开关、schema 校验、token 预算、timeout、错误脱敏和
Trace，最终很容易出现 Mock 与 Live 行为不一致，或者某条 Agent 路径绕过成本与安全边界。因此先把
“如何安全地调用一次结构化模型”收敛为共享 runtime，再逐个 Agent 做 paired eval 和受控接入。

### 做了什么

- 在 `@repo/ai` 新增共享 `ModelAgentRuntime` contract，统一
  `conversation_summary / router_fallback / knowledge_verification /
memory_candidate_extraction / tool_orchestration` 任务类型。
- Mock responder 与 Live executor 共用同一个 Zod schema、请求、成功/失败结果、usage 和 Trace
  contract；Mock 不再是绕过 schema 的特殊分支。
- 新增单 run 不可变 budget：累计限制 call、预估输入 token 和最大输出 token；每次调用前按
  `maxOutputTokens` 预留，不等待 provider usage 后再扣减，也不退还差额，避免并发重入超卖。
- Live 路径增加 runtime 二次 guard、executor availability、timeout、外部 abort 转发和安全错误分类；
  timeout/abort/provider rejection 不返回原始异常。
- 新增 OpenAI-compatible structured executor adapter；只允许无 credentials/query/hash 的 HTTPS
  base URL。`@repo/ai` 不读取 env，API key 只在 composition root 创建 executor 时进入 closure。
- 删除无人使用且会抛 `Not implemented` 的 AI package 占位 factory/streaming 导出，建立稳定 package
  exports、独立 test/typecheck/lint/format 门禁。
- 更新 Phase 6.9 paired eval 模板，补充 runtime version、max calls、timeout 和 budget reservation
  记录字段。

### 安全与数据边界

- result 与 Trace 只包含结构化 data、固定错误码、runId SHA-256 hash、task、mode、provider、model、
  token、耗时和 degraded 状态；不包含 system/user prompt、完整模型输出、provider 原始错误、API key、
  base URL、response headers 或 stack。
- 调用方仍需先权威解析 `AI_PROVIDER_MODE` 与 `AI_ENABLE_LIVE_CALLS`；runtime 的
  `liveCallsEnabled` 是第二层 guard，不替代 composition root 配置校验。
- 本阶段没有真实模型调用，没有迁移 `/api/chat` streaming，也没有把 RouterAgent、
  KnowledgeVerifierAgent、MemoryAgent 或其他业务 Agent 改为模型路径。
- provider 返回的实际 usage 只用于观测；预算按调用前 reservation 计算，防止并发条件下先调用后超额。
- Phase 6.9.7 的详细面试学习博客继续保留，届时汇总哪些 Agent 最终启用模型及 paired eval 依据。

### 验收

- AI package 覆盖预算、Mock/Live schema、live guard、timeout/abort、provider error 脱敏、usage
  归一化、HTTPS adapter 与 package exports。
- 回归验证 `@repo/agent` 测试和 typecheck，确认新增 AI runtime 没有改变现有 deterministic Agent。
- 该任务无页面、数据库、Docker 或真实模型调用，因此不启动浏览器、Docker 或 Live AI。

### 回顾时可以问

- “为什么 ModelAgentRuntime 不直接读取环境变量？”
- “为什么 budget 要在调用前按 max output 预留，而不是等待 usage 后扣减？”
- “为什么 Phase 6.9.2 不迁移现有 Chat streaming？”
- “Mock 和 Live 如何保证使用同一结构化 contract？”
- “ModelAgentRuntime 如何避免 prompt、provider 错误和 API key 进入 Trace？”

## 2026-07-11 — Phase 6.9.3.1 Conversation Memory Contracts

### 目标与主要内容

- 在 `@repo/types` 固定 strict prepare request/response/public state contract、summary status/trigger reason 与分层 token 观测字段。
- 在 Prisma/PostgreSQL 增加单会话单行 `ConversationSummary` / `ConversationState`，用 `(conversationId, userId)` 复合外键锁定 ownership，并补齐索引、级联删除、summary/hash 上限和 `expiresAt > updatedAt` CHECK。
- public state 不暴露 `pendingActionProposal`、`lastToolNames`、source hash、summary 或模型元数据。

### 边界与验收

- 本 slice 仅完成 contract/database；未实现 prepare API、Redis、摘要模型调用、CAS 或 Chat 注入。
- TDD RED 覆盖缺少 contract module、agent policy 新字段被剔除、Prisma model/migration 缺失；GREEN 覆盖 runtime schema tests、typecheck、Prisma client 生成与 server build。
- main 合并后门禁发现 Windows `core.autocrlf=true` 会把迁移检出为 CRLF；SQL 结构测试已改为按空白语义定位语句，并新增显式 CRLF 回归，避免跨平台误报及负向 mutation 假阳性。
- 下一 slice 是 Phase 6.9.3.2 ConversationState + prepare API。

### 回顾时可以问

- “为什么 public ConversationState 不能直接复用包含内部 action/tool 字段的 Prisma model？”
- “为什么 summary watermark 和 state version/expiry 需要数据库 CHECK，不只依赖 TypeScript？”

## 2026-07-11 — Phase 6.9.3.2 Conversation State + Prepare API

### 做了什么

- 新增鉴权 `POST /conversation-context/prepare`：先确认当前用户拥有 conversation，再处理 state/cache，避免用缓存或状态存在性泄露其他用户会话。
- PostgreSQL 保持 `ConversationState` 权威；客户端只可 patch `activeGoal` / `activeQuestionId`，省略字段表示保留，显式 `null` 表示清空。更新只写显式字段并由数据库原子递增 `stateVersion`，避免并发 patch 用旧快照覆盖未提供字段；首次创建的 P2002 竞态只做一次有界重读，状态变化或过期恢复会把有效期续到 24 小时。
- Redis 使用 `sha256(userId + NUL + conversationId)` key，缓存内容必须通过 strict public state schema，TTL 不超过 86,400 秒；读取、JSON/schema、写入或删除失败仅记录固定错误码并 fail-open 回源。
- Chat history list/sync 增加 optional sanitized state；过期状态不返回，内部 `pendingActionProposal`、`lastToolNames`、summary hash、缓存 key 与 Redis 原始错误均不进入响应。删除会话后 PG state 级联清理，Redis best-effort 删除。

### 验收与边界

- TDD 覆盖 ownership-first、24 小时 TTL、版本变化/不变化、显式 null、Redis miss/error/坏 JSON、哈希 key、Chat history 脱敏恢复与缓存清理。
- e2e 使用两个临时账号覆盖 owner 201、other user 404、内部 state 字段 400、Redis 故障回源与删除级联；全程 Mock，不调用网络模型。
- 本 slice 不生成滚动摘要、不推进 summary 水位、不调用 `ModelAgentRuntime`，也不把 prepare 结果注入 `/api/chat`；这些分别属于 6.9.3.3 与 6.9.3.4。

### 回顾时可以问

- “为什么 prepare 必须先校验 conversation ownership，再读取 Redis 或 PostgreSQL state？”
- “为什么 Redis 不能成为 ConversationState 权威源，缓存坏掉时如何降级？”
- “如何区分 statePatch 字段省略与显式 null，为什么这会影响版本推进？”
- “Chat history 为什么只返回 sanitized state，而不直接序列化 Prisma model？”

## 2026-07-11 — Phase 6.9.3.3 Rolling Conversation Summary + CAS

### 做了什么

- prepare 按 12 条未覆盖消息优先、否则 summary + 未覆盖窗口达到输入预算 70% 触发；已覆盖原文不重复计入 pressure，水位只停在最新完整 assistant 消息。
- `@repo/types` 提供 AI SDK 兼容的 strict summary schema；server composition root 解析 Mock/Live、双开关、provider/model、HTTPS base URL、key、单次调用和 token/timeout 预算。key/base URL 不进入 bundle、结果或 Trace。
- 摘要源显式限定 USER/ASSISTANT；provider 输入先脱敏 bearer/cookie、裸 `sk-*`、client secret/password、AWS access key 与 PEM 私钥，输出再次扫描；credential-like 输出、schema/provider/timeout 错误或超出数据库 CHECK 的 usage 都降级且不推进摘要。
- 模型调用位于 Prisma transaction 外；事务内使用 Serializable 复核目标范围 `sha256:` source hash，并以 summaryVersion + 旧 coveredThroughOrder CAS 写入。first-create P2002、serialization P2034、version/watermark update race 均返回有界状态，不在同一请求重复调用模型。
- Live provider 解析拒绝把 OpenAI key 发送到自定义 DeepSeek 域名；仅保留默认 DeepSeek URL + OpenAI-only 配置到官方 OpenAI URL 的显式兼容改写。
- `@repo/ai` 首次接入 Nest server 时修复内部 `.ts` import/export 的跨 package build 兼容；AI package 70 项回归保持通过。Docker server 明确默认 Mock/Live false，不透传 API key。

### 验收与边界

- 单测覆盖 12 条/70%、安全整数、完整轮次、稳定 hash、凭据双向防护、Mock/Live guard、预算、模型失败、stale、update CAS、first-create race、越界 usage 与 higher-order message。
- PostgreSQL e2e 覆盖 12 条完整消息首次 `generated/version=1/watermark=11`、第二次 `reused`、状态路径、双账号隔离和级联清理；本 slice 不调用真实模型。
- 截至 6.9.3.3，`/api/chat` 当时尚未消费 prepare 结果；该接入随后在 6.9.3.4 完成，受控 Live 摘要体验仍属于 6.9.3.5。

### 回顾时可以问

- “为什么模型调用不能放在 Prisma transaction 里？”
- “source hash 为什么只复核目标水位范围，而允许更高 order 新消息出现？”
- “为什么 token pressure 不能重复计算已经被摘要覆盖的原文？”
- “first-create、stale snapshot 和 version CAS conflict 分别如何处理？”
- “Zod 3 的 AI SDK schema 与 Zod 4 Nest server 如何跨 package 兼容？”

## 2026-07-12 — Phase 6.9.3.4 Web Context Assembler + Dexie Recovery

### 目标与为什么做

Phase 6.9.3.3 已能在 Nest prepare 中安全生成并持久化滚动摘要，但 Web Chat 仍未消费它。直接把 summary、RAG、Agent prompt 和 OCR 拼成一个大 system prompt，会让低优先级资料挤掉当前问题，也无法解释是哪一层被裁。这个 slice 的目标是把 prepare 接入真实 `/api/chat` 编排，用可观测的分层预算保证 base/latest user 和当前 OCR 优先，同时给 24 小时会话状态增加不越权的本地恢复。

### 主要内容与关键决策

- Web request 携带 optional `conversationId`。首轮没有 id 时安全跳过 prepare；ChatMessage sync 返回 id 后，第二轮请求才调用 prepare。这是有意的首轮降级，而不是客户端伪造会话或阻塞首答。
- 顺序固定为 request validate -> provider/live auth -> token+id prepare -> Router/RAG -> assembler -> mandatory 413 -> trace -> mock/live stream。live credential rejection 在 prepare 前完成；prepare 默认 10 秒、限定 1~15 秒并组合 request abort，任何 network/timeout/5xx/schema failure 只产生固定 degraded，不阻断 Mock Chat。
- prepare 保持同步请求而不投 BullMQ，因为它位于单次 Chat 的读时上下文决策路径：调用方需要在本轮 prompt 装配前得到已有 summary/state 或明确 degraded。BullMQ 适合可延后后台任务，不适合让当前回答等待另一个异步任务状态机。
- assembler 把 base/latest user 设为 mandatory；agent guidance、untrusted state guidance、OCR、recent complete turns、safe RAG、summary 分层装配。agent/state 合计最多 10% 且分别记录 token/drop；OCR 当前 question 优先，旧消息只保留完整 user/assistant turn；RAG 不能安全截断时整层 drop 并清空 citations/verifier/safety；summary 仅在确有 history dropped 时考虑。optional layer 只能裁剪或 drop，不能制造 413。
- ConversationState 是短期、可过期、单会话的恢复上下文，不等于长期记忆。它只保存当前目标/题目 id，不代表稳定用户偏好，也不自动写入 `UserMemory`。
- PostgreSQL 保持 state/summary 权威，Redis 只做服务端 public-state cache。Dexie v9 只保存 sanitized state、版本与有效期；不保存 summary，因为摘要有 CAS 水位、服务端凭据防护和跨设备一致性要求，把正文复制到浏览器会扩大泄露面并产生多权威冲突。
- Dexie 写入/读取/clear 按 user 串行，serverVersion 不低于 local 才覆盖；过期、坏 schema、key/user mismatch、logout、unmount、身份变化和迟到旧请求都 fail-safe。activeQuestionId 不能被用来伪造 OCR 全文。
- Mock/live response headers 与 Agent Trace 只包含 summary status/version、bounded dropped-layer codes、实际 conversationId 和 token 计数，不包含 summary、prompt、RAG chunk、state 正文或 raw error。

### RED / GREEN 与审查修复

- RED 先证明 conversationId 缺失、prepare client 缺失、assembler 不存在、Provider request 只靠源码断言、Dexie table/cache/state mapper 缺失；GREEN 后形成可执行 request preparer、authenticated prepare helper、纯 assembler、runtime bridge 和 strict shared contract。
- 审查阶段修复了 optional layer 导致伪 413、OCR 未按实际 remaining 二次裁剪、超长 optional 源在 tokenize 前无硬字符界、`turns.flat()` 临时数组、agent/state guidance 混账、state separator 注入、legacy context policy 兼容、timeout timer/listener cleanup、outer catch raw error、activeContext 浅校验、Trace 空断言、Dexie 并发写/clear 复活、readLatest N+1/sort 与 Provider unmount restore。
- 相关 contract/unit tests、Web lint 和 Next build 已通过；本 slice 没有调用真实模型。尚未完成 Docker 全栈 Mock、受控 Live 或 headed 可见浏览器验收，不能据此宣称真实摘要语义质量已经通过。

### 回顾时可以问

- “分层 context budget 如何保证 summary 或 RAG 不会挤掉 latest user 与当前 OCR？”
- “为什么 prepare 是有界同步读路径，而不是 BullMQ 后台任务？”
- “ConversationState 为什么不是长期记忆，activeQuestionId 为什么不能恢复 OCR 全文？”
- “为什么 Dexie 只存 sanitized state 而不存 summary？”
- “首轮没有 conversationId 时为何选择降级首答，第二轮如何进入 prepare？”

### 可见浏览器 Mock 验收补充

- 本地当前分支以 Web `3200`、API `3001` 运行，使用 headed Chrome 完成真实注册、首轮降级、conversationId 建立、sanitized state 写入、刷新恢复、多轮消息触发摘要与再次刷新复用；安全响应头依次观察到 `generated/version=1` 与 `reused/version=1`。
- IndexedDB `conversationStates` 实际只包含 `id/userId/conversationId/activeGoal/activeQuestionId/stateVersion/expiresAt/updatedAt`；console error 与 page error 均为 0，摘要正文未进入 header、Trace 或结果文件。
- 浏览器验收发现服务器历史回填时的重复 suppress 标志会吞掉刷新后的第一次新增消息 sync。回归测试先失败，再移除冗余 suppress；保留 `lastServerSyncKey/inFlightServerSyncKey` 去重后，原快照不重复上传，而变化后的首条消息可以正常持久化。
- 共精确删除 8 个 `phase6934-* @example.com` 临时账号，清理后剩余 0。该验收仍是本地 Mock，不等同于 Docker 全栈或受控 Live；二者继续留给 Phase 6.9.3.5。

### 回顾时还可以问

- “为什么服务器历史回填的 suppress 标志会吞掉刷新后的第一条消息，signature 去重为何已经足够？”
- “headed Mock 验收如何证明 generated/reused、Dexie 白名单与刷新后继续 sync？”

## 2026-07-12 — Phase 6.9.3.5 Docker Mock / Live Acceptance Closeout

### 目标与为什么做

前四个 slice 已分别证明数据模型、权威状态、滚动摘要和 Web 装配，但仍缺少三个不能由单元测试替代的事实：Docker 运行态是否真的使用当前产物、真实模型能否生成 strict 摘要、验收结束后是否能恢复安全默认并清理数据。本 slice 不再扩展记忆能力，而是把 Phase 6.9.3 从“代码完成”推进为“真实运行证据完整”。

### 主要内容与关键决策

- 恢复 Docker 七服务全栈并给 MinIO 增加 `miniodata:/data` 命名卷。`docker compose down` 会删除容器但不删除命名卷；此前 PostgreSQL 数据仍在，旧 MinIO 容器对象因原配置没有卷而不能承诺恢复。server 不再导入整个根 `.env`，只通过 Compose interpolation allowlist 传入模型、双开关、provider key 与摘要预算，并显式锁定 `NODE_ENV=production`；避免本机无关配置/凭据污染容器。
- `minio-init` 对 `mc alias set` 增加最多 30 次的一秒有界重试。本机 Docker Hub 暂不可达，`minio/mc:latest` 实际是 Phase 7.23.8 离线 `mc-shim`；重试只解决 MinIO readiness race，不隐藏永久错误。
- Docker Desktop 4.81 多服务并行 BuildKit session 会报 `x-docker-expose-session-sharedkey` 非打印字符。本机临时用 `COMPOSE_BAKE=false` 顺序 build，再 `up --no-build`；不把 Docker Desktop 特定绕行写入项目配置。
- Mock API 固定样本验证 12 条触发、`generated -> reused`、跨用户 404、并发 version 2 / stale snapshot 和 credential marker rejection；Docker headed Mock 验证 Trace layer token、Dexie 八字段白名单、刷新恢复、console/page error 0 与无横向溢出。
- 首次 DeepSeek Live 摘要返回固定 `PROVIDER_ERROR`，普通 Chat 同模型可用。根因是 AI SDK `generateObject` 默认对未识别的 OpenAI-compatible model 选择 tool/function calling，而该 DeepSeek 模型需要 JSON response mode。回归测试先要求 provider invocation 带 `mode: 'json'` 并得到 13 pass / 1 fail，再做最小 adapter 修复；没有放宽 strict Zod schema、预算、超时、双开关或错误脱敏。
- 修复后真实摘要一次生成：provider/model/promptVersion 为 `deepseek/deepseek-v4-flash/conversation-summary-v1`，16 条未覆盖消息得到 version 1、watermark 15，provider-reported input/output usage 为 2246/154，约 2383ms；随后 2 条未覆盖消息复用 version 1。调用前 1600 是字符估算预留，不是 provider tokenizer 的硬上限，不能与 usage 或账单混写。
- Agent Trace metadata 把 `layerTokens=m/a/s/o/r/k/y` 放在 bounded preview 之前，避免长 preview 截断重要观测字段；只记录各层 token，不记录摘要、prompt 或 chunk 正文。Live 可见 Chat 最终保留“二次函数判别式”和正确值 1，没有把 49 当正确值，也没有复述 credential marker。
- server 重建后浏览器 access token 恰好过期，失败发生在 Next Chat live auth、provider 调用之前，因此没有模型费用。通过同一可见 Chrome 重新登录后只重试一次；这也验证了真实登录恢复，而不是绕过认证。

### 验收与清理

- `@repo/ai` 71/71，database 7/7，server 76 suites / 693 tests、e2e 17 suites / 58 tests，web 352/352；types/ai typecheck、server/web lint/build、fsrs test 全部通过。
- Docker `postgres/redis/minio/server/worker/web/admin` 运行，worker healthy；Mock 和 Live Chat/Trace 浏览器窗口按用户要求保留用于观察。
- 结束时 base Compose 重建 server/web，`/api/dev/ai-mode` 为 Mock。严格删除 7 个 `phase6935-* @example.com` 合成账号和 4 个会话，级联 User/Conversation/ChatMessage/Summary/State 均为 0，Redis conversation-state key 为 0，两个隔离浏览器 profile 的站点 storage 已清空；没有 reset 数据库或删除原有用户数据。
- 完整证据、token、水位、边界与回顾问题见 `docs/acceptance/2026-07-11-phase-6-9-3-conversation-memory.md`。

### 边界

- Mock 证明工程 contract，单个 Live 样本只证明本次摘要体验，不证明所有学科、语言、provider 或超长对话质量。
- Chat Trace 输入/输出值仍是预算估算，不替代供应商账单；provider-reported summary usage 只记录安全 metadata。
- Phase 6.9.3 只完成短期会话记忆。稳定长期记忆、episodic memory 和 MCP-ready Orchestrator 分别属于后续 6.9.5、6.9.6、6.9.7。

### 回顾时可以问

- “为什么普通 DeepSeek Chat 能用，但结构化摘要必须显式 JSON mode？”
- “Docker down 为什么没有丢 PostgreSQL，却不能承诺恢复旧 MinIO 对象？”
- “`layerTokens=m/a/s/o/r/k/y` 各层是什么，为什么要放在 preview 前？”
- “Mock 与一个受控 Live 样本分别证明什么，为什么不能据此宣布所有摘要质量已通过？”
- “验收清理怎样保证只删合成账号，不 reset 数据库？”

## 2026-07-14 — Phase 6.9.4.3 Structured-output Resilience 零网络 Checkpoint

### 目标与为什么做

Attempt D 已将 Router 真实 strict success 推进到 15/16，但固定 case `router_ambiguous_mixed_chat_16` 仍以 `PROVIDER_ERROR / structured_output` fail-closed。成功 output 为 59~341，没有触及 400，因此不能用盲目重跑或继续加 token 代替工程证据。本 checkpoint 的目标是补齐 Provider schema enforcement、无副作用 Live preflight 和 evidence identity，而不是宣布 controlled-Live 质量完成。

### Task 1 — Schema compatibility compiler（`303b88a`）

- RED 先固定 Router / Verifier 真实 schema 不能直接当作 DeepSeek strict 稳定子集，并覆盖未注册 schema、可选字段、passthrough、多元素 tuple、未知关键字、`z.any()` 与 hostile getter/proxy。
- GREEN 实现 identity-only profile registry、`const -> enum`、单元素 tuple 转普通 `items`、删除 `$schema/minItems/maxItems`、非原地投影与深冻结。Provider projection 不替代 canonical Zod；长度、状态关联与 refinement 仍在本地最终校验。
- 审查补强 hostile accessor 与固定错误语义，最终无 Critical / Important 遗留。

### Task 2 — DeepSeek strict-tool Provider transport（`bdb7cb5`）

- RED 先要求显式区分 `json_object` 和 `deepseek_strict_tool`，拒绝 `/v1`、端口、encoded path、OpenAI provider 与未批准模型，并要求不存在 `response_format/json_schema`。
- GREEN 固定精确 `https://api.deepseek.com/beta`、唯一 forced synthetic function `model_agent_result`、`strict:true`、`maxRetries=0` 和调用前 profile resolve。该 function 没有 handler、业务执行、副作用或 MCP 语义。
- 审查发现 invocation `schema` hostile getter 一度可在 Provider catch 外泄漏 canary；补了先失败测试，再以安全 wrapper 收口为固定 `MODEL_AGENT_STRUCTURED_SCHEMA_UNSUPPORTED`，不伪造 provider provenance。

### Task 3 — Paired CLI preflight 与 evidence（`2100e10`）

- RED 先固定 schema 编译/校验必须早于 UUID、evidence fs/reservation、Provider factory 和 runner；返回 `false`、throw、非法注入值或 hostile property/getter/proxy 都必须为 0 side effects。
- 最终审查进一步复现 dependencies/strict executor 本地初始化抛错、malformed/hostile return 与 arm 前同步 attempt callback 曾可在 UUID/evidence 之后落为 `unexpected_runner_error`，其中早期 callback + valid return 还会写入错误 evidence。修复后完整受控 preflight 顺序为 schema 校验 -> 安全 start timestamp -> 本地初始化与权威快照 -> arm callback -> UUID/evidence -> runner/Provider attempt；无效初始化固定 `live_config_invalid`，不泄漏原始异常。
- GREEN 要求只有明确 `true` 继续，新 Live report 使用 `phase-6.9.4.3-runner-v2` + `deepseek_strict_tool_v1`；历史 runner v1 Live 只读兼容，Mock v1/v2 禁止携带 Live transport 字段。
- 审查继续保持 100/28/72、Router 800/400、Verifier 1600/400、global 28 calls / 96,000 input / 11,200 output、单 case 10 秒和 `maxRetries=0`，与批准设计、实施计划和历史 contract 一致。

### 验收、边界与结论

- Fresh gates：AI 151 passed，Agent 344 passed，typecheck/lint 均 exit 0；deterministic baseline 仍 74/100、critical=2；fresh Mock complete，`caseEntries/runtimeInvocations/providerAttempts/strictSuccesses/zeroCallCases = 100/28/0/28/72`。
- zero-call Live config 为 exit 3，evidence 数量 `4 -> 4`。历史 validator 仍为 A exit 3 / `profile_mismatch`，B/C/D exit 0 / `incomplete`；A/B/C/D blob hash 均未改写。
- 本 checkpoint 零网络、零真实模型调用，未读取真实 key，未操作 Docker。Router / Verifier 仍 `enabled=false`，生产继续 deterministic。
- 该 checkpoint 当时的下一步是合并 main 后开独立 controlled-Live；该步骤随后已执行为 Attempt E，结果见下一节。只有 28/28 strict success、72/72 zero-call 与所有质量/安全/权限/延迟/token/usage provenance/成本门槛同时通过，Phase 6.9.4.3 才能完成。

### 回顾时可以问

- “为什么普通 `json_object` 不等于 Provider 级 JSON Schema 保证？”
- “`model_agent_result` 为什么不是业务 Tool，也不会进入 MCP？”
- “为什么 strict tool 后仍要用 canonical Zod 二次校验？”
- “为什么 schema 校验和 strict executor 本地初始化都必须在 UUID/evidence 之前完成？”
- “为什么 151/344 个零网络测试通过仍不能启用 Router / Verifier？”

该节原交接语已由下方 Attempt E 结果取代，不再作为当前下一任务。

## 2026-07-14 — Phase 6.9.4.3 Attempt E Strict-tool Controlled-Live Checkpoint

### 做了什么

- 在 structured-output resilience 分支已合并并推送到 `main@5d964c51a948d4603a1fcff5c52dba66b0581725` 后，从新 main 创建独立 controlled-Live 任务；只在单次 PowerShell 子进程内读取根 `.env` 的 key，结束后恢复 Mock 并移除进程 key。
- 先执行 96/96、845 assertions 的 paired 精确测试、Agent typecheck/lint 和负向 zero-call preflight；随后执行唯一一次 `deepseek_strict_tool_v1` Live。错误的 `bun --env-file=.env` 命令在配置 preflight 阶段被安全拒绝，未产生 UUID/evidence/provider attempt，不算 Live attempt。
- Attempt E 从 100 条 case 开始，在 `router_ambiguous_notes_tutor_01` 首次 Provider attempt 收到 `http_client` 后停止：`observed/notRun=37/63`、`providerAttempts/strictSuccesses=1/0`、usage 0/0、report duration 204ms / failing case 157ms、validator exit 0（合法 incomplete）。完整 JSON 证据为 `docs/acceptance/evidence/phase-6-9-4-3/live-20260714T071444506Z-65042475cbaf.json`，blob hash `368c91f817ad76272a495f77ff1d4d6f90695429`。

### 为什么没有继续调用

- 官方 Chat Completion 文档列出 `deepseek-v4-flash`；独立的 Tool Calls 指南描述通用 strict Beta contract：精确 `https://api.deepseek.com/beta`、函数内 `strict:true`、object 的 properties 全部 required 且 `additionalProperties:false`。Tool Calls 指南没有明确声明该模型的 strict-tool compatibility。
- 零网络 fake-fetch 捕获的实际 SDK wire 是 `POST https://api.deepseek.com/beta/chat/completions`，只含 `model/messages/max_tokens/temperature/tool_choice/tools`；唯一 forced `model_agent_result`、strict schema 和无 `response_format` 均与公开基础约束一致。这只能排除客户端 endpoint/基础字段构造错误，不能排除模型级 feature/provider compatibility。
- 当前安全分类将 401/403 归为 `http_auth`、429 归为 `http_rate_limit`，其余 4xx 归为 `http_client`。Attempt E 只能排除鉴权/限流，不能区分 400、402、422 等具体原因；raw status/body/headers/message/stack 受隐私合同禁止保存，0/0 usage 与 USD 0 也不等于余额或账单结论。
- 重跑不会增加根因信息，反而可能消耗外部配额；下一任务改为零网络 Provider compatibility diagnostics，先设计并验证固定的 4xx 分辨率（例如支付/参数类别）和 SDK wire contract，再申请新的完整 Live。

### 回顾问题

- 为什么本地 wire 符合官方公开基础约束，仍不能宣布模型级 strict-tool compatibility 通过？
- `http_client` 为什么不能直接等同于 422 schema error 或 402 余额不足？
- 为什么一次真实 Provider attempt 的 incomplete evidence 必须保留，却不能与历史 A~D 拼接成 complete？

## 2026-07-14 — Phase 6.9.4.3 JSON-mode Resolution 零网络 Checkpoint

### 做了什么

- 按批准方案停止继续扩展 strict-tool，新的 controlled-Live composition 收敛到 DeepSeek 标准 `https://api.deepseek.com` 与 `response_format=json_object`；请求不携带 tools、tool_choice 或 json_schema，canonical Zod 继续做最终校验。
- evidence identity 升级为 runner-v3 / `deepseek_json_object_v1` / `phase-6.9.4.3-json-mode-v1`，并新增 runner、顶层 promptVersion、candidate entry promptVersion 的一致性约束；历史 v1/v2 evidence 仍只读兼容。
- 删除 paired CLI 不再使用的 strict-tool schema profile 常量，保留 `@repo/ai` strict-tool 能力作为历史/实验 transport，不影响其他调用方。

### 验证结果

- Agent：`345 pass / 0 fail / 3242 assertions`；AI：`151 pass / 0 fail / 817 assertions`。
- Agent/AI typecheck 与 lint exit 0；deterministic baseline `74/100`、critical `2`。
- fresh Mock 为 complete：`100/28/0/28/72`；CLI exit 1 仅表示 paired candidate 仍关闭。tracked 历史 Mock evidence validator exit 0。
- 负 Live preflight 为 `live_config_invalid / exit 3`，没有真实调用或新 evidence。整个 checkpoint 没有读取真实 key、没有启动 Docker 或浏览器。

### 为什么仍未完成

零网络门禁只证明 JSON-mode wire、证据身份与安全边界可执行，不证明 100-case 真实语义质量。下一步必须先 `--no-ff` 合并 main、在 main 复验并推送，再从新 main 创建独立 controlled-Live 分支完整跑一次；如果仍失败，记录终局 fallback 并保持 deterministic，不再引入第三种 transport。

## 2026-07-14 — Phase 6.9.4.3 JSON-mode Controlled-Live Terminal Evidence

### 运行结果

- JSON-mode resolution 已合并到 `main@ec330ce1952ae058d92be941f800e9ae28791b91`，main 上 Agent 345、AI 151、typecheck/lint、baseline、Mock、validator 与负 Live preflight 全部复验后推送远程；local/tracking/remote SHA 相等。
- 从新 main 创建 `codex/phase-6-9-4-3-controlled-live-json-mode`，读取根 `.env` 中的 key 到单次 PowerShell 进程内，显式设置标准 `https://api.deepseek.com` 与 Live 双开关；命令结束后在 finally 中恢复 Mock 并移除 key/base URL/model 变量。
- 唯一完整 run 为 `live-20260714T084632914Z-4145ce0ffea0.json`：`runStatus=complete`、`providerAttempts/strictSuccesses=28/28`、`zeroCallCases=72`、usage `10677/4323`、estimated cost `$0.002842788219846`，strict validator exit 0。

### 终局门槛结论

- Verifier：`enabled=true / quality_gate_passed`，additional P95 `2872ms`。
- Router：`enabled=false / latency_budget_exceeded`，additional P95 `4264ms`；质量、安全、权限、schema、usage 与成本链路没有失败，但固定延迟门槛未通过。
- CLI exit 1 是 paired decision 的固定语义，不是 Provider 或 structured-output 失败。该 run 证明 JSON mode transport 可用，但不能把 Router 接入生产。
- 按批准的终局规则，不重跑、不补 case、不提高 cap、不新增 transport。Router 保持 deterministic terminal fallback；Verifier 通过结论保留为 Phase 6.9.5 后续集成依据，当前生产 Chat 不改动。

## 当时下一步（已由 2026-07-15 Agent-first 路线取代）

1. Phase 6.9.4.3：提交本次 Live evidence 与终局结论，独立审查后合并 main、main 复验并推送；随后从新 main 进入 Phase 6.9.5。
2. Phase 6.9.5 ~ 6.9.7：结构化长期记忆、情景记忆、MCP-ready Orchestrator 与阶段验收。
3. Phase 6.9 完成后进入 Phase 8 性能/PWA，再进入 Phase 9 MCP Tool 体系。

## 参考文档

- `AGENTS.md`：当前协作规范和最新项目快照。
- `README.md`：项目入口和启动说明。
- `docs/roadmap.md`：完整 Phase 路线。
- `docs/data-flow.md`：当前有效数据流和边界。
- `docs/acceptance-checklist.md`：统一验收入口。
- `docs/ai-behavior-acceptance.md`：mock / live / RAG / Agent 验收规范。
- `docs/blogs/phase-7-rag-safety-guard.md`：RAG SafetyGuard 面试复盘。
- `docs/blogs/phase-7-event-observability.md`：后台任务可观测面试复盘。
- `docs/blogs/phase-7-openapi-docs.md`：Swagger / OpenAPI debug docs 面试学习博客。
- `docs/blogs/phase-7-worker-split.md`：API / worker 启动拆分面试学习博客。
- `docs/blogs/phase-7-worker-observability.md`：Worker Observability 面试学习博客。
- `docs/blogs/rag-eval-and-hybrid-retrieval.md`：RAG Eval、Hybrid Retrieval 和真实检索验收面试学习博客。
- `docs/blogs/durable-outbox-worker-observability.md`：Durable Outbox、Dispatcher Runner 和后台观测面试学习博客。
- `docs/blogs/worker-readiness-deployment-checks.md`：Worker Readiness、部署前检查和 CLI 退出码面试学习博客。
- `docs/blogs/admin-console-ops-platform.md`：后台管理、Admin Console、Outbox Ops、审计和控制台总览面试学习博客。

## 2026-07-20 — Phase 6.9.5 V12 real host wiring (offline)

- Replaced the V12 fake default host with a real default-off composition. The
  host performs read-only preflight, reserves durable V12 state, writes a
  private non-secret resource-selector manifest, creates only synthetic
  resources, and delegates the controlled Docker/API/browser/Trace/default-off
  lifecycle to lineage-neutral V8 mechanics.
- Added `review_api_setup / not_started` so a post-reservation setup failure is
  recorded as a recoverable, pre-provider terminal. Recovery can restore
  mock/default-off and clean only the selectors in the V12 manifest.
- Corrected V12 product/recovery script exit codes. No V12 CLI, Docker,
  browser, API, provider or synthetic runtime data was executed or created.
- Fresh focused V11/V12 Jest, native V12 durable ledger, full Server Jest
  (`--runInBand`), server build/lint, Agent/AI/types/Web static gates, Compose
  config and diff check passed. The two independent reviews have no unresolved
  P0/P1; a fresh user authorization remains required before any one-shot V12
  branch command.

### V12 offline safety hardening (same lineage; still no runtime)

- Added an attempt-bound `recovery.json` terminal. It is mutually exclusive
  with success, verifies the failure record against the latest journal
  checkpoint, and can be sealed once only after default-off restore and exact
  cleanup; a later recovery is blocked instead of repeating Docker/DB work.
- Private V12 execution state now contains only a SHA-256 fingerprint of the
  root `DATABASE_URL`, captured before the reusable V8 host reads its Prisma/
  Docker configuration. Product revalidates repo/evidence/default-off/database
  identity after it owns the lock and before reserve; recovery repeats the
  check under a recovery owner and fails closed on drift before any write.
- Closed the Docker half-activation edge: when server recreation succeeded but
  the live container id was not yet recorded, default-off restore uses the
  observed current container. The headed V12 browser evidence window is held
  for 30 seconds before exact cleanup so the operator can inspect it.
- This remains offline: no V12 product/recovery CLI, Docker lifecycle,
  browser, API, provider, synthetic account, trace or test data was executed
  or created. The offline gates and independent contract/operations reviews
  are complete; the next required step is fresh, explicit user authorization.

## 2026-08-12 - SR5 next-lineage admission D0/C1

- Added an independent source-admission contract and single-use zero-provider capability.
- Preserved sealed v2 tag/run/report/artifact identity; planned v3 tag is intentionally absent.
- Focused `16/16` (`39 expect()`), Agent full `1554/1554` (`25286 expect()`, `197 files`), typecheck, and ESLint pass. No `.env`, credential, Provider, evidence, Docker/API/browser, Trace, BackgroundJob, or Outbox access.
- Feature `87dd1e24` was pushed and merged with `--no-ff` as `001770ff`; `main` was pushed. Merged-main Git admission produced bundle `sha256:047ca220...3821f` with future tag absent and all zero-provider counters at zero; focused/full/typecheck/lint/parity passed again. Tag and controlled-Live remain separate future decisions.

## 2026-08-12 - SR5 next-lineage C2 tag contract

- Added a post-tag verifier that dynamically validates the v3 annotated tag, local/origin raw object parity, peeled/target commit, canonical message, final whole-tree bundle, sealed v2 receipt, and empty v3 evidence namespace.
- Avoided embedding the future tag object ID or final bundle SHA inside the covered Agent tree, preventing pre-creation and source-hash circularity.
- Pre-tag focused `21/21` (`31 expect()`), Agent full `1575/1575` (`25319 expect()`, `198 files`), typecheck/lint passed; Provider/credential/evidence/business writes remain zero.
- Closeout is feature push, `--no-ff` merge/push `main`, create/push v3 annotated tag on that exact commit, then run actual post-tag verifier without a later commit moving `main` past the tag.

## 2026-08-12 - SR5 next-lineage D1 authorization contract

- Froze the DeepSeek/Qwen current-account boundary and one-shot authorization vocabulary against exact v3 tag/source identities.
- Rejected old authorization strings, v4 placeholders, all source/authorization drift, extra fields, forged/hostile capability, hostile accessors, and authorization-shaped CLI args.
- Focused `20/20` (`32 expect()`), Agent full `1595/1595` (`25352 expect()`, `199 files`), typecheck/lint passed; no `.env`, credential, Provider, evidence, product, Trace, BackgroundJob, or Outbox access.
- D1 consumes no user approval. Since D1 code is newer than v3, future execution requires a later monotonic source tag containing D1 and the final runner; v3 remains immutable.
- Feature `54cf3e7f` was pushed and merged with `--no-ff` as `31d4144d`; `main == origin/main`. Merged-main focused/full/typecheck/lint passed again, still with zero Provider and credential access.

## 2026-08-12 - SR5 next-lineage D2 runner preflight

- Added an independent composition of C2 annotated-tag parity, D1 exact source-bound authorization, and strict zero-call proxy attestation.
- Cross-checks all source identities and rejects forged/reused capabilities, hostile inputs, source drift, malformed proxy results, provider-call/probe drift, extra fields, abort, and executable authorization argv.
- Focused `13/13` (`29 expect()`), Agent full `1608/1608` (`25383 expect()`, `200 files`), typecheck/lint/Prettier/diff check passed. Runner invocation and Provider dispatch stay disabled; credential/evidence/business access remains zero.
- D2 imports no historical Live CLI/runner/durability and creates no run id, reservation, marker, journal, report, artifact, or recovery claim.
- Feature `33ddbd14` was pushed and merged with `--no-ff` as `3c93f11e`; merged-main focused/full/typecheck/lint passed and `main == origin/main` at the implementation checkpoint.

## 2026-08-12 - SR5 D3 runtime source binding contract

- Replaced the planned hard-coded final commit/bundle/tag-object approach with a dynamic runtime receipt contract, avoiding an in-tree source-hash fixed point.
- Stable code freezes only v4 tag name/ref, manifest/object scope, sealed predecessor, and exact boundary/authorization vocabulary; post-merge Git identities remain runtime values.
- Strictly rejects all source/tag/remote/peeled/target/evidence drift and authorization commit/bundle/tag-object mismatch. Output remains `gitAuthorityIssued=false`, runner/dispatch disabled, and all access counters zero.
- Focused `19/19` (`30 expect()`), Agent full `1627/1627` (`25415 expect()`, `201 files`), typecheck/lint/Prettier/diff check passed; no v3 identity constants, `.env`, Provider, evidence, product, Trace, BackgroundJob, or Outbox access.
- Feature `0943c4e4` was pushed and merged with `--no-ff` as `d553e545`; merged-main focused/full/typecheck/lint passed and `main == origin/main` at the implementation checkpoint.

## 2026-08-13 - SR5 D4 runtime runner/durability

- Added `phase-6-9-8-retriever-final-response-schema-recovery-sr5-runtime-runner-durability.ts`, a v4-native zero-provider runner boundary that consumes the D3 runtime source capability exactly once and never exposes a Provider dispatch capability.
- Fixed denominator is `8` completed guards and `12` reserved lanes; dispatches, responses, verified usage, credential reads, Provider calls, formal evidence, and business writes remain `0`. The synthetic root persists an exclusive marker, five canonical hash-chain journal records, a strict report, and a hard-link artifact.
- Focused D4 + D3 regression: `26/26` tests, `47` expect() calls. Final Agent full with `--timeout 30000` passed `1634/1634`, `25433 expect()` calls, `202 files`; typecheck, lint, Prettier, and diff check passed. The first default-5s full run only timed out 8 historical fsync-heavy tests; those 6 files passed `48/48` independently with the 30s threshold before the final extended full run passed. D3 remains record-only; only a test-only synthetic capability reaches D4. Coverage includes single-use source/reservation, fixed accounting, crash-only sealing without replay, active-owner/second-seal refusal, canonical recovery-claim validation, tamper rejection, hard-link publication, and Live/authorization-shaped argv rejection. No `.env`, Provider, Docker/API/browser, Trace, BackgroundJob, or Outbox access.
- This is engineering authority only (`qualityAuthority=none`); the final Git verifier, v4 tag, remote parity, fresh authorization, and any controlled-Live remain blocked and are the next independent task.
- Feature `e5e3150d` was pushed and merged with `--no-ff` as `5efe506f`; merged-main focused `26/26`, typecheck, lint, and diff check passed, then `main` was pushed to origin. No v4 tag or authorization was created.

## 2026-08-13 — Phase 6.9.8 SR5 D5 final Git verifier

- Added a post-tag, read-only verifier that derives the v4 D3 source receipt from live Git state.
- Enforced clean `main` parity, exact annotated tag message, local/remote tag object identity, peeled/target commit parity,
  dynamic source-object bundle, sealed predecessor identity, and empty current-lineage evidence.
- Added an opaque single-use Git/source capability. It cannot authorize the runner or Provider dispatch; quality authority remains none.
- Added 22 focused tests / 38 assertions. Current repository inspection fails closed because the v4 tag is intentionally absent.
- No credentials, `.env`, Providers, Docker/API/browser, formal evidence, Trace, BackgroundJob, Outbox, or business writes were used.
- Next: push/merge D5 and revalidate merged `main`; only then create/push the final v4 tag in a separate Git-operation task.
- Closeout: feature `7a2dfced` merged/pushed as `31b17fe9`; merged-main D5+D3+D4 passed `48/48` (85 assertions), typecheck/lint/diff check passed.

## 2026-08-13 — SR5 v4 post-tag test recovery

- Created/pushed immutable v4 tag on `5d1d2997`; tag object `6523ae12`, bundle `sha256:e702a81a...084e2a`.
- D5 real Git inspection passed, with Git/source authority only and all execution/call/write counters zero.
- Tagged-source replay exposed a lifecycle-dependent unit test and passed only `21/22`; v4 is not eligible for authorization.
- Recovery moves final tag and exact boundary/authorization vocabulary to v5 and uses an isolated temporary root for missing-repository failure.
- Recovery focused D5+D3+D4 passes `48/48` (85 assertions); typecheck/lint/diff check pass.
- v4 remains immutable. Next: merge/push recovery, validate merged `main`, then create/push and inspect v5.
- Recovery feature `f80854bf` merged/pushed as `96caa882`; merged-main focused D5+D3+D4 passed `48/48`. This commit is ready for the single v5 tag operation.

> 2026-08-14 - Phase 6.9.8 SR5 v9 evidence namespace recovery started
>
> The authorized v8 entrypoint failed at source admission with `providerCalls=0 / credentialReads=0 / formalEvidence=0`. CodeGraph/FastCtx traced the failure to an unversioned formal-evidence regex and path family that treated sealed v2 files as current evidence. v9 versions marker, journal, report, recovery claim, temporary report, and dispatch lock paths; a new regression proves legacy sealed files are ignored while v9 leftovers still fail closed. Focused passed `67/67` (`148 expect()`), Agent full `1657/1657` (`25474 expect()`, `203 files`), and typecheck/lint/diff check passed. No old artifact is moved, deleted, or rewritten. Next gates are feature commit, `--no-ff` merge/push, merged-main zero-provider replay, v9 tag parity, then fresh V9 authorization.

## 2026-09-04 — Matt Pocock engineering skills 仓库配置

- 由于 `gh` CLI 不可用，本仓库选择本地 Markdown issue tracker，新增 `docs/agents/issue-tracker.md`、`triage-labels.md` 和 `domain.md`，并在 `CLAUDE.md` 增加 `## Agent skills` 兼容入口。
- 后续工程流程按 `grill-with-docs -> to-spec -> to-tickets -> implement/TDD -> code-review` 推进；ticket 存放于 `.scratch/<feature>/issues/`，不创建平行外部 tracker。
- 本次仅配置文档，不读取 `.env`，不调用 DeepSeek/Qwen，不启动或清理 Docker，不修改用户既有 dirty 文件，也没有业务数据变化。证据等级：`implemented`（workflow configuration）。

## 2026-09-04 — ChatTurn Enqueue API spec 与 tracer-bullet tickets

- 按本地 tracker 约定新增 `.scratch/chat-turn-enqueue-api/spec.md` 与 6 张按依赖排序的垂直 ticket。第一张 ticket 将现有 `ChatTurnEnqueueService` 暴露为认证 `POST /chat-turns`，后续依次覆盖 Web adapter、`/api/chat` bridge、浏览器 replay、预算/Trace ledger 和真实模型 Worker gate。
- Ticket 01 明确只接收 owner 已持久化消息 id、幂等事实和预算版本；不在 HTTP 入队阶段写 snapshot、调用 BullMQ/Redis/Provider 或暴露 Outbox payload。依赖边界和验收标准已写入 spec，未修改产品代码。
- 本次未读取 `.env`、未调用 DeepSeek/Qwen、未启动或清理 Docker、未触碰用户既有 dirty 文件。证据等级：`implemented`（spec/ticket planning）。
