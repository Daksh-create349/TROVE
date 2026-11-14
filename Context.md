# Trove — Engineering Context / AI Handoff

**Last verified:** 2026-11-14  
**Workspace:** `televault/`  
**Project Name:** Trove  
**Status:** implemented, typechecked, built, and end-to-end integrated. The Trove desktop application is built with Electron 33, React 18, Vite 6, TypeScript, Tailwind CSS, Lucide React, and electron-builder for Windows, macOS, and Linux. The visual design features a rich dark blue theme (`#080c16`, `#0c1324`, `#2563eb`), official 3D cloud-cube branding, full-screen native desktop layout, country code dropdown selector with search, real Telegram OTP delivery integration with developer credentials support, working window controls, and seamless transition to the main dashboard. All 99 backend tests continue to pass (100% passing). Trove never claims Telegram provides guaranteed unlimited storage.

This document is the handoff context for another AI model or developer continuing the project on a different platform. It describes the code that actually exists. Anything not implemented is called out explicitly.

---

## 1. What Trove is

Trove (formerly TeleVault) is a local-first desktop cloud-storage application that uses the user's **personal Telegram account** as the storage backend.

The backend is a loopback-only HTTP service. It stores **metadata only** in SQLite. File bytes live in Telegram Saved Messages, never in SQLite. Personal Telegram MTProto authentication is wired using GramJS, targeting Telegram **Saved Messages** as the initial storage destination without requiring bots or private channels.

In Phase 03, the **Large File Storage Engine** was implemented with a two-level chunking architecture, streaming local file handling, bounded memory buffers, concurrency control, resume capability, and rate-limit backoff.

In Phase 04, the **Download, Recovery and Sync Engine** was implemented, enabling byte-for-byte verifiable streaming downloads, resumable background downloads with pause/resume/cancel, upload recovery across restarts, durable remote metadata manifests in Saved Messages, remote storage synchronization, and safe deletion with partial failure reporting.

In Phase 05, the complete **Desktop Frontend and Electron Application** has been built, connecting the existing backend to a desktop application matching the exact visual styling provided in the design references.

---

## 2. Phase Scope & Capabilities

### Implemented in Phases 01, 02, 03, 04 & 05

- Node.js + TypeScript + Express 5 backend bound to loopback only.
- SQLite database with three versioned migrations, foreign keys, check constraints, and partial unique indexes.
- Local API-token authentication (`X-Televault-Token`).
- Loopback-only binding, Host validation, strict CORS, security headers, request IDs, structured Pino logs.
- Zod request validation and centralized error handling.
- Metadata repositories/services for app profiles, folders, files, file parts, upload jobs, download jobs, settings, and Telegram account storage.
- **Personal Telegram MTProto Engine (Phase 02)**:
  - Personal account authentication through GramJS (`telegram@2.26.22`).
  - Storage destination: **Telegram Saved Messages** (`me` peer resolution).
  - Credentials (`TELEGRAM_API_ID`, `TELEGRAM_API_HASH`) read from environment variables.
  - Stateful authentication state machine (start, code, 2FA password, status, profile, disconnect).
  - OS-backed secure storage adapter (Windows DPAPI / Electron `safeStorage` adapter) and authenticated AES-256-GCM in SQLite.
  - Connection health checks and automatic reconnect with bounded exponential backoff.
  - Single managed client instance: connection is shared, never opening new sockets per request.
- **Large File Storage Engine (Phase 03)**:
  - **Two-Level Chunking Architecture**:
    - **Level 1 (MTProto Protocol Parts)**: Handled by GramJS upload implementation using 512 KB native parts, querying dynamic Telegram `upload_max_fileparts_default` (4000 = ~2 GB) and `upload_max_fileparts_premium` (8000 = ~4 GB) via `help.getAppConfig` and account profile.
    - **Level 2 (TeleVault Logical Segments)**: Slices original large files into independently uploadable segments with a 50 MB safety margin below server limit (or configurable segment size). Calculates SHA-256 for each segment. Uploads each segment as an independent document message in Saved Messages.
  - **Structured Manifest Caption**:
    - Format: `TVLT:v1:<file-uuid>:<part-index>:<total-parts>:<part-sha256>`.
    - Preserves original filename in Telegram document attributes (`DocumentAttributeFilename`).
  - **Upload Manager (`UploadManager`)**:
    - Queued upload jobs with configurable concurrency (`uploads.concurrency`, default 2).
    - Per-file progress and per-segment live byte progress.
    - Pause, resume, and cancellation.
    - Rate-limit handling: sleeps the required duration for `FLOOD_WAIT_X` and `FLOOD_PREMIUM_WAIT_X`.
    - Disk space pre-checks via `fs.promises.statfs`.
    - Graceful shutdown draining worker promises before database closing.
  - **Streaming Multipart Handling**:
    - Direct-to-disk streaming with `busboy` to `<dataDir>/tmp/staging`.
- **Download, Recovery and Sync Engine (Phase 04)**:
  - **1. Download Engine & HTTP Streaming (`FileStreamer`)**:
    - `GET /api/files/:id/download` (attachment disposition) & `GET /api/files/:id/preview` (inline disposition).
    - Streams logical segments directly from Telegram to the client with bounded 64 KB memory buffers; never loads full large files into RAM.
    - Verifies SHA-256 hash for every segment before streaming its bytes.
    - Calculates reconstructed SHA-256 on the fly and compares against `file.sha256` to ensure end-to-end integrity.
    - Supports client aborts/cancellation without leaving orphaned temp files.
    - Clean handling of 0-byte (empty) files.
  - **2. Resumable Downloads (`DownloadManager`)**:
    - Background download queue with configurable concurrency (`settings: downloads.concurrency`, default 2).
    - `POST /api/downloads` (validates file, destination directory, path safety, and disk space).
    - `GET /api/downloads` (paginated list of download jobs).
    - `GET /api/downloads/:id` (detailed download status, file metadata, and parts).
    - `POST /api/downloads/:id/pause`
    - `POST /api/downloads/:id/resume`
    - `POST /api/downloads/:id/cancel`
    - `GET /api/downloads/:id/progress` (progress percentage, bytes, segment index, error status).
    - Segment-by-segment download and validation with retries (up to 5 attempts) and rate-limit backoff.
    - Appends segments sequentially using stream pipelines to `<dataDir>/tmp/downloads/<jobId>.reconstructing.bin`.
    - Cross-device safe move (`moveFileSafely` with stream copy fallback for `EXDEV`).
    - Cleans up temporary reconstruction files on cancel or failure.
    - Persists job metadata in `<dataDir>/downloads/metadata/<jobId>.meta.json` across restarts.
  - **3. Upload Recovery across Restarts**:
    - In `UploadManager.initialize()`, inspects unfinished (`processing`/`queued`) jobs.
    - Verifies source file exists and verifies `size` and `mtimeMs`.
    - Validates completed segments; does NOT re-upload completed segments.
    - Resumes at TeleVault logical-segment boundaries (not assuming Telegram retained unfinished MTProto parts).
    - Resets any stuck in-flight segments to `queued` to re-slice fresh.
  - **4. Remote Manifest Documents in Saved Messages**:
    - Remote file manifest document sent to Saved Messages only after all segments have been successfully uploaded and verified.
    - Caption format: `TVLT:v1:MANIFEST:<file-uuid>:<sha256>`.
    - Serialized JSON document with `manifestVersion: 1`, `fileId`, `originalFilename`, `totalSize`, `mimeType`, `sha256`, `totalParts`, `parts` array, `createdAt`.
    - Message ID recorded in `file.telegram_message_ids`.
  - **5. Remote Synchronization (`StorageSyncService`)**:
    - `POST /api/storage/sync` & `GET /api/storage/sync/status`.
    - Paged scan of Saved Messages via `iterMessages` (100 messages per page).
    - Discovers manifest document messages and loose segments.
    - Reconstructs missing file and segment records in SQLite with status `completed`.
    - Recovers loose segments if all parts `0..totalParts-1` are present.
    - Idempotent: running multiple times does not create duplicates or corrupt records.
  - **6. Safe Deletion & Partial Failure Reporting**:
    - `DELETE /api/files/:id` identifies all Telegram message IDs (segments + manifest).
    - Deletes messages from Telegram. If partially failed, retains remaining IDs in SQLite and throws 502 with detailed failure report.
- **Desktop Electron Application (Phase 05)**:
  - **Electron Main Process & Security (`electron/`)**:
    - `electron/main.ts`: Frameless desktop window with custom titlebar, min/max/close controls, dark background (`#0d0e12`).
    - `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false` (secure preload bridge).
    - `electron/preload.ts`: Type-safe `window.televault` API exposed via `contextBridge.exposeInMainWorld`.
    - `electron/backendManager.ts`: Automatic lifecycle management of the local backend, locating active port/token and proxying requests with `X-Televault-Token` and `Host: 127.0.0.1`.
    - `electron/profileSecurity.ts`: Local master password security using Scrypt key derivation (32-byte salt, N=16384, r=8, p=1) protected by Electron's native OS-backed `safeStorage`.
    - Native file dialogs for single and batch file selection and folder selection.
  - **Arc-Inspired Onboarding Experience (`ArcOnboarding.tsx`)**:
    - Replaced generic starfields with a bespoke, luminous Arc Browser-inspired onboarding experience matching the user's reference design.
    - Soft aurora backdrop with royal cobalt, violet, and indigo lighting framing a central frosted glass desktop window with subtle translucency (`border border-white/30`, `backdrop-blur-2xl`).
    - Asymmetric two-column split:
      - **Left Column**: Floating cards showcase matching Arc — top "Favorites" grid with quick access app tiles (Telegram, Documents, Media, Archives, Cloud Vault), overlapping bottom "Saved Messages Vault" card with category pills, verification badges, and an interactive animated cursor simulation.
      - **Right Column**: Crisp, bold typography and multi-step flow:
        1. Welcome: "Welcome to TeleVault, [Name]" with "Start setup →" pill button.
        2. "What can we call you?": Personalization input updating live greetings, use case selection, and optional master password.
        3. Connect Telegram: Guided MTProto connection form supporting phone numbers, OTP verification codes, and 2FA cloud passwords.
        4. Celebration: "You're all set!" card with connected Telegram account details, and smooth cinematic transition into the main dashboard.
    - Persists completion (`televault_onboarded`) so once connected, it never shows on future app launches.
  - **Window Controls & Frameless Titlebar**:
    - Working minimize, maximize/restore, and close buttons on both the header and onboarding titlebars with explicit `-webkit-app-region: no-drag` and `BrowserWindow.fromWebContents(event.sender)` IPC handlers.
  - **Visual Design & Layout (`desktop/src/`)**:
    - Dark charcoal background (`#0d0e12`), almost-black sidebar (`#08090c`), subtle borders (`#1c1e27`), compact typography.
    - Electric-blue active navigation states and glossy 3D SVG folder illustrations (`FolderIcon.tsx`).
    - Category-specific file badges (Document, Code, Archive, Audio, Video, Image).
  - **Sidebar Component (`Sidebar.tsx`)**:
    - TeleVault logo and brand name.
    - Vault library dropdown selector.
    - Primary navigation: Overview, Content (All Files), Photos & Media.
    - Locations list: Telegram Cloud Vault, Saved Messages, and "+ Add Location".
    - Folder list with inline "+ Folder" creation form.
    - Tags section with color-coded dot badges (Keepsake, Personal, Projects, Media, Work).
    - Bottom status pill: Live Telegram connection status with account indicator and Settings cog.
  - **Header & Stats (`Header.tsx`, `HeaderStats.tsx`)**:
    - Dynamic breadcrumbs with folder traversal.
    - Global search input with `Ctrl+K` shortcut and clear button.
    - Live sync trigger with spinning indicator.
    - Grid view and List view mode switcher.
    - Transfers drawer badge with active count animation.
    - Real backend-derived metrics bar: Total Stored (bytes), Indexed Files, Local Cache size, and Active Queue count. Never fabricates storage capacity or free space.
  - **Main Device/Location View (`OverviewView.tsx`)**:
    - Telegram Cloud Vault primary hero card showing connected phone/user, Saved Messages destination peer, indexed storage, folder count, file count, and fast upload/sync triggers.
    - Storage destinations grid.
    - Recent files section with instant preview triggers.
  - **File Manager (`FileManager.tsx`, `FolderCard.tsx`, `FileCard.tsx`, `FileList.tsx`, `ContextMenu.tsx`)**:
    - Drag-and-drop zone with full-screen drop feedback. Supports native OS drag-and-drop file paths into active folder.
    - Grid view with thumbnails and selection rings.
    - List view with sortable columns: Name, Size, Type, Date Added, Actions.
    - Right-click context menu: Quick Preview, Download To..., Copy SHA-256 Hash, Copy Telegram Message IDs, and Safe Delete.
    - Keyboard navigation: Delete/Backspace to delete selected, Spacebar to preview, Ctrl+A to select all.
  - **File Preview Modal (`FilePreviewModal.tsx`)**:
    - Lightbox overlay supporting inline rendering of images, videos (with audio playback), audio, and formatted text documents/code up to 500 KB streamed directly from `/api/files/:id/preview`.
    - Complete metadata inspector: Original filename, MIME type, file size, SHA-256 checksum with copy-to-clipboard, logical part count, Telegram message IDs, and created/modified timestamps.
  - **Upload & Download Interface (`TransfersDrawer.tsx`)**:
    - Floating transfers manager accessible from the header badge.
    - Live progress bars, percentages, current logical segment index (e.g. `Part 2 of 5`), real-time transfer speeds, and estimated remaining time.
    - Control buttons: Pause, Resume, Cancel, and Retry on failed transfers.
  - **First-Run Setup Wizard (`SetupWizard.tsx`)**:
    - Multi-step modal for unauthenticated users:
      1. Welcome & Architecture explanation.
      2. Phone number entry with country code.
      3. Telegram login OTP code submission.
      4. 2FA cloud password submission if two-step verification is enabled on the Telegram account.
      5. Local TeleVault profile creation (Display Name, optional local master app password).
      6. Ready confirmation and dashboard entry.
  - **Local Security & Lock Screen (`UnlockScreen.tsx`)**:
    - If a local master app password is configured, TeleVault locks the application on launch, requiring password verification before showing sensitive vault files or Telegram tokens.
  - **Cross-Platform Packaging (`electron-builder`)**:
    - Configured for Windows (`nsis`, `portable`), macOS (`dmg`, `zip`), and Linux (`AppImage`, `deb`).

---

## 3. Directory Structure

```
televault/
├── backend/
│   ├── src/
│   │   ├── api/
│   │   │   ├── middleware/
│   │   │   ├── routes/
│   │   │   │   ├── app.ts
│   │   │   │   ├── downloads.ts
│   │   │   │   ├── files.ts
│   │   │   │   ├── folders.ts
│   │   │   │   ├── health.ts
│   │   │   │   ├── storage.ts
│   │   │   │   ├── telegram.ts
│   │   │   │   └── uploads.ts
│   │   │   └── validation/
│   │   ├── auth/
│   │   ├── config/
│   │   ├── database/
│   │   │   ├── migrations/
│   │   │   └── repositories/
│   │   ├── downloads/
│   │   │   ├── downloadManager.ts
│   │   │   └── fileStreamer.ts
│   │   ├── folders/
│   │   ├── profiles/
│   │   ├── security/
│   │   ├── storage/
│   │   │   └── storageSyncService.ts
│   │   ├── telegram/
│   │   │   ├── gramjsClient.ts
│   │   │   ├── sessionStore.ts
│   │   │   └── telegramService.ts
│   │   ├── types/
│   │   ├── uploads/
│   │   │   ├── uploadChunker.ts
│   │   │   └── uploadManager.ts
│   │   ├── utils/
│   │   ├── app.ts
│   │   ├── server.ts
│   │   └── services.ts
│   ├── tests/
│   │   ├── api/
│   │   ├── database/
│   │   ├── downloads/
│   │   ├── security/
│   │   └── uploads/
│   ├── package.json
│   └── tsconfig.json
├── desktop/
│   ├── electron/
│   │   ├── backendManager.ts
│   │   ├── main.ts
│   │   ├── preload.ts
│   │   └── profileSecurity.ts
│   ├── src/
│   │   ├── components/
│   │   │   ├── common/
│   │   │   │   ├── FileIcon.tsx
│   │   │   │   ├── FolderIcon.tsx
│   │   │   │   └── Toast.tsx
│   │   │   ├── files/
│   │   │   │   ├── ContextMenu.tsx
│   │   │   │   ├── FileCard.tsx
│   │   │   │   ├── FileList.tsx
│   │   │   │   ├── FileManager.tsx
│   │   │   │   └── FolderCard.tsx
│   │   │   ├── header/
│   │   │   │   └── Header.tsx
│   │   │   ├── overview/
│   │   │   │   └── OverviewView.tsx
│   │   │   ├── preview/
│   │   │   │   └── FilePreviewModal.tsx
│   │   │   ├── settings/
│   │   │   │   └── SettingsModal.tsx
│   │   │   ├── setup/
│   │   │   │   └── SetupWizard.tsx
│   │   │   ├── sidebar/
│   │   │   │   └── Sidebar.tsx
│   │   │   ├── stats/
│   │   │   │   └── HeaderStats.tsx
│   │   │   ├── transfers/
│   │   │   │   └── TransfersDrawer.tsx
│   │   │   └── unlock/
│   │   │       └── UnlockScreen.tsx
│   │   ├── context/
│   │   │   ├── AppContext.tsx
│   │   │   ├── AuthContext.tsx
│   │   │   └── TransferContext.tsx
│   │   ├── types/
│   │   │   ├── electron.d.ts
│   │   │   └── index.ts
│   │   ├── utils/
│   │   │   └── formatters.ts
│   │   ├── App.tsx
│   │   ├── index.css
│   │   └── main.tsx
│   ├── index.html
│   ├── package.json
│   ├── postcss.config.js
│   ├── tailwind.config.js
│   ├── tsconfig.json
│   └── vite.config.ts
├── shared/
│   └── types/
│       └── index.ts
├── Context.md
└── README.md
```

---

## 4. Verification & Testing

1. **Backend Automated Tests**:
   - `cd televault/backend && npm test`
   - **99 tests passed across 7 test files (100% passing)**:
     - `tests/security/security.test.ts` (26 tests)
     - `tests/database/migrations.test.ts` (8 tests)
     - `tests/database/repositories.test.ts` (12 tests)
     - `tests/api/api.test.ts` (12 tests)
     - `tests/api/telegramAuth.test.ts` (15 tests)
     - `tests/uploads/uploadEngine.test.ts` (11 tests)
     - `tests/downloads/downloadAndSync.test.ts` (15 tests)
2. **Backend Strict Typechecking & Build**:
   - `cd televault/backend && npm run build` (tsc strict + copy-assets, 0 errors).
3. **Desktop Frontend Strict Typechecking & Build**:
   - `cd televault/desktop && npm run build` (tsc strict + vite build for renderer and main process/preload, 0 errors).
   - Generates production bundles:
     - `dist/index.html`
     - `dist/assets/index-*.css`
     - `dist/assets/index-*.js`
     - `dist-electron/main.js`
     - `dist-electron/preload.js`
