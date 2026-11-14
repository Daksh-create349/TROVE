import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const backendDir = resolve(scriptDir, "..");
const source = resolve(backendDir, "src/database/migrations");
const destination = resolve(backendDir, "dist/backend/src/database/migrations");

await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
console.log(`Copied database migrations to ${destination}`);
