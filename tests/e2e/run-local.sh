#!/usr/bin/env bash
# 本机一条命令跑面板 e2e：停宿主 → 构建 → 把当前构建热替换进走查实例 → 启动 → 跑走查。
#
# 只用本机已装好的 FtAi Desktop 与隔离走查目录，不发布、不重装任何东西；
# 热替换仅用于测试，发行仍应发布新版本后在应用里安装。
#
# 用法：
#   tests/e2e/run-local.sh [--keep] [--restore] [--walkthrough DIR] [ui-smoke 的其他参数]
#
#   --keep     跑完不退出应用（方便看现场）
#   --restore  跑完把走查实例里原来的 lib/ 还原（默认保留本次构建，下一次直接复用）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WALKTHROUGH="${FTAI_WALKTHROUGH:-$HOME/ftai-walkthrough/paper-trading}"
INSTALLED_PKG="${FTAI_INSTALLED_PACKAGE:-@dsh-ft/ftai-paper-trading}"
APP="${FTAI_APP:-/Applications/FtAi Desktop.app}"
export ROOT WALKTHROUGH INSTALLED_PKG APP
source "$ROOT/tests/e2e/local-lib.sh"

KEEP=0
RESTORE=0
PASS_THROUGH=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep) KEEP=1; shift ;;
    --restore) RESTORE=1; shift ;;
    --walkthrough) WALKTHROUGH="$2"; export WALKTHROUGH; shift 2 ;;
    *) PASS_THROUGH+=("$1"); shift ;;
  esac
done

echo "== 停止走查实例"
stop_walkthrough

echo "== 构建"
build_plugin

echo "== 热替换到走查实例（仅测试）"
BACKUP_DIR="$ROOT/dsh_tmp/e2e-lib-backup-$(date +%Y%m%d%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp -a "$PLUGIN_TARGET/lib" "$BACKUP_DIR/lib" 2>/dev/null || true
patch_walkthrough

echo "== 启动应用"
launch_walkthrough "$ROOT/dsh_tmp/e2e-app.log"

echo "== 跑 e2e"
set +e
(cd "$ROOT" && node tests/e2e/ui-smoke.mjs --walkthrough "$WALKTHROUGH" ${PASS_THROUGH[@]+"${PASS_THROUGH[@]}"})
STATUS=$?
set -e

if [[ $RESTORE -eq 1 && -d "$BACKUP_DIR/lib" ]]; then
  echo "== 还原走查实例 lib（$BACKUP_DIR）"
  rm -rf "$PLUGIN_TARGET/lib"
  cp -a "$BACKUP_DIR/lib" "$PLUGIN_TARGET/lib"
fi

if [[ $KEEP -eq 0 ]]; then
  echo "== 退出走查实例"
  stop_walkthrough
fi

exit $STATUS
