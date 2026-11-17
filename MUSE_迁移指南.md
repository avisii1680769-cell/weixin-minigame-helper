# MUSE 部署指南

本文档只讲 MUSE 环境下的差异化步骤，通用说明见 `README.md`。

---

## 1. 环境要求

| 项 | 要求 | 说明 |
|---|---|---|
| Node.js | ≥ 18 | MUSE 一般自带；`node -v` 检查 |
| npm | 随 Node 附带 | |
| 浏览器 | Chromium / Chrome | **截图与日志必需**；无则只能起预览 |
| 磁盘 | ≥ 500 MB | 依赖解包后约 330 MB |

无需微信开发者工具、无需 GUI。

---

## 2. 上传与解压

```bash
# 上传 zip 后
unzip weixin-minigame-helper-RELEASE.zip
cd weixin-minigame-helper-RELEASE
```

> 若 MUSE 无 `unzip`，用 `tar -xzf`（已提供 tar.gz）或 `python -c "import zipfile;zipfile.ZipFile('x.zip').extractall('.')"`.

---

## 3. 自举

```bash
bash setup.sh
```

脚本会依次：

1. 检查 Node ≥ 18
2. 安装 `@weadmin/weixin-minigame-helper-mcp`（清华/npmmirror 回退）
3. **校验 esbuild 平台包**——跨平台迁移后自动重装（关键，不做会启动失败）
4. 探测无头浏览器
5. 后台启动反向代理，写 `.preview-url`

只检查：

```bash
bash setup.sh --check
```

---

## 4. 验证

```bash
node bin/smoke-test.js
```

预期输出：

```text
1) 环境               ✓ ✓ ✓
2) MCP 握手与工具注册   ✓ 握手成功：minigame v0.1.0  ✓ 工具齐全（19 个）
3) 预览服务            ✓ run_game 启动成功  ✓ 预览服务直连 [::1]:3847 → 200
4) 反向代理            ✓ 代理 3848 → 200
5) 日志与截图          ✓ get_logs 可调用  ! 截图需要浏览器…（无头预期）
```

`5)` 的 `!` 在无浏览器连接时是**正常现象**，不是失败。

---

## 5. 配置 MCP

```bash
cat mcp-config.json
```

把内容合并进 MUSE Agent 的 MCP 配置。路径已是绝对路径，直接用。

---

## 6. 截图能力

无头环境下的截图有两种方式：

### 方式一：用打包的 capture.js（推荐）

```bash
node bin/capture.js --workspace /path/to/game --out shot.jpg
```

它会自动尝试拉起 Playwright 无头浏览器连上预览页，截完自动关闭。
需要先装 Playwright：

```bash
bash setup.sh --with-browser
```

### 方式二：手工开页面再调 MCP 工具

```bash
node bin/smoke-test.js --hold=60
# 期间用浏览器打开 http://<MUSE_IP>:3848/
# 另开终端：
node bin/capture.js --workspace /path/to/game --out shot.jpg
```

---

## 7. 对外暴露注意事项

预览页用反向代理暴露在 `0.0.0.0:3848`，**没有任何鉴权**。
如果 MUSE 有公网 IP，请：

- 用安全组 / 防火墙限制 3848 只对可信 IP 开放，或
- 在内网使用，或
- 加一层 Nginx Basic Auth：

```nginx
location / {
    auth_basic "minigame";
    auth_basic_user_file /etc/nginx/.htpasswd;
    proxy_pass http://127.0.0.1:3848;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;          # SSE 必需
    proxy_read_timeout 3600s;     # 长连接必需
}
```

`proxy_buffering off` 与 `proxy_read_timeout` 是 SSE (`/api/events`) 能工作的前提，
少了会表现为页面能打开但日志不刷新。

---

## 8. 常见问题

### Q1: 预览页打开是白屏 / 一直转圈

1. 先确认 `run_game` 已调用且返回 `localhost:3847`
2. `curl http://[::1]:3847/` 看是否 200
3. 检查代理日志 `.run/proxy.log`

### Q2: `No connected preview clients`

**没有浏览器打开着预览页。** 这是无头环境最常见的报错。
按第 6 节处理。

### Q3: `get_logs` 一直返回 `No logs found`

同理——日志由页面内拦截器上报，没页面就没日志。
先让浏览器连上，再等游戏跑一会儿。

### Q4: `Cannot find module './esbuild-linux-x64'` 之类

esbuild 平台包不匹配（Windows 装完直接搬到 Linux）。
重新执行 `npm install esbuild` 或直接 `bash setup.sh`（会自动检测重装）。

### Q5: 端口 3847 被占用

```bash
lsof -i :3847      # 或 ss -lptn 'sport = :3847'
kill -9 <PID>
```

端口写死不可改。

### Q6: 真机预览报 `configMissing`

未配置 AppID / 密钥。见 `README.md` 的「配置 AppID 与密钥」。

### Q7: 真机预览报 `-10008` IP 白名单

把 MUSE 的公网 IP 加到：
mp.weixin.qq.com → 开发管理 → 开发设置 → 小程序代码上传 → IP白名单。
预览页右上角会显示当前公网 IP。

---

## 9. 停止服务

```bash
kill "$(cat .run/proxy.pid)"    # 停代理
```

预览服务由 MCP 进程管理，MCP 客户端断开后随之退出。
残留进程：

```bash
pkill -f 'weixin-minigame-helper-mcp/mcp/index.js'
```

---

## 10. 文件清单

| 文件 | 用途 | 必需 |
|---|---|---|
| `SKILL.md` | Agent 入口，模型读这个 | ✅ |
| `setup.sh` | 环境自举 | ✅ |
| `package.json` | 依赖声明 | ✅ |
| `bin/preview-proxy.js` | 反向代理 | ✅ |
| `bin/capture.js` | 无头截图 | 推荐 |
| `bin/smoke-test.js` | 自检 | 推荐 |
| `examples/minimal-game/` | 验证用示例 | ✅ |
| `references/能力边界与坑位.md` | 已知限制 | 参考 |
