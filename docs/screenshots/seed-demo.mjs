/**
 * 文档截图用的演示账本生成器。
 *
 * 只写走查目录的 plugin-data，不碰日常 FtAi 数据；写入前把原目录整体备份到
 * `paper-trading.bak-<时间戳>`，截完用 `--restore <备份目录>` 还原。
 *
 *   node docs/screenshots/seed-demo.mjs --apply
 *   node docs/screenshots/seed-demo.mjs --restore ~/ftai-walkthrough/paper-trading/host/plugin-data/%40dsh-ft%2Fftai-paper-trading/paper-trading.bak-20261125173000
 *
 * 生成内容：默认账户（有持仓、跨 5 个交易日的成交与资金流水）、进阶组合（第二个账户，
 * 供对比页使用）；期货账本保持原样或为空。数字都是为了截图好看，不追求撮合级精确。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const walkthroughArg = args.indexOf('--walkthrough')
const walkthrough = walkthroughArg >= 0 ? args[walkthroughArg + 1] : join(homedir(), 'ftai-walkthrough/paper-trading')
const pluginData = join(walkthrough, 'host/plugin-data/%40dsh-ft%2Fftai-paper-trading/paper-trading')
const restoreArg = args.indexOf('--restore')
const apply = args.includes('--apply')

function money(value) {
  return Math.round(value * 100)
}

function feesFor(amountCents, side) {
  const commissionCents = Math.max(500, Math.round(amountCents * 0.00025))
  const stampCents = side === 'sell' ? Math.round(amountCents * 0.0005) : 0
  const transferCents = Math.round(amountCents * 0.00001)
  return { commissionCents, stampCents, transferCents, totalCents: commissionCents + stampCents + transferCents }
}

const STOCK_SETTINGS = {
  initialCashCents: money(1_000_000), commissionRate: 0.00025, minCommissionCents: 500,
  stampDutyRate: 0.0005, transferFeeRate: 0.00001, enableT1: true, maxOrderNotionalCents: 0,
}

function stockLedger({ accountId, initialCash, days }) {
  const events = []
  const positions = new Map()
  let cash = money(initialCash)
  let seq = 0
  const push = (type, ts, payload) => {
    seq += 1
    events.push({ seq, id: `evt-${seq}`, ts, type, payload })
  }
  const settings = { ...STOCK_SETTINGS, initialCashCents: money(initialCash) }
  push('account.opened', `${days[0].date}T01:20:00.000Z`, {
    accountId, settings, initialCashCents: money(initialCash), tradeDate: days[0].date, ledgerVersion: 4,
  })
  for (const day of days) {
    push('day.opened', `${day.date}T01:30:00.000Z`, {
      date: day.date, openPrices: day.openPrices ?? {}, prevClose: {}, gaps: {}, t1Unlocked: true,
      recordedAt: `${day.date}T01:30:00.000Z`,
    })
    for (const trade of day.trades ?? []) {
      const orderId = `ord-${day.date}-${trade.symbol.replace(/\W/g, '')}`
      const fillId = `fill-${orderId}`
      const amountCents = money(trade.price * trade.qty)
      const fees = feesFor(amountCents, trade.side)
      const ts = `${day.date}T${trade.at ?? '06:40:00'}.000Z`
      const order = {
        id: orderId, requestId: `req-${orderId}`, symbol: trade.symbol, name: trade.name, side: trade.side,
        type: 'market', qty: trade.qty, status: 'pending', phase: 'continuous_am', note: trade.note,
        createdAt: ts, updatedAt: ts, filledQty: 0, remainingQty: trade.qty,
      }
      push('order.submitted', ts, { order })
      push('order.filled', ts, {
        orderId,
        fill: { id: fillId, orderId, symbol: trade.symbol, name: trade.name, side: trade.side, price: trade.price,
          qty: trade.qty, amountCents, fees, ts, tradeDate: day.date },
      })
      if (trade.side === 'buy') {
        const current = positions.get(trade.symbol) ?? { symbol: trade.symbol, name: trade.name, qty: 0, costCents: 0 }
        current.qty += trade.qty
        current.costCents += amountCents + fees.totalCents
        positions.set(trade.symbol, current)
        cash -= amountCents + fees.totalCents
      } else {
        const current = positions.get(trade.symbol)
        if (current !== undefined) {
          cash += amountCents - fees.totalCents
          current.qty -= trade.qty
          current.costCents = Math.max(0, Math.round(current.costCents * (current.qty / (current.qty + trade.qty))))
          if (current.qty <= 0) positions.delete(trade.symbol)
          else positions.set(trade.symbol, current)
        }
      }
    }
    for (const flow of day.cashFlows ?? []) {
      push(flow.type === 'deposit' ? 'cash.deposit' : 'cash.withdraw', `${day.date}T02:10:00.000Z`, {
        amountCents: money(flow.amount), tradeDate: day.date,
      })
      cash += flow.type === 'deposit' ? money(flow.amount) : -money(flow.amount)
    }
    const closePrices = day.closePrices ?? {}
    const snapshotPositions = [...positions.values()].map(position => ({
      symbol: position.symbol, name: position.name, qty: position.qty, available: position.qty,
      costCents: position.costCents, lastPrice: closePrices[position.symbol] ?? position.costCents / position.qty / 100,
    }))
    const marketValue = snapshotPositions.reduce((sum, position) => sum + money(position.qty * position.lastPrice), 0)
    const dayFees = (day.trades ?? []).reduce((sum, trade) => sum + feesFor(money(trade.price * trade.qty), trade.side).totalCents, 0)
      + (day.feesCentsExtra ?? 0)
    push('day.closed', `${day.date}T07:00:00.000Z`, {
      date: day.date, equityCents: cash + marketValue, cashCents: cash, nextDate: day.nextDate,
      feesCents: dayFees, closePrices, positions: snapshotPositions, gaps: {}, closeSource: 'last',
      recordedAt: `${day.date}T07:00:00.000Z`,
    })
  }
  return { events, lastClose: days[days.length - 1].closePrices, cash, positions }
}

const days = [
  {
    date: '2026-11-19', nextDate: '2026-11-20', openPrices: {},
    trades: [
      { symbol: '000001.SZ', name: '平安银行', side: 'buy', qty: 2000, price: 11.98 },
      { symbol: '600519.SH', name: '贵州茅台', side: 'buy', qty: 100, price: 1400 },
    ],
    closePrices: { '000001.SZ': 12.05, '600519.SH': 1538 },
  },
  {
    date: '2026-11-20', nextDate: '2026-11-23',
    openPrices: { '000001.SZ': 12.05, '600519.SH': 1538 },
    trades: [{ symbol: '300750.SZ', name: '宁德时代', side: 'buy', qty: 300, price: 208.6 }],
    closePrices: { '000001.SZ': 12.6, '600519.SH': 1580, '300750.SZ': 216 },
  },
  {
    date: '2026-11-23', nextDate: '2026-11-24',
    openPrices: { '000001.SZ': 12.6, '600519.SH': 1580, '300750.SZ': 216 },
    trades: [{ symbol: '000001.SZ', name: '平安银行', side: 'sell', qty: 1000, price: 12.42 }],
    closePrices: { '000001.SZ': 11.9, '600519.SH': 1470, '300750.SZ': 198 },
  },
  {
    date: '2026-11-24', nextDate: '2026-11-25',
    openPrices: { '000001.SZ': 11.9, '600519.SH': 1470, '300750.SZ': 198 },
    trades: [{ symbol: '000001.SZ', name: '平安银行', side: 'buy', qty: 500, price: 12.12 }],
    closePrices: { '000001.SZ': 12.3, '600519.SH': 1474, '300750.SZ': 195.5 },
  },
]

const growthDays = [
  {
    date: '2026-11-19', nextDate: '2026-11-20', openPrices: {},
    trades: [{ symbol: '600519.SH', name: '贵州茅台', side: 'buy', qty: 50, price: 1400 }],
    closePrices: { '600519.SH': 1538 },
  },
  {
    date: '2026-11-20', nextDate: '2026-11-23',
    openPrices: { '600519.SH': 1538 },
    trades: [{ symbol: '300750.SZ', name: '宁德时代', side: 'buy', qty: 200, price: 208.6 }],
    closePrices: { '600519.SH': 1580, '300750.SZ': 216 },
  },
  {
    date: '2026-11-23', nextDate: '2026-11-24',
    openPrices: { '600519.SH': 1580, '300750.SZ': 216 },
    trades: [
      { symbol: '600519.SH', name: '贵州茅台', side: 'sell', qty: 20, price: 1470 },
      { symbol: '000001.SZ', name: '平安银行', side: 'buy', qty: 1000, price: 11.9 },
    ],
    closePrices: { '000001.SZ': 11.9, '600519.SH': 1470, '300750.SZ': 198 },
  },
  {
    date: '2026-11-24', nextDate: '2026-11-25',
    openPrices: { '000001.SZ': 11.9, '600519.SH': 1470, '300750.SZ': 198 },
    trades: [{ symbol: '300750.SZ', name: '宁德时代', side: 'buy', qty: 100, price: 212 }],
    closePrices: { '000001.SZ': 12.3, '600519.SH': 1474, '300750.SZ': 195.5 },
  },
]

function futuresLedger() {
  const settings = {
    initialCashCents: money(1_000_000), marginUplift: 0, feeMultiplier: 1, warnRiskRatio: 0.8,
    liquidateRiskRatio: 1, closeBeforeDeListDays: 3, defaultFeePerLotCents: 0,
  }
  const events = []
  let seq = 0
  const push = (type, ts, payload) => {
    seq += 1
    events.push({ seq, id: `evt-${seq}`, ts, type, payload })
  }
  const terms = (symbol, name, product, multiplier, tickSize, marginRate) =>
    ({ symbol, name, product, multiplier, tickSize, marginRate, deListDate: '2026-12-31' })
  const rb = terms('RB2611.SHFE', '螺纹钢', 'rb', 10, 1, 0.13)
  const au = terms('AU2612.SHFE', '沪金', 'au', 1000, 0.02, 0.1)
  const fill = (orderId, term, side, offset, price, qty, marginCents, realizedPnlCents, ts, tradeDate) => ({
    id: `fill-${orderId}`, orderId, ...term, side, offset, price, qty,
    amountCents: money(price * term.multiplier * qty), feesCents: 0, marginCents,
    realizedPnlCents, closedTodayQty: 0, feeSource: 'default', feePerLotCents: 0,
    closeTodayFeePerLotCents: 0, ts, tradeDate,
  })
  const order = (id, term, side, offset, qty, price, marginCents, ts, tradeDate) => ({
    id, requestId: `req-${id}`, ...term, side, offset, type: 'market', qty, status: 'filled',
    createdAt: ts, updatedAt: ts, filledAt: ts, fillPrice: price, marginCents, feesCents: 0, tradeDate,
    feePerLotCents: 0, closeTodayFeePerLotCents: 0, feeSource: 'default',
  })
  const snapshot = (term, qty, avgPrice, lastPrice, marginCents) => ({
    symbol: term.symbol, name: term.name, product: term.product, side: 'long', qty, todayQty: 0,
    avgPrice, lastPrice, multiplier: term.multiplier, marginCents, marginRate: term.marginRate,
    deListDate: term.deListDate,
  })

  push('account.opened', '2026-11-24T01:20:00.000Z', {
    accountId: 'futures', settings, initialCashCents: money(1_000_000), tradeDate: '2026-11-24', ledgerVersion: 1,
  })
  push('day.opened', '2026-11-24T01:30:00.000Z', { date: '2026-11-24', openPrices: {}, recordedAt: '2026-11-24T01:30:00.000Z' })
  const rbOrder = order('fut-rb-open', rb, 'long', 'open', 2, 3250, 845_000, '2026-11-24T02:10:00.000Z', '2026-11-24')
  push('order.submitted', rbOrder.createdAt, { order: rbOrder })
  push('order.filled', rbOrder.createdAt, { orderId: rbOrder.id, fill: fill(rbOrder.id, rb, 'long', 'open', 3250, 2, 845_000, 0, rbOrder.createdAt, '2026-11-24') })
  const auOrder = order('fut-au-open', au, 'long', 'open', 1, 620, 6_200_000, '2026-11-24T02:20:00.000Z', '2026-11-24')
  push('order.submitted', auOrder.createdAt, { order: auOrder })
  push('order.filled', auOrder.createdAt, { orderId: auOrder.id, fill: fill(auOrder.id, au, 'long', 'open', 620, 1, 6_200_000, 0, auOrder.createdAt, '2026-11-24') })
  push('day.closed', '2026-11-24T07:00:00.000Z', {
    date: '2026-11-24', nextDate: '2026-11-25', equityCents: 99_780_000, cashCents: 92_955_000,
    marginCents: 7_045_000, feesCents: 0,
    closePrices: { 'RB2611.SHFE': 3240, 'AU2612.SHFE': 618 },
    positions: [snapshot(rb, 2, 3250, 3240, 845_000), snapshot(au, 1, 620, 618, 6_200_000)],
    closeSource: 'quote', liquidations: 0, warnings: [], recordedAt: '2026-11-24T07:00:00.000Z',
  })
  push('day.opened', '2026-11-25T01:30:00.000Z', {
    date: '2026-11-25', openPrices: { 'RB2611.SHFE': 3240, 'AU2612.SHFE': 618 }, recordedAt: '2026-11-25T01:30:00.000Z',
  })
  const closeOrder = order('fut-rb-close', rb, 'long', 'close', 1, 3290, 422_500, '2026-11-25T03:10:00.000Z', '2026-11-25')
  push('order.submitted', closeOrder.createdAt, { order: closeOrder })
  push('order.filled', closeOrder.createdAt, {
    orderId: closeOrder.id,
    fill: fill(closeOrder.id, rb, 'long', 'close', 3290, 1, 422_500, 40_000, closeOrder.createdAt, '2026-11-25'),
  })
  push('day.closed', '2026-11-25T07:00:00.000Z', {
    date: '2026-11-25', nextDate: '2026-11-26', equityCents: 100_680_000, cashCents: 93_417_500,
    marginCents: 6_622_500, feesCents: 0,
    closePrices: { 'RB2611.SHFE': 3290, 'AU2612.SHFE': 626 },
    positions: [snapshot(rb, 1, 3250, 3290, 422_500), snapshot(au, 1, 620, 626, 6_200_000)],
    closeSource: 'quote', liquidations: 0, warnings: [], recordedAt: '2026-11-25T07:00:00.000Z',
  })
  return { events }
}

function writeJsonl(file, events) {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, events.map(event => JSON.stringify(event)).join('\n') + '\n')
}

if (restoreArg >= 0) {
  const backup = args[restoreArg + 1]
  if (!backup || !existsSync(backup)) throw new Error(`备份目录不存在：${backup}`)
  rmSync(pluginData, { recursive: true, force: true })
  cpSync(backup, pluginData, { recursive: true })
  console.log(`已还原：${pluginData}`)
  process.exit(0)
}

if (!apply) {
  console.log('用法：node docs/screenshots/seed-demo.mjs --apply | --restore <备份目录> [--walkthrough DIR]')
  process.exit(0)
}

if (!existsSync(pluginData)) throw new Error(`找不到走查账本目录：${pluginData}`)
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = `${pluginData}.bak-${stamp}`
cpSync(pluginData, backup, { recursive: true })
console.log(`已备份：${backup}`)

rmSync(join(pluginData, 'growth'), { recursive: true, force: true })
writeJsonl(join(pluginData, 'default/events.jsonl'), stockLedger({ accountId: 'default', initialCash: 1_000_000, days }).events)
writeJsonl(join(pluginData, 'growth/events.jsonl'), stockLedger({ accountId: 'growth', initialCash: 500_000, days: growthDays }).events)
writeJsonl(join(pluginData, 'futures/events.jsonl'), futuresLedger().events)
const accountsPath = join(pluginData, 'accounts.json')
const registry = JSON.parse(readFileSync(accountsPath, 'utf8'))
registry.updatedAt = new Date().toISOString()
const futures = registry.accounts.find(account => account.kind === 'futures')
registry.accounts = [
  { id: 'default', kind: 'stock', name: '默认账户', createdAt: '2026-11-19T01:20:00.000Z', archived: false, locked: false },
  { id: 'growth', kind: 'stock', name: '进阶组合', createdAt: '2026-11-19T01:20:00.000Z', archived: false, locked: false },
  ...(futures === undefined ? [] : [futures]),
]
writeFileSync(accountsPath, JSON.stringify(registry, null, 2))
console.log('演示账本已写入；截完执行 --restore 还原。')
