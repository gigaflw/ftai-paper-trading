/**
 * 界面状态：与 remote 绑定，持有账户、委托、报价、预览、复盘、资金流水与账本快照。
 *
 * 数据来源与 dsh 面板同一套 RPC 端点（`accounts/*`、`account/*`、`market/*`、`order/*`、
 * `list/*`、`cash/flow`、`ledger/*`、`review/get`），只认 Promise 形式的端口，不直接接触
 * `ctx`。状态属于本次 apply，撤销后旧请求的结果不再交给界面。
 * @module @clrstn2830h/plugin-paper-trading/client/state
 */

import type {
  AccountView, AccountsView, Bar, CashFlowEntry, CompareView, DataSourceView, DayReport, FillView,
  LedgerExport, LedgerSnapshotsView, MarketListResult, MarketStatus, OrderDraft, OrderView, Period,
  PreviewView, Quote, ReviewView, RoundTrip, SymbolHit, TabKey,
} from '@clrstn2830h/plugin-paper-trading/types'

/** remote 调用的结果信封（与 `@ftai/plugin-sdk/remote` 的 `RemoteResult` 同形）。 */
type Result<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message?: string; readonly details?: unknown } }

/** 宿主一半暴露给界面的端口。 */
export interface PaperTradingPort {
  rpc(endpoint: string, payload?: unknown, account?: string): Promise<Result<unknown>>
  connectData(): Promise<Result<DataSourceView>>
  dataSource(): Promise<Result<DataSourceView>>
}

export interface BoardSnapshot {
  ready: boolean
  /** 正在做的账本操作（`board` / `order` / `cancel` / `review` / `data` / `cash` / `ledger` / `accounts`），空串表示空闲。 */
  busy: string
  /** 最近一次失败的稳定错误码；空串表示没有错误。 */
  errorCode: string
  /** 最近一次失败的可读说明（RPC 的业务错误原文）；空串表示没有。 */
  errorMessage: string
  tab: TabKey
  accounts: AccountsView | null
  /** 当前股票账户 id。 */
  accountId: string
  account: AccountView | null
  orders: OrderView[]
  /** 输入的六位代码。 */
  symbol: string
  /** 最近一次取到的报价与它的 canonical id。 */
  quote: Quote | null
  quoteSymbol: string
  quoteBusy: boolean
  preview: PreviewView | null
  previewBusy: boolean
  review: ReviewView | null
  /** 复盘明细：日终报告数组与交易配对（`review/daily`、`review/roundtrips`）。 */
  reviewDaily: DayReport[] | null
  roundTrips: RoundTrip[] | null
  /** 账户对比（`compare/get`）。 */
  compare: CompareView | null
  /** 行情列表（`market/list`）与当前板块/页码。 */
  marketList: MarketListResult | null
  marketBusy: boolean
  marketBoard: string
  marketPage: number
  /** 行情搜索结果（`market/search`）。 */
  marketHits: SymbolHit[]
  /** 备选（自选）标的（`shortlist/*`）。 */
  shortlist: string[]
  dataSource: DataSourceView | null
  /** 最近一次成功的委托（用于下单回执，不参与业务状态）。 */
  lastOrder: OrderView | null
  /** 当前标的的日 K（来自 `market/bars`）；空数组表示还没取到。 */
  bars: Bar[]
  barsLoading: boolean
  /** 交易时段与交易日历状态（`market/status`）。 */
  status: MarketStatus | null
  /** 最近成交（`list/trades`），供回执与「最近成交」小表使用。 */
  trades: FillView[]
  /** 资金流水（`cash/flow`）。 */
  cashFlow: CashFlowEntry[]
  /** 账本快照列表（`ledger/list`），打开账本面板时取。 */
  ledger: LedgerSnapshotsView | null
  /** 账本导出结果（`account/export`）。 */
  ledgerExport: LedgerExport | null
}

export type Board = ReturnType<typeof createBoard>

const PERIOD: Period = '30d'
/** 默认标的：与源插件的默认演示标的保持一致；两半不能相互引用运行时代码，这份小常量各自持有。 */
const DEFAULT_SYMBOL = '600519'

/** 六位代码或带后缀代码 → 契约的 canonical id（`600519.SH`）；不合法时 null。 */
export function canonicalId(input: string): string | null {
  const text = input.trim().toUpperCase()
  if (/^\d{6}\.(SH|SZ|BJ)$/.test(text)) return text
  if (!/^\d{6}$/.test(text)) return null
  const code = text
  if (/^(600|601|603|605|688|689)\d{3}$/.test(code)) return `${code}.SH`
  if (/^(000|001|002|003|300|301|302)\d{3}$/.test(code)) return `${code}.SZ`
  if (/^(43|83|87|88)\d{4}$/.test(code) || /^920\d{3}$/.test(code)) return `${code}.BJ`
  return null
}

/** canonical id 去掉交易所后缀，用于输入框回显。 */
export function displayCode(id: string): string {
  return id.split('.')[0] ?? id
}

/** 一次 apply 一份状态；组件只订阅，StrictMode 重挂不重复读。 */
export function createBoard() {
  const listeners = new Set<() => void>()
  let snapshot: BoardSnapshot = {
    ready: false, busy: '', errorCode: '', errorMessage: '', tab: 'trade',
    accounts: null, accountId: '', account: null, orders: [],
    symbol: DEFAULT_SYMBOL, quote: null, quoteSymbol: '', quoteBusy: false,
    preview: null, previewBusy: false,
    review: null, reviewDaily: null, roundTrips: null, compare: null,
    marketList: null, marketBusy: false, marketBoard: 'main', marketPage: 1, marketHits: [],
    shortlist: [], dataSource: null, lastOrder: null, bars: [], barsLoading: false,
    status: null, trades: [], cashFlow: [], ledger: null, ledgerExport: null,
  }
  let alive = true
  let owner: { port: PaperTradingPort } | undefined
  /** 账本/账户操作的代际；更早的响应回来时丢弃。 */
  let generation = 0
  /** 报价、预览、K 线、复盘各自计代：自动取价与输入触发的预览不能互相打断。 */
  let quoteGeneration = 0
  let previewGeneration = 0
  let barsGeneration = 0
  let reviewGeneration = 0
  let detailGeneration = 0
  let compareGeneration = 0
  let marketGeneration = 0

  const publish = (patch: Partial<BoardSnapshot>) => {
    if (!alive) return
    snapshot = { ...snapshot, ...patch }
    for (const listener of listeners) listener()
  }

  const failure = (error: unknown): string => {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      const code = (error as { code?: unknown }).code
      if (typeof code === 'string') return code
    }
    return 'paper-trading/unavailable'
  }

  /** 错误 → 面板状态补丁：业务错误优先用宿主给的具体 code 与原文。 */
  const fail = (error: unknown): { errorCode: string; errorMessage: string } => {
    const value = typeof error === 'object' && error !== null ? error as { code?: unknown; message?: unknown; details?: unknown } : {}
    const details = typeof value.details === 'object' && value.details !== null ? value.details as { code?: unknown } : {}
    const code = typeof details.code === 'string' ? details.code : failure(error)
    const message = typeof value.message === 'string' && value.message !== code ? value.message : ''
    return { errorCode: code, errorMessage: message }
  }

  async function unwrap<T>(scope: { port: PaperTradingPort }, pending: Promise<Result<T>>): Promise<T> {
    const result = await pending
    if (!result.ok) {
      const error = Object.assign(new Error(result.error.message ?? result.error.code), {
        code: result.error.code,
        ...(result.error.details === undefined ? {} : { details: result.error.details }),
      })
      throw error
    }
    if (!alive || owner !== scope) throw new Error('paper-trading/stale')
    return result.value
  }

  /** 当前账户的一份完整快照：账户、委托、成交、时段、资金流水。读操作不写账本。 */
  async function accountBundle(scope: { port: PaperTradingPort }, accountId: string) {
    const rpc = (endpoint: string, payload?: unknown) => unwrap(scope, scope.port.rpc(endpoint, payload, accountId))
    const [account, orders, trades, status, cashFlow] = await Promise.all([
      rpc('account/get') as Promise<AccountView>,
      rpc('list/orders') as Promise<OrderView[]>,
      rpc('list/trades').catch(() => [] as FillView[]) as Promise<FillView[]>,
      rpc('market/status').catch(() => null) as Promise<MarketStatus | null>,
      rpc('cash/flow').catch(() => [] as CashFlowEntry[]) as Promise<CashFlowEntry[]>,
    ])
    return { account, orders, trades, status, cashFlow }
  }

  /**
   * 开场初始化：探测/建立 FTShare 数据连接，可用时自动查询默认标的并补 K 线。
   * 首次打开若还没授权，宿主会弹一次授权框；拒绝只体现在数据源徽标上，不挡账本页面。
   */
  async function autoStart(): Promise<void> {
    const scope = owner
    if (!alive || scope === undefined) return
    const token = ++generation
    publish({ busy: 'data', errorMessage: '' })
    try {
      const dataSource = await unwrap(scope, scope.port.connectData())
      if (token !== generation) return
      publish({ dataSource })
      if (dataSource.state === 'live') {
        publish({ busy: '' })
        await loadQuote(snapshot.quoteSymbol === '' ? snapshot.symbol : snapshot.quoteSymbol)
      } else {
        publish({ busy: '' })
      }
    } catch {
      if (token !== generation) return
      publish({ busy: '' })
    }
  }

  /** 读账户列表、当前账户、委托、成交、时段与资金流水；第一次进入时选中默认股票账户。 */
  async function refresh(): Promise<void> {
    const scope = owner
    if (!alive || scope === undefined) return
    const token = ++generation
    previewGeneration += 1
    publish({ busy: 'board', errorCode: '', errorMessage: '' })
    try {
      const accounts = await unwrap(scope, scope.port.rpc('accounts/list', { includeArchived: true })) as AccountsView
      const stocks = accounts.accounts.filter(meta => meta.kind === 'stock' && !meta.archived)
      const current = stocks.find(meta => meta.id === snapshot.accountId) ?? stocks.find(meta => meta.id === accounts.defaultIds.stock) ?? stocks[0]
      if (current === undefined) throw Object.assign(new Error('ACCOUNT_NOT_FOUND'), { code: 'ACCOUNT_NOT_FOUND' })
      const bundle = await accountBundle(scope, current.id)
      if (token !== generation) return
      publish({ ready: true, busy: '', accounts, accountId: current.id, ...bundle })
    } catch (error) {
      if (token !== generation) return
      publish({ ready: true, busy: '', ...fail(error) })
    }
  }

  /** 只重读账户列表（账户管理对话框用），不动当前标的与预览。 */
  async function reloadAccounts(scope: { port: PaperTradingPort }): Promise<AccountsView> {
    const accounts = await unwrap(scope, scope.port.rpc('accounts/list', { includeArchived: true })) as AccountsView
    publish({ accounts })
    return accounts
  }

  /** 切换账户：重读账户、委托、成交、时段与流水，不动报价与预览。 */
  async function switchAccount(accountId: string): Promise<void> {
    const scope = owner
    if (!alive || scope === undefined || accountId === snapshot.accountId) return
    const token = ++generation
    previewGeneration += 1
    publish({ accountId, busy: 'board', errorCode: '', errorMessage: '', preview: null, review: null, reviewDaily: null, roundTrips: null, lastOrder: null })
    try {
      const bundle = await accountBundle(scope, accountId)
      if (token !== generation) return
      publish({ busy: '', ...bundle })
    } catch (error) {
      if (token !== generation) return
      publish({ busy: '', ...fail(error) })
    }
  }

  /**
   * 连接 FTShare 数据：取一次令牌看通道是否可用。三方插件第一次调用时宿主会弹用户授权，
   * 打开面板（bind → autoStart）与用户点「连接数据」都走这里；拒绝只更新数据源徽标。
   */
  async function connectData(): Promise<void> {
    const scope = owner
    if (!alive || scope === undefined) return
    const token = ++generation
    publish({ busy: 'data', errorCode: '' })
    try {
      const dataSource = await unwrap(scope, scope.port.connectData())
      if (token !== generation) return
      publish({ busy: '', dataSource })
      if (dataSource.state === 'live' && snapshot.quote === null) void loadQuote(snapshot.symbol)
    } catch (error) {
      if (token !== generation) return
      publish({ busy: '', ...fail(error) })
    }
  }

  /** 查询报价；`symbol` 可以是六位代码或带交易所后缀的形式。 */
  async function loadQuote(symbol: string): Promise<void> {
    const scope = owner
    if (!alive || scope === undefined) return
    const canonical = canonicalId(symbol)
    if (canonical === null) {
      publish({ errorCode: 'INVALID_SYMBOL', quote: null, preview: null })
      return
    }
    const token = ++quoteGeneration
    publish({ symbol: displayCode(canonical), quoteBusy: true, errorCode: '', errorMessage: '', preview: null })
    try {
      const result = await unwrap(scope, scope.port.rpc('market/quote', { symbols: [canonical] }, snapshot.accountId)) as {
        state: string
        quotes: Quote[]
        notice?: string
      }
      if (token !== quoteGeneration) return
      const quote = result.quotes[0]
      if (quote === undefined) {
        publish({ quoteBusy: false, quote: null, errorCode: 'QUOTE_UNAVAILABLE' })
        return
      }
      publish({ quoteBusy: false, quote, quoteSymbol: canonical })
      void loadBars(canonical)
    } catch (error) {
      if (token !== quoteGeneration) return
      publish({ quoteBusy: false, quote: null, ...fail(error) })
    }
  }

  /** 取日 K：`market/bars` 的 `interval` 缺省即日线；失败只影响右栏，不报错到面板。 */
  async function loadBars(canonical: string): Promise<void> {
    const scope = owner
    if (!alive || scope === undefined) return
    const token = ++barsGeneration
    publish({ barsLoading: true, bars: [] })
    try {
      const result = await unwrap(scope, scope.port.rpc('market/bars', { symbol: canonical, limit: 240 }, snapshot.accountId)) as {
        state: string
        bars: Bar[]
      }
      if (token !== barsGeneration) return
      publish({ barsLoading: false, bars: result.bars ?? [] })
    } catch {
      if (token !== barsGeneration) return
      publish({ barsLoading: false, bars: [] })
    }
  }

  /** 委托预览：只读，不改账本；自动预览与手动预览共用，失败不覆盖面板错误。 */
  async function loadPreview(input: OrderDraft): Promise<void> {
    const scope = owner
    if (!alive || scope === undefined) return
    const token = ++previewGeneration
    publish({ previewBusy: true })
    try {
      const preview = await unwrap(scope, scope.port.rpc('order/preview', input, snapshot.accountId)) as PreviewView
      if (token !== previewGeneration) return
      publish({ previewBusy: false, preview })
    } catch {
      if (token !== previewGeneration) return
      publish({ previewBusy: false, preview: null })
    }
  }

  /** 提交委托：成功后重读账户、委托、成交与流水，并把回执留在面板上。 */
  async function submit(input: OrderDraft): Promise<void> {
    const scope = owner
    if (!alive || scope === undefined) return
    const token = ++generation
    publish({ busy: 'order', errorCode: '', errorMessage: '' })
    try {
      const order = await unwrap(scope, scope.port.rpc('order/place', {
        draft: input,
        requestId: crypto.randomUUID(),
      }, snapshot.accountId)) as OrderView
      const bundle = await accountBundle(scope, snapshot.accountId)
      if (token !== generation) return
      publish({ busy: '', ...bundle, lastOrder: order, preview: null })
    } catch (error) {
      if (token !== generation) return
      publish({ busy: '', ...fail(error) })
    }
  }

  /** 撤销挂单。 */
  async function cancel(orderId: string): Promise<void> {
    const scope = owner
    if (!alive || scope === undefined) return
    const token = ++generation
    publish({ busy: 'cancel', errorCode: '', errorMessage: '' })
    try {
      await unwrap(scope, scope.port.rpc('order/cancel', { orderId }, snapshot.accountId))
      const bundle = await accountBundle(scope, snapshot.accountId)
      if (token !== generation) return
      publish({ busy: '', ...bundle })
    } catch (error) {
      if (token !== generation) return
      publish({ busy: '', ...fail(error) })
    }
  }

  /** 复盘；权益曲线来自账本的逐日快照，同时补日终报告与交易配对。 */
  async function loadReview(period: Period = PERIOD): Promise<void> {
    const scope = owner
    if (!alive || scope === undefined) return
    const token = ++reviewGeneration
    publish({ busy: 'review', errorCode: '', errorMessage: '' })
    try {
      const review = await unwrap(scope, scope.port.rpc('review/get', { period }, snapshot.accountId)) as ReviewView
      if (token !== reviewGeneration) return
      publish({ busy: '', review })
      void loadReviewDetail()
    } catch (error) {
      if (token !== reviewGeneration) return
      publish({ busy: '', review: null, ...fail(error) })
    }
  }

  /** 复盘明细：日终报告、交易配对与资金流水；单条失败不影响其它块。 */
  async function loadReviewDetail(): Promise<void> {
    const scope = owner
    if (!alive || scope === undefined) return
    const token = ++detailGeneration
    try {
      const [reviewDaily, roundTrips, cashFlow] = await Promise.all([
        unwrap(scope, scope.port.rpc('review/daily', {}, snapshot.accountId)).catch(() => [] as DayReport[]) as Promise<DayReport[]>,
        unwrap(scope, scope.port.rpc('review/roundtrips', {}, snapshot.accountId)).catch(() => [] as RoundTrip[]) as Promise<RoundTrip[]>,
        unwrap(scope, scope.port.rpc('cash/flow', {}, snapshot.accountId)).catch(() => [] as CashFlowEntry[]) as Promise<CashFlowEntry[]>,
      ])
      if (token !== detailGeneration) return
      publish({ reviewDaily, roundTrips, cashFlow })
    } catch {
      // 明细是加分项：失败时保留空块，不覆盖顶部错误。
    }
  }

  /** 账户对比：净值曲线归一化与排名由界面做，这里只取每账户一行。 */
  async function loadCompare(): Promise<void> {
    const scope = owner
    if (!alive || scope === undefined) return
    const token = ++compareGeneration
    publish({ busy: 'compare', errorCode: '', errorMessage: '' })
    try {
      const compare = await unwrap(scope, scope.port.rpc('compare/get')) as CompareView
      if (token !== compareGeneration) return
      publish({ busy: '', compare })
    } catch (error) {
      if (token !== compareGeneration) return
      publish({ busy: '', compare: null, ...fail(error) })
    }
  }

  /** 行情列表：按板块与页码翻页；同时刷新备选。 */
  async function loadMarket(board: string = snapshot.marketBoard, page: number = snapshot.marketPage): Promise<void> {
    const scope = owner
    if (!alive || scope === undefined) return
    const token = ++marketGeneration
    publish({ marketBusy: true, marketBoard: board, marketPage: page, errorCode: '', errorMessage: '' })
    try {
      const marketList = await unwrap(scope, scope.port.rpc('market/list', { board, page, pageSize: 50 }, snapshot.accountId)) as MarketListResult
      if (token !== marketGeneration) return
      publish({ marketBusy: false, marketList })
    } catch (error) {
      if (token !== marketGeneration) return
      publish({ marketBusy: false, ...fail(error) })
    }
  }

  /** 搜代码/名称，结果留在快照里给下拉列表。 */
  async function searchMarket(query: string): Promise<void> {
    const scope = owner
    if (!alive || scope === undefined) return
    const trimmed = query.trim()
    if (trimmed === '') {
      publish({ marketHits: [] })
      return
    }
    try {
      const marketHits = await unwrap(scope, scope.port.rpc('market/search', { query: trimmed, limit: 10 }, snapshot.accountId)) as SymbolHit[]
      publish({ marketHits })
    } catch {
      publish({ marketHits: [] })
    }
  }

  /** 读备选；失败时保持原样。 */
  async function loadShortlist(): Promise<void> {
    const scope = owner
    if (!alive || scope === undefined) return
    try {
      const view = await unwrap(scope, scope.port.rpc('shortlist/get', {}, snapshot.accountId)) as { symbols: string[] }
      publish({ shortlist: view.symbols })
    } catch {
      // 备选是加分项。
    }
  }

  /** 加/去备选；乐观更新后以服务端返回为准。 */
  async function toggleShortlist(symbol: string): Promise<void> {
    const scope = owner
    if (!alive || scope === undefined) return
    const next = snapshot.shortlist.includes(symbol)
      ? snapshot.shortlist.filter(item => item !== symbol)
      : [...snapshot.shortlist, symbol]
    publish({ shortlist: next })
    try {
      const view = await unwrap(scope, scope.port.rpc('shortlist/set', { symbols: next }, snapshot.accountId)) as { symbols: string[] }
      publish({ shortlist: view.symbols })
    } catch (error) {
      publish({ shortlist: snapshot.shortlist, ...fail(error) })
    }
  }

  /** 从行情行/搜索结果把标的带进交易页。 */
  async function adoptSymbol(symbol: string): Promise<void> {
    if (!alive) return
    publish({ tab: 'trade', marketHits: [] })
    await loadQuote(symbol)
  }

  /** 注资/提款：金额单位元；成功后重读账户与流水。返回空串表示成功。 */
  async function moveCash(kind: 'deposit' | 'withdraw', amount: number): Promise<string> {
    const scope = owner
    if (!alive || scope === undefined) return 'paper-trading/unavailable'
    const token = ++generation
    publish({ busy: 'cash', errorCode: '', errorMessage: '' })
    try {
      await unwrap(scope, scope.port.rpc(kind === 'deposit' ? 'account/deposit' : 'account/withdraw', { amount }, snapshot.accountId))
      const [account, cashFlow] = await Promise.all([
        unwrap(scope, scope.port.rpc('account/get', {}, snapshot.accountId)) as Promise<AccountView>,
        unwrap(scope, scope.port.rpc('cash/flow', {}, snapshot.accountId)) as Promise<CashFlowEntry[]>,
      ])
      if (token !== generation) return ''
      publish({ busy: '', account, cashFlow })
      return ''
    } catch (error) {
      if (token !== generation) return ''
      const patch = fail(error)
      publish({ busy: '', ...patch })
      return patch.errorCode
    }
  }

  /** 账本快照列表（恢复点）。 */
  async function loadLedger(): Promise<string> {
    const scope = owner
    if (!alive || scope === undefined) return 'paper-trading/unavailable'
    const token = ++generation
    publish({ busy: 'ledger', errorCode: '', errorMessage: '' })
    try {
      const ledger = await unwrap(scope, scope.port.rpc('ledger/list', {}, snapshot.accountId)) as LedgerSnapshotsView
      if (token !== generation) return ''
      publish({ busy: '', ledger })
      return ''
    } catch (error) {
      if (token !== generation) return ''
      const patch = fail(error)
      publish({ busy: '', ...patch })
      return patch.errorCode
    }
  }

  /** 立即备份账本，并刷新快照列表。 */
  async function backupLedger(): Promise<string> {
    const scope = owner
    if (!alive || scope === undefined) return 'paper-trading/unavailable'
    try {
      await unwrap(scope, scope.port.rpc('ledger/backup', {}, snapshot.accountId))
      await loadLedger()
      return ''
    } catch (error) {
      const patch = fail(error)
      publish({ ...patch })
      return patch.errorCode
    }
  }

  /** 从快照恢复账本；恢复后重读账户。 */
  async function restoreLedger(name: string): Promise<string> {
    const scope = owner
    if (!alive || scope === undefined) return 'paper-trading/unavailable'
    const token = ++generation
    publish({ busy: 'ledger', errorCode: '', errorMessage: '' })
    try {
      await unwrap(scope, scope.port.rpc('ledger/restore', { name, confirm: true }, snapshot.accountId))
      const bundle = await accountBundle(scope, snapshot.accountId)
      if (token !== generation) return ''
      publish({ busy: '', ...bundle })
      await loadLedger()
      return ''
    } catch (error) {
      if (token !== generation) return ''
      const patch = fail(error)
      publish({ busy: '', ...patch })
      return patch.errorCode
    }
  }

  /** 导出账本原始 JSONL，供锁账或故障排查。 */
  async function exportLedger(): Promise<string> {
    const scope = owner
    if (!alive || scope === undefined) return 'paper-trading/unavailable'
    const token = ++generation
    publish({ busy: 'ledger', errorCode: '', errorMessage: '' })
    try {
      const ledgerExport = await unwrap(scope, scope.port.rpc('account/export', {}, snapshot.accountId)) as LedgerExport
      if (token !== generation) return ''
      publish({ busy: '', ledgerExport })
      return ''
    } catch (error) {
      if (token !== generation) return ''
      const patch = fail(error)
      publish({ busy: '', ...patch })
      return patch.errorCode
    }
  }

  /** 重置当前账户，可指定新的初始资金（元）。 */
  async function resetAccount(initialCash?: number): Promise<string> {
    const scope = owner
    if (!alive || scope === undefined) return 'paper-trading/unavailable'
    const token = ++generation
    publish({ busy: 'ledger', errorCode: '', errorMessage: '', lastOrder: null, preview: null })
    try {
      await unwrap(scope, scope.port.rpc('account/reset', {
        confirm: true,
        ...(initialCash === undefined ? {} : { initialCash }),
      }, snapshot.accountId))
      const bundle = await accountBundle(scope, snapshot.accountId)
      if (token !== generation) return ''
      publish({ busy: '', ...bundle })
      await loadLedger()
      return ''
    } catch (error) {
      if (token !== generation) return ''
      const patch = fail(error)
      publish({ busy: '', ...patch })
      return patch.errorCode
    }
  }

  /** 新建股票账户；成功后重读账户列表并切到新账户。 */
  async function createAccount(name: string, initialCash?: number): Promise<string> {
    const scope = owner
    if (!alive || scope === undefined) return 'paper-trading/unavailable'
    const token = ++generation
    publish({ busy: 'accounts', errorCode: '', errorMessage: '' })
    try {
      const meta = await unwrap(scope, scope.port.rpc('accounts/create', {
        name,
        ...(initialCash === undefined ? {} : { initialCash }),
      })) as { id: string }
      if (token !== generation) return ''
      await reloadAccounts(scope)
      await switchAccount(meta.id)
      return ''
    } catch (error) {
      if (token !== generation) return ''
      const patch = fail(error)
      publish({ busy: '', ...patch })
      return patch.errorCode
    }
  }

  /** 账户改名、归档/恢复、锁定/解锁：成功后重读账户列表与当前账户。 */
  async function mutateAccount(endpoint: string, payload: unknown): Promise<string> {
    const scope = owner
    if (!alive || scope === undefined) return 'paper-trading/unavailable'
    const token = ++generation
    publish({ busy: 'accounts', errorCode: '', errorMessage: '' })
    try {
      await unwrap(scope, scope.port.rpc(endpoint, payload))
      if (token !== generation) return ''
      await refresh()
      return ''
    } catch (error) {
      if (token !== generation) return ''
      const patch = fail(error)
      publish({ busy: '', ...patch })
      return patch.errorCode
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      if (!alive) return () => {}
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    bind(port: PaperTradingPort) {
      if (!alive) return () => {}
      const registration = { port }
      owner = registration
      publish({ ready: true })
      // 打开页面就取默认标的：先读账本，再尝试连接数据（未授权/未登录时只更新徽标，不弹错误）。
      void refresh().then(() => autoStart())
      return () => {
        if (!alive || owner !== registration) return
        owner = undefined
        generation += 1
        publish({ ready: false, busy: '', preview: null, bars: [], barsLoading: false, ledger: null, ledgerExport: null })
      }
    },
    setTab(tab: TabKey) {
      if (!alive || snapshot.tab === tab) return
      publish({ tab })
      if (tab === 'review' && snapshot.review === null) void loadReview()
      if (tab === 'compare' && snapshot.compare === null) void loadCompare()
      if (tab === 'market') {
        void loadShortlist()
        void loadMarket()
      }
    },
    setSymbol(symbol: string) {
      if (!alive) return
      publish({ symbol })
    },
    refresh,
    switchAccount,
    connectData,
    loadQuote,
    loadBars,
    loadPreview,
    submit,
    cancel,
    loadReview,
    loadReviewDetail,
    loadCompare,
    loadMarket,
    searchMarket,
    loadShortlist,
    toggleShortlist,
    adoptSymbol,
    deposit: (amount: number) => moveCash('deposit', amount),
    withdraw: (amount: number) => moveCash('withdraw', amount),
    loadLedger,
    backupLedger,
    restoreLedger,
    exportLedger,
    resetAccount,
    createAccount,
    renameAccount: (id: string, name: string) => mutateAccount('accounts/rename', { id, name }),
    archiveAccount: (id: string) => mutateAccount('accounts/archive', { id }),
    unarchiveAccount: (id: string) => mutateAccount('accounts/unarchive', { id }),
    lockAccount: (id: string) => mutateAccount('accounts/lock', { id }),
    unlockAccount: (id: string) => mutateAccount('accounts/unlock', { id }),
    dispose() {
      alive = false
      owner = undefined
      listeners.clear()
    },
  }
}
