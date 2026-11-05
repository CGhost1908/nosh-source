// Folders the renderer is allowed to read and write (main process).
//
// The window no longer has direct Node access: its preload exposes a file API that only works
// inside these folders. A folder becomes allowed in exactly three ways, none of which a script
// running inside a note can trigger on its own:
//   1. the default notes folder (decided here in the main process),
//   2. a folder the user picks in the native "Select Notes Folder" dialog,
//   3. a one-time migration of the custom folder an older version stored in localStorage.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

let state = { roots: [], legacyClaimed: false };
const sessionRoots = new Set(); // default folder; not persisted

const IS_WIN = process.platform === 'win32';
const norm = (p) => (IS_WIN ? path.resolve(String(p)).toLowerCase() : path.resolve(String(p)));

function stateFile() {
    return path.join(app.getPath('userData'), 'nosh-roots.json');
}

function load() {
    try {
        const saved = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
        state = {
            roots: Array.isArray(saved.roots) ? saved.roots.filter(r => typeof r === 'string') : [],
            legacyClaimed: saved.legacyClaimed === true
        };
    } catch (err) {
        if (err.code !== 'ENOENT') console.warn('Could not read the allowed folders list:', err.message);
    }
}

function save() {
    try {
        fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
        fs.writeFileSync(stateFile(), JSON.stringify(state, null, 2), 'utf8');
    } catch (err) {
        console.warn('Could not save the allowed folders list:', err.message);
    }
}

function isUsableFolder(folder) {
    try {
        const resolved = path.resolve(String(folder));
        if (path.parse(resolved).root === resolved) return false; // never a whole drive
        return fs.statSync(resolved).isDirectory();
    } catch (_) {
        return false;
    }
}

function allRoots() {
    return [...new Set([...sessionRoots, ...state.roots].map(r => path.resolve(r)))];
}

function isInside(target) {
    if (typeof target !== 'string' || !target) return false;
    const t = norm(target);
    return allRoots().some(root => {
        const r = norm(root);
        return t === r || t.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
    });
}

function setDefaultRoot(folder) {
    if (folder) sessionRoots.add(path.resolve(folder));
}

// Called after the user confirmed a folder in the native dialog
function addUserChosenRoot(folder) {
    if (!isUsableFolder(folder)) return false;
    const resolved = path.resolve(folder);
    if (!allRoots().some(r => norm(r) === norm(resolved))) {
        state.roots.push(resolved);
        save();
    }
    return true;
}

// Older versions kept the custom notes folder in the page's localStorage. Accept it once so
// existing users keep working after the upgrade; never again, so a page cannot grant itself access.
function claimLegacyRoot(folder) {
    if (state.legacyClaimed) return false;
    state.legacyClaimed = true;
    save();
    if (typeof folder === 'string' && folder && folder !== 'null' && isUsableFolder(folder)) {
        return addUserChosenRoot(folder);
    }
    return false;
}

module.exports = { load, allRoots, isInside, setDefaultRoot, addUserChosenRoot, claimLegacyRoot };
