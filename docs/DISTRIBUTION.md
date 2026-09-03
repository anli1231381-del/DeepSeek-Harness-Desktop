# Windows 发行

面向使用者的交付物是 `*-setup.exe`。内置 Node.js 24.20.0 x64、DeepSeek Harness 0.1.2-alpha.5、同版本 SDK 和多模型适配器。使用者无需安装 Node、npm、Rust 或 Harness。工作模式填写自己的模型 API 并选择项目；对话模式直接登录 DeepSeek 官网，无需 API 配置。

支持 Windows 10/11 x64。安装到当前用户目录；首次缺少 WebView2 时，由安装器联网下载 Microsoft Evergreen Runtime。Windows ARM 原生包尚未构建。Git 差异需要 Git；项目需要的 Python、编译器、数据库、外部 MCP、额外 Skills 等工具仍由该项目决定，不属于此运行时。

## 开发者构建

需要 Node 24、Rust stable、MSVC C++ 构建工具和 Windows SDK；源码下载与归档使用 Windows 自带的 `curl` 和 `tar`。新克隆使用 `npm ci`，然后：

```powershell
npm test
cargo fetch --locked --manifest-path src-tauri/Cargo.toml
./scripts/desktop.ps1 bundle
```

`bundle` 下载经过固定 SHA-256 校验的官方 Node 压缩包（含 npm/npx）；使用 `distribution/package-lock.json` 安装 npm 生产依赖，相同 lock 的已验证安装会复用；用内置 Node 验证原生模块、ripgrep、隔离配置下的真实 SDK 握手；生成前端、Rust 和运行时依赖许可；构建 NSIS 安装器及独立的 native library 对应源码归档。它不会复制开发机 Harness 目录、API 密钥、用户 Skills 或项目。

默认使用系统临时目录暂存运行时，安装器输出为 `src-tauri/target/release/bundle/nsis`。可用 `-DistributionRoot` 指定暂存位置；需要将工具链和大文件放在其他磁盘时，设置 `HARNESS_DESKTOP_BUILD_ROOT` 或传入 `-BuildRoot`。没有配置专用工具链时，使用系统已安装的 Rust 和 Node。

运行时、源码附件和依赖缓存会自动复用。发布构建统一使用脚本，确保编译器将本机目录替换为通用路径：

```powershell
./scripts/desktop.ps1 bundle -DistributionRoot (Join-Path $env:TEMP 'harness-desktop-distribution')
```

不要只分发 Cargo 输出的单个 EXE；它需要安装器收录的 `runtime` 资源。调试构建 `desktop.ps1 build` 仍仅输出开发用 EXE。

## GitHub

提交源文件、两个 npm lock 文件及 Cargo.lock。运行时和构建缓存已被忽略，不提交本机配置或密钥。GitHub Actions 对 PR、main/master 和手动触发构建安装器；`v0.1.0` 这样的版本 tag 会创建**草稿发行**供检查后发布。不会直接公开新的发行版本。

发布时附上安装器、`source-archives/native-image-sources-sharp-0.35.4.zip`、SHA-256 校验文件和许可文件；工作流会自动附上这些资产。源码归档按 `distribution/native-sources.json` 校验全部 382 份原生库、构建配方和 librsvg Rust 依赖源码。安装器目前没有配置代码签名；有可信签名证书后再配置 Tauri 签名。发行前在没有 Node/Harness 的干净 Windows 上完成实际安装、启动、API 配置及任务测试。当前自动验证覆盖独立运行时及 SDK，不能代替干净系统安装测试。

## 许可

Harness 主项目为 MIT；Node/npm 包含 MIT、Artistic-2.0 和其他第三方条款。完整运行时另含 LGPL 的 libvips 组件，不能把整个发行包称为“全 MIT”。保留安装目录中的 `THIRD_PARTY_NOTICES.md`、`runtime/node/LICENSE`、`runtime/licenses/` 和依赖自带许可。`distribution/NATIVE-SOURCES.md` 记录对应源码归档和动态库替换方式。公开再分发时让源码归档与安装器一起持续可下载。

第三方许可证仅适用于对应组件。模型服务由使用者自己的账号提供。
