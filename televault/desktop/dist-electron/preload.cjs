var r = (e, t) => () => (t || e((t = { exports: {} }).exports, t), t.exports);
import { contextBridge as c, ipcRenderer as s } from "electron";
var u = r(() => {
  async function i(e, t) {
    var d, n, f;
    const o = await s.invoke("api:request", e, t);
    if (!o.ok) {
      const l = new Error(((d = o.error) == null ? void 0 : d.message) || "Request failed");
      throw l.code = (n = o.error) == null ? void 0 : n.code, l.details = (f = o.error) == null ? void 0 : f.details, l;
    }
    return o.data;
  }
  const g = {
    window: {
      minimize: () => s.invoke("window:minimize"),
      maximize: () => s.invoke("window:maximize"),
      close: () => s.invoke("window:close"),
      isMaximized: () => s.invoke("window:is-maximized")
    },
    dialog: {
      selectFiles: (e) => s.invoke("dialog:select-files", e),
      selectFolder: () => s.invoke("dialog:select-folder")
    },
    shell: {
      openExternal: (e) => s.invoke("shell:open-external", e)
    },
    platform: process.platform,
    backend: {
      getInfo: () => s.invoke("backend:get-info"),
      getHealth: () => i("/api/health")
    },
    telegram: {
      getStatus: () => i("/api/telegram/status"),
      getProfile: () => i("/api/telegram/profile"),
      startLogin: (e) => i("/api/telegram/auth/start", {
        method: "POST",
        body: JSON.stringify({ phoneNumber: e })
      }),
      verifyCode: (e) => i("/api/telegram/auth/verify", {
        method: "POST",
        body: JSON.stringify({ code: e })
      }),
      verifyPassword: (e) => i("/api/telegram/auth/verify-password", {
        method: "POST",
        body: JSON.stringify({ password: e })
      }),
      disconnect: () => i("/api/telegram/disconnect", {
        method: "POST"
      }),
      saveCredentials: (e, t) => s.invoke("telegram:save-credentials", e, t)
    },
    files: {
      list: (e) => {
        const t = new URLSearchParams();
        e != null && e.folderId && t.set("folderId", e.folderId), e != null && e.status && t.set("status", e.status), e != null && e.search && t.set("search", e.search), (e == null ? void 0 : e.limit) !== void 0 && t.set("limit", String(e.limit)), (e == null ? void 0 : e.offset) !== void 0 && t.set("offset", String(e.offset));
        const o = t.toString();
        return i(
          `/api/files${o ? `?${o}` : ""}`
        );
      },
      get: (e) => i(`/api/files/${e}`),
      getParts: (e) => i(`/api/files/${e}/parts`),
      delete: (e) => i(`/api/files/${e}`, {
        method: "DELETE"
      }),
      getDownloadUrl: (e) => `http://127.0.0.1:4787/api/files/${e}/download`,
      getPreviewUrl: (e) => `http://127.0.0.1:4787/api/files/${e}/preview`,
      downloadToPath: async (e, t, o) => (await i(
        "/api/downloads",
        {
          method: "POST",
          body: JSON.stringify({
            fileId: e,
            targetDirectory: t,
            targetFilename: o
          })
        }
      )).job
    },
    folders: {
      list: () => i("/api/folders"),
      create: (e, t) => i("/api/folders", {
        method: "POST",
        body: JSON.stringify({ name: e, parentId: t || null })
      })
    },
    uploads: {
      create: (e) => i("/api/uploads", {
        method: "POST",
        body: JSON.stringify(e)
      }),
      createFromPaths: (e, t) => s.invoke(
        "uploads:from-paths",
        e,
        t || null
      ),
      list: (e) => {
        const t = new URLSearchParams();
        e != null && e.status && t.set("status", e.status), e != null && e.fileId && t.set("fileId", e.fileId), (e == null ? void 0 : e.limit) !== void 0 && t.set("limit", String(e.limit)), (e == null ? void 0 : e.offset) !== void 0 && t.set("offset", String(e.offset));
        const o = t.toString();
        return i(
          `/api/uploads${o ? `?${o}` : ""}`
        );
      },
      get: (e) => i(`/api/uploads/${e}`),
      pause: (e) => i(`/api/uploads/${e}/pause`, { method: "POST" }),
      resume: (e) => i(`/api/uploads/${e}/resume`, { method: "POST" }),
      cancel: (e) => i(`/api/uploads/${e}/cancel`, { method: "POST" }),
      progress: (e) => i(`/api/uploads/${e}/progress`)
    },
    downloads: {
      create: (e) => i("/api/downloads", {
        method: "POST",
        body: JSON.stringify(e)
      }),
      list: (e) => {
        const t = new URLSearchParams();
        e != null && e.status && t.set("status", e.status), e != null && e.fileId && t.set("fileId", e.fileId), (e == null ? void 0 : e.limit) !== void 0 && t.set("limit", String(e.limit)), (e == null ? void 0 : e.offset) !== void 0 && t.set("offset", String(e.offset));
        const o = t.toString();
        return i(
          `/api/downloads${o ? `?${o}` : ""}`
        );
      },
      get: (e) => i(`/api/downloads/${e}`),
      pause: (e) => i(`/api/downloads/${e}/pause`, { method: "POST" }),
      resume: (e) => i(`/api/downloads/${e}/resume`, {
        method: "POST"
      }),
      cancel: (e) => i(`/api/downloads/${e}/cancel`, {
        method: "POST"
      }),
      progress: (e) => i(`/api/downloads/${e}/progress`)
    },
    storage: {
      getStats: () => i("/api/storage/stats"),
      sync: () => i("/api/storage/sync", { method: "POST" }),
      getSyncStatus: () => i("/api/storage/sync/status")
    },
    profile: {
      get: () => i("/api/app/profile"),
      save: (e) => i("/api/app/profile", {
        method: "POST",
        body: JSON.stringify({ displayName: e })
      }),
      setLocalPassword: (e) => s.invoke("profile:set-password", e),
      verifyLocalPassword: (e) => s.invoke("profile:verify-password", e),
      hasLocalPassword: () => s.invoke("profile:has-password")
    }
  };
  c.exposeInMainWorld("televault", g);
});
export default u();
