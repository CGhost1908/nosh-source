// Preload for the main window: the only bridge between the page and Node/Electron.
//
// The page runs with contextIsolation on and no Node integration. Everything it can still do
// goes through the narrow, validated API exposed here as `window.nosh`:
//   - ipc:       only whitelisted channels
//   - fs:        only inside the folders main.js allows (see notes-roots.js)
//   - path:      pure string helpers
//   - clipboard, highlight, drive: the few capabilities the app needs
// The page-side compatibility layer (renderer-bridge.js) turns this back into the familiar
// ipcRenderer / fs / fsPromises / path globals the rest of the code already uses.
const { contextBridge, ipcRenderer, clipboard } = require('electron');
const fs = require('fs');
const nodePath = require('path');

// ---------- IPC whitelist ----------
const SEND_CHANNELS = new Set([
    'minimize', 'maximize', 'close', 'proceed-close', 'app-ready',
    'quick-capture-open', 'quick-capture-result'
]);
const INVOKE_CHANNELS = new Set([
    'is-maximized', 'open-external', 'open-folder', 'select-folder', 'get-save-path',
    'upload-to-catbox', 'open-file-dialog', 'save-file-dialog', 'export-file-dialog',
    'export-pdf', 'create-file', 'open-youtube-pip', 'close-youtube-pip', 'get-server-port'
]);
const LISTEN_CHANNELS = new Set([
    'confirm-close', 'window-maximized-state', 'open-nsh-file', 'drive-token', 'quick-capture-append'
]);

function requireChannel(set, channel, kind) {
    if (typeof channel !== 'string' || !set.has(channel)) {
        throw new Error(`IPC channel "${channel}" is not allowed (${kind})`);
    }
}

const ipc = {
    send(channel, ...args) {
        requireChannel(SEND_CHANNELS, channel, 'send');
        ipcRenderer.send(channel, ...args);
    },
    invoke(channel, ...args) {
        requireChannel(INVOKE_CHANNELS, channel, 'invoke');
        return ipcRenderer.invoke(channel, ...args);
    },
    on(channel, callback) {
        requireChannel(LISTEN_CHANNELS, channel, 'listen');
        if (typeof callback !== 'function') return;
        // The real IpcRendererEvent cannot cross the context bridge, so hand over an empty stand-in
        ipcRenderer.on(channel, (_event, ...args) => callback({}, ...args));
    }
};

// ---------- Scoped file system ----------
const IS_WIN = process.platform === 'win32';
const fsp = fs.promises;
let roots = [];

function refreshRoots() {
    try {
        roots = ipcRenderer.sendSync('nosh:get-roots') || [];
    } catch (_) {
        roots = [];
    }
}

// One-time migration of the custom notes folder older versions kept in localStorage
try {
    roots = ipcRenderer.sendSync('nosh:claim-legacy-root', window.localStorage.getItem('saves-path')) || [];
} catch (_) {
    refreshRoots();
}

const norm = (p) => (IS_WIN ? nodePath.resolve(String(p)).toLowerCase() : nodePath.resolve(String(p)));

function insideRoots(target) {
    const t = norm(target);
    return roots.some(root => {
        const r = norm(root);
        return t === r || t.startsWith(r.endsWith(nodePath.sep) ? r : r + nodePath.sep);
    });
}

function isAllowed(target) {
    if (typeof target !== 'string' || !target) return false;
    if (insideRoots(target)) return true;
    refreshRoots(); // the user may have just chosen a new folder
    return insideRoots(target);
}

function isRootItself(target) {
    return roots.some(root => norm(root) === norm(target));
}

function forbidden(target) {
    const err = new Error(`Access outside the notes folder is not allowed: ${target}`);
    err.code = 'ENOSH_FORBIDDEN';
    return err;
}

function guard(target) {
    if (!isAllowed(target)) throw forbidden(target);
    return nodePath.resolve(target);
}

// Errors lose their `code` crossing the bridge, so results travel as { ok, value | code, message }
function failure(err) {
    return { ok: false, code: (err && err.code) || 'EUNKNOWN', message: (err && err.message) || 'Unknown error' };
}
function syncCall(fn) {
    return (...args) => {
        try { return { ok: true, value: fn(...args) }; } catch (err) { return failure(err); }
    };
}
function asyncCall(fn) {
    return async (...args) => {
        try { return { ok: true, value: await fn(...args) }; } catch (err) { return failure(err); }
    };
}

function toBuffer(data) {
    return typeof data === 'string' ? data : Buffer.from(data);
}

const scopedFs = {
    existsSync: syncCall((p) => isAllowed(p) && fs.existsSync(p)),
    mkdirSync: syncCall((p, options) => {
        fs.mkdirSync(guard(p), { recursive: Boolean(options && options.recursive) });
    }),
    readFile: asyncCall(async (p, encoding) => {
        const data = await fsp.readFile(guard(p), encoding ? { encoding: String(encoding) } : undefined);
        return typeof data === 'string' ? data : new Uint8Array(data);
    }),
    writeFile: asyncCall(async (p, data, encoding) => {
        await fsp.writeFile(guard(p), toBuffer(data), typeof data === 'string' ? (encoding || 'utf8') : undefined);
    }),
    readdir: asyncCall(async (p, options) => {
        const dir = guard(p);
        if (options && options.withFileTypes) {
            const entries = await fsp.readdir(dir, { withFileTypes: true });
            return entries.map(e => ({ name: e.name, isDirectory: e.isDirectory(), isFile: e.isFile() }));
        }
        return fsp.readdir(dir);
    }),
    stat: asyncCall(async (p) => {
        const s = await fsp.stat(guard(p));
        return {
            size: s.size, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs, birthtimeMs: s.birthtimeMs,
            isFile: s.isFile(), isDirectory: s.isDirectory()
        };
    }),
    unlink: asyncCall((p) => fsp.unlink(guard(p))),
    rename: asyncCall(async (from, to) => {
        if (isRootItself(from)) throw forbidden(from);
        await fsp.rename(guard(from), guard(to));
    }),
    mkdir: asyncCall(async (p, options) => {
        await fsp.mkdir(guard(p), { recursive: Boolean(options && options.recursive) });
    }),
    rm: asyncCall(async (p, options) => {
        const target = guard(p);
        if (isRootItself(target)) throw forbidden(target); // never delete a whole notes folder
        await fsp.rm(target, { recursive: Boolean(options && options.recursive), force: Boolean(options && options.force) });
    }),
    copyFile: asyncCall((from, to) => fsp.copyFile(guard(from), guard(to)))
};

// ---------- Small helpers ----------
const pathApi = {
    sep: nodePath.sep,
    join: (...parts) => nodePath.join(...parts.map(String)),
    resolve: (...parts) => nodePath.resolve(...parts.map(String)),
    basename: (p, ext) => nodePath.basename(String(p), ext === undefined ? undefined : String(ext)),
    dirname: (p) => nodePath.dirname(String(p)),
    extname: (p) => nodePath.extname(String(p)),
    normalize: (p) => nodePath.normalize(String(p))
};

const clipboardApi = {
    readText: () => clipboard.readText(),
    readHTML: () => clipboard.readHTML(),
    writeText: (text) => clipboard.writeText(String(text))
};

// highlight.js is only needed for PDF export; load it on first use
let hljs = null;
const loadHljs = () => (hljs = hljs || require('highlight.js'));
const highlightApi = {
    hasLanguage: (lang) => {
        try { return Boolean(loadHljs().getLanguage(String(lang))); } catch (_) { return false; }
    },
    highlight: (code, lang) => {
        try { return loadHljs().highlight(String(code), { language: String(lang), ignoreIllegals: true }).value; } catch (_) { return null; }
    },
    auto: (code) => {
        try { return loadHljs().highlightAuto(String(code)).value; } catch (_) { return null; }
    }
};

// Google Drive runs here, out of the page's reach; the page only sees plain results
let driveApi = null;
const loadDrive = () => (driveApi = driveApi || require('./drive-api'));
const drive = {
    hasDefaultCredentials: () => {
        try { return loadDrive().hasDefaultCredentials(); } catch (_) { return false; }
    },
    call: async (op, auth, args) => {
        try {
            return await loadDrive().call(String(op), auth, args);
        } catch (err) {
            return { ok: false, code: 'DRIVE_ERROR', message: (err && err.message) || 'Google Drive is unavailable' };
        }
    }
};

contextBridge.exposeInMainWorld('nosh', {
    ipc,
    fs: scopedFs,
    path: pathApi,
    clipboard: clipboardApi,
    highlight: highlightApi,
    drive,
    platform: process.platform
});
