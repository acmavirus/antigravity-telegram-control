import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getSettingsHtml } from './settings_view';

import * as os from 'os';

export class TelegramSettingsProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'telegram-control-welcome';

    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
    ) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };

        this.updateHtml();

        webviewView.webview.onDidReceiveMessage(async (data) => {
            const config = vscode.workspace.getConfiguration('antigravityTelegramControl');
            switch (data.command) {
                case 'save':
                    await config.update('botToken', data.token, vscode.ConfigurationTarget.Global);
                    await config.update('allowedChatId', data.chatId, vscode.ConfigurationTarget.Global);
                    await config.update('debuggingPort', data.debuggingPort ?? 9222, vscode.ConfigurationTarget.Global);
                    await config.update('language', data.language || 'en', vscode.ConfigurationTarget.Global);
                    vscode.window.showInformationMessage('Telegram Settings Saved!');

                    // Restart bot
                    vscode.commands.executeCommand('antigravity-telegram-control.stopBot');
                    vscode.commands.executeCommand('antigravity-telegram-control.startBot');
                    break;

                case 'saveAgents':
                    try {
                        await config.update('agentsMsPath', data.agentsMsPath, vscode.ConfigurationTarget.Global);
                        await config.update('geminiMdPath', data.geminiMdPath, vscode.ConfigurationTarget.Global);

                        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                        const msPath = data.agentsMsPath || (root ? path.join(root, 'agents.md') : undefined);
                        const mdPath = data.geminiMdPath || (root ? path.join(root, 'gemini.md') : undefined);

                        if (msPath) fs.writeFileSync(msPath, data.agentsMs, 'utf8');
                        if (mdPath) fs.writeFileSync(mdPath, data.geminiMd, 'utf8');

                        vscode.window.showInformationMessage('Agent configuration updated!');
                    } catch (e: any) {
                        vscode.window.showErrorMessage(`Failed to save agents: ${e.message}`);
                    }
                    break;

                case 'autofind':
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
                                webviewView.webview.postMessage(results);
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
                    break;

                case 'registerCommands':
                    vscode.commands.executeCommand('antigravity-telegram-control.registerCommands', data.token, data.chatId);
                    break;
            }
        });
    }

    public updateHtml() {
        if (this._view) {
            const config = vscode.workspace.getConfiguration('antigravityTelegramControl');
            const token = config.get<string>('botToken') || '';
            const chatId = config.get<string>('allowedChatId') || '';
            const port = config.get<number>('debuggingPort') ?? 9222;
            const language = config.get<string>('language') || 'en';
            const agentsMsPath = config.get<string>('agentsMsPath') || '';
            const geminiMdPath = config.get<string>('geminiMdPath') || '';

            let agentsMs = '';
            let geminiMd = '';

            try {
                const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                const msPath = agentsMsPath || (root ? path.join(root, 'agents.md') : undefined);
                const mdPath = geminiMdPath || (root ? path.join(root, 'gemini.md') : undefined);

                if (msPath && fs.existsSync(msPath)) agentsMs = fs.readFileSync(msPath, 'utf8');
                if (mdPath && fs.existsSync(mdPath)) geminiMd = fs.readFileSync(mdPath, 'utf8');
            } catch (e) {
                console.error('Error reading agent files:', e);
            }

            this._view.webview.html = getSettingsHtml(token, chatId, port, language, agentsMs, geminiMd, agentsMsPath, geminiMdPath);
        }
    }
}


