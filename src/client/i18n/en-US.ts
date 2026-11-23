/** English copy for the paper-trading UI; keys describe intent, never source text. */
export default {
  feature: { title: 'Paper Trading' },
  subtitle: 'Local simulator · ledger shared with the dsh plugin',
  loading: 'Reading the ledger…',
  tabs: { label: 'Views', trade: 'Trade', positions: 'Positions', orders: 'Orders', review: 'Review' },
  account: {
    picker: 'Account', totalAssets: 'Equity', cash: 'Cash', marketValue: 'Market value',
    dayPnl: 'Today P/L', totalPnl: 'Total P/L',
  },
  actions: { refresh: 'Refresh', retry: 'Retry', connectData: 'Connect FTShare data', reconnectData: 'Check data connection again' },
  dataSource: {
    live: 'FTShare connected', stub: 'FTShare not connected', signedOut: 'Not signed in to FtAi',
    notAllowed: 'FTShare not authorized', unavailable: 'FTShare temporarily unavailable',
  },
  trade: {
    symbol: 'Symbol', query: 'Query', side: 'Side', type: 'Type', qty: 'Quantity', limitPrice: 'Limit price',
    preview: 'Preview', submit: 'Submit', queryHint: 'Enter a 6-digit code and query the quote', submitted: 'Order submitted', marketHint: 'Market orders fill at the quote',
  },
  side: { buy: 'Buy', sell: 'Sell' },
  orderType: { market: 'Market', limit: 'Limit' },
  orderStatus: {
    queued: 'Queued', pending: 'Working', partiallyFilled: 'Partially filled', filled: 'Filled',
    canceled: 'Canceled', rejected: 'Rejected', expired: 'Expired',
  },
  quote: { change: 'Change {change}', previousClose: 'Prev close {price}', marketTs: 'Quote time {ts}' },
  preview: { price: 'Reference price', amount: 'Amount', fee: 'Fees', cashAfter: 'Cash after', valid: 'Parameters and cash check passed' },
  positions: {
    symbol: 'Symbol', qty: 'Shares', available: 'Available', avgCost: 'Avg cost', lastPrice: 'Last',
    marketValue: 'Market value', pnl: 'Unrealized P/L', empty: 'No positions yet',
  },
  orders: {
    time: 'Time', symbol: 'Symbol', side: 'Side', type: 'Type', price: 'Limit', qty: 'Quantity',
    filled: 'Filled', status: 'Status', cancel: 'Cancel', empty: 'No orders yet',
  },
  review: {
    period: 'Period', period7d: 'Last 7 days', period30d: 'Last 30 days', periodAll: 'All',
    trades: 'Trades', realizedPnl: 'Realized P/L', maxDrawdown: 'Max drawdown', fees: 'Fees',
    equity: 'Equity curve', equityHint: 'Drawn from the ledger daily snapshots', empty: 'Nothing to review yet',
  },
  rail: { label: 'Chart', placeholder: 'Query a quote to show daily candles', hint: 'Daily candles from FTShare, up to 240 bars', loading: 'Loading daily candles…', collapse: 'Collapse', expand: 'Expand', resize: 'Drag to resize the chart rail' },
  settings: {
    title: 'Paper Trading', description: 'Local ledger and FTShare data source settings.',
    groupDataSource: 'Data source', dataSourceTitle: 'FTShare data',
    dataSourceDescription: 'The token is exchanged for your FtAi account; the plugin never stores it.',
    groupAccount: 'Account', initialCash: 'Initial cash', initialCashDescription: 'Starting cash recorded when the account opened (CNY).',
    ledgerTitle: 'Ledger', ledgerDescription: 'Event ledger with daily snapshots, stored under the plugin data directory.', ledgerValue: 'Plugin data directory',
  },
  errors: {
    unknown: 'Operation failed, please retry', invalidArgument: 'Invalid argument', invalidSymbol: 'Invalid symbol format',
    accountNotFound: 'Account not found', dataUnavailable: 'Market data unavailable; connect FTShare first',
    rpcFailed: 'The ledger service returned an error', signedOut: 'Sign in to FtAi first', notAllowed: 'FTShare not authorized',
  },
}
