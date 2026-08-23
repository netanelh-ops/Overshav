#!/usr/bin/env node
// Standalone helper: run `npm run login` once to connect and pair, then
// exit. After that the session in data/auth/ is reused automatically by
// `npm start` / the MCP server, without needing to pair again.
//
// Two ways to pair:
//   npm run login                    -> shows a QR code to scan from a
//                                        DIFFERENT device's camera
//   npm run login -- 972501234567    -> requests an 8-char pairing code
//                                        instead (type it into WhatsApp:
//                                        Linked devices > Link a device >
//                                        "Link with phone number instead").
//                                        Use this when the connector runs
//                                        on the very same phone WhatsApp
//                                        is on — a QR shown on that screen
//                                        can't be scanned by that screen's
//                                        own camera.
import qrcodeTerminal from "qrcode-terminal";
import { whatsapp } from "./whatsapp-client.js";

const phoneNumber = process.argv[2];

whatsapp.on("qr", (qr) => {
  if (phoneNumber) return; // pairing-code flow requested, ignore the QR
  console.log("\nסרקו את קוד ה-QR הבא עם וואטסאפ ממכשיר אחר (הגדרות > מכשירים מקושרים > קישור מכשיר):\n");
  qrcodeTerminal.generate(qr, { small: true });
});

whatsapp.on("pairingCode", (code) => {
  console.log(`\nקוד הצימוד שלכם: ${code}\n`);
  console.log("בוואטסאפ בטלפון: הגדרות > מכשירים מקושרים > קישור מכשיר > קישור עם מספר טלפון במקום.\nהזינו את הקוד הזה (בתוקף לזמן קצר בלבד).\n");
});

whatsapp.on("connected", () => {
  console.log("\n✅ מחובר בהצלחה! ניתן לסגור את התהליך הזה (Ctrl+C) ולהריץ את הקונקטור עם npm start.\n");
  process.exit(0);
});

whatsapp
  .start()
  .then(async () => {
    if (!phoneNumber) return;
    // Give the socket a moment to open before requesting a pairing code.
    for (let attempt = 0; attempt < 20; attempt++) {
      if (whatsapp.sock) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    try {
      await whatsapp.requestPairingCode(phoneNumber);
    } catch (err) {
      console.error("שגיאה בבקשת קוד צימוד:", err.message);
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error("שגיאה בהתחברות:", err);
    process.exit(1);
  });
