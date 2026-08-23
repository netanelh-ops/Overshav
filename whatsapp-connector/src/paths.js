import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.join(__dirname, "..");
export const DATA_DIR = process.env.WHATSAPP_DATA_DIR || path.join(ROOT_DIR, "data");
export const AUTH_DIR = path.join(DATA_DIR, "auth");
export const QR_PATH = path.join(DATA_DIR, "qr.png");
export const STORE_PATH = path.join(DATA_DIR, "store.json");
export const SCHEDULE_PATH = path.join(DATA_DIR, "scheduled.json");

fs.mkdirSync(AUTH_DIR, { recursive: true });
