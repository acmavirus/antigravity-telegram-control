import * as vscode from 'vscode';
import { getSettingsHtml } from './settings_view';

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
            switch (data.command) {
                case 'save':
                    const config = vscode.workspace.getConfiguration('antigravityTelegramControl');
                    await config.update('botToken', data.token, vscode.ConfigurationTarget.Global);
                    await config.update('allowedChatId', data.chatId, vscode.ConfigurationTarget.Global);
                    await config.update('debuggingPort', data.debuggingPort ?? 9222, vscode.ConfigurationTarget.Global);
                    vscode.window.showInformationMessage('Telegram Settings Saved!');

                    // Restart bot
                    vscode.commands.executeCommand('antigravity-telegram-control.stopBot');
                    vscode.commands.executeCommand('antigravity-telegram-control.startBot');
                    break;

                case 'registerCommands':
                    vscode.commands.executeCommand('antigravity-telegram-control.registerCommands');
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
            this._view.webview.html = getSettingsHtml(token, chatId, port);
        }
    }
}
