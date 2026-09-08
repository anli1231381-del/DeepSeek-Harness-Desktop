# Harness 桌面助手 v0.4.0

这一版让软件在没有开发环境的 Windows 电脑上更容易使用，并让每次工作的问题可以直接定位。

## 本版更新

- 启动后逐项检查 WebView2、内置 Node.js、Harness、Git 和模型连接。
- Node.js 与 Harness 继续随安装包提供；缺少 WebView2 时由安装器联网补齐。
- 未安装 Git 时可在扩展页面调用 Windows Winget 一键安装；失败时保留详细原因和官方入口。
- 新增中文与英文切换，语言选择自动保存。
- 执行过程显示工作目录准备、Harness 启动、实际工具及目标、文件成果捕获和完成状态。
- 失败记录明确指出发生问题的阶段，支持复制错误和再次执行。
- 保持无项目连续对话、随时关联项目、Skills、MCP、GitHub 扩展、OpenRouter 和 DeepSeek 登录入口。
- GitHub 首页增加中英文介绍与新版界面截图。

## 安装说明

下载 `windows-x64-setup.exe`。普通用户无需安装 Node.js、npm、Rust 或 Harness。网络模型仍需用户自己的 API 配置和可用额度。

安装包尚未配置代码签名，Windows 可能显示来源提示。Python、Java 和编译器等项目专用工具按实际项目需要安装。
