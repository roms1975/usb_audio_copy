const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process'); // Используем стандартный модуль

let mainWindow;
let knownDrives = new Set();
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.ogg', '.m4a']);

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.loadFile('index.html');
}

// Рекурсивный поиск аудиофайлов
function scanAudioFiles(dirPath) {
    try {
        const files = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const file of files) {
            const resPath = path.join(dirPath, file.name);
            if (file.isDirectory()) {
                scanAudioFiles(resPath);
            } else {
                const ext = path.extname(file.name).toLowerCase();
                if (AUDIO_EXTENSIONS.has(ext)) {
                    mainWindow.webContents.send('audio-found', {
                        name: file.name,
                        path: resPath
                    });
                }
            }
        }
    } catch (err) {
        // Пропускаем папки без доступа
    }
}

// Замена drivelist: опрос через стандартный PowerShell Windows
function checkDrives() {
    if (!mainWindow) return;

    // Запрашиваем только логические диски типа 2 (Removable / Съемные)
    const cmd = 'powershell -Command "Get-CimInstance Win32_LogicalDisk | Where-Object {$_.DriveType -eq 2} | Select-Object -ExpandProperty DeviceID"';
    
    exec(cmd, (error, stdout) => {
        if (error) return;

        // Разбиваем ответ по строкам, убираем пробелы и пустые элементы
        const currentDrives = stdout
            .split('\r\n')
            .map(drive => drive.trim())
            .filter(drive => drive.length > 0);

        const currentRemovableSet = new Set();

        currentDrives.forEach(drive => {
            const mountPath = drive + '\\'; // Превращаем "D:" в "D:\"
            currentRemovableSet.add(mountPath);

            if (!knownDrives.has(mountPath)) {
                mainWindow.webContents.send('usb-connected', mountPath);
                // Запускаем асинхронно, чтобы не вешать интерфейс
                setTimeout(() => scanAudioFiles(mountPath), 100);
            }
        });

        knownDrives = currentRemovableSet;
    });
}

app.whenReady().then(() => {
    createWindow();

    // Опрашиваем систему каждые 2 секунды чисто на JS
    setInterval(checkDrives, 2000);

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
