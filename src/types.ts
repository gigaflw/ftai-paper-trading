/**
 * 前后端共用的边界类型。
 *
 * 业务视图直接复用共享层契约（与 dsh 版插件同一份 `contract/`），界面只经
 * `@clrstn2830h/plugin-paper-trading/types` 以 `import type` 引用；这里不再重复定义账户、
 * 委托、持仓、复盘等形状，只补平台自己的数据源状态与页面枚举。
 * @module @clrstn2830h/plugin-paper-trading/types
 */

export type {
  AccountKind, AccountMeta, AccountsView, AccountView, Bar, DataProblem, DataSourceStatus,
  FillView, MarketStatus, OrderDraft, OrderType, OrderView, Period, PositionView, PreviewView,
  Quote, ReviewView, SessionPhase, Side,
} from './contract.ts'

/** 复盘区间：与共享层 `Period` 同义。 */
export type { Period as ReviewPeriod } from './contract.ts'

/** 页面标签。 */
export type TabKey = 'trade' | 'positions' | 'orders' | 'review'

/** 平台自己的数据源状态：`live` 已拿到 FTShare 令牌；`stub` 还没连接。 */
export interface DataSourceView {
  state: 'live' | 'stub' | 'signed-out' | 'not-allowed' | 'unavailable'
  /** 取令牌失败时的稳定错误码（如 `ftshare/signed-out`）；可用时为 null。 */
  code: string | null
  /** 令牌到期时间（Unix 毫秒）；没有拿到令牌为 null。 */
  tokenExpiresAt: number | null
}
