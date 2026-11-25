# 模拟交易面板 e2e

参考 dsh 版插件 `tests/e2e` 的 CDP 走查脚本改写：连已带调试口启动的 FtAi Desktop，操作真实界面并对
DOM 断言。数据是走查目录里的真实本地账本；行情来自 FTShare，需要已登录并授权。

## 前置

1. 应用带调试口、隔离数据目录启动，并指向本机插件源（否则装不到本机包）：

   ```bash
   "/Applications/FtAi Desktop.app/Contents/Resources/binaries/ftai-rust-host" --stop
   FTAI_PLUGIN_REGISTRY=http://127.0.0.1:4873 \
   FTAI_HOST_HOME=$HOME/ftai-walkthrough/paper-trading/host \
   FTAI_DEV_FILE_CREDENTIALS=1 \
     "/Applications/FtAi Desktop.app/Contents/MacOS/FtAi Desktop" \
     --user-data-dir=$HOME/ftai-walkthrough/paper-trading/userData \
     --remote-debugging-port=0
   ```

2. 应用里登录账号，并安装/升级 `@clrstn2830h/plugin-paper-trading`；首次打开面板时授权 FTShare 数据。
3. 跑测试时不要同时操作这个窗口（脚本会切标签、下单到走查账本）。

## 运行

在本插件目录（`@playwright/test` 是插件自己的 devDependency）：

```bash
node tests/e2e/ui-smoke.mjs \
  --walkthrough ~/ftai-walkthrough/paper-trading
```

- 端口默认从 `<walkthrough>/userData/DevToolsActivePort` 读，也可以用 `--port`。
- 截图与失败现场写到插件仓的 `.artifacts/e2e/<时间戳>/`（已 gitignore），可用 `--out` 覆盖；
  提交文档图时再手工挑图放进 `docs/screenshots/`。
- 退出码 0 表示全部通过；失败步骤会打印第一处不满足的文本。

## 覆盖范围

| 步骤 | 断言 |
|---|---|
| 打开模拟交易 | 一级视图可见 |
| 布局 | 5 张统计卡、4 个标签、账户选择、K 线栏 |
| 默认标的 | 打开即自动拉 600519 报价与日 K（需已授权） |
| 自动取价 | 输入 000001 后自动出现报价；代码不重复、行情时间不是原始 ISO |
| 自动试算 | 佣金/印花税/过户费/费用合计/成交后可用/最多可买自动出现 |
| 下单 | 市价单出现在委托表 |
| 标签 | 持仓/订单出现该标的，复盘有权益曲线与成交笔数 |
| 非法代码 | 提示「代码格式不正确」 |
| 对话框 | 账户（列出默认账户）、资金（流水区）、账本（快照与重置区）可打开并关闭 |
| 对比 / 行情 | 对比页渲染（空态或曲线）；行情页有板块切换（主板/全部/科创板/创业板） |
| 期货 | 切到期货面板：5 张统计卡、交易/持仓/订单/复盘四个标签、合约输入可见 |
| 批量 / 笔记 | 批量页有 CSV 输入与试算按钮；笔记页有整页文本域 |
| K 线栏 | 拖动加宽、折叠到 40px、竖向标签、展开恢复 |

不覆盖：需要假行情/假时钟的撮合场景（成交价、T+1、收盘顺延），以及新建/改名/归档/锁定账户、
注资/提款、恢复快照、重置账户等写操作；
这些按 dsh 版的做法由离线 service 测试覆盖，不在 UI 走查里做。
