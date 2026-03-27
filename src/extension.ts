import * as vscode from 'vscode';
import { Telegraf, Telegram } from 'telegraf';
import screenshot from 'screenshot-desktop';
import * as fs from 'fs';
import * as path from 'path';
import { getSettingsHtml } from './settings_view';
import { TelegramSettingsProvider } from './settings_provider';
import { sendViaCDP, waitForAgentResponse, captureAgentScreenshot, stopAgent } from './cdp_chat';
import { translations } from './i18n';
import * as os from 'os';

let bot: Telegraf | undefined;

function getLanguage(): string {
    return vscode.workspace.getConfiguration('antigravityTelegramControl').get<string>('language') ?? 'en';
}

function t(key: keyof typeof translations['en'], params: Record<string, string> = {}): string {
    const lang = getLanguage();
    const tranSet = translations[lang] || translations['en'];
    let text = tranSet[key] || translations['en'][key] || '';

    for (const [pk, pv] of Object.entries(params)) {
        text = text.replace(`{${pk}}`, pv);
    }
    return text;
}

const SLASH_COMMANDS = [
    { command: 'start', description: 'Start the bot and get your Chat ID' },
    { command: 'screenshot', description: 'Capture a screenshot of the Antigravity agent' },
    { command: 'help', description: 'Show available commands' },
    { command: 'cmd', description: 'Execute shell command /cmd <command>' },
    { command: 'ask', description: 'Send a message to the Antigravity agent chat' },
    { command: 'check', description: 'Manually check if the agent has finished responding' },
    { command: 'stop', description: 'Stop the agent if it is currently generating' },
    { command: 'alarm', description: 'Notify when Agent finishes responding (Long-poll)' }
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
    throw new Error(t('error', { msg: `CDP: ${cdpErrorMsg}\n\nNội dung đã copy vào clipboard — nhấn Ctrl+V trong chat.` }));
}

const activeAlarms = new Set<string>();

// ─── Start bot ────────────────────────────────────────────────────────────────

async function startBot(context: vscode.ExtensionContext): Promise<void> {
    const token = getToken();

    if (!token) {
        vscode.window.showErrorMessage(t('invalidToken'));
        return;
    }

    if (bot) {
        vscode.window.showWarningMessage(t('botAlreadyRunning'));
        return;
    }

    try {
        console.log('[Telegram] Starting bot...');
        bot = new Telegraf(token);
        const allowedChatId = getAllowedChatId();

        // ── Handlers ──
        bot.start((ctx) => ctx.reply(
            t('welcome').replace('${id}', ctx.chat.id.toString()),
            { parse_mode: 'Markdown' }
        ));

        bot.help((ctx) => ctx.reply(t('helpText')));

        bot.command('ask', async (ctx) => {
            if (allowedChatId && ctx.chat.id.toString() !== allowedChatId) { ctx.reply(t('unauthorized')); return; }
            const parts = ctx.message.text.split(' ');
            parts.shift(); // remove /ask
            const query = parts.join(' ').trim();
            if (!query) { ctx.reply(t('askUsage')); return; }
            try {
                await sendToAgentChat(query);
                ctx.reply(t('askSent', { query }), { parse_mode: 'Markdown' });

                // Spawn background task to check when generating completes
                vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: t('agentThinking'),
                    cancellable: false
                }, async () => {
                    try {
                        const port = getDebuggingPort();
                        const finished = await waitForAgentResponse(port);
                        if (finished) {
                            try {
                                const { buffer } = await captureAgentScreenshot(port);
                                await ctx.replyWithPhoto({ source: buffer }, { caption: t('agentFinished') });
                            } catch (screenshotErr: any) {
                                ctx.reply(t('screenshotError', { msg: screenshotErr.message }));
                            }
                        } else {
                            ctx.reply(t('timeoutError'));
                        }
                    } catch (e: any) {
                        ctx.reply(t('trackingError', { msg: e.message }));
                    }
                });

            } catch (e: any) {
                ctx.reply(t('error', { msg: e.message }));
            }
        });

        bot.command('check', async (ctx) => {
            if (allowedChatId && ctx.chat.id.toString() !== allowedChatId) { ctx.reply(t('unauthorized')); return; }
            const port = getDebuggingPort();
            await ctx.reply(t('checkingStatus'));

            try {
                const finished = await waitForAgentResponse(port, 10000); // Check once fairly quickly
                if (finished) {
                    const { buffer } = await captureAgentScreenshot(port);
                    await ctx.replyWithPhoto({ source: buffer }, { caption: t('agentFinished') });
                } else {
                    const { buffer } = await captureAgentScreenshot(port);
                    await ctx.replyWithPhoto({ source: buffer }, { caption: t('agentProcessing') });
                }
            } catch (e: any) {
                ctx.reply(t('error', { msg: e.message }));
            }
        });

        bot.command('stop', async (ctx) => {
            if (allowedChatId && ctx.chat.id.toString() !== allowedChatId) { ctx.reply(t('unauthorized')); return; }

            const port = getDebuggingPort();
            await ctx.reply(t('stoppingAgent'));

            try {
                const result = await stopAgent(port);
                if (result.success) {
                    await ctx.reply(t('agentStopped'));
                } else {
                    await ctx.reply(t('agentNotRunning'));
                }
            } catch (e: any) {
                ctx.reply(t('error', { msg: e.message }));
            }
        });

        bot.command('alarm', async (ctx) => {
            if (allowedChatId && ctx.chat.id.toString() !== allowedChatId) { ctx.reply(t('unauthorized')); return; }

            const chatId = ctx.chat.id.toString();
            if (activeAlarms.has(chatId)) {
                // Quietly ignore or could send a "Already monitoring" message
                return;
            }

            const port = getDebuggingPort();
            await ctx.reply(t('alarmStarted'));
            activeAlarms.add(chatId);

            try {
                let finished = false;
                const maxAttempts = 30; // ~20 minutes max
                for (let i = 0; i < maxAttempts; i++) {
                    finished = await waitForAgentResponse(port, 45000);
                    if (finished) break;

                    // Periodically updated status if i is high
                    if (i > 0 && i % 10 === 0) {
                        await ctx.reply(t('alarmMonitoring'));
                    }
                }

                if (finished) {
                    const { buffer } = await captureAgentScreenshot(port);
                    await ctx.replyWithPhoto({ source: buffer }, { caption: t('alarmFinished') });
                } else {
                    ctx.reply(t('timeoutError'));
                }
            } catch (e: any) {
                ctx.reply(t('error', { msg: e.message }));
            } finally {
                activeAlarms.delete(chatId);
            }
        });

        bot.command('cmd', async (ctx) => {
            if (allowedChatId && ctx.chat.id.toString() !== allowedChatId) { ctx.reply(t('unauthorized')); return; }
            const parts = ctx.message.text.split(' ');
            parts.shift(); // remove /cmd
            const cmd = parts.join(' ').trim();
            if (!cmd) { ctx.reply(t('cmdUsage')); return; }
            const terminal = vscode.window.activeTerminal ?? vscode.window.createTerminal('Telegram');
            terminal.show();
            terminal.sendText(cmd);
            ctx.reply(t('cmdExecuted', { cmd }));
        });

        bot.command('screenshot', async (ctx) => {
            if (allowedChatId && ctx.chat.id.toString() !== allowedChatId) { ctx.reply(t('unauthorized')); return; }
            try {
                await ctx.reply(t('capturingFrame'));
                const port = getDebuggingPort();
                const { buffer } = await captureAgentScreenshot(port);
                await ctx.replyWithPhoto({ source: buffer });
            } catch (e: any) {
                ctx.reply(t('error', { msg: e.message }));

                // Fallback to full screenshot if CDP fails
                try {
                    await ctx.reply(t('capturingFull'));
                    const imgPath = path.join(context.extensionPath, '_tmp_screenshot.jpg');
                    await screenshot({ filename: imgPath });
                    await ctx.replyWithPhoto({ source: fs.createReadStream(imgPath) });
                    fs.unlinkSync(imgPath);
                } catch (fallbackErr: any) {
                    ctx.reply(t('error', { msg: fallbackErr.message }));
                }
            }
        });

        // Catch-all text (excluding commands)
        bot.on('text', async (ctx) => {
            if (allowedChatId && ctx.chat.id.toString() !== allowedChatId) { return; }
            vscode.window.showInformationMessage(`[Telegram] ${ctx.message.text}`);
        });

        // ── Register slash commands (Background, don't block launch) ──
        registerSlashCommands(token, allowedChatId).catch(e => {
            console.warn('[Telegram] Slash command registration failed:', e.message);
        });

        // ── Launch ──
        bot.launch().then(() => {
            console.log('[Telegram] Bot polling started.');
        }).catch(err => {
            console.error('[Telegram] Bot launch failed:', err);
            vscode.window.showErrorMessage(t('error', { msg: err.message }));
            bot = undefined;
        });

        vscode.window.showInformationMessage(t('botStarted'));

    } catch (err: any) {
        bot = undefined;
        console.error('[Telegram] startBot fatal error:', err);
        vscode.window.showErrorMessage(t('error', { msg: err.message }));
    }
}

function stopBot(): void {
    if (!bot) { return; }
    bot.stop('SIGINT');
    bot = undefined;
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

            // Load paths and agent files
            const agentsMsPath = cfg.get<string>('agentsMsPath') || '';
            const geminiMdPath = cfg.get<string>('geminiMdPath') || '';
            let agentsMs = '';
            let geminiMd = '';

            try {
                const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                const msPath = agentsMsPath || (root ? path.join(root, 'agents.md') : undefined);
                const mdPath = geminiMdPath || (root ? path.join(root, 'gemini.md') : undefined);

                if (msPath && fs.existsSync(msPath)) agentsMs = fs.readFileSync(msPath, 'utf8');
                if (mdPath && fs.existsSync(mdPath)) geminiMd = fs.readFileSync(mdPath, 'utf8');
            } catch (e) { }

            panel.webview.html = getSettingsHtml(
                cfg.get('botToken') ?? '',
                cfg.get('allowedChatId') ?? '',
                cfg.get('debuggingPort') ?? 9222,
                cfg.get('language') ?? 'en',
                agentsMs,
                geminiMd,
                agentsMsPath,
                geminiMdPath
            );

            panel.webview.onDidReceiveMessage(async (msg) => {
                if (msg.command === 'save') {
                    await cfg.update('botToken', msg.token, vscode.ConfigurationTarget.Global);
                    await cfg.update('allowedChatId', msg.chatId, vscode.ConfigurationTarget.Global);
                    await cfg.update('debuggingPort', msg.debuggingPort ?? 9222, vscode.ConfigurationTarget.Global);
                    await cfg.update('language', msg.language ?? 'en', vscode.ConfigurationTarget.Global);

                    vscode.window.showInformationMessage(t('settingsSaved'));
                    stopBot();
                    startBot(context);
                }
                if (msg.command === 'saveAgents') {
                    try {
                        await cfg.update('agentsMsPath', msg.agentsMsPath, vscode.ConfigurationTarget.Global);
                        await cfg.update('geminiMdPath', msg.geminiMdPath, vscode.ConfigurationTarget.Global);

                        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                        const msPath = msg.agentsMsPath || (root ? path.join(root, 'agents.md') : undefined);
                        const mdPath = msg.geminiMdPath || (root ? path.join(root, 'gemini.md') : undefined);

                        if (msPath) fs.writeFileSync(msPath, msg.agentsMs, 'utf8');
                        if (mdPath) fs.writeFileSync(mdPath, msg.geminiMd, 'utf8');

                        vscode.window.showInformationMessage('Agent configuration updated!');
                    } catch (e: any) {
                        vscode.window.showErrorMessage(`Failed to save agents: ${e.message}`);
                    }
                }
                if (msg.command === 'autofind') {
                    try {
                        const home = os.homedir();
                        const geminiDir = path.join(home, '.gemini');
                        const results: any = { command: 'foundPaths' };

                        if (fs.existsSync(geminiDir)) {
                            const msPath = path.join(geminiDir, 'agents.md');
                            const mdPath = path.join(geminiDir, 'gemini.md');

                            if (fs.existsSync(msPath)) {
                                results.agentsMsPath = msPath;
                                results.agentsMs = fs.readFileSync(msPath, 'utf8');
                            }
                            if (fs.existsSync(mdPath)) {
                                results.geminiMdPath = mdPath;
                                results.geminiMd = fs.readFileSync(mdPath, 'utf8');
                            }

                            if (results.agentsMsPath || results.geminiMdPath) {
                                panel.webview.postMessage(results);
                                vscode.window.showInformationMessage('Found agent files in .gemini folder!');
                            } else {
                                vscode.window.showWarningMessage('No agent files found in .gemini folder.');
                            }
                        } else {
                            vscode.window.showWarningMessage('Could not find .gemini folder in home directory.');
                        }
                    } catch (e: any) {
                        vscode.window.showErrorMessage(`Search failed: ${e.message}`);
                    }
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
                vscode.window.showErrorMessage(t('invalidToken'));
                return;
            }

            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Registering Slash Commands on Telegram...",
                cancellable: false
            }, async () => {
                try {
                    await registerSlashCommands(token, chatId);
                    vscode.window.showInformationMessage('✅ Slash commands registered successfully!');
                    // Restart bot if token came from the UI but wasn't saved yet
                    if (manualToken) {
                        stopBot();
                        startBot(context);
                    }
                } catch (e: any) {
                    vscode.window.showErrorMessage(t('error', { msg: e.message }));
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
