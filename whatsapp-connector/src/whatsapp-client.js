import { EventEmitter } from "node:events";
import pino from "pino";
import QRCode from "qrcode";
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";

import { AUTH_DIR, QR_PATH } from "./paths.js";
import { store } from "./store.js";

const logger = pino({ level: process.env.WHATSAPP_LOG_LEVEL || "silent" });

function toJid(numberOrJid) {
  if (!numberOrJid) throw new Error("מספר/JID ריק");
  if (numberOrJid.includes("@")) return numberOrJid;
  const digits = numberOrJid.replace(/[^\d]/g, "");
  if (!digits) throw new Error(`מספר לא תקין: ${numberOrJid}`);
  return `${digits}@s.whatsapp.net`;
}

function extractText(msg) {
  const m = msg.message;
  if (!m) return null;
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    null
  );
}

function extractMediaType(msg) {
  const m = msg.message;
  if (!m) return null;
  if (m.imageMessage) return "image";
  if (m.videoMessage) return "video";
  if (m.audioMessage) return m.audioMessage.ptt ? "voice" : "audio";
  if (m.documentMessage) return "document";
  if (m.stickerMessage) return "sticker";
  return null;
}

export class WhatsAppClient extends EventEmitter {
  constructor() {
    super();
    this.sock = null;
    this.status = "starting"; // starting | qr | connected | disconnected | logged_out
    this.qrDataUrl = null;
    this._starting = false;
  }

  async start() {
    if (this._starting) return;
    this._starting = true;

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    let version;
    try {
      ({ version } = await fetchLatestBaileysVersion());
    } catch {
      version = undefined; // fall back to Baileys' bundled default
    }

    const sock = makeWASocket({
      version,
      auth: state,
      logger,
      printQRInTerminal: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
    });
    this.sock = sock;

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", (update) => this._onConnectionUpdate(update));
    sock.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify" && type !== "append") return;
      for (const msg of messages) this._handleIncoming(msg);
    });
    sock.ev.on("contacts.upsert", (contacts) => {
      for (const c of contacts) {
        if (c.id) store.upsertChat({ id: c.id, name: c.name || c.notify || undefined });
      }
    });
    sock.ev.on("chats.upsert", (chats) => {
      for (const c of chats) {
        store.upsertChat({ id: c.id, name: c.name || undefined, isGroup: c.id?.endsWith("@g.us") });
      }
    });
  }

  async _onConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      this.status = "qr";
      try {
        this.qrDataUrl = await QRCode.toDataURL(qr);
        await QRCode.toFile(QR_PATH, qr);
      } catch (err) {
        logger.warn({ err }, "failed to render qr");
      }
      this.emit("qr", qr);
      console.error('[whatsapp] נדרשת סריקת QR — קרא לכלי "get_login_qr" או הרץ npm run login');
    }

    if (connection === "open") {
      this.status = "connected";
      this.qrDataUrl = null;
      this.emit("connected");
      console.error("[whatsapp] מחובר בהצלחה");
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      this.status = loggedOut ? "logged_out" : "disconnected";
      this._starting = false;
      this.emit("close", { loggedOut, statusCode });

      if (loggedOut) {
        console.error("[whatsapp] ההתחברות נותקה מהטלפון — יש למחוק את תיקיית data/auth ולסרוק QR מחדש");
      } else {
        console.error("[whatsapp] החיבור נותק, מתחבר מחדש בעוד 2 שניות...");
        setTimeout(() => this.start(), 2000);
      }
    }
  }

  _handleIncoming(msg) {
    const jid = msg.key.remoteJid;
    if (!jid || jid === "status@broadcast") return;

    const text = extractText(msg);
    const mediaType = extractMediaType(msg);
    const rawTs = typeof msg.messageTimestamp === "number" ? msg.messageTimestamp : Number(msg.messageTimestamp);
    const timestamp = Number.isFinite(rawTs) && rawTs > 0 ? rawTs * 1000 : Date.now();
    const fromMe = !!msg.key.fromMe;
    const senderName = msg.pushName || undefined;

    store.addMessage(jid, {
      id: msg.key.id,
      fromMe,
      sender: fromMe ? "me" : msg.key.participant || jid,
      senderName,
      text,
      mediaType,
      timestamp,
    });

    if (!fromMe) {
      const existing = store.getChat(jid);
      store.upsertChat({
        id: jid,
        name: existing?.name || senderName,
        isGroup: jid.endsWith("@g.us"),
        unreadCount: (existing?.unreadCount || 0) + 1,
      });
    }
  }

  getStatus() {
    return { status: this.status, hasQr: !!this.qrDataUrl };
  }

  getQr() {
    return this.qrDataUrl;
  }

  _ensureConnected() {
    if (this.status !== "connected" || !this.sock) {
      throw new Error(`וואטסאפ לא מחובר כרגע (סטטוס: ${this.status}). יש לסרוק QR קודם באמצעות הכלי get_login_qr.`);
    }
  }

  async checkNumber(number) {
    this._ensureConnected();
    const digits = number.replace(/[^\d]/g, "");
    const [result] = await this.sock.onWhatsApp(digits);
    return result ? { exists: true, jid: result.jid } : { exists: false, jid: null };
  }

  async sendText(to, text) {
    this._ensureConnected();
    const jid = toJid(to);
    const result = await this.sock.sendMessage(jid, { text });
    store.addMessage(jid, {
      id: result?.key?.id,
      fromMe: true,
      sender: "me",
      text,
      mediaType: null,
      timestamp: Date.now(),
    });
    return { jid, messageId: result?.key?.id };
  }

  async markChatRead(jidOrNumber) {
    this._ensureConnected();
    const jid = toJid(jidOrNumber);
    const unread = store.getMessages(jid, 50).filter((m) => !m.fromMe && m.id);
    if (unread.length) {
      const keys = unread.map((m) => ({ remoteJid: jid, id: m.id, fromMe: false }));
      await this.sock.readMessages(keys);
    }
    store.markRead(jid);
    return { jid, markedCount: unread.length };
  }

  resolveJid(numberOrJid) {
    return toJid(numberOrJid);
  }
}

export const whatsapp = new WhatsAppClient();
