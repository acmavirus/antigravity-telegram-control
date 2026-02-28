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
    { command: 'ask', description: 'Send a message to the Antigravity agent chat' },
    { command: 'check', description: 'Manually check if the agent has finished responding' }
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getToken(): string | undefined {
    return vscode.workspace.getConfiguration('antigravityTelegramControl').get<string>('botToken') || undefined;
}

function getAllowedChatId(): string | undefined {
    return vscode.workspace.getConfiguration('antigravityTelegramControl').get<string>('allowedChatId') || undefined;
}

async function registerSlashCommands(token: string, chatId?: string): Promise<void> {
    const tg = new Telegram(token);
    console.log('[Telegram] Registering slash commands...', SLASH_COMMANDS.map(c => c.command));

    // Set commands for all chat types
    await tg.setMyCommands(SLASH_COMMANDS, { scope: { type: 'default' } });
    // Also set for private chats
    await tg.setMyCommands(SLASH_COMMANDS, { scope: { type: 'all_private_chats' } });
    // Also set for group chats
    await tg.setMyCommands(SLASH_COMMANDS, { scope: { type: 'all_group_chats' } });

    // If a specific chat ID is provided, register for that specific chat
    if (chatId) {
        const numericChatId = Number(chatId);
        if (!isNaN(numericChatId)) {
            await tg.setMyCommands(SLASH_COMMANDS, {
                scope: { type: 'chat', chat_id: numericChatId }
            });
            await tg.setMyCommands(SLASH_COMMANDS, {
                scope: { type: 'chat_administrators', chat_id: numericChatId }
            });
            console.log(`[Telegram] Commands registered for chat ${chatId}`);
        }
    }

    console.log('[Telegram] Slash commands registered successfully!');
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
            '/check – Kiểm tra lại trạng thái hoàn tất của Agent\n' +
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
                    try {
                        const port = getDebuggingPort();
                        const finished = await waitForAgentResponse(port);
                        if (finished) {
                            try {
                                const buffer = await captureAgentScreenshot(port);
                                await ctx.replyWithPhoto({ source: buffer }, { caption: `✅ Agent đã trả lời xong!` });
                            } catch (screenshotErr: any) {
                                ctx.reply(`✅ Agent đã trả lời xong!\n(Không thể chụp ảnh: ${screenshotErr.message})`);
                            }
                        } else {
                            ctx.reply(`⚠️ Hết thời gian chờ Agent trả lời.`);
                        }
                    } catch (e: any) {
                        ctx.reply(`❌ Lỗi theo dõi Agent: ${e.message}`);
                    }
                });

            } catch (e: any) {
                ctx.reply('Lỗi: ' + e.message);
            }
        });

        bot.command('check', async (ctx) => {
            if (allowedChatId && ctx.chat.id.toString() !== allowedChatId) { ctx.reply('Unauthorized.'); return; }
            const port = getDebuggingPort();
            await ctx.reply('🔍 Đang kiểm tra lại trạng thái Agent...');

            try {
                const finished = await waitForAgentResponse(port, 10000); // Check once fairly quickly
                if (finished) {
                    const buffer = await captureAgentScreenshot(port);
                    await ctx.replyWithPhoto({ source: buffer }, { caption: `✅ Agent đã hoàn tất!` });
                } else {
                    const buffer = await captureAgentScreenshot(port);
                    await ctx.replyWithPhoto({ source: buffer }, { caption: `⏳ Agent vẫn đang xử lý hoặc chưa tìm thấy nút gửi.` });
                }
            } catch (e: any) {
                ctx.reply('Lỗi khi kiểm tra: ' + e.message);
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
            await registerSlashCommands(token, allowedChatId);
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
            panel.webview.html = getSettingsHtml(cfg.get('botToken') ?? '', cfg.get('allowedChatId') ?? '', cfg.get('debuggingPort') ?? 9222);
            panel.webview.onDidReceiveMessage(async (msg) => {
                if (msg.command === 'save') {
                    await cfg.update('botToken', msg.token, vscode.ConfigurationTarget.Global);
                    await cfg.update('allowedChatId', msg.chatId, vscode.ConfigurationTarget.Global);
                    await cfg.update('debuggingPort', msg.debuggingPort ?? 9222, vscode.ConfigurationTarget.Global);
                    vscode.window.showInformationMessage('Settings saved.');
                    stopBot();
                    startBot(context);
                }
                if (msg.command === 'registerCommands') {
                    const tokenToUse = msg.token || cfg.get('botToken') || '';
                    const chatIdToUse = cfg.get('allowedChatId') || '';
                    vscode.commands.executeCommand('antigravity-telegram-control.registerCommands', tokenToUse, chatIdToUse);
                }
            }, undefined, context.subscriptions);
        }),

        vscode.commands.registerCommand('antigravity-telegram-control.registerCommands', async (manualToken?: string, manualChatId?: string) => {
            const token = manualToken || getToken();
            const chatId = manualChatId || getAllowedChatId();
            if (!token) {
                vscode.window.showErrorMessage('Bot Token chưa được cài đặt! Hãy nhập token và nhấn Save trước.');
                return;
            }

            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Registering Slash Commands on Telegram...",
                cancellable: false
            }, async () => {
                try {
                    await registerSlashCommands(token, chatId);
                    vscode.window.showInformationMessage('✅ Slash commands đã được đăng ký thành công trên Telegram!');
                    // Restart bot if token came from the UI but wasn't saved yet
                    if (manualToken) {
                        stopBot();
                        startBot(context);
                    }
                } catch (e: any) {
                    vscode.window.showErrorMessage('Đăng ký thất bại: ' + e.message);
                }
            });
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
