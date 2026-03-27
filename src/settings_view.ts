import * as vscode from 'vscode';

export function getSettingsHtml(
    token: string,
    chatId: string,
    debuggingPort: number = 9222,
    language: string = 'en',
    agentsMs: string = '',
    geminiMd: string = '',
    agentsMsPath: string = '',
    geminiMdPath: string = ''
): string {
    const languages = [
        { code: 'en', name: 'English' },
        { code: 'vi', name: 'Tiếng Việt' },
        { code: 'zh', name: '中文' },
        { code: 'es', name: 'Español' },
        { code: 'fr', name: 'Français' },
        { code: 'de', name: 'Deutsch' },
        { code: 'ja', name: '日本語' },
        { code: 'ko', name: '한국어' },
        { code: 'ru', name: 'Русский' },
        { code: 'pt', name: 'Português' },
        { code: 'it', name: 'Italiano' },
        { code: 'hi', name: 'हिन्दी' },
        { code: 'tr', name: 'Türkçe' },
        { code: 'ar', name: 'العربية' },
        { code: 'id', name: 'Bahasa Indonesia' }
    ];

    const langOptions = languages.map(l =>
        `<option value="${l.code}" ${l.code === language ? 'selected' : ''}>${l.name}</option>`
    ).join('');

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Telegram Control</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
            font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
            font-size: var(--vscode-font-size, 13px);
            color: var(--vscode-foreground);
            background: var(--vscode-sideBar-background);
            padding: 0;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            height: 100vh;
        }

        .tabs {
            display: flex;
            border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(128,128,128,0.2));
            background: var(--vscode-sideBar-background);
            user-select: none;
        }

        .tab {
            padding: 8px 12px;
            cursor: pointer;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--vscode-descriptionForeground);
            border-bottom: 1px solid transparent;
            margin-bottom: -1px;
        }

        .tab.active {
            color: var(--vscode-foreground);
            border-bottom: 1px solid var(--vscode-panelTitle-activeBorder);
        }

        .tab:hover {
            color: var(--vscode-foreground);
        }

        .content-container {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
        }

        .tab-content {
            display: none;
        }

        .tab-content.active {
            display: block;
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

        input, select, textarea {
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

        textarea {
            resize: vertical;
            min-height: 120px;
            font-family: var(--vscode-editor-font-family, 'Courier New', monospace);
            font-size: 12px;
            line-height: 1.4;
        }

        input:focus, select:focus, textarea:focus {
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
            margin: 20px 0;
        }

        .commands {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            line-height: 1.7;
            padding-bottom: 20px;
        }

        .commands span {
            color: var(--vscode-foreground);
            font-weight: 600;
        }

        .editor-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 6px;
        }

        .editor-title {
            font-size: 11px;
            font-weight: 600;
            color: var(--vscode-foreground);
        }
    </style>
</head>
<body>
    <div class="tabs">
        <div class="tab active" data-target="settings-tab">Settings</div>
        <div class="tab" data-target="agents-tab">Agents</div>
    </div>

    <div class="content-container">
        <!-- Settings Tab -->
        <div id="settings-tab" class="tab-content active">
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

            <div class="field">
                <label for="language">Language</label>
                <select id="language">
                    ${langOptions}
                </select>
            </div>

            <button id="save-settings">Save Settings</button>
            <button id="register" class="secondary">Register Slash Commands</button>
            <div id="settings-msg" class="msg">✓ Settings saved.</div>

            <hr>

            <div class="commands">
                <span>/start</span> – Get your Chat ID<br>
                <span>/screenshot</span> – Capture Agent frame<br>
                <span>/ask</span> &lt;message&gt; – Send to agent chat<br>
                <span>/stop</span> – Stop agent generation<br>
                <span>/alarm</span> – Alarm when finished<br>
                <span>/check</span> – Check completion manually<br>
                <span>/cmd</span> &lt;command&gt; – Run in terminal<br>
                <span>/help</span> – Show commands
            </div>
        </div>

        <!-- Agents Tab -->
        <div id="agents-tab" class="tab-content">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <h2 style="margin: 0;">Agent Configuration</h2>
                <button id="autofind" class="secondary" style="width: auto; margin: 0; padding: 4px 8px; font-size: 10px;">Auto-find Paths</button>
            </div>
            
            <div class="field">
                <label for="agents-ms-path">agents.md path</label>
                <input type="text" id="agents-ms-path" value="${agentsMsPath}" placeholder="e.g. C:\\Users\\...\\agents.md">
            </div>

            <div class="field">
                <div class="editor-header">
                    <span class="editor-title">agents.md Content</span>
                </div>
                <textarea id="agents-ms" spellcheck="false" placeholder="Enter agents.md content...">${agentsMs}</textarea>
            </div>

            <hr style="margin: 12px 0;">

            <div class="field">
                <label for="gemini-md-path">gemini.md path</label>
                <input type="text" id="gemini-md-path" value="${geminiMdPath}" placeholder="e.g. C:\\Users\\...\\gemini.md">
            </div>

            <div class="field">
                <div class="editor-header">
                    <span class="editor-title">gemini.md Content</span>
                </div>
                <textarea id="gemini-md" spellcheck="false" placeholder="Enter gemini.md content...">${geminiMd}</textarea>
            </div>

            <button id="save-agents">Save Agents</button>
            <div id="agents-msg" class="msg">✓ Agent files and paths saved.</div>
            
            <div style="margin-top: 12px; font-size: 11px; color: var(--vscode-descriptionForeground);">
                If path is empty, it defaults to workspace root.
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        // Listen for extension messages
        window.addEventListener('message', event => {
            const msg = event.data;
            if (msg.command === 'foundPaths') {
                if (msg.agentsMsPath) document.getElementById('agents-ms-path').value = msg.agentsMsPath;
                if (msg.geminiMdPath) document.getElementById('gemini-md-path').value = msg.geminiMdPath;
                if (msg.agentsMs) document.getElementById('agents-ms').value = msg.agentsMs;
                if (msg.geminiMd) document.getElementById('gemini-md').value = msg.geminiMd;
            }
        });

        // Tab Switching
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const target = tab.getAttribute('data-target');
                
                // Update tabs
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                
                // Update content
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                document.getElementById(target).classList.add('active');
            });
        });

        // Save Settings
        document.getElementById('save-settings').addEventListener('click', () => {
            vscode.postMessage({
                command: 'save',
                token: document.getElementById('token').value,
                chatId: document.getElementById('chatId').value,
                debuggingPort: parseInt(document.getElementById('port').value) || 9222,
                language: document.getElementById('language').value
            });
            const msg = document.getElementById('settings-msg');
            msg.classList.add('show');
            setTimeout(() => msg.classList.remove('show'), 3000);
        });

        // Save Agents
        document.getElementById('save-agents').addEventListener('click', () => {
            vscode.postMessage({
                command: 'saveAgents',
                agentsMs: document.getElementById('agents-ms').value,
                geminiMd: document.getElementById('gemini-md').value,
                agentsMsPath: document.getElementById('agents-ms-path').value,
                geminiMdPath: document.getElementById('gemini-md-path').value
            });
            const msg = document.getElementById('agents-msg');
            msg.classList.add('show');
            setTimeout(() => msg.classList.remove('show'), 3000);
        });

        document.getElementById('autofind').addEventListener('click', () => {
            vscode.postMessage({ command: 'autofind' });
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

