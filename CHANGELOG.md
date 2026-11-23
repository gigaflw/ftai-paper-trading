# 变更记录

本文件按 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 组织，版本号遵循 SemVer。

## [0.6.0] - 2026-11-23

首个公开发布。

### Added

- 股票模拟盘：交易、持仓、订单、复盘四个标签，市价与限价下单，五张账户统计卡，多账户切换与重置。
- 商品期货账本：手数、保证金、当日平仓、15:30 收盘结算与风险度；通过 7 个 `paper_futures_*` 工具操作，没有界面。
- 16 个模型工具覆盖下单、撤单、查行情、复盘、账户管理与账本备份恢复。
- FTShare 行情接入：声明 `ftshare.token` 能力取短期令牌，拒绝授权时账本照常可用。
- 账本按账户落在本机 `paper-trading/<账户>/events.jsonl`，逐日快照，重置前自动备份。

[0.6.0]: https://github.com/gigaflw/ftai-paper-trading/releases/tag/v0.6.0