import * as vscode from 'vscode';
import { Telegraf, Telegram } from 'telegraf';
import screenshot from 'screenshot-desktop';
import * as fs from 'fs';
import * as path from 'path';
import { getSettingsHtml } from './settings_view';
import { TelegramSettingsProvider } from './settings_provider';
import { sendViaCDP, waitForAgentResponse, captureAgentScreenshot, stopAgent, clickRetryButton } from './cdp_chat';
import { translations } from './i18n';
import * as os from 'os';
import { fetchQuotaInfo } from './quota_checker';
import { StatusBarManager } from './status_bar';

let bot: Telegraf | undefined;
let lockManager: BotLockManager | undefined;
let statusBarManager: StatusBarManager | undefined;

class BotLockManager {
    private lockFile: string;
    constructor(context: vscode.ExtensionContext) {
        this.lockFile = path.join(context.globalStorageUri.fsPath, 'bot.lock');
    }

    public acquireLock(): boolean {
        try {
            const dir = path.dirname(this.lockFile);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            const currentPid = process.pid;

            if (fs.existsSync(this.lockFile)) {
                const content = fs.readFileSync(this.lockFile, 'utf8').trim();
                const lockPid = parseInt(content, 10);
                if (!isNaN(lockPid)) {
                    if (this.isProcessRunning(lockPid)) {
                        return false;
                    }
                }
            }

            fs.writeFileSync(this.lockFile, currentPid.toString(), 'utf8');
            return true;
        } catch (e) {
            console.error('[Telegram] Failed to acquire lock:', e);
            return true; // fallback
        }
    }

    public releaseLock(): void {
        try {
            if (fs.existsSync(this.lockFile)) {
                const content = fs.readFileSync(this.lockFile, 'utf8').trim();
                const lockPid = parseInt(content, 10);
                if (lockPid === process.pid) {
                    fs.unlinkSync(this.lockFile);
                }
            }
        } catch (e) {
            console.error('[Telegram] Failed to release lock:', e);
        }
    }

    private isProcessRunning(pid: number): boolean {
        try {
            process.kill(pid, 0);
            return true;
        } catch (e: any) {
            return e.code === 'EPERM';
        }
    }
}

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
    { command: 'alarm', description: 'Notify when Agent finishes responding (Long-poll)' },
    { command: 'quota', description: 'Show current prompt credits and model quota limits' }
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

    if (chatId) {
        const numericChatId = Number(chatId);
        if (!isNaN(numericChatId)) {
            console.log(`[Telegram] Registering slash commands ONLY for chat ${chatId}...`);

            // Clear commands for default scopes so unauthorized users/groups don't see them
            try {
                await tg.deleteMyCommands({ scope: { type: 'default' } });
                await tg.deleteMyCommands({ scope: { type: 'all_private_chats' } });
                await tg.deleteMyCommands({ scope: { type: 'all_group_chats' } });
            } catch (e: any) {
                console.warn('[Telegram] Failed to clear general commands:', e.message);
            }

            // Register commands only for this specific chat
            await tg.setMyCommands(SLASH_COMMANDS, {
                scope: { type: 'chat', chat_id: numericChatId }
            });
            await tg.setMyCommands(SLASH_COMMANDS, {
                scope: { type: 'chat_administrators', chat_id: numericChatId }
            });
            console.log(`[Telegram] Commands registered for chat ${chatId}`);
        }
    } else {
        console.log('[Telegram] No allowedChatId specified. Registering slash commands for all users/chats...');
        // Set commands for all chat types
        await tg.setMyCommands(SLASH_COMMANDS, { scope: { type: 'default' } });
        // Also set for private chats
        await tg.setMyCommands(SLASH_COMMANDS, { scope: { type: 'all_private_chats' } });
        // Also set for group chats
        await tg.setMyCommands(SLASH_COMMANDS, { scope: { type: 'all_group_chats' } });
    }

    console.log('[Telegram] Slash commands registered successfully!');
}

async function deleteSlashCommands(token: string, chatId?: string): Promise<void> {
    const tg = new Telegram(token);
    console.log('[Telegram] Deleting slash commands...');

    // Delete general commands for all scopes
    await tg.deleteMyCommands({ scope: { type: 'default' } });
    await tg.deleteMyCommands({ scope: { type: 'all_private_chats' } });
    await tg.deleteMyCommands({ scope: { type: 'all_group_chats' } });

    // Also delete for specific chat if provided
    if (chatId) {
        const numericChatId = Number(chatId);
        if (!isNaN(numericChatId)) {
            try {
                await tg.deleteMyCommands({ scope: { type: 'chat', chat_id: numericChatId } });
                await tg.deleteMyCommands({ scope: { type: 'chat_administrators', chat_id: numericChatId } });
            } catch (e: any) {
                console.warn('[Telegram] Failed to delete specific chat commands:', e.message);
            }
        }
    }

    console.log('[Telegram] All slash commands deleted successfully!');
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
    try { 
        await vscode.commands.executeCommand('workbench.action.chat.open'); 
        // If we opened the chat sidebar, don't throw a fatal error, just warn
        console.warn('[Telegram] Falling back to clipboard for:', text);
        return; 
    } catch (_) { }

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

    if (lockManager && !lockManager.acquireLock()) {
        vscode.window.showWarningMessage(t('botAlreadyRunningInAnotherWindow'));
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

                const runCheck = async (attempt = 1) => {
                    const port = getDebuggingPort();
                    const autoRetry = vscode.workspace.getConfiguration('antigravityTelegramControl').get<boolean>('autoRetry') ?? false;

                    try {
                        const finished = await waitForAgentResponse(port);
                        if (finished) {
                            try {
                                const { buffer } = await captureAgentScreenshot(port);
                                await ctx.replyWithPhoto({ source: buffer }, { caption: t('agentFinished') });
                            } catch (screenshotErr: any) {
                                ctx.reply(t('screenshotError', { msg: screenshotErr.message }));
                            }
                        } else {
                            if (autoRetry && attempt < 3) {
                                // NEW LOGIC: Try to find and click the retry button ONLY
                                const retryResult = await clickRetryButton(port);
                                if (retryResult.success) {
                                    await ctx.reply(t('autoRetryMsg', { attempt: (attempt + 1).toString() }));
                                    await runCheck(attempt + 1);
                                } else {
                                    ctx.reply(t('timeoutError'));
                                }
                            } else {
                                ctx.reply(t('timeoutError'));
                            }
                        }
                    } catch (e: any) {
                        if (autoRetry && attempt < 3) {
                            // Try clicking retry even on error (maybe it's a transient error)
                            const retryResult = await clickRetryButton(port);
                            if (retryResult.success) {
                                await ctx.reply(t('autoRetryMsg', { attempt: (attempt + 1).toString() }));
                                await runCheck(attempt + 1);
                            } else {
                                ctx.reply(t('trackingError', { msg: e.message }));
                            }
                        } else {
                            ctx.reply(t('trackingError', { msg: e.message }));
                        }
                    }
                };

                // Spawn background task to check when generating completes
                vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: t('agentThinking'),
                    cancellable: false
                }, () => runCheck());

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

        bot.command('quota', async (ctx) => {
            if (allowedChatId && ctx.chat.id.toString() !== allowedChatId) { ctx.reply(t('unauthorized')); return; }

            const msg = await ctx.reply(t('findingProcess') || 'Checking quota...');
            try {
                const snapshot = await fetchQuotaInfo(getLanguage());

                let replyText = `${t('quotaTitle') || '📊 *Antigravity Quota Info*'}\n\n`;

                if (snapshot.prompt_credits) {
                    const pc = snapshot.prompt_credits;
                    const pcStr = (t('promptCredits') || 'Prompt Credits: {available}/{monthly} ({remaining}%)')
                        .replace('{available}', pc.available.toString())
                        .replace('{monthly}', pc.monthly.toString())
                        .replace('{remaining}', pc.remaining_percentage.toFixed(1));
                    replyText += `• ${pcStr}\n`;
                }

                if (snapshot.models && snapshot.models.length > 0) {
                    replyText += `\n*${t('modelsTitle') || 'AI Models:'}*\n`;
                    for (const model of snapshot.models) {
                        const pct = model.remaining_percentage !== undefined ? `${model.remaining_percentage.toFixed(1)}%` : 'N/A';
                        replyText += `• *${model.label}*: ${pct} (Reset: ${model.time_until_reset_formatted})\n`;
                    }
                } else {
                    replyText += `\n_${t('noQuotaInfo') || 'No active model quota information found.'}_\n`;
                }

                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    msg.message_id,
                    undefined,
                    replyText,
                    { parse_mode: 'Markdown' }
                );
            } catch (e: any) {
                const errMessage = e.message || '';
                let userFriendlyErr = '';
                if (errMessage.toLowerCase().includes('process not found')) {
                    userFriendlyErr = t('noProcessFound') || '❌ Antigravity language server is not running.';
                } else {
                    userFriendlyErr = (t('fetchError') || '❌ Failed to fetch quota: {msg}').replace('{msg}', errMessage);
                }

                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    msg.message_id,
                    undefined,
                    userFriendlyErr
                );
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
            if (lockManager) {
                lockManager.releaseLock();
            }
        });

        vscode.window.showInformationMessage(t('botStarted'));

    } catch (err: any) {
        bot = undefined;
        if (lockManager) {
            lockManager.releaseLock();
        }
        console.error('[Telegram] startBot fatal error:', err);
        vscode.window.showErrorMessage(t('error', { msg: err.message }));
    }
}

function stopBot(): void {
    if (!bot) { return; }
    try {
        bot.stop('SIGINT');
    } catch (e) {
        console.error('[Telegram] Error stopping bot:', e);
    }
    bot = undefined;
    if (lockManager) {
        lockManager.releaseLock();
    }
}

// ─── Activate ─────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
    lockManager = new BotLockManager(context);
    statusBarManager = new StatusBarManager(context);

    // Sidebar settings panel
    const provider = new TelegramSettingsProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(TelegramSettingsProvider.viewType, provider)
    );

    // Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-telegram-control.startBot', () => startBot(context)),
        vscode.commands.registerCommand('antigravity-telegram-control.stopBot', stopBot),

        vscode.commands.registerCommand('antigravity-telegram-control.refreshQuota', async () => {
            if (statusBarManager) {
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: getLanguage() === 'vi' ? 'Đang cập nhật hạn mức...' : 'Updating quota status...',
                    cancellable: false
                }, async () => {
                    await statusBarManager!.update();
                });
            }
        }),

        vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (e.affectsConfiguration('antigravityTelegramControl.showStatusBar') ||
                e.affectsConfiguration('antigravityTelegramControl.statusBarUpdateInterval') ||
                e.affectsConfiguration('antigravityTelegramControl.language')) {
                if (statusBarManager) {
                    statusBarManager.startTimer();
                    await statusBarManager.update();
                }
            }
        }),

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
                geminiMdPath,
                cfg.get('autoRetry') ?? false
            );

            panel.webview.onDidReceiveMessage(async (msg) => {
                if (msg.command === 'save') {
                    await cfg.update('botToken', msg.token, vscode.ConfigurationTarget.Global);
                    await cfg.update('allowedChatId', msg.chatId, vscode.ConfigurationTarget.Global);
                    await cfg.update('debuggingPort', msg.debuggingPort ?? 9222, vscode.ConfigurationTarget.Global);
                    await cfg.update('language', msg.language ?? 'en', vscode.ConfigurationTarget.Global);

                    vscode.window.showInformationMessage(t('settingsSaved'));
                    stopBot();
                    setTimeout(() => {
                        startBot(context);
                    }, 500);
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
                if (msg.command === 'saveAuto') {
                    try {
                        await cfg.update('autoRetry', msg.autoRetry, vscode.ConfigurationTarget.Global);
                        vscode.window.showInformationMessage('Automation settings updated!');
                    } catch (e: any) {
                        vscode.window.showErrorMessage(`Failed to save automation settings: ${e.message}`);
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
                if (msg.command === 'deleteCommands') {
                    const tokenToUse = msg.token || cfg.get('botToken') || '';
                    const chatIdToUse = cfg.get('allowedChatId') || '';
                    vscode.commands.executeCommand('antigravity-telegram-control.deleteCommands', tokenToUse, chatIdToUse);
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
                        setTimeout(() => {
                            startBot(context);
                        }, 500);
                    }
                } catch (e: any) {
                    vscode.window.showErrorMessage(t('error', { msg: e.message }));
                }
            });
        }),

        vscode.commands.registerCommand('antigravity-telegram-control.deleteCommands', async (manualToken?: string, manualChatId?: string) => {
            const token = manualToken || getToken();
            const chatId = manualChatId || getAllowedChatId();
            if (!token) {
                vscode.window.showErrorMessage(t('invalidToken'));
                return;
            }

            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Deleting Slash Commands on Telegram...",
                cancellable: false
            }, async () => {
                try {
                    await deleteSlashCommands(token, chatId);
                    vscode.window.showInformationMessage('✅ All slash commands deleted successfully!');
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
    lockManager?.releaseLock();
    if (statusBarManager) {
        statusBarManager.dispose();
    }
}
