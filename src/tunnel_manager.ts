import * as cp from 'child_process';
import * as http from 'http';
import * as vscode from 'vscode';

export class TunnelManager {
    private static activeProcess: cp.ChildProcess | undefined;
    private static outputChannel = vscode.window.createOutputChannel("Antigravity Tunnel");

    /**
     * Start the tunnel and return the public URL
     */
    public static async startTunnel(port: number, type: string, ngrokAuthToken?: string): Promise<string> {
        this.stopTunnel();
        this.outputChannel.appendLine(`[Tunnel] Starting tunnel of type: ${type} for port ${port}...`);

        if (type === 'ngrok') {
            return this.startNgrok(port, ngrokAuthToken);
        } else if (type === 'localhost.run') {
            return this.startLocalhostRun(port);
        } else {
            throw new Error(`Unsupported tunnel type: ${type}`);
        }
    }

    /**
     * Stop any active tunnel process
     */
    public static stopTunnel(): void {
        if (this.activeProcess) {
            this.outputChannel.appendLine('[Tunnel] Stopping active tunnel process...');
            try {
                // On Windows, taskkill might be cleaner, but kill() usually works for directly spawned CLI tools
                this.activeProcess.kill();
            } catch (e: any) {
                this.outputChannel.appendLine(`[Tunnel] Error killing tunnel process: ${e.message}`);
            }
            this.activeProcess = undefined;
        }
    }

    private static startLocalhostRun(port: number): Promise<string> {
        return new Promise((resolve, reject) => {
            const sshArgs = [
                '-o', 'StrictHostKeyChecking=no',
                '-R', `80:127.0.0.1:${port}`,
                'nokey@localhost.run'
            ];

            this.outputChannel.appendLine(`[Tunnel] Spawning command: ssh ${sshArgs.join(' ')}`);
            const proc = cp.spawn('ssh', sshArgs);
            this.activeProcess = proc;

            let isResolved = false;
            const timeoutTimer = setTimeout(() => {
                if (!isResolved) {
                    this.stopTunnel();
                    reject(new Error('Localhost.run connection timed out (20s)'));
                }
            }, 20000);

            const handleData = (data: Buffer) => {
                const text = data.toString();
                this.outputChannel.append(text);

                // Parse the URL from text like: "cec36f18b479f7.lhr.life tunneled with tls termination, https://cec36f18b479f7.lhr.life"
                // or "Active tunnel: https://xxxx.localhost.run"
                const match = text.match(/https?:\/\/[a-zA-Z0-9-.]+\.(?:lhr\.life|localhost\.run)/);
                if (match) {
                    isResolved = true;
                    clearTimeout(timeoutTimer);
                    resolve(match[0]);
                }
            };

            proc.stdout?.on('data', handleData);
            proc.stderr?.on('data', handleData);

            proc.on('error', (err) => {
                this.outputChannel.appendLine(`[Tunnel] ssh process error: ${err.message}`);
                if (!isResolved) {
                    clearTimeout(timeoutTimer);
                    reject(err);
                }
            });

            proc.on('exit', (code) => {
                this.outputChannel.appendLine(`[Tunnel] ssh process exited with code ${code}`);
                if (!isResolved) {
                    clearTimeout(timeoutTimer);
                    reject(new Error(`ssh process exited with code ${code}`));
                }
            });
        });
    }

    private static startNgrok(port: number, authToken?: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const env = { ...process.env };
            if (authToken) {
                env.NGROK_AUTHTOKEN = authToken;
            }

            const args = ['http', port.toString(), '--log=stdout'];
            this.outputChannel.appendLine(`[Tunnel] Spawning command: ngrok ${args.join(' ')}`);
            const proc = cp.spawn('ngrok', args, { env });
            this.activeProcess = proc;

            proc.stdout?.on('data', (data) => {
                this.outputChannel.append(data.toString());
            });
            proc.stderr?.on('data', (data) => {
                this.outputChannel.append(data.toString());
            });

            proc.on('error', (err) => {
                this.outputChannel.appendLine(`[Tunnel] ngrok process error: ${err.message}`);
                reject(err);
            });

            proc.on('exit', (code) => {
                this.outputChannel.appendLine(`[Tunnel] ngrok process exited with code ${code}`);
                reject(new Error(`ngrok exited with code ${code}`));
            });

            // Poll the local ngrok status API to get the public URL
            let attempts = 0;
            const maxAttempts = 15;
            const pollInterval = setInterval(() => {
                attempts++;
                if (!this.activeProcess || this.activeProcess.killed) {
                    clearInterval(pollInterval);
                    reject(new Error('ngrok process stopped before tunnel could be established'));
                    return;
                }

                this.getNgrokPublicUrl()
                    .then((url) => {
                        clearInterval(pollInterval);
                        resolve(url);
                    })
                    .catch((err) => {
                        if (attempts >= maxAttempts) {
                            clearInterval(pollInterval);
                            this.stopTunnel();
                            reject(new Error(`Failed to retrieve ngrok public URL: ${err.message}`));
                        }
                    });
            }, 1000);
        });
    }

    private static getNgrokPublicUrl(): Promise<string> {
        return new Promise((resolve, reject) => {
            const req = http.get('http://127.0.0.1:4040/api/tunnels', (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        const publicUrl = parsed.tunnels?.[0]?.public_url;
                        if (publicUrl) {
                            resolve(publicUrl);
                        } else {
                            reject(new Error('No tunnels initialized yet'));
                        }
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            req.on('error', (err) => reject(err));
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Timeout contacting local ngrok API'));
            });
            req.setTimeout(500);
        });
    }
}
