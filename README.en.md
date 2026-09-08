<p align="center"><img src="public/app-icon.png" width="80" alt="Blue whale app icon"></p>

# Harness Desktop Assistant

**A simple Windows desktop workspace for AI conversations and file work.** · [中文](README.md)

Start a continuous conversation without choosing a project. Link or switch a local folder only when the assistant needs to read or change files. Each run shows observable actions, tool targets, output files, and the exact failed stage when something goes wrong.

This is an independent desktop project built on DeepSeek Harness. **It is not an official DeepSeek product.** Current version: **v0.4.0**, for Windows 10/11 x64.

**[Download the latest installer](https://github.com/anli1231381-del/DeepSeek-Harness-Desktop/releases/latest)**

![English projects screen](docs/images/work-en.png)

![English environment check](docs/images/environment-en.png)

## Highlights

- Continuous projectless or project-linked conversations on the Home screen.
- Bundled Node.js and Harness; no development environment is required.
- The installer downloads WebView2 when Windows does not already provide it.
- Startup health checks for the desktop UI, Node.js, Harness, Git, and the model connection.
- One-click Git installation through Windows Winget with an official-download fallback.
- Chinese and English interface with a saved language choice.
- DeepSeek, OpenAI, OpenRouter, Anthropic, and custom compatible API connections.
- Local and GitHub Skills, local and remote MCP services, file artifact capture, and Git diffs.
- Failed runs identify the affected stage and provide error copying and retry actions.

## Install and start

1. Open the **[Releases page](https://github.com/anli1231381-del/DeepSeek-Harness-Desktop/releases/latest)**.
2. Download the asset ending in **`windows-x64-setup.exe`**.
3. Install and open **Harness Desktop Assistant** from the Start menu or desktop shortcut.
4. Add a model API under **Settings**, or use an existing Harness configuration.
5. Return to **Home** and send a message. Linking a project is optional.

The installer includes the app's Node.js and Harness runtime. Remote models, official DeepSeek chat, WebView2 download, Git installation, and GitHub extension import require internet access. API access and quota are provided by the service you configure.

Python, Java, compilers, and similar tools are project-specific. The app reports the exact execution stage when one is missing instead of silently changing the machine. API keys are encrypted for the current Windows user and are never included in release packages.

## Development

The app uses Tauri 2, React, TypeScript, and a local Node.js bridge. See [Distribution](docs/DISTRIBUTION.md), [Verification](docs/verification.md), and [third-party notices](THIRD_PARTY_NOTICES.md).
