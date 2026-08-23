#!/usr/bin/env node
// Standalone helper: run `npm run login` to connect once, scan the QR
// printed in the terminal, and exit once connected. After that the
// session in data/auth/ is reused automatically by `npm start` / the MCP
// server, without needing another scan.
import qrcodeTerminal from "qrcode-terminal";
import { whatsapp } from "./whatsapp-client.js";

whatsapp.on("qr", (qr) => {
  console.log("\nסרקו את קוד ה-QR הבא עם וואטסאפ בטלפון (הגדרות > מכשירים מקושרים > קישור מכשיר):\n");
  qrcodeTerminal.generate(qr, { small: true });
});

whatsapp.on("connected", () => {
  console.log("\n✅ מחובר בהצלחה! ניתן לסגור את התהליך הזה (Ctrl+C) ולהריץ את הקונקטור עם npm start.\n");
  process.exit(0);
});

whatsapp.start().catch((err) => {
  console.error("שגיאה בהתחברות:", err);
  process.exit(1);
});
