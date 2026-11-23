# 文档截图

这里的图只用于 README 与发布说明，不是测试基线。来源与更新方式：

| 文件 | 来源步骤（`tests/e2e/ui-smoke.mjs` 的截图） |
|---|---|
| `trade.png` | `03-default-quote`：默认标的自动加载、报价与日 K |
| `trade-form.png` | `02b-form`：交易表单与限价占位 |

当前版本：0.6.0，FtAi Desktop 0.14.14，2026-11-23。

更新：

1. 按 `tests/e2e/README.md` 启动应用并跑 e2e，产物在 `.artifacts/e2e/<时间戳>/`；
2. 挑对应步骤的 png，压到最长边 1600px 后覆盖本目录同名文件（例如 `sips -Z 1600 -s format png in.png --out docs/screenshots/trade.png`）；
3. 只提交这些精选图；`.artifacts/` 与走查目录里的截图不提交。
