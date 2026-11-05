// Page-side compatibility layer over the preload bridge (window.nosh).
//
// The page no longer has require() or Node access. This file rebuilds the familiar globals the
// rest of the app was written against (ipcRenderer, fs, fsPromises, path, shell) on top of the
// narrow API preload.js exposes, so the other scripts keep working unchanged. Loaded first.

const ipcRenderer = {
    send: (channel, ...args) => window.nosh.ipc.send(channel, ...args),
    invoke: (channel, ...args) => window.nosh.ipc.invoke(channel, ...args),
    on: (channel, listener) => window.nosh.ipc.on(channel, listener)
};

const path = window.nosh.path;
const nativeClipboard = window.nosh.clipboard;
const shell = { openExternal: (url) => ipcRenderer.invoke('open-external', url) };

// File results arrive as { ok, value } / { ok: false, code, message } because an Error's `code`
// does not survive the bridge; rebuild real errors so `err.code === 'ENOENT'` keeps working.
function unwrapFsResult(result) {
    if (result && result.ok) return result.value;
    const err = new Error((result && result.message) || 'File operation failed');
    err.code = (result && result.code) || 'EUNKNOWN';
    throw err;
}

function fsEncoding(options) {
    if (typeof options === 'string') return options;
    return (options && options.encoding) || undefined;
}

function fsBytes(data) {
    if (typeof data === 'string') return data;
    return data instanceof ArrayBuffer ? new Uint8Array(data) : data;
}

const fsPromises = {
    readFile: (p, options) => window.nosh.fs.readFile(String(p), fsEncoding(options)).then(unwrapFsResult),
    writeFile: (p, data, options) => window.nosh.fs.writeFile(String(p), fsBytes(data), fsEncoding(options)).then(unwrapFsResult),
    readdir: async (p, options) => {
        const result = unwrapFsResult(await window.nosh.fs.readdir(String(p), { withFileTypes: Boolean(options && options.withFileTypes) }));
        if (options && options.withFileTypes) {
            return result.map(e => ({ name: e.name, isDirectory: () => e.isDirectory, isFile: () => e.isFile }));
        }
        return result;
    },
    stat: async (p) => {
        const s = unwrapFsResult(await window.nosh.fs.stat(String(p)));
        return {
            size: s.size,
            mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs, birthtimeMs: s.birthtimeMs,
            mtime: new Date(s.mtimeMs), ctime: new Date(s.ctimeMs), birthtime: new Date(s.birthtimeMs),
            isFile: () => s.isFile,
            isDirectory: () => s.isDirectory
        };
    },
    unlink: (p) => window.nosh.fs.unlink(String(p)).then(unwrapFsResult),
    rename: (from, to) => window.nosh.fs.rename(String(from), String(to)).then(unwrapFsResult),
    mkdir: (p, options) => window.nosh.fs.mkdir(String(p), { recursive: Boolean(options && options.recursive) }).then(unwrapFsResult),
    rm: (p, options) => window.nosh.fs.rm(String(p), { recursive: Boolean(options && options.recursive), force: Boolean(options && options.force) }).then(unwrapFsResult),
    copyFile: (from, to) => window.nosh.fs.copyFile(String(from), String(to)).then(unwrapFsResult)
};

const fs = {
    promises: fsPromises,
    // Outside the allowed folders this answers "no" rather than throwing, like a missing file
    existsSync: (p) => {
        const result = window.nosh.fs.existsSync(String(p));
        return Boolean(result && result.ok && result.value);
    },
    mkdirSync: (p, options) => unwrapFsResult(window.nosh.fs.mkdirSync(String(p), { recursive: Boolean(options && options.recursive) }))
};
