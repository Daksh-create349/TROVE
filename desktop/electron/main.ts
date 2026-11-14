import { existsSync, readFileSync, writeFileSync, statSync, readdirSync, copyFileSync, mkdirSync, createWriteStream } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { BackendManager } from "./backendManager";
import { ProfileSecurityManager } from "./profileSecurity";

// Ensure app name is consistently "Trove" across dev and production
app.setName("Trove");

// Inherit full user PATH in macOS GUI app instances (fixes node/nvm resolution)
function fixPath(): void {
  if (process.platform !== "darwin") return;
  try {
    const stdout = execSync("/bin/zsh -ilc 'echo -n $PATH'", { encoding: "utf8", timeout: 2500 });
    if (stdout && stdout.length > 5) {
      process.env.PATH = `${stdout}:${process.env.PATH}`;
    }
  } catch {
    const home = process.env.HOME || "";
    process.env.PATH = `/usr/local/bin:/opt/homebrew/bin:${home ? `${home}/.nvm/versions/node/v22.23.2/bin:` : ""}${process.env.PATH}`;
  }
}
fixPath();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow: BrowserWindow | null = null;
const backend = new BackendManager();
const profileSecurity = new ProfileSecurityManager();

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

async function createWindow() {
  const iconPath = existsSync(join(__dirname, "../build/icon.png"))
    ? join(__dirname, "../build/icon.png")
    : existsSync(join(__dirname, "../public/logo.png"))
    ? join(__dirname, "../public/logo.png")
    : undefined;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    frame: false,
    titleBarStyle: "hidden",
    titleBarOverlay: false,
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: "#0d0e12",
    icon: iconPath,
    show: false,
    webPreferences: {
      preload: existsSync(join(__dirname, "preload.cjs"))
        ? join(__dirname, "preload.cjs")
        : join(__dirname, "preload.js"),
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
    // Set Trove Dock icon on macOS
    if (process.platform === "darwin" && app.dock) {
      const dockIconPath = existsSync(join(__dirname, "../build/icon.png"))
        ? join(__dirname, "../build/icon.png")
        : existsSync(join(__dirname, "../public/logo.png"))
        ? join(__dirname, "../public/logo.png")
        : null;
      if (dockIconPath) {
        try {
          app.dock.setIcon(dockIconPath);
        } catch {
          // ignore
        }
      }
    }

    // Ensure persistent data directory and migrate existing project database if needed
    try {
      const userDataDir = app.getPath("userData");
      const targetDataDir = join(userDataDir, "data");
      if (!existsSync(targetDataDir)) {
        mkdirSync(targetDataDir, { recursive: true });
      }

      // Check legacy credentials from trove-desktop
      const legacyCred = join(dirname(userDataDir), "trove-desktop", "credentials.json");
      const targetCred = join(userDataDir, "credentials.json");
      if (existsSync(legacyCred) && !existsSync(targetCred)) {
        try { copyFileSync(legacyCred, targetCred); } catch {}
      }

      // Check legacy project data directory
      const projectDataCandidates = [
        resolve(__dirname, "../../backend/data"),
        resolve(__dirname, "../../../backend/data"),
        resolve(__dirname, "../backend/data"),
        resolve(process.cwd(), "televault/backend/data"),
        resolve(process.cwd(), "backend/data"),
      ];

      const sourceDir = projectDataCandidates.find(
        (d) => existsSync(join(d, "televault.db"))
      );

      if (sourceDir && !existsSync(join(targetDataDir, "televault.db"))) {
        const filesToCopy = [
          "televault.db",
          "televault.db-shm",
          "televault.db-wal",
          "telegram.session",
          "master.key",
          "api-token",
        ];
        for (const f of filesToCopy) {
          const s = join(sourceDir, f);
          const d = join(targetDataDir, f);
          if (existsSync(s) && !existsSync(d)) {
            try { copyFileSync(s, d); } catch {}
          }
        }
      }
    } catch (err) {
      console.warn("Data directory initialization warning:", err);
    }

    // Restore saved Telegram credentials to process environment if available
    try {
      const credPath = join(app.getPath("userData"), "credentials.json");
      if (existsSync(credPath)) {
        const raw = readFileSync(credPath, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed.apiId && parsed.apiHash) {
          process.env.TELEGRAM_API_ID = String(parsed.apiId);
          process.env.TELEGRAM_API_HASH = String(parsed.apiHash);
        }
      }
    } catch {
      // ignore
    }

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

  // Download entire folder as ZIP archive
  ipcMain.handle(
    "folders:download-zip",
    async (_event, folderId: string, folderName: string) => {
      if (!mainWindow) return { canceled: true };
      const safeName = (folderName || "Folder").replace(/[/\\?%*:|"<>]/g, "_");
      const res = await dialog.showSaveDialog(mainWindow, {
        title: `Save "${folderName}" as ZIP`,
        defaultPath: `${safeName}.zip`,
        filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
      });

      if (res.canceled || !res.filePath) {
        return { canceled: true };
      }

      const targetPath = res.filePath;
      const info = backend.getInfo();
      const url = `${info.url}/api/folders/${folderId}/download-zip?token=${encodeURIComponent(info.apiToken)}`;

      const response = await fetch(url);
      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(
          `Failed to download folder archive (${response.status}): ${errorText || response.statusText}`,
        );
      }

      if (!response.body) {
        throw new Error("No response body received from server");
      }

      const fileStream = createWriteStream(targetPath);
      await pipeline(Readable.fromWeb(response.body as any), fileStream);
      return { canceled: false, savedPath: targetPath };
    },
  );

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
  const IGNORED_NAMES = new Set([
    ".git",
    "node_modules",
    ".DS_Store",
    "Thumbs.db",
    "desktop.ini",
    ".vscode",
    ".idea",
    "dist",
    "dist-electron",
    "release",
    ".cache",
    ".turbo",
  ]);

  ipcMain.handle(
    "uploads:from-paths",
    async (_event, filePaths: string[], folderId?: string | null) => {
      const results: unknown[] = [];

      async function processPath(p: string, parentFolderId?: string | null) {
        try {
          if (!existsSync(p)) return;
          const base = basename(p);
          if (IGNORED_NAMES.has(base) || base.startsWith(".")) {
            return;
          }

          const stat = statSync(p);
          if (stat.isDirectory()) {
            const folderName = base;
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
              if (IGNORED_NAMES.has(entry) || entry.startsWith(".")) continue;
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
      // 1. Persist to Electron userData for permanent local storage
      let saved = false;
      try {
        const credPath = join(app.getPath("userData"), "credentials.json");
        writeFileSync(credPath, JSON.stringify({ apiId, apiHash }, null, 2), "utf8");
        saved = true;
      } catch (err) {
        console.warn("Failed saving credentials to userData:", err);
      }

      // 2. Also write to .env for dev workflow if writable
      const backendRoot = backend.getBackendRoot();
      const candidates = [
        backendRoot ? resolve(backendRoot, ".env") : "",
        resolve(__dirname, "../../backend/.env"),
        resolve(__dirname, "../../../backend/.env"),
        resolve(__dirname, "../../../televault/backend/.env"),
        resolve(process.cwd(), "televault/backend/.env"),
        resolve(process.cwd(), "backend/.env"),
      ].filter(Boolean);

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

      // 3. Update in-flight running backend via API (which also persists to SQLite settings)
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

