import fs from "node:fs";
import { STORE_PATH } from "./paths.js";

const MAX_MESSAGES_PER_CHAT = 200;
const SAVE_DEBOUNCE_MS = 2000;

/**
 * Lightweight, file-persisted store for chats and recent messages.
 * Baileys itself is stateless about history, so we build up our own
 * rolling window as messages flow through the socket.
 */
class Store {
  constructor() {
    this.chats = new Map(); // jid -> { id, name, isGroup, unreadCount, lastMessageTimestamp, lastMessagePreview }
    this.messages = new Map(); // jid -> [{ id, fromMe, sender, senderName, text, mediaType, timestamp }]
    this._saveTimer = null;
    this._load();
  }

  _load() {
    try {
      if (!fs.existsSync(STORE_PATH)) return;
      const raw = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
      for (const chat of raw.chats || []) this.chats.set(chat.id, chat);
      for (const [jid, msgs] of Object.entries(raw.messages || {})) this.messages.set(jid, msgs);
    } catch (err) {
      console.error("[store] failed to load persisted store:", err.message);
    }
  }

  _scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._save();
    }, SAVE_DEBOUNCE_MS);
  }

  _save() {
    try {
      const data = {
        chats: [...this.chats.values()],
        messages: Object.fromEntries(this.messages),
      };
      fs.writeFileSync(STORE_PATH, JSON.stringify(data));
    } catch (err) {
      console.error("[store] failed to persist store:", err.message);
    }
  }

  upsertChat(partial) {
    const existing = this.chats.get(partial.id) || { id: partial.id, unreadCount: 0 };
    const merged = { ...existing, ...partial };
    // never let an `undefined` overwrite a value we already knew
    for (const key of Object.keys(partial)) {
      if (partial[key] === undefined) merged[key] = existing[key];
    }
    this.chats.set(partial.id, merged);
    this._scheduleSave();
  }

  addMessage(jid, message) {
    const list = this.messages.get(jid) || [];
    list.push(message);
    if (list.length > MAX_MESSAGES_PER_CHAT) list.splice(0, list.length - MAX_MESSAGES_PER_CHAT);
    this.messages.set(jid, list);
    this.upsertChat({
      id: jid,
      lastMessageTimestamp: message.timestamp,
      lastMessagePreview: message.text ? message.text.slice(0, 120) : message.mediaType ? `[${message.mediaType}]` : "",
    });
  }

  getMessages(jid, limit = 20) {
    const list = this.messages.get(jid) || [];
    return list.slice(-limit);
  }

  searchMessages(query, limit = 30) {
    const needle = query.toLowerCase();
    const results = [];
    for (const [jid, list] of this.messages) {
      for (const m of list) {
        if (m.text && m.text.toLowerCase().includes(needle)) {
          results.push({ chatId: jid, ...m });
        }
      }
    }
    results.sort((a, b) => b.timestamp - a.timestamp);
    return results.slice(0, limit);
  }

  listChats({ limit = 50 } = {}) {
    return [...this.chats.values()]
      .sort((a, b) => (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0))
      .slice(0, limit);
  }

  getChat(jid) {
    return this.chats.get(jid);
  }

  markRead(jid) {
    const chat = this.chats.get(jid);
    if (chat && chat.unreadCount) {
      chat.unreadCount = 0;
      this._scheduleSave();
    }
  }

  flush() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this._save();
  }
}

export const store = new Store();
