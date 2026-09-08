# 验证记录

验证版本：Windows x64 0.4.0。内置 Node.js 24.20.0、DeepSeek Harness/SDK 0.1.2-alpha.5。

- `npm test`：46 项通过，覆盖无项目连续对话、项目关联、队列、停止与重试、结构化执行步骤、失败阶段、成果捕获、Skills、MCP、GitHub 扩展、Git 检测与安装结果、OpenRouter、语言切换及持久化、密钥加密和模型协议。
- `npm run build`：TypeScript 检查与生产前端构建通过。
- `cargo check --offline`：Tauri 桌面端编译检查通过。
- 分发准备验证：内置 Node.js、Harness SDK、原生模块和 ripgrep 通过；26,886 个运行时文件无符号链接。382 份第三方源码归档和 767 个 npm/Rust 依赖声明通过核对。
- NSIS 安装包构建通过，文件为 `Harness 桌面助手_0.4.0_x64-setup.exe`。
- 安装包实际安装到 `D:\deepseekharness\HarnessDesktop-App-v040-release2`，构建目录与安装目录的发布路径检查均通过。
- `tests/native-smoke.mjs` 从上述安装目录启动，并使用不含 Git、Node.js 和 Harness 的隔离 `PATH`。内置运行环境检测、SDK 握手、本地模拟模型真实 IPC 请求、模型获取与切换、缺少 Git 提示、项目导航、主题色与正常关闭均通过。
- 真实 OpenRouter 验证使用 Windows 已加密保存的连接，模型为 `openrouter/auto`。Harness 实际完成请求、创建 `verification.txt`，程序成功自动捕获该文件；验证脚本未读取或输出明文密钥。
- 中文与英文界面测试覆盖切换、主要导航、项目页、设置页和重启后的语言持久化；README 截图来自本版实际构建界面。

## 已知边界

- 缺少 WebView2 时由 NSIS 安装器使用微软引导程序联网安装。本机已有 WebView2，因此未在无 WebView2 的全新虚拟机中复现该下载流程。
- Git 一键安装通过 Windows Winget；没有 Winget 或安装失败时会显示“安装 Git”阶段的原因，并提供 Git for Windows 官方下载入口。
- Python、Java 和编译器属于项目专用工具，不会在没有明确项目需求时自动安装。相关命令失败会显示在本轮工作步骤中。
- 安装包尚未配置代码签名，Windows 可能显示来源提示。
