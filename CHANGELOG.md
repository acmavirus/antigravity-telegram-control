# Changelog

All notable changes to the **Antigravity Telegram Control** extension will be documented in this file.

---

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
