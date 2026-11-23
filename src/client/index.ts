/**
 * 模拟交易（功能 id `paper-trading`）：一级视图、设置页与 remote 绑定。
 *
 * 界面走与 dsh 面板同一套 RPC 端点（`rpc(endpoint, payload, account)`），
 * 另用宿主一半的 `connectData`/`dataSource` 管理 FTShare 令牌授权。
 * 注册与绑定都挂在调用方作用域上，插件停用或热替换时自动撤销。
 * @module @clrstn2830h/plugin-paper-trading/client
 */

import type { Context } from 'cordis'
import { preferences } from '@ftai/plugin-sdk/app'
import type {} from '@ftai/plugin-sdk/features'
import type {} from '@ftai/plugin-sdk/remote'
import type {} from '@clrstn2830h/plugin-paper-trading/remote'
import { IconReportMoney, IconReportMoneyFilled } from '@tabler/icons-react'
import { createBoard } from './state.ts'
import { createViews } from './Views.tsx'
import zhCN from './i18n/zh-CN.ts'
import enUS from './i18n/en-US.ts'
import zhMeta from '../../locale/zh-CN.json'
import enMeta from '../../locale/en.json'
import './style.css'

export const name = '@clrstn2830h/plugin-paper-trading'
export const inject = ['ftaiFeatures', 'remote']

export function apply(ctx: Context) {
  const messages = ctx.ftaiFeatures.createMessageScope({ 'zh-CN': zhCN, 'en-US': enUS })
  const board = createBoard()
  const { Dashboard, Settings } = createViews(messages, board, preferences('paper-trading'))
  const label = () => (messages.locale() === 'zh-CN' ? zhMeta : enMeta).meta

  ctx.ftaiFeatures.register({
    id: 'paper-trading',
    name: () => label().title,
    description: () => label().description,
    view: {
      component: Dashboard,
      rail: {
        label: () => messages.t('feature.title'),
        icon: IconReportMoney,
        activeIcon: IconReportMoneyFilled,
        order: 30,
      },
      toolbar: () => ({ title: () => messages.t('feature.title') }),
    },
    settings: {
      label: () => messages.t('settings.title'),
      icon: IconReportMoney,
      group: 'integrations',
      order: 80,
      component: Settings,
    },
  })

  ctx.effect(() => () => board.dispose(), 'paper-trading: React state')

  // 命名空间由宿主一半挂上；撤销时只解绑本次登记，不覆盖后来接手的调用端口。
  ctx.inject(['remote.ftaiPaperTrading'], scope => {
    const host = scope.remote.ftaiPaperTrading
    scope.effect(() => board.bind({
      rpc: (endpoint, payload, account) => host.rpc(endpoint, payload, account),
      connectData: () => host.connectData(),
      dataSource: () => host.dataSource(),
    }), 'paper-trading: remote')
  })
}
