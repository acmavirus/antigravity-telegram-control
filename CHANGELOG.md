# Changelog

All notable changes to the **Antigravity Telegram Control** extension will be documented in this file.

---

## v1.0.5 — Antigravity Quota API Updates & Stability Patch
*   **🩺 Modern Antigravity Quota Handshake**: Switched health check to use `/Heartbeat` and `/GetUserStatus` endpoints, resolving connection failures from the deprecation of `/GetUnleashData` in recent Antigravity updates.
*   **🚀 Ultra-Fast Connection**: Prioritized testing the extracted CLI port directly before running PowerShell port enumeration, reducing quota query latency from ~8s to ~1s.
*   **📊 Group-Level Quota Synchronization**: Fully aligned with Antigravity's new grouped quota architecture (Weekly & 5-Hour shared limit pools for Gemini Models and Claude/GPT 3P Models), correctly inheriting percentage allocations and avoiding `undefined`/`N/A` model values.
*   **🧹 Filtered Ghost Models**: Excluded internal placeholder models without quota configurations from cluttering Telegram and status bar reports.
*   **🌐 Protocol Defaulting**: Defaulted localhost connections to HTTP with resilient fallback, eliminating SSL packet length errors.

## v1.0.4 — Update Quota API & Language Server Handshake
*   **🩺 Modern Antigravity Quota Handshake**: Updated health check to use `/Heartbeat` and `/GetUserStatus` endpoints, fixing connection failures caused by the deprecation/404 of `/GetUnleashData` in the updated Antigravity binary.
*   **🚀 Ultra-Fast Connection**: Prioritized testing the extracted CLI port directly before running PowerShell port enumeration, reducing quota query latency from ~8s to ~1s.
*   **📊 Group-Level Quota Synchronization**: Fully aligned with Antigravity's new grouped quota architecture (Weekly & 5-Hour shared limit pools for Gemini Models and Claude/GPT 3P Models), correctly inheriting percentage allocations and avoiding `undefined`/`N/A` model values.
*   **🧹 Filtered Ghost Models**: Excluded internal placeholder models without quota configurations from cluttering Telegram and status bar reports.
*   **🌐 Protocol Defaulting**: Defaulted localhost connections to HTTP with resilient fallback, eliminating SSL packet length errors.

## v1.0.3 — Fix Quota & Status Bar HUD for Antigravity Updates
*   **⚡ Modern Antigravity Process Discovery**: Fixed quota HUD and `/quota` bot command failure after Antigravity IDE updates. Added automatic detection for the new `agy.exe` (Windows) and `agy` (macOS/Linux) binary alongside legacy `language_server` processes.
*   **🔌 Dynamic Port & Parameter Parsing**: Added support for `--hub-port` and `--app_data_dir=...` argument syntax, ensuring instant port resolution and CSRF token extraction across all IDE versions.
*   **🗑️ Removed Account Management**: Cleaned up the Accounts management tab, commands, and background listeners as requested.

## v1.0.2 — Injected AutoScript Fix & IDE Compatibility

## v1.0.1 — Multi-Account Management & Quota Auto-Rotation
*   **👥 Multi-Account Management**: Seamlessly manage, snapshot, and switch between multiple Google/Antigravity accounts directly in Antigravity IDE and remotely via Telegram.
*   **🤖 Telegram Bot Commands**: Added `/accounts` (list all accounts & active status), `/switch <id|index>` (instant account switching), `/save_account [name]` (snapshot current login), and `/rotate_account` (round-robin account cycling).
*   **🔄 Auto-Rotation on Quota Depletion**: Automatically rotates to the next available saved account whenever the active account's 5-Hour or Daily quota reaches 98%+ limit, keeping agents working 24/7 without interruption.
*   **💻 Native Sidebar Accounts Tab**: Dedicated "Accounts" panel in Webview settings with one-click snapshot, account switching, deletion, auto-rotation settings, and a `🔄 Refresh Info` button.
*   **⚡ Enhanced Language Server Process Discovery**: Completely overhauled process discovery logic across Windows, macOS, and Linux to reliably detect the Antigravity backend language server processes.
*   **🔒 Robust CSRF & Port Extraction**: Improved regex parsing to extract dynamic port, CSRF token, and extension server endpoints directly from process command lines without false positives.
*   **📊 Status Bar Quota HUD Alignment**: Clean `%/%` percentage readout for prompt credit and model quotas directly on the VS Code status bar.
*   **🎯 Consolidated Automation & Stats**: Merged Click Statistics dashboard and recent logs directly into the **Auto (Automation Settings)** tab for a streamlined UI.

## v1.0.0 — Major Official Release
*   **📜 Smart Auto Scroll**: Automatically scrolls the Antigravity chat panel while the agent generates content, pauses when you manually scroll up to read, and resumes when new content is generated.
*   **🔀 Dynamic Multi-Instance Support**: Micro HTTP IPC server dynamically binds within port range `48787-48850` with port auto-discovery, allowing multiple Antigravity IDE windows to run simultaneously without conflicts.
*   **🛡️ Checksum & Cache Self-Healing**: Automatically recalculates SHA-256 checksums in `product.json` (`updateProductChecksums()`) and clears V8 bytecode cache (`clearV8CodeCache()`) to resolve VS Code "Corrupt Installation" alerts.
*   **🎯 DOM Protection & Chat-Only Accept**: Intelligent DOM context filtering protects diff editors, merge views, inline hunk actions, and code viewports while safely auto-approving agent chat steps.
*   **📊 Click Stats Dashboard**: Real-time click history, top button crown badge, progress bars, and stats reset controls in the Webview UI.
*   **⚡ Native Win32 Keep Waiting Clicker**: Automatic win32 post-message execution for native Windows system dialogs.

## v0.0.9
*   **☁️ Cloudflare Tunnel Integration**: Added support for Cloudflare Tunnel (`cloudflared`) to securely expose the Web Mirror to the public internet using TryCloudflare, with the link automatically sent to Telegram.
*   **💬 Responsive & Smart Chat Interface**: Optimized the Web Mirror UI with a responsive design for mobile screens (under 600px wide) and low-height screen viewports (under 520px height), ensuring layout visibility and clean spacing when virtual keyboards are open.
*   **✍️ Multiline Message Input**: Replaced the single-line input text field in the Web Mirror client with a smart `textarea` that auto-adjusts its height up to 150px and supports Shift+Enter for new lines and Enter to send.
*   **🐛 Client Web connection fix**: Restored the missing DOM element `<span id="statusText"></span>` to resolve JavaScript runtime crashes during client connection establishment, enabling the real-time screen stream to load properly.

## v0.0.8
*   **🌐 Web Mirror Public Tunneling**: Seamlessly expose the Web Mirror server to the public internet. Supports **localhost.run** (free SSH tunnel with zero credentials/setup required) and **ngrok** (using your global auth token or settings-defined token). Once started, the public URL is automatically posted directly to your Telegram chat.
*   **⚡ Local Auto-Accept Manager**: Added a background worker that polls and automatically approves Agent steps and terminal executions in the IDE. Uses a hybrid approach combining VS Code native commands and CDP-based Shadow DOM clicking.
*   **⚙️ Automation Configuration UI**: Added a dedicated "Automation" panel to the custom settings view to easily configure Auto-Accept and Auto-Retry options.
*   **🛠️ Expanded Target Matching**: Deep Shadow DOM traversal recognizes various interactive button tokens (`accept all`, `run`, `always allow`, etc.) and automatically expands collapsed steps when they require input.

## v0.0.7
*   **🌐 Interactive Web Mirror Server**: Added a local HTTP/WebSocket stream server. Casts the cropped Agent view onto a canvas in any browser with support for mouse interaction translation and prompt injection.
*   **📊 Status Bar Quota HUD**: Dynamically locates the Antigravity backend language server, connects using scraped CSRF tokens, and shows remaining prompt credits / model usage percentage on the VS Code status bar.
*   **🔒 Secure Command Scoping**: Configured command scopes to hide bot slash commands from general view, showing suggestions only to the authorized Chat ID.

## v0.0.6
*   **🗂️ Tabbed UI Interface**: Organized settings into intuitive tabs: "Settings" for Telegram bot configuration and "Agents" for file management.
*   **📝 Integrated Agent Editors**: Edit your `agents.md` and `gemini.md` files directly within the VS Code sidebar without switching contexts.
*   **📍 Custom Path Support**: Full support for absolute file paths, allowing you to manage agent files anywhere on your system (e.g., in `.gemini` home folder).
*   **🔍 Auto-find Intelligence**: New "Auto-find" button that automatically scans your home directory for established `.gemini` configurations and pre-fills them.
*   **🛠️ Workflow Optimization**: Improved save logic that synchronizes changes between the editor and the filesystem seamlessly.

## v0.0.5
*   **⚡ Improved Smart Detection**: Enhanced detection of Agent chat elements using Shadow DOM traversal, ensuring the bot always "sees" the UI regardless of how deep it's nested.
*   **📜 Auto-Scroll Logic**: Added intelligence to automatically scroll the chat container to the bottom after detection or before taking a screenshot.
*   **🎯 Targeted Capture**: Prioritizes the correct VS Code webviews using title-based matching and intelligent element scoring.
