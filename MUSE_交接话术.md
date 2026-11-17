# 交给 Agent / MUSE 的交接话术

直接复制下面整段发给对方（MUSE、其他 Agent、或协作同学）。

---

```text
【任务】部署「微信小游戏开发助手」到本机，并验证可用。

【包里是什么】
weixin-minigame-helper-RELEASE.zip —— 把 WorkBuddy 的微信小游戏插件移植成的
平台无关独立包。底层是腾讯官方 npm 包 @weadmin/weixin-minigame-helper-mcp (MIT)。
能力：在浏览器里注入 wx API 兼容层，不用微信开发者工具就能预览小游戏、
抓 console 日志、截图、真机预览、上传发布。

【部署步骤】
1. unzip weixin-minigame-helper-RELEASE.zip && cd weixin-minigame-helper-RELEASE
   （无 unzip 用：tar -xzf 或 python -c "import zipfile;zipfile.ZipFile('x.zip').extractall('.')"）
2. bash setup.sh
   会自动：检查 Node≥18 → 装依赖 → 探测浏览器 → 后台起反向代理 → 生成 mcp-config.json
   只检查不安装：bash setup.sh --check
3. node bin/smoke-test.js
   全绿即部署成功。5) 里「截图需要浏览器」那条是黄色 !，属正常现象，不是失败。
4. cat mcp-config.json，合并进你的 MCP 配置。工具名形如
   mcp__weixin-minigame__run_game

【强制规则 —— 违反会直接失败】
1. 预览服务只监听 IPv6 回环 [::1]:3847，127.0.0.1 和外部都不通。
   对外必须走反向代理 http://<本机IP>:3848/，绝不要让用户访问 3847。
2. 截图 capture_screenshot 和日志 get_logs 都要求「有浏览器正打开着预览页」。
   没浏览器连接时报 No connected preview clients —— 这不是故障。
   正确顺序：run_game → 用 Playwright/无头 Chrome 打开 http://127.0.0.1:3848/
   → 再调 get_logs / capture_screenshot。
   现成工具：node bin/capture.js --workspace <游戏目录> --out shot.jpg
   （会自动拉无头浏览器，需要先 bash setup.sh --with-browser）
3. 上游文档里反复提到的 preview_url 工具不存在，别调用它。它是 WorkBuddy 宿主
   才有的能力。要开页面就自己开浏览器。
4. 预览端口 3847 写死不可改。被占用先杀占用进程。
5. run_game 是幂等的：代码改完直接调即可，不用判断是否已在运行。

【工作习惯】
- 每改完小游戏代码（.js/.json/.css），立即 run_game + 查日志，不要等用户要求
- 每次 run_game 后必须 get_logs 查错；有错就修再重来，直到无错
  （同一错误修超 5 次 / 累计超 15 次 → 停下问用户）
- 真机预览或上传成功后，禁止刷新页面（二维码会消失）

【真机预览与发布（可选）】
需要微信 AppID + 代码上传密钥，配置方式二选一：
  export WECHAT_APPID=wxXXXX
  export WECHAT_PRIVATE_KEY_PATH=/path/to/private.key
密钥获取：mp.weixin.qq.com → 管理 → 开发管理 → 开发设置 → 小程序代码上传
报 -10008 是 IP 白名单问题，把本机公网 IP 加进白名单即可。
这两项走服务端 API (miniprogram-ci)，不依赖浏览器，无头环境可用。

【安全】
反向代理对外 0.0.0.0:3848 且无鉴权。有公网 IP 的话必须用安全组/防火墙限制，
或按 MUSE_迁移指南.md 第 7 节加 Nginx Basic Auth
（注意 proxy_buffering off 和 proxy_read_timeout，否则 SSE 日志不刷新）。

【验证标准】
node bin/smoke-test.js 输出「自检通过」= 部署成功。
再用 examples/minimal-game 跑一遍完整链路：run_game → 浏览器打开 3848 →
get_logs 有 frame 日志 → capture_screenshot 出图
（画面是绿方块 + "WeChat Mini Game · OK" 文字）。

【先读哪个文件】
详细说明看 README.md；MUSE 专属步骤和 7 个 FAQ 看 MUSE_迁移指南.md；
已知限制和踩坑看 references/能力边界与坑位.md；给 Agent 的入口是 SKILL.md。
```
