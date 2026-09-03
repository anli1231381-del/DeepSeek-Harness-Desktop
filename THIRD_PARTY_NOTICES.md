# Third-party software

Harness 桌面助手 includes DeepSeek Harness and the Node.js runtime. This independent desktop interface is not an official DeepSeek product. Third-party names remain the property of their owners.

- DeepSeek Harness 0.1.2-alpha.5: Copyright (c) 2026 DeepSeek, MIT License. The unchanged npm packages retain their `LICENSE` files under `runtime/harness/node_modules/`.
- Node.js 24.20.0: licensed under the MIT License and bundled third-party terms. The complete upstream license is shipped as `runtime/node/LICENSE`.
- Runtime npm dependencies retain the license and notice files supplied in their published packages. The generated `runtime/licenses/NOTICES.txt` includes their inventory and license text, together with the frontend and Rust dependency notices.
- The native `sharp` image dependency includes libvips and other LGPL components, plus cairo under MPL-2.0. `runtime/licenses/NATIVE-SOURCES.md` records source and replacement information; LGPL-3.0, GPL-3.0 and MPL-2.0 license texts are supplied alongside it. These components must not be described as MIT-only. Preserve recipients' modification and debugging rights and provide corresponding source when redistributing them.
- `runtime/licenses/NATIVE-LIBRARY-NOTICES.txt` preserves copyright and license notices from the exact native library and linked Rust dependency sources. The separate `native-image-sources-sharp-0.35.4.zip` release asset contains those sources and their build recipes; keep it available alongside the installer.
- Microsoft Edge WebView2 is provided by Microsoft under its own terms. When it is missing, the installer downloads Microsoft's Evergreen installer; the application does not redistribute a fixed WebView2 runtime.

MIT and BSD packages require preservation of copyright and license notices. Apache-2.0 packages additionally require preserving applicable notices and license text; changes must be identified when made. This build keeps dependency packages unmodified. Other terms, if present in the generated inventory, remain applicable. Keep this file, `runtime/node/LICENSE`, and `runtime/licenses/` with redistributed installers or application folders.

Model API subscriptions, usage charges, accounts, third-party tools, and service terms are separate from these software licenses. No API credentials, user profiles, skills directories, or workspaces are included in the distribution.
