#!/usr/bin/env node
/**
 * 从 dsh 版 paper-trading 插件同步平台无关的共享层。
 *
 * 共享层的唯一来源是 dsh 插件仓库（默认 `~/workspace/dsh/dsh-fft-paper-trading`）。
 * 本插件只保存同步结果，并在 `shared-manifest.json` 记下来源 tag、commit 与每个文件的
 * sha256；平台外壳（`src/index.ts`、`src/platform/**`、`src/client/**`）不参与同步。
 *
 * 用法：
 *   node scripts/sync-shared.mjs [--tag v0.8.0] [--repo <path>] [--check]
 *
 * `--check` 只核对当前工作区是否与指定 tag 一致，不改文件，不一致时退出码 1。
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = join(root, 'shared-manifest.json')

/** 共享层的目录与顶层文件；与 dsh 插件里的相对位置一致。 */
const SHARED_PATHS = ['src/core', 'src/contract', 'src/store', 'src/service', 'src/data', 'src/agent', 'src/contract.ts', 'src/futures-contract.ts']

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

const repo = resolve(arg('repo', process.env.DSH_PAPER_TRADING_REPO ?? join(homedir(), 'workspace/dsh/dsh-fft-paper-trading')))
if (!existsSync(repo)) {
  console.error(`找不到 dsh 插件仓库：${repo}（用 --repo 或 DSH_PAPER_TRADING_REPO 指定）`)
  process.exit(1)
}

const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : undefined
const tag = arg('tag', manifest?.tag ?? 'v0.8.0')
const check = process.argv.includes('--check')

/**
 * 同步时的两处固定改写：
 * - 相对 import 的 `.js` 后缀在 dsh 仓库按 NodeNext 编译，本仓库源码统一写 `.ts`；
 * - `agent/` 的工具声明引用 dsh 的工具包，本插件换成形状相同的 `@ftai/plugin-sdk/host`。
 */
function rewriteImports(text) {
  return text
    .replace(/@deepseek-ai\/dsh-tools/g, '@ftai/plugin-sdk/host')
    .replace(/(from\s+')(\.[^']*?)\.js(')/g, '$1$2.ts$3')
}

const listed = execFileSync('git', ['-C', repo, 'ls-tree', '-r', '--name-only', tag, '--', ...SHARED_PATHS], { encoding: 'utf8' })
  .trim().split('\n').filter(Boolean)
const files = {}
let changed = 0
let drifted = 0
for (const path of listed) {
  if (!path.endsWith('.ts')) continue
  const source = rewriteImports(execFileSync('git', ['-C', repo, 'show', `${tag}:${path}`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }))
  const target = join(root, path)
  const hash = createHash('sha256').update(source).digest('hex')
  files[path] = hash
  const current = existsSync(target) ? readFileSync(target, 'utf8') : undefined
  if (current === source) continue
  if (check) {
    console.error(`不一致：${path}`)
    drifted += 1
    continue
  }
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, source)
  changed += 1
}

if (check) {
  if (drifted === 0) console.log(`共享层与 ${repo}@${tag} 一致（${listed.length} 个文件）`)
  else {
    console.error(`共享层有 ${drifted} 个文件与 ${repo}@${tag} 不一致，运行 node scripts/sync-shared.mjs --tag ${tag} 同步`)
    process.exit(1)
  }
} else {
  const commit = execFileSync('git', ['-C', repo, 'rev-parse', tag], { encoding: 'utf8' }).trim()
  writeFileSync(manifestPath, `${JSON.stringify({ repo, tag, commit, paths: SHARED_PATHS, files }, null, 2)}\n`)
  console.log(`已同步 ${listed.length} 个文件（改动 ${changed} 个）；来源 ${repo}@${tag} (${commit.slice(0, 10)})`)
}
