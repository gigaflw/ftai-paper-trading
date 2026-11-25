# 文档截图

这里的图只用于 README 与发布说明，不是测试基线。来源与更新方式：

| 文件 | 内容 | 来源 |
|---|---|---|
| `trade.png` | 股票交易：自动试算分项、下单回执、最近成交与委托，右侧日 K | 走查实例 + `seed-demo.mjs` 的演示账本 |
| `futures.png` | 期货持仓：保证金、风险度、浮动盈亏 | 同上（期货账本也由 seed 脚本生成） |
| `compare.png` | 多账户对比：净值曲线、收益率、最大回撤 | 同上 |

当前状态：下一版（0.7.0）开发中，FtAi Desktop 0.14.14，2026-11-25。

演示数据用 `node docs/screenshots/seed-demo.mjs --apply` 生成（会自动备份原走查账本），截完
`--restore <备份目录>` 还原。截图窗口视口 1600×1180、2x，缩到 1600 宽。

README 里用的是仓库绝对地址（`raw.githubusercontent.com` 的 `main` 分支），不是相对路径：npm 包页与
插件详情页对相对路径的处理不一致，绝对 https 两边都能显示。

更新：

1. `node docs/screenshots/seed-demo.mjs --apply` 准备演示账本，按 `tests/e2e/README.md` 的方式启动应用；
2. 截三张图（交易页、期货持仓、对比页），压到 1600 宽覆盖本目录同名文件；
3. 只提交精选图；`.artifacts/`、走查目录里的截图与备份都不提交。