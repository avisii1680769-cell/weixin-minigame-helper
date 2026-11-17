---
name: weixin-minigame-helper
version: 1.0.0
description: |
  微信小游戏开发助手：在无头（headless）Agent 环境中预览、调日志、截图、真机预览与上传发布微信小游戏。

  ## 何时触发
  当用户正在开发微信小游戏，或用户提到「小游戏」「游戏」相关内容时生效。
  工作目录存在 `game.js` 时同样生效。

  ## 触发关键词（匹配任意一个即触发）
  - **预览/运行**：预览、跑一下、运行、看看效果、启动、打开游戏
  - **代码改完自动触发**：任何 `.js` / `.json` / `.css` 变更写入完成后，**必须**立即调用
    `run_game`（幂等：首次启动预览服务，已运行则重新打包并热重载），无需等用户指示
  - **截图/视觉检查**：截图、截屏、画面、screenshot、看看游戏长什么样
  - **真机**：真机预览、真机测试、扫码、手机上看看
  - **上传**：上传、发布、上传开发版、上传体验版、发布到微信

  ## 触发后执行
  1. 代码改完 → `run_game` → 打开/刷新预览 URL → 等约 2 秒 → `get_logs` 查错 →
     有错就修 → 再 `run_game` → 再 `get_logs`，直到无错
  2. 用户要求预览 → 同上流程
  3. 真机/上传 → `real_device_preview` / `publish`，**成功后禁止刷新预览页**（二维码会消失）

  ## 核心原则
  - **代码改完必须自动预览，不等用户要求**——最重要的规则
  - **每次 run_game 后必须查日志，有错必须修复并循环到无错**
  - 真机/上传成功后禁止刷新网页
  - 缺 AppID/密钥时必须引导配置，禁止跳过或用假数据绕过
allowed-tools: mcp__weixin-minigame__run_game, mcp__weixin-minigame__get_logs, mcp__weixin-minigame__capture_screenshot, mcp__weixin-minigame__capture_screenshot_burst, mcp__weixin-minigame__real_device_preview, mcp__weixin-minigame__publish, mcp__weixin-minigame__mp_get_onboarding, mcp__weixin-minigame__mp_save_onboarding, mcp__weixin-minigame__mp_api
---

# 微信小游戏开发助手

本 Skill 驱动一个本地 MCP 服务（`@weadmin/weixin-minigame-helper-mcp`），
在浏览器里注入微信 `wx` API 兼容层，让 Canvas2D / WebGL / Unity / Cocos / Three.js
等类型的小游戏**不需要微信开发者工具**就能预览、抓日志、截图。

---

## 🔴 最高优先级规则：代码改完立即预览

每当你生成、修改、调试了小游戏代码（`.js` / `.json` / `.css` 等），文件写入完成后：

1. 立即调用 `run_game`（`workspacePath` = 游戏目录**绝对路径**）
2. 用当前环境可用的方式打开或刷新预览 URL
3. 等约 2 秒 → `get_logs` 查错
4. 有错 → 修复 → 回第 1 步；无错 → 结束并告知用户

`run_game` 是**幂等**的：首次调用启动预览服务，后续调用只重新打包并热重载。
预览 URL 与端口在整个会话中保持不变，**不需要判断游戏是否已在运行，直接调用即可**。

**修复循环退出条件**（防止无限重试）：

- 同一错误（相同报错或相同根因）修复 **超过 5 次** → 停下，报告已尝试的修法与错误详情，问用户是否继续
- 不同错误累计修复 **超过 15 次** → 停下，汇总所有错误与尝试，问用户是否继续
- 用户选择继续时重置计数器

> 一轮修复中所有文件都改完后只调用一次 `run_game`，不要每改一个文件就重载一次。

---

## 工具速查

| 工具 | 作用 | 关键参数 |
|---|---|---|
| `run_game` | 启动/刷新预览（幂等） | `workspacePath`：含 `game.js` 的目录绝对路径 |
| `get_logs` | 取游戏 console 日志 | `filter`：可选正则，如 `"error|Error|Uncaught"` |
| `capture_screenshot` | 截当前游戏画面 | `format`：`image/jpeg`（更小）；`quality`：0-1 |
| `capture_screenshot_burst` | 连拍，捕捉动画过程 | 见工具 schema |
| `real_device_preview` | 生成二维码真机预览 | `workspacePath` |
| `publish` | 上传开发版 | `workspacePath`、`version`（如 `1.0.0`）、`desc` |
| `mp_*` | 微信平台接入引导（AppID/资质/分步校验） | 见工具 schema |

---

## ⚠️ 无头环境的三条硬约束

这是本移植版与 WorkBuddy 原版的**唯一实质差异**。必须遵守，否则工具会报错：

### 1. 预览服务只绑 IPv6 回环，必须走代理

原服务监听 `[::1]:3847`，**外部域名、容器外部、VM 宿主都访问不到**。
因此本移植版附带反向代理 `bin/preview-proxy.js`：

```bash
node bin/preview-proxy.js --port 3848
# 然后把外部访问指向 http://<主机>:3848/
```

预览页内部全部使用相对路径（`/api/events`、`/api/logs`、`/api/command`），
所以经代理后页面会自动适配外部域名，**无需改动原包**。

`setup.sh` 会自动在后台拉起该代理并写入 `.preview-url`。

### 2. 截图必须先有浏览器连接

`capture_screenshot` 报 `No connected preview clients` 时，说明**没有浏览器打开着预览页**。
无头环境解决顺序：

1. 调用 `run_game` 拿到 URL
2. 用 Playwright / Puppeteer / 无头 Chrome 打开该 URL（走代理地址）
3. 等页面加载完（出现 `[wx-compat] Log interception installed` 日志即可）
4. 再调 `capture_screenshot`

**没有浏览器连接时，`get_logs` 也拿不到任何内容**（日志由页面内的拦截器上报）。

### 3. 端口 3847 写死

预览服务端口固定 3847，不可配置。若被占用，先杀掉占用进程。
代理端口可用 `--port` 任意指定，建议对外只暴露代理端口。

---

## 标准工作流

### 场景一：生成/修改代码后预览

```text
1. 确认游戏目录含 game.js（微信小游戏入口）
2. run_game(workspacePath=<绝对路径>)  → 返回 http://localhost:3847
3. 用浏览器打开代理地址 http://<host>:<proxy-port>/
4. 等约 2 秒 → get_logs(filter="error|warn|Uncaught|TypeError|ReferenceError")
5. 有错 → 修代码 → run_game → 回第 4 步；无错 → 告知用户运行正常
```

### 场景二：看画面 / 视觉验证

```text
1. 确保 run_game 已调用、浏览器已连接
2. 等约 2 秒让首帧渲染完成
3. capture_screenshot(format="image/jpeg", quality=0.6)
4. 直接分析返回的图片，判断渲染是否符合预期
```

### 场景三：真机预览

1. 先 `run_game`，让预览页在浏览器里跑起来
2. 未配置 AppID / 密钥时，引导用户：
   - 预览页右上角 ⚙️ → 填 AppID + 代码上传密钥；
   - 或设环境变量 `WECHAT_APPID` + `WECHAT_PRIVATE_KEY_PATH`
3. 密钥获取路径：mp.weixin.qq.com → 管理 → 开发管理 → 开发设置 → 小程序代码上传
4. 调 `real_device_preview` → 二维码在预览页弹窗展示
5. **禁止再调用 `run_game` 或刷新页面**（二维码会消失）

### 场景四：上传开发版

1. 确认版本号（semver，如 `1.0.0`）与版本描述
2. 调 `publish(workspacePath, version, desc)`
3. 返回 `configMissing` → 按场景三引导配置
4. 成功 → 告知用户去 mp.weixin.qq.com 提交审核

---

## 微信小游戏项目结构

```text
game-dir/
├── game.js              # 入口文件（必须）
├── game.json            # 游戏配置
├── project.config.json  # 微信开发者工具项目配置（含 appid）
└── ... 资源文件
```

---

## 注意事项

- 游戏目录**必须**含 `game.js`
- 预览服务自动注入 `wx` API 兼容层，大部分小游戏 API 可在浏览器中模拟运行
- 真机预览与上传需要微信 AppID + 代码上传密钥
- IP 白名单报错（错误码 `-10008`）→ 在公众平台「小程序代码上传 → IP白名单」加入当前公网 IP
  （预览页右上角会显示当前公网 IP）
- 真机预览 / 上传成功后禁止刷新页面
