/** 模拟交易界面的中文文案；键表达业务含义，不拿中文原文当键。 */
export default {
  feature: { title: '模拟交易' },
  subtitle: '本地模拟盘 · 账本来自 dsh 版插件共享层',
  loading: '正在读取账本…',
  tabs: { label: '视图', trade: '交易', positions: '持仓', orders: '订单', review: '复盘' },
  account: {
    picker: '账户', totalAssets: '总资产', cash: '可用现金', marketValue: '持仓市值',
    dayPnl: '今日盈亏', totalPnl: '累计盈亏',
  },
  actions: { refresh: '刷新', retry: '重试', connectData: '连接 FTShare 数据', reconnectData: '重新检查数据连接' },
  dataSource: {
    live: 'FTShare 已连接', stub: '未连接 FTShare', signedOut: '未登录 FtAi',
    notAllowed: '未获 FTShare 授权', unavailable: 'FTShare 暂不可用',
  },
  trade: {
    symbol: '代码', query: '查询', side: '方向', type: '类型', qty: '数量（股）', limitPrice: '限价',
    preview: '预览', submit: '提交', queryHint: '输入 6 位代码并查询行情', submitted: '委托已提交', marketHint: '市价按现价成交',
  },
  side: { buy: '买入', sell: '卖出' },
  orderType: { market: '市价', limit: '限价' },
  orderStatus: {
    queued: '待开盘', pending: '挂单', partiallyFilled: '部分成交', filled: '已成交',
    canceled: '已撤单', rejected: '已拒绝', expired: '已过期',
  },
  quote: {
    change: '涨跌 {change}', previousClose: '昨收 {price}', marketTs: '行情时间 {ts}',
  },
  preview: { price: '参考价', amount: '金额', fee: '费用', cashAfter: '成交后可用', valid: '参数与资金校验通过' },
  positions: {
    symbol: '标的', qty: '持股', available: '可卖', avgCost: '成本价', lastPrice: '现价',
    marketValue: '市值', pnl: '浮动盈亏', empty: '暂无持仓',
  },
  orders: {
    time: '时间', symbol: '标的', side: '方向', type: '类型', price: '委托价', qty: '数量',
    filled: '已成交', status: '状态', cancel: '撤单', empty: '暂无委托',
  },
  review: {
    period: '区间', period7d: '近 7 天', period30d: '近 30 天', periodAll: '全部',
    trades: '成交笔数', realizedPnl: '已实现盈亏', maxDrawdown: '最大回撤', fees: '累计费用',
    equity: '权益曲线', equityHint: '按账本的逐日快照绘制', empty: '还没有可复盘的记录',
  },
  rail: { label: 'K 线', placeholder: '查询行情后显示日 K', hint: '日 K 来自 FTShare，最多 240 根', loading: '正在加载日 K…', collapse: '收起', expand: '展开', resize: '拖动调整 K 线栏宽度' },
  settings: {
    title: '模拟交易', description: '本地账本与 FTShare 数据源设置。',
    groupDataSource: '数据源', dataSourceTitle: 'FTShare 数据',
    dataSourceDescription: '令牌由 FtAi 账号换取，插件不保存。',
    groupAccount: '账户', initialCash: '初始资金', initialCashDescription: '账户创建时的初始现金（元）。',
    ledgerTitle: '账本', ledgerDescription: '事件账本，按日快照；文件在插件数据目录下。', ledgerValue: '插件数据目录',
  },
  errors: {
    unknown: '操作失败，请重试', invalidArgument: '参数不合法', invalidSymbol: '代码格式不正确',
    accountNotFound: '找不到账户', dataUnavailable: '行情不可用，请先连接 FTShare 数据',
    rpcFailed: '账本服务返回错误', signedOut: '请先登录 FtAi', notAllowed: '未获 FTShare 授权',
  },
}
