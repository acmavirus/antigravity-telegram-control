import * as vscode from 'vscode';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import * as url from 'url';
import { getWorkbenchPath } from './workbench_injector';
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
    private clickPatterns: string[] = ["Allow", "Always Allow", "Run", "Keep Waiting", "Accept all", "Accept"];

    private pendingRequests = new Map<number, { resolve: Function, reject: Function }>();

    // HTTP server for injected script IPC
    private httpServer: http.Server | undefined;
    private actualPort = 0;
    private resetStatsRequested = false;

    // Win32 dialog watcher
    private keepWaitingInterval: NodeJS.Timeout | undefined;

    constructor(private context?: vscode.ExtensionContext) {
        this.loadSettings();
    }

    private loadSettings() {
        const config = vscode.workspace.getConfiguration('antigravityTelegramControl');
        this.autoAccept = config.get<boolean>('autoAccept') ?? false;
        this.interval = config.get<number>('autoAcceptInterval') ?? 800;
        this.port = config.get<number>('debuggingPort') ?? 9222;
        this.clickPatterns = config.get<string[]>('clickPatterns') ?? ["Allow", "Always Allow", "Run", "Keep Waiting", "Accept all", "Accept"];
    }

    public getStats(): { totalClicks: number, clickStats: Record<string, number> } {
        if (!this.context) {
            return { totalClicks: 0, clickStats: {} };
        }
        const totalClicks = this.context.globalState.get<number>('totalClicks') ?? 0;
        const clickStats = this.context.globalState.get<Record<string, number>>('clickStats') ?? {};
        return { totalClicks, clickStats };
    }

    public resetStats(): void {
        if (this.context) {
            this.context.globalState.update('totalClicks', 0);
            this.context.globalState.update('clickStats', {});
            this.context.globalState.update('clickLog', []);
        }
        this.resetStatsRequested = true;
    }

    public getClickLog(): Array<{ time: string, button: string, pattern: string }> {
        if (!this.context) {
            return [];
        }
        return this.context.globalState.get<Array<{ time: string, button: string, pattern: string }>>('clickLog') ?? [];
    }

    public clearClickLog(): void {
        if (this.context) {
            this.context.globalState.update('clickLog', []);
        }
    }

    private trackClick(buttonText: string, pattern: string): void {
        if (!this.context) {
            return;
        }
        const totalClicks = (this.context.globalState.get<number>('totalClicks') ?? 0) + 1;
        this.context.globalState.update('totalClicks', totalClicks);

        const clickStats = this.context.globalState.get<Record<string, number>>('clickStats') ?? {};
        clickStats[pattern] = (clickStats[pattern] ?? 0) + 1;
        this.context.globalState.update('clickStats', clickStats);

        const clickLog = this.context.globalState.get<Array<{ time: string, button: string, pattern: string }>>('clickLog') ?? [];
        const time = new Date().toLocaleTimeString();
        clickLog.unshift({ time, button: buttonText, pattern });
        if (clickLog.length > 50) {
            clickLog.pop();
        }
        this.context.globalState.update('clickLog', clickLog);
    }

    /**
     * Start the auto-accept process if enabled
     */
    public start(): void {
        this.loadSettings();
        if (this.isRunning) {
            this.stop();
        }

        // Start native dialog watcher on Windows if autoAccept is enabled
        if (this.autoAccept) {
            this.startWin32DialogWatcher();
        }

        // Start HTTP Server for injected script configuration polling
        this.startHttpServer();

        if (!this.autoAccept) {
            return;
        }

        this.isRunning = true;
        console.log(`[AutoAccept] Started CDP loop with interval ${this.interval}ms on port ${this.port}`);

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
        this.pendingRequests.clear();

        // Stop Win32 dialog clicker
        this.stopWin32DialogWatcher();

        // Stop HTTP Server
        this.stopHttpServer();

        console.log('[AutoAccept] Stopped loop and cleared connections.');
    }

    /**
     * Called when configuration changes to refresh the loop settings
     */
    public onConfigChanged(): void {
        const oldAutoAccept = this.autoAccept;
        const oldInterval = this.interval;
        const oldPort = this.port;
        const oldClickPatterns = JSON.stringify(this.clickPatterns);

        this.loadSettings();

        if (this.autoAccept !== oldAutoAccept || 
            this.interval !== oldInterval || 
            this.port !== oldPort ||
            JSON.stringify(this.clickPatterns) !== oldClickPatterns) {
            console.log(`[AutoAccept] Config changed. AutoAccept: ${this.autoAccept}, Interval: ${this.interval}ms, Port: ${this.port}`);
            this.start();
        }
    }

    /**
     * Start local HTTP IPC micro-server
     */
    private startHttpServer(): void {
        if (this.httpServer) return;

        this.httpServer = http.createServer((req, res) => {
            // Handle CORS
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            res.setHeader('Content-Type', 'application/json');

            if (req.method === 'OPTIONS') {
                res.writeHead(204);
                res.end();
                return;
            }

            const parsed = url.parse(req.url || '', true);

            // Accumulate statistics update from query parameters
            if (parsed.query && parsed.query.stats) {
                try {
                    const incoming = JSON.parse(decodeURIComponent(parsed.query.stats as string));
                    const clickStats = this.context?.globalState.get<Record<string, number>>('clickStats') ?? {};
                    let totalClicks = this.context?.globalState.get<number>('totalClicks') ?? 0;

                    for (const key in incoming) {
                        clickStats[key] = (clickStats[key] ?? 0) + incoming[key];
                        totalClicks += incoming[key];
                    }

                    this.context?.globalState.update('clickStats', clickStats);
                    this.context?.globalState.update('totalClicks', totalClicks);
                } catch (e) { /* ignore parse errors */ }
            }

            // Reset stats endpoint
            if (parsed.pathname === '/ag-reset-stats') {
                this.resetStats();
                res.writeHead(200);
                res.end(JSON.stringify({ reset: true }));
                return;
            }

            // Click log endpoint
            if (parsed.pathname === '/api/click-log' && req.method === 'POST') {
                let body = '';
                req.on('data', chunk => { body += chunk; });
                req.on('end', () => {
                    try {
                        const data = JSON.parse(body);
                        console.log('[AG Auto] Click-log received:', data.pattern, data.button);
                        
                        const clickLog = this.context?.globalState.get<Array<any>>('clickLog') ?? [];
                        const timestamp = (function () { 
                            const d = new Date(); 
                            const pad = function (n: number) { return n < 10 ? '0' : n }; 
                            return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); 
                        })();
                        const entry = { time: timestamp, pattern: data.pattern || 'click', button: (data.button || '').substring(0, 80) };
                        clickLog.unshift(entry);
                        if (clickLog.length > 50) clickLog.pop();
                        
                        this.context?.globalState.update('clickLog', clickLog);
                        
                        res.writeHead(200);
                        res.end(JSON.stringify({ logged: true }));
                    } catch (e: any) {
                        res.writeHead(200);
                        res.end(JSON.stringify({ error: e.message }));
                    }
                });
                return;
            }

            // Main /ag-status config endpoint
            res.writeHead(200);
            const clickStats = this.context?.globalState.get<Record<string, number>>('clickStats') ?? {};
            const totalClicks = this.context?.globalState.get<number>('totalClicks') ?? 0;
            const activePatterns = this.clickPatterns.filter(p => p !== 'Accept');
            const acceptEnabled = this.clickPatterns.includes('Accept');

            const response: any = {
                enabled: this.autoAccept,
                clickPatterns: activePatterns,
                acceptInChatOnly: acceptEnabled,
                clickIntervalMs: this.interval,
                clickStats: clickStats,
                totalClicks: totalClicks
            };

            if (this.resetStatsRequested) {
                response.resetStats = true;
                this.resetStatsRequested = false;
            }

            res.end(JSON.stringify(response));
        });

        // Search dynamic port in range 48787 - 48850
        const tryListenPort = (port: number) => {
            if (port > 48850) {
                console.log('[AG Auto] ❌ No available port in range 48787-48850');
                return;
            }
            this.httpServer?.removeAllListeners('error');
            this.httpServer?.once('error', (e: any) => {
                if (e.code === 'EADDRINUSE') {
                    console.log('[AG Auto] Port ' + port + ' busy, trying ' + (port + 1) + '...');
                    tryListenPort(port + 1);
                } else {
                    console.log('[AG Auto] ⚠️ HTTP server error:', e.message);
                }
            });
            this.httpServer?.listen(port, '127.0.0.1', () => {
                this.actualPort = port;
                console.log('[AG Auto] ✅ HTTP IPC server started on port ' + port);
                
                try {
                    const wbPath = getWorkbenchPath();
                    if (wbPath) {
                        const portFile = path.join(path.dirname(wbPath), 'ag-auto-port-' + process.pid + '.txt');
                        fs.writeFileSync(portFile, String(port), 'utf8');
                    }
                } catch (_e) { }
            });
        };

        tryListenPort(48787);
    }

    private stopHttpServer(): void {
        if (this.httpServer) {
            try {
                this.httpServer.close();
            } catch (_) {}
            this.httpServer = undefined;
            this.actualPort = 0;
            console.log('[AG Auto] HTTP IPC server stopped.');
        }

        try {
            const wbPath = getWorkbenchPath();
            if (wbPath) {
                const portFile = path.join(path.dirname(wbPath), 'ag-auto-port-' + process.pid + '.txt');
                if (fs.existsSync(portFile)) {
                    fs.unlinkSync(portFile);
                }
            }
        } catch (_e) { }
    }

    /**
     * Start background watcher for native Keep Waiting clicker on Windows
     */
    private startWin32DialogWatcher(): void {
        if (process.platform !== 'win32') return;
        if (this.keepWaitingInterval) return;

        const { execFile } = require('child_process');
        const keepWaitingScript = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class AgWin32 {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hwnd, EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr w, IntPtr l);
}
"@
$global:clicked = $false
[AgWin32]::EnumWindows({
    param($hWnd, $lp)
    if (-not [AgWin32]::IsWindowVisible($hWnd)) { return $true }
    if ($global:clicked) { return $false }
    [AgWin32]::EnumChildWindows($hWnd, {
        param($ch, $lp2)
        $cls = New-Object System.Text.StringBuilder 64
        [AgWin32]::GetClassName($ch, $cls, 64) | Out-Null
        if ($cls.ToString() -eq 'Button') {
            $txt = New-Object System.Text.StringBuilder 256
            [AgWin32]::GetWindowText($ch, $txt, 256) | Out-Null
            $t = $txt.ToString()
            if ($t -match 'Keep Waiting') {
                [AgWin32]::PostMessage($ch, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
                $global:clicked = $true
            }
        }
        return $true
    }, [IntPtr]::Zero) | Out-Null
    if ($global:clicked) { return $false }
    return $true
}, [IntPtr]::Zero) | Out-Null
if ($global:clicked) { Write-Output 'CLICKED' }
`.trim();

        this.keepWaitingInterval = setInterval(() => {
            if (!this.autoAccept) return;
            if (!this.clickPatterns.includes('Keep Waiting')) return;

            execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', keepWaitingScript], { timeout: 5000 }, (err: any, stdout: string) => {
                if (stdout && stdout.trim() === 'CLICKED') {
                    console.log('[AG Auto] 🎯 Native dialog: Keep Waiting clicked via Win32');
                    this.trackClick('Keep Waiting', 'Keep Waiting');
                }
            });
        }, 3000);
        console.log('[AG Auto] 🛡️ Win32 Keep Waiting watcher started');
    }

    private stopWin32DialogWatcher(): void {
        if (this.keepWaitingInterval) {
            clearInterval(this.keepWaitingInterval);
            this.keepWaitingInterval = undefined;
            console.log('[AG Auto] 🛡️ Win32 Keep Waiting watcher stopped');
        }
    }

    /**
     * Main loop tick (CDP Fallback strategy)
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
            // Quietly catch errors
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
            ws.on('message', (raw: any) => {
                try {
                    const msg = JSON.parse(raw.toString());
                    if (msg.id && this.pendingRequests.has(msg.id)) {
                        const { resolve } = this.pendingRequests.get(msg.id)!;
                        this.pendingRequests.delete(msg.id);
                        resolve(msg.result);
                    }
                } catch (e) {}
            });
            ws.on('error', () => {
                resolve(undefined);
            });
            ws.on('close', () => {
                this.connections.delete(pageId);
            });
        });
    }

    private sendCdp(ws: import('ws'), method: string, params: object = {}): Promise<any> {
        return new Promise((resolve, reject) => {
            if (ws.readyState !== WebSocket.OPEN) {
                resolve(undefined);
                return;
            }
            const id = this.msgId++;
            this.pendingRequests.set(id, { resolve, reject });
            ws.send(JSON.stringify({ id, method, params }));
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    resolve(undefined);
                }
            }, 3000);
        });
    }

    /**
     * Send evaluation clicker script to click accept buttons in shadow DOM (CDP Strategy)
     */
    private async evaluateClickerScript(ws: import('ws')): Promise<void> {
        const clickPatternsJson = JSON.stringify(this.clickPatterns);

        const script = `
            (() => {
                if (!document.querySelector('.react-app-container') && !document.querySelector('.antigravity-agent-side-panel')) {
                    return { clicked: false };
                }

                const clickPatterns = ${clickPatternsJson};
                
                if (!window._agClicked) {
                    window._agClicked = new WeakSet();
                }

                const clickElement = (el) => {
                    try {
                        el.click();
                        const rect = el.getBoundingClientRect();
                        const opts = { view: window, bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, buttons: 1 };
                        el.dispatchEvent(new MouseEvent('mousedown', opts));
                        el.dispatchEvent(new MouseEvent('mouseup', opts));
                        el.dispatchEvent(new MouseEvent('click', opts));
                    } catch (e) { }
                    let p = el.parentElement;
                    if (p) { try { p.click(); } catch(e) {} }
                };

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

                const roots = getAllRoots();

                // 2. AUTO CLICK
                const REJECT_WORDS = ['reject', 'deny', 'cancel', 'dismiss', "don't allow", 'decline', 'hủy', 'từ chối'];
                const isApprovalButton = (btn) => {
                    let parent = btn.parentElement;
                    if (!parent) return false;
                    for (let level = 0; level < 3; level++) {
                        if (!parent) break;
                        const siblingBtns = parent.querySelectorAll('button, a.action-label, [role="button"], .monaco-button, span.bg-ide-button-background');
                        for (let i = 0; i < siblingBtns.length; i++) {
                            const sib = siblingBtns[i];
                            if (sib === btn) continue;
                            const sibText = (sib.innerText || sib.textContent || '').trim().toLowerCase();
                            for (let j = 0; j < REJECT_WORDS.length; j++) {
                                if (sibText === REJECT_WORDS[j] || sibText.startsWith(REJECT_WORDS[j])) {
                                    return true;
                                }
                            }
                        }
                        parent = parent.parentElement;
                    }
                    return false;
                };

                const EDITOR_SKIP_WORDS = ['accept changes', 'accept all', 'accept incoming', 'accept current', 'accept both', 'accept combination'];
                
                let targetBtn = null;
                let matchedPattern = '';

                const clickables = [];
                roots.forEach(root => {
                    root.querySelectorAll('button, a.action-label, [role="button"], .monaco-button, span.bg-ide-button-background, span.cursor-pointer').forEach(el => {
                        if (el.offsetParent !== null) {
                            clickables.push(el);
                        }
                    });
                });

                for (let i = 0; i < clickables.length; i++) {
                    const b = clickables[i];
                    if (window._agClicked.has(b)) continue;

                    const rawText = (b.innerText || b.textContent || '').trim();
                    const textLower = rawText.toLowerCase();
                    if (!rawText || rawText.length > 40) continue;

                    if (textLower.includes('.js') || textLower.includes('.ts') || textLower.includes('.py')) continue;

                    let skipEditor = false;
                    for (const w of EDITOR_SKIP_WORDS) {
                        if (textLower.indexOf(w) === 0) { skipEditor = true; break; }
                    }
                    if (skipEditor) continue;

                    if (b.closest && (
                        b.closest('.monaco-diff-editor') || b.closest('.merge-editor-view') ||
                        b.closest('.inline-merge-region') || b.closest('.merged-editor') ||
                        b.closest('.view-zones') || b.closest('.view-lines') ||
                        b.closest('[id*="workbench.parts.editor"]') || b.closest('.editor-scrollable')
                    )) continue;

                    if (b.classList && (b.classList.contains('diff-hunk-button') || b.classList.contains('revert'))) {
                        if (b.closest && b.closest('[class*="editor"], [id*="editor"]')) continue;
                    }

                    let matchesPattern = false;
                    for (const pat of clickPatterns) {
                        if (pat.toLowerCase() === 'accept') continue;
                        
                        if (textLower === pat.toLowerCase() || textLower.indexOf(pat.toLowerCase()) === 0) {
                            matchesPattern = true;
                            matchedPattern = pat;
                            break;
                        }
                    }

                    if (matchesPattern) {
                        if ((b.tagName === 'SPAN' && b.classList.contains('cursor-pointer')) || isApprovalButton(b)) {
                            targetBtn = b;
                            break;
                        }
                    }
                }

                const hasAcceptPattern = clickPatterns.some(p => p.toLowerCase() === 'accept');
                if (!targetBtn && hasAcceptPattern) {
                    for (let i = 0; i < clickables.length; i++) {
                        const ab = clickables[i];
                        if (window._agClicked.has(ab)) continue;
                        const rawText = (ab.innerText || ab.textContent || '').trim();
                        const textLower = rawText.toLowerCase();

                        if (textLower.indexOf('accept') !== 0) continue;
                        if (/^accept\s+(all|changes|incoming|current|both|combination)/i.test(textLower)) continue;

                        if (ab.closest && (
                            ab.closest('.editor-scrollable') ||
                            ab.closest('.monaco-diff-editor') ||
                            ab.closest('.view-zones') ||
                            ab.closest('.merge-editor-view')
                        )) continue;

                        if (ab.classList && (ab.classList.contains('diff-hunk-button') || ab.classList.contains('revert'))) continue;

                        targetBtn = ab;
                        matchedPattern = 'Accept';
                        break;
                    }
                }

                if (targetBtn) {
                    window._agClicked.add(targetBtn);
                    const btnText = targetBtn.innerText.trim();
                    clickElement(targetBtn);
                    return { clicked: true, pattern: matchedPattern, buttonText: btnText };
                }

                return { clicked: false };
            })()
        `;

        try {
            const response = await this.sendCdp(ws, 'Runtime.evaluate', {
                expression: script,
                userGesture: true,
                awaitPromise: true,
                returnByValue: true
            });
            const val = response?.result?.value;
            if (val && val.clicked) {
                console.log(`[AutoAccept] Detected click on "${val.buttonText}" matching pattern "${val.pattern}"`);
                this.trackClick(val.buttonText, val.pattern);
            }
        } catch (e) { /* ignore */ }
    }

    public dispose(): void {
        this.stop();
    }
}
