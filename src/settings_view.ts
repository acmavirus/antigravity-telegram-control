import * as vscode from 'vscode';

export function getSettingsHtml(token: string, chatId: string, debuggingPort: number = 9222): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Telegram Settings</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
            font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
            font-size: var(--vscode-font-size, 13px);
            color: var(--vscode-foreground);
            background: var(--vscode-sideBar-background);
            padding: 16px;
        }

        h2 {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: var(--vscode-sideBarSectionHeader-foreground);
            margin-bottom: 16px;
        }

        .field {
            margin-bottom: 12px;
        }

        label {
            display: block;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 4px;
        }

        input {
            width: 100%;
            padding: 5px 8px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border, transparent);
            border-radius: 2px;
            font-family: inherit;
            font-size: inherit;
            outline: none;
        }

        input:focus {
            border-color: var(--vscode-focusBorder);
        }

        button {
            width: 100%;
            margin-top: 8px;
            padding: 6px 12px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 2px;
            font-size: inherit;
            font-family: inherit;
            cursor: pointer;
        }

        button:hover {
            background: var(--vscode-button-hoverBackground);
        }

        button.secondary {
            background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.15));
            color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
        }

        button.secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.25));
        }

        .msg {
            margin-top: 10px;
            font-size: 11px;
            color: var(--vscode-notificationsInfoIcon-foreground);
            display: none;
        }

        .msg.show { display: block; }

        hr {
            border: none;
            border-top: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(128,128,128,0.2));
            margin: 16px 0;
        }

        .commands {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            line-height: 1.7;
        }

        .commands span {
            color: var(--vscode-foreground);
            font-weight: 600;
        }
    </style>
</head>
<body>
    <h2>Telegram Settings</h2>

    <div class="field">
        <label for="token">Bot Token</label>
        <input type="text" id="token" value="${token}" placeholder="Paste token from @BotFather...">
    </div>

    <div class="field">
        <label for="chatId">Allowed Chat ID <small>(optional)</small></label>
        <input type="text" id="chatId" value="${chatId}" placeholder="e.g. 123456789">
    </div>

    <div class="field">
        <label for="port">Debugging Port <small>(for /ask command)</small></label>
        <input type="number" id="port" value="${debuggingPort}" placeholder="9222">
    </div>

    <button id="save">Save</button>
    <button id="register" class="secondary">Register Slash Commands</button>
    <div id="msg" class="msg">✓ Settings saved.</div>

    <hr>

    <div class="commands">
        <span>/start</span> – Get your Chat ID<br>
        <span>/screenshot</span> – Capture Agent frame<br>
        <span>/ask</span> &lt;message&gt; – Send to agent chat<br>
        <span>/check</span> – Check completion manually<br>
        <span>/cmd</span> &lt;command&gt; – Run in terminal<br>
        <span>/help</span> – Show commands
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        document.getElementById('save').addEventListener('click', () => {
            vscode.postMessage({
                command: 'save',
                token: document.getElementById('token').value,
                chatId: document.getElementById('chatId').value,
                debuggingPort: parseInt(document.getElementById('port').value) || 9222
            });
            const msg = document.getElementById('msg');
            msg.classList.add('show');
            setTimeout(() => msg.classList.remove('show'), 3000);
        });

        document.getElementById('register').addEventListener('click', () => {
            vscode.postMessage({ 
                command: 'registerCommands',
                token: document.getElementById('token').value,
                chatId: document.getElementById('chatId').value
            });
        });
    </script>
</body>
</html>
`;
}
