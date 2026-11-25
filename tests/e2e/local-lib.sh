# 本机走查的公共步骤：停应用、构建、热替换走查实例、启动并等调试口。
# 由 tests/e2e/run-local.sh 与 docs/screenshots/run-capture.sh 共用。
# 使用前设置：WALKTHROUGH、APP、INSTALLED_PKG（见各自脚本）。

APP_BIN="${APP:-/Applications/FtAi Desktop.app}/Contents/MacOS/FtAi Desktop"
HOST_BIN="${APP:-/Applications/FtAi Desktop.app}/Contents/Resources/binaries/ftai-rust-host"
PLUGIN_TARGET="$WALKTHROUGH/host/plugins/node_modules/$INSTALLED_PKG"

stop_walkthrough() {
  env -u ELECTRON_RUN_AS_NODE FTAI_HOST_HOME="$WALKTHROUGH/host" "$HOST_BIN" --stop >/dev/null 2>&1 || true
  pkill -f "$APP_BIN --user-data-dir=$WALKTHROUGH/userData" >/dev/null 2>&1 || true
  sleep 2
}

build_plugin() {
  (cd "$ROOT" && pnpm build)
}

patch_walkthrough() {
  if [[ ! -d "$PLUGIN_TARGET" ]]; then
    echo "走查实例里没有 $INSTALLED_PKG（$PLUGIN_TARGET）。先在应用里安装一次插件，或设置 FTAI_INSTALLED_PACKAGE。" >&2
    return 1
  fi
  rm -rf "$PLUGIN_TARGET/lib"
  cp -a "$ROOT/lib" "$PLUGIN_TARGET/lib"
  cp "$ROOT/README.md" "$PLUGIN_TARGET/README.md"
  # 走查实例装的是旧包名；客户端注册 id 必须与安装包名一致才能被宿主挂上。
  sed -i '' "s|@clrstn2830h/plugin-paper-trading|$INSTALLED_PKG|g" "$PLUGIN_TARGET/lib/client.js"
}

launch_walkthrough() {
  local log="${1:-$ROOT/dsh_tmp/e2e-app.log}"
  mkdir -p "$(dirname "$log")"
  rm -f "$WALKTHROUGH/userData/DevToolsActivePort"
  env -u ELECTRON_RUN_AS_NODE \
    FTAI_HOST_HOME="$WALKTHROUGH/host" \
    FTAI_DEV_FILE_CREDENTIALS=1 \
    "$APP_BIN" --user-data-dir="$WALKTHROUGH/userData" --remote-debugging-port=0 \
    >"$log" 2>&1 &
  APP_PID=$!
  local port_file="$WALKTHROUGH/userData/DevToolsActivePort"
  for _ in $(seq 1 60); do
    [[ -s "$port_file" ]] && break
    sleep 1
  done
  if [[ ! -s "$port_file" ]]; then
    echo "等调试口超时，看日志：$log" >&2
    tail -20 "$log" >&2 || true
    stop_walkthrough
    return 1
  fi
  echo "调试口：$(head -1 "$port_file")"
}
