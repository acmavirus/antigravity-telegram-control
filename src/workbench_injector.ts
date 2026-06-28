import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { execSync } from 'child_process';

const TAG_START = '<!-- AG-AUTO-CLICK-SCROLL-START -->';
const TAG_END = '<!-- AG-AUTO-CLICK-SCROLL-END -->';

/**
 * Write file with elevation helper for Unix systems (Linux/macOS)
 */
export function writeFileElevated(filePath: string, content: string): void {
    try {
        fs.writeFileSync(filePath, content, 'utf8');
    } catch (err: any) {
        if (err.code !== 'EACCES' && err.code !== 'EPERM') throw err;

        const tmpPath = path.join(os.tmpdir(), 'ag-auto-' + Date.now() + '.tmp');
        fs.writeFileSync(tmpPath, content, 'utf8');

        try {
            if (process.platform === 'linux') {
                execSync(`pkexec bash -c "cp '${tmpPath}' '${filePath}' && chmod 644 '${filePath}'"`, { timeout: 30000 });
                console.log('[AG Auto] ✅ Elevated write (pkexec) ->', path.basename(filePath));
            } else if (process.platform === 'darwin') {
                const cmd = `cp '${tmpPath}' '${filePath}' && chmod 644 '${filePath}'`;
                execSync(`osascript -e 'do shell script "${cmd}" with administrator privileges'`, { timeout: 30000 });
                console.log('[AG Auto] ✅ Elevated write (osascript) ->', path.basename(filePath));
            } else {
                throw err;
            }
        } catch (elevErr: any) {
            try { fs.unlinkSync(tmpPath); } catch (_) { }
            if (elevErr === err) throw err;
            console.error('[AG Auto] Elevation failed:', elevErr.message);
            throw new Error(`Permission denied. Vui lòng chạy lại VS Code dưới quyền Admin để chỉnh sửa tệp hệ thống.`);
        }

        try { fs.unlinkSync(tmpPath); } catch (_) { }
    }
}

/**
 * Find workbench.html inside VS Code installation root
 */
export function getWorkbenchPath(): string | null {
    const appRoot = vscode.env.appRoot;
    console.log('[AG Auto] appRoot:', appRoot);

    const candidates = [
        path.join(appRoot, 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html'),
        path.join(appRoot, 'out', 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench.html'),
        path.join(appRoot, 'out', 'vs', 'workbench', 'workbench.html'),
        path.join(appRoot, 'out', 'vs', 'code', 'browser', 'workbench', 'workbench.html'),
        path.join(appRoot, 'out', 'vs', 'code', 'electron-main', 'workbench', 'workbench.html'),
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }

    console.log('[AG Auto] Not found in candidates, searching recursively...');
    const outDir = path.join(appRoot, 'out');
    const found = findFileRecursive(outDir, 'workbench.html', 6);
    return found;
}

/**
 * Helper to recursively find file
 */
export function findFileRecursive(dir: string, filename: string, maxDepth: number): string | null {
    if (maxDepth <= 0) return null;
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isFile() && entry.name === filename) return fullPath;
            if (entry.isDirectory()) {
                const result = findFileRecursive(fullPath, filename, maxDepth - 1);
                if (result) return result;
            }
        }
    } catch (_) { }
    return null;
}

/**
 * Check if the script injection tags exist in workbench.html
 */
export function isScriptInjected(): boolean {
    try {
        const wbPath = getWorkbenchPath();
        if (!wbPath) return false;
        const html = fs.readFileSync(wbPath, 'utf8');
        return html.includes(TAG_START);
    } catch (e: any) {
        console.log('[AG Auto] Cannot check inject status:', e.message);
        return false;
    }
}

/**
 * Generate fresh injected autoScript.js content with replaced configs
 */
export function buildScriptContent(context: vscode.ExtensionContext): string {
    const config = vscode.workspace.getConfiguration('antigravityTelegramControl');
    const intervalMs = config.get<number>('autoAcceptInterval') ?? 800;
    const allPatterns = config.get<string[]>('clickPatterns') ?? ["Allow", "Always Allow", "Run", "Keep Waiting", "Accept all", "Accept"];
    const enabled = config.get<boolean>('autoAccept') ?? false;

    // Filter out 'Accept' for standard click patterns (it is handled separately as chat-only)
    const patterns = allPatterns.filter(p => p !== 'Accept');

    // Read script template
    const templatePath = path.join(context.extensionPath, 'resources', 'autoScript.js');
    let script = fs.readFileSync(templatePath, 'utf8');

    // Replace placeholders
    script = script.replace(/\/\*\{\{CLICK_INTERVAL_MS\}\}\*\/\d+/, intervalMs.toString());
    script = script.replace(
        /\/\*\{\{CLICK_PATTERNS\}\}\*\/\[.*?\]/,
        JSON.stringify(patterns)
    );
    script = script.replace(/\/\*\{\{ENABLED\}\}\*\/\w+/, enabled.toString());

    return script;
}

/**
 * Write ag-auto-config.json file for real-time changes without restarting VS Code
 */
export function writeConfigJson(context: vscode.ExtensionContext): void {
    try {
        const wbPath = getWorkbenchPath();
        if (!wbPath) return;
        const wbDir = path.dirname(wbPath);
        const config = vscode.workspace.getConfiguration('antigravityTelegramControl');

        const allPatterns = config.get<string[]>('clickPatterns') ?? ["Allow", "Always Allow", "Run", "Keep Waiting", "Accept all", "Accept"];
        const activePatterns = allPatterns.filter(p => p !== 'Accept');
        const acceptEnabled = allPatterns.includes('Accept');
        const enabled = config.get<boolean>('autoAccept') ?? false;

        const configData = JSON.stringify({
            enabled: enabled,
            clickPatterns: activePatterns,
            acceptInChatOnly: acceptEnabled,
            clickIntervalMs: config.get<number>('autoAcceptInterval') ?? 800
        });
        const configPath = path.join(wbDir, 'ag-auto-config.json');
        writeFileElevated(configPath, configData);
        console.log('[AG Auto] Config JSON updated:', configData);
    } catch (e: any) {
        console.error('[AG Auto] Error writing config JSON:', e.message);
    }
}

/**
 * Injects script references into workbench.html
 */
export function installScript(context: vscode.ExtensionContext): boolean {
    console.log('[AG Auto] installScript() running...');
    const wbPath = getWorkbenchPath();
    if (!wbPath) {
        console.error('[AG Auto] Could not find workbench.html!');
        vscode.window.showErrorMessage('[AG Auto] Không tìm thấy workbench.html! Vui lòng cài đặt lại hoặc nâng cấp IDE.');
        return false;
    }
    console.log('[AG Auto] Found workbench.html at:', wbPath);

    const wbDir = path.dirname(wbPath);
    const scriptContent = buildScriptContent(context);

    // 1. Cleanup old script entries (if any)
    const JS_TAG_START = '/* AG-AUTO-CLICK-SCROLL-JS-START */';
    const JS_TAG_END = '/* AG-AUTO-CLICK-SCROLL-JS-END */';

    try {
        const htmlContent = fs.readFileSync(wbPath, 'utf8');
        const scriptMatches = htmlContent.match(/src="([^"]*\.js)"/g) || [];
        const jsFiles = new Set<string>();

        for (const match of scriptMatches) {
            const srcMatch = match.match(/src="([^"]*\.js)"/);
            if (srcMatch) {
                const jsName = path.basename(srcMatch[1].split('?')[0]);
                if (jsName === 'ag-auto-script.js') continue;
                const sameDirPath = path.join(wbDir, jsName);
                if (fs.existsSync(sameDirPath)) jsFiles.add(sameDirPath);
                const parent1 = path.join(wbDir, '..', jsName);
                if (fs.existsSync(parent1)) jsFiles.add(path.resolve(parent1));
                const parent2 = path.join(wbDir, '..', '..', jsName);
                if (fs.existsSync(parent2)) jsFiles.add(path.resolve(parent2));
            }
        }

        // Fallback: check main js files
        if (jsFiles.size === 0) {
            const fallbackNames = ['workbench.desktop.main.js', 'workbench.js'];
            for (const name of fallbackNames) {
                const found = findFileRecursive(path.join(wbDir, '..'), name, 3);
                if (found) { jsFiles.add(found); break; }
            }
        }

        for (const jsPath of jsFiles) {
            let jsContent = fs.readFileSync(jsPath, 'utf8');
            const jsRegex = new RegExp(`${escapeRegex(JS_TAG_START)}[\\s\\S]*?${escapeRegex(JS_TAG_END)}`, 'g');
            if (jsRegex.test(jsContent)) {
                jsContent = jsContent.replace(jsRegex, '');
                writeFileElevated(jsPath, jsContent);
                console.log('[AG Auto] Cleaned old script inject from', path.basename(jsPath));
            }
        }
    } catch (err: any) {
        console.error('[AG Auto] JS cleanup error:', err.message);
    }

    // 2. Write ag-auto-script.js and inject into HTML
    try {
        let html = fs.readFileSync(wbPath, 'utf8');
        const htmlRegex = new RegExp(`${escapeRegex(TAG_START)}[\\s\\S]*?${escapeRegex(TAG_END)}`, 'g');
        html = html.replace(htmlRegex, '');

        const ts = Date.now();
        const destPath = path.join(wbDir, 'ag-auto-script.js');
        writeFileElevated(destPath, scriptContent);

        const injection = `\n${TAG_START}\n<script src="ag-auto-script.js?v=${ts}"></script>\n${TAG_END}`;
        html = html.replace('</html>', injection + '\n</html>');

        writeFileElevated(wbPath, html);
        console.log('[AG Auto] HTML Injection complete (v=' + ts + ')');
    } catch (err: any) {
        console.error('[AG Auto] HTML Injection error:', err.message);
        throw err;
    }

    return true;
}

/**
 * Remove script injection from workbench
 */
export function uninstallScript(): boolean {
    const wbPath = getWorkbenchPath();
    if (!wbPath) return false;

    const wbDir = path.dirname(wbPath);
    const JS_TAG_START = '/* AG-AUTO-CLICK-SCROLL-JS-START */';
    const JS_TAG_END = '/* AG-AUTO-CLICK-SCROLL-JS-END */';

    try {
        // Remove from HTML
        let html = fs.readFileSync(wbPath, 'utf8');
        const htmlRegex = new RegExp(`${escapeRegex(TAG_START)}[\\s\\S]*?${escapeRegex(TAG_END)}`, 'g');
        html = html.replace(htmlRegex, '');
        writeFileElevated(wbPath, html);

        // Delete script file
        const scriptPath = path.join(wbDir, 'ag-auto-script.js');
        if (fs.existsSync(scriptPath)) {
            try { fs.unlinkSync(scriptPath); } catch (_) { }
        }

        // Clean from main js files
        const mainJsCandidates = ['workbench.desktop.main.js', 'workbench.js'];
        for (const name of mainJsCandidates) {
            const p = path.join(wbDir, name);
            if (fs.existsSync(p)) {
                let js = fs.readFileSync(p, 'utf8');
                const jsRegex = new RegExp(`${escapeRegex(JS_TAG_START)}[\\s\\S]*?${escapeRegex(JS_TAG_END)}`, 'g');
                if (jsRegex.test(js)) {
                    js = js.replace(jsRegex, '');
                    writeFileElevated(p, js);
                }
            }
        }

        return true;
    } catch (err: any) {
        vscode.window.showErrorMessage(`[AG Auto] Không thể gỡ bỏ script: ${err.message}`);
        return false;
    }
}

/**
 * Recalculates product.json checksums to suppress VS Code's corrupt installation warning
 */
export function updateProductChecksums(): boolean {
    try {
        let productJsonPath: string | null = null;

        if ((process as any).resourcesPath) {
            const candidate = path.join((process as any).resourcesPath, 'app', 'product.json');
            if (fs.existsSync(candidate)) productJsonPath = candidate;
        }

        if (!productJsonPath) {
            const wbPath = getWorkbenchPath();
            if (!wbPath) return false;
            let searchDir = path.dirname(wbPath);
            for (let i = 0; i < 8; i++) {
                const candidate = path.join(searchDir, 'product.json');
                if (fs.existsSync(candidate)) {
                    productJsonPath = candidate;
                    break;
                }
                searchDir = path.dirname(searchDir);
            }
        }

        if (!productJsonPath) {
            console.log('[AG Auto] product.json not found, skipping checksum update');
            return false;
        }

        console.log('[AG Auto] Found product.json:', productJsonPath);
        const productJson = JSON.parse(fs.readFileSync(productJsonPath, 'utf8'));

        if (!productJson.checksums) {
            console.log('[AG Auto] product.json has no checksums field, skipping');
            return false;
        }

        const appRoot = path.dirname(productJsonPath);
        const outDir = path.join(appRoot, 'out');
        let updated = false;

        for (const relativePath in productJson.checksums) {
            const nativePath = relativePath.split('/').join(path.sep);
            let filePath = path.join(outDir, nativePath);
            if (!fs.existsSync(filePath)) filePath = path.join(appRoot, nativePath);

            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath);
                const hash = crypto.createHash('sha256').update(content).digest('base64').replace(/=+$/, '');
                const oldHash = productJson.checksums[relativePath];
                if (oldHash !== hash) {
                    productJson.checksums[relativePath] = hash;
                    updated = true;
                    console.log('[AG Auto] Checksum updated:', relativePath, '(old:', oldHash.substring(0, 10) + '...', 'new:', hash.substring(0, 10) + '...)');
                }
            }
        }

        if (updated) {
            writeFileElevated(productJsonPath, JSON.stringify(productJson, null, '\t'));
            console.log('[AG Auto] ✅ product.json checksums updated!');
        } else {
            console.log('[AG Auto] Checksums already current');
        }
        return updated;
    } catch (e: any) {
        console.error('[AG Auto] Checksum update failed:', e.message);
        return false;
    }
}

/**
 * Clear V8 bytecode cache directories to force Electron window reload to load fresh code
 */
export function clearV8CodeCache(): void {
    try {
        const appDataDir = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        const codeCacheDir = path.join(appDataDir, 'Antigravity', 'Code Cache', 'js');
        if (fs.existsSync(codeCacheDir)) {
            fs.rmSync(codeCacheDir, { recursive: true, force: true });
            console.log('[AG Auto] Cleared V8 code cache:', codeCacheDir);
        } else {
            console.log('[AG Auto] V8 code cache dir not found:', codeCacheDir);
        }
    } catch (e: any) {
        console.log('[AG Auto] Could not clear code cache:', e.message);
    }
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
