# Electron-based app to copy audio files from USB storage to the local "audio" folder

## Usage:
1. Copy the `USBAudioScanner 1.0.1.exe` file to your Windows host.
2. Run the file by double-clicking it; you will see the application window.
3. Insert a USB storage device.
4. The app will find the audio files, create an "audio" folder, and copy them into this folder (only new files will be copied).

## Run by npm
1. npm start

## Build exe from source
1. npm run dist
2. If the build is successful, a dist folder will be created
3. The required ***USBAudioScanner 1.0.1.exe*** file will be in the dist folder
