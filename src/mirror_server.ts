import * as vscode from 'vscode';
import * as http from 'http';
import * as url from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { sendViaCDP, stopAgent, clickRetryButton } from './cdp_chat';
import { TunnelManager } from './tunnel_manager';
import { t } from './i18n';

interface CdpTarget {
    id: string;
    type: string;
    title: string;
    url: string;
    webSocketDebuggerUrl?: string;
}

export class MirrorServerManager implements vscode.Disposable {
    private server: http.Server | undefined;
    private wss: WebSocketServer | undefined;
    
    private cdpWs: WebSocket | undefined;
    private cdpMsgId = 1;
    private cdpScanTimer: NodeJS.Timeout | undefined;
    private lastCropRect: { x: number; y: number; width: number; height: number } | null = null;
    private cropTimer: NodeJS.Timeout | undefined;
    private readonly cropRectMsgId = 999999;

    private isRunning = false;
    private webClients = new Set<WebSocket>();

    // Config cache
    private enabled = false;
    private port = 9999;
    private token = '';
    private debuggingPort = 9222;
    
    private enableTunnel = false;
    private tunnelType = 'localhost.run';
    private ngrokAuthToken = '';
    private publicTunnelUrl: string | undefined;

    constructor() {
        this.loadSettings();
    }

    private loadSettings() {
        const config = vscode.workspace.getConfiguration('antigravityTelegramControl');
        this.enabled = config.get<boolean>('enableMirror') ?? false;
        this.port = config.get<number>('mirrorPort') ?? 9999;
        this.token = config.get<string>('mirrorToken') ?? '';
        this.debuggingPort = config.get<number>('debuggingPort') ?? 9222;
        this.enableTunnel = config.get<boolean>('enableTunnel') ?? false;
        this.tunnelType = config.get<string>('tunnelType') ?? 'localhost.run';
        this.ngrokAuthToken = config.get<string>('ngrokAuthToken') ?? '';
    }

    /**
     * Start the server if enabled
     */
    public start(): void {
        this.loadSettings();
        if (this.isRunning) {
            this.stop();
        }

        if (!this.enabled) {
            return;
        }

        try {
            this.server = http.createServer((req, res) => {
                const parsedUrl = url.parse(req.url || '', true);
                
                // Serve the HTML remote client page on /
                if (parsedUrl.pathname === '/') {
                    const reqToken = parsedUrl.query.token as string || '';
                    if (this.token && reqToken !== this.token) {
                        res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end('<h1>403 Forbidden</h1><p>Mã bảo mật (Token) không đúng hoặc thiếu.</p>');
                        return;
                    }

                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(this.getClientHtml());
                    return;
                }

                res.writeHead(404);
                res.end();
            });

            // Set up WebSocket server attached to the HTTP server
            this.wss = new WebSocketServer({ noServer: true });

            this.server.on('upgrade', (request, socket, head) => {
                const parsedUrl = url.parse(request.url || '', true);
                const reqToken = parsedUrl.query.token as string || '';
                
                if (this.token && reqToken !== this.token) {
                    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                    socket.destroy();
                    return;
                }

                this.wss?.handleUpgrade(request, socket, head, (ws) => {
                    this.wss?.emit('connection', ws, request);
                });
            });

            this.wss.on('connection', (ws) => {
                this.webClients.add(ws);
                console.log(`[MirrorServer] Web client connected. Total clients: ${this.webClients.size}`);

                ws.on('message', async (data) => {
                    try {
                        const msg = JSON.parse(data.toString());
                        await this.handleClientMessage(ws, msg);
                    } catch (e) {
                        console.error('[MirrorServer] Error parsing client message:', e);
                    }
                });

                ws.on('close', () => {
                    this.webClients.delete(ws);
                    console.log(`[MirrorServer] Web client disconnected. Remaining clients: ${this.webClients.size}`);
                    if (this.webClients.size === 0) {
                        this.disconnectCdp();
                    }
                });

                // Trigger active target scan immediately to start streaming
                this.triggerCdpConnection();
            });

            this.server.listen(this.port, '0.0.0.0', () => {
                console.log(`[MirrorServer] Started HTTP & WS Mirror server on port ${this.port}`);
                if (this.enableTunnel) {
                    TunnelManager.startTunnel(this.port, this.tunnelType, this.ngrokAuthToken)
                        .then((url) => {
                            this.publicTunnelUrl = url;
                            const formattedUrl = this.token ? `${url}/?token=${this.token}` : url;
                            console.log(`[MirrorServer] Public tunnel URL: ${formattedUrl}`);
                            vscode.window.showInformationMessage(t('tunnelActiveInfo', { url: formattedUrl }));
                            // Send notification to Telegram
                            import('./extension').then((ext) => {
                                ext.sendBotMessage(t('tunnelActiveBot', { url: formattedUrl }));
                            }).catch(() => {});
                        })
                        .catch((err) => {
                            console.error(`[MirrorServer] Failed to establish tunnel: ${err.message}`);
                            vscode.window.showErrorMessage(t('tunnelStartError', { error: err.message }));
                        });
                }
            });

            this.isRunning = true;
            
            // Start background target scanning loop
            this.startCdpScanner();

        } catch (e: any) {
            console.error('[MirrorServer] Failed to start server:', e.message);
            vscode.window.showErrorMessage(t('mirrorStartError', { error: e.message }));
        }
    }

    /**
     * Stop the server and clean up resources
     */
    public stop(): void {
        this.stopCdpScanner();
        this.disconnectCdp();
        TunnelManager.stopTunnel();
        this.publicTunnelUrl = undefined;

        // Close all web clients
        for (const ws of this.webClients) {
            try { ws.close(); } catch (e) {}
        }
        this.webClients.clear();

        if (this.wss) {
            try { this.wss.close(); } catch (e) {}
            this.wss = undefined;
        }

        if (this.server) {
            try { this.server.close(); } catch (e) {}
            this.server = undefined;
        }

        this.isRunning = false;
        console.log('[MirrorServer] Stopped Mirror server.');
    }

    /**
     * Handle configuration changes
     */
    public onConfigChanged(): void {
        const oldEnabled = this.enabled;
        const oldPort = this.port;
        const oldToken = this.token;
        const oldDebuggingPort = this.debuggingPort;
        const oldEnableTunnel = this.enableTunnel;
        const oldTunnelType = this.tunnelType;
        const oldNgrokAuthToken = this.ngrokAuthToken;

        this.loadSettings();

        if (this.enabled !== oldEnabled || 
            this.port !== oldPort || 
            this.token !== oldToken || 
            this.debuggingPort !== oldDebuggingPort ||
            this.enableTunnel !== oldEnableTunnel ||
            this.tunnelType !== oldTunnelType ||
            this.ngrokAuthToken !== oldNgrokAuthToken) {
            console.log('[MirrorServer] Mirror or tunnel config changed. Restarting server...');
            this.start();
        }
    }

    private startCdpScanner() {
        this.stopCdpScanner();
        this.cdpScanTimer = setInterval(() => {
            if (this.webClients.size > 0 && (!this.cdpWs || this.cdpWs.readyState !== WebSocket.OPEN)) {
                this.triggerCdpConnection();
            }
        }, 3000);
    }

    private stopCdpScanner() {
        if (this.cdpScanTimer) {
            clearInterval(this.cdpScanTimer);
            this.cdpScanTimer = undefined;
        }
    }

    private disconnectCdp() {
        this.stopCropTimer();
        if (this.cdpWs) {
            // Stop screencast cleanly before closing
            try {
                if (this.cdpWs.readyState === WebSocket.OPEN) {
                    this.cdpWs.send(JSON.stringify({
                        id: this.cdpMsgId++,
                        method: 'Page.stopScreencast'
                    }));
                }
            } catch (e) {}

            try { this.cdpWs.close(); } catch (e) {}
            this.cdpWs = undefined;
            console.log('[MirrorServer] Disconnected from Agent CDP webview.');
        }
    }

    private async triggerCdpConnection(): Promise<void> {
        if (this.webClients.size === 0 || (this.cdpWs && this.cdpWs.readyState === WebSocket.OPEN)) {
            return;
        }

        try {
            const targetUrl = await this.findAgentCdpTarget();
            if (!targetUrl) {
                this.broadcast({ type: 'error', message: t('agentChatNotFound') });
                return;
            }

            console.log(`[MirrorServer] Connecting to CDP target: ${targetUrl}`);
            this.cdpWs = new WebSocket(targetUrl);

            this.cdpWs.on('open', () => {
                console.log('[MirrorServer] CDP WebSocket connected. Enabling Page and starting screencast...');
                
                this.cdpWs?.send(JSON.stringify({ id: this.cdpMsgId++, method: 'Page.enable' }));
                this.cdpWs?.send(JSON.stringify({ id: this.cdpMsgId++, method: 'Runtime.enable' }));
                
                // Start screencast
                this.cdpWs?.send(JSON.stringify({
                    id: this.cdpMsgId++,
                    method: 'Page.startScreencast',
                    params: {
                        format: 'jpeg',
                        quality: 95,
                        maxWidth: 1920,
                        maxHeight: 1920,
                        everyNthFrame: 1
                    }
                }));

                this.startCropTimer();
            });

            this.cdpWs.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    
                    if (msg.id === this.cropRectMsgId) {
                        const val = msg.result?.result?.value;
                        if (val && typeof val === 'object' && val.width > 0 && val.height > 0) {
                            this.lastCropRect = {
                                x: val.x,
                                y: val.y,
                                width: val.width,
                                height: val.height
                            };
                        } else {
                            this.lastCropRect = null;
                        }
                        return;
                    }

                    // Route screencast frames to web clients
                    if (msg.method === 'Page.screencastFrame') {
                        this.broadcast({
                            type: 'frame',
                            data: msg.params.data,
                            metadata: msg.params.metadata,
                            crop: this.lastCropRect || undefined
                        });

                        // Acknowledge the frame to keep receiving
                        this.cdpWs?.send(JSON.stringify({
                            id: this.cdpMsgId++,
                            method: 'Page.screencastFrameAck',
                            params: { sessionId: msg.params.sessionId }
                        }));
                    }
                } catch (e) {}
            });

            this.cdpWs.on('close', () => {
                console.log('[MirrorServer] CDP WebSocket closed.');
                this.stopCropTimer();
                this.cdpWs = undefined;
            });

            this.cdpWs.on('error', (err) => {
                console.error('[MirrorServer] CDP WebSocket error:', err.message);
                this.stopCropTimer();
                this.cdpWs = undefined;
            });

        } catch (e: any) {
            // Quietly handle connection errors
        }
    }

    private async findAgentCdpTarget(): Promise<string | undefined> {
        return new Promise((resolve) => {
            const options = {
                hostname: '127.0.0.1',
                port: this.debuggingPort,
                path: '/json',
                timeout: 500
            };

            const req = http.get(options, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        const targets: CdpTarget[] = JSON.parse(body);
                        const candidates = targets.filter(t =>
                            (t.type === 'page' || t.type === 'iframe' || t.type === 'webview') &&
                            t.webSocketDebuggerUrl &&
                            !t.url.includes('devtools://') &&
                            !t.title.includes('Extension: Antigravity Telegram Control')
                        );

                        // Prioritize Antigravity targets
                        candidates.sort((a, b) => {
                            const aMatch = a.title.toLowerCase().includes('antigravity') ? 1 : 0;
                            const bMatch = b.title.toLowerCase().includes('antigravity') ? 1 : 0;
                            return bMatch - aMatch;
                        });

                        if (candidates.length > 0) {
                            resolve(candidates[0].webSocketDebuggerUrl);
                        } else {
                            resolve(undefined);
                        }
                    } catch (e) {
                        resolve(undefined);
                    }
                });
            });

            req.on('error', () => resolve(undefined));
            req.on('timeout', () => {
                req.destroy();
                resolve(undefined);
            });
        });
    }

    private startCropTimer() {
        this.stopCropTimer();
        this.sendCropRectQuery();
        this.cropTimer = setInterval(() => {
            this.sendCropRectQuery();
        }, 2000);
    }

    private stopCropTimer() {
        if (this.cropTimer) {
            clearInterval(this.cropTimer);
            this.cropTimer = undefined;
        }
        this.lastCropRect = null;
    }

    private sendCropRectQuery() {
        if (!this.cdpWs || this.cdpWs.readyState !== WebSocket.OPEN) {
            return;
        }

        const queryScript = `
            (async function() {
                async function querySelectorDeep(selector, root = document) {
                    const el = root.querySelector(selector);
                    if (el) return el;
                    const all = root.querySelectorAll('*');
                    for (const node of all) {
                        if (node.shadowRoot) {
                            const found = await querySelectorDeep(selector, node.shadowRoot);
                            if (found) return found;
                        }
                    }
                    return null;
                }

                const selectors = [
                    '#conversation', '#chat', '#cascade', 
                    '.chat-container', '.messages-container', 
                    '[class*="message-list"]', '[class*="Conversation"]',
                    '.chat-input', '[contenteditable="true"]'
                ];
                
                let foundSelector = "none";
                let targetEl = null;
                for (const s of selectors) {
                    targetEl = await querySelectorDeep(s);
                    if (targetEl && targetEl.offsetParent !== null) {
                        if (s === '.chat-input' || s === '[contenteditable="true"]') {
                             const container = targetEl.closest('#conversation, #chat, #cascade, [class*="Conversation"], [class*="chat-container"]');
                             if (container) targetEl = container;
                        }
                        foundSelector = s;
                        break;
                    }
                }

                if (!targetEl) return null;

                let captureEl = targetEl;
                if (targetEl.offsetHeight < 200) {
                    const scrollers = Array.from(document.querySelectorAll('div'))
                        .filter(d => d.offsetHeight > 400 && d.offsetParent !== null)
                        .sort((a, b) => b.offsetHeight - a.offsetHeight);
                    if (scrollers.length > 0) {
                        captureEl = scrollers[0];
                    }
                }

                const rect = captureEl.getBoundingClientRect();
                return {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width || document.documentElement.clientWidth,
                    height: rect.height || document.documentElement.clientHeight
                };
            })()
        `;

        try {
            this.cdpWs.send(JSON.stringify({
                id: this.cropRectMsgId,
                method: 'Runtime.evaluate',
                params: {
                    expression: queryScript,
                    awaitPromise: true,
                    returnByValue: true
                }
            }));
        } catch (e) {}
    }

    private broadcast(obj: any) {
        const json = JSON.stringify(obj);
        for (const ws of this.webClients) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(json);
            }
        }
    }

    private async handleClientMessage(ws: WebSocket, msg: any) {
        if (!this.cdpWs || this.cdpWs.readyState !== WebSocket.OPEN) {
            return;
        }

        switch (msg.type) {
            case 'click':
                console.log(`[MirrorServer] Click received: ${msg.x}, ${msg.y}`);
                try {
                    // Dispatch mouse pressed
                    this.cdpWs.send(JSON.stringify({
                        id: this.cdpMsgId++,
                        method: 'Input.dispatchMouseEvent',
                        params: {
                            type: 'mousePressed',
                            button: 'left',
                            x: msg.x,
                            y: msg.y,
                            clickCount: 1
                        }
                    }));
                    
                    // Dispatch mouse released
                    this.cdpWs.send(JSON.stringify({
                        id: this.cdpMsgId++,
                        method: 'Input.dispatchMouseEvent',
                        params: {
                            type: 'mouseReleased',
                            button: 'left',
                            x: msg.x,
                            y: msg.y,
                            clickCount: 1
                        }
                    }));
                } catch (e) {}
                break;

            case 'sendMessage':
                console.log(`[MirrorServer] Sending message to agent: "${msg.text}"`);
                try {
                    // Type and submit using the extension's sendViaCDP utility
                    await sendViaCDP(msg.text, this.debuggingPort);
                } catch (e: any) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: `Failed to send message: ${e.message}`
                    }));
                }
                break;

            case 'stopAgent':
                console.log('[MirrorServer] Requesting Stop Agent');
                try {
                    await stopAgent(this.debuggingPort);
                } catch (e) {}
                break;

            case 'clickRetry':
                console.log('[MirrorServer] Requesting Retry click');
                try {
                    await clickRetryButton(this.debuggingPort);
                } catch (e) {}
                break;
        }
    }

    private getClientHtml(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${t('mirrorTitle')}</title>
    <style>
        :root {
            --bg-color: #1e1e2e;
            --panel-bg: #252538;
            --text-color: #cdd6f4;
            --text-muted: #a6adc8;
            --accent-color: #cba6f7;
            --accent-hover: #b4befe;
            --input-bg: #11111b;
            --border-color: #313244;
            --success-color: #a6e3a1;
            --error-color: #f38ba8;
            --warn-color: #f9e2af;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: var(--bg-color);
            color: var(--text-color);
            display: flex;
            flex-direction: column;
            height: 100vh;
            overflow: hidden;
        }
        header {
            background: var(--panel-bg);
            border-bottom: 1px solid var(--border-color);
            padding: 12px 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            z-index: 10;
        }
        .title-group {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        h1 {
            font-size: 16px;
            font-weight: 600;
        }
        .status-badge {
            font-size: 11px;
            padding: 4px 8px;
            border-radius: 12px;
            font-weight: 500;
            background: rgba(255,255,255,0.05);
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--text-muted);
            box-shadow: 0 0 8px var(--text-muted);
        }
        .status-badge.connected .status-dot {
            background: var(--success-color);
            box-shadow: 0 0 8px var(--success-color);
        }
        .status-badge.connecting .status-dot {
            background: var(--warn-color);
            box-shadow: 0 0 8px var(--warn-color);
            animation: pulse 1.5s infinite;
        }
        .status-badge.disconnected .status-dot {
            background: var(--error-color);
            box-shadow: 0 0 8px var(--error-color);
        }
        @keyframes pulse {
            0% { opacity: 0.5; }
            50% { opacity: 1; }
            100% { opacity: 0.5; }
        }
        .controls {
            display: flex;
            gap: 8px;
        }
        button {
            background: var(--accent-color);
            color: var(--bg-color);
            border: none;
            padding: 6px 12px;
            border-radius: 6px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            gap: 6px;
            outline: none;
        }
        button:hover {
            background: var(--accent-hover);
        }
        button.secondary {
            background: rgba(255,255,255,0.08);
            color: var(--text-color);
            border: 1px solid var(--border-color);
        }
        button.secondary:hover {
            background: rgba(255,255,255,0.12);
        }
        button.danger {
            background: rgba(243, 139, 168, 0.15);
            color: var(--error-color);
            border: 1px solid rgba(243, 139, 168, 0.3);
        }
        button.danger:hover {
            background: rgba(243, 139, 168, 0.25);
        }
        main {
            flex: 1;
            position: relative;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
            background: radial-gradient(circle at center, #242437 0%, #11111b 100%);
            overflow: auto;
        }
        .canvas-container {
            position: relative;
            box-shadow: 0 20px 40px rgba(0,0,0,0.5);
            border-radius: 12px;
            overflow: hidden;
            border: 1px solid var(--border-color);
            max-width: 100%;
            max-height: 100%;
            background: #11111b;
        }
        canvas {
            display: block;
            max-width: 100%;
            object-fit: contain;
        }
        .overlay {
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(17, 17, 27, 0.85);
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            gap: 16px;
            z-index: 5;
            transition: opacity 0.3s ease;
            padding: 20px;
            text-align: center;
        }
        .spinner {
            width: 40px;
            height: 40px;
            border: 3px solid rgba(203, 166, 247, 0.1);
            border-top: 3px solid var(--accent-color);
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        footer {
            background: var(--panel-bg);
            border-top: 1px solid var(--border-color);
            padding: 16px 20px;
            display: flex;
            gap: 12px;
            align-items: center;
            z-index: 10;
        }
        .input-group {
            flex: 1;
            position: relative;
        }
        input[type="text"] {
            width: 100%;
            background: var(--input-bg);
            border: 1px solid var(--border-color);
            color: var(--text-color);
            padding: 12px 16px;
            border-radius: 8px;
            font-size: 14px;
            outline: none;
            transition: border-color 0.2s ease;
        }
        input[type="text"]:focus {
            border-color: var(--accent-color);
        }
        .footer-hint {
            font-size: 11px;
            color: var(--text-muted);
            text-align: center;
            padding-bottom: 8px;
            background: var(--panel-bg);
        }
    </style>
</head>
<body>
    <header>
        <div class="title-group">
            <h1>${t('mirrorTitle')}</h1>
            <div id="statusBadge" class="status-badge connecting">
                <span class="status-dot"></span>
                <span id="statusText">${t('mirrorConnecting')}</span>
            </div>
        </div>
        <div class="controls">
            <button id="retryBtn" class="secondary">${t('mirrorRetryBtn')}</button>
            <button id="stopBtn" class="danger">${t('mirrorStopBtn')}</button>
        </div>
    </header>
    
    <main>
        <div class="canvas-container">
            <div id="loadingOverlay" class="overlay">
                <div class="spinner"></div>
                <p id="overlayText">${t('mirrorWaitingStream')}</p>
            </div>
            <canvas id="mirrorCanvas"></canvas>
        </div>
    </main>

    <div class="footer-hint">
        ${t('mirrorHint')}
    </div>
    <footer>
        <div class="input-group">
            <input type="text" id="chatInput" placeholder="${t('mirrorInputPlaceholder')}" autocomplete="off">
        </div>
        <button id="sendBtn">${t('mirrorSendBtn')}</button>
    </footer>

    <script>
        const token = "${this.token}";
        const canvas = document.getElementById('mirrorCanvas');
        const ctx = canvas.getContext('2d');
        const statusBadge = document.getElementById('statusBadge');
        const statusText = document.getElementById('statusText');
        const loadingOverlay = document.getElementById('loadingOverlay');
        const overlayText = document.getElementById('overlayText');
        const chatInput = document.getElementById('chatInput');
        const sendBtn = document.getElementById('sendBtn');
        const stopBtn = document.getElementById('stopBtn');
        const retryBtn = document.getElementById('retryBtn');

        let ws;
        let lastWidth = 0;
        let lastHeight = 0;
        let currentCrop = null;

        function connect() {
            const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
            const wsUrl = protocol + window.location.host + '/ws?token=' + encodeURIComponent(token);
            
            setStatus('connecting', "${t('mirrorConnecting')}");
            ws = new WebSocket(wsUrl);

            ws.onopen = () => {
                setStatus('connected', "${t('mirrorConnected')}");
            };

            ws.onmessage = (event) => {
                const msg = JSON.parse(event.data);
                if (msg.type === 'frame') {
                    const img = new Image();
                    img.onload = () => {
                        loadingOverlay.style.opacity = '0';
                        setTimeout(() => { loadingOverlay.style.display = 'none'; }, 300);

                        const deviceWidth = msg.metadata.deviceWidth || img.width;
                        const deviceHeight = msg.metadata.deviceHeight || img.height;

                        currentCrop = msg.crop;
                        const scaleX = img.width / deviceWidth;
                        const scaleY = img.height / deviceHeight;

                        if (currentCrop && currentCrop.width > 0 && currentCrop.height > 0) {
                            canvas.width = currentCrop.width * scaleX;
                            canvas.height = currentCrop.height * scaleY;

                            ctx.drawImage(
                                img,
                                currentCrop.x * scaleX,
                                currentCrop.y * scaleY,
                                currentCrop.width * scaleX,
                                currentCrop.height * scaleY,
                                0,
                                0,
                                canvas.width,
                                canvas.height
                            );

                            lastWidth = currentCrop.width;
                            lastHeight = currentCrop.height;
                        } else {
                            canvas.width = img.width;
                            canvas.height = img.height;
                            ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, canvas.width, canvas.height);

                            lastWidth = deviceWidth;
                            lastHeight = deviceHeight;
                        }
                    };
                    img.src = 'data:image/jpeg;base64,' + msg.data;
                } else if (msg.type === 'error') {
                    overlayText.textContent = msg.message;
                    loadingOverlay.style.display = 'flex';
                    loadingOverlay.style.opacity = '1';
                }
            };

            ws.onclose = () => {
                setStatus('disconnected', "${t('mirrorDisconnected')}");
                loadingOverlay.style.display = 'flex';
                loadingOverlay.style.opacity = '1';
                overlayText.textContent = "${t('mirrorCloseRetry')}";
                setTimeout(connect, 3000);
            };

            ws.onerror = () => {
                setStatus('disconnected', "${t('mirrorError')}");
            };
        }

        function setStatus(className, text) {
            statusBadge.className = 'status-badge ' + className;
            statusText.textContent = text;
        }

        canvas.addEventListener('mousedown', (e) => {
            if (ws && ws.readyState === WebSocket.OPEN && lastWidth > 0 && lastHeight > 0) {
                const rect = canvas.getBoundingClientRect();
                const x = ((e.clientX - rect.left) / rect.width) * lastWidth;
                const y = ((e.clientY - rect.top) / rect.height) * lastHeight;

                let targetX = Math.round(x);
                let targetY = Math.round(y);

                if (currentCrop && currentCrop.width > 0 && currentCrop.height > 0) {
                    targetX += currentCrop.x;
                    targetY += currentCrop.y;
                }

                ws.send(JSON.stringify({
                    type: 'click',
                    x: targetX,
                    y: targetY
                }));
            }
        });

        function sendMessage() {
            const text = chatInput.value.trim();
            if (text && ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'sendMessage',
                    text: text
                }));
                chatInput.value = '';
            }
        }

        sendBtn.addEventListener('click', sendMessage);
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                sendMessage();
            }
        });

        stopBtn.addEventListener('click', () => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'stopAgent' }));
            }
        });

        retryBtn.addEventListener('click', () => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'clickRetry' }));
            }
        });

        connect();
    </script>
</body>
</html>`;
    }

    public dispose() {
        this.stop();
    }
}
