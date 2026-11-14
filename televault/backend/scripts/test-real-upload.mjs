/**
 * Real Telegram Integration Test Script for TeleVault Large File Upload Engine.
 *
 * Requirements:
 * - TELEGRAM_API_ID and TELEGRAM_API_HASH set in .env or environment.
 * - An authenticated session must already exist (from completing Phase 02 auth),
 *   OR a session string provided in TELEGRAM_SESSION environment variable.
 *
 * Usage:
 *   node scripts/test-real-upload.mjs [path-to-test-file]
 */

import { existsSync, promises as fs } from "node:fs";
import { resolve, join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import dotenv from "dotenv";

dotenv.config();

const apiId = parseInt(process.env.TELEGRAM_API_ID || "0", 10);
const apiHash = process.env.TELEGRAM_API_HASH || "";
const sessionEnv = process.env.TELEGRAM_SESSION || "";

if (!apiId || !apiHash) {
  console.error("Error: TELEGRAM_API_ID and TELEGRAM_API_HASH must be configured in .env");
  process.exit(1);
}

const { TelegramClient, Api } = await import("telegram");
const { StringSession } = await import("telegram/sessions/index.js");
const { CustomFile } = await import("telegram/client/uploads.js");

let sessionString = sessionEnv;

// If TELEGRAM_SESSION is not explicitly provided, look for saved session file
if (!sessionString) {
  const sessionPath = resolve(process.cwd(), "data", "telegram.session");
  if (existsSync(sessionPath)) {
    try {
      const content = await fs.readFile(sessionPath, "utf8");
      // Check if plaintext string session
      if (content.startsWith("1") && content.length > 50) {
        sessionString = content.trim();
      }
    } catch {
      // Ignore read errors
    }
  }
}

if (!sessionString) {
  console.log("No stored session string found in TELEGRAM_SESSION or data/telegram.session.");
  console.log("Please authenticate first using the backend auth endpoints or set TELEGRAM_SESSION.");
  process.exit(1);
}

console.log("=== TeleVault Real Telegram Upload Test ===");
console.log(`Telegram API ID: ${apiId}`);

const client = new TelegramClient(
  new StringSession(sessionString),
  apiId,
  apiHash,
  {
    connectionRetries: 3,
    deviceModel: "TeleVault Integration Test",
    appVersion: "0.1.0",
  },
);

try {
  console.log("Connecting to Telegram MTProto...");
  await client.connect();

  const isAuth = await client.checkAuthorization();
  if (!isAuth) {
    console.error("Session is not authorized. Please log in again.");
    process.exit(1);
  }

  const me = await client.getMe();
  console.log(`Connected as: ${me.firstName} (@${me.username || "no-username"}, ID: ${me.id})`);
  console.log(`Telegram Premium: ${Boolean(me.premium)}`);

  // Query AppConfig capabilities
  let maxParts = me.premium ? 8000 : 4000;
  try {
    const appConfig = await client.invoke(new Api.help.GetAppConfig({}));
    console.log("Retrieved live Telegram AppConfig successfully.");
  } catch {
    console.log("Could not query dynamic AppConfig; using default capabilities.");
  }

  const partSize = 512 * 1024;
  const maxSingle = maxParts * partSize;
  const safeSegment = maxSingle - 50 * 1024 * 1024;
  console.log(`Telegram part size: ${partSize} bytes (512 KB)`);
  console.log(`Max single upload: ~${Math.round(maxSingle / 1024 / 1024)} MB`);
  console.log(`Safe segment size: ~${Math.round(safeSegment / 1024 / 1024)} MB`);

  // Create or load test file
  let testFilePath = process.argv[2];
  let isTemp = false;

  if (!testFilePath || !existsSync(testFilePath)) {
    testFilePath = resolve(process.cwd(), "tmp_real_upload_test.bin");
    isTemp = true;
    console.log("Generating 256 KB test binary file...");
    await fs.writeFile(testFilePath, randomBytes(256 * 1024));
  }

  const fileStat = await fs.stat(testFilePath);
  const fileBuffer = await fs.readFile(testFilePath);
  const fileSha256 = createHash("sha256").update(fileBuffer).digest("hex");
  const fileName = testFilePath.split(/[\\/]/).pop() || "test.bin";

  console.log(`Target file: ${fileName} (${fileStat.size} bytes)`);
  console.log(`File SHA-256: ${fileSha256}`);

  // Test Level 2 Manifest caption
  const testFileUuid = "00000000-0000-0000-0000-000000000001";
  const manifestCaption = `TVLT:v1:${testFileUuid}:0:1:${fileSha256}`;
  console.log(`Manifest caption: ${manifestCaption}`);

  console.log("Uploading file to Telegram Saved Messages...");
  const customFile = new CustomFile(fileName, fileStat.size, testFilePath, undefined);

  let lastPct = -1;
  const result = await client.sendFile("me", {
    file: customFile,
    caption: manifestCaption,
    forceDocument: true,
    fileSize: fileStat.size,
    attributes: [new Api.DocumentAttributeFilename({ fileName })],
    workers: 1,
    progressCallback: (ratio) => {
      const pct = Math.round(ratio * 100);
      if (pct !== lastPct && pct % 20 === 0) {
        lastPct = pct;
        console.log(`Upload progress: ${pct}%`);
      }
    },
  });

  console.log(`SUCCESS! Document uploaded to Telegram Saved Messages.`);
  console.log(`Telegram Message ID: ${result.id}`);
  console.log(`Saved Messages Peer: "me" (User ID: ${me.id})`);

  if (isTemp) {
    await fs.unlink(testFilePath).catch(() => {});
  }

  console.log("=== Integration test completed successfully ===");
} catch (error) {
  console.error("Upload test failed:", error);
  process.exitCode = 1;
} finally {
  await client.destroy();
}

