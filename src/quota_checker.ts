import { exec } from 'child_process';
import { promisify } from 'util';
import * as https from 'https';
import * as process from 'process';

const exec_async = promisify(exec);

export interface PromptCreditsInfo {
    available: number;
    monthly: number;
    used_percentage: number;
    remaining_percentage: number;
}

export interface ModelQuotaInfo {
    label: string;
    model_id: string;
    remaining_fraction?: number;
    remaining_percentage?: number;
    is_exhausted: boolean;
    reset_time: Date;
    time_until_reset: number;
    time_until_reset_formatted: string;
}

export interface QuotaSnapshot {
    timestamp: Date;
    prompt_credits?: PromptCreditsInfo;
    models: ModelQuotaInfo[];
}

export interface ProcessInfo {
    pid: number;
    extension_port: number;
    csrf_token: string;
}

function isAntigravityProcess(command_line: string): boolean {
    const lower_cmd = command_line.toLowerCase();
    if (/--app_data_dir\s+antigravity\b/i.test(command_line)) {
        return true;
    }
    if (lower_cmd.includes('\\antigravity\\') || lower_cmd.includes('/antigravity/')) {
        return true;
    }
    return false;
}

// OS-specific strategies
interface PlatformStrategy {
    getProcessListCommand(process_name: string): string;
    parseProcessInfo(stdout: string): ProcessInfo | null;
    getPortListCommand(pid: number): string;
    parseListeningPorts(stdout: string, pid: number): number[];
}

class WindowsStrategy implements PlatformStrategy {
    private usePowerShell = true;

    getProcessListCommand(process_name: string): string {
        if (this.usePowerShell) {
            return `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name='${process_name}'\\" | Select-Object ProcessId,CommandLine | ConvertTo-Json"`;
        }
        return `wmic process where "name='${process_name}'" get ProcessId,CommandLine /format:list`;
    }

    parseProcessInfo(stdout: string): ProcessInfo | null {
        const trimmed = stdout.trim();
        if (this.usePowerShell || trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
                let data = JSON.parse(trimmed);
                if (Array.isArray(data)) {
                    if (data.length === 0) return null;
                    const filtered = data.filter(item => item.CommandLine && isAntigravityProcess(item.CommandLine));
                    if (filtered.length === 0) return null;
                    data = filtered[0];
                } else {
                    if (!data.CommandLine || !isAntigravityProcess(data.CommandLine)) {
                        return null;
                    }
                }

                const command_line = data.CommandLine || '';
                const pid = data.ProcessId;
                if (!pid) return null;

                const port_match = command_line.match(/--extension_server_port[=\s]+(\d+)/);
                const token_match = command_line.match(/--csrf_token[=\s]+([a-f0-9\-]+)/i);

                if (!token_match || !token_match[1]) return null;

                return {
                    pid,
                    extension_port: port_match ? parseInt(port_match[1], 10) : 0,
                    csrf_token: token_match[1]
                };
            } catch (e) {
                // fall through to wmic if JSON fails
                this.usePowerShell = false;
            }
        }

        // WMIC fallback parsing
        const blocks = stdout.split(/\n\s*\n/).filter(block => block.trim().length > 0);
        for (const block of blocks) {
            const pid_match = block.match(/ProcessId=(\d+)/);
            const command_line_match = block.match(/CommandLine=(.+)/);

            if (!pid_match || !command_line_match) continue;

            const command_line = command_line_match[1].trim();
            if (!isAntigravityProcess(command_line)) continue;

            const port_match = command_line.match(/--extension_server_port[=\s]+(\d+)/);
            const token_match = command_line.match(/--csrf_token[=\s]+([a-f0-9\-]+)/i);

            if (!token_match || !token_match[1]) continue;

            return {
                pid: parseInt(pid_match[1], 10),
                extension_port: port_match ? parseInt(port_match[1], 10) : 0,
                csrf_token: token_match[1]
            };
        }

        return null;
    }

    getPortListCommand(pid: number): string {
        if (this.usePowerShell) {
            return `powershell -NoProfile -Command "Get-NetTCPConnection -OwningProcess ${pid} -State Listen | Select-Object -ExpandProperty LocalPort | ConvertTo-Json"`;
        }
        return `netstat -ano | findstr "${pid}"`;
    }

    parseListeningPorts(stdout: string, pid: number): number[] {
        const ports: number[] = [];
        if (this.usePowerShell) {
            try {
                const data = JSON.parse(stdout.trim());
                if (Array.isArray(data)) {
                    for (const port of data) {
                        if (typeof port === 'number' && !ports.includes(port)) {
                            ports.push(port);
                        }
                    }
                } else if (typeof data === 'number') {
                    ports.push(data);
                }
            } catch (e) {
                // fallback
            }
            if (ports.length > 0) return ports.sort((a, b) => a - b);
        }

        const port_regex = new RegExp(`(?:127\\.0\\.0\\.1|0\\.0\\.0\\.0|\\[::1?\\]):(\\d+)\\s+(?:0\\.0\\.0\\.0:0|\\[::\\]:0|\\*:\\*).*?\\s+${pid}$`, 'gim');
        let match;
        while ((match = port_regex.exec(stdout)) !== null) {
            const port = parseInt(match[1], 10);
            if (!ports.includes(port)) {
                ports.push(port);
            }
        }
        return ports.sort((a, b) => a - b);
    }
}

class UnixStrategy implements PlatformStrategy {
    constructor(private isMac: boolean) {}

    getProcessListCommand(process_name: string): string {
        if (this.isMac) {
            return `pgrep -fl ${process_name}`;
        }
        return `pgrep -af ${process_name}`;
    }

    parseProcessInfo(stdout: string): ProcessInfo | null {
        const lines = stdout.split('\n');
        for (const line of lines) {
            if (line.includes('--extension_server_port')) {
                const parts = line.trim().split(/\s+/);
                const pid = parseInt(parts[0], 10);
                const cmd = line.substring(parts[0].length).trim();

                const port_match = cmd.match(/--extension_server_port[=\s]+(\d+)/);
                const token_match = cmd.match(/--csrf_token[=\s]+([a-zA-Z0-9\-]+)/);

                if (token_match && token_match[1]) {
                    return {
                        pid,
                        extension_port: port_match ? parseInt(port_match[1], 10) : 0,
                        csrf_token: token_match[1]
                    };
                }
            }
        }
        return null;
    }

    getPortListCommand(pid: number): string {
        if (this.isMac) {
            return `lsof -nP -a -iTCP -sTCP:LISTEN -p ${pid}`;
        }
        return `ss -tlnp 2>/dev/null | grep "pid=${pid}" || lsof -nP -a -iTCP -sTCP:LISTEN -p ${pid} 2>/dev/null`;
    }

    parseListeningPorts(stdout: string, pid: number): number[] {
        const ports: number[] = [];
        const lsof_regex = new RegExp(`^\\S+\\s+${pid}\\s+.*?(?:TCP|UDP)\\s+(?:\\*|[\\d.]+|\\[[\\da-f:]+\\]):(\\d+)\\s+\\(LISTEN\\)`, 'gim');

        if (this.isMac) {
            let match;
            while ((match = lsof_regex.exec(stdout)) !== null) {
                const port = parseInt(match[1], 10);
                if (!ports.includes(port)) ports.push(port);
            }
        } else {
            const ss_regex = new RegExp(`LISTEN\\s+\\d+\\s+\\d+\\s+(?:\\*|[\\d.]+|\\[[\\da-f:]*\\]):(\\d+).*?users:.*?,pid=${pid},`, 'gi');
            let match;
            while ((match = ss_regex.exec(stdout)) !== null) {
                const port = parseInt(match[1], 10);
                if (!ports.includes(port)) ports.push(port);
            }

            if (ports.length === 0) {
                while ((match = lsof_regex.exec(stdout)) !== null) {
                    const port = parseInt(match[1], 10);
                    if (!ports.includes(port)) ports.push(port);
                }
            }
        }

        return ports.sort((a, b) => a - b);
    }
}

function getPlatformStrategy(): { strategy: PlatformStrategy; processName: string } {
    if (process.platform === 'win32') {
        return { strategy: new WindowsStrategy(), processName: 'language_server_windows_x64.exe' };
    } else if (process.platform === 'darwin') {
        const name = `language_server_macos${process.arch === 'arm64' ? '_arm' : ''}`;
        return { strategy: new UnixStrategy(true), processName: name };
    } else {
        const name = `language_server_linux${process.arch === 'arm64' ? '_arm' : '_x64'}`;
        return { strategy: new UnixStrategy(false), processName: name };
    }
}

async function testPort(port: number, csrf_token: string): Promise<boolean> {
    return new Promise(resolve => {
        const options = {
            hostname: '127.0.0.1',
            port,
            path: '/exa.language_server_pb.LanguageServerService/GetUnleashData',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Codeium-Csrf-Token': csrf_token,
                'Connect-Protocol-Version': '1',
            },
            rejectUnauthorized: false,
            timeout: 2000,
        };

        const req = https.request(options, res => {
            let body = '';
            res.on('data', chunk => (body += chunk));
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        JSON.parse(body);
                        resolve(true);
                    } catch {
                        resolve(false);
                    }
                } else {
                    resolve(false);
                }
            });
        });

        req.on('error', () => resolve(false));
        req.on('timeout', () => {
            req.destroy();
            resolve(false);
        });

        req.write(JSON.stringify({ wrapper_data: {} }));
        req.end();
    });
}

function formatTimeUntilReset(ms: number, reset_time: Date, lang: string): string {
    if (ms <= 0) {
        return lang === 'vi' ? 'Sẵn sàng' : 'Ready';
    }
    const mins = Math.ceil(ms / 60000);
    let duration = '';
    if (mins < 60) {
        duration = `${mins}m`;
    } else {
        const hours = Math.floor(mins / 60);
        duration = `${hours}h ${mins % 60}m`;
    }

    const year = reset_time.getFullYear();
    const month = String(reset_time.getMonth() + 1).padStart(2, '0');
    const day = String(reset_time.getDate()).padStart(2, '0');
    const hour = String(reset_time.getHours()).padStart(2, '0');
    const minute = String(reset_time.getMinutes()).padStart(2, '0');

    return `${duration} (${day}/${month}/${year} ${hour}:${minute})`;
}

async function requestUserStatus(port: number, csrf_token: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({
            metadata: {
                ideName: 'antigravity',
                extensionName: 'antigravity',
                locale: 'en',
            },
        });

        const options = {
            hostname: '127.0.0.1',
            port,
            path: '/exa.language_server_pb.LanguageServerService/GetUserStatus',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
                'Connect-Protocol-Version': '1',
                'X-Codeium-Csrf-Token': csrf_token,
            },
            rejectUnauthorized: false,
            timeout: 5000,
        };

        const req = https.request(options, res => {
            let body = '';
            res.on('data', chunk => (body += chunk));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    reject(new Error('Invalid JSON response from server'));
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request to language server timed out'));
        });

        req.write(data);
        req.end();
    });
}

export async function fetchQuotaInfo(lang: string = 'en'): Promise<QuotaSnapshot> {
    const { strategy, processName } = getPlatformStrategy();

    // 1. Get process list
    const procCmd = strategy.getProcessListCommand(processName);
    let procOutput = '';
    try {
        const { stdout } = await exec_async(procCmd);
        procOutput = stdout;
    } catch (e: any) {
        throw new Error(`Failed to list processes: ${e.message}`);
    }

    // 2. Parse process info
    const info = strategy.parseProcessInfo(procOutput);
    if (!info) {
        throw new Error('Antigravity language server process not found or could not be parsed.');
    }

    // 3. Scan ports
    const portCmd = strategy.getPortListCommand(info.pid);
    let portOutput = '';
    try {
        const { stdout } = await exec_async(portCmd);
        portOutput = stdout;
    } catch (e: any) {
        throw new Error(`Failed to list ports for PID ${info.pid}: ${e.message}`);
    }

    const ports = strategy.parseListeningPorts(portOutput, info.pid);
    if (ports.length === 0) {
        throw new Error(`No listening ports found for Antigravity process PID ${info.pid}.`);
    }

    // 4. Test ports to find the active API server
    let connectPort: number | null = null;
    for (const port of ports) {
        const working = await testPort(port, info.csrf_token);
        if (working) {
            connectPort = port;
            break;
        }
    }

    if (!connectPort) {
        throw new Error('Could not establish connection to the Antigravity API server on any listening port.');
    }

    // 5. Query user status
    const statusData = await requestUserStatus(connectPort, info.csrf_token);
    if (!statusData || !statusData.userStatus) {
        throw new Error('Failed to retrieve user status from language server API.');
    }

    const userStatus = statusData.userStatus;
    const planInfo = userStatus.planStatus?.planInfo;
    const availableCredits = userStatus.planStatus?.availablePromptCredits;

    let prompt_credits: PromptCreditsInfo | undefined;
    if (planInfo && availableCredits !== undefined) {
        const monthly = Number(planInfo.monthlyPromptCredits);
        const available = Number(availableCredits);
        if (monthly > 0) {
            prompt_credits = {
                available,
                monthly,
                used_percentage: ((monthly - available) / monthly) * 100,
                remaining_percentage: (available / monthly) * 100,
            };
        }
    }

    const rawModels = userStatus.cascadeModelConfigData?.clientModelConfigs || [];
    const models: ModelQuotaInfo[] = rawModels
        .filter((m: any) => m.quotaInfo)
        .map((m: any) => {
            const reset_time = new Date(m.quotaInfo.resetTime);
            const now = new Date();
            const diff = reset_time.getTime() - now.getTime();

            return {
                label: m.label || m.modelOrAlias?.model || 'Unknown Model',
                model_id: m.modelOrAlias?.model || 'unknown',
                remaining_fraction: m.quotaInfo.remainingFraction,
                remaining_percentage: m.quotaInfo.remainingFraction !== undefined ? m.quotaInfo.remainingFraction * 100 : undefined,
                is_exhausted: m.quotaInfo.remainingFraction === 0,
                reset_time: reset_time,
                time_until_reset: diff,
                time_until_reset_formatted: formatTimeUntilReset(diff, reset_time, lang),
            };
        });

    return {
        timestamp: new Date(),
        prompt_credits,
        models,
    };
}
