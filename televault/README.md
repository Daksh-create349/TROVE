# Trove

Trove is a local-first desktop cloud-storage application that uses the
user's personal Telegram account as the storage backend. The backend is a
loopback-only HTTP service that stores **metadata only** in SQLite; file bytes
live in Telegram Saved Messages.

> **Important**: Trove does not impose an arbitrary total file-size quota,
> but **never claims that Telegram provides guaranteed unlimited storage**. Storage
> is subject to Telegram's platform limits, fair use policies, and account capabilities.

**Status: Desktop Application complete.**
A full-window desktop application built with Electron 33, React 18, Vite 6, TypeScript, Tailwind CSS, Lucide React, and electron-builder. The visual design features a rich dark blue theme (`#080c16`, `#0c1324`, `#2563eb`), official 3D cloud-cube branding, full-screen native desktop layout, country code dropdown selector with search, real Telegram OTP delivery integration with developer credentials support, working window controls, and seamless transition to the main dashboard. All 99 backend tests continue to pass (100% passing).

---

## Key Features

### 1. Electron Desktop Frontend (Phase 05)
- **Design Reference Implementation**:
  - Dark charcoal background (`#0d0e12`), almost-black sidebar (`#08090c`), subtle borders (`#1c1e27`), compact typography.
  - Electric-blue active navigation states and glossy 3D SVG folder illustrations (`FolderIcon.tsx`).
  - Category-specific file badges (Document, Code, Archive, Audio, Video, Image).
- **Sidebar**:
  - TeleVault logo and brand name.
  - Vault library dropdown selector.
  - Navigation: Overview, Content (All Files), Photos & Media.
  - Locations: Telegram Cloud Vault, Saved Messages, and "+ Add Location".
  - Folder list with inline "+ Folder" creation form.
  - Tags with color-coded dot badges (Keepsake, Personal, Projects, Media, Work).
  - Bottom status pill: Live Telegram connection status with account indicator and Settings cog.
- **Header & Real Statistics Bar**:
  - Dynamic breadcrumbs with folder traversal.
  - Global search input with `Ctrl+K` shortcut and clear button.
  - Live sync trigger with spinning indicator.
  - Grid view and List view mode switcher.
  - Transfers drawer badge with active count animation.
  - Real backend-derived metrics bar: Total Stored (bytes), Indexed Files, Local Cache size, and Active Queue count. Never fabricates storage capacity or free space.
- **Main Device/Location View (`OverviewView`)**:
  - Telegram Cloud Vault primary hero card showing connected phone/user, Saved Messages destination peer, indexed storage, folder count, file count, and fast upload/sync triggers.
  - Storage destinations grid.
  - Recent files section with instant preview triggers.
- **File Manager**:
  - Drag-and-drop zone with full-screen drop feedback. Supports native OS drag-and-drop file paths into active folder.
  - Grid view with thumbnails and selection rings.
  - List view with sortable columns: Name, Size, Type, Date Added, Actions.
  - Right-click context menu: Quick Preview, Download To..., Copy SHA-256 Hash, Copy Telegram Message IDs, and Safe Delete.
  - Keyboard navigation: Delete/Backspace to delete selected, Spacebar to preview, Ctrl+A to select all.
- **File Preview Lightbox**:
  - Lightbox overlay supporting inline rendering of images, videos (with audio playback), audio, and formatted text documents/code up to 500 KB streamed directly from `/api/files/:id/preview`.
  - Complete metadata inspector: Original filename, MIME type, file size, SHA-256 checksum with copy-to-clipboard, logical part count, Telegram message IDs, and created/modified timestamps.
- **Upload & Download Interface (`TransfersDrawer`)**:
  - Floating transfers manager accessible from the header badge.
  - Live progress bars, percentages, current logical segment index (e.g. `Part 2 of 5`), real-time transfer speeds, and estimated remaining time.
  - Control buttons: Pause, Resume, Cancel, and Retry on failed transfers.
- **First-Run Arc-Style Onboarding Experience (`ArcOnboarding.tsx`)**:
  - Arc Browser-inspired luminous frosted glass window over an ambient aurora backdrop.
  - Floating layered cards showcasing Favorites (Telegram, Vault, Media, Documents) and Saved Messages folder structure with an interactive cursor simulation.
  - Asymmetric layout with clean, bold typography:
    1. Welcome Screen: "Welcome to TeleVault, [Name]" with "Start setup →" pill button.
    2. Identity & Setup: "What can we call you?" with live name preview, use case selection, and optional master password.
    3. Telegram Connection: Phone number, OTP code, and 2FA password verification.
    4. Celebration: "You're all set!" and smooth transition into the main dashboard.
  - Persisted completion (`televault_onboarded`): Once connected, TeleVault opens directly into the main desktop screen on all subsequent restarts.
- **Local Security & Lock Screen**:
  - If a local master app password is configured, TeleVault locks the application on launch, requiring password verification before showing sensitive vault files or Telegram tokens.
- **Strict Process Security**:
  - `contextIsolation: true`, `nodeIntegration: false`.
  - Electron renderer never accesses GramJS directly or receives raw session strings.
  - API communication passes exclusively through the IPC bridge (`window.televault`) to the loopback backend with `X-Televault-Token` authentication.

---

### 2. Backend & Core Storage Engine (Phases 01 - 04)
- **Personal Telegram MTProto Engine (Phase 02)**:
  - Personal account authentication through GramJS (`telegram@2.26.22`).
  - Storage destination: Telegram Saved Messages (`me` peer resolution).
  - Single managed client instance: connection is shared, never opening new sockets per request.
  - Session stored using OS-backed encryption (Windows DPAPI / Electron `safeStorage`).
- **Large File Storage Engine (Phase 03)**:
  - Two-level chunking: MTProto 512 KB protocol parts + TeleVault logical segments with 50 MB safety margin.
  - Upload Manager with concurrency control, live progress, pause/resume/cancel, exponential backoff retries, and `FLOOD_WAIT_X` handling.
  - Local file handling with bounded 64 KB memory buffers and direct-to-disk streaming.
- **Download, Recovery & Sync Engine (Phase 04)**:
  - Direct HTTP streaming downloads (`/download` & `/preview`) with segment and full-file SHA-256 integrity verification.
  - Resumable background downloads (`DownloadManager`).
  - Startup upload recovery across restarts.
  - Remote metadata manifest documents in Saved Messages (`TVLT:v1:MANIFEST:<file-uuid>:<sha256>`).
  - Remote synchronization (`POST /api/storage/sync`) scanning Saved Messages and reconstructing missing files/parts in SQLite.
  - Safe deletion (`DELETE /api/files/:id`) removing remote messages and reporting partial deletion failures.

---

## Project Layout

```text
televault/
  backend/           # Express 5 + TypeScript + SQLite backend service
    src/
      api/           # REST endpoints, routes, middleware, validation
      auth/          # API token authentication
      config/        # Environment and configuration
      database/      # SQLite migrations and repositories
      downloads/     # Streaming download engine and background download manager
      folders/       # Folder management
      profiles/      # User profile management
      security/      # OS-backed safeStorage, DPAPI, rate limiting, encryption
      storage/       # Remote synchronization service
      telegram/      # GramJS MTProto client, session storage, telegram service
      uploads/       # Two-level chunking and upload manager
      utils/         # Stream utilities, responses, errors, hashing
    tests/           # Automated test suites (99 tests, 100% passing)
  desktop/           # Electron + React + Vite + Tailwind desktop application
    electron/        # Main process, preload bridge, backend manager, safeStorage
    src/             # React application components, contexts, and styles
      components/    # Sidebar, Header, Stats, Overview, FileManager, Preview, Transfers, Setup
      context/       # Global AppContext, AuthContext, TransferContext
      types/         # Typed electron API and frontend interfaces
      utils/         # Formatting helpers (bytes, dates, categories)
  shared/            # Shared TypeScript type definitions
  Context.md         # Full project engineering handoff documentation
  README.md          # Project overview and documentation
```

---

## Getting Started

### Prerequisites

- **Node.js**: v20 or v22+
- **Telegram API Credentials**:
  1. Visit [https://my.telegram.org](https://my.telegram.org).
  2. Log in with your phone number.
  3. Navigate to **API development tools**.
  4. Create an application to get your `api_id` and `api_hash`.
  5. Set them in `televault/.env` or `televault/backend/.env`:
     ```env
     TELEGRAM_API_ID=12345678
     TELEGRAM_API_HASH=your_api_hash_here
     ```

### Running the Desktop Application

```bash
# 1. Build the backend
cd televault/backend
npm install
npm run build

# 2. Run the desktop application in development mode
cd ../desktop
npm install
npm run dev
```

To build production desktop packages:

```bash
cd televault/desktop
# Build production bundle
npm run build

# Build desktop installer for current platform
npm run dist

# Or specific platform targets:
npm run package:win    # Windows (NSIS installer & portable exe)
npm run package:mac    # macOS (DMG & zip)
npm run package:linux  # Linux (AppImage & deb)
```

### Running Backend Tests

```bash
cd televault/backend
npm test
```
All 99 automated tests across 7 test suites will execute and verify the complete backend engine.
