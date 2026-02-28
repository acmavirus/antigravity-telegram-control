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
                        const editors = [...document.querySelectorAll('#conversation [contenteditable="true"], #chat [contenteditable="true"], #cascade [contenteditable="true"], .chat-input [contenteditable="true"], .interactive-input-editor [contenteditable="true"], textarea')]
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
 * Polls the Antigravity chat input UI to determine when the agent has finished generating.
 * It does this by checking if the "stop" square button turns back into the "send" right arrow.
 */
export async function waitForAgentResponse(port: number, timeoutMs = 300000): Promise<boolean> {
    const raw = await httpGet(`http://127.0.0.1:${port}/json`);
    const targets: CdpTarget[] = JSON.parse(raw);

    const candidates = targets.filter(t =>
        (t.type === 'page' || t.type === 'iframe' || t.type === 'webview') &&
        t.webSocketDebuggerUrl &&
        !t.url.includes('devtools://')
    );

    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
        for (const target of candidates) {
            try {
                const client = new CdpClient(target.webSocketDebuggerUrl!);
                await client.connect();

                const checkResult = await client.send('Runtime.evaluate', {
                    expression: `
                        (function() {
                            // Check for generating state (stop button)
                            const isGenerating = !!document.querySelector("svg.lucide-square, [data-tooltip-id='input-send-button-cancel-tooltip']");
                            
                            // Check for idle state (send arrow)
                            const isIdle = !!document.querySelector("svg.lucide-arrow-right, svg[class*='arrow-right'], svg[class*='send']");
                            
                            // Check if the chat input area even exists here
                            const hasChat = !!document.querySelector('#conversation, #chat, #cascade, .chat-input, .interactive-input-editor');

                            return { hasChat, isGenerating, isIdle };
                        })()
                    `,
                    returnByValue: true
                });

                client.close();

                const val = checkResult?.result?.value;
                if (val && val.hasChat) {
                    // If it's no longer generating and is idle, we are done!
                    if (!val.isGenerating && val.isIdle) {
                        return true;
                    }
                    // If it has chat but is still generating, wait more.
                    break;
                }
            } catch (e: any) {
                // Ignore connection errors during polling
            }
        }

        // Wait 2 seconds before checking again
        await new Promise(r => setTimeout(r, 2000));
    }

    return false; // Timed out
}
