// Preload for the floating YouTube player window: just the three things it needs.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pip', {
    getServerPort: () => ipcRenderer.invoke('get-server-port'),
    setAlwaysOnTop: (pinned) => ipcRenderer.invoke('pip-set-always-on-top', Boolean(pinned)),
    onLoadVideo: (callback) => {
        if (typeof callback !== 'function') return;
        ipcRenderer.on('load-video', (_event, payload) => callback(payload || {}));
    }
});
