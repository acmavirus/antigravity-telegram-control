import * as http from 'http';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const WebSocket = require('ws') as typeof import('ws');

interface CdpTarget {
    id: string;
    type: string;
    title: string;
    url: string;
    webSocketDebuggerUrl?: string;
}

function httpGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

class CdpClient {
    private ws: import('ws');
    private msgId = 1;
    private pending = new Map<number, { resolve: Function, reject: Function }>();

    constructor(wsUrl: string) {
        this.ws = new WebSocket(wsUrl);
        this.ws.on('message', (raw: Buffer | string) => {
            const msg = JSON.parse(raw.toString());
            if (msg.id && this.pending.has(msg.id)) {
                const { resolve, reject } = this.pending.get(msg.id)!;
                this.pending.delete(msg.id);
                if (msg.error) reject(new Error(msg.error.message));
                else resolve(msg.result);
            }
        });
    }

    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.ws.on('open', resolve);
            this.ws.on('error', reject);
        });
    }

    async send(method: string, params: object = {}): Promise<any> {
        return new Promise((resolve, reject) => {
            const id = this.msgId++;
            this.pending.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({ id, method, params }));
            setTimeout(() => {
                if (this.pending.has(id)) {
                    this.pending.delete(id);
                    reject(new Error(`Timeout waiting for CDP response (${method})`));
                }
            }, 3000);
        });
    }

    close() {
        this.ws.close();
    }
}

/**
 * Main export — search ALL possible page/iframe targets and inject the chat message using native input emulation.
 */
export async function sendViaCDP(text: string, port: number): Promise<void> {
    const raw = await httpGet(`http://127.0.0.1:${port}/json`);
    const targets: CdpTarget[] = JSON.parse(raw);

    // Filter to any target that could reasonably host the chat UI
    const candidates = targets.filter(t =>
        (t.type === 'page' || t.type === 'iframe' || t.type === 'webview') &&
        t.webSocketDebuggerUrl &&
        !t.url.includes('devtools://')
    );

    let allDebugs: string[] = [];

    for (const target of candidates) {
        try {
            const client = new CdpClient(target.webSocketDebuggerUrl!);
            await client.connect();

            // 1. Send the evaluation script that mimics the phone chat's logic
            const focusResult = await client.send('Runtime.evaluate', {
                expression: `
                    (async function() {
                        const escapedText = ${JSON.stringify(text)};
                        
                        // Look specifically for the contenteditable used by the chat input
                        const editors = [...document.querySelectorAll('#conversation [contenteditable="true"], #chat [contenteditable="true"], #cascade [contenteditable="true"], .chat-input [contenteditable="true"], .interactive-input-editor [contenteditable="true"], .chat-input, textarea')]
                            .filter(el => el.offsetParent !== null && !el.className.includes('xterm'));
                        
                        const editor = editors.at(-1);
                        if (!editor) return { found: false, error: "editor_not_found" };

                        editor.focus();
                        
                        // Clear existing text securely
                        try {
                            document.execCommand("selectAll", false, null);
                            document.execCommand("delete", false, null);
                        } catch(e) {}

                        // Try to insert text securely
                        let inserted = false;
                        try { 
                            inserted = !!document.execCommand("insertText", false, escapedText); 
                        } catch(e) {}
                        
                        // Fallback insertion (triggers React state updates)
                        if (!inserted) {
                            if (editor.tagName === 'TEXTAREA') {
                                // For textareas (monaco fallback)
                                const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
                                if (setter) setter.call(editor, escapedText);
                                else editor.value = escapedText;
                            } else {
                                // For contenteditable
                                editor.textContent = escapedText;
                            }
                            
                            // Emulate input events to wake up React onChange handlers
                            editor.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertText", data: escapedText }));
                            editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: escapedText }));
                            editor.dispatchEvent(new Event("change", { bubbles: true }));
                        }

                        // Wait for React to render the submit button
                        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
                        await new Promise(r => setTimeout(r, 100));

                        // Find the submit button natively
                        const submit = document.querySelector("svg.lucide-arrow-right, svg[class*='arrow-right'], svg[class*='send']")?.closest("button");
                        if (submit && !submit.disabled) {
                            submit.click();
                            return { found: true, method: "click_submit" };
                        }

                        // Submit via Enter key if button not found or disabled
                        ['keydown', 'keypress', 'keyup'].forEach(type => {
                            editor.dispatchEvent(new KeyboardEvent(type, { 
                                bubbles: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 
                            }));
                        });
                        
                        return { found: true, method: "enter_keypress" };
                    })()
                `,
                awaitPromise: true,
                returnByValue: true
            });

            const val = focusResult?.result?.value;

            if (val && val.found) {
                // The JS injected successfully triggered the submit button or Enter key.
                // We'll also fire CDP Input events just to be 100% sure it submits!

                await new Promise(r => setTimeout(r, 50));

                try {
                    await client.send('Input.dispatchKeyEvent', {
                        type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
                    });
                    await client.send('Input.dispatchKeyEvent', {
                        type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
                    });
                } catch (e) { /* ignore CDP input error if JS already submitted */ }

                client.close();
                return;
            } else {
                client.close();
                allDebugs.push(`[${target.type}] ${target.title}: ${val?.error || 'No chat input element found'}`);
            }
        } catch (e: any) {
            allDebugs.push(`[${target.type}] ${target.title}: Error ${e.message}`);
        }
    }

    const debugInfo = allDebugs.length > 0 ? "\\nDetails: " + allDebugs.slice(0, 4).join("\\n") : "";
    throw new Error("Không tìm thấy ô chat để truyền type." + debugInfo);
}

/**
 * Deep search querySelector helper that traverses Shadow DOM.
 */
const SCROLL_INJECTION_JS = `
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

    async function performDeepScroll() {
        try {
            // 1. Find main chat container
            const selectors = [
                '#conversation', '#chat', '#cascade', 
                '.chat-container', '.messages-container', 
                '[class*="message-list"]', '[class*="Conversation"]'
            ];
            
            let targetEl = null;
            for (const s of selectors) {
                targetEl = await querySelectorDeep(s);
                if (targetEl && targetEl.offsetParent !== null) break;
            }

            if (!targetEl) targetEl = document.body;

            // 2. Focused Scroll Logic (NO scrollIntoView OR window.scrollTo TO AVOID FLASHING)
            function scrollTarget(el) {
                if (!el) return;
                try {
                    if (el.scrollHeight > el.clientHeight) {
                        el.scrollTop = el.scrollHeight + 1000;
                    }
                } catch(e) {}
            }

            // A. Scroll the target container specifically
            scrollTarget(targetEl);

            // B. Find last message item and ensure its parents are scrolled
            const lastMsg = await querySelectorDeep('.message:last-child, .chat-item:last-child, [class*="item"]:last-child, .conversation-item:last-child');
            if (lastMsg) {
                let curr = lastMsg.parentElement;
                while (curr && curr !== document.body) {
                    scrollTarget(curr);
                    curr = curr.parentElement || (curr.parentNode && curr.parentNode.host);
                }
            }

            // Minimal delay to let React render if needed, but no sudden window jumps
            await new Promise(r => setTimeout(r, 500)); 
            return { success: true };
        } catch(e) {
            return { success: false, error: e.message };
        }
    }
`;

/**
 * Reusable function to trigger the deep scroll logic in a target webview.
 */
export async function autoScrollToBottom(client: CdpClient): Promise<void> {
    await client.send('Runtime.evaluate', {
        expression: `(async function() { ${SCROLL_INJECTION_JS}; return await performDeepScroll(); })()`,
        awaitPromise: true,
        returnByValue: true
    });
}

/**
 * Captures a screenshot of the agent chat area using CDP.
 * Returns the screenshot Buffer and diagnostic metadata.
 */
export async function captureAgentScreenshot(port: number): Promise<{ buffer: Buffer, metadata: string }> {
    let raw;
    try {
        raw = await httpGet(`http://127.0.0.1:${port}/json`);
    } catch (e: any) {
        throw new Error(`Không kết nối được Port ${port}. Hãy chạy VS Code với --remote-debugging-port=${port}`);
    }

    const targets: CdpTarget[] = JSON.parse(raw);
    let candidates = targets.filter(t =>
        (t.type === 'page' || t.type === 'iframe' || t.type === 'webview') &&
        t.webSocketDebuggerUrl &&
        !t.url.includes('devtools://')
    );

    // ── ƯU TIÊN TARGET ĐÚNG ──
    // Ưu tiên các target có title chứa "antigravity-telegram-control" như user đã chỉ ra
    candidates.sort((a, b) => {
        const aMatch = a.title.toLowerCase().includes('antigravity-telegram-control') ? 1 : 0;
        const bMatch = b.title.toLowerCase().includes('antigravity-telegram-control') ? 1 : 0;
        return bMatch - aMatch;
    });

    let logs: string[] = [];

    for (const target of candidates) {
        try {
            const client = new CdpClient(target.webSocketDebuggerUrl!);
            await client.connect();

            // (Auto-scroll will be done after finding the chat area below to avoid flashing non-chat targets)

            const boxResult = await client.send('Runtime.evaluate', {
                expression: `
                    (async function() {
                        ${SCROLL_INJECTION_JS}
                        
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
                                // If it's just an input, try to find the container
                                if (s === '.chat-input' || s === '[contenteditable="true"]') {
                                     const container = targetEl.closest('#conversation, #chat, #cascade, [class*="Conversation"], [class*="chat-container"]');
                                     if (container) targetEl = container;
                                }
                                foundSelector = s;
                                break;
                            }
                        }

                        // VALIDATION: If no chat-related selector was found, this target likely isn't the chat UI.
                        if (!targetEl) return { error: "chat_elements_not_found" };

                        let captureEl = targetEl;
                        let captureType = "selector";
                        
                        // If we found a tiny element or the input only, fallback to largest scroller in this context
                        if (targetEl.offsetHeight < 200) {
                            const scrollers = Array.from(document.querySelectorAll('div'))
                                .filter(d => d.offsetHeight > 400 && d.offsetParent !== null)
                                .sort((a, b) => b.offsetHeight - a.offsetHeight);
                            if (scrollers.length > 0) {
                                captureEl = scrollers[0];
                                captureType = "largest-scroller";
                            }
                        }

                        const rect = captureEl.getBoundingClientRect();
                        return {
                            x: rect.x,
                            y: rect.y,
                            width: rect.width || document.documentElement.clientWidth,
                            height: rect.height || document.documentElement.clientHeight,
                            title: document.title,
                            url: window.location.href,
                            selector: foundSelector,
                            captureType: captureType
                        };
                    })()
                `,
                awaitPromise: true,
                returnByValue: true
            });

            const res = boxResult?.result?.value;
            if (res && !res.error) {
                // ── BẮT BUỘC CUỘN XUỐNG BÂY GIỜ VÌ ĐÃ XÁC ĐỊNH ĐÚNG KHUNG ──
                await autoScrollToBottom(client);

                const screenshotResult = await client.send('Page.captureScreenshot', {
                    format: 'jpeg',
                    quality: 90,
                    clip: {
                        x: res.x,
                        y: res.y,
                        width: res.width,
                        height: res.height,
                        scale: 1
                    }
                });

                client.close();
                if (screenshotResult && screenshotResult.data) {
                    const metadata = `Target: ${res.title}\\nSelector: ${res.selector}\\nType: ${res.captureType}\\nURL: ${res.url.substring(0, 50)}...`;
                    return {
                        buffer: Buffer.from(screenshotResult.data, 'base64'),
                        metadata: metadata
                    };
                }
            } else {
                logs.push(`${target.title}: ${res?.error || 'no_res'}`);
                client.close();
            }
        } catch (e: any) {
            logs.push(`${target.title}: ${e.message}`);
        }
    }

    throw new Error(`Không tìm thấy khung chat hiển thị để chụp. (Chi tiết: ${logs.join(', ')})`);
}

/**
 * Polls the Antigravity chat input UI to determine when the agent has finished generating.
 */
export async function waitForAgentResponse(port: number, timeoutMs = 450000): Promise<boolean> {
    const raw = await httpGet(`http://127.0.0.1:${port}/json`);
    const targets: CdpTarget[] = JSON.parse(raw);
    let candidates = targets.filter(t =>
        (t.type === 'page' || t.type === 'iframe' || t.type === 'webview') &&
        t.webSocketDebuggerUrl &&
        !t.url.includes('devtools://')
    );

    // ── ƯU TIÊN TARGET ĐÚNG ──
    candidates.sort((a, b) => {
        const aMatch = a.title.toLowerCase().includes('antigravity-telegram-control') ? 1 : 0;
        const bMatch = b.title.toLowerCase().includes('antigravity-telegram-control') ? 1 : 0;
        return bMatch - aMatch;
    });

    const startTime = Date.now();
    let consecutiveIdleCount = 0;

    while (Date.now() - startTime < timeoutMs) {
        let foundChatInThisLoop = false;
        let isIdleInThisLoop = false;
        let isGeneratingInThisLoop = false;

        for (const target of candidates) {
            try {
                const client = new CdpClient(target.webSocketDebuggerUrl!);
                await client.connect();

                const checkResult = await client.send('Runtime.evaluate', {
                    expression: `
                        (function() {
                            const stopIcon = document.querySelector("svg.lucide-square, [data-tooltip-id*='cancel'], [aria-label*='Stop'], [title*='Stop']");
                            const isGenerating = !!stopIcon;
                            const sendIcon = document.querySelector("svg.lucide-arrow-right, svg[class*='arrow-right'], svg[class*='send'], [aria-label*='Send'], [title*='Send']");
                            const editor = document.querySelector('[contenteditable="true"], textarea');
                            const isInputDisabled = editor ? (editor.getAttribute('contenteditable') === 'false' || editor.disabled) : false;

                            const isIdle = !!sendIcon && !isGenerating && !isInputDisabled;
                            const hasChat = !!document.querySelector('#conversation, #chat, #cascade, .chat-input, .interactive-input-editor');

                            return { hasChat, isGenerating, isIdle };
                        })()
                    `,
                    returnByValue: true
                });

                const val = checkResult?.result?.value;
                if (val && val.hasChat) {
                    foundChatInThisLoop = true;
                    if (val.isGenerating) isGeneratingInThisLoop = true;
                    if (val.isIdle && !val.isGenerating) isIdleInThisLoop = true;

                    // ── NẾU ĐÃ XONG, CUỘN XUỐNG LUÔN ──
                    if (isIdleInThisLoop && !isGeneratingInThisLoop) {
                        await autoScrollToBottom(client);
                    }

                    client.close();
                    break;
                }
                client.close();
            } catch (e: any) { }
        }

        if (foundChatInThisLoop) {
            if (isIdleInThisLoop && !isGeneratingInThisLoop) {
                consecutiveIdleCount++;
                if (consecutiveIdleCount >= 2) return true;
            } else {
                consecutiveIdleCount = 0;
            }
        }
        await new Promise(r => setTimeout(r, 2000));
    }
    return false;
}

/**
 * Stop the Antigravity agent if it is currently generating.
 */
export async function stopAgent(port: number): Promise<{ success: boolean, message?: string }> {
    const raw = await httpGet(`http://127.0.0.1:${port}/json`);
    const targets: CdpTarget[] = JSON.parse(raw);
    let candidates = targets.filter(t =>
        (t.type === 'page' || t.type === 'iframe' || t.type === 'webview') &&
        t.webSocketDebuggerUrl &&
        !t.url.includes('devtools://')
    );

    // Prioritize correct targets
    candidates.sort((a, b) => {
        const aMatch = a.title.toLowerCase().includes('antigravity-telegram-control') ? 1 : 0;
        const bMatch = b.title.toLowerCase().includes('antigravity-telegram-control') ? 1 : 0;
        return bMatch - aMatch;
    });

    for (const target of candidates) {
        try {
            const client = new CdpClient(target.webSocketDebuggerUrl!);
            await client.connect();

            const stopResult = await client.send('Runtime.evaluate', {
                expression: `
                    (function() {
                        const stopIcon = document.querySelector("svg.lucide-square, [data-tooltip-id*='cancel'], [aria-label*='Stop'], [title*='Stop']");
                        if (stopIcon) {
                            const button = stopIcon.closest('button');
                            if (button) {
                                button.click();
                                return { success: true };
                            }
                        }
                        return { success: false };
                    })()
                `,
                returnByValue: true
            });

            const val = stopResult?.result?.value;
            if (val && val.success) {
                client.close();
                return { success: true };
            }
            client.close();
        } catch (e: any) {
            console.warn(`[CDP] Error stopping agent in target ${target.title}:`, e.message);
        }
    }

    return { success: false, message: "Stop button not found or already stopped." };
}
