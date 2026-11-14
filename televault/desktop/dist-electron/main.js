var L = Object.defineProperty;
var $ = (s, e, t) => e in s ? L(s, e, { enumerable: !0, configurable: !0, writable: !0, value: t }) : s[e] = t;
var y = (s, e, t) => $(s, typeof e != "symbol" ? e + "" : e, t);
import { existsSync as m, readFileSync as E, writeFileSync as S, statSync as M, readdirSync as N } from "node:fs";
import { dirname as A, resolve as o, join as k, basename as C } from "node:path";
import { fileURLToPath as B } from "node:url";
import { app as f, safeStorage as b, BrowserWindow as w, ipcMain as h, shell as F, dialog as R } from "electron";
import { spawn as x } from "node:child_process";
import { randomBytes as U, scryptSync as D, timingSafeEqual as q } from "node:crypto";
const V = B(import.meta.url), p = A(V);
class W {
  constructor() {
    y(this, "childProcess", null);
    y(this, "port", 4787);
    y(this, "apiToken", "");
    y(this, "isReady", !1);
    y(this, "isShuttingDown", !1);
    this.port = parseInt(process.env.PORT || "4787", 10);
  }
  get baseUrl() {
    return `http://127.0.0.1:${this.port}`;
  }
  getInfo() {
    return {
      isReady: this.isReady,
      url: this.baseUrl,
      port: this.port,
      apiToken: this.apiToken
    };
  }
  getBackendRoot() {
    return this.locateBackendRoot();
  }
  async start() {
    if (this.apiToken = this.locateApiToken(), await this.checkHealth()) {
      this.isReady = !0;
      return;
    }
    await this.spawnBackendProcess();
    for (let t = 1; t <= 35; t++) {
      if (await this.checkHealth()) {
        this.isReady = !0, this.apiToken = this.locateApiToken();
        return;
      }
      await new Promise((n) => setTimeout(n, 200));
    }
    throw new Error(`Failed to start TeleVault backend server at ${this.baseUrl}`);
  }
  locateApiToken() {
    if (process.env.TELEVAULT_API_TOKEN)
      return process.env.TELEVAULT_API_TOKEN.trim();
    const e = this.locateBackendRoot(), t = [
      e ? o(e, "data/api-token") : "",
      e ? o(e, "data/token") : "",
      o(p, "../../backend/data/api-token"),
      o(p, "../../backend/data/token"),
      o(p, "../../../backend/data/api-token"),
      o(p, "../../../backend/data/token"),
      (() => {
        try {
          return k(f.getPath("userData"), "televault-data", "api-token");
        } catch {
          return "";
        }
      })(),
      (() => {
        try {
          return k(f.getPath("userData"), "televault-data", "token");
        } catch {
          return "";
        }
      })(),
      o(process.cwd(), "televault/backend/data/api-token"),
      o(process.cwd(), "televault/backend/data/token"),
      o(process.cwd(), "backend/data/api-token"),
      o(process.cwd(), "backend/data/token")
    ].filter(Boolean);
    for (const a of t)
      if (m(a))
        try {
          const c = E(a, "utf8").trim();
          if (c) return c;
        } catch {
        }
    const n = [
      e ? o(e, ".env") : "",
      o(p, "../../backend/.env"),
      o(p, "../../../backend/.env"),
      o(process.cwd(), "televault/backend/.env"),
      o(process.cwd(), "backend/.env")
    ].filter(Boolean);
    for (const a of n)
      if (m(a))
        try {
          const l = E(a, "utf8").match(/^TELEVAULT_API_TOKEN=(.+)$/m);
          if (l && l[1])
            return l[1].trim();
        } catch {
        }
    return "";
  }
  async checkHealth() {
    try {
      const e = new AbortController(), t = setTimeout(() => e.abort(), 1200), n = await fetch(`${this.baseUrl}/api/health`, {
        headers: { Host: `127.0.0.1:${this.port}` },
        signal: e.signal
      });
      if (clearTimeout(t), n.ok) {
        const a = await n.json();
        return a && a.ok === !0;
      }
      return !1;
    } catch {
      return !1;
    }
  }
  async spawnBackendProcess() {
    var l;
    const e = this.locateBackendRoot();
    if (!e)
      throw new Error("Could not find televault backend directory");
    const t = k(e, "dist/backend/src/server.js"), n = m(t), a = this.apiToken || this.locateApiToken() || "2ZaA5jHpqp05oqouOs9g4UONM5qenG7UweL-YXvhMK6LZpag16G_59HfrzR65dvP";
    this.apiToken = a;
    const c = {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(this.port),
      TELEVAULT_API_TOKEN: a,
      NODE_ENV: process.env.NODE_ENV || "production"
    };
    if (n) {
      const u = [
        "C:\\Program Files\\nodejs\\node.exe",
        process.platform === "win32" ? "node.exe" : "node"
      ];
      let r = process.platform === "win32" ? "node.exe" : "node";
      for (const i of u)
        if (i.includes(":") && m(i)) {
          r = i;
          break;
        }
      this.childProcess = x(r, [t], {
        cwd: e,
        env: c,
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: !0
      }), (l = this.childProcess.stderr) == null || l.on("data", (i) => {
        console.warn(`[Backend Err]: ${i}`);
      }), this.childProcess.on("exit", (i, T) => {
        console.warn(`[Backend Exited]: code=${i} signal=${T}`), this.isReady = !1, this.childProcess = null, this.isShuttingDown || (console.warn("[BackendManager] Backend unexpectedly exited, restarting..."), setTimeout(() => {
          !this.isShuttingDown && !this.isReady && this.start().catch((P) => console.warn("[BackendManager] Auto-restart failed:", P));
        }, 1200));
      }), this.childProcess.on("error", (i) => {
        console.warn("[Backend Spawn Error]:", i), this.isReady = !1, this.childProcess = null;
      });
    } else {
      const u = process.platform === "win32" ? "npx.cmd" : "npx";
      this.childProcess = x(
        u,
        ["tsx", "src/server.ts"],
        {
          cwd: e,
          env: c,
          stdio: "ignore",
          windowsHide: !0
        }
      ), this.childProcess.on("error", (r) => {
        console.warn("[Backend Spawn Error]:", r);
      }), this.childProcess.on("exit", (r, i) => {
        console.warn(`[Backend Dev Exited]: code=${r} signal=${i}`), this.isReady = !1, this.childProcess = null, this.isShuttingDown || setTimeout(() => {
          !this.isShuttingDown && !this.isReady && this.start().catch(() => {
          });
        }, 1200);
      });
    }
  }
  locateBackendRoot() {
    const e = [
      o(p, "../../backend"),
      o(p, "../../../backend"),
      o(p, "../../../televault/backend"),
      o(p, "../backend"),
      o(process.cwd(), "televault/backend"),
      o(process.cwd(), "backend"),
      o(process.cwd(), "../backend"),
      k(process.resourcesPath || "", "backend")
    ];
    for (const t of e)
      if (m(k(t, "package.json")))
        return t;
    return null;
  }
  async request(e, t = {}) {
    const n = `${this.baseUrl}${e.startsWith("/") ? e : `/${e}`}`;
    this.apiToken || (this.apiToken = this.locateApiToken());
    const a = {
      Host: `127.0.0.1:${this.port}`,
      "X-Televault-Token": this.apiToken,
      ...t.headers
    };
    t.body && typeof t.body == "string" && !a["Content-Type"] && (a["Content-Type"] = "application/json"), this.isReady || await this.start().catch(() => {
    });
    const c = 3;
    let l = null;
    for (let u = 0; u <= c; u++)
      try {
        this.apiToken || (this.apiToken = this.locateApiToken()), a["X-Televault-Token"] = this.apiToken, a["X-Trove-Token"] = this.apiToken;
        const r = await fetch(n, {
          ...t,
          headers: a
        }), i = await r.json().catch(() => null);
        return !r.ok || !(i != null && i.ok) ? {
          ok: !1,
          error: (i == null ? void 0 : i.error) || {
            code: "HTTP_ERROR",
            message: `Request failed with status ${r.status}`
          }
        } : i;
      } catch (r) {
        l = r, u < c && (this.childProcess || await this.start().catch(() => {
        }), await new Promise((i) => setTimeout(i, 250 * (u + 1))));
      }
    return {
      ok: !1,
      error: {
        code: "NETWORK_ERROR",
        message: (l == null ? void 0 : l.message) || "Could not connect to Trove backend"
      }
    };
  }
  stop() {
    if (this.isShuttingDown = !0, this.childProcess) {
      try {
        this.childProcess.kill();
      } catch {
      }
      this.childProcess = null;
    }
    this.isReady = !1;
  }
  async restart() {
    this.stop(), await new Promise((e) => setTimeout(e, 600)), await this.start();
  }
}
class G {
  constructor() {
    y(this, "filePath", null);
  }
  getFilePath() {
    if (!this.filePath)
      try {
        this.filePath = k(f.getPath("userData"), "local_security.json");
      } catch {
        this.filePath = k(process.cwd(), "local_security.json");
      }
    return this.filePath;
  }
  hasPassword() {
    const e = this.readRecord();
    return !!(e != null && e.hasPassword && e.hashHex && e.saltHex);
  }
  setPassword(e) {
    if (!e || e.length < 4)
      throw new Error("Password must be at least 4 characters long");
    const t = U(32), n = D(e, t, 64, {
      N: 16384,
      r: 8,
      p: 1
    }), a = {
      hasPassword: !0,
      saltHex: t.toString("hex"),
      hashHex: n.toString("hex")
    };
    return this.writeRecord(a), { success: !0 };
  }
  verifyPassword(e) {
    const t = this.readRecord();
    if (!t || !t.hasPassword || !t.hashHex || !t.saltHex)
      return { valid: !0 };
    const n = Buffer.from(t.saltHex, "hex"), a = Buffer.from(t.hashHex, "hex"), c = D(e, n, 64, {
      N: 16384,
      r: 8,
      p: 1
    });
    return { valid: q(a, c) };
  }
  readRecord() {
    const e = this.getFilePath();
    if (!m(e))
      return null;
    try {
      const t = E(e);
      let n;
      if (b.isEncryptionAvailable())
        try {
          n = b.decryptString(t);
        } catch {
          n = t.toString("utf8");
        }
      else
        n = t.toString("utf8");
      return JSON.parse(n);
    } catch {
      return null;
    }
  }
  writeRecord(e) {
    const t = this.getFilePath(), n = JSON.stringify(e, null, 2);
    if (b.isEncryptionAvailable()) {
      const a = b.encryptString(n);
      S(t, a);
    } else
      S(t, n, "utf8");
  }
}
const j = B(import.meta.url), v = A(j);
let d = null;
const g = new W(), _ = new G(), z = process.env.NODE_ENV === "development" || !f.isPackaged;
async function H() {
  d = new w({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    frame: !1,
    titleBarStyle: "hidden",
    titleBarOverlay: !1,
    backgroundColor: "#0d0e12",
    show: !1,
    webPreferences: {
      preload: k(v, "preload.js"),
      contextIsolation: !0,
      nodeIntegration: !1,
      sandbox: !1
      // needed for typed preload IPC
    }
  }), d.once("ready-to-show", () => {
    d == null || d.show();
  }), z && process.env.VITE_DEV_SERVER_URL ? await d.loadURL(process.env.VITE_DEV_SERVER_URL) : await d.loadFile(k(v, "../dist/index.html"));
}
const K = f.requestSingleInstanceLock();
K ? (f.on("second-instance", () => {
  d && (d.isMinimized() && d.restore(), d.focus());
}), f.whenReady().then(async () => {
  J();
  try {
    await g.start();
  } catch (s) {
    console.warn("Backend startup warning (connecting to running instance or starting):", s);
  }
  await H(), f.on("activate", () => {
    w.getAllWindows().length === 0 && H();
  });
})) : f.quit();
f.on("window-all-closed", () => {
  process.platform !== "darwin" && f.quit();
});
f.on("before-quit", () => {
  g.stop();
});
function J() {
  h.handle("shell:open-external", (s, e) => {
    typeof e == "string" && (e.startsWith("https://") || e.startsWith("http://")) && F.openExternal(e);
  }), h.handle("window:minimize", (s) => {
    const e = w.fromWebContents(s.sender) || d || w.getFocusedWindow();
    e == null || e.minimize();
  }), h.handle("window:maximize", (s) => {
    const e = w.fromWebContents(s.sender) || d || w.getFocusedWindow();
    e && (e.isMaximized() ? e.unmaximize() : e.maximize());
  }), h.handle("window:close", (s) => {
    const e = w.fromWebContents(s.sender) || d || w.getFocusedWindow();
    e == null || e.close();
  }), h.handle("window:is-maximized", (s) => {
    const e = w.fromWebContents(s.sender) || d || w.getFocusedWindow();
    return (e == null ? void 0 : e.isMaximized()) ?? !1;
  }), h.handle(
    "dialog:select-files",
    async (s, e) => {
      if (!d) return null;
      const t = await R.showOpenDialog(d, {
        properties: e != null && e.multi ? ["openFile", "multiSelections"] : ["openFile"],
        filters: e == null ? void 0 : e.filters
      });
      return t.canceled || t.filePaths.length === 0 ? null : t.filePaths;
    }
  ), h.handle("dialog:select-folder", async () => {
    if (!d) return null;
    const s = await R.showOpenDialog(d, {
      properties: ["openDirectory", "createDirectory"]
    });
    return s.canceled || s.filePaths.length === 0 ? null : s.filePaths[0] || null;
  }), h.handle("dialog:select-upload-folder", async () => {
    if (!d) return null;
    const s = await R.showOpenDialog(d, {
      title: "Select Folder to Upload to Trove",
      properties: ["openDirectory"]
    });
    return s.canceled || s.filePaths.length === 0 ? null : s.filePaths[0] || null;
  }), h.handle("backend:get-info", () => g.getInfo()), h.on("backend:get-token-sync", (s) => {
    s.returnValue = g.getInfo().apiToken;
  }), h.handle("api:request", async (s, e, t) => g.request(e, t)), h.handle(
    "uploads:from-paths",
    async (s, e, t) => {
      const n = [];
      async function a(c, l) {
        var u;
        try {
          if (!m(c)) return;
          const r = M(c);
          if (r.isDirectory()) {
            const i = C(c);
            let T = l;
            const P = await g.request("/api/folders", {
              method: "POST",
              body: JSON.stringify({
                name: i,
                parentId: l || null
              })
            });
            P.ok && ((u = P.data) != null && u.id) && (T = P.data.id);
            const O = N(c);
            for (const I of O)
              await a(k(c, I), T);
          } else if (r.isFile()) {
            const i = await g.request("/api/uploads", {
              method: "POST",
              body: JSON.stringify({
                filePath: c,
                folderId: l || null
              })
            });
            i.ok && i.data && n.push(i.data);
          }
        } catch (r) {
          console.warn("Failed processing upload path:", c, r);
        }
      }
      for (const c of e)
        await a(c, t);
      return n;
    }
  ), h.handle("profile:has-password", () => _.hasPassword()), h.handle("profile:set-password", (s, e) => _.setPassword(e)), h.handle("profile:verify-password", (s, e) => _.verifyPassword(e)), h.handle(
    "telegram:save-credentials",
    async (s, e, t) => {
      const n = g.getBackendRoot(), a = [
        n ? o(n, ".env") : "",
        o(v, "../../backend/.env"),
        o(v, "../../../backend/.env"),
        o(v, "../../../televault/backend/.env"),
        o(process.cwd(), "televault/backend/.env"),
        o(process.cwd(), "backend/.env"),
        "C:\\Users\\Daksh\\OneDrive\\Desktop\\Televault\\televault\\backend\\.env"
      ].filter(Boolean);
      let c = !1;
      for (const l of a)
        try {
          const u = A(l);
          if (m(u)) {
            let r = "";
            m(l) && (r = E(l, "utf8")), r.includes("TELEGRAM_API_ID=") ? r = r.replace(/TELEGRAM_API_ID=.*/g, `TELEGRAM_API_ID=${e}`) : r += `
TELEGRAM_API_ID=${e}`, r.includes("TELEGRAM_API_HASH=") ? r = r.replace(/TELEGRAM_API_HASH=.*/g, `TELEGRAM_API_HASH=${t}`) : r += `
TELEGRAM_API_HASH=${t}`, S(l, r.trim() + `
`, "utf8"), c = !0;
          }
        } catch (u) {
          console.warn("Failed saving credentials to .env at", l, u);
        }
      process.env.TELEGRAM_API_ID = String(e), process.env.TELEGRAM_API_HASH = t;
      try {
        (await g.request("/api/telegram/config", {
          method: "POST",
          body: JSON.stringify({ apiId: e, apiHash: t })
        })).ok && (c = !0);
      } catch (l) {
        console.warn("Backend dynamic config request warning:", l);
      }
      return { success: c, isConfigured: !0 };
    }
  );
}
