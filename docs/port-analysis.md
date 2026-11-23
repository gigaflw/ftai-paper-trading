# 模拟盘插件移植方案（v2）

> 2026-11-23 更新：插件已迁出 FtAi Desktop 仓，独立在 `~/workspace/ftai/plugins/paper-trading`（本仓）。
> 包名暂用 `plugin-paper-trading`，正式 npm scope 待协商（`@ftai/plugin-paper-trading` 或 `@ftai-plugin/paper-trading`）；
> 本文中的 `packages/plugins/paper-trading` 是迁移前的路径，只作历史记录。


> 目标：把 `~/workspace/dsh/dsh-fft-paper-trading`（`@dsh-ft/dsh-fft-paper-trading` v0.7.3，本地自建账本的模拟盘插件）移植到 FtAi Desktop。
> 基线：本仓 `v0.14.12`（2026-11-19 发布，契约 2.5.0、SDK/host-api 2.5.0）。上一版分析基于 v0.14.10，结论已被本版取代。
> 本轮范围：按用户 2026-11-19 的三条决定收敛——K 线不搬、页面留空；先简化、只求可运行；不保留免费档（匿名取数）。数据面用平台新增的 FTShare 短期令牌能力。

---

## 1. 结论速览

| 问题 | 结论 |
|---|---|
| 能否拿到用户 FTShare 数据？ | 能。契约 2.5.0 起平台提供 `ctx.ftshare.accessToken()`：返回当前用户的 **FTShare 短期访问令牌**（不发 API Key），插件以 `Authorization: Bearer <token>` 请求 FTShare 网关，REST 与 MCP 同一受众。一方插件**声明能力即可、不弹授权**。 |
| dsh 三个依赖怎么办？ | ft-share 底座**只移植传输层**（MCP 客户端 + 四态归一 + 工具目录），鉴权从 API Key 换成 Bearer 令牌；fft-settings **不移植**；dsh-kline **不移植**，右栏留空。 |
| 形态 | **三方插件**（2026-11-19 定）：双半 TS 插件，发布 npm 后由用户在「插件」页按包名安装；不随应用分发、不动宿主组合。FTShare 令牌需用户首次授权。 |
| MVP 范围 | 股票账户单账本：交易（预览/下单/撤单）、持仓、订单、复盘简版、出入金/重置/快照、8 个对话工具、数据源状态、K 线空栏、设置页。期货、批量 CSV、行情页（全市场列表）、K 线图表、小窗盯盘都不做。 |
| 工作量 | MVP 粗估 **17–24 人日**（±30%）；之后完整股票半 +6–10，期货半 +6–10，K 线（StockChart）+1.5–2.5。 |
| 已定 | ① 与已有「非凸模拟交易账户」是两个独立功能，入口等初版出来再调；② 不做复杂开关（初版无开关，三方形态下开关就是插件开关）。 |

---

## 2. 平台新增能力：FTShare 短期令牌（契约 2.5.0）

- 服务：`ctx.ftshare`（公开服务，`apps/rust-host/crates/ext/src/lib.rs:2727-2733`；生成类型 `packages/plugin-host-api/src/generated.ts:2223-2231`）。
- 方法：`await ctx.ftshare.accessToken()` → `{ token: string, expiresAt: number }`（`expiresAt` 为毫秒时间戳，令牌至少还有一半有效期）。
- 用法：以 `Authorization: Bearer <token>` 请求 `https://market.ft.tech/gateway`；同一受众覆盖 REST 与 MCP（`https://gw.ft.tech/ftshare/mcp`）。**不要**放进 `FTSHARE_API_KEY` 头（那是 API Key 格式，令牌放进去会 401）。
- 能力声明：`ftai.capabilities` 里写 `"ftshare.token"`（危险档，契约下限 2.3.0 起强制核对写法与名字）。**一方插件声明即可、不弹授权**；第三方插件首次调用时弹框（仅允许本次 / 始终允许此插件 / 拒绝，最多 60 秒，按插件 × FtAi 用户记）。经 `agent.ctx` 的调用一律 `ftshare/not-allowed`；不对远程控制开放。
- 错误码：`plugin/capability-not-declared`（没声明）、`ftshare/not-allowed`（未授权/拒绝/超时/桌面端没开）、`ftshare/signed-out`（未登录）、`ftshare/unavailable`（交换失败）。
- 令牌：30 分钟有效；宿主按用户与主体缓存，用过一半有效期就重新交换（同一用户/主体在前一半有效期内多次调用给同一枚）；插件每次使用前取一次、**不自行保存**。交换按用户限流 60 次/小时（宿主缓存，正常使用远低于上限）。
- 不给 API Key：插件拿不到、也不需要；撤销授权/换用户后已发出的令牌在有效期内仍可用，到期自然失效。

---

## 3. 依赖处置（最终）

源插件对三个依赖的实际耦合只有 3 个点：`ftshareData.call/listTools`、`ftshareSettings.apiKey.describe`、`klinePanels`。

| 依赖 | 处置 | 说明 |
|---|---|---|
| `@dsh-ft/dsh-fft-ftshare` | **只移植传输层**：StreamableHTTP MCP 客户端（每次调用 `initialize → callTool → close`，60s 超时）+ 四态归一（`available/empty/denied/failed` + `notice.code`）+ 工具目录 `listTools()`；对上层暴露与源插件相同的 `{ call(interfaceName, args), listTools() }` | 鉴权改为每次取 `ctx.ftshare.accessToken()`，用 `Authorization: Bearer`。不搬 settings/status/route/project/mask/策展接口表/目录 UI/免费档逻辑。源插件 `src/data/*` 三个适配器（495/867/259 行）只认这个结构切片，可**原样复用** |
| `@dsh-ft/dsh-fft-settings` | **不搬** | 源插件只用 `apiKey.describe()` 判断数据源状态；现在改为「有没有令牌」四态，插件不做 key 设置页、不读钥匙串。品牌 CSS 变量换应用 token |
| `@ftshare-lab/dsh-kline` | **不搬，右栏留空** | 删掉 `paperTrading.kline` 子槽、`klinePanels` 注入、槽探测/6 秒超时/简图回退。右栏保留占位，后续要图时用公开 `StockChart` |

依赖清单变化：删除上述 3 个 dsh 包与 `@deepseek-ai/*` peer；新增 `@modelcontextprotocol/sdk`（`dependencies`）、`@ftai/plugin-sdk@^2.5.0`、`cordis 4.0.0-rc.12`（`devDependencies`）。React 由应用提供。`cordis.patch.yml` 废弃，改为一方插件在宿主组合清单里一行。

> 说明：数据源子系统（设置 → 数据源里的 FTShare 包）与本插件不再有运行时依赖；它的接口目录（`~/.ftai/data-sources/ftshare`，228 个 request schema）可在开发期作为接口/字段对照参考，不进入插件产物。

---

## 4. 数据层设计

```
src/data/
  ftshare-data.ts       # 接口：call(interfaceName,args) / listTools()（沿用源插件的结构切片）
  ftshare-client.ts     # 自建 MCP 客户端：每次调用取一次令牌做 Bearer；60s 超时；错误原样抛
  ftshare-errors.ts     # 四态归一 + 错误分类（signed-out / not-allowed / unavailable / plan-denied / quota / network）
  ftshare-market-data.ts / ftshare-trading-calendar.ts   # 源插件适配器原样复用（股票/日历）
  futures-market-data.ts                                 # 期货适配器先留着不接（后续阶段）
  stub-data.ts          # 打桩：固定行情与固定交易日历，供 UI/撮合演示
```

- **令牌获取**：`ctx.ftshare.accessToken()`；在数据层入口封装 `withToken(fn)`，失败按错误码映射成数据源状态，不缓存令牌。
- **无免费档**：没有登录、没有授权、取令牌失败时数据不可用；不做匿名请求。UI 显示「未登录 / 未授权 / 暂时不可用 + 重试」，账本与只读页面照常；MVP 不提供手动价下单（源插件的「无报价时手填参考价」路径本期不做，属产品取舍）。
- **打桩**：`StubData` 返回固定股票报价/日 K/交易日历，让面板与撮合在不接令牌时也能演示；切真实实现只换装配处一个适配器。
- **节流与配额**：保留源插件的 `quote-gate`（实时 5s / 降级 300s）与「只在可撮合时段取数」；`listTools()` 启动取一次并缓存；失败指数退避；并发合并在客户端内做一次。免费档消失后仍要尊重用户套餐额度（令牌按用户套餐放行）。
- **安全**：令牌只在宿主一半内存里，进日志/错误文本前脱敏（不打印头）；不下发界面；插件不落盘。

---

## 5. MVP 范围（先简化、只求可运行）

**做**
- 股票单账本（沿用 `core/` 股票部分、`store/`、`service/paper-service.ts`）。
- 交易：下单预览（市价/限价）、提交、撤单；T+1、涨跌停、费用、时段规则沿用。
- 持仓、订单（挂单 + 历史）、复盘简版（总资产/可用/累计与今日盈亏、权益曲线用自绘 SVG、成交列表）。
- 出入金、重置（含备份/快照/恢复）。
- 8 个对话工具：`paper_stock_account/market/quote/preview/order/cancel/review` + `paper_ledger`（英文 summary、参数自校验、写操作 `needsApproval`）。
- 数据源状态条（未登录/未授权/不可用/正常）、交易日历降级提示（工作日兜底）。
- 设置页：初始资金、重置、导出账本（可选）、关于。
- 界面：一级视图 + 4 个标签（交易/持仓/订单/复盘）+ K 线空栏 + 双语 + 设计规范。

**不做（后续阶段）**
- 期货账户（`core/futures`、期货服务与工具、期货界面）。
- 批量 CSV 下单、行情页（搜索/全市场板块分页/短名单）。
- K 线图表与点图回填（右栏只留占位）。
- 对话内回执卡片（`markdownBlocks`）、小窗盯盘（`AuxWindow`）、快捷键命令。
- 旧 dsh 账本导入；免费档/匿名取数；数据源徽标之外的配额/套餐文案。

---

## 6. UI 方案

```
窗口栏/顶栏：模拟交易 · 股票
├ 页头 PageHeading：模拟交易（入金 / 重置 / 导出）
├ 账户条：总资产 · 可用现金 · 累计盈亏 · 今日盈亏 · 数据源状态
├ 工具行：标签（交易 / 持仓 / 订单 / 复盘）
├ 主区：[ 左侧内容 1fr ] [ 右栏 K 线区：空栏（虚线占位，可折叠） ]
└ 状态行：数据源 / 日历降级 / 最近刷新
```

- 入口：一条 `FeatureView`（`rail` 图标 + 主列组件 + `toolbar: { title }`）；标签页内切换，`view.history` 只记「当前标签」。
- **K 线空栏**：保留两栏几何，内容为轻量占位（图标 + 「图表待接入」），默认展开、可一键收起；不做周期/指标工具行，不做点图回填。
- 组件与规范：表格自绘（应用 Tabs/Table 未公开）、确认用 `Dialog`（禁 `window.confirm`）、提示用 `useShellNotice`、涨跌用 `--market-up/--market-down`、数字 `tabular-nums`、图标只用 Tabler、文案私有 i18n 作用域（zh-CN/en-US，含 `aria-label`/`title`）、滚动与聚焦环按 `UI-STYLE-GUIDE.md`。
- 设置页必须用 `SettingsPage` + `SettingsGroup` + `SettingsRow`。
- 数据桩：界面只依赖插件自己的 remote；桩在宿主一半，界面不感知。

---

## 7. 工程结构与依赖

```
packages/plugins/paper-trading/
  package.json      # ftai.contract ^2.5.0、ftai.host、ftai.client、ftai.capabilities ["ftshare.token"]
  src/index.ts      # 装配：仓库/服务/工具/remote/定时器/数据源状态
  src/types.ts      # remote 边界类型、RemoteErrorDetailsMap
  src/core/  store/  service/  agent/      # 从 dsh 版搬（股票部分）
  src/data/                                # 见 §4
  src/client/index.ts  src/client/i18n/  src/client/react/  src/client/style.css
  locale/{en,zh-CN}.json
  tests/
```

- 组合：`apps/rust-host/crates/host/src/lib.rs` 的 `bundled_ts_plugins()` 加一行；`packages/plugin-runtime/package.json` 依赖加上本包。
- 构建：SDK 模板 `tsc -p tsconfig.json && ftai-plugin-remote && tsc -p tsconfig.client.json && vite build`。
- 验收：删包验收 + `pnpm install --frozen-lockfile`/typecheck/check:deps/build/cargo check 通过；走查一次启停。

---

## 8. 计划与工作量

| 阶段 | 内容 | 人日 |
|---|---|---|
| 0 骨架 | `ftai-create-plugin` 生成新工程、组合清单、remote 骨架、走查链路、删包验收 | 1.5–2.5 |
| 1 数据通道 | MCP 客户端移植（transport/错误/目录）、`ctx.ftshare` 接入与错误映射、桩 | 2.5–3.5 |
| 2 宿主核心 | `core/` 股票 + `store/`（dataDir）+ `service/` 搬运与测试迁移 | 4–6 |
| 3 工具与面板 | 8 个工具改 SDK 形态；remote 约 12 个方法 | 2–3 |
| 4 界面 MVP | 一级视图、4 标签、交易/持仓/订单/复盘简版、空栏、设置页、双语与样式 | 6–9 |
| **MVP 合计** | | **16–24**（取 17–24 报出） |
| 后续 | 完整股票半（行情页/批量/复盘全/全工具）+6–10；期货半 +6–10；K 线 +1.5–2.5 | |

---

## 9. 风险与待核实

1. **产品定位重叠**：应用里已有「非凸模拟交易账户」（`packages/plugins/ftai-trade-26-10`，接入用户在非凸 APP 里已有的模拟账户，经我方后端交易 MCP）。本移植是**本地自建账本、无需外部账户**的模拟盘。两者用户心智接近，需产品确认：并存、合并入口、还是只保留其一。
2. **功能开关形态**：0.14.11 起一方功能常驻，开关只停工作部分（宿主一半不加载），关闭态由应用画功能页；非凸用的是 `view.more` 功能页 + `resident` 行。本插件是一级视图，若做可关开关，需要决定关闭态入口与页面（或 MVP 先用 `always_on` 不可关，后续再改）。
3. **MCP + Bearer 实测**：文档已验收网关免费/基础接口均 200，但插件侧用 `@modelcontextprotocol/sdk` 带 Bearer 打通 MCP 会话需实跑一次（阶段 0）。
4. **接口名与字段**：源插件靠 `listTools()` 探测 `ft_v1_*` 工具是否存在（付费/免费档差异）；免费档取消后，仍要确认这些工具在当前套餐下的可用性、字段形状与旧版一致。
5. **SDK 2.5.0 发布**：npm 上 2.4.0 为 latest 的记录早于本版本；一方插件走 workspace 不受影响，若将来要市场发布需核对 2.5.0 是否已发布。
6. **旧账本**：`$DSH_HOME/paper-trading/` 不自动迁移；MVP 不做导入（`core/migrations` 格式可复用，后续可加）。
7. **dsh 仓新分支**：`dsh-fft-paper-trading` 有未推送的 `feat/kline-host-contract`（把 K 线槽改成 kline host 契约）；本移植 K 线不搬，暂不跟进，后续要做图表时再看。
8. **数据桩与真实数据的边界**：桩必须只在开发/无令牌时启用，避免把演示数据当成行情。

---

## 10. 与 v1 分析的差异

| 项 | v1（基于 v0.14.10） | v2（基于 v0.14.12） |
|---|---|---|
| 数据面 | 无 FTShare 服务、插件不可用 key，需自建直连并另配 key | 契约 2.5.0 提供短期令牌，`ctx.ftshare.accessToken()` + Bearer，一方插件声明即用 |
| 依赖 | 讨论移植 ftshare/settings/kline 的可行性 | ftshare 只搬传输层；settings/kline 不搬 |
| K 线 | 用 `StockChart` 替代 | 不搬、留空栏，后续再议 |
| 范围 | 股票半 + 期货半完整移植 | 先做股票 MVP，其余分期 |
| 免费档 | 保留降级路径 | 不保留，无令牌即数据不可用 |
