/**
 * 面板 e2e 的 CDP 驱动原语：连接已带调试口启动的 FtAi Desktop，操作页面并断言。
 *
 * 只经 Playwright 的 CDP 连接操作真实应用，不修改应用代码，也不读内部状态；
 * 选择器一律用插件自己的 `paper-trading-*` 类名与可访问名称，避免撞到应用其他页面。
 * @module paper-trading/tests/e2e/cdp
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { chromium } from '@playwright/test'

/** 默认走查目录；可用 `--walkthrough` 或 `FTAI_WALKTHROUGH` 覆盖。 */
export function defaultWalkthrough() {
  return process.env.FTAI_WALKTHROUGH ?? join(homedir(), 'ftai-walkthrough/paper-trading')
}

/** 从走查目录的 `DevToolsActivePort` 读调试端口（应用启动时用 `--remote-debugging-port=0`）。 */
export function portFromWalkthrough(walkthrough) {
  const file = join(walkthrough, 'userData/DevToolsActivePort')
  const port = Number(readFileSync(file, 'utf8').split('\n')[0]?.trim())
  if (!Number.isInteger(port) || port <= 0) throw new Error(`DevToolsActivePort 内容不是端口：${file}`)
  return port
}

/** 连上应用并返回主页面（`ftai-app://app/`）。 */
export async function connectApp(port) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  const page = browser.contexts()[0]?.pages().find(candidate => candidate.url().startsWith('ftai-app:'))
  if (page === undefined) throw new Error('没有找到 ftai-app:// 页面，应用可能还在启动或调试口不对')
  page.setDefaultTimeout(15_000)
  return { browser, page }
}

/** 断言：失败时抛出带步骤名的错误，由 runner 汇总。 */
export function assert(condition, message) {
  if (!condition) throw new Error(message)
}

/** 等一个条件成立；超时时报出 label 与最后的实际值。 */
export async function waitUntil(action, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    try {
      const value = await action()
      if (value) return value
      last = String(value)
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    await new Promise(resolve => setTimeout(resolve, 300))
  }
  throw new Error(`等待超时：${label}（最后结果：${last.slice(0, 200)}）`)
}

/** 截图到本次输出目录。 */
export async function shot(page, outDir, name) {
  mkdirSync(outDir, { recursive: true })
  const file = join(outDir, `${name}.png`)
  await page.screenshot({ path: file })
  return file
}

/** 进入「模拟交易」一级视图；已在视图里时直接返回。 */
export async function openPaperTrading(page) {
  if (await page.locator('.paper-trading-page').count() === 0) {
    await page.getByRole('button', { name: '模拟交易', exact: true }).click()
  }
  await page.locator('.paper-trading-page').waitFor({ state: 'visible', timeout: 15_000 })
}

/** 依次执行步骤并汇总 PASS/FAIL；返回退出码。 */
export async function runSteps(steps, context) {
  const results = []
  for (const step of steps) {
    try {
      await step.run(context)
      results.push({ name: step.name, ok: true })
      console.log(`PASS ${step.name}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      results.push({ name: step.name, ok: false, message })
      console.error(`FAIL ${step.name}: ${message}`)
      if (context.page !== undefined) {
        await context.page.screenshot({ path: join(context.outDir, `FAIL-${step.name.replace(/\W+/g, '-')}.png`) }).catch(() => undefined)
      }
    }
  }
  const failed = results.filter(result => !result.ok)
  console.log(`\n${results.length - failed.length}/${results.length} 通过，截图：${context.outDir}`)
  return failed.length === 0 ? 0 : 1
}
