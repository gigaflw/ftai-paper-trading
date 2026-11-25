import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, SettingsGroup,
  SettingsPage, SettingsRow, StockChart, useMessages, useShellNotice, type AppPreferences,
} from '@ftai/plugin-sdk/app'
import type { StockChartCandle, StockChartSeries } from '@ftai/plugin-sdk/app'
import Decimal from 'decimal.js'
import type { MessageScope } from '@ftai/plugin-sdk/features'
import {
  IconAlertTriangle, IconBook, IconChartCandle, IconChevronLeft, IconChevronRight, IconRefresh,
  IconStar, IconStarFilled, IconWallet,
} from '@tabler/icons-react'
import type {
  Bar, CashFlowEntry, CompareRow, DataSourceView, DayReport, FillView, FuturesAccountView,
  FuturesCashFlowEntry, FuturesContractView, FuturesDraft, FuturesFillView, FuturesMarketStatus,
  FuturesOrderView, FuturesPositionView, FuturesPreviewView, FuturesQuoteView, FuturesReviewView,
  FuturesSide, FuturesOffset, FuturesOrderType, FuturesTabKey, MarketStatus, OrderDraft, OrderView,
  PositionView, PreviewView, Quote, ReviewView, RoundTrip, TabKey,
} from '@clrstn2830h/plugin-paper-trading/types'
import { canonicalId, type Board, type BoardSnapshot } from './state.ts'

const TABS: readonly TabKey[] = ['trade', 'positions', 'orders', 'review', 'compare', 'market']
const BOARDS: readonly { value: string; label: string }[] = [
  { value: 'main', label: 'board.main' }, { value: 'all', label: 'board.all' },
  { value: 'star', label: 'board.star' }, { value: 'chi_next', label: 'board.chiNext' },
  { value: 'bjse', label: 'board.bjse' }, { value: 'xshg', label: 'board.xshg' },
  { value: 'xshe', label: 'board.xshe' },
]
const SIDES: readonly ('buy' | 'sell')[] = ['buy', 'sell']
const TYPES: readonly ('market' | 'limit')[] = ['market', 'limit']
const PERIODS: readonly ('7d' | '30d' | 'all')[] = ['7d', '30d', 'all']
const FUTURES_TABS: readonly FuturesTabKey[] = ['trade', 'positions', 'orders', 'review']
const FUTURES_SIDES: readonly FuturesSide[] = ['long', 'short']
const FUTURES_OFFSETS: readonly FuturesOffset[] = ['open', 'close']
const FUTURES_TYPES: readonly FuturesOrderType[] = ['market', 'limit']
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
      case 'INVALID_ARGUMENT': return t('errors.invalidArgument')
      case 'INVALID_SYMBOL': return t('errors.invalidSymbol')
      case 'INVALID_QTY': return t('errors.invalidQty')
      case 'INVALID_LOT': return t('errors.invalidLot')
      case 'INSUFFICIENT_CASH': return t('errors.insufficientCash')
      case 'INSUFFICIENT_POSITION': return t('errors.insufficientPosition')
      case 'T1_LOCKED': return t('errors.t1Locked')
      case 'SESSION_CLOSED': return t('errors.sessionClosed')
      case 'AUCTION_ONLY': return t('errors.auctionOnly')
      case 'PRICE_LIMIT': return t('errors.priceLimit')
      case 'SUSPENDED': return t('errors.suspended')
      case 'QUOTE_UNAVAILABLE': return t('errors.dataUnavailable')
      case 'ORDER_NOT_FOUND': return t('errors.orderNotFound')
      case 'ORDER_NOT_PENDING': return t('errors.orderNotPending')
      case 'ACCOUNT_NOT_FOUND': return t('errors.accountNotFound')
      case 'ACCOUNT_LOCKED': return t('errors.accountLocked')
      case 'ACCOUNT_ARCHIVED': return t('errors.accountArchived')
      case 'ACCOUNT_BLOCKED': return t('errors.accountBlocked')
      case 'LEDGER_RESTORE_FAILED': return t('errors.ledgerRestoreFailed')
      case 'paper-trading/invalid-argument': return t('errors.invalidArgument')
      case 'paper-trading/unknown-symbol': return t('errors.invalidSymbol')
      case 'paper-trading/account-not-found': return t('errors.accountNotFound')
      case 'paper-trading/data-unavailable': return t('errors.dataUnavailable')
      case 'paper-trading/rpc-failed': return t('errors.rpcFailed')
      case 'paper-trading/unavailable': return t('errors.unknown')
      case 'ftshare/signed-out': return t('errors.signedOut')
      case 'ftshare/not-allowed': return t('errors.notAllowed')
      case 'ftshare/unavailable': return t('errors.dataUnavailable')
      default: return t('errors.unknown')
    }
  }

  /** 交易时段 → 文案；数据源未就绪时 status 为 null，不显示。 */
  function sessionText(t: MessageScope['t'], status: MarketStatus | null): string {
    if (status === null) return ''
    switch (status.phase) {
      case 'pre_open': return t('session.preOpen')
      case 'continuous_am': return t('session.continuousAm')
      case 'lunch': return t('session.lunch')
      case 'continuous_pm': return t('session.continuousPm')
      case 'auction_close': return t('session.auctionClose')
      case 'closed': return t('session.closed')
      default: return ''
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
    const [price, setPrice] = useState('')
    const [note, setNote] = useState('')
    const [railOpen, setRailOpen] = useState(true)
    const [railWidth, setRailWidth] = useState(360)
    const [dragging, setDragging] = useState(false)
    const [accountsOpen, setAccountsOpen] = useState(false)
    const [cashOpen, setCashOpen] = useState(false)
    const [ledgerOpen, setLedgerOpen] = useState(false)
    const [futuresCashOpen, setFuturesCashOpen] = useState(false)
    const [futuresLedgerOpen, setFuturesLedgerOpen] = useState(false)
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
    const status = snapshot.status

    // 自动取行情：输入框防抖 400ms；已经有同一标的的报价时不重复取。
    // 输满 6 位仍不认识时也走一次 loadQuote，让面板给出「代码格式不正确」。
    useEffect(() => {
      const canonical = canonicalId(snapshot.symbol)
      if (canonical === null) {
        const trimmed = snapshot.symbol.trim()
        if (trimmed.length < 6) return
        const timer = setTimeout(() => { void board.loadQuote(trimmed) }, 400)
        return () => clearTimeout(timer)
      }
      if (canonical === snapshot.quoteSymbol) return
      const timer = setTimeout(() => { void board.loadQuote(canonical) }, 400)
      return () => clearTimeout(timer)
    }, [snapshot.symbol, snapshot.quoteSymbol])

    const draftSymbol = canonicalId(snapshot.quoteSymbol === '' ? snapshot.symbol : snapshot.quoteSymbol) ?? snapshot.symbol

    // 自动预览：代码/方向/类型/数量/价格/备注变化后 250ms 重算，不再需要「查询」「预览」两个步骤。
    useEffect(() => {
      const canonical = canonicalId(draftSymbol)
      const qtyNumber = Number(qty)
      const limitNumber = Number(limitPrice)
      const priceNumber = Number(price)
      if (canonical === null || !Number.isFinite(qtyNumber) || qtyNumber <= 0) return
      if (type === 'limit' && (!Number.isFinite(limitNumber) || limitNumber <= 0)) return
      if (type === 'market' && quote === null && (!Number.isFinite(priceNumber) || priceNumber <= 0)) return
      const timer = setTimeout(() => {
        void board.loadPreview({
          symbol: canonical,
          side,
          type,
          qty: qtyNumber,
          ...(type === 'limit' ? { limitPrice: limitNumber } : {}),
          ...(type === 'market' && quote === null && priceNumber > 0 ? { price: priceNumber } : {}),
          ...(note.trim() === '' ? {} : { note: note.trim() }),
        })
      }, 250)
      return () => clearTimeout(timer)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [snapshot.accountId, draftSymbol, side, type, qty, limitPrice, price, note, quote?.last])

    const draft = (): OrderDraft => {
      const qtyNumber = Number(qty)
      const limitNumber = Number(limitPrice)
      const priceNumber = Number(price)
      return {
        symbol: draftSymbol,
        side,
        type,
        qty: qtyNumber,
        ...(type === 'limit' ? { limitPrice: limitNumber } : {}),
        ...(type === 'market' && quote === null && priceNumber > 0 ? { price: priceNumber } : {}),
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      }
    }

    const canSubmit = snapshot.busy !== 'order'
      && Number.isFinite(Number(qty)) && Number(qty) > 0
      && (type === 'limit' ? Number(limitPrice) > 0 : (quote !== null || Number(price) > 0))

    const submit = async () => {
      await board.submit(draft())
      const error = board.getSnapshot().errorCode
      notice.showNotice(error === '' ? 'success' : 'error', error === '' ? t('trade.submitted') : errorText(t, error))
    }

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

    /** 与服务端返回的预览比对：输入变了就隐藏旧预览，避免显示过期数字。 */
    const currentPreview = previewFor(snapshot.preview, draftSymbol, side, type, Number(qty))
    const receipt = snapshot.lastOrder !== null && snapshot.lastOrder.symbol === draftSymbol ? snapshot.lastOrder : null

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
                      {snapshot.quoteBusy && <span className="paper-trading-note">{t('trade.loading')}</span>}
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
                  {type === 'market' && quote === null && (
                    <Field label={t('trade.referencePrice')} htmlFor="paper-price" className="paper-trading-span-2">
                      <Input id="paper-price" inputMode="decimal" value={price}
                        placeholder={t('trade.referenceHint')}
                        onChange={event => setPrice(event.target.value)} />
                    </Field>
                  )}
                  <Field label={t('trade.note')} htmlFor="paper-note" className="paper-trading-span-2">
                    <Input id="paper-note" value={note} maxLength={120} placeholder={t('trade.noteHint')}
                      onChange={event => setNote(event.target.value)} />
                  </Field>
                  <div className="paper-trading-actions paper-trading-span-2">
                    <span className="paper-trading-note">{t('trade.autoHint')}</span>
                    <Button size="sm" disabled={!canSubmit} onClick={() => void submit()}>{t('trade.submit')}</Button>
                  </div>
                </div>
              </div>
              <div className="paper-trading-trade-side">
                <QuoteBlock quote={quote} money={money} t={t} d={d} />
                <PreviewBlock preview={currentPreview} busy={snapshot.previewBusy} money={money} t={t} n={n} />
                {receipt !== null && <ReceiptBlock order={receipt} money={money} t={t} n={n} d={d} />}
              </div>
            </div>
            <TradesTable trades={snapshot.trades.slice(0, 5)} money={money} t={t} n={n} d={d} />
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
            <DayReportBlock reports={snapshot.reviewDaily} money={money} t={t} n={n} d={d} />
            <RoundTripsTable rows={snapshot.roundTrips} money={money} t={t} n={n} />
            <section className="paper-trading-trades">
              <h4 className="paper-trading-dialog-subtitle">{t('review.cashTitle')}</h4>
              <CashFlowTable flow={snapshot.cashFlow} money={money} t={t} d={d} />
            </section>
          </>
        }
        case 'compare':
          return <CompareBlock view={snapshot.compare} money={money} t={t} n={n} loading={snapshot.busy === 'compare'} />
        case 'market':
          return <MarketTab board={board} snapshot={snapshot} t={t} money={money} n={n} />
      }
    }

    return <div className={dragging ? 'paper-trading-page is-resizing' : 'paper-trading-page'}>
      <header className="paper-trading-header">
        <div className="paper-trading-header-text">
          <div className="paper-trading-header-meta">
            <div className="paper-trading-mode" role="group" aria-label={t('mode.label')}>
              <Button size="2xs" variant={snapshot.mode === 'stock' ? 'secondary' : 'ghost'}
                onClick={() => board.setMode('stock')}>{t('mode.stock')}</Button>
              <Button size="2xs" variant={snapshot.mode === 'futures' ? 'secondary' : 'ghost'}
                onClick={() => board.setMode('futures')}>{t('mode.futures')}</Button>
            </div>
            {snapshot.mode === 'stock' && snapshot.accounts !== null && snapshot.accounts.accounts.some(meta => meta.kind === 'stock' && !meta.archived) &&
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
            {snapshot.mode === 'stock' && status !== null && <span className="paper-trading-badge" data-state={status.phase === 'closed' ? 'stub' : 'live'}>
              {sessionText(t, status)}
            </span>}
            {snapshot.mode === 'stock' && status?.calendar?.source === 'fallback' && <span className="paper-trading-note">
              {t('session.calendarFallback')}
            </span>}
          </div>
          <span className="paper-trading-subtitle">{t('subtitle')}</span>
        </div>
        <div className="paper-trading-header-actions">
          {snapshot.dataSource?.state !== 'live' && <Button variant="outline" size="sm"
            disabled={snapshot.busy !== ''} onClick={() => void board.connectData()}>
            {snapshot.dataSource === null ? t('actions.connectData') : t('actions.reconnectData')}
          </Button>}
          {snapshot.mode === 'stock'
            ? <>
              <Button variant="outline" size="sm" disabled={snapshot.busy !== ''}
                onClick={() => setCashOpen(true)}>
                <IconWallet className="paper-trading-icon" />{t('actions.cash')}
              </Button>
              <Button variant="outline" size="sm" disabled={snapshot.busy !== ''}
                onClick={() => { setLedgerOpen(true); void board.loadLedger() }}>
                <IconBook className="paper-trading-icon" />{t('actions.ledger')}
              </Button>
              <Button variant="outline" size="sm" disabled={snapshot.busy !== ''}
                onClick={() => setAccountsOpen(true)}>{t('actions.manageAccounts')}</Button>
              <Button variant="ghost" size="sm" onClick={() => void board.refresh()} disabled={snapshot.busy !== ''}>
                <IconRefresh className="paper-trading-icon" />{t('actions.refresh')}
              </Button>
            </>
            : <>
              <Button variant="outline" size="sm" disabled={snapshot.futures.busy !== ''}
                onClick={() => setFuturesCashOpen(true)}>
                <IconWallet className="paper-trading-icon" />{t('actions.cash')}
              </Button>
              <Button variant="outline" size="sm" disabled={snapshot.futures.busy !== ''}
                onClick={() => { setFuturesLedgerOpen(true); void board.loadFuturesLedger() }}>
                <IconBook className="paper-trading-icon" />{t('actions.ledger')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void board.loadFutures()} disabled={snapshot.futures.busy !== ''}>
                <IconRefresh className="paper-trading-icon" />{t('actions.refresh')}
              </Button>
            </>}
        </div>
      </header>
      {snapshot.mode === 'stock' ? <>
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
              <IconAlertTriangle className="paper-trading-icon" />
              <span>{snapshot.errorMessage !== '' ? snapshot.errorMessage : errorText(t, snapshot.errorCode)}</span>
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
      </> : <FuturesPanel board={board} snapshot={snapshot} t={t} money={money} n={n} d={d} />}
      <AccountsDialog open={accountsOpen} onClose={() => setAccountsOpen(false)}
        snapshot={snapshot} t={t} board={board} text={code => errorText(t, code)} />
      <CashDialog open={cashOpen} onClose={() => setCashOpen(false)}
        snapshot={snapshot} t={t} money={money} d={d} board={board} text={code => errorText(t, code)} />
      <LedgerDialog open={ledgerOpen} onClose={() => setLedgerOpen(false)}
        snapshot={snapshot} t={t} money={money} board={board} text={code => errorText(t, code)} />
      <FuturesCashDialog open={futuresCashOpen} onClose={() => setFuturesCashOpen(false)}
        snapshot={snapshot} t={t} money={money} d={d} board={board} text={code => errorText(t, code)} />
      <FuturesLedgerDialog open={futuresLedgerOpen} onClose={() => setFuturesLedgerOpen(false)}
        snapshot={snapshot} t={t} money={money} board={board} text={code => errorText(t, code)} />
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
          {snapshot.account?.ledgerPath ?? t('settings.ledgerValue')}
        </SettingsRow>
      </SettingsGroup>
    </SettingsPage>
  }

  return { Dashboard, Settings }
}

/** 预览与当前输入比对；不一致（输入已变）时不显示旧数字。 */
function previewFor(preview: PreviewView | null, symbol: string, side: string, type: string, qty: number): PreviewView | null {
  if (preview === null) return null
  if (preview.symbol !== symbol || preview.side !== side || preview.type !== type || preview.qty !== qty) return null
  return preview
}

/** 账户管理：新建、切换、改名、归档/恢复、锁定/解锁。 */
function AccountsDialog(props: {
  open: boolean
  onClose: () => void
  snapshot: BoardSnapshot
  t: MessageScope['t']
  board: Board
  text: (code: string) => string
}) {
  const { t, snapshot, board } = props
  const [name, setName] = useState('')
  const [initialCash, setInitialCash] = useState('')
  const [actionError, setActionError] = useState('')
  const [renamingId, setRenamingId] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const stocks = (snapshot.accounts?.accounts ?? []).filter(meta => meta.kind === 'stock')
  const active = stocks.filter(meta => !meta.archived)
  const archived = stocks.filter(meta => meta.archived)
  const busy = snapshot.busy === 'accounts'

  const run = async (pending: Promise<string>) => {
    const code = await pending
    setActionError(code)
  }

  const create = async () => {
    if (name.trim() === '') return
    const cash = Number(initialCash)
    await run(board.createAccount(name.trim(), Number.isFinite(cash) && cash > 0 ? cash : undefined))
    setName('')
    setInitialCash('')
  }

  const row = (meta: typeof stocks[number]) => {
    const isCurrent = meta.id === snapshot.accountId
    return <div key={meta.id} className="paper-trading-account-row" data-current={isCurrent}>
      <div className="paper-trading-account-row-main">
        {renamingId === meta.id
          ? <Input value={renameValue} aria-label={t('account.rename')}
              onChange={event => setRenameValue(event.target.value)}
              onKeyDown={event => {
                if (event.key !== 'Enter') return
                void run(board.renameAccount(meta.id, renameValue.trim())).then(() => setRenamingId(''))
              }} />
          : <strong>{meta.name}</strong>}
        <span className="paper-trading-mono paper-trading-note">{meta.id}</span>
        {isCurrent && <span className="paper-trading-tag">{t('account.current')}</span>}
        {meta.archived && <span className="paper-trading-tag">{t('account.archived')}</span>}
        {meta.locked && <span className="paper-trading-tag">{t('account.locked')}</span>}
        {meta.missing && <span className="paper-trading-tag">{t('account.missing')}</span>}
      </div>
      <div className="paper-trading-account-row-actions">
        {!meta.archived && !isCurrent && <Button size="2xs" variant="outline" disabled={busy}
          onClick={() => void board.switchAccount(meta.id)}>{t('account.switch')}</Button>}
        {renamingId === meta.id
          ? <>
            <Button size="2xs" variant="outline" disabled={busy || renameValue.trim() === ''}
              onClick={() => void run(board.renameAccount(meta.id, renameValue.trim())).then(() => setRenamingId(''))}>{t('actions.save')}</Button>
            <Button size="2xs" variant="ghost" onClick={() => setRenamingId('')}>{t('actions.cancel')}</Button>
          </>
          : <Button size="2xs" variant="ghost" disabled={busy}
            onClick={() => { setRenamingId(meta.id); setRenameValue(meta.name) }}>{t('account.rename')}</Button>}
        {meta.archived
          ? <Button size="2xs" variant="ghost" disabled={busy}
            onClick={() => void run(board.unarchiveAccount(meta.id))}>{t('account.unarchive')}</Button>
          : <Button size="2xs" variant="ghost" disabled={busy}
            onClick={() => void run(board.archiveAccount(meta.id))}>{t('account.archive')}</Button>}
        {meta.locked
          ? <Button size="2xs" variant="ghost" disabled={busy}
            onClick={() => void run(board.unlockAccount(meta.id))}>{t('account.unlock')}</Button>
          : <Button size="2xs" variant="ghost" disabled={busy}
            onClick={() => void run(board.lockAccount(meta.id))}>{t('account.lock')}</Button>}
      </div>
    </div>
  }

  return <Dialog open={props.open} onOpenChange={open => { if (!open) props.onClose() }}>
    <DialogContent className="paper-trading-dialog">
      <DialogHeader><DialogTitle>{t('accounts.title')}</DialogTitle></DialogHeader>
      <div className="paper-trading-dialog-section">
        <div className="paper-trading-inline-form">
          <Input value={name} placeholder={t('accounts.namePlaceholder')} aria-label={t('accounts.name')}
            onChange={event => setName(event.target.value)} />
          <Input value={initialCash} placeholder={t('accounts.cashPlaceholder')} inputMode="decimal"
            aria-label={t('accounts.initialCash')} onChange={event => setInitialCash(event.target.value)} />
          <Button size="sm" disabled={busy || name.trim() === ''} onClick={() => void create()}>{t('accounts.create')}</Button>
        </div>
        {actionError !== '' && <p className="paper-trading-error-text" role="alert">{props.text(actionError)}</p>}
        <div className="paper-trading-account-list">
          {active.length === 0 && <div className="paper-trading-empty">{t('accounts.empty')}</div>}
          {active.map(row)}
        </div>
        {archived.length > 0 && <>
          <h4 className="paper-trading-dialog-subtitle">{t('accounts.archivedTitle')}</h4>
          <div className="paper-trading-account-list">{archived.map(row)}</div>
        </>}
      </div>
      <DialogFooter><Button variant="ghost" size="sm" onClick={props.onClose}>{t('actions.close')}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}

/** 资金：注资、提款与资金流水。 */
function CashDialog(props: {
  open: boolean
  onClose: () => void
  snapshot: BoardSnapshot
  t: MessageScope['t']
  money: (value: number) => string
  d: MessageScope['d']
  board: Board
  text: (code: string) => string
}) {
  const { t, snapshot, board, money, d } = props
  const [amount, setAmount] = useState('')
  const [error, setError] = useState('')
  const busy = snapshot.busy === 'cash'
  const flow = snapshot.cashFlow
  const move = async (kind: 'deposit' | 'withdraw') => {
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) {
      setError('INVALID_ARGUMENT')
      return
    }
    setError(await (kind === 'deposit' ? board.deposit(value) : board.withdraw(value)))
    setAmount('')
  }
  return <Dialog open={props.open} onOpenChange={open => { if (!open) props.onClose() }}>
    <DialogContent className="paper-trading-dialog">
      <DialogHeader><DialogTitle>{t('cash.title')}</DialogTitle></DialogHeader>
      <div className="paper-trading-dialog-section">
        <div className="paper-trading-inline-form">
          <Input value={amount} inputMode="decimal" placeholder={t('cash.amount')} aria-label={t('cash.amount')}
            onChange={event => setAmount(event.target.value)} />
          <Button size="sm" disabled={busy} onClick={() => void move('deposit')}>{t('cash.deposit')}</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void move('withdraw')}>{t('cash.withdraw')}</Button>
        </div>
        {error !== '' && <p className="paper-trading-error-text" role="alert">{props.text(error)}</p>}
        <h4 className="paper-trading-dialog-subtitle">{t('cash.flowTitle')}</h4>
        <CashFlowTable flow={flow} money={money} t={t} d={d} />
      </div>
      <DialogFooter><Button variant="ghost" size="sm" onClick={props.onClose}>{t('actions.close')}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}

/** 账本：快照、恢复、导出与重置。 */
function LedgerDialog(props: {
  open: boolean
  onClose: () => void
  snapshot: BoardSnapshot
  t: MessageScope['t']
  money: (value: number) => string
  board: Board
  text: (code: string) => string
}) {
  const { t, snapshot, board, money } = props
  const [error, setError] = useState('')
  const [confirmName, setConfirmName] = useState('')
  const [resetCash, setResetCash] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const ledger = snapshot.ledger
  const busy = snapshot.busy === 'ledger'
  const run = async (pending: Promise<string>) => setError(await pending)
  const exported = snapshot.ledgerExport

  const download = () => {
    if (exported?.content === undefined) return
    const blob = new Blob([exported.content], { type: 'application/x-ndjson' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${snapshot.accountId || 'paper-trading'}-events.jsonl`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const reset = async () => {
    if (!confirmReset) { setConfirmReset(true); return }
    const cash = Number(resetCash)
    setError(await board.resetAccount(Number.isFinite(cash) && cash > 0 ? cash : undefined))
    setConfirmReset(false)
    setResetCash('')
  }

  return <Dialog open={props.open} onOpenChange={open => { if (!open) props.onClose() }}>
    <DialogContent className="paper-trading-dialog">
      <DialogHeader><DialogTitle>{t('ledger.title')}</DialogTitle></DialogHeader>
      <div className="paper-trading-dialog-section">
        {ledger?.blocked === true && <p className="paper-trading-error-text" role="alert">
          {t('ledger.blocked')}{ledger.blockedReason === undefined ? '' : `：${ledger.blockedReason}`}
        </p>}
        <p className="paper-trading-note paper-trading-break">{ledger?.path ?? snapshot.account?.ledgerPath ?? '—'}</p>
        <div className="paper-trading-inline-form">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(board.backupLedger())}>{t('ledger.backup')}</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(board.exportLedger())}>{t('ledger.export')}</Button>
          {exported?.content !== undefined && <Button size="sm" variant="ghost" onClick={download}>{t('ledger.download')}</Button>}
        </div>
        {exported !== null && exported.content === undefined && <p className="paper-trading-note">{t('ledger.exportEmpty')}</p>}
        {error !== '' && <p className="paper-trading-error-text" role="alert">{props.text(error)}</p>}
        <h4 className="paper-trading-dialog-subtitle">{t('ledger.snapshots')}</h4>
        {ledger === null || ledger.snapshots.length === 0
          ? <div className="paper-trading-empty">{t('ledger.empty')}</div>
          : <div className="paper-trading-table-wrap paper-trading-dialog-table">
            <table className="paper-trading-table">
              <thead><tr>
                <th>{t('ledger.snapshot')}</th><th className="is-num">{t('ledger.cash')}</th>
                <th className="is-num">{t('ledger.tradeDate')}</th><th>{t('ledger.state')}</th><th />
              </tr></thead>
              <tbody>{ledger.snapshots.map(view => <tr key={view.name}>
                <td className="paper-trading-mono">{view.name}</td>
                <td className="is-num paper-trading-mono">{money(view.cash)}</td>
                <td className="is-num">{view.tradeDate}</td>
                <td>{view.valid ? t('ledger.valid') : t('ledger.invalid')}</td>
                <td>{view.valid && (confirmName === view.name
                  ? <Button size="2xs" variant="destructive" disabled={busy}
                    onClick={() => void run(board.restoreLedger(view.name)).then(() => setConfirmName(''))}>
                    {t('ledger.restoreConfirm')}
                  </Button>
                  : <Button size="2xs" variant="ghost" disabled={busy || ledger.blocked}
                    onClick={() => setConfirmName(view.name)}>{t('ledger.restore')}</Button>)}</td>
              </tr>)}</tbody>
            </table>
          </div>}
        <h4 className="paper-trading-dialog-subtitle">{t('ledger.resetTitle')}</h4>
        <p className="paper-trading-note">{t('ledger.resetHint')}</p>
        <div className="paper-trading-inline-form">
          <Input value={resetCash} inputMode="decimal" placeholder={t('ledger.resetCash')} aria-label={t('ledger.resetCash')}
            onChange={event => { setResetCash(event.target.value); setConfirmReset(false) }} />
          <Button size="sm" variant={confirmReset ? 'destructive' : 'outline'} disabled={busy} onClick={() => void reset()}>
            {confirmReset ? t('ledger.resetConfirm') : t('ledger.reset')}
          </Button>
        </div>
      </div>
      <DialogFooter><Button variant="ghost" size="sm" onClick={props.onClose}>{t('actions.close')}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
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
  if (props.quote === null) return <div className="paper-trading-empty">{props.t('trade.symbolHint')}</div>
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

/** 下单前的完整试算：费用分项、可买数量、涨跌停与风险提示。 */
function PreviewBlock(props: {
  preview: PreviewView | null
  busy: boolean
  money: (value: number) => string
  t: MessageScope['t']
  n: MessageScope['n']
}) {
  if (props.preview === null) {
    return props.busy
      ? <div className="paper-trading-empty">{props.t('preview.loading')}</div>
      : null
  }
  const preview = props.preview
  const warnings = preview.warnings
  return <section className="paper-trading-preview">
    <div><span>{props.t('preview.price')}</span><strong className="paper-trading-mono">{props.money(preview.price)}</strong></div>
    <div><span>{props.t('preview.amount')}</span><strong className="paper-trading-mono">{props.money(preview.amountCents / 100)}</strong></div>
    <div><span>{props.t('preview.commission')}</span><span className="paper-trading-mono">{props.money(preview.commissionCents / 100)}</span></div>
    <div><span>{props.t('preview.stamp')}</span><span className="paper-trading-mono">{props.money(preview.stampCents / 100)}</span></div>
    <div><span>{props.t('preview.transfer')}</span><span className="paper-trading-mono">{props.money(preview.transferCents / 100)}</span></div>
    <div><span>{props.t('preview.fee')}</span><strong className="paper-trading-mono">{props.money(preview.totalFeesCents / 100)}</strong></div>
    <div><span>{props.t('preview.cashAfter')}</span><strong className="paper-trading-mono">{props.money(preview.cashAfterCents / 100)}</strong></div>
    <div><span>{props.t('preview.available')}</span><span className="paper-trading-mono">{props.n(preview.availableQty)}</span></div>
    <div><span>{props.t('preview.maxBuy')}</span><span className="paper-trading-mono">{props.n(preview.maxBuyQty)}</span></div>
    {preview.priceLimit !== undefined && <div>
      <span>{props.t('preview.priceLimit')}</span>
      <span className="paper-trading-mono">{props.money(preview.priceLimit.lower)} – {props.money(preview.priceLimit.upper)}</span>
    </div>}
    {warnings.length === 0
      ? <p className="paper-trading-note">{props.t('preview.valid')}</p>
      : <p className="paper-trading-error-text" role="alert">{warnings.join('；')}</p>}
  </section>
}

/** 下单回执：来自账本的委托结果，不是草稿。 */
function ReceiptBlock(props: {
  order: OrderView
  money: (value: number) => string
  t: MessageScope['t']
  n: MessageScope['n']
  d: MessageScope['d']
}) {
  const order = props.order
  const state = order.status === 'rejected' ? 'rejected' : order.status === 'filled' ? 'filled' : 'pending'
  const price = order.avgFillPrice ?? order.fillPrice ?? order.limitPrice
  return <section className="paper-trading-receipt" data-state={state} aria-label={props.t('receipt.title')}>
    <div className="paper-trading-receipt-head">
      <strong>{props.t('receipt.title')}</strong>
      <span>{statusText(props.t, order.status)}</span>
    </div>
    <div className="paper-trading-receipt-body">
      <span className="paper-trading-mono">{order.symbol}</span>
      <span>{props.t(`side.${order.side}`)} {props.n(order.qty)}</span>
      {price !== undefined && <span className="paper-trading-mono">{props.money(price)}</span>}
      <span className="paper-trading-note">{props.d(new Date(order.updatedAt), { hour: '2-digit', minute: '2-digit' })}</span>
    </div>
    {order.reason !== undefined && order.reason !== '' && <p className="paper-trading-error-text">{order.reason}</p>}
    {order.note !== undefined && order.note !== '' && <p className="paper-trading-note">{order.note}</p>}
  </section>
}

/** 最近成交：回执之外再给三五行可核对的事实。 */
function TradesTable(props: {
  trades: readonly FillView[]
  money: (value: number) => string
  t: MessageScope['t']
  n: MessageScope['n']
  d: MessageScope['d']
}) {
  return <section className="paper-trading-trades">
    <h4 className="paper-trading-dialog-subtitle">{props.t('trades.title')}</h4>
    {props.trades.length === 0
      ? <div className="paper-trading-empty">{props.t('trades.empty')}</div>
      : <div className="paper-trading-table-wrap">
        <table className="paper-trading-table">
          <thead><tr>
            <th>{props.t('trades.time')}</th><th>{props.t('trades.symbol')}</th>
            <th>{props.t('trades.side')}</th><th className="is-num">{props.t('trades.price')}</th>
            <th className="is-num">{props.t('trades.qty')}</th><th className="is-num">{props.t('trades.fees')}</th>
          </tr></thead>
          <tbody>{props.trades.map(trade => <tr key={trade.id}>
            <td className="is-num">{props.d(new Date(trade.ts), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
            <td><span className="paper-trading-mono">{trade.symbol}</span> {trade.name}</td>
            <td className={trade.side === 'buy' ? 'is-up' : 'is-down'}>{props.t(`side.${trade.side}`)}</td>
            <td className="is-num paper-trading-mono">{props.money(trade.price)}</td>
            <td className="is-num">{props.n(trade.qty)}</td>
            <td className="is-num paper-trading-mono">{props.money(trade.feesCents / 100)}</td>
          </tr>)}</tbody>
        </table>
      </div>}
  </section>
}


/** 资金流水表：资金面板与复盘共用。 */
function CashFlowTable(props: {
  flow: readonly CashFlowEntry[]
  money: (value: number) => string
  t: MessageScope['t']
  d: MessageScope['d']
}) {
  if (props.flow.length === 0) return <div className="paper-trading-empty">{props.t('cash.empty')}</div>
  return <div className="paper-trading-table-wrap paper-trading-dialog-table">
    <table className="paper-trading-table">
      <thead><tr>
        <th>{props.t('cash.time')}</th><th>{props.t('cash.type')}</th>
        <th className="is-num">{props.t('cash.amount')}</th><th className="is-num">{props.t('cash.balance')}</th>
      </tr></thead>
      <tbody>{props.flow.slice(-30).reverse().map((entry, index) => <tr key={`${entry.ts}-${index}`}>
        <td className="is-num">{props.d(new Date(entry.ts), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
        <td>{props.t(`cash.kind.${entry.type}`)}</td>
        <td className={`is-num paper-trading-mono ${entry.amount < 0 ? 'is-down' : 'is-up'}`}>{props.money(entry.amount)}</td>
        <td className="is-num paper-trading-mono">{props.money(entry.balance)}</td>
      </tr>)}</tbody>
    </table>
  </div>
}

/** 复盘 · 日终报告：昨天收盘时账本记下的那一份，带收盘来源与缺口。 */
function DayReportBlock(props: {
  reports: readonly DayReport[] | null
  money: (value: number) => string
  t: MessageScope['t']
  n: MessageScope['n']
  d: MessageScope['d']
}) {
  const report: DayReport | null = props.reports === null || props.reports.length === 0
    ? null : props.reports[props.reports.length - 1] ?? null
  if (report === null) return null
  const rows: { label: string; value: string }[] = [
    { label: props.t('review.daily.equity'), value: props.money(report.equity) },
    { label: props.t('review.daily.cash'), value: props.money(report.cash) },
    { label: props.t('review.daily.dayPnl'), value: props.money(report.dayPnl) },
    { label: props.t('review.daily.fees'), value: props.money(report.fees) },
    { label: props.t('review.daily.available'), value: props.n(report.available) },
    { label: props.t('review.daily.positions'), value: props.n(report.positions.length) },
  ]
  return <section className="paper-trading-review-section">
    <div className="paper-trading-review-head">
      <h4 className="paper-trading-dialog-subtitle">{props.t('review.daily.title')}</h4>
      <span className="paper-trading-note">
        {report.date} · {props.t(`review.closeSource.${report.closeSource}`)}
      </span>
    </div>
    <div className="paper-trading-daily-grid">
      {rows.map(row => <div key={row.label} className="paper-trading-daily-cell">
        <span>{row.label}</span><strong className="paper-trading-mono">{row.value}</strong>
      </div>)}
    </div>
    {report.positions.length > 0 && <PositionsTable positions={report.positions} money={props.money} t={props.t} n={props.n} />}
    {Object.keys(report.gaps).length > 0 && <p className="paper-trading-note">
      {props.t('review.daily.gaps', { count: Object.keys(report.gaps).length })}
    </p>}
  </section>
}

/** 复盘 · 交易配对：按买卖配对后的持有天数与已实现盈亏。 */
function RoundTripsTable(props: {
  rows: readonly RoundTrip[] | null
  money: (value: number) => string
  t: MessageScope['t']
  n: MessageScope['n']
}) {
  if (props.rows === null) return null
  return <section className="paper-trading-review-section">
    <h4 className="paper-trading-dialog-subtitle">{props.t('review.roundTrips.title')}</h4>
    {props.rows.length === 0
      ? <div className="paper-trading-empty">{props.t('review.roundTrips.empty')}</div>
      : <div className="paper-trading-table-wrap paper-trading-dialog-table">
        <table className="paper-trading-table">
          <thead><tr>
            <th>{props.t('positions.symbol')}</th><th className="is-num">{props.t('review.roundTrips.qty')}</th>
            <th className="is-num">{props.t('review.roundTrips.cost')}</th>
            <th className="is-num">{props.t('review.roundTrips.proceeds')}</th>
            <th className="is-num">{props.t('review.roundTrips.pnl')}</th>
            <th className="is-num">{props.t('review.roundTrips.holdingDays')}</th>
          </tr></thead>
          <tbody>{props.rows.slice(0, 50).map((row, index) => <tr key={`${row.symbol}-${index}`}>
            <td><span className="paper-trading-mono">{row.symbol}</span> {row.name}</td>
            <td className="is-num">{props.n(row.qty)}</td>
            <td className="is-num paper-trading-mono">{props.money(row.cost)}</td>
            <td className="is-num paper-trading-mono">{props.money(row.proceeds)}</td>
            <td className={`is-num paper-trading-mono ${row.pnl >= 0 ? 'is-up' : 'is-down'}`}>{props.money(row.pnl)}</td>
            <td className="is-num">{props.n(row.holdingDays)}</td>
          </tr>)}</tbody>
        </table>
      </div>}
  </section>
}

const COMPARE_COLORS = ['#1F2A44', '#D93A3A', '#D9962B', '#7A9A82', '#6B7FA3', '#B06AB3', '#3B7B8F', '#A3553B']

/** 账户对比：净值曲线归一化到 100 叠加，按收益排序，附一行硬指标。 */
function CompareBlock(props: {
  view: { accounts: readonly CompareRow[] } | null
  money: (value: number) => string
  t: MessageScope['t']
  n: MessageScope['n']
  loading: boolean
}) {
  if (props.view === null) {
    return <div className="paper-trading-empty">{props.loading ? props.t('loading') : props.t('compare.empty')}</div>
  }
  if (props.view.accounts.length === 0) return <div className="paper-trading-empty">{props.t('compare.empty')}</div>
  const rows = [...props.view.accounts].sort((left, right) => right.pnlPct - left.pnlPct)
  const series = rows.map((row, index) => {
    const points = row.points.length > 0 ? row.points : [{ date: '', equity: row.initialCash, cash: 0 }]
    const base = points[0]?.equity ?? row.initialCash
    const values = points.map(point => base > 0 ? (point.equity / base) * 100 : 100)
    return { row, values, color: COMPARE_COLORS[index % COMPARE_COLORS.length] }
  })
  const all = series.flatMap(item => item.values)
  const min = Math.min(100, ...all)
  const max = Math.max(100, ...all)
  const span = Math.max(1, max - min)
  const longest = Math.max(...series.map(item => item.values.length))
  const toPolyline = (values: readonly number[]) => values.map((value, index) => {
    const x = values.length <= 1 ? 0 : (index / Math.max(1, longest - 1)) * 600
    const y = 150 - ((value - min) / span) * 140
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return <section className="paper-trading-compare">
    <div className="paper-trading-tabs" role="group" aria-label={props.t('compare.title')}>
      {series.map(item => <span key={item.row.id} className="paper-trading-legend">
        <i style={{ background: item.color }} />{item.row.name}
      </span>)}
    </div>
    <section className="paper-trading-chart" aria-label={props.t('compare.title')}>
      <div className="paper-trading-chart-scale"><span>{props.n(max / 100, { style: 'percent', maximumFractionDigits: 1 })}</span>
        <span>{props.n(min / 100, { style: 'percent', maximumFractionDigits: 1 })}</span></div>
      <svg viewBox="0 0 600 160" preserveAspectRatio="none" role="img" aria-label={props.t('compare.title')}>
        {series.map(item => <polyline key={item.row.id} points={toPolyline(item.values)} fill="none"
          stroke={item.color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />)}
      </svg>
      <p className="paper-trading-note">{props.t('compare.hint')}</p>
    </section>
    <div className="paper-trading-table-wrap">
      <table className="paper-trading-table">
        <thead><tr>
          <th>{props.t('compare.account')}</th><th className="is-num">{props.t('compare.equity')}</th>
          <th className="is-num">{props.t('compare.pnl')}</th><th className="is-num">{props.t('compare.drawdown')}</th>
          <th className="is-num">{props.t('compare.trades')}</th><th>{props.t('compare.state')}</th>
        </tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}>
          <td><strong>{row.name}</strong> <span className="paper-trading-mono paper-trading-note">{row.id}</span></td>
          <td className="is-num paper-trading-mono">{props.money(row.equity)}</td>
          <td className={`is-num paper-trading-mono ${row.pnlPct >= 0 ? 'is-up' : 'is-down'}`}>
            {props.n(row.pnlPct, { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </td>
          <td className="is-num">{props.n(row.maxDrawdownPct / 100, { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          <td className="is-num">{props.n(row.tradeCount)}</td>
          <td>{row.missing === true ? props.t('compare.missing') : row.locked ? props.t('account.locked') : props.t('compare.normal')}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </section>
}

/** 行情页：板块翻页、搜索、备选与「带进交易页」。 */
function MarketTab(props: {
  board: Board
  snapshot: BoardSnapshot
  t: MessageScope['t']
  money: (value: number) => string
  n: MessageScope['n']
}) {
  const { board, snapshot, t, money, n } = props
  const [query, setQuery] = useState('')
  const [shortlistOnly, setShortlistOnly] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => { void board.searchMarket(query) }, 250)
    return () => clearTimeout(timer)
  }, [query])
  const list = snapshot.marketList
  const quotes = shortlistOnly
    ? (list?.quotes ?? []).filter(quote => snapshot.shortlist.includes(quote.symbol))
    : (list?.quotes ?? [])
  return <div className="paper-trading-market">
    <div className="paper-trading-tabs" role="group" aria-label={t('market.boards')}>
      {BOARDS.map(item => <Button key={item.value} size="xs"
        variant={snapshot.marketBoard === item.value ? 'secondary' : 'ghost'}
        onClick={() => void board.loadMarket(item.value, 1)}>{t(item.label)}</Button>)}
      <Button size="xs" variant={shortlistOnly ? 'secondary' : 'ghost'}
        onClick={() => setShortlistOnly(value => !value)}>{t('market.shortlistOnly')}</Button>
    </div>
    <div className="paper-trading-market-search">
      <Input value={query} placeholder={t('market.searchPlaceholder')} aria-label={t('market.searchPlaceholder')}
        onChange={event => setQuery(event.target.value)} />
      {snapshot.marketHits.length > 0 && <div className="paper-trading-hits">
        {snapshot.marketHits.map(hit => <button key={hit.symbol} type="button" className="paper-trading-hit"
          onClick={() => { setQuery(''); void board.adoptSymbol(hit.symbol) }}>
          <span className="paper-trading-mono">{hit.symbol}</span>{hit.name}
        </button>)}
      </div>}
    </div>
    {list?.notice !== undefined && <p className="paper-trading-note">{list.notice}</p>}
    {snapshot.marketBusy
      ? <div className="paper-trading-empty">{t('loading')}</div>
      : quotes.length === 0
        ? <div className="paper-trading-empty">{t('market.empty')}</div>
        : <div className="paper-trading-table-wrap">
          <table className="paper-trading-table">
            <thead><tr>
              <th>{t('market.symbol')}</th><th className="is-num">{t('market.last')}</th>
              <th className="is-num">{t('market.change')}</th><th className="is-num">{t('market.prevClose')}</th>
              <th>{t('market.favorite')}</th>
            </tr></thead>
            <tbody>{quotes.map(quote => {
              const previous = quote.prevClose ?? quote.last
              const change = previous > 0 ? ((quote.last - previous) / previous) * 100 : 0
              const favorited = snapshot.shortlist.includes(quote.symbol)
              return <tr key={quote.symbol}>
                <td><button type="button" className="paper-trading-link"
                  onClick={() => void board.adoptSymbol(quote.symbol)}>
                  <span className="paper-trading-mono">{quote.symbol}</span> {quote.name}
                </button></td>
                <td className="is-num paper-trading-mono">{money(quote.last)}</td>
                <td className={`is-num paper-trading-mono ${change >= 0 ? 'is-up' : 'is-down'}`}>
                  {n(change / 100, { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td className="is-num paper-trading-mono">{money(previous)}</td>
                <td><Button variant="ghost" size="icon-2xs" aria-label={t(favorited ? 'market.unfavorite' : 'market.favorite')}
                  onClick={() => void board.toggleShortlist(quote.symbol)}>
                  {favorited ? <IconStarFilled className="paper-trading-icon" /> : <IconStar className="paper-trading-icon" />}
                </Button></td>
              </tr>
            })}</tbody>
          </table>
        </div>}
    <div className="paper-trading-pager">
      <Button size="xs" variant="outline" disabled={snapshot.marketBusy || snapshot.marketPage <= 1}
        onClick={() => void board.loadMarket(snapshot.marketBoard, snapshot.marketPage - 1)}>{t('market.prev')}</Button>
      <span className="paper-trading-note">{t('market.page', { page: snapshot.marketPage })}</span>
      <Button size="xs" variant="outline" disabled={snapshot.marketBusy || (list?.quotes.length ?? 0) === 0}
        onClick={() => void board.loadMarket(snapshot.marketBoard, snapshot.marketPage + 1)}>{t('market.next')}</Button>
    </div>
  </div>
}


/** 期货面板：账户统计、四个页签与右侧试算都没有股票那边的 K 线栏。 */
function FuturesPanel(props: {
  board: Board
  snapshot: BoardSnapshot
  t: MessageScope['t']
  money: (value: number) => string
  n: MessageScope['n']
  d: MessageScope['d']
}) {
  const { board, snapshot, t, money, n, d } = props
  const futures = snapshot.futures
  const account = futures.account
  const session = futuresSessionText(t, futures.status)
  const tabContent = () => {
    if (account === null) {
      return futures.errorCode !== ''
        ? <div className="paper-trading-empty" role="alert">
          <IconAlertTriangle className="paper-trading-icon" />
          <span>{futures.errorMessage !== '' ? futures.errorMessage : t('errors.unknown')}</span>
          <Button variant="outline" size="sm" onClick={() => void board.loadFutures()}>{t('actions.retry')}</Button>
        </div>
        : <div className="paper-trading-empty">{t('loading')}</div>
    }
    switch (futures.tab) {
      case 'trade':
        return <FuturesTradeTab board={board} snapshot={snapshot} t={t} money={money} n={n} d={d} />
      case 'positions':
        return <FuturesPositionsTable positions={futures.positions} t={t} money={money} n={n} />
      case 'orders':
        return <FuturesOrdersTable orders={futures.orders} t={t} money={money} n={n} d={d}
          busy={futures.busy !== ''} onCancel={id => void board.cancelFutures(id)} />
      case 'review': {
        return <>
          <div className="paper-trading-tabs" role="group" aria-label={t('review.period')}>
            {PERIODS.map(period => <Button key={period} size="xs" variant="ghost"
              onClick={() => void board.loadFuturesReview(period)}>{t(`review.period${period}`)}</Button>)}
          </div>
          <FuturesReviewBlock review={futures.review} money={money} t={t} n={n} />
          <section className="paper-trading-trades">
            <h4 className="paper-trading-dialog-subtitle">{t('review.cashTitle')}</h4>
            <FuturesCashFlowTable flow={futures.cashFlow} money={money} t={t} d={d} />
          </section>
        </>
      }
    }
  }

  return <div className="paper-trading-futures">
    <section className="paper-trading-stats">
      <Stat label={t('futures.account.equity')} value={account === null ? '—' : money(account.equity)} />
      <Stat label={t('account.cash')} value={account === null ? '—' : money(account.cash)} />
      <Stat label={t('futures.account.margin')} value={account === null ? '—' : money(account.margin)} />
      <Stat label={t('account.dayPnl')} value={account === null ? '—' : money(account.todayPnl)} tone={account?.todayPnl} />
      <Stat label={t('futures.account.risk')} value={account === null ? '—'
        : n(account.riskRatio, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 })} tone={account !== null && account.riskRatio >= 0.8 ? 1 : 0} />
    </section>
    <div className="paper-trading-header-meta paper-trading-futures-meta">
      {futures.status !== null && <span className="paper-trading-badge" data-state={futures.status.canSubmit ? 'live' : 'stub'}>
        {session}
      </span>}
      {futures.status?.calendar?.source === 'fallback' && <span className="paper-trading-note">{t('session.calendarFallback')}</span>}
      {account !== null && <span className="paper-trading-note">{t('futures.account.tradeDate')} {account.tradeDate}</span>}
    </div>
    <div className="paper-trading-main">
      <div className="paper-trading-tabs" role="tablist" aria-label={t('tabs.label')}>
        {FUTURES_TABS.map(tab => <Button key={tab} size="xs" variant={futures.tab === tab ? 'secondary' : 'ghost'}
          role="tab" aria-selected={futures.tab === tab}
          onClick={() => board.setFuturesTab(tab)}>{t(`futures.tabs.${tab}`)}</Button>)}
      </div>
      <div className="paper-trading-content">
        {futures.errorCode !== '' && account !== null && <div className="paper-trading-error" role="alert">
          <IconAlertTriangle className="paper-trading-icon" />
          <span>{futures.errorMessage !== '' ? futures.errorMessage : t('errors.unknown')}</span>
        </div>}
        {tabContent()}
      </div>
    </div>
  </div>
}

/** 期货交易：品种搜索、方向/开平/类型、手数、自动试算、回执与最近成交。 */
function FuturesTradeTab(props: {
  board: Board
  snapshot: BoardSnapshot
  t: MessageScope['t']
  money: (value: number) => string
  n: MessageScope['n']
  d: MessageScope['d']
}) {
  const { board, snapshot, t, money, n, d } = props
  const futures = snapshot.futures
  const [symbolInput, setSymbolInput] = useState(futures.symbol)
  const [side, setSide] = useState<FuturesSide>('long')
  const [offset, setOffset] = useState<FuturesOffset>('open')
  const [type, setType] = useState<FuturesOrderType>('market')
  const [qty, setQty] = useState('1')
  const [limitPrice, setLimitPrice] = useState('')
  const [price, setPrice] = useState('')
  const [note, setNote] = useState('')

  // 合约搜索：输入变化后 300ms 查一次；选中建议后取行情。
  useEffect(() => {
    const timer = setTimeout(() => { void board.loadFuturesContracts(symbolInput) }, 300)
    return () => clearTimeout(timer)
  }, [symbolInput])

  const draft = (): FuturesDraft => {
    const qtyNumber = Number(qty)
    const limitNumber = Number(limitPrice)
    const priceNumber = Number(price)
    return {
      symbol: futures.symbol,
      side,
      offset,
      type,
      qty: qtyNumber,
      ...(type === 'limit' ? { limitPrice: limitNumber } : {}),
      ...(type === 'market' && futures.quote === null && priceNumber > 0 ? { price: priceNumber } : {}),
      ...(note.trim() === '' ? {} : { note: note.trim() }),
    }
  }

  // 自动试算：合约、方向、开平、类型、手数、价格变化后 250ms 重算。
  useEffect(() => {
    const qtyNumber = Number(qty)
    const limitNumber = Number(limitPrice)
    const priceNumber = Number(price)
    if (futures.symbol === '' || !Number.isFinite(qtyNumber) || qtyNumber <= 0) return
    if (type === 'limit' && (!Number.isFinite(limitNumber) || limitNumber <= 0)) return
    if (type === 'market' && futures.quote === null && (!Number.isFinite(priceNumber) || priceNumber <= 0)) return
    const timer = setTimeout(() => { void board.loadFuturesPreview(draft()) }, 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [futures.symbol, futures.quote?.last, side, offset, type, qty, limitPrice, price, note])

  const canSubmit = futures.busy !== 'order'
    && futures.symbol !== ''
    && Number(qty) > 0
    && (type === 'limit' ? Number(limitPrice) > 0 : (futures.quote !== null || Number(price) > 0))
  const preview = futures.preview !== null
    && futures.preview.symbol === futures.symbol
    && futures.preview.side === side
    && futures.preview.offset === offset
    && futures.preview.type === type
    && futures.preview.qty === Number(qty)
    ? futures.preview : null
  const receipt = futures.lastOrder !== null && futures.lastOrder.symbol === futures.symbol ? futures.lastOrder : null

  return <>
    <div className="paper-trading-trade">
      <div className="paper-trading-form-card">
        <div className="paper-trading-form">
          <Field label={t('futures.trade.symbol')} htmlFor="futures-symbol" className="paper-trading-span-2">
            <Input id="futures-symbol" value={symbolInput} placeholder={t('futures.trade.symbolHint')}
              onChange={event => setSymbolInput(event.target.value.toUpperCase())}
              onKeyDown={event => { if (event.key === 'Enter') void board.loadFuturesQuote(symbolInput) }} />
          </Field>
          {futures.contracts.length > 0 && <div className="paper-trading-hits paper-trading-span-2">
            {futures.contracts.slice(0, 8).map(contract => <button key={contract.symbol} type="button"
              className="paper-trading-hit"
              onClick={() => { setSymbolInput(contract.symbol); void board.loadFuturesQuote(contract.symbol) }}>
              <span className="paper-trading-mono">{contract.symbol}</span>{contract.name}
              <span className="paper-trading-note">{contract.exchange}</span>
            </button>)}
          </div>}
          <Field label={t('futures.trade.side')}>
            <Segmented ariaLabel={t('futures.trade.side')} value={side}
              options={FUTURES_SIDES.map(value => ({ value, label: t(`futures.side.${value}`) }))} onChange={setSide} />
          </Field>
          <Field label={t('futures.trade.offset')}>
            <Segmented ariaLabel={t('futures.trade.offset')} value={offset}
              options={FUTURES_OFFSETS.map(value => ({ value, label: t(`futures.offset.${value}`) }))} onChange={setOffset} />
          </Field>
          <Field label={t('futures.trade.type')}>
            <Segmented ariaLabel={t('futures.trade.type')} value={type}
              options={FUTURES_TYPES.map(value => ({ value, label: t(`orderType.${value}`) }))} onChange={setType} />
          </Field>
          <Field label={t('futures.trade.qty')} htmlFor="futures-qty">
            <Input id="futures-qty" value={qty} inputMode="numeric" onChange={event => setQty(event.target.value)} />
          </Field>
          <Field label={t('futures.trade.limitPrice')} htmlFor="futures-limit">
            <Input id="futures-limit" inputMode="decimal" value={type === 'limit' ? limitPrice : ''}
              disabled={type !== 'limit'} {...(type === 'limit' ? {} : { placeholder: t('futures.trade.marketHint') })}
              onChange={event => setLimitPrice(event.target.value)} />
          </Field>
          {type === 'market' && futures.quote === null && (
            <Field label={t('futures.trade.referencePrice')} htmlFor="futures-price" className="paper-trading-span-2">
              <Input id="futures-price" inputMode="decimal" value={price}
                placeholder={t('futures.trade.referenceHint')}
                onChange={event => setPrice(event.target.value)} />
            </Field>
          )}
          <Field label={t('trade.note')} htmlFor="futures-note" className="paper-trading-span-2">
            <Input id="futures-note" value={note} maxLength={120} placeholder={t('trade.noteHint')}
              onChange={event => setNote(event.target.value)} />
          </Field>
          <div className="paper-trading-actions paper-trading-span-2">
            <span className="paper-trading-note">{t('futures.trade.autoHint')}</span>
            <Button size="sm" disabled={!canSubmit}
              onClick={() => void board.submitFutures(draft())}>{t('trade.submit')}</Button>
          </div>
        </div>
      </div>
      <div className="paper-trading-trade-side">
        <FuturesQuoteBlock quote={futures.quote} t={t} money={money} />
        <FuturesPreviewBlock preview={preview} busy={futures.previewBusy} t={t} money={money} n={n} />
        {receipt !== null && <FuturesReceipt order={receipt} t={t} money={money} n={n} d={d} />}
        <FuturesTradesTable trades={futures.trades.slice(0, 5)} t={t} money={money} n={n} d={d} />
      </div>
    </div>
    <FuturesOrdersTable orders={futures.orders.slice(0, 5)} t={t} money={money} n={n} d={d}
      busy={futures.busy !== ''} onCancel={id => void board.cancelFutures(id)} />
  </>
}

function futuresSessionText(t: MessageScope['t'], status: FuturesMarketStatus | null): string {
  if (status === null) return ''
  switch (status.phase) {
    case 'pre_open': return t('session.preOpen')
    case 'trading': return t('futures.session.trading')
    case 'lunch': return t('session.lunch')
    case 'closed': return t('session.closed')
    default: return ''
  }
}

function FuturesQuoteBlock(props: { quote: FuturesQuoteView | null; t: MessageScope['t']; money: (value: number) => string }) {
  if (props.quote === null) return <div className="paper-trading-empty">{props.t('futures.trade.symbolHint')}</div>
  const quote = props.quote
  const base = quote.preSettlement ?? quote.last
  const change = base > 0 ? ((quote.last - base) / base) * 100 : 0
  return <section className="paper-trading-quote">
    <div className="paper-trading-quote-head">
      {quote.name !== undefined && <strong>{quote.name}</strong>}
      <span className="paper-trading-mono">{quote.symbol}</span>
      {quote.marketTs !== undefined && <span className="paper-trading-note">{quote.marketTs.replace('T', ' ').slice(0, 16)}</span>}
    </div>
    <div className="paper-trading-quote-body">
      <span className={change >= 0 ? 'is-up' : 'is-down'}>{props.money(quote.last)}</span>
      <span className={change >= 0 ? 'is-up' : 'is-down'}>{props.t('futures.quote.change', { change: change.toFixed(2) })}</span>
      {quote.preSettlement !== undefined && <span className="paper-trading-note">{props.t('futures.quote.preSettlement', { price: props.money(quote.preSettlement) })}</span>}
      {quote.openInterest !== undefined && <span className="paper-trading-note">{props.t('futures.quote.openInterest', { value: String(quote.openInterest) })}</span>}
    </div>
  </section>
}

function FuturesPreviewBlock(props: {
  preview: FuturesPreviewView | null
  busy: boolean
  t: MessageScope['t']
  money: (value: number) => string
  n: MessageScope['n']
}) {
  if (props.preview === null) {
    return props.busy ? <div className="paper-trading-empty">{props.t('preview.loading')}</div> : null
  }
  const preview = props.preview
  return <section className="paper-trading-preview">
    <div><span>{props.t('preview.price')}</span><strong className="paper-trading-mono">{props.money(preview.price)}</strong></div>
    <div><span>{props.t('futures.preview.amount')}</span><span className="paper-trading-mono">{props.money(preview.amountCents / 100)}</span></div>
    <div><span>{props.t('futures.preview.margin')}</span><strong className="paper-trading-mono">{props.money(preview.marginCents / 100)}</strong></div>
    <div><span>{props.t('futures.preview.fees')}</span><span className="paper-trading-mono">{props.money(preview.feesCents / 100)}</span></div>
    <div><span>{props.t('preview.cashAfter')}</span><span className="paper-trading-mono">{props.money(preview.cashAfterCents / 100)}</span></div>
    <div><span>{props.t('futures.preview.equityAfter')}</span><span className="paper-trading-mono">{props.money(preview.equityAfter)}</span></div>
    <div><span>{props.t('futures.preview.riskAfter')}</span><span className="paper-trading-mono">
      {props.n(preview.riskRatioAfter, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 })}
    </span></div>
    <div><span>{props.t('futures.preview.maxOpen')}</span><span className="paper-trading-mono">{props.n(preview.maxOpenQty)}</span></div>
    <div><span>{props.t('futures.preview.availableClose')}</span><span className="paper-trading-mono">{props.n(preview.availableCloseQty)}</span></div>
    {preview.limit !== undefined && <div>
      <span>{props.t('preview.priceLimit')}</span>
      <span className="paper-trading-mono">{props.money(preview.limit.lower)} – {props.money(preview.limit.upper)}</span>
    </div>}
    {preview.warnings.length === 0
      ? <p className="paper-trading-note">{props.t('preview.valid')}</p>
      : <p className="paper-trading-error-text" role="alert">{preview.warnings.join('；')}</p>}
  </section>
}

function FuturesReceipt(props: {
  order: FuturesOrderView
  t: MessageScope['t']
  money: (value: number) => string
  n: MessageScope['n']
  d: MessageScope['d']
}) {
  const order = props.order
  const state = order.status === 'rejected' ? 'rejected' : order.status === 'filled' ? 'filled' : 'pending'
  return <section className="paper-trading-receipt" data-state={state} aria-label={props.t('receipt.title')}>
    <div className="paper-trading-receipt-head">
      <strong>{props.t('receipt.title')}</strong>
      <span>{props.t(`orderStatus.${order.status}`)}</span>
    </div>
    <div className="paper-trading-receipt-body">
      <span className="paper-trading-mono">{order.symbol}</span>
      <span>{props.t(`futures.direction.${order.side}.${order.offset}`)} {props.n(order.qty)}</span>
      {order.fillPrice !== undefined && <span className="paper-trading-mono">{props.money(order.fillPrice)}</span>}
      <span className="paper-trading-note">{props.d(new Date(order.updatedAt), { hour: '2-digit', minute: '2-digit' })}</span>
    </div>
    {order.reason !== undefined && order.reason !== '' && <p className="paper-trading-error-text">{order.reason}</p>}
    {order.note !== undefined && order.note !== '' && <p className="paper-trading-note">{order.note}</p>}
  </section>
}

function FuturesTradesTable(props: {
  trades: readonly FuturesFillView[]
  t: MessageScope['t']
  money: (value: number) => string
  n: MessageScope['n']
  d: MessageScope['d']
}) {
  return <section className="paper-trading-trades">
    <h4 className="paper-trading-dialog-subtitle">{props.t('trades.title')}</h4>
    {props.trades.length === 0
      ? <div className="paper-trading-empty">{props.t('trades.empty')}</div>
      : <div className="paper-trading-table-wrap">
        <table className="paper-trading-table">
          <thead><tr>
            <th>{props.t('trades.time')}</th><th>{props.t('trades.symbol')}</th>
            <th>{props.t('orders.side')}</th><th className="is-num">{props.t('trades.price')}</th>
            <th className="is-num">{props.t('trades.qty')}</th>
          </tr></thead>
          <tbody>{props.trades.map(trade => <tr key={trade.id}>
            <td className="is-num">{props.d(new Date(trade.ts), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
            <td><span className="paper-trading-mono">{trade.symbol}</span> {trade.name}</td>
            <td>{props.t(`futures.direction.${trade.side}.${trade.offset}`)}</td>
            <td className="is-num paper-trading-mono">{props.money(trade.price)}</td>
            <td className="is-num">{props.n(trade.qty)}</td>
          </tr>)}</tbody>
        </table>
      </div>}
  </section>
}

function FuturesPositionsTable(props: {
  positions: readonly FuturesPositionView[]
  t: MessageScope['t']
  money: (value: number) => string
  n: MessageScope['n']
}) {
  if (props.positions.length === 0) return <div className="paper-trading-empty">{props.t('futures.positions.empty')}</div>
  return <div className="paper-trading-table-wrap">
    <table className="paper-trading-table">
      <thead><tr>
        <th>{props.t('positions.symbol')}</th><th>{props.t('futures.positions.side')}</th>
        <th className="is-num">{props.t('futures.positions.qty')}</th>
        <th className="is-num">{props.t('futures.positions.today')}</th>
        <th className="is-num">{props.t('positions.avgCost')}</th>
        <th className="is-num">{props.t('positions.lastPrice')}</th>
        <th className="is-num">{props.t('futures.positions.margin')}</th>
        <th className="is-num">{props.t('positions.pnl')}</th>
      </tr></thead>
      <tbody>{props.positions.map(position => <tr key={`${position.symbol}-${position.side}`}>
        <td><span className="paper-trading-mono">{position.symbol}</span> {position.name}</td>
        <td className={position.side === 'long' ? 'is-up' : 'is-down'}>{props.t(`futures.side.${position.side}`)}</td>
        <td className="is-num">{props.n(position.qty)}</td>
        <td className="is-num">{props.n(position.todayQty)}</td>
        <td className="is-num paper-trading-mono">{props.money(position.avgPrice)}</td>
        <td className="is-num paper-trading-mono">{position.lastPrice === undefined ? '—' : props.money(position.lastPrice)}</td>
        <td className="is-num paper-trading-mono">{props.money(position.marginCents / 100)}</td>
        <td className={`is-num paper-trading-mono ${(position.unrealizedPnlCents ?? 0) >= 0 ? 'is-up' : 'is-down'}`}>
          {props.money((position.unrealizedPnlCents ?? 0) / 100)}
        </td>
      </tr>)}</tbody>
    </table>
  </div>
}

function FuturesOrdersTable(props: {
  orders: readonly FuturesOrderView[]
  t: MessageScope['t']
  money: (value: number) => string
  n: MessageScope['n']
  d: MessageScope['d']
  busy: boolean
  onCancel: (orderId: string) => void
}) {
  if (props.orders.length === 0) return <div className="paper-trading-empty">{props.t('orders.empty')}</div>
  return <div className="paper-trading-table-wrap">
    <table className="paper-trading-table">
      <thead><tr>
        <th>{props.t('orders.time')}</th><th>{props.t('orders.symbol')}</th>
        <th>{props.t('orders.side')}</th><th>{props.t('orders.type')}</th>
        <th className="is-num">{props.t('orders.price')}</th><th className="is-num">{props.t('orders.qty')}</th>
        <th>{props.t('orders.status')}</th><th />
      </tr></thead>
      <tbody>{props.orders.map(order => <tr key={order.id}>
        <td className="is-num">{props.d(new Date(order.createdAt), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
        <td><span className="paper-trading-mono">{order.symbol}</span> {order.name}</td>
        <td>{props.t(`futures.direction.${order.side}.${order.offset}`)}</td>
        <td>{props.t(`orderType.${order.type}`)}</td>
        <td className="is-num paper-trading-mono">{order.limitPrice === undefined ? '—' : props.money(order.limitPrice)}</td>
        <td className="is-num">{props.n(order.qty)}</td>
        <td>{props.t(`orderStatus.${order.status}`)}</td>
        <td>{CANCELABLE.has(order.status) && <Button variant="ghost" size="2xs" disabled={props.busy}
          onClick={() => props.onCancel(order.id)}>{props.t('orders.cancel')}</Button>}</td>
      </tr>)}</tbody>
    </table>
  </div>
}

function FuturesReviewBlock(props: {
  review: FuturesReviewView | null
  money: (value: number) => string
  t: MessageScope['t']
  n: MessageScope['n']
}) {
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
      <Stat label={props.t('futures.review.winLoss')} value={`${props.n(review.winCount)} / ${props.n(review.lossCount)}`} />
    </section>
    <section className="paper-trading-chart" aria-label={props.t('review.equity')}>
      <div className="paper-trading-chart-scale"><span>{props.money(max)}</span><span>{props.money(min)}</span></div>
      <svg viewBox="0 0 600 160" preserveAspectRatio="none" role="img" aria-label={props.t('review.equity')}>
        <polyline points={polyline} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="paper-trading-chart-scale paper-trading-chart-scale-x">
        <span>{points[0]?.date ?? ''}</span><span>{points[points.length - 1]?.date ?? ''}</span>
      </div>
      <p className="paper-trading-note">{props.t('review.equityHint')}</p>
    </section>
    <section className="paper-trading-review-section">
      <h4 className="paper-trading-dialog-subtitle">{props.t('futures.review.byProduct')}</h4>
      {review.byProduct.length === 0
        ? <div className="paper-trading-empty">{props.t('review.empty')}</div>
        : <div className="paper-trading-table-wrap">
          <table className="paper-trading-table">
            <thead><tr>
              <th>{props.t('futures.review.product')}</th>
              <th className="is-num">{props.t('review.trades')}</th>
              <th className="is-num">{props.t('review.realizedPnl')}</th>
            </tr></thead>
            <tbody>{review.byProduct.map(row => <tr key={row.product}>
              <td>{row.product}</td>
              <td className="is-num">{props.n(row.tradeCount)}</td>
              <td className={`is-num paper-trading-mono ${row.realizedPnl >= 0 ? 'is-up' : 'is-down'}`}>{props.money(row.realizedPnl)}</td>
            </tr>)}</tbody>
          </table>
        </div>}
    </section>
  </>
}

function FuturesCashFlowTable(props: {
  flow: readonly FuturesCashFlowEntry[]
  money: (value: number) => string
  t: MessageScope['t']
  d: MessageScope['d']
}) {
  if (props.flow.length === 0) return <div className="paper-trading-empty">{props.t('cash.empty')}</div>
  return <div className="paper-trading-table-wrap paper-trading-dialog-table">
    <table className="paper-trading-table">
      <thead><tr>
        <th>{props.t('cash.time')}</th><th>{props.t('cash.type')}</th>
        <th className="is-num">{props.t('cash.amount')}</th><th className="is-num">{props.t('cash.balance')}</th>
      </tr></thead>
      <tbody>{props.flow.slice(-30).reverse().map((entry, index) => <tr key={`${entry.ts}-${index}`}>
        <td className="is-num">{props.d(new Date(entry.ts), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
        <td>{props.t(`cash.futuresKind.${entry.type}`)}</td>
        <td className={`is-num paper-trading-mono ${entry.amount < 0 ? 'is-down' : 'is-up'}`}>{props.money(entry.amount)}</td>
        <td className="is-num paper-trading-mono">{props.money(entry.balance)}</td>
      </tr>)}</tbody>
    </table>
  </div>
}

/** 期货资金：注资、提款与期货资金流水。 */
function FuturesCashDialog(props: {
  open: boolean
  onClose: () => void
  snapshot: BoardSnapshot
  t: MessageScope['t']
  money: (value: number) => string
  d: MessageScope['d']
  board: Board
  text: (code: string) => string
}) {
  const { t, snapshot, board, money, d } = props
  const [amount, setAmount] = useState('')
  const [error, setError] = useState('')
  const busy = snapshot.futures.busy === 'cash'
  const move = async (kind: 'deposit' | 'withdraw') => {
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) {
      setError('INVALID_ARGUMENT')
      return
    }
    setError(await (kind === 'deposit' ? board.depositFutures(value) : board.withdrawFutures(value)))
    setAmount('')
  }
  return <Dialog open={props.open} onOpenChange={open => { if (!open) props.onClose() }}>
    <DialogContent className="paper-trading-dialog">
      <DialogHeader><DialogTitle>{t('futures.cash.title')}</DialogTitle></DialogHeader>
      <div className="paper-trading-dialog-section">
        <div className="paper-trading-inline-form">
          <Input value={amount} inputMode="decimal" placeholder={t('cash.amount')} aria-label={t('cash.amount')}
            onChange={event => setAmount(event.target.value)} />
          <Button size="sm" disabled={busy} onClick={() => void move('deposit')}>{t('cash.deposit')}</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void move('withdraw')}>{t('cash.withdraw')}</Button>
        </div>
        {error !== '' && <p className="paper-trading-error-text" role="alert">{props.text(error)}</p>}
        <h4 className="paper-trading-dialog-subtitle">{t('cash.flowTitle')}</h4>
        <FuturesCashFlowTable flow={snapshot.futures.cashFlow} money={money} t={t} d={d} />
      </div>
      <DialogFooter><Button variant="ghost" size="sm" onClick={props.onClose}>{t('actions.close')}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}

/** 期货账本：备份、导出、从快照恢复与重置。 */
function FuturesLedgerDialog(props: {
  open: boolean
  onClose: () => void
  snapshot: BoardSnapshot
  t: MessageScope['t']
  money: (value: number) => string
  board: Board
  text: (code: string) => string
}) {
  const { t, snapshot, board, money } = props
  const [error, setError] = useState('')
  const [confirmName, setConfirmName] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const futures = snapshot.futures
  const ledger = futures.ledger
  const busy = futures.busy === 'ledger'
  const exported = futures.ledgerExport
  const run = async (pending: Promise<string>) => setError(await pending)
  const download = () => {
    if (exported?.content === undefined) return
    const blob = new Blob([exported.content], { type: 'application/x-ndjson' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'futures-events.jsonl'
    anchor.click()
    URL.revokeObjectURL(url)
  }
  return <Dialog open={props.open} onOpenChange={open => { if (!open) props.onClose() }}>
    <DialogContent className="paper-trading-dialog">
      <DialogHeader><DialogTitle>{t('futures.ledger.title')}</DialogTitle></DialogHeader>
      <div className="paper-trading-dialog-section">
        <p className="paper-trading-note paper-trading-break">
          {ledger?.path ?? futures.account?.ledgerPath ?? '—'}
        </p>
        <div className="paper-trading-inline-form">
          <Button size="sm" variant="outline" disabled={busy}
            onClick={() => void run(board.backupFuturesLedger())}>{t('ledger.backup')}</Button>
          <Button size="sm" variant="outline" disabled={busy}
            onClick={() => void run(board.exportFuturesLedger())}>{t('ledger.export')}</Button>
          {exported?.content !== undefined && <Button size="sm" variant="ghost" onClick={download}>{t('ledger.download')}</Button>}
        </div>
        {error !== '' && <p className="paper-trading-error-text" role="alert">{props.text(error)}</p>}
        <h4 className="paper-trading-dialog-subtitle">{t('ledger.snapshots')}</h4>
        {ledger === null || ledger.snapshots.length === 0
          ? <div className="paper-trading-empty">{t('ledger.empty')}</div>
          : <div className="paper-trading-table-wrap paper-trading-dialog-table">
            <table className="paper-trading-table">
              <thead><tr>
                <th>{t('ledger.snapshot')}</th><th className="is-num">{t('ledger.cash')}</th>
                <th className="is-num">{t('ledger.tradeDate')}</th><th>{t('ledger.state')}</th><th />
              </tr></thead>
              <tbody>{ledger.snapshots.map(view => <tr key={view.name}>
                <td className="paper-trading-mono">{view.name}</td>
                <td className="is-num paper-trading-mono">{money(view.cash)}</td>
                <td className="is-num">{view.tradeDate}</td>
                <td>{view.valid ? t('ledger.valid') : t('ledger.invalid')}</td>
                <td>{view.valid && (confirmName === view.name
                  ? <Button size="2xs" variant="destructive" disabled={busy}
                    onClick={() => void run(board.restoreFuturesLedger(view.name)).then(() => setConfirmName(''))}>
                    {t('ledger.restoreConfirm')}
                  </Button>
                  : <Button size="2xs" variant="ghost" disabled={busy || ledger.blocked}
                    onClick={() => setConfirmName(view.name)}>{t('ledger.restore')}</Button>)}</td>
              </tr>)}</tbody>
            </table>
          </div>}
        <h4 className="paper-trading-dialog-subtitle">{t('ledger.resetTitle')}</h4>
        <p className="paper-trading-note">{t('futures.ledger.resetHint')}</p>
        <div className="paper-trading-inline-form">
          <Button size="sm" variant={confirmReset ? 'destructive' : 'outline'} disabled={busy}
            onClick={async () => {
              if (!confirmReset) { setConfirmReset(true); return }
              await run(board.resetFuturesAccount())
              setConfirmReset(false)
            }}>{confirmReset ? t('ledger.resetConfirm') : t('ledger.reset')}</Button>
        </div>
      </div>
      <DialogFooter><Button variant="ghost" size="sm" onClick={props.onClose}>{t('actions.close')}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
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
