#!/usr/bin/env node
/**
 * 小游戏预览反向代理
 *
 * 为什么需要它：@weadmin/weixin-minigame-helper-mcp 的预览服务只监听 [::1]（IPv6 回环），
 * 浏览器以外的环境（Docker 容器外部、MUSE 云沙箱外部域名、VM 宿主）都访问不到。
 * 预览页面内部全部使用相对路径（/api/events、/api/logs…），所以只要在同源上做一层
 * HTTP + SSE 反向代理，页面会自动适配外部域名，无需修改原包。
 */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const LISTEN_PORT = Number(arg('port', process.env.PREVIEW_PROXY_PORT || 3848));
const LISTEN_HOST = arg('host', process.env.PREVIEW_PROXY_HOST || '0.0.0.0');
const TARGET_HOST = arg('target-host', process.env.PREVIEW_TARGET_HOST || '::1');
const TARGET_PORT = Number(arg('target-port', process.env.PREVIEW_TARGET_PORT || 3847));
const TLS_CERT = arg('cert', process.env.PREVIEW_PROXY_CERT || '');
const TLS_KEY = arg('key', process.env.PREVIEW_PROXY_KEY || '');

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
]);

function buildHeaders(req) {
  const out = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) out[k] = v;
  }
  out.host = `${TARGET_HOST.includes(':') ? '[' + TARGET_HOST + ']' : TARGET_HOST}:${TARGET_PORT}`;
  const remote = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  out['x-forwarded-for'] = remote;
  out['x-forwarded-proto'] = TLS_CERT && TLS_KEY ? 'https' : 'http';
  out['x-forwarded-host'] = req.headers.host || '';
  return out;
}

function handle(req, res) {
  const upstream = http.request(
    {
      host: TARGET_HOST,
      port: TARGET_PORT,
      method: req.method,
      path: req.url,
      headers: buildHeaders(req),
    },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    }
  );

  upstream.on('error', (err) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(
      `预览服务未就绪（${TARGET_HOST}:${TARGET_PORT}）：${err.message}\n` +
        '请先调用 MCP 工具 run_game 启动游戏预览，再刷新本页面。\n'
    );
  });

  req.pipe(upstream);
}

const server =
  TLS_CERT && TLS_KEY
    ? https.createServer(
        { cert: fs.readFileSync(TLS_CERT), key: fs.readFileSync(TLS_KEY) },
        (req, res) => {
          if (!req.url.startsWith('/')) req.url = '/' + req.url;
          handle(req, res);
        }
      )
    : http.createServer(handle);

// SSE（/api/events）与 WebSocket 升级都需要长连接，禁用响应超时
server.keepAliveTimeout = 0;
server.headersTimeout = 0;
server.requestTimeout = 0;

server.on('upgrade', () => {
  // 预览服务本身不提供 WebSocket 升级；明确拒绝以免连接悬挂
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[preview-proxy] 端口 ${LISTEN_PORT} 已被占用，可用 --port 指定其它端口`);
  } else {
    console.error('[preview-proxy]', err.message);
  }
  process.exit(1);
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  const scheme = TLS_CERT && TLS_KEY ? 'https' : 'http';
  console.log(
    `[preview-proxy] ${scheme}://${LISTEN_HOST}:${LISTEN_PORT} -> http://${TARGET_HOST}:${TARGET_PORT}`
  );
  console.log('[preview-proxy] 保持本进程运行，预览页地址不随 run_game 变化');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
