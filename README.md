# 🌌 Antigravity Telegram Control

[![GitHub Release](https://img.shields.io/github/v/release/acmavirus/antigravity-telegram-control?style=flat-square)](https://github.com/acmavirus/antigravity-telegram-control)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://github.com/acmavirus/antigravity-telegram-control/blob/main/LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/acmavirus/antigravity-telegram-control?style=flat-square)](https://github.com/acmavirus/antigravity-telegram-control/stargazers)

> **Remote-control and monitor your Antigravity IDE Agent through Telegram or a local Web Mirror.** Interact with your AI, auto-approve actions, check your quota, run terminal commands, and stream real-time visual updates from anywhere.

---

## 🚀 Key Features

*   **🤖 Remote Interaction (`/ask`)**: Prompt your Antigravity Agent directly from Telegram.
*   **📸 Intelligence Monitoring**: 
    *   **Auto-Finish Detection**: Automatically notifies you and sends a cropped screenshot when the Agent completes its response.
    *   **Frame Capture (`/screenshot`)**: Get a high-definition, cropped screenshot of the current Agent session.
    *   **Alarm Notification (`/alarm`)**: Let the bot watch the Agent and notify you exactly when it's done.
*   **🛑 Generation Control (`/stop`)**: Instantly abort the Agent's generation if it is over-generating or stuck.
*   **🐚 Terminal Command Execution (`/cmd`)**: Execute shell commands in your active VS Code terminal remotely.
*   **🔍 Manual Verification (`/check`)**: Force check the Agent's status and get a fresh visual update.
*   **📊 Quota & Credits HUD (`/quota` & Status Bar)**:
    *   **Interactive Status Bar**: Real-time display of your prompt credits and remaining quota directly in the VS Code status bar.
    *   **On-Demand Query**: Query account tier, prompt credits, flow credits, and remaining model tokens at any time using `/quota`.
*   **⚡ Local Auto-Accept**: Automatically accept agent steps, file changes, and terminal executions locally without needing to manually click them in the IDE.
*   **🌐 Web Mirror Server & Tunneling**: Run a local HTTP & WebSocket server to stream and interact with the Antigravity Agent chat panel from any device (phone, tablet, browser) in real-time. Includes automatic public tunneling (**localhost.run** or **ngrok**) to securely access the mirror from external networks, sending the live link directly to your Telegram bot.
*   **🌍 Multi-language Support**: Fully localized in 15+ languages including English, Vietnamese, Chinese, Japanese, French, German, Italian, Spanish, Arabic, Hindi, Turkish, and Indonesian.
*   **🔒 Secure Sandbox**: Access is restricted to your specific authorized Telegram Chat ID. Slash command suggestions are scope-limited so they only appear for your chat.

---

## 🛠 Prerequisites

To enable high-level UI interaction (smart cropping, auto-detection, and the Web Mirror server), launch VS Code with the remote debugging port enabled:

```powershell
# Launch VS Code with CDP enabled
code --remote-debugging-port=9222
```

> [!IMPORTANT]
> The debugging port must be open for the extension to "see" and "interact" with the Antigravity Agent's webview. The default port is `9222`.

---

## 📥 Installation & Setup

1.  **Install VSIX**: Download the latest `.vsix` from the release artifacts and install it via the Extensions view in VS Code (`Install from VSIX...`).
2.  **Configuration**:
    *   Open the **Telegram Control** sidebar.
    *   Input your **Bot Token** (obtained via [@BotFather](https://t.me/botfather)).
    *   Input your **Allowed Chat ID** (Type `/start` on your bot to see your ID).
    *   Select your preferred **Language**.
3.  **Activation**: Click **Save Settings** and **Register Slash Commands**.

---

## 🤖 Telegram Slash Commands

| Command | Description |
| :--- | :--- |
| `/start` | Show welcome message and your Telegram Chat ID. |
| `/ask <text>` | Send a query to the Antigravity Agent and receive a notification on completion. |
| `/stop` | Abort the current Agent generation. |
| `/alarm` | Monitor the Agent and notify you with a screenshot when it finishes. |
| `/screenshot` | Capture a precise, cropped frame of the Agent chat area. |
| `/check` | Verify completion status and get a visual update. |
| `/quota` | Query prompt credits, flow credits, tier information, and remaining model limits. |
| `/cmd <cmd>` | Run a command in the active VS Code terminal. |
| `/help` | List all available commands. |

---

## 🌐 Web Mirror Server & Tunneling
 
Enable a local Web Mirror in the settings to interact with your Agent on any device on your local network:
*   **Port**: Custom port selection (default: `9999`).
*   **Security Token**: Add an optional secret token to prevent unauthorized access (`http://localhost:9999/?token=YOUR_TOKEN`).
*   **Interactivity**: Stream the agent chat panel via high-frame-rate screencasting. Click directly on the canvas to click buttons (Accept, Reject, Run command) inside the IDE chat panel, and type messages in the input box to send them to the agent.
*   **🌐 Public Tunneling**: Expose the mirror server to the public internet securely with a single click. Supports **localhost.run (SSH)** (free, zero configuration required) and **ngrok** (stable tunnel). When started, the public URL (appended with your security token) is automatically sent directly to your Telegram chat so you can open it on your phone instantly.

---

## ⚡ Local Auto-Accept

Save time and run autonomous tasks uninterrupted:
*   **Automatic approvals**: Automatically clicks "Accept", "Confirm", "Run", or "Allow once" buttons for agent steps and terminal executions.
*   **Configurable checking interval**: Set the poll frequency (minimum: `200ms`, default: `800ms`) in the automation settings tab.

---

## ⚙️ Configuration Options

Configure the extension inside the VS Code Settings (`Ctrl+,`) under **Antigravity Telegram Control**:

| Setting | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `botToken` | `string` | `""` | Telegram Bot Token from @BotFather. |
| `allowedChatId` | `string` | `""` | Telegram Chat ID authorized to interact with the bot. |
| `debuggingPort` | `number` | `9222` | Remote debugging port VS Code was launched with. |
| `language` | `string` | `"en"` | Bot message translation language. |
| `agentsMsPath` | `string` | `""` | Path to your custom `agents.md` file. |
| `geminiMdPath` | `string` | `""` | Path to your custom `gemini.md` file. |
| `autoRetry` | `boolean` | `false` | Automatically retry generation if the Agent times out or fails. |
| `showStatusBar` | `boolean` | `true` | Show Antigravity quota and credits in the VS Code status bar. |
| `statusBarUpdateInterval`| `number` | `60` | Quota update interval in seconds. |
| `autoAccept` | `boolean` | `false` | Enable automatic local approval of Agent actions. |
| `autoAcceptInterval` | `number` | `800` | Local acceptance check frequency in milliseconds. |
| `enableMirror` | `boolean` | `false` | Spin up local Web Mirror server. |
| `mirrorPort` | `number` | `9999` | HTTP & WebSocket server port. |
| `mirrorToken` | `string` | `""` | Optional access token for Web Mirror security. |
| `enableTunnel` | `boolean` | `false` | Enable automatic tunneling to expose the Web Mirror to the public internet. |
| `tunnelType` | `string` | `"localhost.run"` | Tunnel provider to use (`"localhost.run"`, `"ngrok"`). |
| `ngrokAuthToken` | `string` | `""` | Optional auth token for ngrok (if using ngrok). |

---

## 🆕 What's New

### v0.0.9
*   **☁️ Cloudflare Tunnel Integration**: Added support for Cloudflare Tunnel (`cloudflared`) to securely expose the Web Mirror to the public internet using TryCloudflare, with the link automatically sent to Telegram.
*   **💬 Responsive & Smart Chat Interface**: Optimized the Web Mirror UI with a responsive design for mobile screens (under 600px wide) and low-height screen viewports (under 520px height), ensuring layout visibility and clean spacing when virtual keyboards are open.
*   **✍️ Multiline Message Input**: Replaced the single-line input text field in the Web Mirror client with a smart `textarea` that auto-adjusts its height up to 150px and supports Shift+Enter for new lines and Enter to send.
*   **🐛 Client Web connection fix**: Restored the missing DOM element `<span id="statusText"></span>` to resolve JavaScript runtime crashes during client connection establishment, enabling the real-time screen stream to load properly.

> [!NOTE]
> For older release notes and full version history, please see the [CHANGELOG.md](CHANGELOG.md) file.

---

## 🏗 Technology Stack

- **TypeScript**: Robust logic and type safety.
- **Telegraf**: Modern Telegram Bot API framework.
- **CDP (Chrome DevTools Protocol)**: Native input emulation and DOM-aware screenshot capturing.
- **i18next-like i18n**: Multi-language translation engine.

---

### 🔗 Project Links

- **Repository**: [https://github.com/acmavirus/antigravity-telegram-control](https://github.com/acmavirus/antigravity-telegram-control)
- **Issues**: [Report a bug](https://github.com/acmavirus/antigravity-telegram-control/issues)
- **Author**: [AcmaTvirus](https://github.com/acmavirus)

---

**Built with ❤️ by AcmaTvirus.**
*Stay productive, even when you're away.*
