# Antigravity Telegram Control

Control and monitor your Antigravity IDE Agent remotely via Telegram. This VS Code extension allows you to interact with your AI assistant, execute terminal commands, and receive automatic progress updates with screenshots directly to your Telegram chat.

## 🚀 Features

-   **Remote Chat (`/ask`)**: Send messages to your Antigravity Agent from anywhere using Telegram.
-   **Auto-Status Updates**: Automatically detects when the Agent finishes generating a response and notifies you immediately.
-   **Smart Screenshots**:
    -   **Automatic**: Sends a cropped screenshot of the Agent's response as soon as it's finished.
    -   **Manual (`/screenshot`)**: Capture a precise screenshot of the current Agent chat frame at any time.
-   **Manual Check (`/check`)**: If an automatic tracking times out, use this to manually verify the Agent's state and get a fresh screenshot.
-   **Terminal Control (`/cmd`)**: Execute shell commands in your VS Code terminal remotely.
-   **Secure Access**: Only allows authorized Telegram Chat IDs to control the system.

## 🛠 Prerequisites

To use the advanced CDP-based features (like smart cropping and auto-detection), you **must** launch VS Code with the remote debugging port enabled:

```bash
code --remote-debugging-port=9222
```

> [!IMPORTANT]
> Ensure the port matches the one configured in the extension settings (default is `9222`).

## 📥 Installation

1.  Download the `.vsix` file from the latest release.
2.  In VS Code, go to the Extensions view (`Ctrl+Shift+X`).
3.  Click the `...` (Views and More Actions) menu and select **Install from VSIX...**.
4.  Select the downloaded `.vsix` file.

## ⚙️ Configuration

1.  Open the **Telegram Control** sidebar icon in VS Code.
2.  Enter your **Telegram Bot Token** (get it from [@BotFather](https://t.me/botfather)).
3.  Enter your **Allowed Chat ID** (use `/start` on your new bot to get your ID).
4.  Click **Save Settings**. The bot will restart automatically.
5.  Click **Register Slash Commands** to sync the available commands with Telegram.

## 🤖 Telegram Commands

| Command | Description |
| :--- | :--- |
| `/start` | Welcome message and retrieve your Telegram Chat ID. |
| `/ask <query>` | Send a message to the Antigravity Agent in VS Code. |
| `/check` | Manually check if the Agent has finished and get a screenshot. |
| `/screenshot` | Capture a cropped screenshot of the current Agent chat frame. |
| `/cmd <command>` | Execute a shell command in the active VS Code terminal. |
| `/help` | Display the list of available commands. |

## 🏗 Technology Stack

-   **TypeScript**: Core extension logic.
-   **Telegraf**: Telegram Bot API framework.
-   **CDP (Chrome DevTools Protocol)**: High-level interaction with VS Code Webviews for UI automation and precise element-based screenshots.

---

Designed for the **Antigravity** ecosystem. Stay productive even when you are away from your desk!
