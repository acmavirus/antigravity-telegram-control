import * as vscode from 'vscode';
import * as http from 'http';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const WebSocket = require('ws') as typeof import('ws');

interface CdpPage {
    id: string;
    type: string;
    title?: string;
    webSocketDebuggerUrl?: string;
}

export class AutoAcceptManager implements vscode.Disposable {
    private intervalId: NodeJS.Timeout | undefined;
    private connections = new Map<string, import('ws')>();
    private msgId = 1;
    private isRunning = false;

    private autoAccept = false;
    private interval = 800;
    private port = 9222;

    constructor() {
        this.loadSettings();
    }

    private loadSettings() {
        const config = vscode.workspace.getConfiguration('antigravityTelegramControl');
        this.autoAccept = config.get<boolean>('autoAccept') ?? false;
        this.interval = config.get<number>('autoAcceptInterval') ?? 800;
        this.port = config.get<number>('debuggingPort') ?? 9222;
    }

    /**
     * Start the auto-accept process if enabled
     */
    public start(): void {
        this.loadSettings();
        if (this.isRunning) {
            this.stop();
        }

        if (!this.autoAccept) {
            return;
        }

        this.isRunning = true;
        console.log(`[AutoAccept] Started loop with interval ${this.interval}ms on port ${this.port}`);

        this.intervalId = setInterval(() => {
            this.tick();
        }, this.interval);
    }

    /**
     * Stop the auto-accept process and clear connections
     */
    public stop(): void {
        this.isRunning = false;
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = undefined;
        }

        // Close all WebSocket connections
        for (const [id, ws] of this.connections.entries()) {
            try {
                ws.close();
            } catch (e) { /* ignore */ }
        }
        this.connections.clear();
        console.log('[AutoAccept] Stopped loop and cleared connections.');
    }

    /**
     * Called when configuration changes to refresh the loop settings
     */
    public onConfigChanged(): void {
        const oldAutoAccept = this.autoAccept;
        const oldInterval = this.interval;
        const oldPort = this.port;

        this.loadSettings();

        if (this.autoAccept !== oldAutoAccept || this.interval !== oldInterval || this.port !== oldPort) {
            console.log(`[AutoAccept] Config changed. AutoAccept: ${this.autoAccept}, Interval: ${this.interval}ms, Port: ${this.port}`);
            this.start();
        }
    }

    /**
     * Main loop tick
     */
    private async tick(): Promise<void> {
        // Strategy 1: Call VS Code native accept commands
        try {
            await vscode.commands.executeCommand('antigravity.agent.acceptAgentStep');
        } catch (e) { /* ignored - step not ready or command not registered */ }

        try {
            await vscode.commands.executeCommand('antigravity.terminal.accept');
        } catch (e) { /* ignored */ }

        // Strategy 2: CDP webview button clicking
        try {
            const pages = await this.getPages();
            for (const page of pages) {
                if (page.type !== 'page' && page.type !== 'webview') {
                    continue;
                }
                if (page.title && page.title.includes('Extension Host')) {
                    continue;
                }

                if (!page.webSocketDebuggerUrl) {
                    continue;
                }

                // Check cache or connect
                let ws = this.connections.get(page.id);
                if (!ws || ws.readyState !== WebSocket.OPEN) {
                    if (ws) {
                        try { ws.close(); } catch (e) {}
                        this.connections.delete(page.id);
                    }

                    ws = await this.connectToPage(page.id, page.webSocketDebuggerUrl);
                }

                if (ws && ws.readyState === WebSocket.OPEN) {
                    this.evaluateClickerScript(ws);
                }
            }
        } catch (e: any) {
            // Quietly catch errors (remote debugging port may not be open yet)
            // console.debug('[AutoAccept] Tick error:', e.message);
        }
    }

    /**
     * Retrieve target pages from remote debugging port
     */
    private getPages(): Promise<CdpPage[]> {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: '127.0.0.1',
                port: this.port,
                path: '/json',
                timeout: 500
            };

            const req = http.get(options, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(body));
                    } catch (e) {
                        resolve([]);
                    }
                });
            });

            req.on('error', (err) => reject(err));
            req.on('timeout', () => {
                req.destroy();
                resolve([]);
            });
        });
    }

    /**
     * Connect to a specific webview page WebSocket
     */
    private connectToPage(pageId: string, wsUrl: string): Promise<import('ws') | undefined> {
        return new Promise((resolve) => {
            const ws = new WebSocket(wsUrl);
            ws.on('open', () => {
                this.connections.set(pageId, ws);
                ws.send(JSON.stringify({ id: this.msgId++, method: 'Runtime.enable' }));
                resolve(ws);
            });
            ws.on('error', () => {
                resolve(undefined);
            });
            ws.on('close', () => {
                this.connections.delete(pageId);
            });
        });
    }

    /**
     * Send evaluation clicker script to click accept buttons in shadow DOM
     */
    private evaluateClickerScript(ws: import('ws')): void {
        const script = `
            (() => {
                // Webview Guard: only execute inside the Antigravity agent panel
                if (!document.querySelector('.react-app-container')) return;

                const TARGET_TOKENS = ['accept all', 'accept', 'confirm', 'run', 'always allow', 'allow once', 'allow'];
                const EXPANDER_TOKENS = ['requires input', 'expand'];

                const getAllRoots = (root = document) => {
                    let roots = [root];
                    try {
                        for (const iframe of root.querySelectorAll('iframe, frame')) {
                            try {
                                const doc = iframe.contentDocument || iframe.contentWindow?.document;
                                if (doc) roots.push(...getAllRoots(doc));
                            } catch (e) { }
                        }
                        for (const el of root.querySelectorAll('*')) {
                            if (el.shadowRoot) roots.push(...getAllRoots(el.shadowRoot));
                        }
                    } catch (e) { }
                    return roots;
                };

                const clickElement = (el) => {
                    try {
                        el.click();
                        const rect = el.getBoundingClientRect();
                        const opts = { view: window, bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, buttons: 1 };
                        el.dispatchEvent(new MouseEvent('mousedown', opts));
                        el.dispatchEvent(new MouseEvent('mouseup', opts));
                        el.dispatchEvent(new MouseEvent('click', opts));
                    } catch (e) { }
                    // Bubble for React synthetic events
                    let p = el.parentElement;
                    if (p) { try { p.click(); } catch(e) {} }
                };

                const roots = getAllRoots();

                roots.forEach(root => {
                    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null, false);
                    let el;
                    while (el = walker.nextNode()) {
                        if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;

                        const rawText = (el.innerText || el.textContent || '').trim().toLowerCase();
                        if (!rawText) continue;

                        let isMatch = false;
                        let isExpander = false;

                        if (TARGET_TOKENS.includes(rawText)) isMatch = true;
                        if (rawText.includes('always run') && rawText.length < 25) isMatch = true;
                        if (rawText.startsWith('run alt')) isMatch = true;

                        for (const token of EXPANDER_TOKENS) {
                            if (rawText === token || (token !== 'expand' && rawText.includes(token))) {
                                isMatch = true;
                                isExpander = true;
                            }
                        }

                        // Noise filter: skip file names and code blocks
                        if (rawText.includes('.js') || rawText.includes('.ts') || rawText.includes('.py')) isMatch = false;

                        if (!isMatch) continue;
                        if (el.dataset.autoAcceptClicked === 'true') continue;

                        // Only click interactive elements (buttons or pointer-cursor elements)
                        if (!isExpander) {
                            let safe = false;
                            if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') safe = true;
                            try {
                                if (window.getComputedStyle(el).cursor === 'pointer') safe = true;
                            } catch (e) {}
                            if (!safe) continue;
                            if (el.closest('pre') || el.closest('code')) continue;
                        }

                        el.dataset.autoAcceptClicked = 'true';
                        if (isExpander) {
                            setTimeout(() => { el.dataset.autoAcceptClicked = 'false'; }, 2000);
                        }

                        clickElement(el);
                    }
                });
            })()
        `;

        try {
            ws.send(JSON.stringify({
                id: this.msgId++,
                method: 'Runtime.evaluate',
                params: {
                    expression: script,
                    userGesture: true,
                    awaitPromise: true
                }
            }));
        } catch (e) { /* ignore */ }
    }

    public dispose(): void {
        this.stop();
    }
}
