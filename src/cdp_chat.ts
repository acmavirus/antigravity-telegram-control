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

/**
 * Send a CDP command over WebSocket and wait for a response with matching id.
 */
function cdpSend(wsUrl: string, method: string, params: object = {}): Promise<any> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const msgId = 1;

        ws.on('open', () => {
            ws.send(JSON.stringify({ id: msgId, method, params }));
        });

        ws.on('message', (raw: Buffer | string) => {
            const msg = JSON.parse(raw.toString());
            if (msg.id === msgId) {
                ws.close();
                if (msg.error) {
                    reject(new Error(`CDP error: ${msg.error.message}`));
                } else {
                    resolve(msg.result);
                }
            }
        });

        ws.on('error', (err: Error) => { ws.close(); reject(err); });
        const timer = setTimeout(() => { ws.close(); reject(new Error('CDP timeout after 8s')); }, 8000);
        ws.on('close', () => clearTimeout(timer));
    });
}

/**
 * Find the best workbench target — prefer the project window (not Extension Development Host, not Launchpad).
 */
async function findWorkbenchTarget(port: number): Promise<CdpTarget> {
    const raw = await httpGet(`http://127.0.0.1:${port}/json`);
    const targets: CdpTarget[] = JSON.parse(raw);

    // Filter to page targets with workbench.html URL
    const pages = targets.filter(t =>
        t.type === 'page' &&
        t.url.includes('workbench.html') &&
        t.webSocketDebuggerUrl
    );

    if (pages.length === 0) {
        const all = targets.map(t => `${t.title} (${t.type})`).join(', ');
        throw new Error(`No workbench page found.\nAvailable targets: ${all}`);
    }

    // Prefer the non-development-host window
    const mainPage = pages.find(t => !t.title.includes('Extension Development Host')) ?? pages[0];
    return mainPage;
}

/**
 * Inject text into the Antigravity agent chat and submit.
 * Tries multiple selectors specific to Antigravity IDE.
 */
async function injectIntoChat(wsUrl: string, text: string): Promise<{ ok: boolean; method: string; error?: string }> {
    const escaped = text
        .replace(/\\/g, '\\\\')
        .replace(/`/g, '\\`')
        .replace(/\$/g, '\\$');

    // JS expression to inject — tries all known Antigravity/VS Code chat selectors
    const expression = `
(async () => {
    const text = \`${escaped}\`;

    // Helper: dispatch a native React/Monaco-friendly input event
    function setNativeValue(el, value) {
        try {
            const proto = Object.getPrototypeOf(el);
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (setter) setter.call(el, value);
            else el.value = value;
        } catch(e) { el.value = value; }
    }

    function triggerInput(el) {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function pressEnter(el) {
        ['keydown','keypress','keyup'].forEach(type => {
            el.dispatchEvent(new KeyboardEvent(type, {
                key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
            }));
        });
    }

    // ── Antigravity / VS Code Chat selectors (ordered by specificity) ────────
    const selectors = [
        // Antigravity Launchpad / Jetski agent chat
        '.jetski-chat-input textarea',
        '.jetski-input textarea',
        '.agent-chat-input textarea',
        '.aichat-input textarea',
        // VS Code built-in chat (Copilot, etc.)
        '.interactive-input-editor .inputarea',
        '.chat-input-editor .inputarea',
        // Generic Monaco inputarea in a chat-like container
        '.chat-widget .inputarea',
        '.interactive-session .inputarea',
        // Plain textarea fallbacks
        '.jetski-chat-input input[type=text]',
        '.chat-input input[type=text]',
    ];

    for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) continue;

        el.focus();

        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
            setNativeValue(el, text);
            triggerInput(el);
            await new Promise(r => setTimeout(r, 100));
            pressEnter(el);
            return { ok: true, method: sel };
        }

        // Monaco .inputarea (contenteditable-like hidden textarea)
        if (el.classList.contains('inputarea')) {
            setNativeValue(el, text);
            triggerInput(el);
            await new Promise(r => setTimeout(r, 150));
            pressEnter(el);
            return { ok: true, method: 'monaco:' + sel };
        }
    }

    // Dump all textareas/inputs for debugging
    const allInputs = [...document.querySelectorAll('textarea, input[type=text]')]
        .map(el => el.className + ' | placeholder=' + el.getAttribute('placeholder'))
        .slice(0, 10);

    return { ok: false, method: 'none', error: 'No selector matched. Found inputs: ' + JSON.stringify(allInputs) };
})()
`;

    const result = await cdpSend(wsUrl, 'Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true
    });

    if (result?.exceptionDetails) {
        const msg = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
        return { ok: false, method: 'exception', error: msg };
    }

    return result?.result?.value ?? { ok: false, method: 'no_result' };
}

/**
 * Main export — find the workbench window and inject the chat message.
 */
export async function sendViaCDP(text: string, port: number): Promise<void> {
    const target = await findWorkbenchTarget(port);

    if (!target.webSocketDebuggerUrl) {
        throw new Error('Target has no webSocketDebuggerUrl');
    }

    const result = await injectIntoChat(target.webSocketDebuggerUrl, text);

    if (!result.ok) {
        const debugInfo = result.error ? `\nDebug: ${result.error}` : '';
        throw new Error(`CDP: ô chat không tìm thấy (method=${result.method})${debugInfo}`);
    }
}
