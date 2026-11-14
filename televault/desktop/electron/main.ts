import { existsSync, readFileSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { BackendManager } from "./backendManager";
import { ProfileSecurityManager } from "./profileSecurity";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow: BrowserWindow | null = null;
const backend = new BackendManager();
const profileSecurity = new ProfileSecurityManager();

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    frame: false,
    titleBarStyle: "hidden",
    titleBarOverlay: false,
    backgroundColor: "#0d0e12",
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // needed for typed preload IPC
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(join(__dirname, "../dist/index.html"));
  }
}

// Ensure single application instance
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    setupIpcHandlers();

    try {
      await backend.start();
    } catch (err) {
      console.warn("Backend startup warning (connecting to running instance or starting):", err);
    }

    await createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  backend.stop();
});

function setupIpcHandlers() {
  // Window controls
  ipcMain.handle("shell:open-external", (_event, url: string) => {
    if (typeof url === "string" && (url.startsWith("https://") || url.startsWith("http://"))) {
      shell.openExternal(url);
    }
  });

  ipcMain.handle("window:minimize", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow || BrowserWindow.getFocusedWindow();
    win?.minimize();
  });

  ipcMain.handle("window:maximize", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow || BrowserWindow.getFocusedWindow();
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
  });

  ipcMain.handle("window:close", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow || BrowserWindow.getFocusedWindow();
    win?.close();
  });

  ipcMain.handle("window:is-maximized", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow || BrowserWindow.getFocusedWindow();
    return win?.isMaximized() ?? false;
  });

  // Native dialogs
  ipcMain.handle(
    "dialog:select-files",
    async (_event, options?: { multi?: boolean; filters?: { name: string; extensions: string[] }[] }) => {
      if (!mainWindow) return null;
      const res = await dialog.showOpenDialog(mainWindow, {
        properties: options?.multi ? ["openFile", "multiSelections"] : ["openFile"],
        filters: options?.filters,
      });
      if (res.canceled || res.filePaths.length === 0) {
        return null;
      }
      return res.filePaths;
    },
  );

  ipcMain.handle("dialog:select-folder", async () => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "createDirectory"],
    });
    if (res.canceled || res.filePaths.length === 0) {
      return null;
    }
    return res.filePaths[0] || null;
  });

  ipcMain.handle("dialog:select-upload-folder", async () => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      title: "Select Folder to Upload to Trove",
      properties: ["openDirectory"],
    });
    if (res.canceled || res.filePaths.length === 0) {
      return null;
    }
    return res.filePaths[0] || null;
  });

  // Backend info
  ipcMain.handle("backend:get-info", () => {
    return backend.getInfo();
  });

  ipcMain.on("backend:get-token-sync", (event) => {
    event.returnValue = backend.getInfo().apiToken;
  });

  // API proxy
  ipcMain.handle("api:request", async (_event, endpoint: string, options?: RequestInit) => {
    return backend.request(endpoint, options);
  });

  // Batch upload multiple file paths and whole directories recursively
  ipcMain.handle(
    "uploads:from-paths",
    async (_event, filePaths: string[], folderId?: string | null) => {
      const results: unknown[] = [];

      async function processPath(p: string, parentFolderId?: string | null) {
        try {
          if (!existsSync(p)) return;
          const stat = statSync(p);
          if (stat.isDirectory()) {
            const folderName = basename(p);
            let targetFolderId = parentFolderId;
            const res = await backend.request<{ id: string }>("/api/folders", {
              method: "POST",
              body: JSON.stringify({
                name: folderName,
                parentId: parentFolderId || null,
              }),
            });
            if (res.ok && res.data?.id) {
              targetFolderId = res.data.id;
            }

            const entries = readdirSync(p);
            for (const entry of entries) {
              await processPath(join(p, entry), targetFolderId);
            }
          } else if (stat.isFile()) {
            const res = await backend.request("/api/uploads", {
              method: "POST",
              body: JSON.stringify({
                filePath: p,
                folderId: parentFolderId || null,
              }),
            });
            if (res.ok && res.data) {
              results.push(res.data);
            }
          }
        } catch (err) {
          console.warn("Failed processing upload path:", p, err);
        }
      }

      for (const filePath of filePaths) {
        await processPath(filePath, folderId);
      }
      return results;
    },
  );

  // Profile Security
  ipcMain.handle("profile:has-password", () => {
    return profileSecurity.hasPassword();
  });

  ipcMain.handle("profile:set-password", (_event, password: string) => {
    return profileSecurity.setPassword(password);
  });

  ipcMain.handle("profile:verify-password", (_event, password: string) => {
    return profileSecurity.verifyPassword(password);
  });

  // Telegram Credentials Configuration
  ipcMain.handle(
    "telegram:save-credentials",
    async (_event, apiId: number, apiHash: string) => {
      const backendRoot = backend.getBackendRoot();
      const candidates = [
        backendRoot ? resolve(backendRoot, ".env") : "",
        resolve(__dirname, "../../backend/.env"),
        resolve(__dirname, "../../../backend/.env"),
        resolve(__dirname, "../../../televault/backend/.env"),
        resolve(process.cwd(), "televault/backend/.env"),
        resolve(process.cwd(), "backend/.env"),
        "C:\\Users\\Daksh\\OneDrive\\Desktop\\Televault\\televault\\backend\\.env",
      ].filter(Boolean);

      let saved = false;
      for (const p of candidates) {
        try {
          const dir = dirname(p);
          if (existsSync(dir)) {
            let content = "";
            if (existsSync(p)) {
              content = readFileSync(p, "utf8");
            }
            if (content.includes("TELEGRAM_API_ID=")) {
              content = content.replace(/TELEGRAM_API_ID=.*/g, `TELEGRAM_API_ID=${apiId}`);
            } else {
              content += `\nTELEGRAM_API_ID=${apiId}`;
            }
            if (content.includes("TELEGRAM_API_HASH=")) {
              content = content.replace(/TELEGRAM_API_HASH=.*/g, `TELEGRAM_API_HASH=${apiHash}`);
            } else {
              content += `\nTELEGRAM_API_HASH=${apiHash}`;
            }
            writeFileSync(p, content.trim() + "\n", "utf8");
            saved = true;
          }
        } catch (err) {
          console.warn("Failed saving credentials to .env at", p, err);
        }
      }

      process.env.TELEGRAM_API_ID = String(apiId);
      process.env.TELEGRAM_API_HASH = apiHash;

      // Update in-flight running backend via API
      try {
        const res = await backend.request<{ configured: boolean }>("/api/telegram/config", {
          method: "POST",
          body: JSON.stringify({ apiId, apiHash }),
        });
        if (res.ok) {
          saved = true;
        }
      } catch (err) {
        console.warn("Backend dynamic config request warning:", err);
      }

      return { success: saved, isConfigured: true };
    },
  );
}

