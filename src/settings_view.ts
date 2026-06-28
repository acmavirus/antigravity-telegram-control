import * as vscode from 'vscode';
import { translations } from './i18n';

export function getSettingsHtml(
    token: string,
    chatId: string,
    debuggingPort: number = 9222,
    language: string = 'en',
    agentsMs: string = '',
    geminiMd: string = '',
    agentsMsPath: string = '',
    geminiMdPath: string = '',
    autoRetry: boolean = false,
    autoAccept: boolean = false,
    autoAcceptInterval: number = 800,
    enableMirror: boolean = false,
    mirrorPort: number = 9999,
    mirrorToken: string = "",
    enableTunnel: boolean = false,
    tunnelType: string = 'localhost.run',
    ngrokAuthToken: string = '',
    clickPatterns: string[] = ["Allow", "Always Allow", "Run", "Keep Waiting", "Accept all", "Accept"],
    totalClicks: number = 0,
    clickStats: Record<string, number> = {},
    clickLog: Array<{ time: string, button: string, pattern: string }> = [],
    isInjected: boolean = false
): string {
    const t = translations[language] || translations['en'];
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

        .field.checkbox-field {
            display: flex;
            align-items: center;
            gap: 8px;
            cursor: pointer;
            user-select: none;
        }

        .field.checkbox-field input {
            width: auto;
            margin: 0;
            cursor: pointer;
        }

        .field.checkbox-field label {
            margin: 0;
            cursor: pointer;
            color: var(--vscode-foreground);
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

        /* Active Patterns Tag Design */
        .patterns-list {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin: 8px 0;
            padding: 6px;
            background: var(--vscode-sideBar-background);
            border: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(128,128,128,0.2));
            border-radius: 3px;
            min-height: 38px;
        }

        .pattern-tag {
            display: inline-flex;
            align-items: center;
            background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.15));
            color: var(--vscode-foreground);
            border-radius: 3px;
            padding: 2px 6px;
            font-size: 11px;
            gap: 4px;
            border: 1px solid var(--vscode-sideBarSectionHeader-border, transparent);
        }

        .pattern-tag .remove-btn {
            cursor: pointer;
            color: var(--vscode-errorForeground, #ff5555);
            font-weight: bold;
            font-size: 12px;
            padding: 0 2px;
        }

        .pattern-tag .remove-btn:hover {
            color: var(--vscode-testing-iconFailedColor, #ff3333);
        }

        .pattern-add-row {
            display: flex;
            gap: 6px;
        }

        /* Statistics Styling */
        .stats-summary-card {
            background: var(--vscode-welcomePage-tileBackground, rgba(128,128,128,0.08));
            border: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(128,128,128,0.2));
            padding: 12px;
            border-radius: 4px;
            margin-bottom: 16px;
            text-align: center;
        }

        .stats-summary-val {
            font-size: 24px;
            font-weight: bold;
            color: var(--vscode-textLink-activeForeground, #3794ff);
            margin-top: 4px;
        }

        .stats-chart {
            display: flex;
            flex-direction: column;
            gap: 10px;
            margin-bottom: 20px;
        }

        .stats-row {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .stats-label {
            width: 90px;
            font-size: 11px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: var(--vscode-foreground);
        }

        .stats-bar-container {
            flex: 1;
            height: 12px;
            background: var(--vscode-sideBar-background);
            border: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(128,128,128,0.2));
            border-radius: 6px;
            overflow: hidden;
        }

        .stats-bar {
            height: 100%;
            background: linear-gradient(90deg, var(--vscode-button-background, #007acc), var(--vscode-textLink-activeForeground, #3794ff));
            border-radius: 6px;
            width: 0%;
            transition: width 0.5s ease-out;
        }

        .stats-count {
            width: 30px;
            font-size: 11px;
            font-weight: bold;
            text-align: right;
            color: var(--vscode-descriptionForeground);
        }

        /* Log card */
        .log-card {
            border: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(128,128,128,0.2));
            border-radius: 4px;
            padding: 8px;
            background: var(--vscode-sideBar-background);
        }

        .log-title-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }

        .log-container {
            max-height: 150px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 4px;
            padding-right: 4px;
        }

        .log-entry {
            display: flex;
            justify-content: space-between;
            font-size: 10px;
            padding: 3px 6px;
            background: var(--vscode-welcomePage-tileBackground, rgba(128,128,128,0.04));
            border-radius: 2px;
            border-left: 2px solid var(--vscode-textLink-activeForeground, #3794ff);
        }

        .log-time {
            color: var(--vscode-descriptionForeground);
            margin-right: 4px;
        }

        .log-text {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .log-pattern {
            color: var(--vscode-textLink-activeForeground, #3794ff);
            font-weight: bold;
        }
    </style>
</head>
<body>
    <div class="tabs">
        <div class="tab active" data-target="settings-tab">Settings</div>
        <div class="tab" data-target="agents-tab">Agents</div>
        <div class="tab" data-target="auto-tab">Auto</div>
        <div class="tab" data-target="mirror-tab">Mirror</div>
        <div class="tab" data-target="stats-tab">Stats</div>
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
            <button id="delete-commands" class="secondary">Delete Slash Commands</button>
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

        <!-- Auto Tab -->
        <div id="auto-tab" class="tab-content">
            <h2>Automation Settings</h2>
            
            <div class="field checkbox-field">
                <input type="checkbox" id="auto-retry" ${autoRetry ? 'checked' : ''}>
                <label for="auto-retry">${t.autoRetryLabel || 'Auto Retry'}</label>
            </div>

            <div class="field checkbox-field" style="margin-top: 16px;">
                <input type="checkbox" id="auto-accept" ${autoAccept ? 'checked' : ''}>
                <label for="auto-accept">${t.autoAcceptLabel || 'Auto Accept'}</label>
            </div>

            <div class="field" style="margin-top: 12px;">
                <label for="auto-accept-interval">${t.autoAcceptIntervalLabel || 'Auto Accept Interval (ms)'}</label>
                <input type="number" id="auto-accept-interval" value="${autoAcceptInterval}" placeholder="800" min="200">
            </div>



            <div class="field" style="margin-top: 12px;">
                <label>${t.clickPatternsLabel || 'Click Button Patterns'}</label>
                <div id="patterns-list" class="patterns-list"></div>
                <div class="pattern-add-row">
                    <input type="text" id="new-pattern" placeholder="Type pattern name...">
                    <button id="add-pattern" style="width: auto; margin: 0; padding: 4px 12px;">Add</button>
                </div>
            </div>

            <div class="field" style="margin-top: 16px;">
                <label style="font-weight: 600;">Workbench Injection Status (No remote port required)</label>
                <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 8px; padding: 8px; background: var(--vscode-sideBar-background); border: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(128,128,128,0.15)); border-radius: 4px;">
                    <div>
                        <span id="injection-status-dot" style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: ${isInjected ? '#4EC9B0' : '#858585'}; margin-right: 6px;"></span>
                        <span id="injection-status-text" style="font-size: 11px; color: ${isInjected ? 'var(--vscode-testing-iconPassedColor, #4EC9B0)' : 'var(--vscode-descriptionForeground)'}">${isInjected ? 'Injected (Active)' : 'Not Injected'}</span>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button id="btn-inject" class="secondary" style="width: auto; margin: 0; padding: 4px 8px; font-size: 11px;">Inject</button>
                        <button id="btn-uninstall" class="secondary" style="width: auto; margin: 0; padding: 4px 8px; font-size: 11px;">Remove</button>
                    </div>
                </div>
                <div style="margin-top: 6px; font-size: 11px; color: var(--vscode-descriptionForeground); line-height: 1.4;">
                    Tiện ích bổ sung giúp tự động click/scroll trong IDE mà không cần bật cổng debug 9222. Sẽ yêu cầu tải lại cửa sổ (reload window) khi cài đặt hoặc gỡ bỏ.
                </div>
            </div>

            <button id="save-auto" style="margin-top: 16px;">${t.saveAutoBtn || 'Save Automation Settings'}</button>
            <div id="auto-msg" class="msg">✓ Automation settings saved.</div>
        </div>

        <!-- Mirror Tab -->
        <div id="mirror-tab" class="tab-content">
            <h2>Web Mirror Settings</h2>
            
            <div class="field checkbox-field">
                <input type="checkbox" id="enable-mirror" ${enableMirror ? 'checked' : ''}>
                <label for="enable-mirror">${t.enableMirrorLabel || 'Enable Web Mirror'}</label>
            </div>

            <div class="field" style="margin-top: 12px;">
                <label for="mirror-port">${t.mirrorPortLabel || 'Mirror Port'}</label>
                <input type="number" id="mirror-port" value="${mirrorPort}" placeholder="9999" min="1024" max="65535">
            </div>

            <div class="field" style="margin-top: 12px;">
                <label for="mirror-token">${t.securityTokenLabel || 'Security Token'}</label>
                <input type="text" id="mirror-token" value="${mirrorToken}" placeholder="e.g. secret_token_123">
            </div>

            <hr style="margin: 16px 0; border-top: 1px dashed var(--vscode-sideBarSectionHeader-border, rgba(128,128,128,0.2));">
            
            <div class="field checkbox-field">
                <input type="checkbox" id="enable-tunnel" ${enableTunnel ? 'checked' : ''}>
                <label for="enable-tunnel">${t.enableTunnelLabel || 'Enable Tunnel'}</label>
            </div>

            <div class="field" id="tunnel-type-field" style="margin-top: 12px; display: ${enableTunnel ? 'block' : 'none'};">
                <label for="tunnel-type">${t.tunnelTypeLabel || 'Tunnel Type'}</label>
                <select id="tunnel-type">
                    <option value="localhost.run" ${tunnelType === 'localhost.run' ? 'selected' : ''}>localhost.run (Free, No Auth)</option>
                    <option value="cloudflare" ${tunnelType === 'cloudflare' ? 'selected' : ''}>Cloudflare Tunnel (Free, Fast)</option>
                    <option value="ngrok" ${tunnelType === 'ngrok' ? 'selected' : ''}>ngrok (Stable)</option>
                </select>
            </div>

            <div class="field" id="ngrok-token-field" style="margin-top: 12px; display: ${enableTunnel && tunnelType === 'ngrok' ? 'block' : 'none'};">
                <label for="ngrok-token">${t.ngrokTokenLabel || 'Ngrok Authtoken'}</label>
                <input type="text" id="ngrok-token" value="${ngrokAuthToken}" placeholder="Paste ngrok authtoken here...">
            </div>

            <button id="save-mirror">${t.saveMirrorBtn || 'Save Mirror Settings'}</button>
            <div id="mirror-msg" class="msg">✓ Mirror settings saved.</div>

            <div style="margin-top: 16px; font-size: 11px; color: var(--vscode-descriptionForeground); line-height: 1.5;">
                ${(t.mirrorDescription || 'When enabled, you can access the web interface at: http://localhost:{port}{tokenUrl}').replace('{port}', mirrorPort.toString()).replace('{tokenUrl}', mirrorToken ? '/?token=' + mirrorToken : '')}
            </div>
        </div>

        <!-- Stats Tab -->
        <div id="stats-tab" class="tab-content">
            <h2>Click Statistics</h2>
            
            <div class="stats-summary-card">
                <div>Total Auto Accepted Clicks</div>
                <div id="total-clicks-display" class="stats-summary-val">${totalClicks}</div>
            </div>

            <div id="stats-chart-container" class="stats-chart">
                <!-- Chart rows injected by script -->
            </div>

            <button id="reset-stats" style="color: var(--vscode-errorForeground, #ff5555); margin-bottom: 16px;">
                Reset Statistics
            </button>

            <div class="log-card">
                <div class="log-title-row">
                    <span class="editor-title">Recent Clicks Log</span>
                    <button id="clear-click-log" class="secondary" style="width: auto; margin: 0; padding: 2px 8px; font-size: 10px;">Clear</button>
                </div>
                <div id="log-list" class="log-container">
                    <!-- Log entries injected by script -->
                </div>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        let clickPatterns = ${JSON.stringify(clickPatterns)};

        // Render Patterns Badges
        function renderPatterns() {
            const list = document.getElementById('patterns-list');
            list.innerHTML = '';
            clickPatterns.forEach((pat, idx) => {
                const tag = document.createElement('span');
                tag.className = 'pattern-tag';
                tag.innerHTML = \`\${escapeHtml(pat)} <span class="remove-btn" onclick="removePattern(\${idx})">&times;</span>\`;
                list.appendChild(tag);
            });
        }

        function removePattern(idx) {
            clickPatterns.splice(idx, 1);
            renderPatterns();
        }

        window.removePattern = removePattern;

        function escapeHtml(str) {
            return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
        }

        document.getElementById('add-pattern').addEventListener('click', () => {
            const input = document.getElementById('new-pattern');
            const val = input.value.trim();
            if (val && !clickPatterns.includes(val)) {
                clickPatterns.push(val);
                renderPatterns();
                input.value = '';
            }
        });

        document.getElementById('new-pattern').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                document.getElementById('add-pattern').click();
            }
        });

        // Initialize patterns view
        renderPatterns();

        // Stats Visual Charts
        function updateStatsUI(stats, total) {
            document.getElementById('total-clicks-display').textContent = total;
            const container = document.getElementById('stats-chart-container');
            container.innerHTML = '';

            const keys = Object.keys(stats);
            if (keys.length === 0) {
                container.innerHTML = '<div style="font-size:11px;color:var(--vscode-descriptionForeground);text-align:center;padding:12px;">No click stats recorded yet.</div>';
                return;
            }

            keys.sort((a,b) => stats[b] - stats[a]);

            const maxVal = Math.max(...Object.values(stats), 1);

            keys.forEach(key => {
                const count = stats[key];
                const pct = Math.round((count / maxVal) * 100);

                const row = document.createElement('div');
                row.className = 'stats-row';
                row.innerHTML = \`
                    <div class="stats-label" title="\${escapeHtml(key)}">\${escapeHtml(key)}</div>
                    <div class="stats-bar-container">
                        <div class="stats-bar" style="width: \${pct}%"></div>
                    </div>
                    <div class="stats-count">\${count}</div>
                \`;
                container.appendChild(row);
            });
        }

        function updateClickLogUI(log) {
            const container = document.getElementById('log-list');
            container.innerHTML = '';
            if (log.length === 0) {
                container.innerHTML = '<div style="font-size:10px;color:var(--vscode-descriptionForeground);text-align:center;padding:8px;">No click logs yet.</div>';
                return;
            }

            log.forEach(entry => {
                const row = document.createElement('div');
                row.className = 'log-entry';
                row.innerHTML = \`
                    <span class="log-time">[\${escapeHtml(entry.time)}]</span>
                    <span class="log-text" title="\&quot;\${escapeHtml(entry.button)}\&quot;">Clicked: "\${escapeHtml(entry.button)}"</span>
                    <span class="log-pattern">\${escapeHtml(entry.pattern)}</span>
                \`;
                container.appendChild(row);
            });
        }

        // Listen for extension messages
        window.addEventListener('message', event => {
            const msg = event.data;
            if (msg.command === 'foundPaths') {
                if (msg.agentsMsPath) document.getElementById('agents-ms-path').value = msg.agentsMsPath;
                if (msg.geminiMdPath) document.getElementById('gemini-md-path').value = msg.geminiMdPath;
                if (msg.agentsMs) document.getElementById('agents-ms').value = msg.agentsMs;
                if (msg.geminiMd) document.getElementById('gemini-md').value = msg.geminiMd;
            }
            if (msg.command === 'statsUpdated') {
                updateStatsUI(msg.clickStats, msg.totalClicks);
            }
            if (msg.command === 'clickLogUpdate') {
                updateClickLogUI(msg.log);
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

                // Trigger direct fetch of stats/logs if switching to stats tab
                if (target === 'stats-tab') {
                    vscode.postMessage({ command: 'getStats' });
                    vscode.postMessage({ command: 'getClickLog' });
                }
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

        // Save Auto Settings
        document.getElementById('save-auto').addEventListener('click', () => {
            vscode.postMessage({
                command: 'saveAuto',
                autoRetry: document.getElementById('auto-retry').checked,
                autoAccept: document.getElementById('auto-accept').checked,
                autoAcceptInterval: parseInt(document.getElementById('auto-accept-interval').value) || 800,
                clickPatterns: clickPatterns
            });
            const msg = document.getElementById('auto-msg');
            msg.classList.add('show');
            setTimeout(() => msg.classList.remove('show'), 3000);
        });

        // Save Mirror Settings
        document.getElementById('save-mirror').addEventListener('click', () => {
            const port = parseInt(document.getElementById('mirror-port').value) || 9999;
            const token = document.getElementById('mirror-token').value;
            vscode.postMessage({
                command: 'saveMirror',
                enableMirror: document.getElementById('enable-mirror').checked,
                mirrorPort: port,
                mirrorToken: token,
                enableTunnel: document.getElementById('enable-tunnel').checked,
                tunnelType: document.getElementById('tunnel-type').value,
                ngrokAuthToken: document.getElementById('ngrok-token').value
            });
            const msg = document.getElementById('mirror-msg');
            msg.classList.add('show');
            setTimeout(() => msg.classList.remove('show'), 3000);

            const portDisplay = document.getElementById('mirror-port-display');
            if (portDisplay) portDisplay.textContent = port;
        });

        // Stats Interactions
        document.getElementById('reset-stats').addEventListener('click', () => {
            vscode.postMessage({ command: 'resetStats' });
        });

        document.getElementById('clear-click-log').addEventListener('click', () => {
            vscode.postMessage({ command: 'clearClickLog' });
        });

        // Periodic update of stats
        setInterval(() => {
            const statsTabActive = document.querySelector('.tab[data-target="stats-tab"]').classList.contains('active');
            if (statsTabActive) {
                vscode.postMessage({ command: 'getStats' });
                vscode.postMessage({ command: 'getClickLog' });
            }
        }, 2000);

        // Tunnel fields UI visibility toggle
        const enableTunnelCheck = document.getElementById('enable-tunnel');
        const tunnelTypeSelect = document.getElementById('tunnel-type');
        const tunnelTypeField = document.getElementById('tunnel-type-field');
        const ngrokTokenField = document.getElementById('ngrok-token-field');

        enableTunnelCheck.addEventListener('change', () => {
            tunnelTypeField.style.display = enableTunnelCheck.checked ? 'block' : 'none';
            ngrokTokenField.style.display = (enableTunnelCheck.checked && tunnelTypeSelect.value === 'ngrok') ? 'block' : 'none';
        });

        tunnelTypeSelect.addEventListener('change', () => {
            ngrokTokenField.style.display = (enableTunnelCheck.checked && tunnelTypeSelect.value === 'ngrok') ? 'block' : 'none';
        });

        document.getElementById('btn-inject').addEventListener('click', () => {
            vscode.postMessage({ command: 'injectScript' });
        });

        document.getElementById('btn-uninstall').addEventListener('click', () => {
            vscode.postMessage({ command: 'uninstallScript' });
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

        document.getElementById('delete-commands').addEventListener('click', () => {
            vscode.postMessage({ 
                command: 'deleteCommands',
                token: document.getElementById('token').value,
                chatId: document.getElementById('chatId').value
            });
        });

        // Initial trigger to load stats
        vscode.postMessage({ command: 'getStats' });
        vscode.postMessage({ command: 'getClickLog' });
        
        // Render initial chart stats
        updateStatsUI(${JSON.stringify(clickStats)}, ${totalClicks});
        updateClickLogUI(${JSON.stringify(clickLog)});
    </script>
</body>
</html>
`;
}
