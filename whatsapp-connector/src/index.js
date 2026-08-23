#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { whatsapp } from "./whatsapp-client.js";
import { store } from "./store.js";
import { Scheduler } from "./scheduler.js";

const server = new McpServer({
  name: "whatsapp-connector",
  version: "1.0.0",
});

const scheduler = new Scheduler(async (jid, text) => {
  await whatsapp.sendText(jid, text);
});

function ok(data) {
  return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}

function fail(err) {
  return {
    content: [{ type: "text", text: `שגיאה: ${err instanceof Error ? err.message : String(err)}` }],
    isError: true,
  };
}

// ---------------------------------------------------------------------------
// Connection / auth
// ---------------------------------------------------------------------------

server.registerTool(
  "get_status",
  {
    title: "מצב חיבור וואטסאפ",
    description: "בודק אם הקונקטור מחובר לוואטסאפ, ממתין לסריקת QR, או מנותק.",
    inputSchema: {},
  },
  async () => {
    try {
      return ok(whatsapp.getStatus());
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "get_login_qr",
  {
    title: "קבלת קוד QR להתחברות",
    description:
      "מחזיר קוד QR (כתמונת data URL בפורמט base64 PNG) לסריקה עם אפליקציית וואטסאפ בטלפון (הגדרות > מכשירים מקושרים > קישור מכשיר). זמין רק כאשר הסטטוס הוא 'qr'.",
    inputSchema: {},
  },
  async () => {
    try {
      const qr = whatsapp.getQr();
      if (!qr) {
        return ok({
          status: whatsapp.getStatus(),
          message: "אין כרגע קוד QR ממתין — ייתכן שכבר מחובר, או שהחיבור עוד לא אותחל.",
        });
      }
      return ok({ qrDataUrl: qr, instructions: "סרקו את הקוד עם וואטסאפ בטלפון: הגדרות > מכשירים מקושרים > קישור מכשיר" });
    } catch (err) {
      return fail(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Reading / scanning messages
// ---------------------------------------------------------------------------

server.registerTool(
  "list_chats",
  {
    title: "רשימת שיחות",
    description: "מחזיר את השיחות האחרונות (אישיות וקבוצתיות) שנצפו מאז שהקונקטור התחיל לרוץ, ממוינות לפי הודעה אחרונה.",
    inputSchema: {
      limit: z.number().int().min(1).max(200).default(50).describe("מספר שיחות מקסימלי להחזרה"),
    },
  },
  async ({ limit }) => {
    try {
      return ok(store.listChats({ limit }));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "read_messages",
  {
    title: "קריאת הודעות משיחה",
    description: "מחזיר את ההודעות האחרונות משיחה מסוימת (לפי מספר טלפון או JID). דורש שהקונקטור יהיה מחובר וכבר ראה את השיחה מאז ההפעלה.",
    inputSchema: {
      chatId: z.string().describe("מספר טלפון (כולל קידומת מדינה, למשל 972501234567) או JID מלא כמו 972501234567@s.whatsapp.net"),
      limit: z.number().int().min(1).max(200).default(20).describe("מספר הודעות מקסימלי להחזרה"),
    },
  },
  async ({ chatId, limit }) => {
    try {
      const jid = whatsapp.resolveJid(chatId);
      return ok({ jid, messages: store.getMessages(jid, limit) });
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "search_messages",
  {
    title: "חיפוש טקסט בהודעות",
    description: "מחפש מחרוזת טקסט בכל ההודעות שנצפו בכל השיחות (מאז הפעלת הקונקטור).",
    inputSchema: {
      query: z.string().min(1).describe("מחרוזת החיפוש"),
      limit: z.number().int().min(1).max(100).default(30).describe("מספר תוצאות מקסימלי"),
    },
  },
  async ({ query, limit }) => {
    try {
      return ok(store.searchMessages(query, limit));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "mark_chat_read",
  {
    title: "סימון שיחה כנקראה",
    description: "מסמן את ההודעות האחרונות בשיחה כנקראות (checkmarks כחולים) ומאפס את מונה ההודעות שלא נקראו במעקב הפנימי.",
    inputSchema: {
      chatId: z.string().describe("מספר טלפון או JID של השיחה"),
    },
  },
  async ({ chatId }) => {
    try {
      return ok(await whatsapp.markChatRead(chatId));
    } catch (err) {
      return fail(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Sending messages
// ---------------------------------------------------------------------------

server.registerTool(
  "send_message",
  {
    title: "שליחת הודעת וואטסאפ",
    description: "שולח הודעת טקסט מיידית למספר טלפון (עם קידומת מדינה, ללא +) או ל-JID של שיחה/קבוצה.",
    inputSchema: {
      to: z.string().describe("מספר טלפון (למשל 972501234567) או JID כמו 972501234567@s.whatsapp.net / xxxx@g.us לקבוצה"),
      text: z.string().min(1).describe("תוכן ההודעה"),
    },
  },
  async ({ to, text }) => {
    try {
      return ok(await whatsapp.sendText(to, text));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "check_number_on_whatsapp",
  {
    title: "בדיקת מספר בוואטסאפ",
    description: "בודק אם מספר טלפון נתון רשום בוואטסאפ, לפני ניסיון שליחה אליו.",
    inputSchema: {
      number: z.string().describe("מספר טלפון עם קידומת מדינה, למשל 972501234567"),
    },
  },
  async ({ number }) => {
    try {
      return ok(await whatsapp.checkNumber(number));
    } catch (err) {
      return fail(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

server.registerTool(
  "schedule_message",
  {
    title: "תזמון שליחת הודעה",
    description:
      "מתזמן הודעת טקסט לשליחה במועד עתידי. ההודעה נשמרת על הדיסק ותישלח אוטומטית גם אם הקונקטור יופעל מחדש בינתיים, כל עוד הוא רץ בזמן שהמועד מגיע.",
    inputSchema: {
      to: z.string().describe("מספר טלפון או JID של הנמען"),
      text: z.string().min(1).describe("תוכן ההודעה"),
      sendAt: z.string().describe("מועד השליחה בפורמט ISO 8601, למשל 2026-08-24T09:00:00+03:00"),
    },
  },
  async ({ to, text, sendAt }) => {
    try {
      const timestamp = Date.parse(sendAt);
      if (Number.isNaN(timestamp)) throw new Error(`תאריך לא תקין: ${sendAt}`);
      if (timestamp <= Date.now()) throw new Error("מועד השליחה חייב להיות בעתיד");
      const jid = whatsapp.resolveJid(to);
      const job = scheduler.schedule({ jid, text, sendAt: timestamp });
      return ok(job);
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "list_scheduled_messages",
  {
    title: "רשימת הודעות מתוזמנות",
    description: "מציג את כל ההודעות המתוזמנות הממתינות לשליחה (וגם היסטוריה אם includeCompleted=true).",
    inputSchema: {
      includeCompleted: z.boolean().default(false).describe("האם לכלול גם הודעות שכבר נשלחו/בוטלו/נכשלו"),
    },
  },
  async ({ includeCompleted }) => {
    try {
      return ok(scheduler.list({ includeCompleted }));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "cancel_scheduled_message",
  {
    title: "ביטול הודעה מתוזמנת",
    description: "מבטל הודעה מתוזמנת שעדיין לא נשלחה, לפי מזהה (id) שהתקבל מ-schedule_message או list_scheduled_messages.",
    inputSchema: {
      id: z.string().describe("מזהה ההודעה המתוזמנת"),
    },
  },
  async ({ id }) => {
    try {
      const cancelled = scheduler.cancel(id);
      return ok({ cancelled });
    } catch (err) {
      return fail(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main() {
  scheduler.start();
  whatsapp.start().catch((err) => console.error("[whatsapp] נכשל באתחול:", err));

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[whatsapp-connector] שרת MCP רץ (stdio)");
}

process.on("SIGINT", () => {
  store.flush();
  scheduler.stop();
  process.exit(0);
});
process.on("SIGTERM", () => {
  store.flush();
  scheduler.stop();
  process.exit(0);
});

main().catch((err) => {
  console.error("[whatsapp-connector] שגיאה קריטית:", err);
  process.exit(1);
});
