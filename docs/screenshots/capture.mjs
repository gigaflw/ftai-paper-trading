/**
 * 文档截图：连接已启动的走查实例，按固定视口截交易页、期货、对比页并缩到 1600 宽。
 *
 * 行情不可用时自动跳过依赖行情的两张（交易页 / 期货试算），只截对比与期货持仓，
 * 并在输出里说明跳过了什么。数据与启动由 `run-capture.sh` 负责。
 *
 *   node docs/screenshots/capture.mjs [--walkthrough DIR] [--out DIR]
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { chromium } from '@playwright/test'
import { openPaperTrading } from '../../tests/e2e/cdp.mjs'

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

const walkthrough = arg('walkthrough', process.env.FTAI_WALKTHROUGH ?? join(process.env.HOME, 'ftai-walkthrough/paper-trading'))
const out = arg('out', 'docs/screenshots')
const port = Number(readFileSync(join(walkthrough, 'userData/DevToolsActivePort'), 'utf8').split('\n')[0])
mkdirSync(out, { recursive: true })

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
let page
for (let attempt = 0; attempt < 30 && page === undefined; attempt += 1) {
  for (const context of browser.contexts()) {
    page = context.pages().find(candidate => candidate.url().startsWith('ftai-app:'))
    if (page !== undefined) break
  }
  if (page === undefined) await new Promise(resolve => setTimeout(resolve, 1000))
}
if (page === undefined) throw new Error('没有找到 ftai-app 页面')
page.setDefaultTimeout(30_000)

const cdp = await page.context().newCDPSession(page)
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1180, deviceScaleFactor: 2, mobile: false })
await page.reload()
await page.waitForTimeout(5000)
await openPaperTrading(page)
await page.locator('.paper-trading-page').waitFor({ state: 'visible' })
await page.waitForTimeout(2500)

async function shot(name) {
  const file = join(out, name)
  await page.screenshot({ path: file })
  // 2x 截图为 3200 宽，统一收到 1600；macOS 自带 sips。
  execFileSync('sips', ['-Z', '1600', file], { stdio: 'ignore' })
  console.log(`captured ${name}`)
}

// 行情探测：拿不到报价就不截依赖行情的图，避免文档里出现报错横幅。
await page.locator('#paper-symbol').fill('600519')
await page.waitForTimeout(4000)
const quoteReady = await page.locator('.paper-trading-quote').count() > 0
if (!quoteReady) console.log('行情不可用：跳过 trade.png 与 futures-trade.png')

if (quoteReady) {
  await page.locator('#paper-qty').fill('100')
  await page.locator('.paper-trading-preview').waitFor({ state: 'visible' })
  await page.waitForTimeout(1000)
  await page.getByRole('button', { name: '提交', exact: true }).click().catch(() => {})
  await page.waitForTimeout(2500)
  await page.locator('#paper-qty').fill('200')
  await page.locator('.paper-trading-preview').waitFor({ state: 'visible' })
  await page.waitForTimeout(1200)
  await shot('trade.png')
}

await page.getByRole('tab', { name: '对比' }).click()
await page.locator('.paper-trading-compare').waitFor({ state: 'visible' })
await page.getByRole('button', { name: '收起' }).click().catch(() => {})
await page.waitForTimeout(1500)
await shot('compare.png')
// 收起只是为截图，展开回去，避免把折叠状态留给下一次 e2e。
await page.getByRole('button', { name: '展开' }).click().catch(() => {})

await page.getByRole('button', { name: '期货', exact: true }).click()
await page.locator('.paper-trading-futures').waitFor({ state: 'visible' })
if (quoteReady) {
  await page.locator('#futures-symbol').fill('rb')
  await page.locator('.paper-trading-futures .paper-trading-hit').first().waitFor({ state: 'visible' })
  await page.locator('.paper-trading-futures .paper-trading-hit').first().click()
  await page.locator('#futures-qty').fill('2')
  await page.locator('.paper-trading-futures .paper-trading-preview').waitFor({ state: 'visible' })
  await page.waitForTimeout(1000)
  await shot('futures-trade.png')
}
await page.locator('.paper-trading-futures [role="tab"]', { hasText: '持仓' }).click()
await page.locator('.paper-trading-futures table').waitFor({ state: 'visible' })
await page.waitForTimeout(1000)
await shot('futures.png')

await browser.close()
