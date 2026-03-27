# 🌌 Antigravity Telegram Control

[![GitHub Release](https://img.shields.io/github/v/release/acmavirus/antigravity-telegram-control?style=flat-square)](https://github.com/acmavirus/antigravity-telegram-control)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://github.com/acmavirus/antigravity-telegram-control/blob/main/LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/acmavirus/antigravity-telegram-control?style=flat-square)](https://github.com/acmavirus/antigravity-telegram-control/stargazers)

> **Remote-control and monitor your Antigravity IDE Agent through Telegram.** Interact with your AI, run terminal commands, and receive real-time visual updates from anywhere.

---

## 🚀 Key Features

*   **🤖 Remote Interaction (`/ask`)**: Prompt your Antigravity Agent directly from Telegram.
*   **📸 Intelligence Monitoring**: 
    *   **Auto-Finish Detection**: Automatically notifies you and sends a screenshot when the Agent completes its response.
    *   **Frame Capture (`/screenshot`)**: Get a high-definition, cropped screenshot of the current Agent session.
    *   **Alarm Notification (`/alarm`)**: NEW! Let the bot watch the Agent and notify you exactly when it's done.
*   **🛑 Execution Control (`/stop`)**: Instantly stop the Agent if it's over-generating or stuck.
*   **🐚 Terminal Power (`/cmd`)**: Execute shell commands in your VS Code terminal remotely.
*   **🔍 Manual Verification (`/check`)**: Force check the Agent's status and get a fresh visual update.
*   **🌍 Multi-language Support**: Fully localized in 15+ languages including Vietnamese, English, Chinese, Japanese, and more.
*   **🔒 Secure Proxy**: Access is restricted to your specific authorized Telegram Chat ID.

---

## 🛠 Prerequisites

To enable high-level UI interaction (smart cropping, auto-detection), launch VS Code with the remote debugging port:

```powershell
# Launch VS Code with CDP enabled
code --remote-debugging-port=9222
```

> [!IMPORTANT]
> The debugging port must be open for the extension to "see" and "interact" with the Antigravity Agent's webview. Default is `9222`.

---

## 📥 Installation & Setup

1.  **Install VSIX**: Download the latest `.vsix` and install it via the Extensions view in VS Code.
2.  **Configuration**:
    *   Open the **Telegram Control** sidebar.
    *   Input your **Bot Token** (via [@BotFather](https://t.me/botfather)).
    *   Input your **Allowed Chat ID** (Type `/start` on your bot to see your ID).
    *   Select your preferred **Language**.
3.  **Activation**: Click **Save Settings** and **Register Slash Commands**.

---

## 🤖 Telegram Slash Commands

| Command | Description |
| :--- | :--- |
| `/start` | Show welcome message and your Telegram Chat ID. |
| `/ask <text>` | Send a query to the Antigravity Agent. |
| `/stop` | Abort the current Agent generation. |
| `/alarm` | **(New)** Monitor and notify when Agent finishes. |
| `/screenshot` | Capture a precise, cropped frame of the Agent chat area. |
| `/check` | Verify completion status and get a visual update. |
| `/cmd <cmd>` | Run a command in the active VS Code terminal. |
| `/help` | List available commands. |

---

## 🆕 What's New in v0.0.6

*   **🗂️ Tabbed UI Interface**: Organized settings into intuitive tabs: "Settings" for Telegram bot configuration and "Agents" for file management.
*   **📝 Integrated Agent Editors**: Edit your `agents.md` and `gemini.md` files directly within the VS Code sidebar without switching contexts.
*   **📍 Custom Path Support**: Full support for absolute file paths, allowing you to manage agent files anywhere on your system (e.g., in `.gemini` home folder).
*   **🔍 Auto-find Intelligence**: New "Auto-find" button that automatically scans your home directory for established `.gemini` configurations and pre-fills them.
*   **🛠️ Workflow Optimization**: Improved save logic that synchronizes changes between the editor and the filesystem seamlessly.

---

## 🆕 What's New in v0.0.5

*   **⚡ Improved Smart Detection**: Enhanced detection of Agent chat elements using Shadow DOM traversal, ensuring the bot always "sees" the UI regardless of how depth it's nested.
*   **📜 Auto-Scroll Logic**: Added intelligence to automatically scroll the chat container to the bottom after detection or before taking a screenshot.
*   **🎯 Targeted Capture**: Prioritizes the correct VS Code webviews using title-based matching and intelligent element scoring.
*   **🛡️ Robust Error Handling**: More descriptive feedback when the remote debugging port (`9222`) is unavailable or when the chat UI cannot be located.
*   **📦 Build Optimization**: Refined the compiler and packaging workflow for a more stable and compact extension file.

---

## 🏗 Technology Stack

- **TypeScript**: Robust logic and type safety.
- **Telegraf**: Modern Telegram Bot API framework.
- **CDP (Chrome DevTools Protocol)**: Native input emulation and DOM-aware screenshot capturing.
- **i18next-like i18n**: Support for global users.

---

### 🔗 Project Links

- **Repository**: [https://github.com/acmavirus/antigravity-telegram-control](https://github.com/acmavirus/antigravity-telegram-control)
- **Issues**: [Report a bug](https://github.com/acmavirus/antigravity-telegram-control/issues)
- **Author**: [AcmaTvirus](https://github.com/acmavirus)

---

**Built with ❤️ AcmaTvirus.**
*Stay productive, even when you're away.*
