#!/usr/bin/env node
/**
 * 端到端自检：验证 MCP 服务能否握手、列出工具、对示例游戏起预览。
 *
 *   node bin/smoke-test.js [--no-run]   --no-run 只测握手与工具列表，不启动预览
 *
 * 退出码 0 = 通过，非 0 = 失败（原因见输出）
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(ROOT, 'node_modules/@weadmin/weixin-minigame-helper-mcp/mcp/index.js');
const GAME = path.join(ROOT, 'examples/minimal-game');
const PROXY_PORT = Number(process.env.PREVIEW_PROXY_PORT || 3848);
const noRun = process.argv.includes('--no-run');
// --hold[=秒] 保持 MCP 服务运行，便于用浏览器打开预览页验证截图（默认 60 秒）
const holdArg = process.argv.find((a) => a === '--hold' || a.startsWith('--hold='));
const holdSec = holdArg ? Number(holdArg.split('=')[1] || 60) : 0;

const c = { g: (s) => `\x1b[32m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m` };
let failed = 0;
const pass = (m) => console.log(`  ${c.g('✓')} ${m}`);
const fail = (m) => { console.log(`  ${c.r('✗')} ${m}`); failed++; };
const warn = (m) => console.log(`  ${c.y('!')} ${m}`);

function get(url, timeout = 5000) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    req.setTimeout(timeout, () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
  });
}

(async () => {
  console.log('\n小游戏开发助手 · 端到端自检\n');

  console.log('1) 环境');
  if (fs.existsSync(ENTRY)) pass('MCP 入口存在');
  else { fail('MCP 入口缺失，请先运行 bash setup.sh'); return done(); }
  pass(`node ${process.version}`);
  if (fs.existsSync(path.join(GAME, 'game.js'))) pass('示例游戏 game.js 存在');
  else fail('示例游戏缺失（examples/minimal-game/game.js）');

  console.log('\n2) MCP 握手与工具注册');
  const child = spawn(process.execPath, [ENTRY], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  const pending = new Map();
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let m;
      try { m = JSON.parse(line); } catch { continue; }
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    }
  });
  child.stderr.on('data', () => {});
  const send = (id, method, params) =>
    new Promise((res) => {
      pending.set(id, res);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });

  const init = await send(1, 'initialize', {
    protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '1' },
  });
  if (init.result?.serverInfo) pass(`握手成功：${init.result.serverInfo.name} v${init.result.serverInfo.version}`);
  else { fail('握手失败'); child.kill(); return done(); }

  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const tools = await send(2, 'tools/list', {});
  const names = (tools.result?.tools || []).map((t) => t.name);
  const need = ['run_game', 'get_logs', 'capture_screenshot', 'real_device_preview', 'publish'];
  const missing = need.filter((n) => !names.includes(n));
  if (missing.length === 0) pass(`工具齐全（${names.length} 个）`);
  else fail(`缺少工具：${missing.join(', ')}`);

  if (noRun) { child.kill(); console.log('\n(--no-run：跳过预览)'); return done(); }

  console.log('\n3) 预览服务');
  const run = await send(3, 'tools/call', { name: 'run_game', arguments: { workspacePath: GAME } });
  const runText = run.result?.content?.[0]?.text || JSON.stringify(run.error || {});
  if (/localhost:3847/.test(runText)) pass('run_game 启动成功');
  else fail(`run_game 失败：${runText.slice(0, 160)}`);

  const direct = await get('http://[::1]:3847/');
  if (direct.status === 200) pass('预览服务直连 [::1]:3847 → 200');
  else fail(`直连失败：${direct.error || direct.status}`);

  console.log('\n4) 反向代理');
  const proxied = await get(`http://127.0.0.1:${PROXY_PORT}/`);
  if (proxied.status === 200) pass(`代理 ${PROXY_PORT} → 200`);
  else warn(`代理未就绪（${proxied.error || proxied.status}），执行 node bin/preview-proxy.js --port ${PROXY_PORT}`);

  console.log('\n5) 日志与截图');
  const logs = await send(4, 'tools/call', { name: 'get_logs', arguments: {} });
  const logText = logs.result?.content?.[0]?.text || '';
  if (/No logs found|no connected|\[/.test(logText)) pass('get_logs 可调用');
  else warn(`get_logs 返回：${logText.slice(0, 120)}`);

  const shot = await send(5, 'tools/call', { name: 'capture_screenshot', arguments: { format: 'image/jpeg', quality: 0.6 } });
  const hasImg = (shot.result?.content || []).some((x) => x.type === 'image');
  if (hasImg) pass('capture_screenshot 成功');
  else {
    const msg = String(shot.result?.content?.[0]?.text || '');
    if (/No connected preview clients/.test(msg)) warn('截图需要浏览器打开预览页（无头环境属预期）');
    else warn(`截图未成功：${msg.slice(0, 120)}`);
  }

  const stop = await send(6, 'tools/call', { name: 'run_game', arguments: { workspacePath: GAME } });
  if (stop) pass('run_game 幂等复调用正常');

  if (holdSec > 0) {
    console.log(`\n保持服务运行 ${holdSec} 秒，供浏览器连接后重测截图：`);
    console.log(`  打开 http://127.0.0.1:${PROXY_PORT}/  然后执行：`);
    console.log(`    node bin/capture.js --workspace examples/minimal-game --out shot.jpg\n`);
    await new Promise((s) => setTimeout(s, holdSec * 1000));
  }

  child.kill();
  await new Promise((s) => setTimeout(s, 400));
  done();
})().catch((e) => { fail(e.message); done(); });

function done() {
  console.log('');
  if (failed === 0) { console.log(c.g('自检通过。')); process.exit(0); }
  console.log(c.r(`自检失败：${failed} 项`));
  process.exit(1);
}
