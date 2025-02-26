const {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  systemPreferences,
} = require("electron");
const path = require("path");
const fs = require("fs");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200, // Increased from default
    height: 800, // Increased from default
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      enableRemoteModule: true,
    },
  });

  // Verifica permissões de áudio no macOS
  if (process.platform === "darwin") {
    const micPermission = systemPreferences.getMediaAccessStatus("microphone");
    if (micPermission !== "granted") {
      systemPreferences.askForMediaAccess("microphone");
    }
  }

  mainWindow.loadFile("src/index.html");

  // Tratamento de erros da janela
  mainWindow.webContents.on("render-process-gone", (event, details) => {
    console.log("Renderer process gone, reason:", details.reason);
    mainWindow.reload();
  });

  // Add this in the createWindow function after loading the initial file
  mainWindow.webContents.on("will-navigate", (event, url) => {
    console.log("Navigation requested to:", url);
  });
}

// Envia todas as fontes de áudio disponíveis
ipcMain.on("get-sources", async (event) => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ["audio", "window", "screen"],
      fetchWindowIcons: false,
    });
    event.reply("sources", sources);
  } catch (e) {
    console.error("Error getting sources:", e);
    event.reply("sources-error", e.message);
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", function () {
  if (process.platform !== "darwin") app.quit();
});

// Tratamento de erros globais
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});
