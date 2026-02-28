import * as vscode from 'vscode';
import { Telegraf, Telegram } from 'telegraf';
import screenshot from 'screenshot-desktop';
import * as fs from 'fs';
import * as path from 'path';
import { getSettingsHtml } from './settings_view';
import { TelegramSettingsProvider } from './settings_provider';
import { sendViaCDP, waitForAgentResponse, captureAgentScreenshot } from './cdp_chat';

let bot: Telegraf | undefined;

const SLASH_COMMANDS = [
    { command: 'start', description: 'Start the bot and get your Chat ID' },
    { command: 'screenshot', description: 'Capture a screenshot of the Antigravity agent' },
    { command: 'help', description: 'Show available commands' },
    { command: 'cmd', description: 'Execute shell command /cmd <command>' },
    { command: 'ask', description: 'Send a message to the Antigravity agent chat' }
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getToken(): string | undefined {
    return vscode.workspace.getConfiguration('antigravityTelegramControl').get<string>('botToken') || undefined;
}

function getAllowedChatId(): string | undefined {
    return vscode.workspace.getConfiguration('antigravityTelegramControl').get<string>('allowedChatId') || undefined;
}

async function registerSlashCommands(token: string): Promise<void> {
    const tg = new Telegram(token);
    await tg.setMyCommands(SLASH_COMMANDS);
}

function getDebuggingPort(): number {
    return vscode.workspace.getConfiguration('antigravityTelegramControl').get<number>('debuggingPort') ?? 9222;
}

async function sendToAgentChat(text: string): Promise<void> {
    const port = getDebuggingPort();
    let cdpErrorMsg = '';

    // ── Strategy 1: CDP via remote debugging port ────────────────────────────
    try {
        await sendViaCDP(text, port);
        return;
    } catch (cdpErr: any) {
        cdpErrorMsg = cdpErr.message;
        console.warn('[Telegram] CDP failed:', cdpErr.message);
    }

    // ── Strategy 2: workbench.action.chat.open (built-in VS Code chat) ───────
    try {
        await vscode.commands.executeCommand('workbench.action.chat.open', {
            query: text,
            isPartialQuery: false
        });
        return;
    } catch (_) { /* command not available */ }

    // ── Strategy 3: clipboard fallback ───────────────────────────────────────
    await vscode.env.clipboard.writeText(text);
    try { await vscode.commands.executeCommand('workbench.action.chat.open'); } catch (_) { }
    throw new Error(`CDP: ${cdpErrorMsg}\n\nNội dung đã copy vào clipboard — nhấn Ctrl+V trong chat.`);
}

// ─── Start bot ────────────────────────────────────────────────────────────────

async function startBot(context: vscode.ExtensionContext): Promise<void> {
    const token = getToken();

    if (!token) {
        vscode.window.showErrorMessage('Telegram: Bot Token chưa được cài đặt.');
        return;
    }

    if (bot) {
        vscode.window.showWarningMessage('Telegram: Bot đang chạy rồi!');
        return;
    }

    try {
        bot = new Telegraf(token);
        const allowedChatId = getAllowedChatId();

        // ── Handlers ──
        bot.start((ctx) => ctx.reply(
            `Bot đang hoạt động! Chat ID của bạn: \`${ctx.chat.id}\`\n\nGõ /help để xem lệnh.`,
            { parse_mode: 'Markdown' }
        ));

        bot.help((ctx) => ctx.reply(
            '/start – Lấy Chat ID\n' +
            '/screenshot – Chụp khung chat agent\n' +
            '/ask <nội dung> – Gửi câu hỏi tới Antigravity Agent\n' +
            '/cmd <lệnh> – Chạy lệnh trong terminal\n' +
            '/help – Hiển thị trợ giúp'
        ));

        bot.command('ask', async (ctx) => {
            if (allowedChatId && ctx.chat.id.toString() !== allowedChatId) { ctx.reply('Unauthorized.'); return; }
            const parts = ctx.message.text.split(' ');
            parts.shift(); // remove /ask
            const query = parts.join(' ').trim();
            if (!query) { ctx.reply('Usage: /ask <nội dung cần hỏi agent>'); return; }
            try {
                await sendToAgentChat(query);
                ctx.reply(`✅ Đã gửi tới Antigravity Agent:\n"${query}"\n\n_Đang chờ agent trả lời..._`, { parse_mode: 'Markdown' });

                // Spawn background task to check when generating completes
                vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: "Antigravity Agent is thinking...",
                    cancellable: false
                }, async () => {
                    const port = getDebuggingPort();
                    const finished = await waitForAgentResponse(port);
                    if (finished) {
                        ctx.reply(`✅ Agent đã trả lời xong!`);
                    } else {
                        ctx.reply(`⚠️ Hết thời gian chờ chờ Agent trả lời.`);
                    }
                });

            } catch (e: any) {
                ctx.reply('Lỗi: ' + e.message);
            }
        });

        bot.command('cmd', async (ctx) => {
            if (allowedChatId && ctx.chat.id.toString() !== allowedChatId) { ctx.reply('Unauthorized.'); return; }
            const parts = ctx.message.text.split(' ');
            parts.shift(); // remove /cmd
            const cmd = parts.join(' ').trim();
            if (!cmd) { ctx.reply('Usage: /cmd <lệnh>'); return; }
            const terminal = vscode.window.activeTerminal ?? vscode.window.createTerminal('Telegram');
            terminal.show();
            terminal.sendText(cmd);
            ctx.reply(`✅ Đã chạy: ${cmd}`);
        });

        bot.command('screenshot', async (ctx) => {
            if (allowedChatId && ctx.chat.id.toString() !== allowedChatId) { ctx.reply('Unauthorized.'); return; }
            try {
                await ctx.reply('Đang chụp khung agent...');
                const port = getDebuggingPort();
                const buffer = await captureAgentScreenshot(port);
                await ctx.replyWithPhoto({ source: buffer });
            } catch (e: any) {
                ctx.reply('Lỗi chụp ảnh agent: ' + e.message);

                // Fallback to full screenshot if CDP fails
                try {
                    await ctx.reply('Đang thử chụp toàn màn hình...');
                    const imgPath = path.join(context.extensionPath, '_tmp_screenshot.jpg');
                    await screenshot({ filename: imgPath });
                    await ctx.replyWithPhoto({ source: fs.createReadStream(imgPath) });
                    fs.unlinkSync(imgPath);
                } catch (fallbackErr: any) {
                    ctx.reply('Lỗi chụp toàn màn hình: ' + fallbackErr.message);
                }
            }
        });

        // Catch-all text (excluding commands)
        bot.on('text', async (ctx) => {
            if (allowedChatId && ctx.chat.id.toString() !== allowedChatId) { return; }
            vscode.window.showInformationMessage(`[Telegram] ${ctx.message.text}`);
        });

        // ── Register slash commands (BEFORE launch, using static Telegram class) ──
        try {
            await registerSlashCommands(token);
        } catch (e: any) {
            console.warn('setMyCommands failed:', e.message);
        }

        // ── Launch (intentionally NOT awaited — blocks forever) ──
        bot.launch();
        vscode.window.showInformationMessage('✅ Telegram Bot đã khởi động!');

    } catch (err: any) {
        bot = undefined;
        vscode.window.showErrorMessage('Không thể khởi động bot: ' + err.message);
    }
}

function stopBot(): void {
    if (!bot) { vscode.window.showWarningMessage('Bot chưa chạy.'); return; }
    bot.stop('SIGINT');
    bot = undefined;
    vscode.window.showInformationMessage('Telegram Bot đã dừng.');
}

// ─── Activate ─────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {

    // Sidebar settings panel
    const provider = new TelegramSettingsProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(TelegramSettingsProvider.viewType, provider)
    );

    // Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-telegram-control.startBot', () => startBot(context)),
        vscode.commands.registerCommand('antigravity-telegram-control.stopBot', stopBot),

        vscode.commands.registerCommand('antigravity-telegram-control.openSettings', () => {
            const panel = vscode.window.createWebviewPanel(
                'telegramSettings', 'Telegram Control Settings', vscode.ViewColumn.One,
                { enableScripts: true }
            );
            const cfg = vscode.workspace.getConfiguration('antigravityTelegramControl');
            panel.webview.html = getSettingsHtml(cfg.get('botToken') ?? '', cfg.get('allowedChatId') ?? '');
            panel.webview.onDidReceiveMessage(async (msg) => {
                if (msg.command === 'save') {
                    await cfg.update('botToken', msg.token, vscode.ConfigurationTarget.Global);
                    await cfg.update('allowedChatId', msg.chatId, vscode.ConfigurationTarget.Global);
                    vscode.window.showInformationMessage('Settings saved.');
                    stopBot();
                    startBot(context);
                }
                if (msg.command === 'registerCommands') {
                    vscode.commands.executeCommand('antigravity-telegram-control.registerCommands');
                }
            }, undefined, context.subscriptions);
        }),

        vscode.commands.registerCommand('antigravity-telegram-control.registerCommands', async () => {
            const token = getToken();
            if (!token) { vscode.window.showErrorMessage('Bot Token chưa được cài đặt!'); return; }
            try {
                await registerSlashCommands(token);
                vscode.window.showInformationMessage('✅ Slash commands đã được đăng ký trên Telegram!');
            } catch (e: any) {
                vscode.window.showErrorMessage('Đăng ký thất bại: ' + e.message);
            }
        })
    );

    // ── Auto-start if token already exists ──
    if (getToken()) {
        startBot(context);
    }
}

export function deactivate() {
    bot?.stop('SIGINT');
}
