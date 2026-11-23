import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  Button, Input, SettingsGroup, SettingsPage, SettingsRow, StockChart, useMessages, useShellNotice,
  type AppPreferences,
} from '@ftai/plugin-sdk/app'
import type { StockChartCandle, StockChartSeries } from '@ftai/plugin-sdk/app'
import Decimal from 'decimal.js'
import type { MessageScope } from '@ftai/plugin-sdk/features'
import { IconAlertTriangle, IconChartCandle, IconChevronLeft, IconChevronRight, IconRefresh } from '@tabler/icons-react'
import type {
  Bar, DataSourceView, OrderDraft, OrderView, PositionView, PreviewView, Quote, ReviewView, TabKey,
} from '@clrstn2830h/plugin-paper-trading/types'
import { canonicalId, type Board } from './state.ts'

const TABS: readonly TabKey[] = ['trade', 'positions', 'orders', 'review']
const SIDES: readonly ('buy' | 'sell')[] = ['buy', 'sell']
const TYPES: readonly ('market' | 'limit')[] = ['market', 'limit']
const PERIODS: readonly ('7d' | '30d' | 'all')[] = ['7d', '30d', 'all']
/** 已成交、已撤、已过期等状态不能再撤单。 */
const CANCELABLE = new Set(['queued', 'pending', 'partially_filled'])

/** 组件只在 apply 里创建一次；订阅与快照在这一代内稳定。 */
export function createViews(messages: MessageScope, board: Board, prefs?: AppPreferences) {
  function useBoard() {
    return useSyncExternalStore(board.subscribe, board.getSnapshot, board.getSnapshot)
  }

  function useMoney() {
    const { n } = useMessages(messages)
    return (value: number) => n(value, { style: 'currency', currency: 'CNY', minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  function dataSourceLabel(t: MessageScope['t'], source: DataSourceView | null): string {
    switch (source?.state) {
      case 'live': return t('dataSource.live')
      case 'signed-out': return t('dataSource.signedOut')
      case 'not-allowed': return t('dataSource.notAllowed')
      case 'unavailable': return t('dataSource.unavailable')
      default: return t('dataSource.stub')
    }
  }

  function errorText(t: MessageScope['t'], code: string): string {
    if (code === '') return ''
    switch (code) {
      case 'paper-trading/invalid-argument': return t('errors.invalidArgument')
      case 'paper-trading/unknown-symbol': return t('errors.invalidSymbol')
      case 'paper-trading/account-not-found': return t('errors.accountNotFound')
      case 'paper-trading/data-unavailable': return t('errors.dataUnavailable')
      case 'paper-trading/rpc-failed': return t('errors.rpcFailed')
      case 'ftshare/signed-out': return t('errors.signedOut')
      case 'ftshare/not-allowed': return t('errors.notAllowed')
      case 'ftshare/unavailable': return t('errors.dataUnavailable')
      default: return t('errors.unknown')
    }
  }

  function Dashboard() {
    const { t, n, d } = useMessages(messages)
    const money = useMoney()
    const snapshot = useBoard()
    const notice = useShellNotice()
    const [side, setSide] = useState<'buy' | 'sell'>('buy')
    const [type, setType] = useState<'market' | 'limit'>('market')
    const [qty, setQty] = useState('100')
    const [limitPrice, setLimitPrice] = useState('')
    const [railOpen, setRailOpen] = useState(true)
    const [railWidth, setRailWidth] = useState(360)
    const [dragging, setDragging] = useState(false)
    const resizeStart = useRef<{ x: number; width: number } | null>(null)

    useEffect(() => {
      let alive = true
      void prefs?.get('railWidth', 360).then(value => {
        if (alive && typeof value === 'number' && Number.isFinite(value)) setRailWidth(clampRailWidth(value))
      })
      void prefs?.get('railCollapsed', false).then(value => {
        if (alive && typeof value === 'boolean') setRailOpen(!value)
      })
      return () => { alive = false }
    }, [])
    const account = snapshot.account
    const quote = snapshot.quote
    const preview = snapshot.preview

    const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
      if (!railOpen) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      resizeStart.current = { x: event.clientX, width: railWidth }
      setDragging(true)
    }
    const moveResize = (event: React.PointerEvent<HTMLDivElement>) => {
      const start = resizeStart.current
      if (start === null) return
      setRailWidth(clampRailWidth(start.width - (event.clientX - start.x)))
    }
    const endResize = () => {
      if (resizeStart.current === null) return
      resizeStart.current = null
      setDragging(false)
      void prefs?.set('railWidth', railWidth)
    }
    const toggleRail = () => {
      const next = !railOpen
      setRailOpen(next)
      void prefs?.set('railCollapsed', !next)
    }

    const draft = (): OrderDraft => ({
      symbol: canonicalId(snapshot.quoteSymbol === '' ? snapshot.symbol : snapshot.quoteSymbol) ?? snapshot.symbol,
      side,
      type,
      qty: Number(qty),
      ...(type === 'limit' && limitPrice !== '' ? { limitPrice: Number(limitPrice) } : {}),
    })

    const submit = async () => {
      const current = draft()
      await board.submit(current)
      const error = board.getSnapshot().errorCode
      notice.showNotice(error === '' ? 'success' : 'error', error === '' ? t('trade.submitted') : errorText(t, error))
    }

    const tabContent = () => {
      if (account === null) {
        if (snapshot.errorCode !== '') {
          return <div className="paper-trading-empty" role="alert">
            <IconAlertTriangle className="paper-trading-icon" />
            <span>{errorText(t, snapshot.errorCode)}</span>
            <Button variant="outline" size="sm" onClick={() => void board.refresh()}>{t('actions.retry')}</Button>
          </div>
        }
        return <div className="paper-trading-empty">{t('loading')}</div>
      }
      switch (snapshot.tab) {
        case 'trade':
          return <>
            <div className="paper-trading-trade">
              <div className="paper-trading-form-card">
                <div className="paper-trading-form">
              <Field label={t('trade.symbol')} htmlFor="paper-symbol" className="paper-trading-span-2">
                <div className="paper-trading-symbol-row">
                  <Input id="paper-symbol" value={snapshot.symbol} inputMode="numeric" maxLength={6}
                    onChange={event => board.setSymbol(event.target.value)}
                    onKeyDown={event => { if (event.key === 'Enter') void board.loadQuote(snapshot.symbol) }} />
                  <Button variant="outline" size="sm" className="paper-trading-query"
                    onClick={() => void board.loadQuote(snapshot.symbol)}>{t('trade.query')}</Button>
                </div>
              </Field>
              <Field label={t('trade.side')}>
                <Segmented ariaLabel={t('trade.side')} value={side}
                  options={SIDES.map(value => ({ value, label: t(`side.${value}`) }))} onChange={setSide} />
              </Field>
              <Field label={t('trade.type')}>
                <Segmented ariaLabel={t('trade.type')} value={type}
                  options={TYPES.map(value => ({ value, label: t(`orderType.${value}`) }))} onChange={setType} />
              </Field>
              <Field label={t('trade.qty')} htmlFor="paper-qty">
                <Input id="paper-qty" value={qty} inputMode="numeric" onChange={event => setQty(event.target.value)} />
              </Field>
              <Field label={t('trade.limitPrice')} htmlFor="paper-limit">
                <Input id="paper-limit" inputMode="decimal" value={type === 'limit' ? limitPrice : ''}
                  disabled={type !== 'limit'}
                  {...(type === 'limit' ? {} : { placeholder: t('trade.marketHint') })}
                  onChange={event => setLimitPrice(event.target.value)} />
              </Field>
              <div className="paper-trading-actions">
                <Button variant="outline" size="sm" disabled={snapshot.busy !== ''}
                  onClick={() => void board.loadPreview(draft())}>{t('trade.preview')}</Button>
                <Button size="sm" disabled={snapshot.busy !== '' || quote === null}
                  onClick={() => void submit()}>{t('trade.submit')}</Button>
                </div>
                </div>
              </div>
              <div className="paper-trading-trade-side">
                <QuoteBlock quote={quote} money={money} t={t} d={d} />
                <PreviewBlock preview={preview} money={money} t={t} />
              </div>
            </div>
            <OrdersTable orders={snapshot.orders.slice(0, 5)} money={money} t={t} n={n} d={d}
              onCancel={id => void board.cancel(id)} busy={snapshot.busy !== ''} />
          </>
        case 'positions':
          return <PositionsTable positions={account.positions} money={money} t={t} n={n} />
        case 'orders':
          return <OrdersTable orders={snapshot.orders} money={money} t={t} n={n} d={d}
            onCancel={id => void board.cancel(id)} busy={snapshot.busy !== ''} />
        case 'review': {
          const review = snapshot.review
          return <>
            <div className="paper-trading-tabs" role="group" aria-label={t('review.period')}>
              {PERIODS.map(period => <Button key={period} size="xs" variant="ghost"
                onClick={() => void board.loadReview(period)}>{t(`review.period${period}`)}</Button>)}
            </div>
            <ReviewBlock review={review} money={money} t={t} n={n} loading={snapshot.busy === 'review'} />
          </>
        }
      }
    }

    return <div className={dragging ? 'paper-trading-page is-resizing' : 'paper-trading-page'}>
      <header className="paper-trading-header">
        <div className="paper-trading-header-text">
          <div className="paper-trading-header-meta">
            {snapshot.accounts !== null && snapshot.accounts.accounts.some(meta => meta.kind === 'stock' && !meta.archived) &&
              <label className="paper-trading-account-picker">
                <span className="paper-trading-note">{t('account.picker')}</span>
                <select className="paper-trading-select" value={snapshot.accountId} disabled={snapshot.busy !== ''}
                  onChange={event => void board.switchAccount(event.target.value)}>
                  {snapshot.accounts.accounts.filter(meta => meta.kind === 'stock' && !meta.archived)
                    .map(meta => <option key={meta.id} value={meta.id}>{meta.name}</option>)}
                </select>
              </label>}
            <div className="paper-trading-badge" data-state={snapshot.dataSource?.state ?? 'stub'}>
              {dataSourceLabel(t, snapshot.dataSource)}
            </div>
          </div>
          <span className="paper-trading-subtitle">{t('subtitle')}</span>
        </div>
        <div className="paper-trading-header-actions">
          {snapshot.dataSource?.state !== 'live' && <Button variant="outline" size="sm"
            disabled={snapshot.busy !== ''} onClick={() => void board.connectData()}>
            {snapshot.dataSource === null ? t('actions.connectData') : t('actions.reconnectData')}
          </Button>}
          <Button variant="ghost" size="sm" onClick={() => void board.refresh()} disabled={snapshot.busy !== ''}>
            <IconRefresh className="paper-trading-icon" />{t('actions.refresh')}
          </Button>
        </div>
      </header>
      <section className="paper-trading-stats">
        <Stat label={t('account.totalAssets')} value={account ? money(account.equity) : '—'} />
        <Stat label={t('account.cash')} value={account ? money(account.cash) : '—'} />
        <Stat label={t('account.marketValue')} value={account ? money(account.marketValue) : '—'} />
        <Stat label={t('account.dayPnl')} value={account ? money(account.todayPnl) : '—'} tone={account?.todayPnl} />
        <Stat label={t('account.totalPnl')} value={account ? money(account.pnl) : '—'} tone={account?.pnl} />
      </section>
      <div className="paper-trading-body">
        <div className="paper-trading-main">
          <div className="paper-trading-tabs" role="tablist" aria-label={t('tabs.label')}>
            {TABS.map(tab => <Button key={tab} size="xs" variant={snapshot.tab === tab ? 'secondary' : 'ghost'}
              role="tab" aria-selected={snapshot.tab === tab} onClick={() => board.setTab(tab)}>{t(`tabs.${tab}`)}</Button>)}
          </div>
          <div className="paper-trading-content">
            {snapshot.errorCode !== '' && snapshot.account !== null && <div className="paper-trading-error" role="alert">
              <IconAlertTriangle className="paper-trading-icon" /><span>{errorText(t, snapshot.errorCode)}</span>
            </div>}
            {tabContent()}
          </div>
        </div>
        {railOpen && <div className="paper-trading-rail-resizer" role="separator" aria-orientation="vertical"
          aria-label={t('rail.resize')}
          onPointerDown={startResize} onPointerMove={moveResize} onPointerUp={endResize} onPointerCancel={endResize} />}
        <aside className={railOpen ? 'paper-trading-rail' : 'paper-trading-rail paper-trading-rail-collapsed'}
          style={{ width: railOpen ? `${railWidth}px` : '40px' }} aria-label={t('rail.label')}>
          <Button variant="ghost" size="icon-2xs" className="paper-trading-rail-toggle"
            aria-label={railOpen ? t('rail.collapse') : t('rail.expand')}
            onClick={toggleRail}>
            {railOpen ? <IconChevronRight className="paper-trading-icon" /> : <IconChevronLeft className="paper-trading-icon" />}
          </Button>
          {!railOpen && <span className="paper-trading-rail-label">{t('rail.label')}</span>}
          {railOpen && <div className="paper-trading-rail-body">
            {snapshot.barsLoading
              ? <div className="paper-trading-empty">{t('rail.loading')}</div>
              : snapshot.bars.length >= 2
                ? <ChartBlock bars={snapshot.bars} quote={quote} t={t} label={t('rail.label')} />
                : <div className="paper-trading-rail-empty">
                  <IconChartCandle className="paper-trading-icon-lg" />
                  <p>{t('rail.placeholder')}</p>
                  <p className="paper-trading-note">{t('rail.hint')}</p>
                </div>}
          </div>}
        </aside>
      </div>
    </div>
  }

  function Settings() {
    const { t } = useMessages(messages)
    const snapshot = useBoard()
    return <SettingsPage title={t('settings.title')} description={t('settings.description')}>
      <SettingsGroup title={t('settings.groupDataSource')}>
        <SettingsRow title={t('settings.dataSourceTitle')} description={t('settings.dataSourceDescription')}
          action={<Button variant="outline" size="sm" disabled={snapshot.busy !== ''}
            onClick={() => void board.connectData()}>{snapshot.dataSource === null ? t('actions.connectData') : t('actions.reconnectData')}</Button>}>
          {dataSourceLabel(t, snapshot.dataSource)}
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup title={t('settings.groupAccount')}>
        <SettingsRow title={t('settings.initialCash')} description={t('settings.initialCashDescription')}>
          {snapshot.account ? snapshot.account.initialCash.toLocaleString() : '—'}
        </SettingsRow>
        <SettingsRow title={t('settings.ledgerTitle')} description={t('settings.ledgerDescription')}>
          {t('settings.ledgerValue')}
        </SettingsRow>
      </SettingsGroup>
    </SettingsPage>
  }

  return { Dashboard, Settings }
}

/**
 * K 线栏宽度范围：220–720px，且给主列至少留约 600px。
 * 窗口本身很窄时下限退到 220，避免拖不出可用的主列。
 */
function clampRailWidth(value: number): number {
  const room = typeof window === 'undefined' ? 720 : window.innerWidth - 620
  return Math.round(Math.min(720, Math.max(220, Math.min(room, value))))
}

/** 共享层的日 K（元、股）→ 图表 K 线（Decimal、成交量手、成交额元）。 */
function candlesOf(bars: readonly Bar[]): StockChartCandle[] {
  const day = 24 * 60 * 60 * 1000
  const candles: StockChartCandle[] = []
  for (const bar of bars) {
    const openTimeMillis = Date.parse(bar.time)
    if (Number.isNaN(openTimeMillis)) continue
    const close = new Decimal(bar.close)
    const volume = new Decimal(bar.volume ?? 0).div(100)
    candles.push({
      openTimeMillis,
      closeTimeMillis: openTimeMillis + day - 1,
      open: new Decimal(bar.open),
      high: new Decimal(bar.high),
      low: new Decimal(bar.low),
      close,
      turnover: close.times(volume).times(100),
      volume,
    })
  }
  return candles
}

/** 右栏日 K：复用应用的公开 `StockChart`，只喂数据，不请求行情。 */
function ChartBlock(props: { bars: readonly Bar[]; quote: Quote | null; t: MessageScope['t']; label: string }) {
  const series = useMemo<StockChartSeries>(() => ({ kind: 'candlesticks', candles: candlesOf(props.bars) }), [props.bars])
  const previousClose = props.quote?.prevClose
  return <div className="paper-trading-rail-chart">
    <StockChart
      series={series}
      description={props.label}
      candleInterval="1d"
      detail
      fill
      candleRangeMenu
      {...(previousClose === undefined ? {} : { previousClose: new Decimal(previousClose) })}
    />
  </div>
}

/** 表单字段：统一的 label + 控件槽位；控件高度由 CSS 统一到 32px。 */
function Field(props: { label: string; htmlFor?: string; className?: string; children?: ReactNode }) {
  return <div className={props.className === undefined ? 'paper-trading-field' : `paper-trading-field ${props.className}`}>
    {props.htmlFor === undefined ? <span>{props.label}</span> : <label htmlFor={props.htmlFor}>{props.label}</label>}
    {props.children}
  </div>
}

/** 二选一分段控件：方向与类型共用同一实现，宽度等分、高度与输入框一致。 */
function Segmented<T extends string>(props: {
  ariaLabel: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return <div className="paper-trading-segmented" role="group" aria-label={props.ariaLabel}>
    {props.options.map(option => <button key={option.value} type="button"
      className="paper-trading-segmented-option" aria-pressed={props.value === option.value}
      onClick={() => props.onChange(option.value)}>{option.label}</button>)}
  </div>
}

function Stat(props: { label: string; value: string; tone?: number | undefined }) {
  const tone = props.tone === undefined || props.tone === 0 ? '' : props.tone > 0 ? 'is-up' : 'is-down'
  return <div className="paper-trading-stat">
    <span>{props.label}</span>
    <strong className={tone}>{props.value}</strong>
  </div>
}

function QuoteBlock(props: { quote: Quote | null; money: (value: number) => string; t: MessageScope['t']; d: MessageScope['d'] }) {
  if (props.quote === null) return <div className="paper-trading-empty">{props.t('trade.queryHint')}</div>
  const quote = props.quote
  const previousClose = quote.prevClose ?? quote.last
  const change = quote.last - previousClose
  // FTShare 的日线载荷不一定带名称：名称与代码相同时只显示一次，避免「代码 代码」。
  const name = quote.name !== undefined && quote.name !== quote.symbol ? quote.name : undefined
  const marketTs = quote.marketTs == null ? undefined : new Date(quote.marketTs)
  return <section className="paper-trading-quote">
    <div className="paper-trading-quote-head">
      {name !== undefined && <strong>{name}</strong>}
      <span className="paper-trading-mono">{quote.symbol}</span>
      {marketTs !== undefined && !Number.isNaN(marketTs.getTime()) &&
        <span className="paper-trading-note">{props.t('quote.marketTs', { ts: props.d(marketTs, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) })}</span>}
    </div>
    <div className="paper-trading-quote-body">
      <span className={change >= 0 ? 'is-up' : 'is-down'}>{props.money(quote.last)}</span>
      <span className={change >= 0 ? 'is-up' : 'is-down'}>{props.t('quote.change', { change: props.money(change) })}</span>
      <span className="paper-trading-note">{props.t('quote.previousClose', { price: props.money(previousClose) })}</span>
    </div>
  </section>
}

function PreviewBlock(props: { preview: PreviewView | null; money: (value: number) => string; t: MessageScope['t'] }) {
  if (props.preview === null) return null
  const preview = props.preview
  const warnings = preview.warnings
  return <section className="paper-trading-preview">
    <div><span>{props.t('preview.price')}</span><strong className="paper-trading-mono">{props.money(preview.price)}</strong></div>
    <div><span>{props.t('preview.amount')}</span><strong className="paper-trading-mono">{props.money(preview.amountCents / 100)}</strong></div>
    <div><span>{props.t('preview.fee')}</span><strong className="paper-trading-mono">{props.money(preview.totalFeesCents / 100)}</strong></div>
    <div><span>{props.t('preview.cashAfter')}</span><strong className="paper-trading-mono">{props.money(preview.cashAfterCents / 100)}</strong></div>
    {warnings.length === 0
      ? <p className="paper-trading-note">{props.t('preview.valid')}</p>
      : <p className="paper-trading-error-text" role="alert">{warnings.join('；')}</p>}
  </section>
}

function OrdersTable(props: {
  orders: readonly OrderView[]
  money: (value: number) => string
  t: MessageScope['t']
  n: MessageScope['n']
  d: MessageScope['d']
  busy: boolean
  onCancel: (orderId: string) => void
}) {
  if (props.orders.length === 0) return <div className="paper-trading-empty">{props.t('orders.empty')}</div>
  return <div className="paper-trading-table-wrap">
    <table className="paper-trading-table">
      <thead><tr>
        <th>{props.t('orders.time')}</th><th>{props.t('orders.symbol')}</th><th>{props.t('orders.side')}</th>
        <th>{props.t('orders.type')}</th><th className="is-num">{props.t('orders.price')}</th>
        <th className="is-num">{props.t('orders.qty')}</th><th className="is-num">{props.t('orders.filled')}</th>
        <th>{props.t('orders.status')}</th><th />
      </tr></thead>
      <tbody>{props.orders.map(order => <tr key={order.id}>
        <td className="is-num">{props.d(new Date(order.createdAt), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
        <td><span className="paper-trading-mono">{order.symbol}</span> {order.name}</td>
        <td className={order.side === 'buy' ? 'is-up' : 'is-down'}>{props.t(`side.${order.side}`)}</td>
        <td>{props.t(`orderType.${order.type}`)}</td>
        <td className="is-num paper-trading-mono">{order.limitPrice === undefined ? '—' : props.money(order.limitPrice)}</td>
        <td className="is-num">{props.n(order.qty)}</td>
        <td className="is-num">{props.n(order.filledQty ?? 0)}</td>
        <td>{statusText(props.t, order.status)}</td>
        <td>{CANCELABLE.has(order.status) && <Button variant="ghost" size="2xs" disabled={props.busy}
          onClick={() => props.onCancel(order.id)}>{props.t('orders.cancel')}</Button>}</td>
      </tr>)}</tbody>
    </table>
  </div>
}

function statusText(t: MessageScope['t'], status: string): string {
  switch (status) {
    case 'queued': return t('orderStatus.queued')
    case 'pending': return t('orderStatus.pending')
    case 'partially_filled': return t('orderStatus.partiallyFilled')
    case 'filled': return t('orderStatus.filled')
    case 'canceled': return t('orderStatus.canceled')
    case 'rejected': return t('orderStatus.rejected')
    case 'expired': return t('orderStatus.expired')
    default: return status
  }
}

function PositionsTable(props: {
  positions: readonly PositionView[]
  money: (value: number) => string
  t: MessageScope['t']
  n: MessageScope['n']
}) {
  if (props.positions.length === 0) return <div className="paper-trading-empty">{props.t('positions.empty')}</div>
  return <div className="paper-trading-table-wrap">
    <table className="paper-trading-table">
      <thead><tr>
        <th>{props.t('positions.symbol')}</th><th className="is-num">{props.t('positions.qty')}</th>
        <th className="is-num">{props.t('positions.available')}</th><th className="is-num">{props.t('positions.avgCost')}</th>
        <th className="is-num">{props.t('positions.lastPrice')}</th><th className="is-num">{props.t('positions.marketValue')}</th>
        <th className="is-num">{props.t('positions.pnl')}</th>
      </tr></thead>
      <tbody>{props.positions.map(position => <tr key={position.symbol}>
        <td><span className="paper-trading-mono">{position.symbol}</span> {position.name}</td>
        <td className="is-num">{props.n(position.qty)}</td>
        <td className="is-num">{props.n(position.available)}</td>
        <td className="is-num paper-trading-mono">{props.money(position.avgCost)}</td>
        <td className="is-num paper-trading-mono">{position.lastPrice === undefined ? '—' : props.money(position.lastPrice)}</td>
        <td className="is-num paper-trading-mono">{position.marketValueCents === undefined ? '—' : props.money(position.marketValueCents / 100)}</td>
        <td className={`is-num paper-trading-mono ${(position.unrealizedPnlCents ?? 0) >= 0 ? 'is-up' : 'is-down'}`}>
          {props.money((position.unrealizedPnlCents ?? 0) / 100)}
        </td>
      </tr>)}</tbody>
    </table>
  </div>
}

function ReviewBlock(props: {
  review: ReviewView | null
  money: (value: number) => string
  t: MessageScope['t']
  n: MessageScope['n']
  loading: boolean
}) {
  if (props.loading && props.review === null) return <div className="paper-trading-empty">{props.t('loading')}</div>
  if (props.review === null) return <div className="paper-trading-empty">{props.t('review.empty')}</div>
  const review = props.review
  const points = review.equityCurve
  const values = points.map(point => point.equity)
  const min = values.length === 0 ? 0 : Math.min(...values)
  const max = values.length === 0 ? 1 : Math.max(...values)
  const span = Math.max(1, max - min)
  const polyline = points.map((point, index) => {
    const x = points.length <= 1 ? 0 : (index / (points.length - 1)) * 600
    const y = 150 - ((point.equity - min) / span) * 140
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return <>
    <section className="paper-trading-stats">
      <Stat label={props.t('review.trades')} value={props.n(review.tradeCount)} />
      <Stat label={props.t('review.realizedPnl')} value={props.money(review.realizedPnl)} tone={review.realizedPnl} />
      <Stat label={props.t('review.maxDrawdown')} value={props.n(review.maxDrawdownPct / 100, { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 })} />
      <Stat label={props.t('review.fees')} value={props.money(review.totalFees)} />
    </section>
    <section className="paper-trading-chart" aria-label={props.t('review.equity')}>
      <div className="paper-trading-chart-scale">
        <span>{props.money(max)}</span>
        <span>{props.money(min)}</span>
      </div>
      <svg viewBox="0 0 600 160" preserveAspectRatio="none" role="img" aria-label={props.t('review.equity')}>
        <polyline points={polyline} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="paper-trading-chart-scale paper-trading-chart-scale-x">
        <span>{points[0]?.date ?? ''}</span>
        <span>{points[points.length - 1]?.date ?? ''}</span>
      </div>
      <p className="paper-trading-note">{props.t('review.equityHint')}</p>
    </section>
  </>
}
