import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, chmodSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface BackendInfo {
  isReady: boolean;
  url: string;
  port: number;
  apiToken: string;
}

export class BackendManager {
  private childProcess: ChildProcess | null = null;
  private port = 4787;
  private apiToken = "";
  private isReady = false;
  private isShuttingDown = false;

  constructor() {
    this.port = parseInt(process.env.PORT || "4787", 10);
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  getInfo(): BackendInfo {
    return {
      isReady: this.isReady,
      url: this.baseUrl,
      port: this.port,
      apiToken: this.apiToken,
    };
  }

  getBackendRoot(): string | null {
    return this.locateBackendRoot();
  }

  async start(): Promise<void> {
    // 1. Try reading existing token if available
    this.apiToken = this.locateApiToken();

    // 2. Check if backend is already running on loopback
    const alreadyRunning = await this.checkHealth();
    if (alreadyRunning) {
      this.isReady = true;
      return;
    }

    // 3. Backend is not running: spawn it
    await this.spawnBackendProcess();

    // 4. Wait for liveness
    for (let attempt = 1; attempt <= 35; attempt++) {
      if (await this.checkHealth()) {
        this.isReady = true;
        // Refresh token now that backend has generated or loaded it
        this.apiToken = this.locateApiToken();
        return;
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    throw new Error(`Failed to start TeleVault backend server at ${this.baseUrl}`);
  }

  private locateApiToken(): string {
    // Check environment first
    if (process.env.TELEVAULT_API_TOKEN) {
      return process.env.TELEVAULT_API_TOKEN.trim();
    }

    const root = this.locateBackendRoot();

    // Check potential data directories (both api-token and legacy token)
    const candidates = [
      (() => {
        try {
          return join(app.getPath("userData"), "data", "api-token");
        } catch {
          return "";
        }
      })(),
      (() => {
        try {
          return join(app.getPath("userData"), "api-token");
        } catch {
          return "";
        }
      })(),
      root ? resolve(root, "data/api-token") : "",
      root ? resolve(root, "data/token") : "",
      resolve(__dirname, "../../backend/data/api-token"),
      resolve(__dirname, "../../backend/data/token"),
      resolve(__dirname, "../../../backend/data/api-token"),
      resolve(__dirname, "../../../backend/data/token"),
      (() => {
        try {
          return join(app.getPath("userData"), "televault-data", "api-token");
        } catch {
          return "";
        }
      })(),
      (() => {
        try {
          return join(app.getPath("userData"), "televault-data", "token");
        } catch {
          return "";
        }
      })(),
      resolve(process.cwd(), "televault/backend/data/api-token"),
      resolve(process.cwd(), "televault/backend/data/token"),
      resolve(process.cwd(), "backend/data/api-token"),
      resolve(process.cwd(), "backend/data/token"),
    ].filter(Boolean);

    for (const path of candidates) {
      if (existsSync(path)) {
        try {
          const val = readFileSync(path, "utf8").trim();
          if (val) return val;
        } catch {
          // continue checking
        }
      }
    }

    // Check .env files
    const envCandidates = [
      root ? resolve(root, ".env") : "",
      resolve(__dirname, "../../backend/.env"),
      resolve(__dirname, "../../../backend/.env"),
      resolve(process.cwd(), "televault/backend/.env"),
      resolve(process.cwd(), "backend/.env"),
    ].filter(Boolean);

    for (const envPath of envCandidates) {
      if (existsSync(envPath)) {
        try {
          const content = readFileSync(envPath, "utf8");
          const match = content.match(/^TELEVAULT_API_TOKEN=(.+)$/m);
          if (match && match[1]) {
            return match[1].trim();
          }
        } catch {
          // continue checking
        }
      }
    }

    return "";
  }

  private async checkHealth(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1200);
      const res = await fetch(`${this.baseUrl}/api/health`, {
        headers: { Host: `127.0.0.1:${this.port}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) {
        const body = (await res.json()) as { ok: boolean };
        return body && body.ok === true;
      }
      return false;
    } catch {
      return false;
    }
  }

  private async spawnBackendProcess(): Promise<void> {
    const backendRoot = this.locateBackendRoot();
    if (!backendRoot) {
      throw new Error("Could not find televault backend directory");
    }

    const distServerPath = join(backendRoot, "dist/backend/src/server.js");
    const isCompiled = existsSync(distServerPath);

    const token = this.apiToken || this.locateApiToken();
    if (token) {
      this.apiToken = token;
    }

    const persistentDataDir = join(app.getPath("userData"), "data");

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(this.port),
      ...(token ? { TELEVAULT_API_TOKEN: token } : {}),
      DATA_DIR: persistentDataDir,
      NODE_ENV: process.env.NODE_ENV || "production",
    };
    // CRITICAL: Never run native C++ Node addons (like better-sqlite3) using Electron's runtime
    delete env.ELECTRON_RUN_AS_NODE;

    if (isCompiled) {
      const nodeCmd = this.locateNodeBinary();
      console.log(`[BackendManager] Spawning backend server using node binary: ${nodeCmd}`);

      this.childProcess = spawn(nodeCmd, [distServerPath], {
        cwd: backendRoot,
        env,
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      });

      this.childProcess.stderr?.on("data", (d) => {
        console.warn(`[Backend Err]: ${d}`);
      });
      this.childProcess.on("exit", (code, signal) => {
        console.warn(`[Backend Exited]: code=${code} signal=${signal}`);
        this.isReady = false;
        this.childProcess = null;
        if (!this.isShuttingDown) {
          console.warn("[BackendManager] Backend unexpectedly exited, restarting...");
          setTimeout(() => {
            if (!this.isShuttingDown && !this.isReady) {
              void this.start().catch((e) => console.warn("[BackendManager] Auto-restart failed:", e));
            }
          }, 1200);
        }
      });
      this.childProcess.on("error", (err) => {
        console.warn(`[Backend Spawn Error]:`, err);
        this.isReady = false;
        this.childProcess = null;
      });
    } else {
      // In dev mode without prebuilt dist, run via npx tsx
      const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
      this.childProcess = spawn(
        npxCmd,
        ["tsx", "src/server.ts"],
        {
          cwd: backendRoot,
          env,
          stdio: ["ignore", "ignore", "pipe"],
          windowsHide: true,
        },
      );
      this.childProcess.stderr?.on("data", (d) => {
        console.warn(`[Backend Dev Err]: ${d}`);
      });
      this.childProcess.on("error", (err) => {
        console.warn(`[Backend Spawn Error]:`, err);
      });
      this.childProcess.on("exit", (code, signal) => {
        console.warn(`[Backend Dev Exited]: code=${code} signal=${signal}`);
        this.isReady = false;
        this.childProcess = null;
        if (!this.isShuttingDown) {
          setTimeout(() => {
            if (!this.isShuttingDown && !this.isReady) {
              void this.start().catch(() => {});
            }
          }, 1200);
        }
      });
    }
  }

  private locateNodeBinary(): string {
    const home = process.env.HOME || "";
    const candidates = [
      join(process.resourcesPath || "", "bin/node"),
      join(process.resourcesPath || "", "bin", process.platform === "win32" ? "node.exe" : "node"),
      resolve(__dirname, "../build/bin/node"),
      resolve(__dirname, "../../build/bin/node"),
      resolve(__dirname, "../../../build/bin/node"),
      resolve(process.cwd(), "build/bin/node"),
      resolve(process.cwd(), "televault/desktop/build/bin/node"),
      process.env.NODE_BINARY || "",
      home ? join(home, ".nvm/versions/node/v22.23.2/bin/node") : "",
      "/opt/homebrew/bin/node",
      "/usr/local/bin/node",
      "/usr/bin/node",
      "C:\\Program Files\\nodejs\\node.exe",
    ].filter(Boolean);

    for (const cand of candidates) {
      if (existsSync(cand)) {
        if (process.platform !== "darwin" && process.platform !== "linux") {
          return cand;
        }
        try {
          chmodSync(cand, 0o755);
        } catch {
          // ignore if read-only filesystem or restricted
        }
        return cand;
      }
    }
    return "node";
  }

  private locateBackendRoot(): string | null {
    const candidates = [
      join(process.resourcesPath || "", "backend"),
      resolve(__dirname, "../../backend"),
      resolve(__dirname, "../../../backend"),
      resolve(__dirname, "../../../televault/backend"),
      resolve(__dirname, "../backend"),
      resolve(process.cwd(), "televault/backend"),
      resolve(process.cwd(), "backend"),
      resolve(process.cwd(), "../backend"),
    ];

    for (const dir of candidates) {
      if (dir && existsSync(join(dir, "package.json"))) {
        return dir;
      }
    }
    return null;
  }

  async request<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<{ ok: boolean; data?: T; error?: { code: string; message: string; details?: unknown } }> {
    const url = `${this.baseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;

    // Refresh token if empty
    if (!this.apiToken) {
      this.apiToken = this.locateApiToken();
    }

    const headers: Record<string, string> = {
      Host: `127.0.0.1:${this.port}`,
      "X-Televault-Token": this.apiToken,
      ...(options.headers as Record<string, string>),
    };

    if (options.body && typeof options.body === "string" && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }

    // Ensure backend is ready before sending request
    if (!this.isReady) {
      await this.start().catch(() => {});
    }

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (!this.apiToken) {
          this.apiToken = this.locateApiToken();
        }
        headers["X-Televault-Token"] = this.apiToken;
        headers["X-Trove-Token"] = this.apiToken;

        const response = await fetch(url, {
          ...options,
          headers,
        });

        const json = await response.json().catch(() => null);

        if (!response.ok || !json?.ok) {
          return {
            ok: false,
            error: json?.error || {
              code: "HTTP_ERROR",
              message: `Request failed with status ${response.status}`,
            },
          };
        }

        return json as { ok: true; data: T };
      } catch (err) {
        lastError = err as Error;
        if (attempt < maxRetries) {
          // If connection refused, try ensuring backend process is started
          if (!this.childProcess) {
            await this.start().catch(() => {});
          }
          await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        }
      }
    }

    return {
      ok: false,
      error: {
        code: "NETWORK_ERROR",
        message: lastError?.message || "Could not connect to Trove backend",
      },
    };
  }

  stop(): void {
    this.isShuttingDown = true;
    if (this.childProcess) {
      try {
        this.childProcess.kill();
      } catch {
        // already exited
      }
      this.childProcess = null;
    }
    this.isReady = false;
  }

  async restart(): Promise<void> {
    this.stop();
    await new Promise((r) => setTimeout(r, 600));
    await this.start();
  }
}
