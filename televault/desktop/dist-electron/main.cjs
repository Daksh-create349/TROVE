var x = Object.defineProperty;
var H = (s, e, t) => e in s ? x(s, e, { enumerable: !0, configurable: !0, writable: !0, value: t }) : s[e] = t;
var _ = (s, e, t) => H(s, typeof e != "symbol" ? e + "" : e, t);
import { existsSync as p, readFileSync as y, writeFileSync as b } from "node:fs";
import { resolve as n, join as u, dirname as S } from "node:path";
import { fileURLToPath as I } from "node:url";
import { app as h, safeStorage as v, BrowserWindow as f, ipcMain as l, shell as B, dialog as E } from "electron";
import { spawn as T } from "node:child_process";
import { randomBytes as L, scryptSync as R, timingSafeEqual as D } from "node:crypto";
class O {
  constructor() {
    _(this, "childProcess", null);
    _(this, "port", 4787);
    _(this, "apiToken", "");
    _(this, "isReady", !1);
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
      await new Promise((o) => setTimeout(o, 200));
    }
    throw new Error(`Failed to start TeleVault backend server at ${this.baseUrl}`);
  }
  locateApiToken() {
    if (process.env.TELEVAULT_API_TOKEN)
      return process.env.TELEVAULT_API_TOKEN.trim();
    const e = this.locateBackendRoot(), t = [
      e ? n(e, "data/api-token") : "",
      e ? n(e, "data/token") : "",
      n(__dirname, "../../backend/data/api-token"),
      n(__dirname, "../../backend/data/token"),
      n(__dirname, "../../../backend/data/api-token"),
      n(__dirname, "../../../backend/data/token"),
      u(h.getPath("userData"), "televault-data", "api-token"),
      u(h.getPath("userData"), "televault-data", "token"),
      n(process.cwd(), "televault/backend/data/api-token"),
      n(process.cwd(), "televault/backend/data/token"),
      n(process.cwd(), "backend/data/api-token"),
      n(process.cwd(), "backend/data/token")
    ].filter(Boolean);
    for (const a of t)
      if (p(a))
        try {
          const i = y(a, "utf8").trim();
          if (i) return i;
        } catch {
        }
    const o = [
      e ? n(e, ".env") : "",
      n(__dirname, "../../backend/.env"),
      n(__dirname, "../../../backend/.env"),
      n(process.cwd(), "televault/backend/.env"),
      n(process.cwd(), "backend/.env")
    ].filter(Boolean);
    for (const a of o)
      if (p(a))
        try {
          const r = y(a, "utf8").match(/^TELEVAULT_API_TOKEN=(.+)$/m);
          if (r && r[1])
            return r[1].trim();
        } catch {
        }
    return "";
  }
  async checkHealth() {
    try {
      const e = new AbortController(), t = setTimeout(() => e.abort(), 1200), o = await fetch(`${this.baseUrl}/api/health`, {
        headers: { Host: `127.0.0.1:${this.port}` },
        signal: e.signal
      });
      if (clearTimeout(t), o.ok) {
        const a = await o.json();
        return a && a.ok === !0;
      }
      return !1;
    } catch {
      return !1;
    }
  }
  async spawnBackendProcess() {
    var i, r;
    const e = this.locateBackendRoot();
    if (!e)
      throw new Error("Could not find televault backend directory");
    const t = u(e, "dist/backend/src/server.js"), o = p(t), a = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      HOST: "127.0.0.1",
      PORT: String(this.port),
      NODE_ENV: process.env.NODE_ENV || "production"
    };
    if (o) {
      const w = [
        "C:\\Program Files\\nodejs\\node.exe",
        process.platform === "win32" ? "node.exe" : "node"
      ];
      let d = process.platform === "win32" ? "node.exe" : "node";
      for (const k of w)
        if (k.includes(":") && p(k)) {
          d = k;
          break;
        }
      this.childProcess = T(d, [t], {
        cwd: e,
        env: a,
        stdio: ["ignore", "pipe", "pipe"]
      }), (i = this.childProcess.stdout) == null || i.on("data", (k) => {
        console.log(`[Backend]: ${k}`);
      }), (r = this.childProcess.stderr) == null || r.on("data", (k) => {
        console.warn(`[Backend Err]: ${k}`);
      });
    } else {
      const w = process.platform === "win32" ? "npx.cmd" : "npx";
      this.childProcess = T(
        w,
        ["tsx", "src/server.ts"],
        {
          cwd: e,
          env: a,
          stdio: "ignore"
        }
      );
    }
    this.childProcess && this.childProcess.unref();
  }
  locateBackendRoot() {
    const e = [
      n(__dirname, "../../backend"),
      n(__dirname, "../../../backend"),
      n(__dirname, "../../../televault/backend"),
      n(__dirname, "../backend"),
      n(process.cwd(), "televault/backend"),
      n(process.cwd(), "backend"),
      n(process.cwd(), "../backend"),
      u(process.resourcesPath || "", "backend")
    ];
    for (const t of e)
      if (p(u(t, "package.json")))
        return t;
    return null;
  }
  async request(e, t = {}) {
    const o = `${this.baseUrl}${e.startsWith("/") ? e : `/${e}`}`;
    this.apiToken || (this.apiToken = this.locateApiToken());
    const a = {
      Host: `127.0.0.1:${this.port}`,
      "X-Televault-Token": this.apiToken,
      ...t.headers
    };
    t.body && typeof t.body == "string" && !a["Content-Type"] && (a["Content-Type"] = "application/json");
    try {
      const i = await fetch(o, {
        ...t,
        headers: a
      }), r = await i.json().catch(() => null);
      return !i.ok || !(r != null && r.ok) ? {
        ok: !1,
        error: (r == null ? void 0 : r.error) || {
          code: "HTTP_ERROR",
          message: `Request failed with status ${i.status}`
        }
      } : r;
    } catch (i) {
      return {
        ok: !1,
        error: {
          code: "NETWORK_ERROR",
          message: i.message || "Could not connect to TeleVault backend"
        }
      };
    }
  }
  stop() {
    if (this.childProcess) {
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
class C {
  constructor() {
    _(this, "filePath");
    this.filePath = u(h.getPath("userData"), "local_security.json");
  }
  hasPassword() {
    const e = this.readRecord();
    return !!(e != null && e.hasPassword && e.hashHex && e.saltHex);
  }
  setPassword(e) {
    if (!e || e.length < 4)
      throw new Error("Password must be at least 4 characters long");
    const t = L(32), o = R(e, t, 64, {
      N: 16384,
      r: 8,
      p: 1
    }), a = {
      hasPassword: !0,
      saltHex: t.toString("hex"),
      hashHex: o.toString("hex")
    };
    return this.writeRecord(a), { success: !0 };
  }
  verifyPassword(e) {
    const t = this.readRecord();
    if (!t || !t.hasPassword || !t.hashHex || !t.saltHex)
      return { valid: !0 };
    const o = Buffer.from(t.saltHex, "hex"), a = Buffer.from(t.hashHex, "hex"), i = R(e, o, 64, {
      N: 16384,
      r: 8,
      p: 1
    });
    return { valid: D(a, i) };
  }
  readRecord() {
    if (!p(this.filePath))
      return null;
    try {
      const e = y(this.filePath);
      let t;
      if (v.isEncryptionAvailable())
        try {
          t = v.decryptString(e);
        } catch {
          t = e.toString("utf8");
        }
      else
        t = e.toString("utf8");
      return JSON.parse(t);
    } catch {
      return null;
    }
  }
  writeRecord(e) {
    const t = JSON.stringify(e, null, 2);
    if (v.isEncryptionAvailable()) {
      const o = v.encryptString(t);
      b(this.filePath, o);
    } else
      b(this.filePath, t, "utf8");
  }
}
const N = I(import.meta.url), g = S(N);
let c = null;
const m = new O(), P = new C(), $ = process.env.NODE_ENV === "development" || !h.isPackaged;
async function A() {
  c = new f({
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
      preload: p(u(g, "preload.cjs")) ? u(g, "preload.cjs") : u(g, "preload.js"),
      contextIsolation: !0,
      nodeIntegration: !1,
      sandbox: !1
      // needed for typed preload IPC
    }
  }), c.once("ready-to-show", () => {
    c == null || c.show();
  }), $ && process.env.VITE_DEV_SERVER_URL ? await c.loadURL(process.env.VITE_DEV_SERVER_URL) : await c.loadFile(u(g, "../dist/index.html"));
}
const M = h.requestSingleInstanceLock();
M ? (h.on("second-instance", () => {
  c && (c.isMinimized() && c.restore(), c.focus());
}), h.whenReady().then(async () => {
  try {
    await m.start();
  } catch (s) {
    console.warn("Backend startup warning (connecting to running instance or starting):", s);
  }
  W(), await A(), h.on("activate", () => {
    f.getAllWindows().length === 0 && A();
  });
})) : h.quit();
h.on("window-all-closed", () => {
  process.platform !== "darwin" && h.quit();
});
h.on("before-quit", () => {
  m.stop();
});
function W() {
  l.handle("shell:open-external", (s, e) => {
    typeof e == "string" && (e.startsWith("https://") || e.startsWith("http://")) && B.openExternal(e);
  }), l.handle("window:minimize", (s) => {
    const e = f.fromWebContents(s.sender) || c || f.getFocusedWindow();
    e == null || e.minimize();
  }), l.handle("window:maximize", (s) => {
    const e = f.fromWebContents(s.sender) || c || f.getFocusedWindow();
    e && (e.isMaximized() ? e.unmaximize() : e.maximize());
  }), l.handle("window:close", (s) => {
    const e = f.fromWebContents(s.sender) || c || f.getFocusedWindow();
    e == null || e.close();
  }), l.handle("window:is-maximized", (s) => {
    const e = f.fromWebContents(s.sender) || c || f.getFocusedWindow();
    return (e == null ? void 0 : e.isMaximized()) ?? !1;
  }), l.handle(
    "dialog:select-files",
    async (s, e) => {
      if (!c) return null;
      const t = await E.showOpenDialog(c, {
        properties: e != null && e.multi ? ["openFile", "multiSelections"] : ["openFile"],
        filters: e == null ? void 0 : e.filters
      });
      return t.canceled || t.filePaths.length === 0 ? null : t.filePaths;
    }
  ), l.handle("dialog:select-folder", async () => {
    if (!c) return null;
    const s = await E.showOpenDialog(c, {
      properties: ["openDirectory", "createDirectory"]
    });
    return s.canceled || s.filePaths.length === 0 ? null : s.filePaths[0] || null;
  }), l.handle("backend:get-info", () => m.getInfo()), l.handle("api:request", async (s, e, t) => m.request(e, t)), l.handle(
    "uploads:from-paths",
    async (s, e, t) => {
      const o = [];
      for (const a of e) {
        const i = await m.request("/api/uploads", {
          method: "POST",
          body: JSON.stringify({
            filePath: a,
            folderId: t || null
          })
        });
        i.ok && i.data && o.push(i.data);
      }
      return o;
    }
  ), l.handle("profile:has-password", () => P.hasPassword()), l.handle("profile:set-password", (s, e) => P.setPassword(e)), l.handle("profile:verify-password", (s, e) => P.verifyPassword(e)), l.handle(
    "telegram:save-credentials",
    async (s, e, t) => {
      const o = m.getBackendRoot(), a = [
        o ? n(o, ".env") : "",
        n(g, "../../backend/.env"),
        n(g, "../../../backend/.env"),
        n(g, "../../../televault/backend/.env"),
        n(process.cwd(), "televault/backend/.env"),
        n(process.cwd(), "backend/.env"),
        "C:\\Users\\Daksh\\OneDrive\\Desktop\\Televault\\televault\\backend\\.env"
      ].filter(Boolean);
      let i = !1;
      for (const r of a)
        try {
          const w = S(r);
          if (p(w)) {
            let d = "";
            p(r) && (d = y(r, "utf8")), d.includes("TELEGRAM_API_ID=") ? d = d.replace(/TELEGRAM_API_ID=.*/g, `TELEGRAM_API_ID=${e}`) : d += `
TELEGRAM_API_ID=${e}`, d.includes("TELEGRAM_API_HASH=") ? d = d.replace(/TELEGRAM_API_HASH=.*/g, `TELEGRAM_API_HASH=${t}`) : d += `
TELEGRAM_API_HASH=${t}`, b(r, d.trim() + `
`, "utf8"), i = !0;
          }
        } catch (w) {
          console.warn("Failed saving credentials to .env at", r, w);
        }
      process.env.TELEGRAM_API_ID = String(e), process.env.TELEGRAM_API_HASH = t;
      try {
        await m.restart();
      } catch (r) {
        console.warn("Backend restart warning after saving credentials:", r);
      }
      return { success: i, isConfigured: !0 };
    }
  );
}
