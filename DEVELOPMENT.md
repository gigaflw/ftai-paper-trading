# @clrstn2830h/plugin-paper-trading 开发说明

FtAi Desktop 的模拟交易插件：宿主一半装配共享业务层并注册 16 个模型工具，界面一半是 React 视图
（股票交易 / 持仓 / 订单 / 复盘与设置页）。期货只有宿主侧（服务、RPC、工具）与独立账本，没有界面。

这份文档给开发者看，不随插件发布（不在 package.json 的 `files` 里）；插件市场详情页显示的是 `README.md`。

## 目录

| 位置 | 内容 |
|---|---|
| `src/core/`、`src/contract/`、`src/store/`、`src/service/`、`src/data/`、`src/agent/` | 与 dsh 版插件同源的共享层，由脚本同步，不在本仓手改 |
| `src/index.ts` | 平台外壳：服务装配、Remote `ftaiPaperTrading`、RPC 路由、工具注册、调度器 |
| `src/platform/ftshare-client.ts` | `ctx.ftshare.accessToken()` → MCP Bearer 客户端 |
| `src/client/` | 界面一半（React）：`Views.tsx`、`state.ts`、i18n、`style.css` |
| `src/types.ts` | 宿主与界面的边界类型（数据源状态等） |
| `locale/` | 「功能与插件」页的名称与说明 |
| `tests/e2e/` | 面板 CDP 走查脚本 |
| `scripts/sync-shared.mjs` | 共享层同步脚本 |
| `lib/` | 构建产物（宿主 `index.js`、界面 `client.js`），不进 git |

## 构建

```bash
pnpm install
pnpm build            # tsc（宿主）→ ftai-plugin-remote → tsc（界面）→ vite build
```

宿主产物 `lib/index.js`、界面产物 `lib/client.js` 由应用加载，不是独立网页。界面构建用
`vite.config.ts` 里的 `defineClientConfig`（`@ftai/plugin-sdk/vite`），`src/client/index.ts` 导出 `apply`，
由宿主按 `package.json` 的 `ftai.client.entry` 加载；React 与 ReactDOM 18.3.1 由 `@ftai/client-react` 提供，
`ftai.client.external` 必须声明 `@ftai/client-app` 与 `@ftai/client-react`。
应用组件从 `@ftai/plugin-sdk/app` 具名引用，插槽类型与注册服务在 `/features`；前后端只以类型互相引用
（`src/types.ts`、`./remote` 的类型），不要引用应用源码。

## 本机试装

```bash
# 1) 本机 npm 源（首次会下载 verdaccio）
npx verdaccio --listen 4873

# 2) 发布到本机源
pnpm build
pnpm publish --registry http://127.0.0.1:4873 --no-git-checks

# 3) 带本机源启动已安装的 FtAi Desktop（隔离走查目录）
FTAI_PLUGIN_REGISTRY=http://127.0.0.1:4873 \
FTAI_HOST_HOME=$HOME/ftai-walkthrough/paper-trading/host \
FTAI_DEV_FILE_CREDENTIALS=1 \
  "/Applications/FtAi Desktop.app/Contents/MacOS/FtAi Desktop" \
  --user-data-dir=$HOME/ftai-walkthrough/paper-trading/userData \
  --remote-debugging-port=0
```

然后在应用「插件」页 → 添加 → 按包名安装 `@clrstn2830h/plugin-paper-trading`；首次打开面板时授权 FTShare 数据。

## 面板 e2e

```bash
node tests/e2e/ui-smoke.mjs --walkthrough ~/ftai-walkthrough/paper-trading
```

应用需带调试口启动、已登录并授权 FTShare；测试会向走查账本真实下单。环境与步骤断言见 `tests/e2e/README.md`。

## 共享层同步

账本、撮合、复盘、账户、数据适配与工具这些平台无关逻辑，唯一来源是 dsh 版插件仓库
（默认 `~/workspace/dsh/dsh-fft-paper-trading`，可用 `--repo` 或 `DSH_PAPER_TRADING_REPO` 指定）。
本插件只保存同步结果，平台外壳只做装配，两边因此共用同一份业务代码。

| 目录/文件 | 来源 | 说明 |
|---|---|---|
| `src/core/` | 原样同步 | 账本、撮合、费用、交易日、涨跌停、期货规则、视图 |
| `src/contract/`、`src/contract.ts`、`src/futures-contract.ts` | 原样同步 | 前后端契约（按域拆分） |
| `src/store/` | 原样同步 | 事件账本、账户注册表、快照、笔记 |
| `src/service/` | 原样同步 | 股票/期货服务、RPC 端点表、调度 |
| `src/data/` | 原样同步 | FTShare 行情/期货/日历适配器（只依赖结构类型） |
| `src/agent/` | 原样同步（改一处 import） | 16 个 `paper_*` 工具；`@deepseek-ai/dsh-tools` 换成形状相同的 `@ftai/plugin-sdk/host` |
| `src/index.ts` | **平台外壳**，不同步 | 服务装配、Remote、RPC、FTShare 令牌接入 |
| `src/platform/` | **平台外壳**，不同步 | `ctx.ftshare.accessToken()` → MCP Bearer 客户端 |
| `src/client/` | **平台外壳**，不同步 | React 界面一半 |
| `src/types.ts` | **平台外壳**，不同步 | 宿主与界面的边界类型 |

```bash
# 首次同步或升级时显式指定 tag；之后不带 --tag 就沿用 shared-manifest.json 记录的 tag
# （仓库路径可用 --repo / DSH_PAPER_TRADING_REPO 指定）
node scripts/sync-shared.mjs --tag <dsh 插件的 tag>

# 只核对当前工作区是否与来源一致（改完自检 / CI）；不一致退出码 1
node scripts/sync-shared.mjs --check
```

同步时固定改写只有两处：相对 import 的 `.js` 后缀改成 `.ts`；`agent/` 的工具包 import 换成
`@ftai/plugin-sdk/host`。来源 tag、tag 指向的 commit 与每个文件的 sha256 记在 `shared-manifest.json`；
升级 dsh 版插件时先改脚本/命令里的 tag，再跑同步与 `--check`。

共享层按 dsh 仓库的 tsconfig 编写（`strict`，不含 `exactOptionalPropertyTypes` /
`noUncheckedIndexedAccess`）；本插件 `tsconfig.json` 显式关掉这两项避免逐文件改写，平台外壳仍保持严格检查。

## 发布

```bash
pnpm publish --access public
```

发布前确认包根目录的 `README.md` 已是插件自己的说明（市场详情页取它，不能留模板内容）；新版本发布后
有冷却期，立即试装时按包名指定版本。`shared-manifest.json` 与同步结果要一起提交。