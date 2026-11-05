// Preload for the Quick Capture window.
// The window runs sandboxed with contextIsolation, so this bridge is the only
// thing it can reach: submit a snippet, hide itself, and react to being shown.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quickCapture', {
    submit: (payload) => ipcRenderer.invoke('quick-capture-submit', payload),
    hide: () => ipcRenderer.send('quick-capture-hide'),
    onShown: (callback) => {
        ipcRenderer.on('quick-capture-shown', (_event, info) => callback(info || {}));
    }
});
