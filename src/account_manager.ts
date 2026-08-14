import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { ProtoCodec, OAuthTokenDetails } from "./proto_codec";

export interface StoredAccount {
    id: string;
    email: string;
    name: string;
    token: OAuthTokenDetails;
    savedAt: string;
    lastUsed: string;
    quotaPercent?: number;
    quotaDetails?: string;
}

export class AccountManager {
    private static instance: AccountManager;
    private storageDir: string;
    private accountsFile: string;
    private sqliteBin: string | null = null;

    private constructor() {
        this.storageDir = path.join(os.homedir(), ".antigravity-telegram-control");
        this.accountsFile = path.join(this.storageDir, "accounts.json");
        this.ensureStorageDir();
        this.detectSqliteBinary();
    }

    public static getInstance(): AccountManager {
        if (!AccountManager.instance) {
            AccountManager.instance = new AccountManager();
        }
        return AccountManager.instance;
    }

    private ensureStorageDir(): void {
        try {
            if (!fs.existsSync(this.storageDir)) {
                fs.mkdirSync(this.storageDir, { recursive: true });
            }
            if (!fs.existsSync(this.accountsFile)) {
                fs.writeFileSync(this.accountsFile, JSON.stringify([], null, 2), "utf8");
            }
        } catch (err) {
            console.error("AccountManager: Failed to initialize storage dir", err);
        }
    }

    private detectSqliteBinary(): void {
        const candidates = [
            "sqlite3",
            "D:\\laragon\\bin\\laragon\\utils\\sqlite3.exe",
            "C:\\ProgramData\\chocolatey\\bin\\sqlite3.exe",
            "C:\\sqlite\\sqlite3.exe",
            "/usr/bin/sqlite3",
            "/usr/local/bin/sqlite3",
            "/opt/homebrew/bin/sqlite3",
        ];

        for (const candidate of candidates) {
            try {
                cp.execFileSync(candidate, ["--version"], { stdio: ["pipe", "pipe", "ignore"], encoding: "utf8" });
                this.sqliteBin = candidate;
                console.log(`AccountManager: Using sqlite3 binary at ${candidate}`);
                return;
            } catch {
                // try next
            }
        }
        console.warn("AccountManager: No system sqlite3 binary found; fallback scripts will be used.");
    }

    /**
     * Locate existing state.vscdb files for Antigravity IDE / VS Code
     */
    public getDatabasePaths(): string[] {
        const paths: string[] = [];
        const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");

        if (process.platform === "win32") {
            paths.push(
                path.join(appData, "Antigravity IDE", "User", "globalStorage", "state.vscdb"),
                path.join(appData, "Antigravity", "User", "globalStorage", "state.vscdb"),
                path.join(appData, "Code", "User", "globalStorage", "state.vscdb")
            );
        } else if (process.platform === "darwin") {
            const home = os.homedir();
            paths.push(
                path.join(home, "Library", "Application Support", "Antigravity IDE", "User", "globalStorage", "state.vscdb"),
                path.join(home, "Library", "Application Support", "Antigravity", "User", "globalStorage", "state.vscdb"),
                path.join(home, "Library", "Application Support", "Code", "User", "globalStorage", "state.vscdb")
            );
        } else {
            const home = os.homedir();
            paths.push(
                path.join(home, ".config", "Antigravity IDE", "User", "globalStorage", "state.vscdb"),
                path.join(home, ".config", "Antigravity", "User", "globalStorage", "state.vscdb"),
                path.join(home, ".config", "Code", "User", "globalStorage", "state.vscdb")
            );
        }

        return paths.filter((p) => fs.existsSync(p));
    }

    /**
     * Execute SQL Query on a specific state.vscdb
     */
    private executeSql(dbPath: string, sql: string): string {
        if (this.sqliteBin) {
            try {
                return cp.execFileSync(this.sqliteBin, [dbPath, sql], { encoding: "utf8", timeout: 8000 }).trim();
            } catch (err: any) {
                console.warn(`AccountManager: SQLite CLI execution error: ${err.message}`);
            }
        }

        // Fallback on Windows: use PowerShell inline SQLite if available
        if (process.platform === "win32") {
            try {
                const escapedSql = sql.replace(/"/g, '""');
                const psCmd = `
                $db = "${dbPath.replace(/\\/g, "\\\\")}";
                $sql = "${escapedSql}";
                if (Get-Command sqlite3 -ErrorAction SilentlyContinue) {
                    sqlite3 $db $sql
                }
                `;
                return cp.execSync(psCmd, { shell: "powershell.exe", encoding: "utf8", timeout: 8000 }).trim();
            } catch (err: any) {
                console.error(`AccountManager: PowerShell SQLite fallback failed: ${err.message}`);
            }
        }

        throw new Error(`Cannot execute SQLite query on ${dbPath}. Ensure sqlite3 is installed.`);
    }

    /**
     * Reads a specific key from state.vscdb ItemTable
     */
    public readDbKey(dbPath: string, key: string): string | null {
        try {
            const sql = `SELECT value FROM ItemTable WHERE key = '${key.replace(/'/g, "''")}';`;
            const result = this.executeSql(dbPath, sql);
            return result.length > 0 ? result : null;
        } catch {
            return null;
        }
    }

    /**
     * Writes/Updates a key in state.vscdb ItemTable
     */
    public writeDbKey(dbPath: string, key: string, value: string): boolean {
        try {
            const escapedKey = key.replace(/'/g, "''");
            const escapedVal = value.replace(/'/g, "''");
            const sql = `INSERT INTO ItemTable(key, value) VALUES('${escapedKey}', '${escapedVal}') ON CONFLICT(key) DO UPDATE SET value='${escapedVal}';`;
            this.executeSql(dbPath, sql);

            // If a backup file exists, update it as well
            const backupFile = dbPath.replace(/\.vscdb$/, ".vscdb.backup");
            if (fs.existsSync(backupFile)) {
                try {
                    this.executeSql(backupFile, sql);
                } catch {
                    // ignore backup fail
                }
            }
            return true;
        } catch (err: any) {
            console.error(`AccountManager: writeDbKey failed on ${dbPath}`, err);
            return false;
        }
    }

    /**
     * Get details of currently active account in Antigravity IDE
     */
    public getCurrentAccount(): { email: string; name: string; token: OAuthTokenDetails } | null {
        const dbPaths = this.getDatabasePaths();
        if (dbPaths.length === 0) {
            return null;
        }

        for (const dbPath of dbPaths) {
            try {
                let name = "Unknown";
                let email = "Unknown";

                const authStatusStr = this.readDbKey(dbPath, "antigravityAuthStatus");
                if (authStatusStr) {
                    try {
                        const parsed = JSON.parse(authStatusStr);
                        if (parsed.name) name = parsed.name;
                        if (parsed.email) email = parsed.email;
                    } catch {
                        // ignore
                    }
                }

                const oauthTokenBase64 = this.readDbKey(dbPath, "antigravityUnifiedStateSync.oauthToken");
                if (!oauthTokenBase64) {
                    continue;
                }

                const buffer = new Uint8Array(Buffer.from(oauthTokenBase64, "base64"));
                const tokenDetails = ProtoCodec.extractOAuthTokenInfoFromUnifiedState(buffer);
                if (tokenDetails && tokenDetails.accessToken) {
                    tokenDetails.name = name;
                    tokenDetails.email = email;
                    return { email, name, token: tokenDetails };
                }
            } catch (err) {
                console.warn(`AccountManager: Failed to read account from ${dbPath}`, err);
            }
        }
        return null;
    }

    /**
     * Get list of all saved accounts from accounts.json
     */
    public getStoredAccounts(): StoredAccount[] {
        try {
            if (!fs.existsSync(this.accountsFile)) {
                return [];
            }
            const data = fs.readFileSync(this.accountsFile, "utf8");
            return JSON.parse(data);
        } catch (err) {
            console.error("AccountManager: Failed to read stored accounts", err);
            return [];
        }
    }

    /**
     * Save/Snapshot the current active account into stored accounts list
     */
    public saveCurrentAccount(customName?: string): StoredAccount | null {
        const current = this.getCurrentAccount();
        if (!current) {
            throw new Error("No active account detected in Antigravity IDE.");
        }

        const accounts = this.getStoredAccounts();
        const now = new Date().toISOString();
        const existingIdx = accounts.findIndex((a) => a.email.toLowerCase() === current.email.toLowerCase());

        let accountRecord: StoredAccount;
        if (existingIdx >= 0) {
            accountRecord = accounts[existingIdx];
            accountRecord.token = current.token;
            accountRecord.name = customName || current.name || accountRecord.name;
            accountRecord.lastUsed = now;
            accounts[existingIdx] = accountRecord;
        } else {
            const id = `acc_${Date.now()}`;
            accountRecord = {
                id,
                email: current.email,
                name: customName || current.name || current.email.split("@")[0],
                token: current.token,
                savedAt: now,
                lastUsed: now,
            };
            accounts.push(accountRecord);
        }

        fs.writeFileSync(this.accountsFile, JSON.stringify(accounts, null, 2), "utf8");
        return accountRecord;
    }

    /**
     * Switch IDE state to a stored account by ID or Email
     */
    public switchAccount(accountIdentifier: string): { success: boolean; account: StoredAccount } {
        const accounts = this.getStoredAccounts();
        const target = accounts.find(
            (a) => a.id === accountIdentifier || a.email.toLowerCase() === accountIdentifier.toLowerCase()
        );

        if (!target) {
            throw new Error(`Account not found matching '${accountIdentifier}'`);
        }

        const dbPaths = this.getDatabasePaths();
        if (dbPaths.length === 0) {
            throw new Error("No Antigravity IDE state database found.");
        }

        const expiry = target.token.expiryTimestamp || Math.floor(Date.now() / 1000) + 3600;
        const oauthInfoBytes = ProtoCodec.createOAuthInfo(
            target.token.accessToken,
            target.token.refreshToken,
            expiry,
            false,
            target.token.idToken,
            target.email
        );

        const userStatusPayload = ProtoCodec.createMinimalUserStatusPayload(target.email);
        const userStatusEntryBase64 = ProtoCodec.createUnifiedStateEntry("userStatusSentinelKey", userStatusPayload);

        const authStatusJson = JSON.stringify({
            name: target.name || target.email,
            email: target.email,
            apiKey: target.token.accessToken,
        });

        let successCount = 0;
        for (const dbPath of dbPaths) {
            try {
                // Merge or replace oauthToken unified state entry
                let newOAuthTokenBase64: string;
                const currentOAuth = this.readDbKey(dbPath, "antigravityUnifiedStateSync.oauthToken");
                if (currentOAuth) {
                    try {
                        const currentBuf = new Uint8Array(Buffer.from(currentOAuth, "base64"));
                        const mergedBuf = ProtoCodec.replaceUnifiedTopicEntry(
                            currentBuf,
                            "oauthTokenInfoSentinelKey",
                            oauthInfoBytes
                        );
                        newOAuthTokenBase64 = Buffer.from(mergedBuf).toString("base64");
                    } catch {
                        newOAuthTokenBase64 = ProtoCodec.createUnifiedStateEntry(
                            "oauthTokenInfoSentinelKey",
                            oauthInfoBytes
                        );
                    }
                } else {
                    newOAuthTokenBase64 = ProtoCodec.createUnifiedStateEntry(
                        "oauthTokenInfoSentinelKey",
                        oauthInfoBytes
                    );
                }

                // Write keys into state.vscdb
                this.writeDbKey(dbPath, "antigravityUnifiedStateSync.oauthToken", newOAuthTokenBase64);
                this.writeDbKey(dbPath, "antigravityUnifiedStateSync.userStatus", userStatusEntryBase64);
                this.writeDbKey(dbPath, "antigravityAuthStatus", authStatusJson);
                this.writeDbKey(dbPath, "antigravityOnboarding", "true");

                if (target.token.projectId) {
                    const projectPayload = ProtoCodec.createStringValuePayload(target.token.projectId);
                    const enterpriseEntry = ProtoCodec.createUnifiedStateEntry(
                        "enterpriseGcpProjectId",
                        projectPayload
                    );
                    this.writeDbKey(dbPath, "antigravityUnifiedStateSync.enterprisePreferences", enterpriseEntry);
                }

                successCount++;
            } catch (err) {
                console.error(`AccountManager: Failed to write switch keys to ${dbPath}`, err);
            }
        }

        if (successCount > 0) {
            target.lastUsed = new Date().toISOString();
            fs.writeFileSync(this.accountsFile, JSON.stringify(accounts, null, 2), "utf8");
            return { success: true, account: target };
        } else {
            throw new Error("Failed to write account credentials to any IDE database.");
        }
    }

    /**
     * Delete an account from storage
     */
    public deleteAccount(accountIdentifier: string): boolean {
        let accounts = this.getStoredAccounts();
        const initialLen = accounts.length;
        accounts = accounts.filter(
            (a) => a.id !== accountIdentifier && a.email.toLowerCase() !== accountIdentifier.toLowerCase()
        );

        if (accounts.length < initialLen) {
            fs.writeFileSync(this.accountsFile, JSON.stringify(accounts, null, 2), "utf8");
            return true;
        }
        return false;
    }

    /**
     * Rotates to the next available stored account (round-robin)
     */
    public rotateAccount(): StoredAccount | null {
        const accounts = this.getStoredAccounts();
        if (accounts.length <= 1) {
            return null;
        }

        const current = this.getCurrentAccount();
        let nextIndex = 0;

        if (current) {
            const currentIdx = accounts.findIndex(
                (a) => a.email.toLowerCase() === current.email.toLowerCase()
            );
            if (currentIdx >= 0) {
                nextIndex = (currentIdx + 1) % accounts.length;
            }
        }

        const target = accounts[nextIndex];
        const res = this.switchAccount(target.id);
        return res.account;
    }
}
