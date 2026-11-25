#!/usr/bin/env bash
# 本机一条命令跑面板 e2e：停宿主 → 构建 → 把当前构建热替换进走查实例 → 启动 → 跑走查。
#
# 只用本机已装好的 FtAi Desktop 与隔离走查目录，不发布、不 uinstall 任何东西；
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
APP="${FTAI_APP:-/Applications/FtAi Desktop.app}"
INSTALLED_PKG="${FTAI_INSTALLED_PACKAGE:-@dsh-ft/ftai-paper-trading}"
TARGET="$WALKTHROUGH/host/plugins/node_modules/$INSTALLED_PKG"
HOST_BIN="$APP/Contents/Resources/binaries/ftai-rust-host"
APP_BIN="$APP/Contents/MacOS/FtAi Desktop"

KEEP=0
RESTORE=0
PASS_THROUGH=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep) KEEP=1; shift ;;
    --restore) RESTORE=1; shift ;;
    --walkthrough) WALKTHROUGH="$2"; shift 2 ;;
    *) PASS_THROUGH+=("$1"); shift ;;
  esac
done
TARGET="$WALKTHROUGH/host/plugins/node_modules/$INSTALLED_PKG"

if [[ ! -d "$TARGET" ]]; then
  echo "走查实例里没有 $INSTALLED_PKG（$TARGET）。先在应用里安装一次插件，或设置 FTAI_INSTALLED_PACKAGE。" >&2
  exit 1
fi

echo "== 停止走查实例"
env -u ELECTRON_RUN_AS_NODE FTAI_HOST_HOME="$WALKTHROUGH/host" "$HOST_BIN" --stop >/dev/null 2>&1 || true
pkill -f "$APP_BIN --user-data-dir=$WALKTHROUGH/userData" >/dev/null 2>&1 || true
sleep 2

echo "== 构建"
(cd "$ROOT" && pnpm build)

echo "== 热替换到走查实例（仅测试）"
BACKUP_DIR="$ROOT/dsh_tmp/e2e-lib-backup-$(date +%Y%m%d%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp -a "$TARGET/lib" "$BACKUP_DIR/lib"
rsync -a --delete "$ROOT/lib/" "$TARGET/lib/"
cp "$ROOT/README.md" "$TARGET/README.md"
# 走查实例装的是旧包名，客户端注册 id 必须与安装包名一致才能被宿主挂上。
sed -i '' "s|@clrstn2830h/plugin-paper-trading|$INSTALLED_PKG|g" "$TARGET/lib/client.js"

echo "== 启动应用"
rm -f "$WALKTHROUGH/userData/DevToolsActivePort"
LOG="$ROOT/dsh_tmp/e2e-app.log"
mkdir -p "$(dirname "$LOG")"
# ELECTRON_RUN_AS_NODE 会让 Electron 当 Node 跑，启动前必须去掉。
env -u ELECTRON_RUN_AS_NODE \
  FTAI_HOST_HOME="$WALKTHROUGH/host" \
  FTAI_DEV_FILE_CREDENTIALS=1 \
  "$APP_BIN" --user-data-dir="$WALKTHROUGH/userData" --remote-debugging-port=0 \
  >"$LOG" 2>&1 &
APP_PID=$!

PORT_FILE="$WALKTHROUGH/userData/DevToolsActivePort"
for _ in $(seq 1 60); do
  [[ -s "$PORT_FILE" ]] && break
  sleep 1
done
if [[ ! -s "$PORT_FILE" ]]; then
  echo "等调试口超时，看日志：$LOG" >&2
  tail -20 "$LOG" >&2 || true
  kill "$APP_PID" 2>/dev/null || true
  exit 1
fi
echo "调试口：$(head -1 "$PORT_FILE")"

echo "== 跑 e2e"
set +e
(cd "$ROOT" && node tests/e2e/ui-smoke.mjs --walkthrough "$WALKTHROUGH" ${PASS_THROUGH[@]+"${PASS_THROUGH[@]}"})
STATUS=$?
set -e

if [[ $RESTORE -eq 1 ]]; then
  echo "== 还原走查实例 lib（$BACKUP_DIR）"
  rm -rf "$TARGET/lib"
  cp -a "$BACKUP_DIR/lib" "$TARGET/lib"
fi

if [[ $KEEP -eq 0 ]]; then
  echo "== 退出走查实例"
  env -u ELECTRON_RUN_AS_NODE FTAI_HOST_HOME="$WALKTHROUGH/host" "$HOST_BIN" --stop >/dev/null 2>&1 || true
  pkill -f "$APP_BIN --user-data-dir=$WALKTHROUGH/userData" >/dev/null 2>&1 || true
fi

exit $STATUS
