/**
 * FTShare 网关的 MCP 传输层（平台适配层）。
 *
 * 共享层（`src/data/**`）只依赖结构类型 `FtshareDataLike`，这里把它接到 FtAi 的
 * `ctx.ftshare.accessToken()`：每次调用开新会话并带 `Authorization: Bearer <令牌>`，
 * 不缓存会话与令牌。四态归一、载荷观测与失败分类沿用 dsh 版插件
 * `@dsh-ft/dsh-fft-ftshare` 的规则：`empty` 必须有正向证据，401/403 才算 `denied`。
 * @module @clrstn2830h/plugin-paper-trading/platform/ftshare-client
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

/** FTShare 的 MCP StreamableHTTP 入口。 */
export const FTSHARE_ENDPOINT = 'https://market.ft.tech/gateway/mcp'
/** 单次调用的上限：源插件实测会话失效时能挂到约 950 秒。 */
const CALL_DEADLINE_MS = 60_000
/** 接口清单缓存：只用来回答「上游认不认这个名字」。 */
const TOOLS_TTL_MS = 5 * 60_000
const PAYLOAD_KEYS = ['data', 'rows', 'items', 'records', 'list', 'result', 'payload', 'response']
const ENVELOPE_KEYS = new Set(['ok', 'success', 'cached', 'metadata', 'message', 'error', 'code', 'status', 'request_id', 'permission', 'permissions', 'source'])

export type FtshareRow = Record<string, unknown>
export type FtshareState = 'available' | 'empty' | 'denied' | 'failed'

/** 与共享层 `FtshareDataLike` 的结构保持一致的失败提示。 */
export interface FtshareNotice {
  code: string
  message: string
  status?: number
}

export interface FtshareCallResult {
  ok: boolean
  state: FtshareState
  rows: FtshareRow[]
  notice?: FtshareNotice
}

export interface FtshareToolInfo {
  tool: string
  title: string
  description?: string
  inputSchema?: unknown
}

/** 宿主日志的最小接口。 */
export interface FtshareLogger {
  warn(message: string, details?: unknown): void
}

export interface FtshareClientOptions {
  /** 取当前用户的 FTShare 短期令牌；拿不到时抛错（错误带 `code`，如 `ftshare/signed-out`）。 */
  accessToken(): Promise<string>
  logger?: FtshareLogger
  endpoint?: string
}

/** 令牌或上游不可用：调用方据此决定是报错还是降级。 */
export class FtshareUnavailableError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'FtshareUnavailableError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function codeOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code
  }
  return 'ftshare/unavailable'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function records(value: unknown[]): FtshareRow[] {
  return value.filter(isRecord)
}

interface Observation {
  rows: FtshareRow[]
  emptyEvidence: boolean
  keys: string[]
}

/** 观察上游载荷：有没有行、空是否有正向证据、顶层键是什么。 */
function observePayload(value: unknown, depth = 0): Observation {
  if (Array.isArray(value)) return { rows: records(value), emptyEvidence: value.length === 0, keys: [] }
  if (!isRecord(value)) return { rows: [], emptyEvidence: false, keys: [] }
  const keys = Object.keys(value)
  if (depth < 3) {
    for (const key of PAYLOAD_KEYS) {
      if (!(key in value)) continue
      const child = value[key]
      if (Array.isArray(child)) return { rows: records(child), emptyEvidence: child.length === 0, keys }
      if (isRecord(child)) {
        const nested = observePayload(child, depth + 1)
        if (nested.rows.length > 0 || nested.emptyEvidence) return { ...nested, keys }
      }
    }
  }
  for (const [key, candidate] of Object.entries(value)) {
    if (ENVELOPE_KEYS.has(key) || !Array.isArray(candidate)) continue
    const rows = records(candidate)
    if (rows.length > 0) return { rows, emptyEvidence: false, keys }
  }
  const meaningful = keys.filter(key => !ENVELOPE_KEYS.has(key) && !PAYLOAD_KEYS.includes(key) && !Array.isArray(value[key]))
  if (meaningful.length > 0) return { rows: [value], emptyEvidence: false, keys }
  return { rows: [], emptyEvidence: false, keys }
}

/** 成功信封里的显式权限标记：这是 denied，不是没有数据。 */
function permissionNoticeOf(tool: string, value: unknown): FtshareNotice | undefined {
  if (!isRecord(value)) return undefined
  const candidates: FtshareRow[] = [value]
  const metadata = value.metadata
  if (isRecord(metadata)) {
    candidates.push(metadata)
    if (Array.isArray(metadata.permissions)) candidates.push(...metadata.permissions.filter(isRecord))
    if (isRecord(metadata.permission)) candidates.push(metadata.permission)
  }
  if (isRecord(value.permission)) candidates.push(value.permission)
  if (Array.isArray(value.permissions)) candidates.push(...value.permissions.filter(isRecord))
  for (const record of candidates) {
    const marked = [record.access_denied, record.accessDenied, record.permission_denied, record.permissionDenied,
      record.subscription_required, record.subscriptionRequired, record.upgrade_required, record.upgradeRequired]
      .some(flag => flag === true)
    const code = typeof record.code === 'number' ? String(record.code) : asText(record.code) ?? asText(record.error_code)
    const rawStatus = record.status ?? record.upstream_code ?? code
    const status = typeof rawStatus === 'number' && rawStatus >= 100 && rawStatus <= 599
      ? rawStatus
      : typeof rawStatus === 'string' && /^\d{3}$/.test(rawStatus) ? Number(rawStatus) : undefined
    if (!(marked || status === 401 || status === 403)) continue
    return {
      code: code ?? String(status ?? 'permission'),
      message: `FTShare 网关对 ${tool} 返回了权限限制：${asText(record.message) ?? asText(record.reason) ?? '（未给说明）'}`,
      ...(status === undefined ? {} : { status }),
    }
  }
  return undefined
}

/** 失败分类：只认 HTTP 语义（401/403 与明确的权限错误码），其余都算 failed。 */
function classifyFailure(error: unknown, tool: string): { state: FtshareState, notice: FtshareNotice } {
  const message = messageOf(error)
  const matched = /(^|\D)(401|403)(\D|$)/.exec(message)
  const status = typeof error === 'object' && error !== null && typeof (error as { status?: unknown }).status === 'number'
    ? (error as { status: number }).status
    : matched === null ? undefined : Number(matched[2])
  const code = codeOf(error)
  if (status === 401 || status === 403 || code === 'ftshare/signed-out' || code === 'ftshare/not-allowed' || code === 'plugin/capability-not-declared') {
    return { state: 'denied', notice: { code, message: message.slice(0, 1000) } }
  }
  return { state: 'failed', notice: { code, message: message.slice(0, 1000) } }
}

function textFromContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .filter((block): block is Record<string, unknown> => isRecord(block) && block.type === 'text' && typeof block.text === 'string')
    .map(block => String(block.text))
    .join('\n')
    .trim()
}

/** 取结构化载荷：优先 `structuredContent`，缺失时把文本当 JSON 解析。 */
function payloadOf(result: unknown): unknown {
  const record = isRecord(result) ? result : {}
  if (isRecord(record.structuredContent)) return record.structuredContent
  const text = textFromContent(record.content)
  if (text !== '' && /^[[{]/u.test(text)) {
    try {
      return JSON.parse(text)
    } catch {
      return record.structuredContent
    }
  }
  return record.structuredContent
}

export interface FtshareClient {
  /** 调一个上游接口；不抛异常（除非令牌取不到），失败走 `state`/`notice`。 */
  call(tool: string, args?: Record<string, unknown>, signal?: AbortSignal): Promise<FtshareCallResult>
  /** 上游接口清单；令牌取不到时抛 `FtshareUnavailableError`。 */
  listTools(): Promise<FtshareToolInfo[]>
}

/** 建一个 FTShare 客户端；只用于共享层的数据适配器。 */
export function createFtshareClient(options: FtshareClientOptions): FtshareClient {
  const endpoint = options.endpoint ?? FTSHARE_ENDPOINT
  let toolsCache: { tools: FtshareToolInfo[], at: number } | undefined

  async function token(): Promise<string> {
    try {
      return await options.accessToken()
    } catch (error) {
      throw new FtshareUnavailableError(codeOf(error), messageOf(error))
    }
  }

  async function connect(): Promise<Client> {
    const accessToken = await token()
    const client = new Client({ name: 'ftai-paper-trading', version: '0.2.0' })
    const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
      requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
    })
    // SDK 的 Transport 类型在 exactOptionalPropertyTypes 下与 connect 的形参不一致，这里按形参收窄
    await client.connect(transport as unknown as Parameters<Client['connect']>[0])
    return client
  }

  return {
    async call(tool, args = {}, signal) {
      if (signal?.aborted === true) throw new FtshareUnavailableError('ftshare/cancelled', `FTShare ${tool} 调用前已被取消`)
      const client = await connect()
      try {
        const timeout = AbortSignal.timeout(CALL_DEADLINE_MS)
        const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
        const result = await client.callTool({ name: tool, arguments: args }, undefined, { signal: combined })
        if ((result as { isError?: boolean }).isError === true) throw new Error(textFromContent((result as { content?: unknown }).content) || `${tool} 返回 MCP 错误`)
        const value = payloadOf(result)
        if (value === undefined) throw new Error(`${tool} 未返回 structuredContent，也没有可解析的文本载荷`)
        const observation = observePayload(value)
        if (observation.rows.length > 0) return { ok: true, state: 'available', rows: observation.rows }
        const gated = permissionNoticeOf(tool, value)
        if (gated !== undefined) return { ok: false, state: 'denied', rows: [], notice: gated }
        if (observation.emptyEvidence) return { ok: true, state: 'empty', rows: [] }
        return {
          ok: false, state: 'failed', rows: [],
          notice: { code: 'unrecognized-payload', message: `上游返回成功，但没有可识别的数据容器（顶层键：${observation.keys.join('、') || '无'}）` },
        }
      } catch (error) {
        if (error instanceof FtshareUnavailableError) throw error
        const { state, notice } = classifyFailure(error, tool)
        options.logger?.warn('ftshare.call_failed', { tool, state, code: notice.code, message: notice.message.slice(0, 500) })
        return { ok: false, state, rows: [], notice }
      } finally {
        await client.close().catch(() => undefined)
      }
    },
    async listTools() {
      if (toolsCache !== undefined && Date.now() - toolsCache.at < TOOLS_TTL_MS) return toolsCache.tools
      const client = await connect()
      try {
        const listed = await client.listTools()
        const tools: FtshareToolInfo[] = []
        for (const entry of Array.isArray(listed.tools) ? listed.tools : []) {
          if (!isRecord(entry)) continue
          const tool = asText(entry.name)
          if (tool === undefined) continue
          const description = asText(entry.description)
          tools.push({
            tool,
            title: asText(entry.title) ?? tool,
            ...(description === undefined ? {} : { description }),
            ...(entry.inputSchema === undefined ? {} : { inputSchema: entry.inputSchema }),
          })
        }
        toolsCache = { tools, at: Date.now() }
        return tools
      } catch (error) {
        if (error instanceof FtshareUnavailableError) throw error
        options.logger?.warn('ftshare.list_tools_failed', { message: messageOf(error) })
        return toolsCache?.tools ?? []
      } finally {
        await client.close().catch(() => undefined)
      }
    },
  }
}
