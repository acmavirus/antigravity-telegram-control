import { exec } from 'child_process';
import { promisify } from 'util';
import * as https from 'https';
import * as http from 'http';
import * as process from 'process';

const exec_async = promisify(exec);

export interface PromptCreditsInfo {
    available: number;
    monthly: number;
    used_percentage: number;
    remaining_percentage: number;
}

export interface FlowCreditsInfo {
    available: number;
    monthly: number;
    used_percentage: number;
    remaining_percentage: number;
}

export interface UserInfo {
    name?: string;
    email?: string;
    tier?: string;
    tierId?: string;
    tierDescription?: string;
    planName?: string;
    teamsTier?: string;
    upgradeUri?: string;
    upgradeText?: string;
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
    flow_credits?: FlowCreditsInfo;
    user_info?: UserInfo;
    models: ModelQuotaInfo[];
}

export interface ProcessInfo {
    pid: number;
    ppid?: number;
    extension_port: number;
    csrf_token: string;
}

type Protocol = 'https' | 'http';
const protocolCache = new Map<string, Protocol>();

function getCachedProtocol(hostname: string, port: number): Protocol {
    const key = `${hostname}:${port}`;
    return protocolCache.get(key) || 'https';
}

function setCachedProtocol(hostname: string, port: number, protocol: Protocol): void {
    const key = `${hostname}:${port}`;
    protocolCache.set(key, protocol);
}

interface HttpRequestOptions {
    hostname: string;
    port: number;
    path: string;
    method: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
    timeout?: number;
    allowFallback?: boolean;
}

interface HttpResponse<T = any> {
    statusCode: number;
    data: T;
    protocol: Protocol;
}

async function doRequest<T>(options: HttpRequestOptions, protocol: Protocol): Promise<HttpResponse<T>> {
    const { hostname, port, path, method, headers = {}, body, timeout = 5000 } = options;

    return new Promise((resolve, reject) => {
        const requestModule = protocol === 'https' ? https : http;

        const requestOptions: https.RequestOptions | http.RequestOptions = {
            hostname,
            port,
            path,
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
                ...headers,
            },
            timeout,
            agent: false,
            ...(protocol === 'https' ? { rejectUnauthorized: false } : {}),
        };

        const req = requestModule.request(requestOptions, (res) => {
            let responseBody = '';
            res.on('data', (chunk) => (responseBody += chunk));
            res.on('end', () => {
                const statusCode = res.statusCode || 0;
                try {
                    const data = responseBody ? JSON.parse(responseBody) as T : ({} as T);
                    resolve({
                        statusCode,
                        data,
                        protocol,
                    });
                } catch {
                    if (statusCode >= 400) {
                        resolve({
                            statusCode,
                            data: { error: `HTTP ${statusCode}: ${responseBody.substring(0, 100)}` } as any,
                            protocol
                        });
                    } else {
                        reject(new Error(`Invalid JSON response: ${responseBody.substring(0, 100)}`));
                    }
                }
            });
        });

        req.on('error', (err) => {
            reject(new Error(`${protocol.toUpperCase()} request failed: ${err.message}`));
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error(`${protocol.toUpperCase()} request timeout`));
        });

        if (body) {
            req.write(body);
        }
        req.end();
    });
}

async function httpRequest<T>(options: HttpRequestOptions): Promise<HttpResponse<T>> {
    const { hostname, port, allowFallback = true } = options;
    const cachedProtocol = getCachedProtocol(hostname, port);

    if (cachedProtocol === 'http') {
        return doRequest<T>(options, 'http');
    }

    try {
        return await doRequest<T>(options, 'https');
    } catch (httpsError) {
        if (allowFallback) {
            try {
                const result = await doRequest<T>(options, 'http');
                setCachedProtocol(hostname, port, 'http');
                return result;
            } catch {
                throw httpsError;
            }
        }
        throw httpsError;
    }
}

let powershellTimeoutRetried = false;

async function executeCommand(command: string, timeout = 8000): Promise<{ stdout: string; stderr: string }> {
    try {
        return await exec_async(command, { timeout });
    } catch (e: any) {
        const errorMsg = (e.message || '').toLowerCase();
        const isTimeout = errorMsg.includes("timeout") || errorMsg.includes("timed out") || errorMsg.includes("etimedout");

        if (process.platform === 'win32' && isTimeout && !powershellTimeoutRetried) {
            powershellTimeoutRetried = true;
            // Wait 3 seconds for PowerShell to warm up
            await new Promise(resolve => setTimeout(resolve, 3000));
            // Retry with longer timeout
            return exec_async(command, { timeout: 10000 });
        }
        throw e;
    }
}

function isAntigravityProcess(command_line: string): boolean {
    const lower_cmd = command_line.toLowerCase();
    if (/--app_data_dir\s+["']?antigravity/i.test(command_line)) {
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
    parseProcessInfo(stdout: string): ProcessInfo[] | null;
    getPortListCommand(pid: number): string;
    parseListeningPorts(stdout: string, pid: number): number[];
}

class WindowsStrategy implements PlatformStrategy {
    getProcessListCommand(process_name: string): string {
        const script = `
            [Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
            $n = '${process_name}';
            $f = 'name=''' + $n + '''';
            $p = Get-CimInstance Win32_Process -Filter $f -ErrorAction SilentlyContinue;
            if ($p) { @($p) | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress } else { '[]' }
        `
        .replace(/\n\s+/g, ' ')
        .trim();

        return `chcp 65001 >nul && powershell -ExecutionPolicy Bypass -NoProfile -Command "${script}"`;
    }

    parseProcessInfo(stdout: string): ProcessInfo[] | null {
        const trimmed = stdout.trim();
        const firstBracket = trimmed.indexOf('[');
        const firstBrace = trimmed.indexOf('{');

        let jsonCandidate = trimmed;
        if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
            jsonCandidate = trimmed.substring(firstBracket);
        } else if (firstBrace !== -1) {
            jsonCandidate = trimmed.substring(firstBrace);
        }

        if (jsonCandidate.startsWith('[') || jsonCandidate.startsWith('{')) {
            try {
                const data = JSON.parse(jsonCandidate);
                const items = Array.isArray(data) ? data : [data];
                const results: ProcessInfo[] = [];

                for (const item of items) {
                    const commandLine = item.CommandLine || '';
                    if (!isAntigravityProcess(commandLine)) continue;

                    const pid = item.ProcessId;
                    const ppid = item.ParentProcessId;
                    if (!pid) continue;

                    const port_match = commandLine.match(/--extension_server_port[=\s]+(\d+)/);
                    const token_match = commandLine.match(/--csrf_token[=\s]+(?:["']?)([a-f0-9\-]+)(?:["']?)/i);

                    if (token_match && token_match[1]) {
                        results.push({
                            pid,
                            ppid,
                            extension_port: port_match ? parseInt(port_match[1], 10) : 0,
                            csrf_token: token_match[1]
                        });
                    }
                }
                return results.length > 0 ? results : null;
            } catch (e) {
                // fall through
            }
        }

        // WMIC fallback parsing
        const results: ProcessInfo[] = [];
        const blocks = stdout.split(/\n\s*\n/).filter(block => block.trim().length > 0);
        for (const block of blocks) {
            const pid_match = block.match(/ProcessId=(\d+)/);
            const ppid_match = block.match(/ParentProcessId=(\d+)/);
            const command_line_match = block.match(/CommandLine=(.+)/);

            if (!pid_match || !command_line_match) continue;

            const command_line = command_line_match[1].trim();
            if (!isAntigravityProcess(command_line)) continue;

            const port_match = command_line.match(/--extension_server_port[=\s]+(\d+)/);
            const token_match = command_line.match(/--csrf_token[=\s]+(?:["']?)([a-f0-9\-]+)(?:["']?)/i);

            if (token_match && token_match[1]) {
                results.push({
                    pid: parseInt(pid_match[1], 10),
                    ppid: ppid_match ? parseInt(ppid_match[1], 10) : undefined,
                    extension_port: port_match ? parseInt(port_match[1], 10) : 0,
                    csrf_token: token_match[1]
                });
            }
        }

        return results.length > 0 ? results : null;
    }

    getPortListCommand(pid: number): string {
        const utf8Header = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ";
        return `chcp 65001 >nul && powershell -NoProfile -Command "${utf8Header}$p = Get-NetTCPConnection -State Listen -OwningProcess ${pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort; if ($p) { $p | Sort-Object -Unique }"`;
    }

    parseListeningPorts(stdout: string, _pid: number): number[] {
        const ports: number[] = [];
        const lines = stdout.trim().split(/\r?\n/);

        for (const line of lines) {
            const trimmed = line.trim();
            if (/^\d+$/.test(trimmed)) {
                const port = parseInt(trimmed, 10);
                if (port > 0 && port <= 65535) {
                    ports.push(port);
                }
            }
        }
        return [...new Set(ports)].sort((a, b) => a - b);
    }
}

class UnixStrategy implements PlatformStrategy {
    constructor(private isMac: boolean) {}

    getProcessListCommand(process_name: string): string {
        const grepPattern = process_name.length > 0 ? `[${process_name[0]}]${process_name.slice(1)}` : process_name;
        return `ps -A -ww -o pid,ppid,args | grep "${grepPattern}"`;
    }

    parseProcessInfo(stdout: string): ProcessInfo[] | null {
        const lines = stdout.split('\n');
        const results: ProcessInfo[] = [];

        for (const line of lines) {
            if (!line.trim()) continue;

            const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
            if (match) {
                const pid = parseInt(match[1], 10);
                const ppid = parseInt(match[2], 10);
                const cmd = match[3];

                if (cmd.includes('--extension_server_port') && isAntigravityProcess(cmd)) {
                    const port_match = cmd.match(/--extension_server_port[=\s]+(\d+)/);
                    const token_match = cmd.match(/--csrf_token[=\s]+(?:["']?)([a-zA-Z0-9\-_.]+)(?:["']?)/);

                    if (token_match && token_match[1]) {
                        results.push({
                            pid,
                            ppid,
                            extension_port: port_match ? parseInt(port_match[1], 10) : 0,
                            csrf_token: token_match[1]
                        });
                    }
                }
            }
        }
        return results.length > 0 ? results : null;
    }

    getPortListCommand(pid: number): string {
        if (this.isMac) {
            return `lsof -nP -a -iTCP -sTCP:LISTEN -p ${pid} 2>/dev/null`;
        }
        return `ss -tlnp 2>/dev/null | grep "pid=${pid}" || lsof -nP -a -iTCP -sTCP:LISTEN -p ${pid} 2>/dev/null`;
    }

    parseListeningPorts(stdout: string, pid: number): number[] {
        const ports: number[] = [];
        const pidStr = String(pid);
        const lines = stdout.split('\n');

        if (this.isMac) {
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 2 && parts[1] === pidStr) {
                    const portMatch = line.match(/(?:TCP|UDP)\s+(?:\*|[\d.]+|\[[\da-f:]+\]):(\d+)\s+\(LISTEN\)/i);
                    if (portMatch) {
                        const port = parseInt(portMatch[1], 10);
                        if (!ports.includes(port)) ports.push(port);
                    }
                }
            }
        } else {
            const ss_regex = new RegExp(`LISTEN\\s+\\d+\\s+\\d+\\s+(?:\\*|[\\d.]+|\\[[\\da-f:]*\\]):(\\d+).*?users:.*?,pid=${pid},`, 'gi');
            let match;
            while ((match = ss_regex.exec(stdout)) !== null) {
                const port = parseInt(match[1], 10);
                if (!ports.includes(port)) ports.push(port);
            }

            if (ports.length === 0) {
                for (const line of lines) {
                    const parts = line.trim().split(/\s+/);
                    if (parts.length >= 2 && parts[1] === pidStr) {
                        const portMatch = line.match(/(?:TCP|UDP)\s+(?:\*|[\d.]+|\[[\da-f:]+\]):(\d+)\s+\(LISTEN\)/i);
                        if (portMatch) {
                            const port = parseInt(portMatch[1], 10);
                            if (!ports.includes(port)) ports.push(port);
                        }
                    }
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
    try {
        const response = await httpRequest({
            hostname: '127.0.0.1',
            port,
            path: '/exa.language_server_pb.LanguageServerService/GetUnleashData',
            method: 'POST',
            headers: {
                'X-Codeium-Csrf-Token': csrf_token,
                'Connect-Protocol-Version': '1',
            },
            body: JSON.stringify({ wrapper_data: {} }),
            timeout: 3000,
            allowFallback: true,
        });
        return response.statusCode === 200;
    } catch {
        return false;
    }
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
        if (hours >= 24) {
            const days = Math.floor(hours / 24);
            const remainingHours = hours % 24;
            duration = lang === 'vi' ? `${days}ngày ${remainingHours}giờ` : `${days}d ${remainingHours}h`;
        } else {
            duration = `${hours}h ${mins % 60}m`;
        }
    }

    const year = reset_time.getFullYear();
    const month = String(reset_time.getMonth() + 1).padStart(2, '0');
    const day = String(reset_time.getDate()).padStart(2, '0');
    const hour = String(reset_time.getHours()).padStart(2, '0');
    const minute = String(reset_time.getMinutes()).padStart(2, '0');

    return `${duration} (${day}/${month}/${year} ${hour}:${minute})`;
}

async function requestUserStatus(port: number, csrf_token: string): Promise<any> {
    const data = JSON.stringify({
        metadata: {
            ideName: 'antigravity',
            extensionName: 'antigravity',
            locale: 'en',
        },
    });

    const response = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/exa.language_server_pb.LanguageServerService/GetUserStatus',
        method: 'POST',
        headers: {
            'X-Codeium-Csrf-Token': csrf_token,
            'Connect-Protocol-Version': '1',
        },
        body: data,
        timeout: 5000,
        allowFallback: true,
    });

    if (response.statusCode === 200) {
        return response.data;
    }
    throw new Error(`Language server API returned status code ${response.statusCode}`);
}

export async function fetchQuotaInfo(lang: string = 'en'): Promise<QuotaSnapshot> {
    powershellTimeoutRetried = false;
    const { strategy, processName } = getPlatformStrategy();

    // 1. Get process list
    const procCmd = strategy.getProcessListCommand(processName);
    let procOutput = '';
    try {
        const { stdout } = await executeCommand(procCmd);
        procOutput = stdout;
    } catch (e: any) {
        throw new Error(`Failed to list processes: ${e.message}`);
    }

    // 2. Parse process info
    const infos = strategy.parseProcessInfo(procOutput);
    if (!infos || infos.length === 0) {
        throw new Error('Antigravity language server process not found or could not be parsed.');
    }

    // Sort to prioritize direct child of our process, or sibling, if available
    const myPid = process.pid;
    const myPpid = process.ppid;
    const sortedInfos = [...infos].sort((a, b) => {
        if (a.ppid === myPid && b.ppid !== myPid) return -1;
        if (b.ppid === myPid && a.ppid !== myPid) return 1;
        if (a.ppid === myPpid && b.ppid !== myPpid) return -1;
        if (b.ppid === myPpid && a.ppid !== myPpid) return 1;
        return 0;
    });

    const info = sortedInfos[0];

    // 3. Scan ports
    const portCmd = strategy.getPortListCommand(info.pid);
    let portOutput = '';
    try {
        const { stdout } = await executeCommand(portCmd);
        portOutput = stdout;
    } catch (e: any) {
        throw new Error(`Failed to list ports for PID ${info.pid}: ${e.message}`);
    }

    let ports = strategy.parseListeningPorts(portOutput, info.pid);
    if (info.extension_port > 0 && !ports.includes(info.extension_port)) {
        ports = [info.extension_port, ...ports];
    }

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
    const availableFlowCredits = userStatus.planStatus?.availableFlowCredits;
    const userTier = userStatus.userTier;

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

    let flow_credits: FlowCreditsInfo | undefined;
    if (planInfo?.monthlyFlowCredits && availableFlowCredits !== undefined) {
        const monthly = Number(planInfo.monthlyFlowCredits);
        const available = Number(availableFlowCredits);
        if (monthly > 0) {
            flow_credits = {
                available,
                monthly,
                used_percentage: ((monthly - available) / monthly) * 100,
                remaining_percentage: (available / monthly) * 100,
            };
        }
    }

    let user_info: UserInfo | undefined;
    if (userStatus.name || userTier) {
        user_info = {
            name: userStatus.name,
            email: userStatus.email,
            tier: userTier?.name || planInfo?.teamsTier,
            tierId: userTier?.id,
            tierDescription: userTier?.description,
            planName: planInfo?.planName,
            teamsTier: planInfo?.teamsTier,
            upgradeUri: userTier?.upgradeSubscriptionUri,
            upgradeText: userTier?.upgradeSubscriptionText,
        };
    }

    const rawModels = userStatus.cascadeModelConfigData?.clientModelConfigs || [];
    const models: ModelQuotaInfo[] = rawModels
        .filter((m: any) => m.quotaInfo)
        .map((m: any) => {
            let reset_time = new Date(m.quotaInfo.resetTime);
            if (Number.isNaN(reset_time.getTime())) {
                reset_time = new Date(Date.now() + 24 * 60 * 60 * 1000);
            }
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
        flow_credits,
        user_info,
        models,
    };
}
