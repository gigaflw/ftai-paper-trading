# @ftai/plugin-paper-trading 开发说明

这份是给开发者看的，不随插件发布（不在 package.json 的 `files` 里）。插件市场的详情页显示的是 `README.md`，发布前把它换成你的插件说明。

FtAi Desktop 插件：后端注册问候工具 `paper_trading_greet` 和 `paperTrading.greet` remote；React 前端提供设置页、Markdown 问候卡片和本机计数。

```bash
pnpm install
pnpm build
```

构建依次执行后端 `tsc`、`ftai-plugin-remote`、前端 `tsc` 和 `vite build`。前端继承 `@ftai/plugin-sdk/tsconfig.client.json`，使用 `defineClientConfig`；产物 `lib/client.js` 由应用加载，不是独立网页。

| 位置 | 内容 |
|---|---|
| `src/index.ts` | 工具与 remote，运行在插件进程 |
| `src/types.ts` | 两半共用的 JSON 类型，只用 `import type` 引用 |
| `src/client/index.ts` | 注册功能、私有文案、状态和 remote 连接 |
| `src/client/Views.tsx` | `SettingsPage`、`SettingsGroup`、`SettingsRow` 组成的设置页，以及 Markdown 卡片 |
| `src/client/remote.ts` | 可订阅的 remote 状态；解绑、重挂和撤销后忽略旧结果 |
| `src/client/counter.ts` | 独立的计数快照和串行偏好保存 |
| `src/client/i18n/` | 简体中文和英文，键一致、私有作用域、跟随应用语言 |
| `locale/` | 「功能与插件」页的名称与说明 |
| `src/client/style.css` | 只消费公开 token，不依赖应用扫描 Tailwind |

安装后可以在设置页体验计数和 remote 问候。工具经模型调用后返回 `paper-trading-card` 代码块，模型在回答中原样保留时显示卡片；卡片的「再问候一次」直接调 remote。工具和界面使用同一份后端计数，模型工具不读取本机界面的计数偏好。

应用组件从 `@ftai/plugin-sdk/app` 具名引用，插槽类型和注册服务在 `/features`，通过 `ctx.ftaiFeatures` 注册。React 和 ReactDOM 18.3.1 由 `@ftai/client-react` 共享，`@ftai/client-app` 提供组件和 hook；`ftai.client.external` 必须声明这两行，不要自行创建 React root 或引入 Vue。`cordis` 和 SDK 写在 `devDependencies`，由应用提供同一份运行时。前后端只以类型互相引用，不要引用应用源码。

生命周期由 `ctx.effect` 和组件 effect 管理；停用、卸载、热替换会撤掉插槽、文案、样式和资源。已发出的 remote 调用会跑完，但旧结果不再写入新代。前端不要 `$mount` 调用描述，等 `remote.paperTrading` 挂上后再使用。

## 发布与安装

运行 `pnpm publish --access public` 发到 npm，然后在 FtAi 的「插件」页右上角「添加」→「按包名安装」。刚发布的版本有 24 小时冷却，马上测试时请写「包名@版本」。发布前想在本机试装，可以起一个本机 npm 源，启动应用时设 `FTAI_PLUGIN_REGISTRY=<本机源地址>`。

上架插件市场时，详情页显示包根目录的 `README.md`。规则同 VS Code 扩展：图片要用 https 地址，SVG 只能来自常见的徽章站点，不能写 `<svg>` 标签；相对路径只在 package.json 的 `repository` 指向 GitHub 或 gitlab.com 时改写成仓库里的地址，其余显示成纯文字或替代文字。README 还是模板原文时上不了架。

开发文档见 <https://ftai.chat/desktop/docs/plugins/>。
