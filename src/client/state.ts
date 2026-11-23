/**
 * 界面状态：与 remote 绑定，持有账户、委托、报价、预览与复盘。
 *
 * 数据来源与 dsh 面板同一套 RPC 端点（`accounts/list`、`account/get`、`list/orders`、
 * `market/quote`、`order/preview`、`order/place`、`order/cancel`、`review/get`），
 * 只认 Promise 形式的端口，不直接接触 `ctx`。状态属于本次 apply，撤销后旧请求的结果
 * 不再交给界面。
 * @module plugin-paper-trading/client/state
 */

import type {
  AccountView, AccountsView, Bar, DataSourceView, OrderDraft, OrderView, Period, PreviewView,
  Quote, ReviewView, TabKey,
} from 'plugin-paper-trading/types'

/** remote 调用的结果信封（与 `@ftai/plugin-sdk/remote` 的 `RemoteResult` 同形）。 */
type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly code: string } }

/** 宿主一半暴露给界面的端口。 */
export interface PaperTradingPort {
  rpc(endpoint: string, payload?: unknown, account?: string): Promise<Result<unknown>>
  connectData(): Promise<Result<DataSourceView>>
  dataSource(): Promise<Result<DataSourceView>>
}

export interface BoardSnapshot {
  ready: boolean
  /** 正在做的操作（`board` / `quote` / `preview` / `order` / `cancel` / `review` / `data`），空串表示空闲。 */
  busy: string
  /** 最近一次失败的稳定错误码；空串表示没有错误。 */
  errorCode: string
  tab: TabKey
  accounts: AccountsView | null
  /** 当前股票账户 id。 */
  accountId: string
  account: AccountView | null
  orders: OrderView[]
  /** 输入的六位代码。 */
  symbol: string
  /** 最近一次查询到的报价与它的 canonical id。 */
  quote: Quote | null
  quoteSymbol: string
  preview: PreviewView | null
  review: ReviewView | null
  dataSource: DataSourceView | null
  /** 最近一次成功的委托（用于界面提示，不参与业务状态）。 */
  lastOrder: OrderView | null
  /** 当前标的的日 K（来自 `market/bars`）；空数组表示还没取到。 */
  bars: Bar[]
  barsLoading: boolean
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
    ready: false, busy: '', errorCode: '', tab: 'trade',
    accounts: null, accountId: '', account: null, orders: [],
    symbol: DEFAULT_SYMBOL, quote: null, quoteSymbol: '', preview: null,
    review: null, dataSource: null, lastOrder: null, bars: [], barsLoading: false,
  }
  let alive = true
  let owner: { port: PaperTradingPort } | undefined
  /** 每次读数据自增；旧代响应回来时直接丢弃。 */
  let generation = 0
  /** K 线单独计代：查询报价后异步补 K 线，不能把报价/预览的代际打乱。 */
  let barsGeneration = 0

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

  async function unwrap<T>(scope: { port: PaperTradingPort }, pending: Promise<Result<T>>): Promise<T> {
    const result = await pending
    if (!result.ok) throw Object.assign(new Error(result.error.code), { code: result.error.code })
    if (!alive || owner !== scope) throw new Error('paper-trading/stale')
    return result.value
  }

  /**
   * 开场初始化：探测/建立 FTShare 数据连接，可用时自动查询默认标的并补 K 线。
   * 首次打开若还没授权，宿主会弹一次授权框；拒绝只体现在数据源徽标上，不挡账本页面。
   */
  async function autoStart(): Promise<void> {
    const scope = owner
    if (!alive || scope === undefined) return
    const token = ++generation
    publish({ busy: 'data' })
    try {
      const dataSource = await unwrap(scope, scope.port.connectData())
      if (token !== generation) return
      publish({ dataSource })
      if (dataSource.state === 'live') {
        publish({ busy: '' })
        await loadQuote(snapshot.symbol === '' ? DEFAULT_SYMBOL : snapshot.symbol)
      } else {
        publish({ busy: '' })
      }
    } catch {
      if (token !== generation) return
      publish({ busy: '' })
    }
  }

  /** 读账户列表、当前账户与委托；第一次进入时选中默认股票账户。 */
  async function refresh(): Promise<void> {
    const scope = owner
    if (!alive || scope === undefined) return
    const token = ++generation
    publish({ busy: 'board', errorCode: '' })
    try {
      const accounts = await unwrap(scope, scope.port.rpc('accounts/list')) as AccountsView
      const stocks = accounts.accounts.filter(meta => meta.kind === 'stock' && !meta.archived)
      const current = stocks.find(meta => meta.id === snapshot.accountId) ?? stocks.find(meta => meta.id === accounts.defaultIds.stock) ?? stocks[0]
      if (current === undefined) throw Object.assign(new Error('paper-trading/account-not-found'), { code: 'paper-trading/account-not-found' })
      const [account, orders] = await Promise.all([
        unwrap(scope, scope.port.rpc('account/get', {}, current.id)) as Promise<AccountView>,
        unwrap(scope, scope.port.rpc('list/orders', {}, current.id)) as Promise<OrderView[]>,
      ])
      if (token !== generation) return
      publish({ ready: true, busy: '', accounts, accountId: current.id, account, orders })
    } catch (error) {
      if (token !== generation) return
      publish({ ready: true, busy: '', errorCode: failure(error) })
    }
  }

  /** 切换账户：只重读当前账户与委托，不动报价与预览。 */
  async function switchAccount(accountId: string): Promise<void> {
    const scope = owner
    if (!alive || scope === undefined || accountId === snapshot.accountId) return
    const token = ++generation
    publish({ accountId, busy: 'board', errorCode: '', preview: null, review: null })
    try {
      const [account, orders] = await Promise.all([
        unwrap(scope, scope.port.rpc('account/get', {}, accountId)) as Promise<AccountView>,
        unwrap(scope, scope.port.rpc('list/orders', {}, accountId)) as Promise<OrderView[]>,
      ])
      if (token !== generation) return
      publish({ busy: '', account, orders })
    } catch (error) {
      if (token !== generation) return
      publish({ busy: '', errorCode: failure(error) })
    }
  }

  /**
   * 连接 FTShare 数据：取一次令牌看通道是否可用。三方插件第一次调用时宿主会弹用户授权，
   * 所以只在用户点「连接数据」时调用，不在页面打开时自动触发。
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
      publish({ busy: '', errorCode: failure(error) })
    }
  }

  /** 查询报价；`symbol` 可以是六位代码或带交易所后缀的形式。 */
  async function loadQuote(symbol: string): Promise<void> {
    const scope = owner
    if (!alive || scope === undefined) return
    const canonical = canonicalId(symbol)
    if (canonical === null) {
      publish({ errorCode: 'paper-trading/unknown-symbol', quote: null })
      return
    }
    const token = ++generation
    publish({ symbol: displayCode(canonical), busy: 'quote', errorCode: '', preview: null })
    try {
      const result = await unwrap(scope, scope.port.rpc('market/quote', { symbols: [canonical] }, snapshot.accountId)) as {
        state: string
        quotes: Quote[]
        notice?: string
      }
      if (token !== generation) return
      const quote = result.quotes[0]
      if (quote === undefined) {
        publish({ busy: '', quote: null, errorCode: 'paper-trading/data-unavailable' })
        return
      }
      publish({ busy: '', quote, quoteSymbol: canonical })
      void loadBars(canonical)
    } catch (error) {
      if (token !== generation) return
      publish({ busy: '', quote: null, errorCode: failure(error) })
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

  /** 委托预览：只读，不改账本。 */
  async function loadPreview(input: OrderDraft): Promise<void> {
    const scope = owner
    if (!alive || scope === undefined) return
    const token = ++generation
    publish({ busy: 'preview', errorCode: '' })
    try {
      const preview = await unwrap(scope, scope.port.rpc('order/preview', input, snapshot.accountId)) as PreviewView
      if (token !== generation) return
      publish({ busy: '', preview })
    } catch (error) {
      if (token !== generation) return
      publish({ busy: '', preview: null, errorCode: failure(error) })
    }
  }

  /** 提交委托：成功后重读账户与委托。 */
  async function submit(input: OrderDraft): Promise<void> {
    const scope = owner
    if (!alive || scope === undefined) return
    const token = ++generation
    publish({ busy: 'order', errorCode: '' })
    try {
      const order = await unwrap(scope, scope.port.rpc('order/place', {
        draft: input,
        requestId: crypto.randomUUID(),
      }, snapshot.accountId)) as OrderView
      const [account, orders] = await Promise.all([
        unwrap(scope, scope.port.rpc('account/get', {}, snapshot.accountId)) as Promise<AccountView>,
        unwrap(scope, scope.port.rpc('list/orders', {}, snapshot.accountId)) as Promise<OrderView[]>,
      ])
      if (token !== generation) return
      publish({ busy: '', account, orders, lastOrder: order, preview: null })
    } catch (error) {
      if (token !== generation) return
      publish({ busy: '', errorCode: failure(error) })
    }
  }

  /** 撤销挂单。 */
  async function cancel(orderId: string): Promise<void> {
    const scope = owner
    if (!alive || scope === undefined) return
    const token = ++generation
    publish({ busy: 'cancel', errorCode: '' })
    try {
      await unwrap(scope, scope.port.rpc('order/cancel', { orderId }, snapshot.accountId))
      const [account, orders] = await Promise.all([
        unwrap(scope, scope.port.rpc('account/get', {}, snapshot.accountId)) as Promise<AccountView>,
        unwrap(scope, scope.port.rpc('list/orders', {}, snapshot.accountId)) as Promise<OrderView[]>,
      ])
      if (token !== generation) return
      publish({ busy: '', account, orders })
    } catch (error) {
      if (token !== generation) return
      publish({ busy: '', errorCode: failure(error) })
    }
  }

  /** 复盘；权益曲线来自账本的逐日快照。 */
  async function loadReview(period: Period = PERIOD): Promise<void> {
    const scope = owner
    if (!alive || scope === undefined) return
    const token = ++generation
    publish({ busy: 'review', errorCode: '' })
    try {
      const review = await unwrap(scope, scope.port.rpc('review/get', { period }, snapshot.accountId)) as ReviewView
      if (token !== generation) return
      publish({ busy: '', review })
    } catch (error) {
      if (token !== generation) return
      publish({ busy: '', review: null, errorCode: failure(error) })
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
        publish({ ready: false, busy: '', preview: null, bars: [], barsLoading: false })
      }
    },
    setTab(tab: TabKey) {
      if (!alive || snapshot.tab === tab) return
      publish({ tab })
      if (tab === 'review' && snapshot.review === null) void loadReview()
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
    dispose() {
      alive = false
      owner = undefined
      listeners.clear()
    },
  }
}
