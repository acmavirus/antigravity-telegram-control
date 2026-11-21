import * as vscode from 'vscode';
import { fetchQuotaInfo, QuotaSnapshot } from './quota_checker';
import { t } from './i18n';

export class StatusBarManager implements vscode.Disposable {
    private item: vscode.StatusBarItem;
    private timer: NodeJS.Timeout | undefined;

    constructor(context: vscode.ExtensionContext) {
        this.item = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.item.command = 'antigravity-telegram-control.refreshQuota';
        context.subscriptions.push(this);

        this.startTimer();
        this.update();
    }

    public startTimer() {
        if (this.timer) {
            clearInterval(this.timer);
        }
        const intervalSec = vscode.workspace.getConfiguration('antigravityTelegramControl').get<number>('statusBarUpdateInterval') ?? 60;
        this.timer = setInterval(() => this.update(), intervalSec * 1000);
    }

    public stopTimer() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }

    public async update(): Promise<void> {
        const show = vscode.workspace.getConfiguration('antigravityTelegramControl').get<boolean>('showStatusBar') ?? true;
        if (!show) {
            this.item.hide();
            return;
        }

        const lang = vscode.workspace.getConfiguration('antigravityTelegramControl').get<string>('language') ?? 'en';

        try {
            const snapshot = await fetchQuotaInfo(lang);
            this.render(snapshot);
        } catch (e: any) {
            const errMessage = e.message || '';
            if (errMessage.toLowerCase().includes('process not found') || errMessage.toLowerCase().includes('not found')) {
                this.item.text = `$(circle-slash) Antigravity`;
                this.item.tooltip = t('noProcessFound');
            } else {
                this.item.text = `$(warning) Antigravity`;
                this.item.tooltip = t('fetchError', { msg: errMessage });
            }
            this.item.show();
        }
    }

    private render(snapshot: QuotaSnapshot): void {
        const parts: string[] = [];
        const tooltipRows: string[] = [];
        const lang = vscode.workspace.getConfiguration('antigravityTelegramControl').get<string>('language') ?? 'en';

        // Add table header for markdown with extra spacing
        tooltipRows.push(`| &nbsp;&nbsp;&nbsp;&nbsp; **${t('quotaTypeLabel')}** &nbsp;&nbsp;&nbsp;&nbsp; | &nbsp;&nbsp;&nbsp;&nbsp; **${t('statusLabel')}** &nbsp;&nbsp;&nbsp;&nbsp; | &nbsp;&nbsp;&nbsp;&nbsp; **${t('resetTimeLabel')}** &nbsp;&nbsp;&nbsp;&nbsp; |`);
        tooltipRows.push('|:---|---:|:---|');

        // 2. Flow Credits (if available)
        if (snapshot.flow_credits) {
            const fc = snapshot.flow_credits;
            const pct = Math.round(fc.remaining_percentage);
            const statusEmoji = this.getStatusEmoji(pct);

            // For status bar text
            parts.push(`${statusEmoji} Fls ${pct}%`);

            // For tooltip table
            const label = t('flowCreditsLabel');
            tooltipRows.push(`| <br>&nbsp;&nbsp; ${statusEmoji} ${label} &nbsp;&nbsp;<br>&nbsp; | <br>&nbsp;&nbsp; **${fc.available.toLocaleString()}** / ${fc.monthly.toLocaleString()} (${pct}%) &nbsp;&nbsp;<br>&nbsp; | <br>&nbsp;&nbsp; -- &nbsp;&nbsp;<br>&nbsp; |`);
        }

        // 3. Prompt Credits (if available)
        if (snapshot.prompt_credits) {
            const pc = snapshot.prompt_credits;
            const pct = Math.round(pc.remaining_percentage);
            const statusEmoji = this.getStatusEmoji(pct);

            // For status bar text
            parts.push(`💳 ${this.formatCredits(pc.available)}`);

            // For tooltip table
            const label = t('promptCreditsLabel');
            tooltipRows.push(`| <br>&nbsp;&nbsp; 💳 ${label} &nbsp;&nbsp;<br>&nbsp; | <br>&nbsp;&nbsp; **${pc.available.toLocaleString()}** / ${pc.monthly.toLocaleString()} (${pct}%) &nbsp;&nbsp;<br>&nbsp; | <br>&nbsp;&nbsp; -- &nbsp;&nbsp;<br>&nbsp; |`);
        }

        // 4. Models Quota Groups
        if (snapshot.model_groups && snapshot.model_groups.length > 0) {
            snapshot.model_groups.forEach(group => {
                const fiveHourItem = group.limits.find(l => l.name_key === 'fiveHourLimit');
                const weeklyItem = group.limits.find(l => l.name_key === 'weeklyLimit');
                const fiveHourPct = fiveHourItem ? Math.round(fiveHourItem.remaining_percentage) : Math.round(group.min_remaining_percentage);
                const weeklyPct = weeklyItem ? Math.round(weeklyItem.remaining_percentage) : 100;

                const minPct = Math.min(fiveHourPct, weeklyPct);
                const statusEmoji = this.getStatusEmoji(minPct);
                const shortTitle = group.title.includes('Gemini') 
                    ? 'Gemini' 
                    : (group.title.includes('Claude') || group.title.includes('GPT') ? 'Claude/GPT' : group.title.slice(0, 10));
                parts.push(`${statusEmoji} ${shortTitle} ${fiveHourPct}%/${weeklyPct}%`);

                tooltipRows.push(`| **${group.title}** | -- | -- |`);
                group.limits.forEach(limit => {
                    const lPct = Math.round(limit.remaining_percentage);
                    const lEmoji = this.getStatusEmoji(lPct);
                    const resetStr = limit.time_until_reset_formatted || '--';
                    tooltipRows.push(`| &nbsp;&nbsp; ${lEmoji} ${limit.name} | **${lPct}%** | ⏱ ${resetStr} |`);
                });
            });
        } else if (snapshot.models && snapshot.models.length > 0) {
            snapshot.models.forEach(model => {
                const pct = model.remaining_percentage !== undefined ? Math.round(model.remaining_percentage) : 100;
                const statusEmoji = this.getStatusEmoji(pct);
                parts.push(`${statusEmoji} ${model.label} ${pct}%`);
                tooltipRows.push(`| ${statusEmoji} ${model.label} | **${pct}%** | ⏱ ${model.time_until_reset_formatted} |`);
            });
        }

        if (parts.length === 0) {
            this.item.text = `$(check) Antigravity`;
        } else {
            this.item.text = parts.join(' | ');
        }

        // Render tooltip
        const md = new vscode.MarkdownString();
        md.isTrusted = true;
        md.appendMarkdown(tooltipRows.join('\n'));
        this.item.tooltip = md;

        this.item.show();
    }

    private getStatusEmoji(percentage: number): string {
        const warningThreshold = 40;
        const criticalThreshold = 20;
        if (percentage <= criticalThreshold) {
            return '🔴';
        } else if (percentage <= warningThreshold) {
            return '🟡';
        }
        return '🟢';
    }

    private formatCredits(value?: number): string {
        if (value === undefined || value === null) return 'N/A';
        if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
        if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
        return value.toString();
    }

    dispose(): void {
        this.stopTimer();
        this.item.dispose();
    }
}
