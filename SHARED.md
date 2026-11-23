# 共享层同步（与 dsh 版 paper-trading 保持一致）

账本、撮合、复盘、账户、数据适配与工具这些平台无关的逻辑，唯一来源是 dsh 版插件仓库
（默认 `~/workspace/dsh/dsh-fft-paper-trading`）。本插件保存同步结果，平台外壳只做装配，
两边因此保持同一份业务代码。

## 目录

| 目录/文件 | 来源 | 说明 |
|---|---|---|
| `src/core/` | 原样同步 | 账本、撮合、费用、交易日、涨跌停、视图 |
| `src/contract/`、`src/contract.ts` | 原样同步 | 前后端契约（按域拆分） |
| `src/store/` | 原样同步 | 事件账本、账户注册表、快照、笔记 |
| `src/service/` | 原样同步 | 股票/期货服务、RPC 端点表、调度 |
| `src/data/` | 原样同步 | FTShare 行情/期货/日历适配器（只依赖结构类型） |
| `src/agent/` | 原样同步（改一处 import） | 18 个 `paper_*` 工具；`@deepseek-ai/dsh-tools` 换成形状相同的 `@ftai/plugin-sdk/host` |
| `src/index.ts` | **平台外壳**，不同步 | 服务装配、`pty` 远端方法、RPC、FTShare 令牌接入 |
| `src/platform/` | **平台外壳**，不同步 | `ctx.ftshare.accessToken()` → MCP Bearer 客户端 |
| `src/client/` | **平台外壳**，不同步 | React 界面一半 |
| `src/types.ts`、`src/data-stub.ts` | **平台外壳**，不同步 | 初版界面的边界类型与演示报价 |

## 同步命令

```bash
# 从 dsh 插件仓库指定 tag 同步（默认 v0.8.0，可用 --repo / DSH_PAPER_TRADING_REPO 指定路径）
node scripts/sync-shared.mjs --tag v0.8.0

# 只核对当前工作区是否与来源一致（CI/改完自检）；不一致退出码 1
node scripts/sync-shared.mjs --tag v0.8.0 --check
```

同步时的固定改写只有两处：相对 import 的 `.js` 后缀改成 `.ts`；`agent/` 的工具包 import
换成 `@ftai/plugin-sdk/host`。来源 tag、commit 与每个文件的 sha256 记在
`shared-manifest.json`，升级 dsh 版插件时先改 tag 再跑同步与 `--check`。

## 编译选项差异

共享层按 dsh 仓库的 tsconfig（`strict` 但不含 `exactOptionalPropertyTypes` /
`noUncheckedIndexedAccess`）编写；本插件 `tsconfig.json` 为这两项显式关掉，避免逐文件改写。
平台外壳仍保持严格检查。
