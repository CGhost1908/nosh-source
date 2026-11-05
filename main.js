const { app, BrowserWindow, ipcMain, Menu, MenuItem, dialog, shell, session, webFrameMain } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const os = require('os');
const fetch = require('node-fetch');
const express = require('express');
const axios = require('axios');
const querystring = require('querystring');
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

let loadingWindow;
let win;
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
    if (fs.existsSync(defaultNoshSaves)) {
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
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true,
            webviewTag: true,
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

    win.on('unmaximize', () => {
        if (win && !win.isDestroyed()) {
            win.webContents.send('window-maximized-state', false);
        }
    });

    win.on('close', async (event) => {
        event.preventDefault();
        if (win && !win.isDestroyed()) {
            win.webContents.send('confirm-close');
        }
    });
}

// Window control IPCs
ipcMain.on('minimize', () => {
    if (win) win.minimize();
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
    if (shouldClose && win) {
        win.destroy();
    }
});

// Shell & Native OS helpers
ipcMain.handle('open-external', async (event, externalUrl) => {
    if (typeof externalUrl === 'string' && externalUrl.trim()) {
        let url = externalUrl.trim();
        if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//i.test(url) && !url.startsWith('mailto:')) {
            url = 'https://' + url;
        }
        try {
            await shell.openExternal(url);
            return true;
        } catch (err) {
            console.error('Failed to open external URL:', err);
            return false;
        }
    }
    return false;
});

ipcMain.handle('open-folder', async (event, folderPath) => {
    const target = folderPath || saveFolder;
    if (fs.existsSync(target)) {
        await shell.openPath(target);
        return true;
    }
    return false;
});

ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(win, {
        title: 'Select Notes Folder',
        properties: ['openDirectory']
    });
    return result.filePaths[0] || null;
});

ipcMain.handle('get-save-path', () => {
    if (!saveFolder) initSaveFolder();
    return saveFolder;
});

ipcMain.handle('upload-to-catbox', async (event, { filePath, base64Data, fileName, mimeType }) => {
    try {
        let fileBuffer = null;
        let finalName = fileName || 'asset.png';

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

ipcMain.handle('open-file-dialog', async () => {
    const result = await dialog.showOpenDialog(win, {
        title: 'Open Note File',
        properties: ['openFile'],
        filters: [
            { name: 'Nosh Notes (*.nsh)', extensions: ['nsh'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    });

    if (!result.canceled && result.filePaths.length > 0) {
        const filePath = result.filePaths[0];
        const content = fs.readFileSync(filePath, 'utf8');
        return {
            filePath,
            fileName: path.basename(filePath, path.extname(filePath)),
            content
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
    let targetPath = outputPath;
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
            nodeIntegration: true,
            contextIsolation: false
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

ipcMain.handle('close-youtube-pip', () => {
    if (youtubePipWindow && !youtubePipWindow.isDestroyed()) {
        youtubePipWindow.close();
        youtubePipWindow = null;
    }
    return { success: true };
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
    app.on('web-contents-created', (event, contents) => {
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

    createWindow();
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
