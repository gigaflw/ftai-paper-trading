/**
 * 模拟盘插件后端（Remote 命名空间 `ftaiPaperTrading`）。
 *
 * 账本、撮合、复盘、股票与期货两套服务都来自 dsh 版插件 v0.8.0 的共享层
 * （`src/core`、`src/store`、`src/service`、`src/data`、`src/agent`，按原样同步，
 * 位置与命名保持一致）；这里只做平台装配：
 * - 数据目录用 `ctx.localInstall.dataDir`，账本落在 `<dataDir>/paper-trading/`；
 * - FTShare 取数走 `ctx.ftshare.accessToken()` 的 Bearer 令牌（`platform/ftshare-client`），
 *   用户点「连接数据」后才把数据适配器接上，避免开页就弹授权；
 * - 对界面暴露 dsh 面板同款的 RPC 端点（`rpc(endpoint, payload, account)`），
 *   另保留一组与初版界面兼容的简化方法（board/quote/preview/placeOrder/cancel/review），
 *   界面完全迁到 RPC 端点后即可删除。
 * @module plugin-paper-trading
 */

import type { Context } from 'cordis'
import { Remote, RemoteError, TypertRemoteService } from '@ftai/plugin-sdk/host'
import { registerAccountTools } from './agent/account-tools.ts'
import { registerFuturesTools } from './agent/futures-tools.ts'
import { registerLedgerTools } from './agent/ledger-tools.ts'
import { registerPaperTools, type ServiceResolver, type ToolsLike } from './agent/tools.ts'
import { CachedMarketData } from './data/cached-market-data.ts'
import { FtshareFuturesMarketData } from './data/futures-market-data.ts'
import { FtshareMarketData } from './data/ftshare-market-data.ts'
import { FtshareTradingCalendar } from './data/ftshare-trading-calendar.ts'
import type { FuturesMarketDataPort } from './data/futures-market-data-port.ts'
import type { MarketDataPort } from './data/market-data-port.ts'
import type { TradingCalendarPort } from './data/trading-calendar-port.ts'
import { WeekdayTradingCalendar } from './data/trading-calendar-port.ts'
import { UnavailableFuturesMarketData } from './data/unavailable-futures-market-data.ts'
import { UnavailableMarketData } from './data/unavailable-market-data.ts'
import { createAccountsRpcHandler } from './service/accounts-rpc.ts'
import { createCompareRpcHandler } from './service/compare-rpc.ts'
import { PaperError } from './service/errors.ts'
import { FuturesService } from './service/futures-service.ts'
import { createFuturesRpcHandler } from './service/futures-rpc.ts'
import { PaperService } from './service/paper-service.ts'
import { createPaperRpcHandler, type PaperRpcHandler, type PaperRpcResolver } from './service/rpc.ts'
import { PaperScheduler } from './service/scheduler.ts'
import { AccountNotes } from './store/notes.ts'
import { AccountRegistry, DEFAULT_TICK_MS } from './store/accounts.ts'
import { AccountRepo } from './store/repo.ts'
import { FuturesRepo } from './store/futures-repo.ts'
import { ShortlistStore } from './store/shortlist.ts'
import { DEFAULT_SETTINGS, type AccountMeta, type RpcResult } from './contract.ts'
import { FUTURES_ACCOUNT_ID } from './futures-contract.ts'
import { createFtshareClient, FtshareUnavailableError, type FtshareLogger } from './platform/ftshare-client.ts'
import type { DataSourceView } from './types.ts'

export type * from './types.ts'

declare module 'cordis' {
  interface Context {
    ftaiPaperTrading: PaperTrading
  }
}

declare module '@ftai/plugin-sdk/host' {
  interface RemoteErrorDetailsMap {
    'paper-trading/rpc-failed': { code: string }
  }
}

/** 取令牌失败的错误码 → 界面的数据源状态。 */
function dataSourceStateOf(code: string): DataSourceView['state'] {
  if (code === 'ftshare/signed-out') return 'signed-out'
  if (code === 'ftshare/not-allowed' || code === 'plugin/capability-not-declared') return 'not-allowed'
  return 'unavailable'
}

export class PaperTrading extends TypertRemoteService {
  static inject = ['tools', 'ftshare', 'localInstall']

  private readonly logger
  private readonly registry: AccountRegistry
  private readonly notes: AccountNotes
  private readonly shortlist: ShortlistStore

  private market: MarketDataPort = new UnavailableMarketData()
  private calendar: TradingCalendarPort = new WeekdayTradingCalendar('未连接 FTShare 数据，按工作日估算')
  private futuresMarket: FuturesMarketDataPort = new UnavailableFuturesMarketData()

  private tickMs = DEFAULT_TICK_MS
  private dataReady = false
  private readonly stockServices = new Map<string, PaperService>()
  private readonly futuresService: FuturesService
  private readonly handler: PaperRpcHandler
  private readonly cached: CachedMarketData
  private readonly calendarPort: TradingCalendarPort
  private readonly schedulers: PaperScheduler[] = []

  constructor(ctx: Context) {
    super(ctx, 'ftaiPaperTrading')
    this.logger = ctx.logger('paper-trading')
    const home = ctx.localInstall.dataDir
    this.shortlist = new ShortlistStore(home)
    this.registry = new AccountRegistry({ home, logger: this.logger })
    this.notes = new AccountNotes({ home })
    const loggerAdapter = { warn: (message: string) => this.logger.warn(message) }

    // 数据端口放在稳定的槽位后面：适配器可以在用户授权后接上（或掉线），
    // 已经建好的服务、RPC 与工具都不用重建。
    const data: MarketDataPort = {
      quotes: symbols => this.market.quotes(symbols),
      dailyBars: (symbol, limit) => this.market.dailyBars(symbol, limit),
      minuteBars: (symbol, date) => this.market.minuteBars(symbol, date),
      search: (query, limit) => this.market.search(query, limit),
      marketList: input => this.market.marketList(input),
    }
    this.cached = new CachedMarketData(data, { ttlMs: () => this.tickMs })
    const calendar = () => this.calendar
    this.calendarPort = {
      get source() { return calendar().source },
      get status() { return calendar().status },
      isTradingDay: date => calendar().isTradingDay(date),
      nextTradingDay: date => calendar().nextTradingDay(date),
      tradingDays: (from, to) => calendar().tradingDays(from, to),
    }

    this.futuresService = new FuturesService({
      repo: new FuturesRepo({ home, logger: loggerAdapter }),
      data: {
        contracts: refresh => this.futuresMarket.contracts(refresh),
        quotes: symbols => this.futuresMarket.quotes(symbols),
        limits: symbols => this.futuresMarket.limits(symbols),
        settle: symbols => this.futuresMarket.settle(symbols),
        closes: (symbols, date) => this.futuresMarket.closes(symbols, date),
      },
      calendar: this.calendarPort,
      logger: loggerAdapter,
      isLocked: () => this.registry.lockedSync(FUTURES_ACCOUNT_ID),
    })
    const futuresHandler = createFuturesRpcHandler(this.futuresService)
    const resolveStock: PaperRpcResolver = async account => {
      const meta = await this.registry.resolve(account)
      if (meta.kind !== 'stock') throw new PaperError('INVALID_ARGUMENT', `账户「${meta.name}」不是股票账户`)
      return { service: this.stockService(meta), meta }
    }
    const paperHandler = createPaperRpcHandler(resolveStock, {
      dataSource: async () => {
        const view = await this.dataSource()
        return view.state === 'live' ? { state: 'configured' } : { state: view.state === 'unavailable' ? 'invalid' : 'none' }
      },
      notes: this.notes,
    })
    const accountsHandler = createAccountsRpcHandler(this.registry)
    const compareHandler = createCompareRpcHandler({
      accounts: async () => (await this.registry.view()).accounts.filter(meta => meta.kind === 'stock'),
      serviceOf: meta => this.stockService(meta),
    })
    // 与 dsh 面板同一套端点：期货、账户、对比各有自己的 handler，其余走股票 handler。
    this.handler = (endpoint, payload, signal, account) =>
      endpoint.startsWith('futures/')
        ? futuresHandler(endpoint, payload, signal)
        : endpoint.startsWith('accounts/')
          ? accountsHandler(endpoint, payload, signal, account)
          : endpoint.startsWith('compare/')
            ? compareHandler(endpoint, payload, signal, account)
            : paperHandler(endpoint, payload, signal, account)

    ctx.effect(() => {
      const stockScheduler = new PaperScheduler({
        logger: loggerAdapter,
        tick: async () => {
          const view = await this.registry.view({ includeArchived: true })
          for (const meta of view.accounts) {
            if (meta.kind !== 'stock') continue
            await this.stockService(meta).tick({ includePositions: false })
          }
        },
      })
      const futuresScheduler = new PaperScheduler({ logger: loggerAdapter, tick: () => this.futuresService.tick() })
      this.schedulers.push(stockScheduler, futuresScheduler)
      stockScheduler.start()
      futuresScheduler.start()
      return () => {
        for (const scheduler of this.schedulers) scheduler.stop()
        this.schedulers.length = 0
      }
    })

    ctx.effect(() => {
      void this.registry.tickMs().then(value => { this.tickMs = value }).catch(() => undefined)
      return () => undefined
    })

    ctx.effect(() => {
      const disposers: (() => void)[] = []
      const tools: ToolsLike = {
        register: definition => {
          disposers.push(ctx.tools.register(definition as Parameters<typeof ctx.tools.register>[0]))
        },
      }
      const resolveToolService: ServiceResolver = async account => (await resolveStock(account)).service
      registerPaperTools(tools, resolveToolService)
      registerAccountTools(tools, { registry: this.registry })
      registerFuturesTools(tools, this.futuresService)
      registerLedgerTools(tools, {
        resolve: async reference => {
          if (reference === 'futures') return { kind: 'futures', service: this.futuresService, accountId: FUTURES_ACCOUNT_ID }
          const resolved = await resolveStock(reference === undefined || reference === '' || reference === 'stock' ? undefined : reference)
          if (resolved.meta === undefined) throw new PaperError('INTERNAL', '账户解析缺少元数据')
          return { kind: 'stock', service: resolved.service, accountId: resolved.meta.id }
        },
      })
      return () => {
        for (const dispose of disposers.reverse()) dispose()
      }
    })
  }

  private stockService(meta: AccountMeta): PaperService {
    const existing = this.stockServices.get(meta.id)
    if (existing !== undefined) return existing
    const accountSettings = meta.initialCashCents === undefined
      ? DEFAULT_SETTINGS
      : { ...DEFAULT_SETTINGS, initialCashCents: meta.initialCashCents }
    const loggerAdapter = { warn: (message: string) => this.logger.warn(message) }
    const service = new PaperService({
      repo: new AccountRepo({ home: this.ctx.localInstall.dataDir, accountId: meta.id, logger: loggerAdapter }),
      data: this.cached,
      calendar: this.calendarPort,
      shortlist: this.shortlist,
      settings: accountSettings,
      accountId: meta.id,
      logger: loggerAdapter,
      isLocked: () => this.registry.lockedSync(meta.id),
      isArchived: () => this.registry.archivedSync(meta.id),
    })
    this.stockServices.set(meta.id, service)
    return service
  }

  /** RPC 调用：与 dsh 面板同一个端点表，返回 `RpcResult` 里的 value，失败换成 RemoteError。 */
  @Remote
  async rpc(endpoint: string, payload?: unknown, account?: string): Promise<unknown> {
    const result: RpcResult<unknown> = await this.handler(endpoint, payload, AbortSignal.timeout(60_000), account)
    if (result.ok) return result.value
    throw new RemoteError('paper-trading/rpc-failed', result.error.message, { code: result.error.code })
  }

  /** 数据源状态：只回答「令牌能不能拿到」，不把令牌或原因原文交给界面。 */
  @Remote
  async dataSource(): Promise<DataSourceView> {
    try {
      const token = await this.ctx.ftshare.accessToken()
      return { state: 'live', code: null, tokenExpiresAt: token.expiresAt }
    } catch (error) {
      const code = error instanceof FtshareUnavailableError ? error.code : 'ftshare/unavailable'
      return { state: dataSourceStateOf(code), code, tokenExpiresAt: null }
    }
  }

  /**
   * 连接 FTShare 数据：成功取到令牌后才把数据适配器接上。
   * 三方插件第一次调用会弹用户授权，所以只能由用户点「连接数据」触发。
   */
  @Remote
  async connectData(): Promise<DataSourceView> {
    let tokenExpiresAt: number | null = null
    try {
      tokenExpiresAt = (await this.ctx.ftshare.accessToken()).expiresAt
    } catch (error) {
      const code = error instanceof FtshareUnavailableError ? error.code : 'ftshare/unavailable'
      return { state: dataSourceStateOf(code), code, tokenExpiresAt: null }
    }
    await this.enableData()
    return { state: 'live', code: null, tokenExpiresAt }
  }

  private async enableData(): Promise<void> {
    if (this.dataReady) return
    const client = createFtshareClient({
      accessToken: async () => (await this.ctx.ftshare.accessToken()).token,
      logger: this.ftshareLogger(),
    })
    this.market = new FtshareMarketData(client)
    this.calendar = new FtshareTradingCalendar(client)
    this.futuresMarket = new FtshareFuturesMarketData(client)
    this.cached.clear()
    this.dataReady = true
  }

  private ftshareLogger(): FtshareLogger {
    return { warn: (message, details) => { this.logger.warn(message, details === undefined ? '' : details) } }
  }

}

export default PaperTrading
