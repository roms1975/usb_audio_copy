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
var badge = '';

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
			const ext = path.extname(file.name).toLowerCase();
			if (AUDIO_EXTENSIONS.has(ext)) {
				mainWindow.webContents.send('audio-found', {
					name: file.name,
					path: resPath
				});

				// ВЫЗЫВАЕМ МЕТОД ОТПРАВКИ НА СЕРВЕР ПОСЛЕ УСПЕШНОГО КОПИРОВАНИЯ
				uploadFileToServer(resPath, file.name, badge);
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
				badge = get_badge(mountPath);
				if (!badge) {
					console.log(`The badge.json file is missing or the badge.json file contains invalid data`);
					return;
				}
                setTimeout(() => {
                    scanAudioFiles(mountPath);
                }, 1500);
            }
        });

        knownDrives = currentRemovableSet;
    });
}

function get_badge(mountPath) {
	try {
		let badge_path = mountPath + 'badge.json';
        if (!fs.existsSync(badge_path)) {
			return false;
		}
        let fileContent = fs.readFileSync(badge_path, 'utf-8');
		let data = JSON.parse(fileContent);
		console.log(`badge %o`, data);
		return data;
	} catch (error) {
		return false;
	}
}

async function uploadFileToServer(filePath, fileName, badge) {
	// const apiURL = process.env.API_URL; 
    // const token = process.env.API_TOKEN;
	const apiURL = 'https://z8.fpg.ru/b9/api/v2/upload.php'; 
    const token = '4fbf1db640bf7dd37300af3f6db20841';
	
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
		
		if (badge && typeof badge === 'object') {
            for (const key in badge) {
                if (badge.hasOwnProperty(key)) {
                    // Переводим значение в строку, так как FormData принимает только строки или бинарные данные
                    const value = typeof badge[key] === 'object' 
                        ? JSON.stringify(badge[key]) 
                        : String(badge[key]);
                        
                    form.append(key, value); 
                    // Например, если в bage.json было { "owner": "Ivan" }, то добавится поле owner со значением Ivan
                }
            }
        } else {
			console.log(`No badge, exit`);
			return;
		}

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
			//console.log('[API Ответ сервера]:', response.data); 
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
