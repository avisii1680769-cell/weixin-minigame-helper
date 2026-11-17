# 微信小游戏开发助手 · 无头环境移植版

把 WorkBuddy 内置的 `weixin-minigame-helper` 插件移植成**平台无关的独立包**，
可在 MUSE、云沙箱、Docker、VM、CI 等无 GUI 环境中运行。

底层能力来自公开 npm 包 `@weadmin/weixin-minigame-helper-mcp`（腾讯 weadmin，
MIT 协议）。本移植版补齐了原插件依赖 WorkBuddy 宿主而缺失的部分。

---

## 为什么需要移植

原插件是 WorkBuddy 插件，依赖宿主的两个能力：

| 原插件做法 | 移植版方案 |
|---|---|
| `preview_url` 工具打开内置浏览器 | **该工具不存在于 MCP 包中**，改用 Playwright / 浏览器 / 直接给 URL |
| 预览服务监听 `[::1]:3847` | 附 `bin/preview-proxy.js`，绑 `0.0.0.0` 反代出去 |
| 依赖 WorkBuddy 的 hook 与插件加载 | 改为标准 MCP server 配置，任何 Agent 都能挂 |

前两项是**硬阻塞**：不处理的话，在 MUSE 里预览页根本打不开。

---

## 快速开始

```bash
bash setup.sh              # 装依赖 + 起代理 + 生成 MCP 配置
bash setup.sh --check      # 只检查，不安装
bash setup.sh --with-browser   # 额外装 Playwright chromium（截图需要）
```

验证：

```bash
node bin/smoke-test.js          # 完整自检
node bin/smoke-test.js --no-run # 只测握手与工具列表
```

截图：

```bash
node bin/capture.js --workspace <游戏目录> --out shot.jpg
```

---

## 目录结构

```text
weixin-minigame-helper-RELEASE/
├── SKILL.md                  ← Agent Skill 入口，MUSE 的模型读这个
├── README.md                 ← 本文件
├── MUSE_迁移指南.md           ← MUSE 专项部署说明
├── setup.sh                  ← Linux/macOS/MUSE 一键自举
├── package.json
├── mcp-config.json           ← setup.sh 生成的 MCP 配置片段
├── bin/
│   ├── preview-proxy.js      ← 反向代理（关键：把 IPv6 回环暴露出去）
│   ├── capture.js            ← 无头截图工具（可直接产出图片文件）
│   └── smoke-test.js         ← 端到端自检
├── examples/minimal-game/    ← 最小可运行示例，用于验证链路
└── references/
    └── 能力边界与坑位.md
```

---

## 三条硬约束

### 1. 预览服务只绑 IPv6 回环

原服务监听 `[::1]:3847`。容器外、宿主、外部域名**都访问不到**。
必须通过 `bin/preview-proxy.js` 代理（默认对外 3848）。

预览页内部全用相对路径（`/api/events`、`/api/logs`、`/api/command`），
所以代理后页面自动适配外部域名，**无需改原包**。

### 2. 截图与日志都需要浏览器连着预览页

`capture_screenshot` 报 `No connected preview clients` 表示没有浏览器打开预览页。
`get_logs` 同理——日志由页面内的 `wx-compat` 拦截器上报，没页面就没日志。

无头环境必须先用 Playwright / 无头 Chrome 打开预览 URL，再调这些工具。
`bin/capture.js` 已内置此逻辑（会自动尝试拉起无头浏览器）。

### 3. 预览端口 3847 写死

不可配置。被占用就杀掉占用进程。对外只暴露代理端口。

---

## 能力矩阵

| 能力 | 无头环境可用 | 前置条件 |
|---|---|---|
| 生成/修改小游戏代码 | ✅ | 无 |
| 启动预览服务 `run_game` | ✅ | 无 |
| 浏览器里看到画面 | ✅ | 有浏览器访问代理地址 |
| 抓 console 日志 `get_logs` | ⚠️ | 必须有浏览器连着预览页 |
| 截图 `capture_screenshot` | ⚠️ | 同上；或直接用 `bin/capture.js` |
| 真机预览 `real_device_preview` | ⚠️ | AppID + 上传密钥 + IP 白名单 |
| 上传发布 `publish` | ⚠️ | 同上 |

真机预览与上传本质是**服务端 API 调用**（`miniprogram-ci`），不依赖浏览器；
只要配置齐全，无头环境完全可以跑通。

---

## 配置 AppID 与密钥

两种方式，任选其一：

**环境变量（推荐用于 CI / MUSE）**

```bash
export WECHAT_APPID=wxXXXXXXXXXXXXXXXX
export WECHAT_PRIVATE_KEY_PATH=/path/to/private.key
```

**预览页配置**

打开预览页 → 右上角 ⚙️ → 填 AppID 和代码上传密钥。

密钥获取：mp.weixin.qq.com → 管理 → 开发管理 → 开发设置 → 小程序代码上传。

> IP 白名单报错（`-10008`）时，需要在公众平台把当前公网 IP 加进白名单。
> 预览页右上角会显示当前公网 IP。

---

## 接入你的 Agent

把 `mcp-config.json` 的内容合并进 Agent 的 MCP 配置即可：

```json
{
  "mcpServers": {
    "weixin-minigame": {
      "command": "node",
      "args": ["/绝对路径/weixin-minigame-helper-RELEASE/node_modules/@weadmin/weixin-minigame-helper-mcp/mcp/index.js"]
    }
  }
}
```

工具名会变成 `mcp__weixin-minigame__run_game` 这样的形式，
与 `SKILL.md` 里的 `allowed-tools` 一致。

---

## 协议与来源

- 上游包：`@weadmin/weixin-minigame-helper-mcp` v0.1.45
- 上游仓库：`https://git.woa.com/weadmin/ai-minigame-engine.git`
- 协议：MIT

本移植版新增的 `bin/*.js`、`setup.sh`、文档与示例同样以 MIT 发布。
