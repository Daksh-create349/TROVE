import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/env";
import { resolveApiToken } from "../../src/auth/apiToken";
import {
  assertSafeFilename,
  isPathInside,
  resolveWithin,
} from "../../src/security/pathSafety";
import { SecretBox } from "../../src/security/secretBox";
import { ForbiddenError, ValidationError } from "../../src/utils/errors";

describe("path safety", () => {
  it("accepts ordinary filenames", () => {
    expect(assertSafeFilename("photo.jpg")).toBe("photo.jpg");
    expect(assertSafeFilename("  report final.pdf  ")).toBe("report final.pdf");
    expect(assertSafeFilename("trailing ")).toBe("trailing");
  });

  it.each([
    "",
    "   ",
    ".",
    "..",
    "../escape.txt",
    "..\\escape.txt",
    "nested/file.txt",
    "nested\\file.txt",
    "C:\\Windows\\evil.txt",
    "CON",
    "nul.txt",
    "trailing.",
    "bad:name.txt",
    "bad?.txt",
    "bad|name.txt",
    "bad\u0000name",
    "bad\u001fname",
  ])("rejects unsafe filename %j", (filename) => {
    expect(() => assertSafeFilename(filename)).toThrow(ValidationError);
  });

  it("keeps resolved paths inside the trusted base", () => {
    const base = resolve("C:/TelevaultData");
    expect(isPathInside(base, resolve(base, "downloads/file.txt"))).toBe(true);
    expect(isPathInside(base, resolve("C:/TelevaultData2/file.txt"))).toBe(false);
    expect(resolveWithin(base, "downloads", "file.txt")).toBe(
      resolve(base, "downloads/file.txt"),
    );
    expect(() => resolveWithin(base, "..", "outside.txt")).toThrow(
      ForbiddenError,
    );
    expect(() => resolveWithin(base, "C:\\Windows\\evil.txt")).toThrow(
      ForbiddenError,
    );
    expect(() => resolveWithin(base, "nested/file.txt")).toThrow(
      ForbiddenError,
    );
    expect(() => resolveWithin(base, "")).toThrow(ValidationError);
  });
});

describe("session encryption", () => {
  it("round-trips secrets with authenticated encryption", () => {
    const box = new SecretBox(randomBytes(32));
    const plaintext = "1BVtsOK4Bu...telegram-session...";

    const first = box.encrypt(plaintext);
    const second = box.encrypt(plaintext);
    expect(first).not.toBe(second);
    expect(first.startsWith("v1.")).toBe(true);
    expect(first).not.toContain(plaintext);
    expect(box.decrypt(first)).toBe(plaintext);
    expect(box.decrypt(second)).toBe(plaintext);
  });

  it("rejects tampered ciphertext and the wrong key", () => {
    const box = new SecretBox(randomBytes(32));
    const payload = box.encrypt("secret");
    const parts = payload.split(".");
    const ciphertext = parts[3]!;
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]}.${ciphertext.slice(0, -2)}AA`;

    expect(() => box.decrypt(tampered)).toThrow(/could not be decrypted/);
    expect(() => new SecretBox(randomBytes(32)).decrypt(payload)).toThrow(
      /could not be decrypted/,
    );
  });
});

describe("API token storage", () => {
  let dataDir: string | null = null;

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = null;
    }
  });

  it("generates a token once and reuses the owner-only file", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "televault-token-"));
    const config = loadConfig({
      NODE_ENV: "test",
      DATA_DIR: dataDir,
      LOG_LEVEL: "silent",
    });

    const first = await resolveApiToken(config);
    expect(first.source).toBe("file");
    expect(first.token.length).toBeGreaterThanOrEqual(32);
    expect(first.filePath).toBe(join(dataDir, "api-token"));

    const second = await resolveApiToken(config);
    expect(second.token).toBe(first.token);

    const onDisk = (await readFile(first.filePath!, "utf8")).trim();
    expect(onDisk).toBe(first.token);
  });

  it("prefers a token supplied through the environment", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "televault-token-"));
    const envToken = "env-token-0123456789abcdef0123456789";
    const config = loadConfig({
      NODE_ENV: "test",
      DATA_DIR: dataDir,
      LOG_LEVEL: "silent",
      TELEVAULT_API_TOKEN: envToken,
    });

    const resolved = await resolveApiToken(config);
    expect(resolved.source).toBe("env");
    expect(resolved.token).toBe(envToken);
    expect(resolved.filePath).toBeNull();
  });
});

describe("configuration validation", () => {
  it("refuses to bind to a public interface", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        HOST: "0.0.0.0",
        DATA_DIR: "./data",
        LOG_LEVEL: "silent",
      }),
    ).toThrow(/loopback/i);
  });

  it("requires Telegram API credentials as a pair", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        DATA_DIR: "./data",
        LOG_LEVEL: "silent",
        TELEGRAM_API_ID: "12345",
      }),
    ).toThrow(/configured together/i);
  });

  it("rejects weak API tokens", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        DATA_DIR: "./data",
        LOG_LEVEL: "silent",
        TELEVAULT_API_TOKEN: "short",
      }),
    ).toThrow(/at least 32/i);
  });
});
