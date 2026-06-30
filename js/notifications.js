/*
  notifications.js
  Purpose:
  - Build inventory alerts (expiry, stock, wear, restock) from current state.
  - Persist read/unread status per user + inventory.
  - Surface short in-app toasts when new alerts appear.
*/

import { getCurrentInventoryId, getState } from "./state.js";
import { getItemStockLevel, isLowStockLevel } from "./utils.js";

const EXPIRY_SOON_DAYS = 7;
const EXPIRY_CRITICAL_DAYS = 3;
const MS_PER_DAY = 86400000;
const READ_KEY_PREFIX = "norder_notification_reads";
const ANNOUNCED_KEY_PREFIX = "norder_notification_announced";
const DISMISSED_KEY_PREFIX = "norder_notification_dismissed";

function getStartOfTodayTimestamp() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function getExpiryTimestamp(expiryDate) {
  const raw = String(expiryDate || "").trim();
  if (!raw) return Number.POSITIVE_INFINITY;

  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const [, year, month, day] = match;
    return new Date(Number(year), Number(month) - 1, Number(day)).getTime();
  }

  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function toBooleanPref(value, fallback = true) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
      return false;
    }
  }
  return Boolean(fallback);
}

function normalizeExpirySoonDays(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return EXPIRY_SOON_DAYS;
  return Math.min(60, Math.max(1, Math.round(parsed)));
}

function getNotificationPrefs(state) {
  const prefs = state && state.prefs && typeof state.prefs === "object" ? state.prefs : {};
  return {
    expiryEnabled: toBooleanPref(prefs.notification_expiry_enabled, true),
    stockEnabled: toBooleanPref(prefs.notification_stock_enabled, true),
    wearEnabled: toBooleanPref(prefs.notification_wear_enabled, true),
    restockEnabled: toBooleanPref(prefs.notification_restock_enabled, true),
    expirySoonDays: normalizeExpirySoonDays(prefs.notification_expiry_soon_days),
  };
}

function getExpiryNotification(item, expirySoonDays = EXPIRY_SOON_DAYS) {
  const rawDate = String((item && item.expiry_date) || "").trim();
  if (!rawDate) return null;

  const timestamp = getExpiryTimestamp(rawDate);
  if (!Number.isFinite(timestamp)) return null;

  const name = String((item && item.name) || "Item").trim() || "Item";
  const daysRemaining = Math.round((timestamp - getStartOfTodayTimestamp()) / MS_PER_DAY);

  if (daysRemaining < 0) {
    const daysLate = Math.abs(daysRemaining);
    return {
      id: `expiry-expired:${item.id}:${daysLate}`,
      severity: "critical",
      title: `${name} has expired`,
      body: daysLate === 1 ? "Expired yesterday." : `Expired ${daysLate} days ago.`,
      route: "/inventory?q=&cat=all&wear=all&sort=expiry",
      priority: 1,
    };
  }

  if (daysRemaining === 0) {
    return {
      id: `expiry-today:${item.id}`,
      severity: "critical",
      title: `${name} expires today`,
      body: "Use or replace this item now.",
      route: "/inventory?q=&cat=all&wear=all&sort=expiry",
      priority: 2,
    };
  }

  if (daysRemaining <= EXPIRY_CRITICAL_DAYS) {
    return {
      id: `expiry-critical:${item.id}:${daysRemaining}`,
      severity: "warning",
      title: `${name} expires soon`,
      body: daysRemaining === 1 ? "Expires tomorrow." : `Expires in ${daysRemaining} days.`,
      route: "/inventory?q=&cat=all&wear=all&sort=expiry",
      priority: 3,
    };
  }

  if (daysRemaining <= expirySoonDays) {
    return {
      id: `expiry-soon:${item.id}:${daysRemaining}`,
      severity: "info",
      title: `${name} is due this week`,
      body: `Expires in ${daysRemaining} days.`,
      route: "/inventory?q=&cat=all&wear=all&sort=expiry",
      priority: 4,
    };
  }

  return null;
}

function getWearSeverity(item) {
  const enabled = Boolean(item && item.wear_and_tear_enabled);
  if (!enabled) return null;

  const rawLevel = String((item && item.wear_level) || "").trim();
  const normalizedLevel = rawLevel === "Severe" ? "Replace" : rawLevel;
  const percentage = Number(item && item.wear_percentage);
  const wearPercent = Number.isFinite(percentage) ? Math.max(0, Math.min(100, Math.round(percentage))) : 0;
  if (normalizedLevel !== "Replace" && wearPercent < 100) return null;

  const name = String((item && item.name) || "Item").trim() || "Item";
  return {
    id: `wear-replace:${item.id}:${wearPercent}`,
    severity: "warning",
    title: `${name} needs replacement`,
    body: "Wear-and-tear is at replacement level.",
    route: "/inventory?q=&cat=all&wear=tracked&sort=wear-high",
    priority: 5,
  };
}

function getLowStockNotification(item) {
  const level = getItemStockLevel(item);
  if (!isLowStockLevel(level)) return null;

  const name = String((item && item.name) || "Item").trim() || "Item";
  return {
    id: `stock-low:${item.id}:${level}`,
    severity: "warning",
    title: `${name} is low stock`,
    body: `Current stock level: ${level}.`,
    route: "/inventory?q=&cat=all&wear=all&sort=stock-low",
    priority: 6,
  };
}

function getKeyContext(state = getState()) {
  const uid = String((state && state.prefs && state.prefs.profile_uid) || "guest").trim() || "guest";
  const inventoryId = String(getCurrentInventoryId() || "local").trim() || "local";
  return `${uid}:${inventoryId}`;
}

function getReadStorageKey(state = getState()) {
  return `${READ_KEY_PREFIX}:${getKeyContext(state)}`;
}

function getAnnouncedStorageKey(state = getState()) {
  return `${ANNOUNCED_KEY_PREFIX}:${getKeyContext(state)}`;
}

function getDismissedStorageKey(state = getState()) {
  return `${DISMISSED_KEY_PREFIX}:${getKeyContext(state)}`;
}

function readMap(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function writeMap(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data || {}));
  } catch (_error) {
    // Ignore storage failures so notifications still render.
  }
}

function severityRank(level) {
  if (level === "critical") return 0;
  if (level === "warning") return 1;
  return 2;
}

export function buildInventoryNotifications(state = getState()) {
  const items = Array.isArray(state && state.items) ? state.items : [];
  const prefs = getNotificationPrefs(state);
  const notifications = [];

  items.forEach((item) => {
    if (!item || typeof item !== "object") return;

    const expiryNotice = prefs.expiryEnabled ? getExpiryNotification(item, prefs.expirySoonDays) : null;
    if (expiryNotice) notifications.push(expiryNotice);

    const stockNotice = prefs.stockEnabled ? getLowStockNotification(item) : null;
    if (stockNotice) notifications.push(stockNotice);

    const wearNotice = prefs.wearEnabled ? getWearSeverity(item) : null;
    if (wearNotice) notifications.push(wearNotice);
  });

  const restockCount = prefs.restockEnabled
    ? items.filter((item) => item && item.in_shopping_list).length
    : 0;
  if (restockCount > 0) {
    notifications.push({
      id: `restock-list:${restockCount}`,
      severity: "info",
      title: `${restockCount} item${restockCount === 1 ? "" : "s"} ready to restock`,
      body: "Open Restock to mark purchased items and reset stock quickly.",
      route: "/shopping",
      priority: 7,
    });
  }

  notifications.sort((a, b) => {
    const bySeverity = severityRank(a.severity) - severityRank(b.severity);
    if (bySeverity) return bySeverity;
    return Number(a.priority || 0) - Number(b.priority || 0);
  });

  return notifications.slice(0, 24);
}

export function getNotificationSummary(state = getState()) {
  const notifications = buildInventoryNotifications(state);
  const key = getReadStorageKey(state);
  const readMapState = readMap(key);
  const dismissedKey = getDismissedStorageKey(state);
  const dismissedMapState = readMap(dismissedKey);

  const activeIds = new Set(notifications.map((notice) => notice.id));
  let dirty = false;
  Object.keys(readMapState).forEach((id) => {
    if (!activeIds.has(id)) {
      delete readMapState[id];
      dirty = true;
    }
  });
  if (dirty) writeMap(key, readMapState);

  let dismissedDirty = false;
  Object.keys(dismissedMapState).forEach((id) => {
    if (!activeIds.has(id)) {
      delete dismissedMapState[id];
      dismissedDirty = true;
    }
  });
  if (dismissedDirty) writeMap(dismissedKey, dismissedMapState);

  const visibleNotifications = notifications.filter((notice) => !dismissedMapState[notice.id]);

  let unreadCount = 0;
  const enriched = visibleNotifications.map((notice) => {
    const isUnread = !readMapState[notice.id];
    if (isUnread) unreadCount += 1;
    return { ...notice, isUnread };
  });

  return {
    notifications: enriched,
    unreadCount,
    totalCount: enriched.length,
    hasUnread: unreadCount > 0,
  };
}

export function dismissNotifications(ids, state = getState()) {
  const normalized = Array.isArray(ids)
    ? ids.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  if (!normalized.length) return;

  const key = getDismissedStorageKey(state);
  const next = readMap(key);
  const now = Date.now();
  normalized.forEach((id) => {
    next[id] = now;
  });
  writeMap(key, next);
}

export function markNotificationsRead(ids, state = getState()) {
  const normalized = Array.isArray(ids)
    ? ids.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  if (!normalized.length) return;

  const key = getReadStorageKey(state);
  const next = readMap(key);
  const now = Date.now();
  normalized.forEach((id) => {
    next[id] = now;
  });
  writeMap(key, next);
}

function showNotificationToast(message, severity = "info") {
  if (typeof document === "undefined") return;

  const rootId = "norder-notification-toast-root";
  let root = document.getElementById(rootId);
  if (!root) {
    root = document.createElement("div");
    root.id = rootId;
    root.style.position = "fixed";
    root.style.right = "14px";
    root.style.bottom = "14px";
    root.style.display = "grid";
    root.style.gap = "8px";
    root.style.zIndex = "9999";
    root.style.pointerEvents = "none";
    document.body.appendChild(root);
  }

  const toast = document.createElement("div");
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  toast.style.maxWidth = "min(360px, calc(100vw - 30px))";
  toast.style.padding = "10px 12px";
  toast.style.borderRadius = "12px";
  toast.style.border = "1px solid rgba(255,255,255,0.16)";
  toast.style.color = "var(--on-primary, #ffffff)";
  toast.style.fontSize = "0.85rem";
  toast.style.fontWeight = "600";
  toast.style.boxShadow = "0 8px 24px rgba(0,0,0,0.24)";
  toast.style.opacity = "0";
  toast.style.transform = "translateY(8px)";
  toast.style.transition = "opacity 160ms ease, transform 160ms ease";
  toast.style.background =
    severity === "critical"
      ? "color-mix(in srgb, var(--danger) 82%, black 18%)"
      : severity === "warning"
      ? "color-mix(in srgb, #bd7d2f 78%, black 22%)"
      : "color-mix(in srgb, var(--primary) 85%, black 15%)";
  toast.textContent = String(message || "Notification");

  root.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
  });

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(8px)";
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 180);
  }, 3200);
}

export function announceUnreadNotifications(state = getState()) {
  if (typeof sessionStorage === "undefined") return;

  const summary = getNotificationSummary(state);
  const nextAlert = summary.notifications.find((notice) => notice.isUnread);
  if (!nextAlert) return;

  const key = getAnnouncedStorageKey(state);
  const lastAnnouncedId = String(sessionStorage.getItem(key) || "");
  if (lastAnnouncedId === nextAlert.id) return;

  const body = String(nextAlert.body || "").trim();
  const message = body ? `${nextAlert.title}. ${body}` : nextAlert.title;
  showNotificationToast(message, nextAlert.severity);
  sessionStorage.setItem(key, nextAlert.id);
}
