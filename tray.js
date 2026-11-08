// System tray icon + "keep running when the window is closed" preference.
// Staying resident keeps the global Quick Capture hotkey (Ctrl+Alt+N) available.
// Preferences live in <userData>/nosh-prefs.json so the main process can read them at close time.
const { app, Tray, Menu, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULT_PREFS = { keepInTray: true, minimizeToTray: false, trayHintShown: false };

let prefs = { ...DEFAULT_PREFS };
let tray = null;
let handlers = null;
let shortcutOk = true;

function prefsFile() {
    return path.join(app.getPath('userData'), 'nosh-prefs.json');
}

function loadPrefs() {
    prefs = { ...DEFAULT_PREFS };
    try {
        const saved = JSON.parse(fs.readFileSync(prefsFile(), 'utf8'));
        for (const key of Object.keys(DEFAULT_PREFS)) {
            if (typeof saved[key] === 'boolean') prefs[key] = saved[key];
        }
    } catch (err) {
        if (err.code !== 'ENOENT') console.warn('Could not read Nosh preferences, using defaults:', err.message);
    }
    return prefs;
}

function savePrefs() {
    try {
        fs.writeFileSync(prefsFile(), JSON.stringify(prefs, null, 2), 'utf8');
    } catch (err) {
        console.warn('Could not save Nosh preferences:', err.message);
    }
}

function getPrefs() {
    return { ...prefs };
}

function isTrayActive() {
    return Boolean(tray) && !tray.isDestroyed();
}

// Hide-to-tray only makes sense while the tray icon actually exists
function shouldKeepInTray() {
    return prefs.keepInTray && isTrayActive();
}

function shouldMinimizeToTray() {
    return Boolean(prefs.minimizeToTray) && isTrayActive();
}

function setKeepInTray(value) {
    prefs.keepInTray = Boolean(value);
    savePrefs();
    refreshMenu();
}

function setMinimizeToTray(value) {
    prefs.minimizeToTray = Boolean(value);
    savePrefs();
}

function markHintShown() {
    if (prefs.trayHintShown) return false;
    prefs.trayHintShown = true;
    savePrefs();
    return true;
}

function buildMenuTemplate() {
    const quickNote = shortcutOk
        ? { label: 'Quick note', accelerator: 'CommandOrControl+Alt+N', registerAccelerator: false, click: () => handlers.onQuickCapture() }
        : { label: 'Quick note (Ctrl+Alt+N is used by another app)', click: () => handlers.onQuickCapture() };

    return [
        { label: 'Open Nosh', click: () => handlers.onOpen() },
        quickNote,
        { type: 'separator' },
        {
            label: 'Keep running when the window is closed',
            type: 'checkbox',
            checked: prefs.keepInTray,
            click: (item) => setKeepInTray(item.checked)
        },
        { type: 'separator' },
        { label: 'Quit Nosh', click: () => handlers.onQuit() }
    ];
}

function refreshMenu() {
    if (isTrayActive()) tray.setContextMenu(Menu.buildFromTemplate(buildMenuTemplate()));
}

function loadIcon(iconPath, fallbackPath) {
    // Prefer high-resolution PNG source for highest quality Lanczos/bicubic downscaling
    const candidates = [fallbackPath, iconPath].filter(p => p && fs.existsSync(p));
    const pngCandidate = candidates.find(p => p.toLowerCase().endsWith('.png'));
    const chosenPath = pngCandidate || candidates[0];

    if (!chosenPath) return nativeImage.createEmpty();

    const base = nativeImage.createFromPath(chosenPath);
    if (base.isEmpty()) return nativeImage.createEmpty();

    // Standard Windows tray sizes across DPI scales:
    // 100% scale (96 DPI): 16x16
    // 125% scale (120 DPI): 20x20 (default on most 1080p Windows laptops)
    // 150% scale (144 DPI): 24x24 (common on 2K / high-DPI screens)
    // 200% scale (192 DPI): 32x32 (common on 4K screens)
    // 300% scale (288 DPI): 48x48
    const multi = nativeImage.createEmpty();
    const representations = [
        { scaleFactor: 1.0, size: 16 },
        { scaleFactor: 1.25, size: 20 },
        { scaleFactor: 1.5, size: 24 },
        { scaleFactor: 2.0, size: 32 },
        { scaleFactor: 3.0, size: 48 }
    ];

    for (const { scaleFactor, size } of representations) {
        const resized = base.resize({ width: size, height: size, quality: 'best' });
        multi.addRepresentation({ scaleFactor, width: size, height: size, buffer: resized.toPNG() });
    }

    return multi;
}

// handlers: { onOpen, onQuickCapture, onQuit }
function createTray({ iconPath, fallbackIconPath, shortcutRegistered = true, ...callbacks }) {
    if (isTrayActive()) return tray;
    handlers = callbacks;
    shortcutOk = shortcutRegistered;

    try {
        tray = new Tray(loadIcon(iconPath, fallbackIconPath));
    } catch (err) {
        console.error('Could not create the tray icon:', err);
        tray = null;
        return null;
    }

    tray.setToolTip('Nosh');
    tray.on('click', () => handlers.onOpen());
    tray.on('double-click', () => handlers.onOpen());
    refreshMenu();
    return tray;
}

function showHint() {
    if (!isTrayActive() || process.platform !== 'win32' || !markHintShown()) return;
    tray.displayBalloon({
        iconType: 'info',
        title: 'Nosh is still running',
        content: 'Press Ctrl+Alt+N for a quick note. Right-click the tray icon to quit.'
    });
}

function destroyTray() {
    if (isTrayActive()) tray.destroy();
    tray = null;
}

// Lets the end-to-end tests inspect the tray; unused in normal runs
if (process.env.NOSH_E2E === '1') {
    global.__noshTray = { getTray: () => tray, buildMenuTemplate, getPrefs, setKeepInTray };
}

module.exports = { loadPrefs, getPrefs, setKeepInTray, setMinimizeToTray, shouldKeepInTray, shouldMinimizeToTray, createTray, destroyTray, showHint };
