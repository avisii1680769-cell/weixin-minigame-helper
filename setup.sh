#!/usr/bin/env bash
# 微信小游戏开发助手 · MUSE / Linux / macOS 环境自举
# 用法: bash setup.sh [--check] [--with-browser]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

CHECK_ONLY=0
WITH_BROWSER=0
for a in "$@"; do
  case "$a" in
    --check) CHECK_ONLY=1 ;;
    --with-browser) WITH_BROWSER=1 ;;
    -h|--help) sed -n '2,4p' "$0"; exit 0 ;;
  esac
done

say()  { printf '\033[36m[setup]\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m  ✓\033[0m %s\n' "$*"; }
warn() { printf '\033[33m  !\033[0m %s\n' "$*"; }
die()  { printf '\033[31m  ✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ---------- 1. 基础环境 ----------
say "1/5 检查基础环境"

command -v node >/dev/null 2>&1 || die "未找到 node，请先安装 Node.js ≥ 18"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || die "Node.js 版本过低（当前 $(node -v)），需要 ≥ 18"
ok "node $(node -v)"

command -v npm >/dev/null 2>&1 || die "未找到 npm"
ok "npm $(npm -v)"

if [ "$CHECK_ONLY" -eq 1 ]; then
  say "--check 模式：仅检查，不安装"
fi

# ---------- 2. 安装 MCP 依赖 ----------
say "2/5 安装小游戏 MCP 服务"

PKG="@weadmin/weixin-minigame-helper-mcp"
if [ -d node_modules/@weadmin/weixin-minigame-helper-mcp ]; then
  ok "依赖已存在，跳过安装"
else
  [ "$CHECK_ONLY" -eq 1 ] && { warn "缺少 node_modules（--check 不安装）"; } || {
    npm install --no-audit --no-fund \
      || npm install --no-audit --no-fund --registry=https://registry.npmmirror.com
    ok "$PKG 安装完成"
  }
fi

[ -f node_modules/@weadmin/weixin-minigame-helper-mcp/mcp/index.js ] \
  && ok "MCP 入口就位" \
  || warn "未找到 mcp/index.js，请检查安装结果"

# esbuild 是平台相关的，跨平台迁移后必须重装
if [ -d node_modules/@esbuild ]; then
  CUR="$(node -p 'process.platform+"-"+process.arch')"
  if ls -d node_modules/@esbuild/* 2>/dev/null | grep -q "$CUR"; then
    ok "esbuild 平台包匹配（$CUR）"
  else
    warn "esbuild 平台包与当前平台（$CUR）不符，正在重装"
    [ "$CHECK_ONLY" -eq 1 ] || npm install esbuild --no-audit --no-fund >/dev/null 2>&1 || true
  fi
fi

# ---------- 3. 注册 MCP 配置 ----------
say "3/5 生成 MCP 配置片段"

cat > mcp-config.json <<JSON
{
  "mcpServers": {
    "weixin-minigame": {
      "command": "node",
      "args": ["$HERE/node_modules/@weadmin/weixin-minigame-helper-mcp/mcp/index.js"]
    }
  }
}
JSON
ok "已写入 mcp-config.json（把内容合并进你的 Agent MCP 配置）"

# ---------- 4. 无头浏览器（可选） ----------
say "4/5 检查无头浏览器（截图必需）"

BROWSER=""
for c in chromium chromium-browser google-chrome google-chrome-stable chrome headless_shell; do
  if command -v "$c" >/dev/null 2>&1; then BROWSER="$c"; break; fi
done

if [ -n "$BROWSER" ]; then
  ok "找到浏览器: $(command -v "$BROWSER")"
elif [ -d node_modules/playwright ]; then
  ok "找到 playwright"
elif [ "$WITH_BROWSER" -eq 1 ] && [ "$CHECK_ONLY" -eq 0 ]; then
  say "安装 playwright chromium…"
  npm install --no-audit --no-fund playwright >/dev/null 2>&1 || true
  npx playwright install chromium >/dev/null 2>&1 || warn "playwright install 失败"
  ok "playwright 就绪"
else
  warn "未检测到浏览器 —— run_game/get_logs 可用，但 capture_screenshot 不可用"
  warn "需要截图时执行: bash setup.sh --with-browser"
fi

# ---------- 5. 启动代理 ----------
say "5/5 启动预览反向代理"

PROXY_PORT="${PREVIEW_PROXY_PORT:-3848}"
node -e "
const net=require('net');
const s=net.createServer();
s.once('error',()=>process.exit(1));
s.once('listening',()=>{s.close();process.exit(0)});
s.listen($PROXY_PORT,'0.0.0.0');
" && PROXY_FREE=1 || PROXY_FREE=0

if [ "$CHECK_ONLY" -eq 1 ]; then
  [ "$PROXY_FREE" -eq 1 ] && ok "代理端口 $PROXY_PORT 可用" || warn "代理端口 $PROXY_PORT 已被占用"
else
  if [ "$PROXY_FREE" -eq 1 ]; then
    mkdir -p .run
    nohup node bin/preview-proxy.js --port "$PROXY_PORT" > .run/proxy.log 2>&1 &
    echo $! > .run/proxy.pid
    sleep 1
    if kill -0 "$(cat .run/proxy.pid)" 2>/dev/null; then
      ok "代理已启动（pid $(cat .run/proxy.pid)），日志 .run/proxy.log"
    else
      warn "代理启动失败，见 .run/proxy.log"
    fi
  else
    warn "端口 $PROXY_PORT 已被占用，跳过代理启动（可用 PREVIEW_PROXY_PORT=xxxx 指定）"
  fi
fi

HOSTIP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -z "$HOSTIP" ] && HOSTIP="$(ip -4 addr show 2>/dev/null | awk '/inet /{print $2}' | cut -d/ -f1 | grep -v '^127\.' | head -1)"
[ -z "$HOSTIP" ] && HOSTIP="<主机IP>"

cat > .preview-url <<EOF
http://${HOSTIP}:${PROXY_PORT}/
EOF

echo
printf '\033[32m完成。\033[0m\n'
echo "  预览地址（先调用 run_game 再访问）: http://${HOSTIP}:${PROXY_PORT}/"
echo "  MCP 配置: $HERE/mcp-config.json"
echo "  AppID/密钥（真机与发布用）:"
echo "    export WECHAT_APPID=wxXXXXXXXX"
echo "    export WECHAT_PRIVATE_KEY_PATH=/path/to/private.key"
echo
echo "  验证: node bin/smoke-test.js"
