require('dotenv').config();

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const axios = require('axios');
const FormData = require('form-data');

let mainWindow;
let knownDrives = new Set();
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.ogg', '.m4a']);

// ПРАВИЛЬНЫЙ ОПРЕДЕЛИТЕЛЬ ПУТИ ДЛЯ PORTABLE EXE:
let EXE_DIR;
if (app.isPackaged) {
    // Если это Portable EXE, берем путь, откуда его запустил пользователь.
    // Если это обычная сборка, берем директорию самого процесса.
    EXE_DIR = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'));
} else {
    EXE_DIR = __dirname; // Режим разработки
}

const TARGET_DIR = path.join(EXE_DIR, 'audio');

// Создаем папку "audio" на реальном диске
if (!fs.existsSync(TARGET_DIR)) {
    try {
        fs.mkdirSync(TARGET_DIR, { recursive: true });
    } catch (e) {
        console.error("Fail to create folder audio:", e);
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        show: false,
        icon: path.join(__dirname, 'icon.ico'), // <--- ДОБАВЬТЕ ЭТУ СТРОКУ
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.loadFile('index.html');

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
		//mainWindow.webContents.openDevTools();
        setInterval(checkDrives, 2000);
    });
}

function scanAudioFiles(dirPath) {
    try {
        if (!fs.existsSync(dirPath)) return;
        const files = fs.readdirSync(dirPath, { withFileTypes: true });

        for (const file of files) {
            const resPath = path.join(dirPath, file.name);
            if (file.isDirectory()) {
                scanAudioFiles(resPath);
            } else {
                const ext = path.extname(file.name).toLowerCase();
                if (AUDIO_EXTENSIONS.has(ext)) {
                    const srcStats = fs.statSync(resPath);
                    let destPath = path.join(TARGET_DIR, file.name);
                    let finalName = file.name;

                    if (fs.existsSync(destPath)) {
                        const destStats = fs.statSync(destPath);
                        if (srcStats.size === destStats.size) {
                            continue; 
                        }

                        const baseName = path.basename(file.name, ext);
                        let counter = 1;
                        while (fs.existsSync(destPath)) {
                            finalName = `${baseName} (${counter})${ext}`;
                            destPath = path.join(TARGET_DIR, finalName);
                            counter++;
                        }
                    }

                    mainWindow.webContents.send('audio-found', {
                        name: finalName,
                        path: resPath
                    });

                    fs.copyFile(resPath, destPath, (err) => {
                        if (err) {
                            console.error(`Copy file error ${finalName}:`, err);
                        } else {
                            console.log(`[Local] has been copy: ${finalName}`);
                            
                            // ВЫЗЫВАЕМ МЕТОД ОТПРАВКИ НА СЕРВЕР ПОСЛЕ УСПЕШНОГО КОПИРОВАНИЯ
                            uploadFileToServer(destPath, finalName);
                        }
                    });
                }
            }
        }
    } catch (err) {
        // Пропускаем папки без доступа
    }
}

function checkDrives() {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    // Используем чистый и быстрый PowerShell запрос вместо WMIC
    const cmd = 'powershell -Command "Get-CimInstance Win32_LogicalDisk | Where-Object {$_.DriveType -eq 2} | Select-Object -ExpandProperty DeviceID"';
    
    exec(cmd, (error, stdout) => {
        if (error) return;

        const currentDrives = stdout
            .split('\n')
            .map(drive => drive.replace(/[\r\n\t ]/g, '')) 
            .filter(drive => drive.length > 0 && drive.includes(':'));

        const currentRemovableSet = new Set();

        currentDrives.forEach(drive => {
            const mountPath = drive + '\\';
            currentRemovableSet.add(mountPath);

            if (!knownDrives.has(mountPath)) {
                mainWindow.webContents.send('usb-connected', mountPath);
                setTimeout(() => {
                    scanAudioFiles(mountPath);
                }, 1500);
            }
        });

        knownDrives = currentRemovableSet;
    });
}

async function uploadFileToServer(filePath, fileName) {
	const apiURL = process.env.API_URL; 
    const token = process.env.API_TOKEN;
	
	if (!apiURL || !token) {
        console.error('[API Error] Envirement variables API_URL or API_TOKEN not set in .env');
        return;
    }

    try {
        // Создаем форму для отправки бинарных данных (multipart/form-data)
        const form = new FormData();
		
		// Очищаем имя от пробелов и спецсимволов для безопасной передачи в HTTP-заголовке
		const safeApiName = fileName
			.replace(/[^a-zA-Z0-9\._\-]/g, '_') // Заменяем все странные символы на подчеркивание
			.replace(/_{2,}/g, '_'); 
				
        // Считываем файл в виде потока (stream) — это не грузит оперативную память
        form.append('file', fs.createReadStream(filePath), {
            filename: safeApiName
        });
		form.append('original_name', fileName);

        console.log(`[API] Start upload: ${fileName}`);

        // Выполняем POST запрос по аналогии с REST API методами
        const response = await axios.post(apiURL, form, {
            headers: {
                ...form.getHeaders(), // Автоматически выставит boundary и Content-Type
                'Authorization': `Bearer ${token}` // Передаем токен в заголовках
            },
            maxContentLength: Infinity, // Снимаем ограничения на размер файла
            maxBodyLength: Infinity
        });

        if (response.status === 200 || response.status === 201) {
            console.log(`[API] Success file upload: ${fileName}`);
            // Можно отправить статус "Загружен на сервер" в интерфейс Electron
            // mainWindow.webContents.send('upload-success', fileName);
        }
    } catch (error) {
        console.error(`[API Error] Fail upload file ${fileName}:`, error.message);
        if (error.response) {
            // Сервер ответил кодом ошибки (например, 400, 401, 500)
            console.error(`[API Server response]:`, error.response.data);
        }
    }
}

app.whenReady().then(() => {
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
