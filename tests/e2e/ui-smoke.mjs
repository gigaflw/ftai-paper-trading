#!/usr/bin/env node
/**
 * 模拟交易面板 e2e（真实应用 + 真实账本）：参考 dsh 版 `tests/e2e` 的 CDP 走查脚本改写。
 *
 * 用例覆盖 dsh 面板的走查里能在本地面板完成的部分：布局、默认标的与自动取价、自动试算、
 * 下单/持仓/订单/复盘、非法代码提示、账户/资金/账本对话框、K 线栏拖动与折叠。
 * 不覆盖需要控制行情/时钟的场景（那需要假后端，见 dsh 版做法），也不点会改账号的按钮。
 *
 * 用法（在仓库根目录）：
 *   node packages/plugins/paper-trading/tests/e2e/ui-smoke.mjs --walkthrough ~/ftai-walkthrough/paper-trading
 */
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assert, connectApp, defaultWalkthrough, openPaperTrading, portFromWalkthrough, runSteps, shot, waitUntil } from './cdp.mjs'

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

const walkthrough = arg('walkthrough', defaultWalkthrough())
const port = Number(arg('port', '0')) || portFromWalkthrough(walkthrough)
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = arg('out', join(repoRoot, '.artifacts', 'e2e', stamp))
mkdirSync(outDir, { recursive: true })

const { browser, page } = await connectApp(port)
const context = { page, outDir }
const pageErrors = []
page.on('pageerror', error => pageErrors.push(String(error)))
page.on('console', message => {
  if (message.type() === 'error') pageErrors.push(message.text())
})

const input = () => page.locator('.paper-trading-form input#paper-symbol')
const quoteBox = () => page.locator('.paper-trading-quote')
const stats = () => page.locator('.paper-trading-stat')
const rail = () => page.locator('.paper-trading-rail')

const steps = [
  {
    name: '打开模拟交易',
    async run() {
      await openPaperTrading(page)
      await page.locator('.paper-trading-page').waitFor({ state: 'visible' })
      await shot(page, outDir, '01-open')
    },
  },
  {
    name: '布局：五张统计卡 / 四个标签 / 账户与右栏',
    async run() {
      assert(await stats().count() === 5, `统计卡应有 5 张，实际 ${await stats().count()}`)
      const labels = (await stats().allInnerTexts()).map(text => text.split('\n')[0]?.trim())
      for (const expected of ['总资产', '可用现金', '持仓市值', '今日盈亏', '累计盈亏']) {
        assert(labels.includes(expected), `统计卡缺少「${expected}」：${labels.join('/')}`)
      }
      const tabs = await page.getByRole('tab').allInnerTexts()
      for (const expected of ['交易', '持仓', '订单', '复盘']) {
        assert(tabs.some(text => text.trim() === expected), `标签缺少「${expected}」：${tabs.join('/')}`)
      }
      assert(await page.locator('.paper-trading-account-picker select').count() === 1, '缺少账户选择')
      assert(await rail().count() === 1, '缺少 K 线栏')
      await shot(page, outDir, '02-layout')
    },
  },
  {
    name: '交易表单：控件等高 / 方向类型同组件 / 限价占位',
    async run() {
      const form = page.locator('.paper-trading-form')
      const heights = await form.locator('input, .paper-trading-segmented, button').evaluateAll(els =>
        els.filter(el => !(el instanceof HTMLButtonElement) || el.classList.contains('paper-trading-segmented-option') === false && !el.closest('.paper-trading-segmented'))
          .map(el => Math.round(el.getBoundingClientRect().height)))
      const controlHeights = heights.filter(height => height > 0)
      assert(controlHeights.length >= 4, `控件太少：${controlHeights.join(',')}`)
      for (const height of controlHeights) {
        assert(Math.abs(height - 32) <= 1, `控件高度不是 32px：${controlHeights.join(',')}`)
      }
      const segmented = page.locator('.paper-trading-segmented')
      assert(await segmented.count() === 2, `方向/类型应共用 2 个分段控件，实际 ${await segmented.count()}`)
      for (let index = 0; index < 2; index += 1) {
        assert(await segmented.nth(index).locator('.paper-trading-segmented-option').count() === 2, '分段控件应有 2 个选项')
      }
      const limit = page.locator('#paper-limit')
      assert(await limit.isDisabled(), '市价时限价输入应禁用占位')
      assert((await limit.getAttribute('placeholder') ?? '').includes('市价按现价成交'), '限价占位文案不对')
      await page.getByRole('button', { name: '限价', exact: true }).click()
      await page.waitForTimeout(200)
      assert(await limit.isEnabled(), '切到限价后限价输入应可用')
      await shot(page, outDir, '02b-form')
      await page.getByRole('button', { name: '市价', exact: true }).click()
      await page.waitForTimeout(200)
      assert(await limit.isDisabled(), '切回市价后限价应禁回占位')
    },
  },
  {
    name: '默认标的自动加载（报价 + 日 K）',
    async run() {
      assert(await input().inputValue() === '600519', `默认代码应为 600519，实际 ${await input().inputValue()}`)
      const text = await waitUntil(async () => {
        const content = await quoteBox().innerText().catch(() => '')
        return content.includes('600519.SH') ? content : ''
      }, '默认标的报价（需要已登录并授权 FTShare）', 40_000)
      assert(/¥[\d,]+\.\d{2}/.test(text), `报价里没有价格：${text}`)
      const chart = await waitUntil(async () => await page.locator('.paper-trading-rail-chart').count() > 0, '右栏日 K', 40_000)
      assert(chart, '右栏没有渲染日 K')
      await shot(page, outDir, '03-default-quote')
    },
  },
  {
    name: '输入 000001 自动取行情并校验报价显示',
    async run() {
      await input().fill('000001')
      await waitUntil(async () => (await quoteBox().innerText().catch(() => '')).includes('000001.SZ'), '000001 报价', 20_000)
      const text = await quoteBox().innerText()
      assert(!/000001\.SZ\s+000001\.SZ/.test(text), `报价重复显示代码：${text}`)
      assert(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text), `行情时间仍是原始 ISO：${text}`)
      await shot(page, outDir, '04-query')
    },
  },
  {
    name: '自动试算：费用分项、可买与成交后可用',
    async run() {
      // 不再点「查询」「预览」：填完表单后 250ms 自动试算。
      const preview = page.locator('.paper-trading-preview')
      await preview.waitFor({ state: 'visible', timeout: 20_000 })
      const text = await preview.innerText()
      for (const expected of ['佣金', '印花税', '过户费', '费用合计', '成交后可用', '最多可买']) {
        assert(text.includes(expected), `预览缺少「${expected}」：${text}`)
      }
      await shot(page, outDir, '05-preview')
    },
  },
  {
    name: '提交市价单并出现在委托里',
    async run() {
      await page.getByRole('button', { name: '提交', exact: true }).click()
      const row = await waitUntil(async () => {
        const rows = await page.locator('.paper-trading-content .paper-trading-table tbody tr').allInnerTexts()
        return rows.find(text => text.includes('000001.SZ') && text.includes('已成交')) ?? rows.find(text => text.includes('000001.SZ')) ?? ''
      }, '委托表出现 000001.SZ', 25_000)
      assert(row.includes('000001.SZ'), `委托表没有新委托：${row}`)
      await shot(page, outDir, '06-order')
    },
  },
  {
    name: '持仓 / 订单 / 复盘标签',
    async run() {
      await page.getByRole('tab', { name: '持仓' }).click()
      await page.waitForTimeout(600)
      const positions = await page.locator('.paper-trading-content').innerText()
      assert(positions.includes('000001.SZ'), `持仓里没有 000001：${positions.slice(0, 300)}`)
      await page.getByRole('tab', { name: '订单' }).click()
      await page.waitForTimeout(600)
      const orders = await page.locator('.paper-trading-content').innerText()
      assert(orders.includes('000001.SZ'), '订单列表里没有 000001')
      await page.getByRole('tab', { name: '复盘' }).click()
      await page.locator('.paper-trading-chart').waitFor({ state: 'visible' })
      const review = await page.locator('.paper-trading-content').innerText()
      assert(review.includes('成交笔数'), '复盘缺少成交笔数')
      await shot(page, outDir, '07-review')
      await page.getByRole('tab', { name: '交易' }).click()
    },
  },
  {
    name: '非法代码提示',
    async run() {
      await input().fill('123456')
      await waitUntil(async () => (await page.locator('.paper-trading-error').innerText().catch(() => '')).includes('代码格式'), '非法代码提示', 10_000)
      await shot(page, outDir, '08-invalid')
      await input().fill('600519')
      await waitUntil(async () => (await quoteBox().innerText().catch(() => '')).includes('600519.SH'), '恢复 600519 报价', 20_000)
    },
  },
  {
    name: '账户 / 资金 / 账本对话框',
    async run() {
      await page.getByRole('button', { name: '账户', exact: true }).click()
      await page.getByRole('dialog').waitFor({ state: 'visible' })
      const accounts = await page.getByRole('dialog').innerText()
      assert(accounts.includes('账户管理'), `账户对话框缺少标题：${accounts.slice(0, 120)}`)
      assert(accounts.includes('默认账户'), '账户对话框没有列出默认账户')
      await shot(page, outDir, '09-accounts')
      await page.getByRole('button', { name: '关闭', exact: true }).click()

      await page.getByRole('button', { name: '资金', exact: true }).click()
      await page.getByRole('dialog').waitFor({ state: 'visible' })
      assert((await page.getByRole('dialog').innerText()).includes('资金流水'), '资金对话框缺少流水区')
      await shot(page, outDir, '09-cash')
      await page.getByRole('button', { name: '关闭', exact: true }).click()

      await page.getByRole('button', { name: '账本', exact: true }).click()
      await page.getByRole('dialog').waitFor({ state: 'visible' })
      const ledger = await page.getByRole('dialog').innerText()
      assert(ledger.includes('可恢复快照'), '账本对话框缺少快照区')
      assert(ledger.includes('重置账户'), '账本对话框缺少重置区')
      await shot(page, outDir, '09-ledger')
      await page.getByRole('button', { name: '关闭', exact: true }).click()
    },
  },
  {
    name: 'K 线栏拖动与折叠',
    async run() {
      // 先往右拖到最窄，再往左拖宽：不依赖上次运行留下的宽度与窗口大小。
      const drag = async (deltaX) => {
        const handle = await page.locator('.paper-trading-rail-resizer').boundingBox()
        assert(handle !== null, '没有拖动条')
        const startX = handle.x + handle.width / 2
        const startY = handle.y + handle.height / 2
        await page.mouse.move(startX, startY)
        await page.mouse.down()
        await page.mouse.move(startX + deltaX, startY, { steps: 10 })
        await page.mouse.up()
        await page.waitForTimeout(400)
        return rail().boundingBox()
      }
      const before = await rail().boundingBox()
      assert(before !== null, '拿不到 K 线栏位置')
      const narrow = await drag(+400)
      assert(narrow !== null && narrow.width <= before.width - 80, `往右拖没有变窄：${before.width} → ${narrow?.width}`)
      const after = await drag(-400)
      assert(after !== null && after.width >= narrow.width + 80, `往左拖没有变宽：${narrow.width} → ${after?.width}`)
      // 主列变窄后，交易区要么并排要么堆叠，不能出现表单盖住报价卡。
      const formBox = await page.locator('.paper-trading-form-card').boundingBox()
      const quoteBox2 = await quoteBox().boundingBox()
      assert(formBox !== null && quoteBox2 !== null, '拿不到表单/报价卡位置')
      const stacked = quoteBox2.y >= formBox.y + formBox.height - 4
      const sideBySide = quoteBox2.x >= formBox.x + formBox.width - 4
      assert(stacked || sideBySide, `拖动后表单与报价卡重叠：form=${JSON.stringify(formBox)} quote=${JSON.stringify(quoteBox2)}`)
      await page.getByRole('button', { name: '收起' }).click()
      await page.waitForTimeout(400)
      const collapsed = await rail().boundingBox()
      assert(collapsed !== null && collapsed.width <= 48, `折叠后宽度不对：${collapsed?.width}`)
      assert(await page.locator('.paper-trading-rail-label').isVisible(), '折叠后没有竖排标签')
      await page.getByRole('button', { name: '展开' }).click()
      await page.waitForTimeout(400)
      const expanded = await rail().boundingBox()
      assert(expanded !== null && expanded.width >= 200, `展开后宽度不对：${expanded?.width}`)
      await shot(page, outDir, '10-rail')
    },
  },
]

const code = await runSteps(steps, context)
console.log(`页面错误 ${pageErrors.length} 条${pageErrors.length === 0 ? '' : `：${pageErrors.slice(0, 3).join(' | ')}`}`)
await browser.close()
process.exit(code)
