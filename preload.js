const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Канал для отслеживания подключения флешки
    onUsbConnected: (callback) => ipcRenderer.on('usb-connected', (event, value) => callback(value)),
    // Канал для отправки найденных треков
    onAudioFound: (callback) => ipcRenderer.on('audio-found', (event, value) => callback(value))
});
