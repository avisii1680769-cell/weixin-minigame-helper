#!/usr/bin/env node
/**
 * 无头截图工具：启动（或复用）预览服务，直接截一张游戏画面写到文件。
 *
 *   node bin/capture.js --workspace <游戏目录> [--out shot.jpg] [--quality 0.6]
 *                       [--format image/jpeg] [--wait 3000] [--headless]
 *
 * 关于 --headless：
 *   capture_screenshot 需要「有浏览器连着预览页」。默认会尝试用 Playwright
 *   自动开一个无头浏览器连上，截完自动关闭。若环境无 Playwright，会退化为
 *   仅启动预览并提示手工开页面。
 *
 * 退出码 0 = 截图成功；非 0 = 失败。
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(ROOT, 'node_modules/@weadmin/weixin-minigame-helper-mcp/mcp/index.js');
const PROXY_PORT = Number(process.env.PREVIEW_PROXY_PORT || 3848);

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const workspace = path.resolve(arg('workspace', path.join(ROOT, 'examples/minimal-game')));
const outFile = path.resolve(arg('out', 'shot.jpg'));
const quality = Number(arg('quality', 0.6));
const format = arg('format', outFile.endsWith('.png') ? 'image/png' : 'image/jpeg');
const waitMs = Number(arg('wait', 3000));
const wantHeadless = args.includes('--headless');

if (!fs.existsSync(path.join(workspace, 'game.js'))) {
  console.error(`✗ 目录中缺少 game.js：${workspace}`);
  process.exit(2);
}

// ---------- MCP 客户端 ----------
function startMcp() {
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
  let seq = 1;
  const call = (method, params) =>
    new Promise((res) => {
      const id = seq++;
      pending.set(id, res);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  return { child, call };
}

// ---------- 可选的 Playwright 无头浏览器 ----------
async function openHeadlessBrowser(url) {
  let pw;
  try {
    pw = require('playwright');
  } catch {
    try { pw = require('playwright-core'); } catch { return null; }
  }
  try {
    const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 414, height: 896 } });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    return { browser, page };
  } catch (e) {
    return null;
  }
}

function get(url, timeout = 4000) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode || 0);
    });
    req.on('error', () => resolve(0));
    req.setTimeout(timeout, () => { req.destroy(); resolve(0); });
  });
}

(async () => {
  const { child, call } = startMcp();

  await call('initialize', {
    protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'capture', version: '1' },
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const run = await call('tools/call', { name: 'run_game', arguments: { workspacePath: workspace } });
  const runText = run.result?.content?.[0]?.text || '';
  console.log(runText.trim());

  await new Promise((s) => setTimeout(s, 1500));

  const proxyOk = (await get(`http://127.0.0.1:${PROXY_PORT}/`)) === 200;
  const url = proxyOk ? `http://127.0.0.1:${PROXY_PORT}/` : 'http://[::1]:3847/';
  if (!proxyOk) console.log(`! 代理未启动，改用直连 ${url}`);

  let hb = null;
  if (wantHeadless || true) {
    hb = await openHeadlessBrowser(url);
    if (hb) console.log('· 已用无头浏览器连接预览页');
  }

  await new Promise((s) => setTimeout(s, waitMs));

  let saved = false;
  for (let attempt = 0; attempt < 10 && !saved; attempt++) {
    const shot = await call('tools/call', {
      name: 'capture_screenshot',
      arguments: { format, quality },
    });
    const content = shot.result?.content || [];
    const img = content.find((x) => x.type === 'image');
    if (img?.data) {
      fs.writeFileSync(outFile, Buffer.from(img.data, 'base64'));
      console.log(`✓ 截图已保存：${outFile}（${(fs.statSync(outFile).size / 1024).toFixed(1)} KB）`);
      saved = true;
      break;
    }
    const msg = String(content[0]?.text || '');
    if (/No connected preview clients/.test(msg)) {
      await new Promise((s) => setTimeout(s, 1500));
      continue;
    }
    console.error(`✗ ${msg.slice(0, 200)}`);
    break;
  }

  if (!saved) {
    console.error('✗ 截图失败：需要有浏览器打开预览页');
    console.error(`  请打开 ${url} 后重试，或安装 Playwright：`);
    console.error('    npm i playwright && npx playwright install chromium');
  }

  if (hb) await hb.browser.close().catch(() => {});
  child.kill();
  process.exit(saved ? 0 : 1);
})().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
