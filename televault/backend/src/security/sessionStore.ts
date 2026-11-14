import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, readFile, rename, rm, writeFile } from "node:fs/promises";
import type { SecretBox } from "./secretBox";

const FILE_VERSION = 1;

export type SessionProtectorName =
  | "dpapi"
  | "secret-box"
  | "electron-safe-storage";

/**
 * OS-backed or application-level protection for the GramJS session string.
 *
 * Electron's `safeStorage` matches this shape (`encryptString` /
 * `decryptString` / `isEncryptionAvailable`). Pass an
 * {@link ElectronSafeStorageAdapter} when the desktop shell exists.
 */
export interface SessionProtector {
  readonly name: SessionProtectorName;
  isAvailable(): Promise<boolean>;
  protect(plaintext: string): Promise<Buffer>;
  unprotect(payload: Buffer): Promise<string>;
}

export interface SecureSessionStore {
  /** Non-secret name of the active protector. Never a session string. */
  readonly backend: string;
  load(): Promise<string | null>;
  save(session: string): Promise<void>;
  clear(): Promise<void>;
}

interface SessionFile {
  version: number;
  protector: SessionProtectorName;
  payload: string;
}

/**
 * Subset of Electron `safeStorage` the desktop shell can pass in later.
 * TeleVault does not import Electron.
 */
export interface ElectronSafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export class ElectronSafeStorageAdapter implements SessionProtector {
  readonly name = "electron-safe-storage" as const;

  constructor(private readonly safeStorage: ElectronSafeStorageLike) {}

  async isAvailable(): Promise<boolean> {
    return this.safeStorage.isEncryptionAvailable();
  }

  async protect(plaintext: string): Promise<Buffer> {
    return this.safeStorage.encryptString(plaintext);
  }

  async unprotect(payload: Buffer): Promise<string> {
    return this.safeStorage.decryptString(payload);
  }
}

export class SecretBoxProtector implements SessionProtector {
  readonly name = "secret-box" as const;

  constructor(private readonly secretBox: SecretBox) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async protect(plaintext: string): Promise<Buffer> {
    return Buffer.from(this.secretBox.encrypt(plaintext), "utf8");
  }

  async unprotect(payload: Buffer): Promise<string> {
    return this.secretBox.decrypt(payload.toString("utf8"));
  }
}

/**
 * Windows DPAPI via the current user scope. The session is passed on stdin,
 * never as a process argument. Unavailable outside Windows.
 */
export class DpapiSessionProtector implements SessionProtector {
  readonly name = "dpapi" as const;
  private availability: Promise<boolean> | null = null;

  async isAvailable(): Promise<boolean> {
    if (process.platform !== "win32") {
      return false;
    }
    this.availability ??= this.probe();
    return this.availability;
  }

  async protect(plaintext: string): Promise<Buffer> {
    const protectedB64 = await this.run(
      "protect",
      Buffer.from(plaintext, "utf8").toString("base64"),
    );
    return Buffer.from(protectedB64, "base64");
  }

  async unprotect(payload: Buffer): Promise<string> {
    const plainB64 = await this.run("unprotect", payload.toString("base64"));
    return Buffer.from(plainB64, "base64").toString("utf8");
  }

  private async probe(): Promise<boolean> {
    const token = randomBytes(8).toString("base64url");
    try {
      const protectedBytes = await this.protect(token);
      const restored = await this.unprotect(protectedBytes);
      return restored === token;
    } catch {
      return false;
    }
  }

  private run(operation: "protect" | "unprotect", payloadB64: string): Promise<string> {
    const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::ASCII
Add-Type -AssemblyName System.Security
$reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$op = $reader.ReadLine()
$b64 = $reader.ReadToEnd().Trim()
$bytes = [Convert]::FromBase64String($b64)
$scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
if ($op -eq 'protect') {
  $out = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, $scope)
} elseif ($op -eq 'unprotect') {
  $out = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, $scope)
} else {
  throw 'unsupported operation'
}
[Console]::Out.Write([Convert]::ToBase64String($out))
`;

    return new Promise((resolve, reject) => {
      const child = spawn(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
      );
      const stdout: Buffer[] = [];
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("DPAPI helper timed out"));
      }, 15_000);

      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", () => undefined);
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`DPAPI helper failed with exit code ${code ?? "null"}`));
          return;
        }
        const value = Buffer.concat(stdout).toString("utf8").trim();
        if (!/^[A-Za-z0-9+/]+=*$/.test(value)) {
          reject(new Error("DPAPI helper returned an unusable result"));
          return;
        }
        resolve(value);
      });

      child.stdin.write(`${operation}\n${payloadB64}`);
      child.stdin.end();
    });
  }
}

export class MemorySessionStore implements SecureSessionStore {
  readonly backend = "memory";
  private session: string | null = null;

  async load(): Promise<string | null> {
    return this.session;
  }

  async save(session: string): Promise<void> {
    assertSession(session);
    this.session = session;
  }

  async clear(): Promise<void> {
    this.session = null;
  }
}

/**
 * Persists one session string in a private file. The file records which
 * protector wrapped it so a later Electron `safeStorage` adapter can read
 * and write the same location.
 */
export class FileSessionStore implements SecureSessionStore {
  backend: string;
  private writeProtector: SessionProtector | null = null;

  constructor(
    private readonly filePath: string,
    private readonly protectors: SessionProtector[],
  ) {
    if (protectors.length === 0) {
      throw new Error("FileSessionStore requires at least one protector");
    }
    this.backend = protectors.map((protector) => protector.name).join(",");
  }

  async load(): Promise<string | null> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }

    const parsed = parseSessionFile(raw);
    const protector = this.protectors.find((candidate) => candidate.name === parsed.protector);
    if (!protector) {
      throw new Error(
        `Telegram session was protected with '${parsed.protector}', which is not available`,
      );
    }
    const session = await protector.unprotect(Buffer.from(parsed.payload, "base64"));
    assertSession(session);
    return session;
  }

  async save(session: string): Promise<void> {
    assertSession(session);
    const protector = await this.protectorForWrite();
    const payload = await protector.protect(session);
    const body = JSON.stringify({
      version: FILE_VERSION,
      protector: protector.name,
      payload: payload.toString("base64"),
    } satisfies SessionFile);
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, body, { mode: 0o600, flag: "w" });
    try {
      await chmod(temporary, 0o600);
    } catch {
      // Best effort on filesystems that ignore POSIX modes.
    }
    await rename(temporary, this.filePath);
    this.backend = protector.name;
  }

  async clear(): Promise<void> {
    await rm(this.filePath, { force: true });
    await rm(`${this.filePath}.tmp`, { force: true });
    this.writeProtector = null;
  }

  private async protectorForWrite(): Promise<SessionProtector> {
    if (this.writeProtector) {
      return this.writeProtector;
    }
    for (const protector of this.protectors) {
      if (await protector.isAvailable()) {
        this.writeProtector = protector;
        return protector;
      }
    }
    throw new Error("No session protector is available");
  }
}

export function createLocalSessionStore(input: {
  filePath: string;
  secretBox: SecretBox;
  /** When false, skip the OS probe and use the master-key protector. */
  enableOsProtector?: boolean;
  extraProtectors?: SessionProtector[];
}): FileSessionStore {
  const protectors: SessionProtector[] = [];
  if (input.extraProtectors) {
    protectors.push(...input.extraProtectors);
  }
  if (input.enableOsProtector !== false && process.platform === "win32") {
    protectors.push(new DpapiSessionProtector());
  }
  protectors.push(new SecretBoxProtector(input.secretBox));
  return new FileSessionStore(input.filePath, protectors);
}

function assertSession(session: string): void {
  if (typeof session !== "string" || session.length === 0) {
    throw new Error("Cannot store an empty Telegram session");
  }
}

function parseSessionFile(raw: string): SessionFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Telegram session file is not valid JSON");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as SessionFile).version !== FILE_VERSION ||
    typeof (parsed as SessionFile).protector !== "string" ||
    typeof (parsed as SessionFile).payload !== "string"
  ) {
    throw new Error("Telegram session file has an unsupported format");
  }
  return parsed as SessionFile;
}
