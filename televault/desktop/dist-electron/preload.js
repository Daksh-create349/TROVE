import { contextBridge as r, ipcRenderer as n } from "electron";
async function o(e, t) {
  var d, s, f;
  const i = await n.invoke("api:request", e, t);
  if (!i.ok) {
    const l = new Error(((d = i.error) == null ? void 0 : d.message) || "Request failed");
    throw l.code = (s = i.error) == null ? void 0 : s.code, l.details = (f = i.error) == null ? void 0 : f.details, l;
  }
  return i.data;
}
const c = {
  window: {
    minimize: () => n.invoke("window:minimize"),
    maximize: () => n.invoke("window:maximize"),
    close: () => n.invoke("window:close"),
    isMaximized: () => n.invoke("window:is-maximized")
  },
  dialog: {
    selectFiles: (e) => n.invoke("dialog:select-files", e),
    selectFolder: () => n.invoke("dialog:select-folder"),
    selectUploadFolder: () => n.invoke("dialog:select-upload-folder")
  },
  shell: {
    openExternal: (e) => n.invoke("shell:open-external", e)
  },
  platform: process.platform,
  backend: {
    getInfo: () => n.invoke("backend:get-info"),
    getHealth: () => o("/api/health")
  },
  telegram: {
    getStatus: () => o("/api/telegram/status"),
    getProfile: () => o("/api/telegram/profile"),
    startLogin: (e, t = !1) => o("/api/telegram/auth/start", {
      method: "POST",
      body: JSON.stringify({ phoneNumber: e, forceSMS: !!t })
    }),
    verifyCode: (e) => o("/api/telegram/auth/verify", {
      method: "POST",
      body: JSON.stringify({ code: e })
    }),
    verifyPassword: (e) => o("/api/telegram/auth/verify-password", {
      method: "POST",
      body: JSON.stringify({ password: e })
    }),
    disconnect: () => o("/api/telegram/disconnect", {
      method: "POST"
    }),
    reconnect: () => o("/api/telegram/reconnect", {
      method: "POST"
    }),
    saveCredentials: (e, t) => n.invoke("telegram:save-credentials", e, t)
  },
  files: {
    list: (e) => {
      const t = new URLSearchParams();
      e != null && e.folderId && t.set("folderId", e.folderId), e != null && e.status && t.set("status", e.status), e != null && e.search && t.set("search", e.search), (e == null ? void 0 : e.limit) !== void 0 && t.set("limit", String(e.limit)), (e == null ? void 0 : e.offset) !== void 0 && t.set("offset", String(e.offset));
      const i = t.toString();
      return o(
        `/api/files${i ? `?${i}` : ""}`
      );
    },
    get: (e) => o(`/api/files/${e}`),
    getParts: (e) => o(`/api/files/${e}/parts`),
    delete: (e) => o(`/api/files/${e}`, {
      method: "DELETE"
    }),
    getDownloadUrl: (e) => {
      let t = "";
      try {
        t = n.sendSync("backend:get-token-sync") || "";
      } catch {
      }
      const i = t ? `?token=${encodeURIComponent(t)}` : "";
      return `http://127.0.0.1:4787/api/files/${e}/download${i}`;
    },
    getPreviewUrl: (e) => {
      let t = "";
      try {
        t = n.sendSync("backend:get-token-sync") || "";
      } catch {
      }
      const i = t ? `?token=${encodeURIComponent(t)}` : "";
      return `http://127.0.0.1:4787/api/files/${e}/preview${i}`;
    },
    downloadToPath: async (e, t, i) => (await o(
      "/api/downloads",
      {
        method: "POST",
        body: JSON.stringify({
          fileId: e,
          targetDirectory: t,
          targetFilename: i
        })
      }
    )).job
  },
  folders: {
    list: () => o("/api/folders"),
    create: (e, t) => o("/api/folders", {
      method: "POST",
      body: JSON.stringify({ name: e, parentId: t || null })
    })
  },
  uploads: {
    create: (e) => o("/api/uploads", {
      method: "POST",
      body: JSON.stringify(e)
    }),
    createFromPaths: (e, t) => n.invoke(
      "uploads:from-paths",
      e,
      t || null
    ),
    list: (e) => {
      const t = new URLSearchParams();
      e != null && e.status && t.set("status", e.status), e != null && e.fileId && t.set("fileId", e.fileId), (e == null ? void 0 : e.limit) !== void 0 && t.set("limit", String(e.limit)), (e == null ? void 0 : e.offset) !== void 0 && t.set("offset", String(e.offset));
      const i = t.toString();
      return o(
        `/api/uploads${i ? `?${i}` : ""}`
      );
    },
    get: (e) => o(`/api/uploads/${e}`),
    pause: (e) => o(`/api/uploads/${e}/pause`, { method: "POST" }),
    resume: (e) => o(`/api/uploads/${e}/resume`, { method: "POST" }),
    cancel: (e) => o(`/api/uploads/${e}/cancel`, { method: "POST" }),
    progress: (e) => o(`/api/uploads/${e}/progress`)
  },
  downloads: {
    create: (e) => o("/api/downloads", {
      method: "POST",
      body: JSON.stringify(e)
    }),
    list: (e) => {
      const t = new URLSearchParams();
      e != null && e.status && t.set("status", e.status), e != null && e.fileId && t.set("fileId", e.fileId), (e == null ? void 0 : e.limit) !== void 0 && t.set("limit", String(e.limit)), (e == null ? void 0 : e.offset) !== void 0 && t.set("offset", String(e.offset));
      const i = t.toString();
      return o(
        `/api/downloads${i ? `?${i}` : ""}`
      );
    },
    get: (e) => o(`/api/downloads/${e}`),
    pause: (e) => o(`/api/downloads/${e}/pause`, { method: "POST" }),
    resume: (e) => o(`/api/downloads/${e}/resume`, {
      method: "POST"
    }),
    cancel: (e) => o(`/api/downloads/${e}/cancel`, {
      method: "POST"
    }),
    progress: (e) => o(`/api/downloads/${e}/progress`)
  },
  storage: {
    getStats: () => o("/api/storage/stats"),
    sync: () => o("/api/storage/sync", { method: "POST" }),
    getSyncStatus: () => o("/api/storage/sync/status")
  },
  profile: {
    get: () => o("/api/app/profile"),
    save: (e) => o("/api/app/profile", {
      method: "POST",
      body: JSON.stringify({ displayName: e })
    }),
    setLocalPassword: (e) => n.invoke("profile:set-password", e),
    verifyLocalPassword: (e) => n.invoke("profile:verify-password", e),
    hasLocalPassword: () => n.invoke("profile:has-password")
  }
};
r.exposeInMainWorld("televault", c);
