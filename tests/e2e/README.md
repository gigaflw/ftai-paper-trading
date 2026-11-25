# 模拟交易面板 e2e

参考 dsh 版插件 `tests/e2e` 的 CDP 走查脚本改写：连已带调试口启动的 FtAi Desktop，操作真实界面并对
DOM 断言。数据是走查目录里的真实本地账本；行情来自 FTShare，需要已登录并授权。

## 最快路径

应用已登录、已安装过本插件（并授权过 FTShare）之后，在插件目录：

```bash
pnpm e2e:local
```

脚本会：停掉走查实例的宿主与应用 → `pnpm build` → 把本次构建**热替换**进走查实例里已安装的包
（并把客户端注册 id 改回安装包名，仅测试用）→ 启动应用 → 跑 `ui-smoke` → 退出。

- `--keep`：跑完不退出，方便看失败现场；
- `--restore`：跑完把走查实例原来的 `lib/` 还原（默认保留本次构建）；
- `--walkthrough DIR` 或 `FTAI_WALKTHROUGH`：覆盖走查目录；
- 其余参数原样传给 `ui-smoke`（如 `--out`）。

日志在 `dsh_tmp/e2e-app.log`，失败截图在 `.artifacts/e2e/<时间戳>/`。

## 手动跑

不走脚本时，等价步骤：

```bash
"/Applications/FtAi Desktop.app/Contents/Resources/binaries/ftai-rust-host" --stop
FTAI_HOST_HOME=$HOME/ftai-walkthrough/paper-trading/host FTAI_DEV_FILE_CREDENTIALS=1 \
  env -u ELECTRON_RUN_AS_NODE \
  "/Applications/FtAi Desktop.app/Contents/MacOS/FtAi Desktop" \
    --user-data-dir=$HOME/ftai-walkthrough/paper-trading/userData --remote-debugging-port=0
node tests/e2e/ui-smoke.mjs --walkthrough ~/ftai-walkthrough/paper-trading
```

应用里要装好本插件并授权 FTShare；测试会往走查账本里真实下单，不要同时操作这个窗口。

**本机坑位**（脚本已处理，手动跑时注意）：

- 会话环境若带 `ELECTRON_RUN_AS_NODE=1`，Electron 会当 Node 跑，启动报 `bad option: --user-data-dir`；启动前必须 `env -u ELECTRON_RUN_AS_NODE`。
- 不再是发版安装时，走查实例里装的可能是旧包名；热替换后要把 `lib/client.js` 里的注册 id 改成安装包名，否则报 `did not register`。
- 上一次崩溃/对话框残留会污染下一次运行；`ui-smoke` 启动后先 reload，脚本启动前也会清 `DevToolsActivePort`。

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
| 对比 / 行情 | 对比页渲染；表格最大回撤与曲线自算值一致（容忍 0.1 个百分点）；行情页有板块切换 |
| 期货 | 5 张统计卡、四个标签、合约输入；试算里「结算后权益」与「成交后可用」同量级（防 100 倍单位错误） |
| 批量 / 笔记 | 批量页有 CSV 输入与试算按钮；笔记页有整页文本域 |
| K 线栏 | 拖动加宽、折叠到 40px、竖向标签、展开恢复 |

不覆盖：需要假行情/假时钟的撮合场景（成交价、T+1、收盘顺延），以及新建/改名/归档/锁定账户、
注资/提款、恢复快照、重置账户等写操作；
这些按 dsh 版的做法由离线 service 测试覆盖，不在 UI 走查里做。
