const { app, BrowserWindow, ipcMain, Menu, MenuItem, dialog, shell, session, webFrameMain, globalShortcut, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const os = require('os');
const express = require('express');
const { google } = require('googleapis');
const url = require('url');

app.setName('nosh');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Load local environment variables from .env if present (git-ignored)
try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        for (const line of content.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx > 0) {
                const key = trimmed.slice(0, eqIdx).trim();
                let val = trimmed.slice(eqIdx + 1).trim();
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.slice(1, -1);
                }
                if (!process.env[key]) {
                    process.env[key] = val;
                }
            }
        }
    }
} catch (e) {
    console.error('Error loading .env in main process:', e);
}

const port = 2222;

const noshTray = require('./tray');
const notesRoots = require('./notes-roots');

let loadingWindow;
let win;
let quitIntent = false;       // set by the tray's "Quit Nosh" right before closing the window
let pendingCloseIsQuit = false;
let savesDir;
let saveFolder;
let pendingNshFile = null;

function extractNshFileFromArgv(argv) {
    if (!Array.isArray(argv)) return null;
    for (let i = 1; i < argv.length; i++) {
        const arg = argv[i];
        if (typeof arg === 'string' && arg.toLowerCase().endsWith('.nsh') && fs.existsSync(arg)) {
            return arg;
        }
    }
    return null;
}

function sendNshFileToRenderer(filePath) {
    if (!filePath || !fs.existsSync(filePath) || !win || win.isDestroyed()) return;
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const fileName = path.basename(filePath, path.extname(filePath));
        win.webContents.send('open-nsh-file', { filePath, fileName, content });
    } catch (err) {
        console.error('Error reading external .nsh file:', err);
    }
}

pendingNshFile = extractNshFileFromArgv(process.argv);

if (app.isPackaged) {
    const gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock) {
        app.quit();
    } else {
        app.on('second-instance', (event, commandLine) => {
            if (win && !win.isDestroyed()) {
                if (win.isMinimized()) win.restore();
                win.show();
                win.focus();
                const extNsh = extractNshFileFromArgv(commandLine);
                if (extNsh) {
                    sendNshFileToRenderer(extNsh);
                }
            }
        });
    }
}

function initSaveFolder() {
    const defaultNoshSaves = path.join(app.getPath('appData'), 'nosh', 'Saves');
    if (process.env.NOSH_E2E === '1' && process.env.NOSH_E2E_SAVES) {
        // End-to-end tests point the app at a throwaway notes folder
        saveFolder = path.resolve(process.env.NOSH_E2E_SAVES);
    } else if (fs.existsSync(defaultNoshSaves)) {
        saveFolder = defaultNoshSaves;
    } else {
        const roamingPath = app.getPath('userData');
        saveFolder = path.join(roamingPath, 'Saves');
    }

    if (!fs.existsSync(saveFolder)) {
        try {
            fs.mkdirSync(saveFolder, { recursive: true });
            console.log(`Folder created: ${saveFolder}`);
        } catch (err) {
            console.error('Error creating saves folder:', err);
        }
    }
    savesDir = saveFolder;
    notesRoots.setDefaultRoot(saveFolder); // the page may read and write inside the default folder
    return saveFolder;
}

function createWindow() {
    initSaveFolder();

    loadingWindow = new BrowserWindow({
        icon: path.join(__dirname, 'icon.ico'),
        width: 360,
        height: 240,
        frame: false,
        transparent: true,
        autoHideMenuBar: true,
        alwaysOnTop: true,
        resizable: false,
        center: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    loadingWindow.loadFile('loading.html');

    win = new BrowserWindow({
        icon: path.join(__dirname, 'icon.ico'),
        webSecurity: true,
        width: 1366,
        height: 768,
        minWidth: 1366,
        minHeight: 620,
        autoHideMenuBar: true,
        frame: false,
        show: false,
        backgroundColor: '#0d0f12',
        webPreferences: {
            // The page has no Node access: everything goes through the whitelisted bridge in preload.js
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false, // preload needs Node for the scoped file API and Google Drive
            webviewTag: false,
            autoplayPolicy: 'no-user-gesture-required'
        }
    });

    win.loadFile('index.html');

    let hasShownMain = false;
    const showMainWindow = () => {
        if (hasShownMain || !win || win.isDestroyed()) return;
        hasShownMain = true;
        win.show();
        win.focus();
        if (loadingWindow && !loadingWindow.isDestroyed()) {
            loadingWindow.close();
        }
    };

    ipcMain.once('app-ready', () => {
        setTimeout(() => {
            showMainWindow();
            if (pendingNshFile) {
                const fileToOpen = pendingNshFile;
                pendingNshFile = null;
                sendNshFileToRenderer(fileToOpen);
            }
        }, 100);
    });

    win.webContents.on('did-finish-load', () => {
        // Fallback: If renderer doesn't send 'app-ready' within 2000ms, show window safely
        setTimeout(showMainWindow, 2000);
    });

    win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('Failed to load index.html:', errorCode, errorDescription);
        showMainWindow();
    });

    win.on('maximize', () => {
        if (win && !win.isDestroyed()) {
            win.webContents.send('window-maximized-state', true);
        }
    });

    win.on('minimize', (event) => {
        if (win && !win.isDestroyed() && noshTray.shouldMinimizeToTray()) {
            event.preventDefault();
            win.hide();
        }
    });

    win.on('unmaximize', () => {
        if (win && !win.isDestroyed()) {
            win.webContents.send('window-maximized-state', false);
        }
    });

    win.on('close', async (event) => {
        event.preventDefault();
        // Remember whether this close attempt is a real quit; a cancelled prompt must not leave it set
        pendingCloseIsQuit = quitIntent;
        quitIntent = false;
        if (win && !win.isDestroyed()) {
            win.webContents.send('confirm-close');
        }
    });

    // The hidden Quick Capture window would otherwise keep the app alive
    win.on('closed', () => {
        destroyQuickCaptureWindow();
    });
}

// Window control IPCs
ipcMain.on('minimize', () => {
    if (win) {
        if (noshTray.shouldMinimizeToTray()) {
            win.hide();
        } else {
            win.minimize();
        }
    }
});

ipcMain.handle('get-tray-prefs', () => {
    return noshTray.getPrefs();
});

ipcMain.handle('set-tray-prefs', (event, newPrefs) => {
    if (newPrefs && typeof newPrefs === 'object') {
        if (typeof newPrefs.keepInTray === 'boolean') {
            noshTray.setKeepInTray(newPrefs.keepInTray);
        }
        if (typeof newPrefs.minimizeToTray === 'boolean') {
            noshTray.setMinimizeToTray(newPrefs.minimizeToTray);
        }
    }
    return noshTray.getPrefs();
});

ipcMain.on('maximize', () => {
    if (!win) return;
    if (win.isMaximized()) {
        win.unmaximize();
    } else {
        win.maximize();
    }
});

ipcMain.handle('is-maximized', () => {
    return win ? win.isMaximized() : false;
});

ipcMain.on('close', () => {
    if (win) win.close();
});

ipcMain.on('proceed-close', (event, shouldClose) => {
    if (!shouldClose || !win || win.isDestroyed()) return;

    // Closing the window keeps Nosh in the tray (so Ctrl+Alt+N keeps working);
    // "Quit Nosh" in the tray menu, or turning the option off, really exits.
    if (!pendingCloseIsQuit && noshTray.shouldKeepInTray()) {
        win.hide();
        noshTray.showHint();
    } else {
        pendingCloseIsQuit = false;
        win.destroy();
    }
});

function showMainWindow() {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
}

// Really quit, still honouring the "unsaved changes" prompt
async function requestQuit() {
    if (!win || win.isDestroyed()) {
        app.quit();
        return;
    }
    let dirty = true;
    try {
        dirty = await win.webContents.executeJavaScript('Boolean(hasUnsavedChanges && activeNoteName)');
    } catch (_) {}

    quitIntent = true;
    if (dirty && !win.isVisible()) showMainWindow(); // the prompt needs a visible window
    win.close();
}

// Only the app's own windows may use the privileged handlers below
function isFromMainWindow(event) {
    return Boolean(win) && !win.isDestroyed() && event.sender === win.webContents;
}

// Folders the page may read and write; see notes-roots.js
ipcMain.on('nosh:get-roots', (event) => {
    event.returnValue = isFromMainWindow(event) ? notesRoots.allRoots() : [];
});

ipcMain.on('nosh:claim-legacy-root', (event, legacyFolder) => {
    if (!isFromMainWindow(event)) {
        event.returnValue = [];
        return;
    }
    notesRoots.claimLegacyRoot(legacyFolder);
    event.returnValue = notesRoots.allRoots();
});

// Shell & Native OS helpers
// Only web links and mail links may be handed to the OS: other schemes (file:, ms-msdt:, custom
// protocol handlers...) can launch programs, so a note must never be able to open them.
function toSafeExternalUrl(rawUrl) {
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;
    let candidate = rawUrl.trim();
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/i.test(candidate)) {
        candidate = 'https://' + candidate;
    }
    try {
        const parsed = new URL(candidate);
        return ['http:', 'https:', 'mailto:'].includes(parsed.protocol) ? parsed.href : null;
    } catch (_) {
        return null;
    }
}

ipcMain.handle('open-external', async (event, externalUrl) => {
    const safeUrl = toSafeExternalUrl(externalUrl);
    if (!safeUrl) {
        console.warn('Blocked opening a non-web URL:', String(externalUrl).slice(0, 80));
        return false;
    }
    try {
        await shell.openExternal(safeUrl);
        return true;
    } catch (err) {
        console.error('Failed to open external URL:', err);
        return false;
    }
});

ipcMain.handle('open-folder', async (event, folderPath) => {
    if (!isFromMainWindow(event)) return false;
    // Opening an arbitrary path would launch it, so only notes folders qualify
    const target = folderPath && notesRoots.isInside(folderPath) ? folderPath : saveFolder;
    if (fs.existsSync(target)) {
        await shell.openPath(target);
        return true;
    }
    return false;
});

ipcMain.handle('select-folder', async (event) => {
    if (!isFromMainWindow(event)) return null;
    const result = await dialog.showOpenDialog(win, {
        title: 'Select Notes Folder',
        properties: ['openDirectory']
    });
    const chosen = result.filePaths[0] || null;
    // The user picked this folder in a native dialog, so the page may use it from now on
    if (chosen && !notesRoots.addUserChosenRoot(chosen)) return null;
    return chosen;
});

ipcMain.handle('get-save-path', () => {
    if (!saveFolder) initSaveFolder();
    return saveFolder;
});

ipcMain.handle('upload-to-catbox', async (event, { filePath, base64Data, fileName, mimeType }) => {
    try {
        let fileBuffer = null;
        let finalName = fileName || 'asset.png';

        // A page-supplied path may only point inside the notes folders; otherwise this would
        // let a script upload any file on the computer
        if (filePath && !notesRoots.isInside(filePath)) {
            return { success: false, error: 'File is outside the notes folder' };
        }

        if (filePath && fs.existsSync(filePath)) {
            fileBuffer = await fs.promises.readFile(filePath);
            if (!fileName) finalName = path.basename(filePath);
        } else if (base64Data) {
            fileBuffer = Buffer.from(base64Data, 'base64');
        } else {
            return { success: false, error: 'File not found on disk' };
        }

        const ext = path.extname(finalName).toLowerCase();
        const mimeMap = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml',
            '.bmp': 'image/bmp',
            '.mp4': 'video/mp4',
            '.webm': 'video/webm',
            '.ogg': 'video/ogg'
        };
        const contentType = mimeType || mimeMap[ext] || 'application/octet-stream';
        const safeFileName = finalName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const boundary = '----NoshCatboxBoundary' + Date.now() + Math.random().toString(16).slice(2);

        const pre = Buffer.from(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="reqtype"\r\n\r\n` +
            `fileupload\r\n` +
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="fileToUpload"; filename="${safeFileName}"\r\n` +
            `Content-Type: ${contentType}\r\n\r\n`,
            'utf8'
        );
        const post = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
        const body = Buffer.concat([pre, fileBuffer, post]);

        const uploadedUrl = await new Promise((resolve, reject) => {
            const req = https.request({
                hostname: 'catbox.moe',
                path: '/user/api.php',
                method: 'POST',
                headers: {
                    'Content-Type': `multipart/form-data; boundary=${boundary}`,
                    'Content-Length': body.length,
                    'User-Agent': 'NoshDesktop/1.3'
                },
                timeout: 45000
            }, (res) => {
                let raw = '';
                res.on('data', chunk => { raw += chunk; });
                res.on('end', () => {
                    const trimmed = raw.trim();
                    if (res.statusCode >= 200 && res.statusCode < 300 && /^https?:\/\//i.test(trimmed)) {
                        resolve(trimmed);
                    } else {
                        reject(new Error(trimmed || `Catbox HTTP ${res.statusCode}`));
                    }
                });
            });

            req.on('timeout', () => {
                req.destroy(new Error('Catbox upload timed out'));
            });
            req.on('error', reject);
            req.write(body);
            req.end();
        });

        return { success: true, url: uploadedUrl };
    } catch (err) {
        console.error('Catbox upload error:', err);
        return { success: false, error: err.message || 'Catbox upload failed' };
    }
});

const zlib = require('zlib');

function decodeXmlEntitiesMain(str) {
    if (!str) return '';
    return String(str)
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
            try { return String.fromCodePoint(parseInt(hex, 16)); } catch (_) { return ''; }
        })
        .replace(/&#(\d+);/g, (_, dec) => {
            try { return String.fromCodePoint(parseInt(dec, 10)); } catch (_) { return ''; }
        })
        .replace(/&amp;/g, '&');
}

function stripNotionUuidMain(rawName) {
    if (!rawName) return '';
    return String(rawName)
        .replace(/\s+[0-9a-fA-F]{32}(?=\.[a-zA-Z0-9]+$|$)/g, '')
        .replace(/\s+[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(?=\.[a-zA-Z0-9]+$|$)/g, '')
        .trim();
}

// Pure-Node ZIP reader supporting Stored (0) and Deflated (8) entries + nested .zip archives
function readZipEntriesMain(buffer, depth = 0) {
    const entries = new Map();
    if (!Buffer.isBuffer(buffer) || buffer.length < 22 || depth > 3) return entries;

    // Locate End of Central Directory (EOCD) signature 0x06054b50
    let eocdOffset = -1;
    const minSearch = Math.max(0, buffer.length - 65558);
    for (let i = buffer.length - 22; i >= minSearch; i--) {
        if (buffer.readUInt32LE(i) === 0x06054b50) {
            eocdOffset = i;
            break;
        }
    }

    if (eocdOffset !== -1) {
        const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
        const cdSize = buffer.readUInt32LE(eocdOffset + 12);
        const cdOffset = buffer.readUInt32LE(eocdOffset + 16);
        let ptr = cdOffset;
        const cdEnd = Math.min(buffer.length, cdOffset + cdSize);

        for (let idx = 0; idx < totalEntries && ptr + 46 <= cdEnd; idx++) {
            if (buffer.readUInt32LE(ptr) !== 0x02014b50) break;
            const compressionMethod = buffer.readUInt16LE(ptr + 10);
            const compressedSize = buffer.readUInt32LE(ptr + 20);
            const fileNameLen = buffer.readUInt16LE(ptr + 28);
            const extraLen = buffer.readUInt16LE(ptr + 30);
            const commentLen = buffer.readUInt16LE(ptr + 32);
            const localHeaderOffset = buffer.readUInt32LE(ptr + 42);
            const entryName = buffer.slice(ptr + 46, ptr + 46 + fileNameLen).toString('utf8').replace(/\\/g, '/');

            ptr += 46 + fileNameLen + extraLen + commentLen;

            if (entryName.endsWith('/') || localHeaderOffset + 30 > buffer.length) continue;
            if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) continue;

            const lNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
            const lExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
            const dataStart = localHeaderOffset + 30 + lNameLen + lExtraLen;
            const dataEnd = Math.min(buffer.length, dataStart + compressedSize);
            if (dataStart > dataEnd) continue;

            const rawSlice = buffer.slice(dataStart, dataEnd);
            try {
                let fileBuf = null;
                if (compressionMethod === 0) {
                    fileBuf = rawSlice;
                } else if (compressionMethod === 8) {
                    fileBuf = zlib.inflateRawSync(rawSlice);
                }
                if (fileBuf) {
                    if (entryName.toLowerCase().endsWith('.zip')) {
                        const nested = readZipEntriesMain(fileBuf, depth + 1);
                        nested.forEach((v, k) => entries.set(k, v));
                    } else {
                        entries.set(entryName, fileBuf);
                    }
                }
            } catch (_) {}
        }
    }

    return entries;
}

// Parse RFC-4180 CSV (Notion Database Export) into HTML table
function parseCsvToHtmlMain(csvText, title = 'Database') {
    const clean = String(csvText || '').replace(/^\uFEFF/, '');
    const rows = [];
    let currentRow = [];
    let currentCell = '';
    let inQuotes = false;

    for (let i = 0; i < clean.length; i++) {
        const ch = clean[i];
        const next = clean[i + 1];
        if (inQuotes) {
            if (ch === '"' && next === '"') {
                currentCell += '"';
                i++;
            } else if (ch === '"') {
                inQuotes = false;
            } else {
                currentCell += ch;
            }
        } else {
            if (ch === '"') {
                inQuotes = true;
            } else if (ch === ',') {
                currentRow.push(currentCell.trim());
                currentCell = '';
            } else if (ch === '\r' && next === '\n') {
                currentRow.push(currentCell.trim());
                if (currentRow.some(c => c !== '')) rows.push(currentRow);
                currentRow = [];
                currentCell = '';
                i++;
            } else if (ch === '\n' || ch === '\r') {
                currentRow.push(currentCell.trim());
                if (currentRow.some(c => c !== '')) rows.push(currentRow);
                currentRow = [];
                currentCell = '';
            } else {
                currentCell += ch;
            }
        }
    }
    if (currentCell.length > 0 || currentRow.length > 0) {
        currentRow.push(currentCell.trim());
        if (currentRow.some(c => c !== '')) rows.push(currentRow);
    }

    if (rows.length === 0) {
        return `<h1>${escapeHtmlMain(title)}</h1><p><br></p>`;
    }

    const headers = rows[0].map(h => stripNotionUuidMain(h));
    const bodyRows = rows.slice(1);
    const ths = headers.map(h => `<th>${escapeHtmlMain(h)}</th>`).join('');
    const trs = bodyRows.map(r => {
        const tds = headers.map((_, idx) => `<td>${escapeHtmlMain(stripNotionUuidMain(r[idx] || ''))}</td>`).join('');
        return `<tr>${tds}</tr>`;
    }).join('');

    return `<h1>${escapeHtmlMain(title)}</h1><p>Imported Notion Database (${bodyRows.length} records)</p><table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table><p><br></p>`;
}

// Parse PowerPoint (.pptx) into structured Nosh HTML + extracted slide images
function parsePptxBufferMain(buffer, baseName) {
    const entries = readZipEntriesMain(buffer);
    const assets = [];
    const mediaMap = new Map();

    // 1. Collect embedded images under ppt/media/
    entries.forEach((fileBuf, entryName) => {
        if (/^ppt\/media\/.+\.(png|jpe?g|gif|svg|webp)$/i.test(entryName)) {
            const cleanBase = path.basename(entryName).replace(/[^a-zA-Z0-9._-]/g, '_');
            const relAssetPath = `assets/asset_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${cleanBase}`;
            assets.push({ relPath: relAssetPath, bytes: new Uint8Array(fileBuf) });
            mediaMap.set(entryName.toLowerCase(), relAssetPath);
            mediaMap.set(path.basename(entryName).toLowerCase(), relAssetPath);
        }
    });

    // 2. Find all slides sorted by slide number
    const slideEntries = Array.from(entries.keys())
        .filter(k => /^ppt\/slides\/slide\d+\.xml$/i.test(k))
        .sort((a, b) => {
            const numA = parseInt((a.match(/slide(\d+)\.xml/i) || [])[1] || '0', 10);
            const numB = parseInt((b.match(/slide(\d+)\.xml/i) || [])[1] || '0', 10);
            return numA - numB;
        });

    const extractParagraphRunsHtml = (pXml) => {
        const runs = [];
        const runRegex = /<a:r\b[^>]*>([\s\S]*?)<\/a:r>|<a:fld\b[^>]*>([\s\S]*?)<\/a:fld>|<a:br\b[^>]*\/?>/gi;
        let m;
        while ((m = runRegex.exec(pXml)) !== null) {
            if (m[0].toLowerCase().startsWith('<a:br')) {
                runs.push('<br>');
                continue;
            }
            const inner = m[1] || m[2] || '';
            const tMatches = inner.match(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/gi);
            if (!tMatches) continue;
            const rawText = tMatches.map(t => decodeXmlEntitiesMain(t.replace(/<\/?a:t[^>]*>/gi, ''))).join('');
            if (!rawText) continue;
            let htmlRun = escapeHtmlMain(rawText);
            const rPrMatch = inner.match(/<a:rPr\b([^>]*)\/?>/i);
            const rPrAttrs = rPrMatch ? rPrMatch[1] : '';
            if (/\bb="(?:1|true)"/i.test(rPrAttrs)) htmlRun = `<strong>${htmlRun}</strong>`;
            if (/\bi="(?:1|true)"/i.test(rPrAttrs)) htmlRun = `<em>${htmlRun}</em>`;
            if (/\bu="(?:sng|dbl|heavy|1|true)"/i.test(rPrAttrs)) htmlRun = `<u>${htmlRun}</u>`;
            runs.push(htmlRun);
        }
        if (runs.length === 0) {
            const fallbackT = pXml.match(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/gi);
            if (fallbackT) {
                return escapeHtmlMain(fallbackT.map(t => decodeXmlEntitiesMain(t.replace(/<\/?a:t[^>]*>/gi, ''))).join(''));
            }
        }
        return runs.join('');
    };

    const slideHtmlBlocks = [];

    slideEntries.forEach((slidePath, idx) => {
        const slideNum = idx + 1;
        const slideXml = entries.get(slidePath).toString('utf8');

        // Parse slide relationships for images
        const relsPath = `ppt/slides/_rels/${path.basename(slidePath)}.rels`;
        const rIdToAsset = new Map();
        if (entries.has(relsPath)) {
            const relsXml = entries.get(relsPath).toString('utf8');
            const relRegex = /<Relationship\b([^>]*)\/?>/gi;
            let rm;
            while ((rm = relRegex.exec(relsXml)) !== null) {
                const attrs = rm[1];
                const idMatch = attrs.match(/\bId="([^"]+)"/i);
                const targetMatch = attrs.match(/\bTarget="([^"]+)"/i);
                if (idMatch && targetMatch) {
                    const baseTarget = path.basename(targetMatch[1]).toLowerCase();
                    if (mediaMap.has(baseTarget)) {
                        rIdToAsset.set(idMatch[1], mediaMap.get(baseTarget));
                    }
                }
            }
        }

        let slideTitle = '';
        const bodyItems = [];
        const tableBlocks = [];
        const slideImages = [];

        // Extract shapes (<p:sp>)
        const spRegex = /<p:sp\b[\s\S]*?<\/p:sp>/gi;
        let spMatch;
        while ((spMatch = spRegex.exec(slideXml)) !== null) {
            const spXml = spMatch[0];
            const isTitle = /<p:ph\b[^>]*type="(?:title|ctrTitle)"/i.test(spXml);
            const isSubTitle = /<p:ph\b[^>]*type="subTitle"/i.test(spXml);
            const pRegex = /<a:p\b[\s\S]*?<\/a:p>/gi;
            let pMatch;
            const shapeParagraphs = [];

            while ((pMatch = pRegex.exec(spXml)) !== null) {
                const pXml = pMatch[0];
                const pHtml = extractParagraphRunsHtml(pXml).trim();
                if (!pHtml) continue;
                const lvlMatch = pXml.match(/<a:pPr\b[^>]*\blvl="(\d+)"/i);
                const level = lvlMatch ? parseInt(lvlMatch[1], 10) : 0;
                const hasBuNone = /<a:buNone\b/i.test(pXml);
                shapeParagraphs.push({ html: pHtml, level, isBullet: !isTitle && !isSubTitle && !hasBuNone });
            }

            if (shapeParagraphs.length === 0) continue;

            if (isTitle && !slideTitle) {
                slideTitle = shapeParagraphs.map(p => p.html.replace(/<[^>]+>/g, '')).join(' — ').trim();
            } else if (isSubTitle) {
                shapeParagraphs.forEach(p => bodyItems.push({ type: 'subtitle', html: p.html }));
            } else {
                shapeParagraphs.forEach(p => bodyItems.push({ type: p.isBullet ? 'bullet' : 'para', html: p.html, level: p.level }));
            }
        }

        // Extract tables (<a:tbl>)
        const tblRegex = /<a:tbl\b[\s\S]*?<\/a:tbl>/gi;
        let tblMatch;
        while ((tblMatch = tblRegex.exec(slideXml)) !== null) {
            const tblXml = tblMatch[0];
            const trRegex = /<a:tr\b[\s\S]*?<\/a:tr>/gi;
            const rows = [];
            let trMatch;
            while ((trMatch = trRegex.exec(tblXml)) !== null) {
                const trXml = trMatch[0];
                const tcRegex = /<a:tc\b[\s\S]*?<\/a:tc>/gi;
                const cells = [];
                let tcMatch;
                while ((tcMatch = tcRegex.exec(trXml)) !== null) {
                    const tcXml = tcMatch[0];
                    const pRegex = /<a:p\b[\s\S]*?<\/a:p>/gi;
                    const cellParts = [];
                    let pm;
                    while ((pm = pRegex.exec(tcXml)) !== null) {
                        const txt = extractParagraphRunsHtml(pm[0]).trim();
                        if (txt) cellParts.push(txt);
                    }
                    cells.push(cellParts.join('<br>'));
                }
                if (cells.length > 0) rows.push(cells);
            }
            if (rows.length > 0) {
                const head = rows[0].map(c => `<th>${c}</th>`).join('');
                const body = rows.slice(1).map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
                tableBlocks.push(`<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`);
            }
        }

        // Extract pictures (<p:pic>)
        const picRegex = /<p:pic\b[\s\S]*?<\/p:pic>/gi;
        let picMatch;
        while ((picMatch = picRegex.exec(slideXml)) !== null) {
            const blipMatch = picMatch[0].match(/\br:embed="([^"]+)"/i);
            if (blipMatch && rIdToAsset.has(blipMatch[1])) {
                const assetRel = rIdToAsset.get(blipMatch[1]);
                if (!slideImages.includes(assetRel)) {
                    slideImages.push(assetRel);
                }
            }
        }

        // Extract speaker notes if present (ppt/notesSlides/notesSlideN.xml)
        let notesText = '';
        const notesPath = `ppt/notesSlides/notesSlide${slideNum}.xml`;
        if (entries.has(notesPath)) {
            const notesXml = entries.get(notesPath).toString('utf8');
            const spNotesRegex = /<p:sp\b[\s\S]*?<\/p:sp>/gi;
            const noteParas = [];
            let nm;
            while ((nm = spNotesRegex.exec(notesXml)) !== null) {
                if (/<p:ph\b[^>]*type="body"/i.test(nm[0])) {
                    const pRegex = /<a:p\b[\s\S]*?<\/a:p>/gi;
                    let pm;
                    while ((pm = pRegex.exec(nm[0])) !== null) {
                        const txt = extractParagraphRunsHtml(pm[0]).trim();
                        if (txt) noteParas.push(txt);
                    }
                }
            }
            if (noteParas.length > 0) {
                notesText = noteParas.join('<br>');
            }
        }

        // Fallback title if slide had no explicit title placeholder
        if (!slideTitle && bodyItems.length > 0) {
            const first = bodyItems.shift();
            slideTitle = first.html.replace(/<[^>]+>/g, '').trim();
        }

        const headingTitle = slideTitle ? `Slide ${slideNum} — ${escapeHtmlMain(slideTitle)}` : `Slide ${slideNum}`;
        const slideParts = [`<h2>${headingTitle}</h2>`];

        let bulletBuffer = [];
        const flushBullets = () => {
            if (bulletBuffer.length > 0) {
                slideParts.push(`<ul>${bulletBuffer.join('')}</ul>`);
                bulletBuffer = [];
            }
        };

        bodyItems.forEach(item => {
            if (item.type === 'subtitle') {
                flushBullets();
                slideParts.push(`<p><strong>${item.html}</strong></p>`);
            } else if (item.type === 'bullet') {
                const indentStyle = item.level > 0 ? ` style="margin-left:${item.level * 18}px"` : '';
                bulletBuffer.push(`<li${indentStyle}>${item.html}</li>`);
            } else {
                flushBullets();
                slideParts.push(`<p>${item.html}</p>`);
            }
        });
        flushBullets();

        tableBlocks.forEach(tbl => slideParts.push(tbl));
        slideImages.forEach(rel => {
            slideParts.push(`<div class="media-container resizable" contenteditable="false"><img src="${rel}" data-asset-rel="${rel}" alt="Slide ${slideNum}" style="max-width: 100%;"></div>`);
        });
        if (notesText) {
            slideParts.push(`<blockquote><strong>Speaker notes:</strong> ${notesText}</blockquote>`);
        }

        slideHtmlBlocks.push(`<div class="imported-slide-card">${slideParts.join('\n')}</div>`);
    });

    const cleanTitle = stripNotionUuidMain(baseName) || 'Presentation';
    const html = `<h1>${escapeHtmlMain(cleanTitle)}</h1>\n${slideHtmlBlocks.join('\n<hr>\n')}<p><br></p>`;
    return { title: cleanTitle, html, assets };
}

// Parse Word (.docx) into structured Nosh HTML
function parseDocxBufferMain(buffer, baseName) {
    const entries = readZipEntriesMain(buffer);
    const cleanTitle = stripNotionUuidMain(baseName) || 'Document';
    if (!entries.has('word/document.xml')) {
        return { title: cleanTitle, html: `<h1>${escapeHtmlMain(cleanTitle)}</h1><p><br></p>`, assets: [] };
    }
    const xml = entries.get('word/document.xml').toString('utf8');
    const parts = [`<h1>${escapeHtmlMain(cleanTitle)}</h1>`];
    const pRegex = /<w:p\b[\s\S]*?<\/w:p>/gi;
    let m;
    while ((m = pRegex.exec(xml)) !== null) {
        const pXml = m[0];
        const tMatches = pXml.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/gi);
        if (!tMatches) continue;
        const text = tMatches.map(t => decodeXmlEntitiesMain(t.replace(/<\/?w:t[^>]*>/gi, ''))).join('').trim();
        if (!text) continue;
        const styleMatch = pXml.match(/<w:pStyle\b[^>]*w:val="([^"]+)"/i);
        const styleVal = styleMatch ? styleMatch[1].toLowerCase() : '';
        if (styleVal.includes('heading1') || styleVal === 'title') {
            parts.push(`<h2>${escapeHtmlMain(text)}</h2>`);
        } else if (styleVal.includes('heading2')) {
            parts.push(`<h2>${escapeHtmlMain(text)}</h2>`);
        } else if (styleVal.includes('heading3')) {
            parts.push(`<h3>${escapeHtmlMain(text)}</h3>`);
        } else if (/<w:numPr\b/i.test(pXml)) {
            parts.push(`<ul><li>${escapeHtmlMain(text)}</li></ul>`);
        } else {
            parts.push(`<p>${escapeHtmlMain(text)}</p>`);
        }
    }
    parts.push('<p><br></p>');
    return { title: cleanTitle, html: parts.join('\n'), assets: [] };
}

// Parse PDF (.pdf) buffer into structured Nosh HTML (supports FlateDecode, ObjStm, ToUnicode CMap, TJ/Tj, UTF-16BE & WinAnsi)
function parsePdfBufferMain(buffer, baseName) {
    const cleanTitle = stripNotionUuidMain(baseName) || 'PDF Document';
    const rawStr = buffer.toString('latin1');

    // Helper: inflate FlateDecode stream buffer
    const inflatePdfStream = (rawStreamBuf) => {
        let trimmed = rawStreamBuf;
        if (trimmed.length >= 2 && trimmed[0] === 0x0d && trimmed[1] === 0x0a) trimmed = trimmed.slice(2);
        else if (trimmed.length >= 1 && (trimmed[0] === 0x0a || trimmed[0] === 0x0d)) trimmed = trimmed.slice(1);
        if (trimmed.length >= 2 && trimmed[trimmed.length - 2] === 0x0d && trimmed[trimmed.length - 1] === 0x0a) trimmed = trimmed.slice(0, -2);
        else if (trimmed.length >= 1 && (trimmed[trimmed.length - 1] === 0x0a || trimmed[trimmed.length - 1] === 0x0d)) trimmed = trimmed.slice(0, -1);

        try {
            return zlib.inflateSync(trimmed);
        } catch (_) {
            try {
                return zlib.inflateRawSync(trimmed);
            } catch (_2) {
                return null;
            }
        }
    };

    // 1. Decompress all streams and collect ToUnicode CMaps + content streams
    const globalUnicodeMap = new Map();
    const decompressedStreams = [];

    const streamRegex = /<<([\s\S]*?)>>\s*stream\b/g;
    let sm;
    while ((sm = streamRegex.exec(rawStr)) !== null) {
        const dict = sm[1];
        const streamStart = sm.index + sm[0].length;
        const endPos = rawStr.indexOf('endstream', streamStart);
        if (endPos === -1) continue;

        // Skip images and binary font programs
        if (/\/Subtype\s*\/Image\b/i.test(dict) || /\/Length1\b/i.test(dict) || /\/Subtype\s*\/Type1C\b/i.test(dict) || /\/Subtype\s*\/CIDFontType0C\b/i.test(dict)) {
            continue;
        }

        const rawSlice = buffer.slice(streamStart, endPos);
        let decodedBuf = rawSlice;
        if (/\/FlateDecode\b/i.test(dict)) {
            const inf = inflatePdfStream(rawSlice);
            if (!inf) continue;
            decodedBuf = inf;
        }

        const textContent = decodedBuf.toString('latin1');

        // Parse ToUnicode CMap if present
        if (textContent.includes('begincmap') || textContent.includes('beginbfchar') || textContent.includes('beginbfrange')) {
            const bfCharRegex = /beginbfchar([\s\S]*?)endbfchar/g;
            let bfc;
            while ((bfc = bfCharRegex.exec(textContent)) !== null) {
                const pairRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
                let pm;
                while ((pm = pairRegex.exec(bfc[1])) !== null) {
                    const srcCode = parseInt(pm[1], 16);
                    const dstHex = pm[2];
                    let str = '';
                    for (let k = 0; k < dstHex.length; k += 4) {
                        const cp = parseInt(dstHex.slice(k, k + 4), 16);
                        if (!isNaN(cp)) str += String.fromCodePoint(cp);
                    }
                    if (str) globalUnicodeMap.set(srcCode, str);
                }
            }

            const bfRangeRegex = /beginbfrange([\s\S]*?)endbfrange/g;
            let bfr;
            while ((bfr = bfRangeRegex.exec(textContent)) !== null) {
                const rangeLineRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
                let rm;
                while ((rm = rangeLineRegex.exec(bfr[1])) !== null) {
                    const startCode = parseInt(rm[1], 16);
                    const endCode = parseInt(rm[2], 16);
                    let targetCp = parseInt(rm[3], 16);
                    for (let c = startCode; c <= endCode && c - startCode < 1024; c++) {
                        try {
                            globalUnicodeMap.set(c, String.fromCodePoint(targetCp));
                        } catch (_) {}
                        targetCp++;
                    }
                }
            }
            continue;
        }

        if (/\bBT\b[\s\S]*?\bET\b/.test(textContent)) {
            decompressedStreams.push(textContent);
        }
    }

    const hasWideCodes = Array.from(globalUnicodeMap.keys()).some(k => k > 255);

    const decodePdfLiteralString = (lit) => {
        let bytes = [];
        for (let i = 0; i < lit.length; i++) {
            const ch = lit[i];
            if (ch === '\\') {
                const next = lit[++i];
                if (next === 'n') bytes.push(10);
                else if (next === 'r') bytes.push(13);
                else if (next === 't') bytes.push(9);
                else if (next === 'b') bytes.push(8);
                else if (next === 'f') bytes.push(12);
                else if (next === '(' || next === ')' || next === '\\') bytes.push(next.charCodeAt(0));
                else if (next >= '0' && next <= '7') {
                    let oct = next;
                    if (lit[i + 1] >= '0' && lit[i + 1] <= '7') oct += lit[++i];
                    if (lit[i + 1] >= '0' && lit[i + 1] <= '7') oct += lit[++i];
                    bytes.push(parseInt(oct, 8));
                } else if (next !== undefined) {
                    bytes.push(next.charCodeAt(0));
                }
            } else {
                bytes.push(ch.charCodeAt(0));
            }
        }
        // UTF-16BE BOM check
        if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
            let out = '';
            for (let j = 2; j + 1 < bytes.length; j += 2) {
                out += String.fromCharCode((bytes[j] << 8) | bytes[j + 1]);
            }
            return out;
        }
        if (hasWideCodes && bytes.length >= 2 && bytes.length % 2 === 0) {
            let wide = '';
            let hits = 0;
            for (let j = 0; j + 1 < bytes.length; j += 2) {
                const code = (bytes[j] << 8) | bytes[j + 1];
                if (globalUnicodeMap.has(code)) { wide += globalUnicodeMap.get(code); hits++; }
            }
            if (hits >= bytes.length / 4) return wide;
        }
        return bytes.map(b => {
            if (globalUnicodeMap.has(b)) return globalUnicodeMap.get(b);
            return String.fromCharCode(b);
        }).join('');
    };

    const decodePdfHexString = (hex) => {
        const cleanHex = hex.replace(/\s+/g, '');
        if (cleanHex.toUpperCase().startsWith('FEFF')) {
            let out = '';
            for (let i = 4; i + 3 < cleanHex.length; i += 4) {
                const cp = parseInt(cleanHex.slice(i, i + 4), 16);
                if (!isNaN(cp)) out += String.fromCodePoint(cp);
            }
            return out;
        }
        if (cleanHex.length % 4 === 0 && globalUnicodeMap.size > 0) {
            let out4 = '';
            let matched4 = 0;
            for (let i = 0; i < cleanHex.length; i += 4) {
                const code = parseInt(cleanHex.slice(i, i + 4), 16);
                if (globalUnicodeMap.has(code)) {
                    out4 += globalUnicodeMap.get(code);
                    matched4++;
                } else if (code >= 32 && code < 0xd800) {
                    out4 += String.fromCharCode(code);
                }
            }
            if (matched4 > 0) return out4;
        }
        let out2 = '';
        for (let i = 0; i < cleanHex.length; i += 2) {
            const code = parseInt(cleanHex.slice(i, i + 2), 16);
            if (globalUnicodeMap.has(code)) out2 += globalUnicodeMap.get(code);
            else if (code >= 32) out2 += String.fromCharCode(code);
        }
        return out2;
    };

    const pageBlocks = [];
    decompressedStreams.forEach((streamText) => {
        const lines = [];
        let currentLine = '';
        let tfSize = 12;
        let tmScale = 1;
        let lastY = null;
        let matrixFresh = true;
        const pushLine = () => {
            if (currentLine.trim()) {
                lines.push({ text: currentLine.trim(), fontSize: Math.round(Math.abs(tfSize * tmScale) * 10) / 10 || 12 });
            }
            currentLine = '';
        };
        const addSpace = () => {
            if (currentLine && !currentLine.endsWith(' ')) currentLine += ' ';
        };

        const btRegex = /\bBT\b([\s\S]*?)\bET\b/g;
        let btMatch;
        while ((btMatch = btRegex.exec(streamText)) !== null) {
            const block = btMatch[1];
            matrixFresh = true;
            tmScale = 1;
            // 1: Tf size | 2-7: Tm a b c d e f | 8-9: Td/TD dx dy | 10: TJ array | 11: literal Tj/'/" | 12: hex Tj
            const tokenRegex = /\/[^\s/\[\]()<>]+\s+(-?[\d.]+)\s+Tf|(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm|(-?[\d.]+)\s+(-?[\d.]+)\s+T[dD]\b|\bT\*|\[((?:\\.|[^\]\\])*)\]\s*TJ|\(((?:\\.|[^\\()])*)\)\s*(?:Tj|'|")|<([0-9a-fA-F\s]+)>\s*Tj/g;
            let tm;
            while ((tm = tokenRegex.exec(block)) !== null) {
                if (tm[1] !== undefined) {
                    tfSize = Math.abs(parseFloat(tm[1])) || tfSize;
                } else if (tm[2] !== undefined) {
                    const scale = Math.abs(parseFloat(tm[5])) || Math.abs(parseFloat(tm[2])) || 1;
                    const y = parseFloat(tm[7]);
                    if (lastY !== null && Math.abs(y - lastY) > 1) pushLine();
                    tmScale = scale;
                    lastY = y;
                    matrixFresh = false;
                } else if (tm[8] !== undefined) {
                    const dx = parseFloat(tm[8]);
                    const dy = parseFloat(tm[9]);
                    if (matrixFresh) {
                        // First Td after BT is relative to the identity matrix, i.e. absolute
                        if (lastY !== null && Math.abs(dy - lastY) > 1) pushLine();
                        else if (dx !== 0) addSpace();
                        lastY = dy;
                        matrixFresh = false;
                    } else if (Math.abs(dy) > 0.5) {
                        pushLine();
                        if (lastY !== null) lastY += dy * tmScale;
                    } else if (dx !== 0) {
                        addSpace();
                    }
                } else if (tm[0] === 'T*') {
                    pushLine();
                } else if (tm[10] !== undefined) {
                    const itemRegex = /\(((?:\\.|[^\\()])*)\)|<([0-9a-fA-F\s]+)>|(-?[\d.]+)/g;
                    let im;
                    while ((im = itemRegex.exec(tm[10])) !== null) {
                        if (im[1] !== undefined) {
                            currentLine += decodePdfLiteralString(im[1]);
                        } else if (im[2] !== undefined) {
                            currentLine += decodePdfHexString(im[2]);
                        } else if (im[3] !== undefined && parseFloat(im[3]) < -120) {
                            addSpace();
                        }
                    }
                } else if (tm[11] !== undefined) {
                    if (/['"]\s*$/.test(tm[0])) pushLine();
                    currentLine += decodePdfLiteralString(tm[11]);
                } else if (tm[12] !== undefined) {
                    currentLine += decodePdfHexString(tm[12]);
                }
            }
        }
        pushLine();

        const cleanedLines = lines
            .map(l => ({ text: l.text.replace(/\s+/g, ' ').trim(), fontSize: l.fontSize }))
            .filter(l => l.text.length > 0 && /[\p{L}\p{N}]/u.test(l.text));
        if (cleanedLines.length === 0) return;

        const sizes = cleanedLines.map(l => l.fontSize).sort((a, b) => a - b);
        const median = sizes[Math.floor(sizes.length / 2)] || 12;
        const pageParts = [`<div class="imported-pdf-page"><div class="imported-pdf-page-badge">Page ${pageBlocks.length + 1}</div>`];
        let para = [];
        let bullets = [];
        const flushPara = () => {
            if (para.length) {
                const joined = para.join(' ').replace(/([a-zçğıöşü])- ([a-zçğıöşü])/g, '$1$2');
                pageParts.push(`<p>${escapeHtmlMain(joined)}</p>`);
                para = [];
            }
        };
        const flushBullets = () => {
            if (bullets.length) {
                pageParts.push(`<ul>${bullets.map(b => `<li>${escapeHtmlMain(b)}</li>`).join('')}</ul>`);
                bullets = [];
            }
        };

        cleanedLines.forEach(item => {
            const ratio = item.fontSize / median;
            const bulletMatch = item.text.match(/^(?:[•▪◦●■►▸]\s*|[-–*]\s+)(.+)$/);
            if (ratio >= 1.45 && item.text.length < 140) {
                flushPara(); flushBullets();
                pageParts.push(`<h2>${escapeHtmlMain(item.text)}</h2>`);
            } else if (ratio >= 1.15 && item.text.length < 140) {
                flushPara(); flushBullets();
                pageParts.push(`<h3>${escapeHtmlMain(item.text)}</h3>`);
            } else if (bulletMatch) {
                flushPara();
                bullets.push(bulletMatch[1]);
            } else if (bullets.length && para.length === 0 && /^[a-zçğıöşü(]/.test(item.text)) {
                // Wrapped continuation of the previous bullet
                bullets[bullets.length - 1] += ` ${item.text}`;
            } else {
                flushBullets();
                if (/^\d+[.)]\s+/.test(item.text)) flushPara();
                para.push(item.text);
                if (/[.!?:;]$/.test(item.text)) flushPara();
            }
        });
        flushPara();
        flushBullets();
        pageParts.push('</div>');
        pageBlocks.push(pageParts.join('\n'));
    });

    const bodyHtml = pageBlocks.length > 0
        ? pageBlocks.join('\n')
        : `<blockquote><strong>No selectable text found.</strong> ${escapeHtmlMain(cleanTitle)}.pdf looks like a scanned (image-only) or font-encrypted PDF, so there is no text layer to import.</blockquote>`;

    return {
        title: cleanTitle,
        html: `<h1>${escapeHtmlMain(cleanTitle)}</h1>\n${bodyHtml}<p><br></p>`,
        assets: []
    };
}

// Parse Notion (.zip) Archive containing .md, .html, .csv, and image assets
function parseNotionZipBufferMain(buffer, zipBaseName) {
    const entries = readZipEntriesMain(buffer);
    const assets = [];
    const assetPathMap = new Map();
    const notes = [];

    // 1. Extract all image/media files first so we can rewrite relative paths in .md and .html
    entries.forEach((fileBuf, entryName) => {
        if (/\.(png|jpe?g|gif|svg|webp)$/i.test(entryName)) {
            const cleanBase = path.basename(entryName).replace(/[^a-zA-Z0-9._-]/g, '_');
            const relAssetPath = `assets/asset_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${cleanBase}`;
            assets.push({ relPath: relAssetPath, bytes: new Uint8Array(fileBuf) });
            assetPathMap.set(entryName.toLowerCase(), relAssetPath);
            assetPathMap.set(decodeURIComponent(entryName).toLowerCase(), relAssetPath);
            assetPathMap.set(path.basename(entryName).toLowerCase(), relAssetPath);
            assetPathMap.set(decodeURIComponent(path.basename(entryName)).toLowerCase(), relAssetPath);
        }
    });

    // 2. Process .md, .html, and .csv files inside the Notion export
    entries.forEach((fileBuf, entryName) => {
        const ext = path.extname(entryName).toLowerCase();
        if (!['.md', '.markdown', '.html', '.htm', '.csv'].includes(ext)) return;

        const rawName = path.basename(entryName, ext);
        const cleanTitle = stripNotionUuidMain(rawName) || stripNotionUuidMain(zipBaseName) || 'Notion Note';
        const parts = entryName.split('/');
        let folderName = null;
        if (parts.length > 1) {
            folderName = stripNotionUuidMain(parts[0]) || null;
        }

        let textContent = fileBuf.toString('utf8');

        // Rewrite relative image paths (resolved against this file's folder) and Notion page links
        const entryDir = path.posix.dirname(entryName);
        const resolveAsset = (target) => {
            if (!target || /^(https?:|data:|mailto:)/i.test(target)) return null;
            let decoded = target;
            try { decoded = decodeURIComponent(target); } catch (_) {}
            decoded = decoded.split(/[?#]/)[0];
            const full = path.posix.normalize(path.posix.join(entryDir, decoded)).toLowerCase();
            return assetPathMap.get(full) || assetPathMap.get(path.posix.basename(decoded).toLowerCase()) || null;
        };
        textContent = textContent
            .replace(/(!\[[^\]]*\]\()(<[^>]+>|[^)\s]+)((?:\s+"[^"]*")?\))/g, (full, pre, target, post) => {
                const rel = resolveAsset(target.replace(/^<|>$/g, ''));
                return rel ? `${pre}${rel}${post}` : full;
            })
            .replace(/(<img\b[^>]*?\bsrc=")([^"]+)(")/gi, (full, pre, target, post) => {
                const rel = resolveAsset(target);
                return rel ? `${pre}${rel}${post}` : full;
            })
            .replace(/(<a\b[^>]*?\bhref=")([^"]+\.(?:png|jpe?g|gif|svg|webp))(")/gi, (full, pre, target, post) => {
                const rel = resolveAsset(target);
                return rel ? `${pre}${rel}${post}` : full;
            });

        if (ext === '.md' || ext === '.markdown') {
            // Links to other Notion pages become Nosh wiki-links: [Title](Title%20abc123.md) -> [[Title]]
            textContent = textContent.replace(/(^|[^!])\[([^\]]+)\]\(([^)\s]+\.md)\)/g, (full, prefix, label, target) => {
                let decoded = target;
                try { decoded = decodeURIComponent(target); } catch (_) {}
                const linked = stripNotionUuidMain(path.posix.basename(decoded, '.md')) || label;
                return `${prefix}[[${linked}]]`;
            });
        }

        if (ext === '.csv') {
            notes.push({
                title: cleanTitle,
                folderName,
                ext: '.csv',
                html: parseCsvToHtmlMain(textContent, cleanTitle)
            });
        } else if (ext === '.md' || ext === '.markdown') {
            notes.push({
                title: cleanTitle,
                folderName,
                ext: '.md',
                rawMarkdown: textContent
            });
        } else if (ext === '.html' || ext === '.htm') {
            notes.push({
                title: cleanTitle,
                folderName,
                ext: '.html',
                rawHtml: textContent
            });
        }
    });

    return {
        sourceType: 'notion-zip',
        defaultFolder: stripNotionUuidMain(zipBaseName) || 'Notion Import',
        notes,
        assets
    };
}

function parseSingleFileBufferMain(fileName, buffer) {
    const ext = path.extname(fileName).toLowerCase();
    const rawBaseName = path.basename(fileName, ext);
    const cleanBaseName = stripNotionUuidMain(rawBaseName) || rawBaseName || 'Imported Note';

    if (ext === '.pptx') {
        const res = parsePptxBufferMain(buffer, cleanBaseName);
        return {
            isBatchImport: true,
            sourceType: 'pptx',
            notes: [{ title: res.title, html: res.html, ext }],
            assets: res.assets
        };
    }
    if (ext === '.pdf') {
        const res = parsePdfBufferMain(buffer, cleanBaseName);
        return {
            isBatchImport: true,
            sourceType: 'pdf',
            notes: [{ title: res.title, html: res.html, ext }],
            assets: res.assets
        };
    }
    if (ext === '.docx') {
        const res = parseDocxBufferMain(buffer, cleanBaseName);
        return {
            isBatchImport: true,
            sourceType: 'docx',
            notes: [{ title: res.title, html: res.html, ext }],
            assets: res.assets
        };
    }
    if (ext === '.zip') {
        const res = parseNotionZipBufferMain(buffer, cleanBaseName);
        return {
            isBatchImport: true,
            sourceType: 'notion-zip',
            defaultFolder: res.defaultFolder,
            notes: res.notes,
            assets: res.assets
        };
    }
    if (ext === '.csv') {
        const csvText = buffer.toString('utf8');
        return {
            isBatchImport: true,
            sourceType: 'notion-csv',
            notes: [{ title: cleanBaseName, html: parseCsvToHtmlMain(csvText, cleanBaseName), ext }],
            assets: []
        };
    }
    if (ext === '.md' || ext === '.markdown') {
        return {
            isBatchImport: true,
            sourceType: 'markdown',
            notes: [{ title: cleanBaseName, rawMarkdown: buffer.toString('utf8'), ext }],
            assets: []
        };
    }
    if (ext === '.html' || ext === '.htm') {
        return {
            isBatchImport: true,
            sourceType: 'html',
            notes: [{ title: cleanBaseName, rawHtml: buffer.toString('utf8'), ext }],
            assets: []
        };
    }

    const content = buffer.toString('utf8');
    return {
        fileName: cleanBaseName,
        content,
        ext
    };
}

ipcMain.handle('open-file-dialog', async (event, options = null) => {
    // Mode 0: Parse a local file by path (drag-and-drop from OS explorer)
    if (options && options.filePath && fs.existsSync(options.filePath)) {
        try {
            const buf = fs.readFileSync(options.filePath);
            return parseSingleFileBufferMain(options.fileName || path.basename(options.filePath), buf);
        } catch (err) {
            console.error('Error parsing file by path:', err);
            return { error: err.message || 'Failed to parse file' };
        }
    }

    // Mode 1: Parse an in-memory file buffer (used by drag-and-drop & clipboard file paste)
    if (options && options.mode === 'parse-buffer' && options.fileName && options.bytes) {
        try {
            const buf = Buffer.from(options.bytes);
            return parseSingleFileBufferMain(options.fileName, buf);
        } catch (err) {
            console.error('Error parsing dropped/pasted file buffer:', err);
            return { error: err.message || 'Failed to parse file' };
        }
    }

    // Mode 2: Native file dialog (with optional filterType from Dashboard Import Hub)
    const filterType = (options && options.filterType) || 'all';
    const filterMap = {
        md: [
            { name: 'Markdown & Notion Markdown (*.md, *.markdown)', extensions: ['md', 'markdown'] },
            { name: 'All Supported Formats', extensions: ['nsh', 'md', 'markdown', 'pdf', 'pptx', 'zip', 'html', 'htm', 'csv', 'docx', 'txt'] }
        ],
        pdf: [
            { name: 'PDF Documents (*.pdf)', extensions: ['pdf'] },
            { name: 'All Supported Formats', extensions: ['nsh', 'md', 'markdown', 'pdf', 'pptx', 'zip', 'html', 'htm', 'csv', 'docx', 'txt'] }
        ],
        pptx: [
            { name: 'PowerPoint Presentations (*.pptx)', extensions: ['pptx'] },
            { name: 'All Supported Formats', extensions: ['nsh', 'md', 'markdown', 'pdf', 'pptx', 'zip', 'html', 'htm', 'csv', 'docx', 'txt'] }
        ],
        notion: [
            { name: 'Notion Exports (*.zip, *.md, *.html, *.csv)', extensions: ['zip', 'md', 'markdown', 'html', 'htm', 'csv'] },
            { name: 'All Supported Formats', extensions: ['nsh', 'md', 'markdown', 'pdf', 'pptx', 'zip', 'html', 'htm', 'csv', 'docx', 'txt'] }
        ],
        all: [
            { name: 'All Supported Documents (*.nsh, *.md, *.pdf, *.pptx, *.zip, *.html, *.csv, *.docx, *.txt)', extensions: ['nsh', 'md', 'markdown', 'pdf', 'pptx', 'zip', 'html', 'htm', 'csv', 'docx', 'txt'] },
            { name: 'Markdown (*.md)', extensions: ['md', 'markdown'] },
            { name: 'PDF Documents (*.pdf)', extensions: ['pdf'] },
            { name: 'PowerPoint Presentations (*.pptx)', extensions: ['pptx'] },
            { name: 'Notion Export (*.zip, *.html, *.md, *.csv)', extensions: ['zip', 'html', 'htm', 'md', 'csv'] },
            { name: 'Nosh Notes (*.nsh)', extensions: ['nsh'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    };

    const result = await dialog.showOpenDialog(win, {
        title: 'Import Document or Open Note (.md, .pdf, .pptx, Notion .zip/.html/.csv, .nsh)',
        properties: ['openFile', 'multiSelections'],
        filters: filterMap[filterType] || filterMap.all
    });

    if (!result.canceled && result.filePaths.length > 0) {
        // Single legacy .nsh / .txt file when called with no options
        if (!options && result.filePaths.length === 1) {
            const singlePath = result.filePaths[0];
            const singleExt = path.extname(singlePath).toLowerCase();
            if (singleExt === '.nsh' || singleExt === '.txt') {
                const content = fs.readFileSync(singlePath, 'utf8');
                return {
                    filePath: singlePath,
                    fileName: path.basename(singlePath, singleExt),
                    content
                };
            }
        }

        const aggregatedNotes = [];
        const aggregatedAssets = [];
        let primaryFolder = null;

        for (const filePath of result.filePaths) {
            const buf = fs.readFileSync(filePath);
            const parsed = parseSingleFileBufferMain(path.basename(filePath), buf);
            if (parsed && parsed.isBatchImport) {
                if (parsed.defaultFolder && !primaryFolder) primaryFolder = parsed.defaultFolder;
                if (Array.isArray(parsed.notes)) aggregatedNotes.push(...parsed.notes);
                if (Array.isArray(parsed.assets)) aggregatedAssets.push(...parsed.assets);
            } else if (parsed && parsed.fileName) {
                aggregatedNotes.push({
                    title: parsed.fileName,
                    html: parsed.ext === '.nsh' ? parsed.content : `<h1>${escapeHtmlMain(parsed.fileName)}</h1><p>${escapeHtmlMain(parsed.content).replace(/\r?\n/g, '<br>')}</p>`,
                    ext: parsed.ext
                });
            }
        }

        return {
            isBatchImport: true,
            defaultFolder: primaryFolder,
            notes: aggregatedNotes,
            assets: aggregatedAssets
        };
    }
    return null;
});

ipcMain.handle('save-file-dialog', async (event, defaultName, content) => {
    const result = await dialog.showSaveDialog(win, {
        title: 'Save Note As',
        defaultPath: defaultName ? `${defaultName}.nsh` : 'Untitled.nsh',
        filters: [
            { name: 'Nosh Note (*.nsh)', extensions: ['nsh'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    });

    if (!result.canceled && result.filePath) {
        fs.writeFileSync(result.filePath, content, 'utf8');
        return {
            success: true,
            filePath: result.filePath,
            fileName: path.basename(result.filePath, path.extname(result.filePath))
        };
    }
    return null;
});

ipcMain.handle('export-file-dialog', async (event, { defaultName, content, filters, title }) => {
    const result = await dialog.showSaveDialog(win, {
        title: title || 'Export File',
        defaultPath: defaultName || 'Untitled',
        filters: filters || [
            { name: 'Markdown (*.md)', extensions: ['md'] },
            { name: 'Text (*.txt)', extensions: ['txt'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    });

    if (!result.canceled && result.filePath) {
        fs.writeFileSync(result.filePath, content, 'utf8');
        return {
            success: true,
            filePath: result.filePath,
            fileName: path.basename(result.filePath)
        };
    }
    return null;
});

function escapeHtmlMain(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

ipcMain.handle('export-pdf', async (event, { defaultName, title, htmlContent, outputPath }) => {
    // A page-chosen output path is only honoured inside the notes folders (it would otherwise
    // overwrite any file); anything else falls back to the Save dialog
    let targetPath = outputPath && notesRoots.isInside(outputPath) ? outputPath : null;
    if (!targetPath) {
        const result = await dialog.showSaveDialog(win, {
            title: 'Export PDF',
            defaultPath: defaultName ? `${defaultName}.pdf` : 'Untitled.pdf',
            filters: [{ name: 'PDF Documents (*.pdf)', extensions: ['pdf'] }]
        });

        if (result.canceled || !result.filePath) {
            return null;
        }
        targetPath = result.filePath;
    }

    try {
        let contentToPrint = htmlContent;
        let noteTitle = title || defaultName || 'Untitled Document';

        // If htmlContent wasn't passed directly, extract from renderer
        if (!contentToPrint && win && !win.isDestroyed()) {
            try {
                const payload = await win.webContents.executeJavaScript(`
                    typeof buildPdfDocumentPayload === 'function' ? buildPdfDocumentPayload() : { title: activeNoteName || 'Document', htmlContent: document.getElementById('content')?.innerHTML || '' }
                `);
                if (payload && payload.htmlContent) {
                    contentToPrint = payload.htmlContent;
                    if (payload.title) noteTitle = payload.title;
                }
            } catch (evalErr) {
                console.warn('Could not extract payload from renderer:', evalErr);
            }
        }

        if (contentToPrint) {
            // High-fidelity isolated document printing (pure document without application shell)
            const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>${escapeHtmlMain(noteTitle)}</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css">
    <style>
        .math-formula-block {
            margin: 12pt 0;
            padding: 10pt 14pt;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 6pt;
            text-align: center;
            overflow-x: auto;
        }
        .math-formula-inline {
            display: inline-block;
            padding: 0 2pt;
            vertical-align: middle;
        }
        @page {
            size: A4;
            margin: 20mm 18mm 20mm 18mm;
            @bottom-right {
                content: counter(page);
                font-size: 9pt;
                color: #94a3b8;
            }
        }
        * {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
        }
        html, body {
            margin: 0;
            padding: 0;
            background: #ffffff !important;
            color: #1e293b;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            font-size: 11pt;
            line-height: 1.65;
            -webkit-font-smoothing: antialiased;
        }
        .pdf-page-container {
            width: 100%;
            max-width: 100%;
            margin: 0 auto;
        }
        h1.pdf-document-title {
            font-size: 26pt;
            font-weight: 800;
            color: #0f172a;
            letter-spacing: -0.5px;
            margin: 0 0 16pt 0;
            padding-bottom: 8pt;
            border-bottom: 2px solid #e2e8f0;
            line-height: 1.25;
            page-break-after: avoid;
            break-after: avoid;
        }
        h1 {
            font-size: 20pt;
            font-weight: 700;
            color: #0f172a;
            margin: 18pt 0 8pt 0;
            line-height: 1.3;
            page-break-after: avoid;
            break-after: avoid;
        }
        h2 {
            font-size: 16pt;
            font-weight: 600;
            color: #1e293b;
            margin: 15pt 0 6pt 0;
            line-height: 1.35;
            page-break-after: avoid;
            break-after: avoid;
        }
        h3 {
            font-size: 13pt;
            font-weight: 600;
            color: #334155;
            margin: 12pt 0 4pt 0;
            page-break-after: avoid;
            break-after: avoid;
        }
        h4, h5, h6 {
            font-size: 11pt;
            font-weight: 600;
            color: #475569;
            margin: 10pt 0 4pt 0;
            page-break-after: avoid;
            break-after: avoid;
        }
        p {
            margin: 6pt 0;
            color: #334155;
        }
        ul, ol {
            margin: 6pt 0 6pt 20pt;
            padding: 0;
            color: #334155;
        }
        li {
            margin: 3pt 0;
        }
        a {
            color: #4f46e5;
            text-decoration: underline;
            text-underline-offset: 2px;
        }
        blockquote {
            border-left: 3.5px solid #6366f1;
            margin: 12pt 0;
            padding: 6pt 14pt;
            background: #f8fafc;
            color: #475569;
            border-radius: 0 4pt 4pt 0;
            page-break-inside: avoid;
            break-inside: avoid;
        }
        hr {
            border: none;
            border-top: 1px solid #e2e8f0;
            margin: 16pt 0;
        }
        img {
            max-width: 100%;
            height: auto;
            border-radius: 4pt;
            margin: 8pt 0;
            page-break-inside: avoid;
            break-inside: avoid;
        }
        .media-container {
            display: inline-block;
            max-width: 100%;
            margin: 8pt 0;
            position: relative;
            page-break-inside: avoid;
            break-inside: avoid;
        }
        .media-container img,
        .media-container video {
            width: 100%;
            max-width: 100%;
            height: auto;
            border-radius: 4pt;
            display: block;
            margin: 0;
        }
        .media-toolbar,
        .media-resize-handle,
        .media-drag-handle,
        .block-drag-handle {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
            height: 0 !important;
            width: 0 !important;
            overflow: hidden !important;
            pointer-events: none !important;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 12pt 0;
            page-break-inside: avoid;
            break-inside: avoid;
        }
        th, td {
            border: 1px solid #cbd5e1;
            padding: 6pt 10pt;
            text-align: left;
            font-size: 10pt;
        }
        th {
            background: #f1f5f9;
            font-weight: 600;
            color: #1e293b;
        }
        code.inline-code, :not(pre) > code {
            font-family: 'JetBrains Mono', Consolas, monospace;
            font-size: 9.5pt;
            padding: 1pt 4pt;
            border-radius: 3pt;
            background: #f1f5f9;
            border: 1px solid #e2e8f0;
            color: #0f172a;
        }
        .claude-embedded-diagram {
            margin: 12pt 0;
            padding: 12pt 14pt 8pt;
            background: #f8fafc;
            border: 1px solid #cbd5e1;
            border-radius: 6pt;
            text-align: center;
            page-break-inside: avoid;
            break-inside: avoid;
        }
        .claude-embedded-diagram svg {
            max-width: 100%;
            height: auto;
            display: block;
            margin: 0 auto;
        }
        .claude-diagram-caption {
            margin-top: 6pt;
            font-size: 9pt;
            color: #475569;
        }
        /* Checklists */
        .checklist-item {
            display: flex;
            align-items: flex-start;
            gap: 6pt;
            margin: 4pt 0;
            page-break-inside: avoid;
            break-inside: avoid;
        }
        .checklist-checkbox {
            width: 12pt;
            height: 12pt;
            margin-top: 2pt;
            accent-color: #4f46e5;
            flex-shrink: 0;
        }
        .checklist-text {
            flex: 1;
        }
        .checklist-item.completed .checklist-text {
            text-decoration: line-through;
            color: #94a3b8;
        }
        
        /* Code blocks in Light Theme */
        .pdf-code-block {
            margin: 12pt 0;
            border: 1px solid #d0d7de;
            border-radius: 6pt;
            background: #f6f8fa;
            overflow: hidden;
            page-break-inside: avoid;
            break-inside: avoid;
        }
        .pdf-code-header {
            background: #f1f3f5;
            padding: 5pt 10pt;
            font-size: 8.5pt;
            font-weight: 700;
            color: #57606a;
            border-bottom: 1px solid #d0d7de;
            text-transform: uppercase;
            letter-spacing: 0.6px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
        }
        .pdf-code-block pre {
            margin: 0;
            padding: 10pt 12pt;
            font-family: "JetBrains Mono", Consolas, "Liberation Mono", Menlo, Courier, monospace;
            font-size: 9.5pt;
            line-height: 1.55;
            color: #24292e;
            background: #f6f8fa;
            white-space: pre-wrap;
            word-break: break-all;
        }
        .pdf-code-block code {
            font-family: inherit;
            font-size: inherit;
            line-height: inherit;
            background: transparent !important;
        }

        /* GitHub Light Syntax Highlighting for Code Blocks */
        .hljs {
            color: #24292e;
            background: transparent !important;
        }
        .hljs-doctag,
        .hljs-keyword,
        .hljs-meta .hljs-keyword,
        .hljs-template-tag,
        .hljs-template-variable,
        .hljs-type,
        .hljs-variable.language_ {
            color: #d73a49;
            font-weight: 600;
        }
        .hljs-title,
        .hljs-title.class_,
        .hljs-title.class_.inherited__,
        .hljs-title.function_ {
            color: #6f42c1;
            font-weight: 600;
        }
        .hljs-attr,
        .hljs-attribute,
        .hljs-literal,
        .hljs-meta,
        .hljs-number,
        .hljs-operator,
        .hljs-variable,
        .hljs-selector-attr,
        .hljs-selector-class,
        .hljs-selector-id {
            color: #005cc5;
        }
        .hljs-regexp,
        .hljs-string,
        .hljs-meta .hljs-string {
            color: #032f62;
        }
        .hljs-built_in,
        .hljs-symbol {
            color: #e36209;
        }
        .hljs-comment,
        .hljs-code,
        .hljs-formula {
            color: #6a737d;
            font-style: italic;
        }
        .hljs-name,
        .hljs-quote,
        .hljs-selector-tag,
        .hljs-selector-pseudo {
            color: #22863a;
        }
        .hljs-subst {
            color: #24292e;
        }
        .hljs-section {
            color: #005cc5;
            font-weight: bold;
        }
        .hljs-bullet {
            color: #735c0f;
        }
        .hljs-emphasis {
            font-style: italic;
        }
        .hljs-strong {
            font-weight: bold;
        }
        .hljs-addition {
            color: #22863a;
            background-color: #f0fff4;
        }
        .hljs-deletion {
            color: #b31d28;
            background-color: #ffeef0;
        }

        /* Internal links */
        .internal-link, .note-internal-link {
            color: #4f46e5;
            font-weight: 500;
        }
        /* Tags */
        .tag-pill {
            display: inline-block;
            background: #e0e7ff;
            color: #3730a3;
            font-size: 8.5pt;
            font-weight: 500;
            padding: 1pt 6pt;
            border-radius: 9999px;
            margin: 0 2pt;
        }
    </style>
</head>
<body>
    <div class="pdf-page-container">
        ${contentToPrint}
    </div>
</body>
</html>`;

            const tempHtmlPath = path.join(app.getPath('temp'), `nosh-export-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
            fs.writeFileSync(tempHtmlPath, fullHtml, 'utf8');

            const printWin = new BrowserWindow({
                show: false,
                width: 800,
                height: 1100,
                backgroundColor: '#ffffff',
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true
                }
            });

            await printWin.loadFile(tempHtmlPath);
            await new Promise(r => setTimeout(r, 120));

            const pdfData = await printWin.webContents.printToPDF({
                margins: { top: 0, bottom: 0, left: 0, right: 0 },
                printBackground: true,
                pageSize: 'A4'
            });

            printWin.destroy();
            try { fs.unlinkSync(tempHtmlPath); } catch (_) {}

            fs.writeFileSync(targetPath, pdfData);
            return {
                success: true,
                filePath: targetPath,
                fileName: path.basename(targetPath)
            };
        } else {
            // Absolute fallback: print main window with print CSS applied
            if (win && !win.isDestroyed()) {
                try { win.setBackgroundColor('#ffffff'); } catch (_) {}
            }
            const pdfData = await win.webContents.printToPDF({
                margins: { top: 0, bottom: 0, left: 0, right: 0 },
                printBackground: true,
                pageSize: 'A4'
            });
            if (win && !win.isDestroyed()) {
                try { win.setBackgroundColor('#0d0f12'); } catch (_) {}
            }
            fs.writeFileSync(targetPath, pdfData);
            return {
                success: true,
                filePath: targetPath,
                fileName: path.basename(targetPath)
            };
        }
    } catch (err) {
        console.error('printToPDF error:', err);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('create-file', async (event, fileName, content) => {
    try {
        if (!saveFolder) initSaveFolder();
        const safeName = path.basename(fileName);
        const filePath = path.join(saveFolder, safeName);
        fs.writeFileSync(filePath, content || '', 'utf8');
        return { success: true, message: `File "${safeName}" created successfully`, filePath };
    } catch (error) {
        return { success: false, message: `Error creating file: ${error.message}` };
    }
});

// Local OAuth & Media Server
const appServer = express();

// Local YouTube Player Wrapper
// Provides an HTTP origin (http://localhost:2222) and uses YouTube IFrame API with zero native controls.
appServer.get('/youtube-player', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
    });
    res.end(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="referrer" content="strict-origin-when-cross-origin">
    <title>YouTube Player</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body {
            width: 100%;
            height: 100%;
            overflow: hidden;
            background: #000;
        }
        #player-wrapper {
            width: 100%;
            height: 100%;
            overflow: hidden;
        }
        #player {
            width: 100%;
            height: 100%;
            border: none;
            pointer-events: none;
        }
    </style>
</head>
<body>
    <div id="player-wrapper">
        <div id="player"></div>
    </div>
    <script>
        let player = null;
        let isReady = false;
        let pending = [];
        let ticker = null;

        const params = new URLSearchParams(window.location.search);
        const videoId = params.get('v') || 'rFZHOHl-L8A';
        const listId = params.get('list');
        const autoplay = params.get('autoplay') === '1' ? 1 : 0;

        function sendVideoInfo() {
            if (!player) return;
            let title = '';
            let author = '';
            try {
                if (typeof player.getVideoData === 'function') {
                    const data = player.getVideoData();
                    if (data && data.title) {
                        title = data.title;
                        author = data.author || '';
                    }
                }
            } catch (e) {}

            let duration = 0;
            try {
                if (typeof player.getDuration === 'function') {
                    duration = player.getDuration() || 0;
                }
            } catch (e) {}

            try {
                if (window.parent && window.parent !== window) {
                    window.parent.postMessage({
                        type: 'yt-info',
                        title: title,
                        author: author,
                        duration: duration
                    }, '*');
                }
            } catch (e) {}
        }

        function startTimeTicker() {
            stopTimeTicker();
            ticker = setInterval(() => {
                if (player && typeof player.getCurrentTime === 'function') {
                    const cur = player.getCurrentTime() || 0;
                    const dur = player.getDuration() || 0;
                    try {
                        if (window.parent && window.parent !== window) {
                            window.parent.postMessage({
                                type: 'yt-time',
                                currentTime: cur,
                                duration: dur
                            }, '*');
                        }
                    } catch (e) {}
                }
            }, 500);
        }

        function stopTimeTicker() {
            if (ticker) {
                clearInterval(ticker);
                ticker = null;
            }
        }

        window.onYouTubeIframeAPIReady = function() {
            const playerVars = {
                autoplay: autoplay,
                controls: 0,
                disablekb: 1,
                fs: 0,
                modestbranding: 1,
                rel: 0,
                playsinline: 1,
                iv_load_policy: 3,
                enablejsapi: 1,
                origin: window.location.origin
            };
            const config = {
                width: '100%',
                height: '100%',
                playerVars: playerVars,
                events: {
                    onReady: function(event) {
                        isReady = true;
                        sendVideoInfo();
                        while (pending.length > 0) {
                            const item = pending.shift();
                            runCommand(item.action, item.val);
                        }
                        try {
                            if (window.parent && window.parent !== window) {
                                window.parent.postMessage({ type: 'yt-ready' }, '*');
                            }
                        } catch(e) {}
                    },
                    onStateChange: function(event) {
                        // 1 = PLAYING, 2 = PAUSED, 0 = ENDED, 3 = BUFFERING
                        const isPlaying = event.data === 1;
                        if (isPlaying) {
                            startTimeTicker();
                        } else {
                            stopTimeTicker();
                        }
                        sendVideoInfo();
                        try {
                            if (window.parent && window.parent !== window) {
                                window.parent.postMessage({
                                    type: 'yt-state',
                                    state: event.data,
                                    isPlaying: isPlaying
                                }, '*');
                            }
                        } catch(e) {}
                    },
                    onError: function(event) {
                        console.error('YouTube Player Error:', event.data);
                        try {
                            if (window.parent && window.parent !== window) {
                                window.parent.postMessage({
                                    type: 'yt-error',
                                    error: event.data
                                }, '*');
                            }
                        } catch(e) {}
                    }
                }
            };
            if (listId) {
                config.playerVars.listType = 'playlist';
                config.playerVars.list = listId;
            } else {
                config.videoId = videoId;
            }
            player = new YT.Player('player', config);
        };

        function runCommand(action, val) {
            if (!player || !isReady || typeof player.getPlayerState !== 'function') {
                pending.push({ action, val });
                return;
            }
            try {
                if (action === 'play') {
                    player.playVideo();
                } else if (action === 'pause') {
                    player.pauseVideo();
                } else if (action === 'togglePlay') {
                    const st = player.getPlayerState();
                    if (st === 1) {
                        player.pauseVideo();
                    } else {
                        player.playVideo();
                    }
                } else if (action === 'seekTo') {
                    player.seekTo(Number(val), true);
                } else if (action === 'setVolume') {
                    const v = Number(val);
                    player.setVolume(v);
                    if (player.isMuted() && v > 0) {
                        player.unMute();
                    }
                } else if (action === 'mute') {
                    player.mute();
                } else if (action === 'unMute') {
                    player.unMute();
                } else if (action === 'getInfo') {
                    sendVideoInfo();
                } else if (action === 'load') {
                    if (val && val.listId) {
                        player.loadPlaylist({ list: val.listId });
                    } else if (val && val.videoId) {
                        player.loadVideoById(val.videoId);
                    }
                    setTimeout(sendVideoInfo, 1000);
                }
            } catch (err) {
                console.warn('Player command error:', err);
            }
        }

        window.addEventListener('message', function(event) {
            let data = event.data;
            if (!data) return;
            if (typeof data === 'string') {
                try { data = JSON.parse(data); } catch(e) { return; }
            }
            if (data.action) {
                runCommand(data.action, data.val !== undefined ? data.val : data.value);
            }
        });

        // Load YouTube IFrame API script
        const tag = document.createElement('script');
        tag.src = "https://www.youtube.com/iframe_api";
        const firstScriptTag = document.getElementsByTagName('script')[0];
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    </script>
</body>
</html>`);
});

// Floating YouTube Picture-in-Picture Window
let youtubePipWindow = null;

ipcMain.handle('open-youtube-pip', (event, { videoId, title }) => {
    const targetVideoId = videoId || 'rFZHOHl-L8A';
    const targetTitle = title || 'Lofi Hip Hop Radio';

    if (youtubePipWindow && !youtubePipWindow.isDestroyed()) {
        youtubePipWindow.focus();
        youtubePipWindow.webContents.send('load-video', { videoId: targetVideoId, title: targetTitle });
        return { success: true };
    }

    youtubePipWindow = new BrowserWindow({
        width: 480,
        height: 310,
        minWidth: 320,
        minHeight: 220,
        alwaysOnTop: true,
        frame: false,
        backgroundColor: '#0f172a',
        title: targetTitle + ' - Nosh',
        webPreferences: {
            preload: path.join(__dirname, 'pip-preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        }
    });

    youtubePipWindow.loadFile('youtube-pip.html', {
        query: { v: targetVideoId, title: targetTitle }
    });

    youtubePipWindow.on('closed', () => {
        youtubePipWindow = null;
    });

    return { success: true };
});

// The pin button in the floating player (it used the removed `remote` module before)
ipcMain.handle('pip-set-always-on-top', (event, pinned) => {
    if (youtubePipWindow && !youtubePipWindow.isDestroyed() && event.sender === youtubePipWindow.webContents) {
        youtubePipWindow.setAlwaysOnTop(Boolean(pinned));
        return true;
    }
    return false;
});

ipcMain.handle('close-youtube-pip', () => {
    if (youtubePipWindow && !youtubePipWindow.isDestroyed()) {
        youtubePipWindow.close();
        youtubePipWindow = null;
    }
    return { success: true };
});

// Quick Capture: a global hotkey opens a small window from anywhere in the OS.
// The snippet is forwarded to the main window, which appends it to the "Inbox"
// note with the regular save pipeline (custom notes folder, Drive sync, sidebar).
const QUICK_CAPTURE_SHORTCUT = 'CommandOrControl+Alt+N';
const QUICK_CAPTURE_MAX_LENGTH = 200000;
const QUICK_CAPTURE_TIMEOUT_MS = 8000;

let quickCaptureWindow = null;
let quickCaptureRequestSeq = 0;
const pendingQuickCaptures = new Map();

function createQuickCaptureWindow() {
    quickCaptureWindow = new BrowserWindow({
        width: 560,
        height: 300,
        show: false,
        frame: false,
        transparent: true,
        resizable: false, // transparent windows can't be resized on Windows
        alwaysOnTop: true,
        skipTaskbar: true,
        fullscreenable: false,
        icon: path.join(__dirname, 'icon.ico'),
        title: 'Quick Note - Nosh',
        webPreferences: {
            preload: path.join(__dirname, 'quick-capture-preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });

    quickCaptureWindow.loadFile('quick-capture.html');

    // Behave like a launcher: clicking elsewhere hides it (the draft is kept)
    quickCaptureWindow.on('blur', () => {
        if (quickCaptureWindow && !quickCaptureWindow.isDestroyed() && quickCaptureWindow.isVisible()) {
            quickCaptureWindow.hide();
        }
    });

    quickCaptureWindow.on('closed', () => {
        quickCaptureWindow = null;
    });
}

function destroyQuickCaptureWindow() {
    if (quickCaptureWindow && !quickCaptureWindow.isDestroyed()) {
        quickCaptureWindow.destroy();
    }
    quickCaptureWindow = null;
}

function showQuickCaptureWindow() {
    if (!quickCaptureWindow || quickCaptureWindow.isDestroyed()) {
        createQuickCaptureWindow();
    }

    // Open on the monitor the user is working on, slightly above center
    const cursor = screen.getCursorScreenPoint();
    const { workArea } = screen.getDisplayNearestPoint(cursor);
    const [width, height] = quickCaptureWindow.getSize();
    quickCaptureWindow.setPosition(
        Math.round(workArea.x + (workArea.width - width) / 2),
        Math.round(workArea.y + workArea.height * 0.25)
    );

    const reveal = () => {
        if (!quickCaptureWindow || quickCaptureWindow.isDestroyed()) return;
        quickCaptureWindow.show();
        quickCaptureWindow.focus();
        quickCaptureWindow.webContents.send('quick-capture-shown');
    };

    if (quickCaptureWindow.webContents.isLoading()) {
        quickCaptureWindow.webContents.once('did-finish-load', reveal);
    } else {
        reveal();
    }
}

function toggleQuickCaptureWindow() {
    if (quickCaptureWindow && !quickCaptureWindow.isDestroyed() && quickCaptureWindow.isVisible()) {
        quickCaptureWindow.hide();
    } else {
        showQuickCaptureWindow();
    }
}

function registerQuickCaptureShortcut() {
    let registered = false;
    try {
        registered = globalShortcut.register(QUICK_CAPTURE_SHORTCUT, toggleQuickCaptureWindow);
    } catch (err) {
        console.error('Quick Capture shortcut registration error:', err);
    }
    if (!registered) {
        // Usually another app already owns this shortcut
        console.warn(`Quick Capture shortcut ${QUICK_CAPTURE_SHORTCUT} could not be registered.`);
    }
    return registered;
}

// Opened from the command palette in the main window
ipcMain.on('quick-capture-open', (event) => {
    if (win && !win.isDestroyed() && event.sender === win.webContents) {
        showQuickCaptureWindow();
    }
});

ipcMain.on('quick-capture-hide', (event) => {
    if (quickCaptureWindow && !quickCaptureWindow.isDestroyed() && event.sender === quickCaptureWindow.webContents) {
        quickCaptureWindow.hide();
    }
});

ipcMain.handle('quick-capture-submit', async (event, payload) => {
    if (!quickCaptureWindow || quickCaptureWindow.isDestroyed() || event.sender !== quickCaptureWindow.webContents) {
        return { success: false, error: 'Unauthorized sender' };
    }

    const text = payload && typeof payload.text === 'string' ? payload.text : '';
    const kind = payload && payload.kind === 'text' ? 'text' : 'code';
    if (!text.trim()) {
        return { success: false, error: 'Nothing to save yet' };
    }
    if (text.length > QUICK_CAPTURE_MAX_LENGTH) {
        return { success: false, error: 'Snippet is too large for a quick note' };
    }
    if (!win || win.isDestroyed()) {
        return { success: false, error: 'Nosh main window is not available' };
    }

    const requestId = ++quickCaptureRequestSeq;
    const result = await new Promise((resolve) => {
        const timer = setTimeout(() => {
            pendingQuickCaptures.delete(requestId);
            resolve({ success: false, error: 'Nosh did not respond. Is it still loading?' });
        }, QUICK_CAPTURE_TIMEOUT_MS);

        pendingQuickCaptures.set(requestId, (res) => {
            clearTimeout(timer);
            resolve(res);
        });

        win.webContents.send('quick-capture-append', { requestId, text, kind });
    });

    if (result && result.success && quickCaptureWindow && !quickCaptureWindow.isDestroyed()) {
        quickCaptureWindow.hide();
    }
    return result;
});

ipcMain.on('quick-capture-result', (event, response) => {
    if (!win || win.isDestroyed() || event.sender !== win.webContents || !response) return;
    const done = pendingQuickCaptures.get(response.requestId);
    if (done) {
        pendingQuickCaptures.delete(response.requestId);
        done({ success: Boolean(response.success), error: response.error || null });
    }
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    noshTray.destroyTray();
});

// Google Drive Callback
appServer.get('/drive-callback', async (req, res) => {
    const code = req.query.code;
    const error = req.query.error;

    if (error || !code) {
        return res.send(`
            <body style="background:#0e1015;color:#ef4444;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
                <div style="text-align:center;">
                    <h2>Google Drive Authorization Failed</h2>
                    <p style="color:#9ca3af;">${error || 'No authorization code provided.'}</p>
                </div>
            </body>
        `);
    }

    const driveClientId = process.env.GOOGLE_DRIVE_CLIENT_ID || '';
    const driveClientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET || '';

    const oAuth2Client = new google.auth.OAuth2(
        driveClientId,
        driveClientSecret,
        `http://localhost:${port}/drive-callback`
    );

    try {
        const { tokens } = await oAuth2Client.getToken(code);
        oAuth2Client.setCredentials(tokens);

        const drive = google.drive({ version: 'v3', auth: oAuth2Client });

        // Retrieve connected user profile
        let userEmail = null;
        let userName = null;
        try {
            const about = await drive.about.get({ fields: 'user(displayName,emailAddress)' });
            userEmail = about.data?.user?.emailAddress || null;
            userName = about.data?.user?.displayName || null;
        } catch (e) {
            console.warn('Could not fetch drive user profile:', e.message);
        }

        // Ensure noshTheNotepad folder exists
        const folderRes = await drive.files.list({
            q: "name = 'noshTheNotepad' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
            fields: 'files(id, name)'
        });

        if (!folderRes.data.files || folderRes.data.files.length === 0) {
            await drive.files.create({
                resource: {
                    name: 'noshTheNotepad',
                    mimeType: 'application/vnd.google-apps.folder'
                },
                fields: 'id'
            });
        }

        if (win && !win.isDestroyed()) {
            win.webContents.send('drive-token', {
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                email: userEmail,
                name: userName
            });
        }

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Google Drive Connected</title>
                <style>
                    body {
                        background: #0d0f12;
                        color: #f3f4f6;
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        height: 100vh;
                        margin: 0;
                    }
                    .card {
                        background: #14171f;
                        border: 1px solid rgba(255,255,255,0.08);
                        padding: 36px 48px;
                        border-radius: 16px;
                        text-align: center;
                        box-shadow: 0 20px 40px rgba(0,0,0,0.5);
                    }
                    .badge {
                        width: 56px;
                        height: 56px;
                        border-radius: 50%;
                        background: rgba(16, 185, 129, 0.15);
                        color: #10b981;
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        font-size: 28px;
                        margin-bottom: 16px;
                    }
                    h2 { margin: 0 0 8px 0; font-size: 20px; font-weight: 600; }
                    p { color: #9ca3af; margin: 0; font-size: 14px; }
                    .email-pill { margin-top: 12px; display: inline-block; padding: 4px 12px; border-radius: 999px; background: rgba(255,255,255,0.06); color: #fff; font-size: 13px; }
                </style>
            </head>
            <body>
                <div class="card">
                    <div class="badge">&#10003;</div>
                    <h2>Google Drive Linked Successfully!</h2>
                    <p>Your notes will now automatically sync to your Google Drive.</p>
                    ${userEmail ? `<div class="email-pill">${userEmail}</div>` : ''}
                    <p style="margin-top: 14px; font-size: 12px; color: #6b7280;">You can close this browser tab and return to Nosh.</p>
                </div>
            </body>
            </html>
        `);
    } catch (err) {
        console.error('Error exchanging Google Drive token:', err);
        res.status(500).send(`
            <body style="background:#0e1015;color:#ef4444;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
                <div style="text-align:center;">
                    <h2>Google Drive Error</h2>
                    <p style="color:#9ca3af;">${err.message}</p>
                </div>
            </body>
        `);
    }
});

// Web Publishing is now handled directly via Supabase Cloud in share.js (Zero personal secrets in binary)

let serverPort = port;

function startLocalServer(p) {
    const s = appServer.listen(p, () => {
        serverPort = s.address().port;
        console.log(`Nosh auth & media server listening on port ${serverPort}`);
    }).on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.warn(`Auth server port ${p} is in use; trying next port...`);
            if (p === port) {
                startLocalServer(2223);
            } else if (p === 2223) {
                startLocalServer(0); // Any available port
            }
        } else {
            console.error('Auth server error:', err);
        }
    });
}
startLocalServer(port);

ipcMain.handle('get-server-port', () => serverPort);

app.whenReady().then(() => {
    // Fix YouTube Embed "Error 153: Video player configuration error"
    // In Electron with file:// origin, YouTube blocks embeds unless valid Referer and Origin headers are supplied,
    // and blocks playback if the User-Agent explicitly contains Electron.
    if (session && session.defaultSession) {
        const originalUA = session.defaultSession.getUserAgent();
        const cleanUA = originalUA.replace(/Electron\/\S+\s?/, '').replace(/nosh\/\S+\s?/, '');
        session.defaultSession.setUserAgent(cleanUA);

        session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
            const isYouTube = details.url.includes('youtube.com') ||
                              details.url.includes('youtube-nocookie.com') ||
                              details.url.includes('googlevideo.com');
            if (isYouTube && details.requestHeaders['User-Agent']) {
                details.requestHeaders['User-Agent'] = cleanUA;
            }
            callback({ cancel: false, requestHeaders: details.requestHeaders });
        });

        session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
            const responseHeaders = Object.assign({}, details.responseHeaders);
            const isYouTube = details.url.includes('youtube.com') ||
                              details.url.includes('youtube-nocookie.com') ||
                              details.url.includes('googlevideo.com');
            if (isYouTube) {
                delete responseHeaders['x-frame-options'];
                delete responseHeaders['X-Frame-Options'];
                delete responseHeaders['content-security-policy'];
                delete responseHeaders['Content-Security-Policy'];
            }
            callback({ cancel: false, responseHeaders });
        });
    }

    // Strip all YouTube native chrome, share buttons, top overlays, watermarks and title bars at root frame level
    // No window may be navigated away from the app's own files, nor open new windows: a link in a
    // note opens in the system browser instead of loading a website into a privileged window.
    const appBaseUrl = url.pathToFileURL(__dirname).href.toLowerCase();
    app.on('web-contents-created', (event, contents) => {
        contents.setWindowOpenHandler(({ url: targetUrl }) => {
            const safeUrl = toSafeExternalUrl(targetUrl);
            if (safeUrl && /^https?:/i.test(safeUrl)) shell.openExternal(safeUrl);
            return { action: 'deny' };
        });
        contents.on('will-navigate', (navEvent, targetUrl) => {
            if (typeof targetUrl === 'string' && targetUrl.toLowerCase().startsWith(appBaseUrl)) return;
            navEvent.preventDefault();
            const safeUrl = toSafeExternalUrl(targetUrl);
            if (safeUrl && /^https?:/i.test(safeUrl)) shell.openExternal(safeUrl);
        });

        contents.on('did-frame-finish-load', (frameEvent, isMainFrame, frameProcessId, frameRoutingId) => {
            if (webFrameMain) {
                const frame = webFrameMain.fromId(frameProcessId, frameRoutingId);
                if (frame && (frame.url.includes('youtube.com') || frame.url.includes('youtube-nocookie.com'))) {
                    frame.executeJavaScript(`(() => {
                        const injectCleanStyle = () => {
                            if (document.getElementById('nosh-yt-cleaner')) return;
                            const style = document.createElement('style');
                            style.id = 'nosh-yt-cleaner';
                            style.textContent = \`
                                .ytwPlayerTopControlsHost,
                                .player-controls-top,
                                .ytPlayerControlsContainerHost,
                                .player-controls,
                                .player-controls-content,
                                .player-controls-background-container,
                                .player-controls-middle,
                                .player-controls-bottom,
                                .ytmVideoInfoHost,
                                .ytwPlayerSeekOverlayHost,
                                .ytp-offline-slate,
                                .ytp-chrome-top,
                                .ytp-gradient-top,
                                .ytp-chrome-bottom,
                                .ytp-gradient-bottom,
                                .ytp-watermark,
                                .ytp-youtube-button,
                                .ytp-pause-overlay,
                                .ytp-share-button,
                                .ytp-show-cards-title,
                                .ytp-title-channel,
                                .ytp-title,
                                .ytp-button,
                                [id*="watermark"],
                                [class*="watermark"],
                                [class*="TopControls"],
                                [class*="ShareButton"],
                                [class*="share-button"] {
                                    display: none !important;
                                    opacity: 0 !important;
                                    visibility: hidden !important;
                                    pointer-events: none !important;
                                }
                            \`;
                            (document.head || document.documentElement).appendChild(style);
                        };
                        injectCleanStyle();
                        const observer = new MutationObserver(injectCleanStyle);
                        observer.observe(document.documentElement, { childList: true, subtree: true });
                    })()`).catch(() => {});
                }
            }
        });
    });

    notesRoots.load();
    noshTray.loadPrefs();
    createWindow();
    const shortcutRegistered = registerQuickCaptureShortcut();
    noshTray.createTray({
        iconPath: path.join(__dirname, 'icon.ico'),
        fallbackIconPath: path.join(__dirname, 'icon.png'),
        shortcutRegistered,
        onOpen: showMainWindow,
        onQuickCapture: showQuickCaptureWindow,
        onQuit: requestQuit
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

process.on('uncaughtException', (error) => {
    if (error.message && error.message.includes('Object has been destroyed')) {
        console.warn('Electron window destroyed warning:', error.message);
    } else {
        console.error('Uncaught Exception:', error);
    }
});
