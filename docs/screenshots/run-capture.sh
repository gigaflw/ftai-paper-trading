#!/usr/bin/env bash
# 一条命令重拍 README 三张图：停走查实例 → 构建/热替换 → 备份账本 → 生成演示数据
# → 启动 → 截图 → 还原账本 → 退出。行情不可用时只跳过依赖行情的图（见 capture.mjs 输出）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WALKTHROUGH="${FTAI_WALKTHROUGH:-$HOME/ftai-walkthrough/paper-trading}"
INSTALLED_PKG="${FTAI_INSTALLED_PACKAGE:-@dsh-ft/ftai-paper-trading}"
APP="${FTAI_APP:-/Applications/FtAi Desktop.app}"
export ROOT WALKTHROUGH INSTALLED_PKG APP
source "$ROOT/tests/e2e/local-lib.sh"

LEDGER="$WALKTHROUGH/host/plugin-data/%40dsh-ft%2Fftai-paper-trading/paper-trading"
BACKUP="$ROOT/dsh_tmp/shots-ledger-backup"

restore() {
  if [[ -d "$BACKUP" ]]; then
    rm -rf "$LEDGER"
    cp -a "$BACKUP" "$LEDGER"
    rm -rf "$BACKUP"
    echo "== 账本已还原"
  fi
  stop_walkthrough
}
trap restore EXIT

echo "== 停止走查实例"
stop_walkthrough
echo "== 构建并热替换走查实例"
build_plugin
patch_walkthrough
echo "== 备份并生成演示账本"
rm -rf "$BACKUP"
cp -a "$LEDGER" "$BACKUP"
node "$ROOT/docs/screenshots/seed-demo.mjs" --apply --no-backup >/dev/null

echo "== 启动并截图"
launch_walkthrough "$ROOT/dsh_tmp/shots-app.log"
(cd "$ROOT" && node docs/screenshots/capture.mjs --walkthrough "$WALKTHROUGH")

echo "== 收尾"
restore
trap - EXIT
