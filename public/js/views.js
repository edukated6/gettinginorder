/*
  views.js
  Purpose:
  - Build HTML strings for every page/screen in the app.
  - Keep rendering logic separate from event wiring (events.js/auth-events.js).
*/

import { getHashParams } from "./router.js";
import { getState } from "./state.js";
import { getRecentAccounts } from "./auth.js";
import { getNotificationSummary } from "./notifications.js";
import {
  STOCK_LEVELS,
  escapeAttr,
  escapeHtml,
  getItemQuantity,
  getItemStockLevel,
  getItemStockPercentage,
  getItemUnitStockLevels,
  isLowStockLevel,
  summarizeUnitStockLevels,
} from "./utils.js";

const WEAR_LEVELS = ["Brand New", "Light", "Moderate", "Heavy", "Replace"];
const WEAR_LEVEL_TO_PERCENT = {
  "Brand New": 0,
  Light: 25,
  Moderate: 50,
  Heavy: 75,
  Replace: 100,
};
const EXPIRY_SOON_DAYS = 7;
const EXPIRY_CRITICAL_DAYS = 3;
const MS_PER_DAY = 86400000;

function navLink(route, label, activeRoute, badgeCount = 0) {
  const active = activeRoute === route ? "active" : "";
  const hasBadge = Number.isFinite(Number(badgeCount)) && Number(badgeCount) > 0;
  const badge = hasBadge
    ? `<span class="nav-link-ribbon" aria-label="${Number(badgeCount)} items need restocking">${Number(
        badgeCount
      )}</span>`
    : "";
  return `<a class="nav-link ${active}" href="#${route}">${label}${badge}</a>`;
}

function profileAvatar(photoURL, name) {
  const safeName = escapeHtml(name || "Profile");
  if (photoURL) {
    return `<img class="avatar" src="${escapeAttr(photoURL)}" alt="${safeName}" />`;
  }

  const first = safeName.trim().slice(0, 1).toUpperCase() || "U";
  return `<span class="avatar avatar-fallback" aria-hidden="true">${first}</span>`;
}

function brandedLogoBlock(variant = "default") {
  const extraClass = variant === "compact" ? "brand-logo-showcase compact" : "brand-logo-showcase";
  const label = variant === "compact" ? "Signature mark" : "The nORDER signature";
  return `
    <div class="${extraClass}" aria-label="nORDER logo showcase">
      <div class="brand-logo-glow" aria-hidden="true"></div>
      <img class="brand-logo-image" src="nORDER%20LOGO.png" alt="nORDER Logo" loading="lazy" />
      <div class="brand-logo-caption">${label}</div>
    </div>
  `;
}

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

function getExpiryDetails(item) {
  const rawDate = String(item && item.expiry_date ? item.expiry_date : "").trim();
  const timestamp = getExpiryTimestamp(rawDate);

  if (!rawDate || !Number.isFinite(timestamp)) {
    return {
      status: "none",
      badge: "",
      detail: "No expiry date set",
      highlighted: false,
      timestamp: Number.POSITIVE_INFINITY,
    };
  }

  const daysRemaining = Math.round((timestamp - getStartOfTodayTimestamp()) / MS_PER_DAY);

  if (daysRemaining < 0) {
    const daysLate = Math.abs(daysRemaining);
    return {
      status: "expired",
      badge: "Expired",
      detail: daysLate === 1 ? "Expired yesterday" : `Expired ${daysLate} days ago`,
      highlighted: true,
      timestamp,
    };
  }

  if (daysRemaining === 0) {
    return {
      status: "critical",
      badge: "Today",
      detail: "Expires today",
      highlighted: true,
      timestamp,
    };
  }

  if (daysRemaining <= EXPIRY_CRITICAL_DAYS) {
    return {
      status: "critical",
      badge: daysRemaining === 1 ? "Tomorrow" : `${daysRemaining}d left`,
      detail: daysRemaining === 1 ? "Expires tomorrow" : `Expires in ${daysRemaining} days`,
      highlighted: true,
      timestamp,
    };
  }

  if (daysRemaining <= EXPIRY_SOON_DAYS) {
    return {
      status: "soon",
      badge: `${daysRemaining}d left`,
      detail: `Expires in ${daysRemaining} days`,
      highlighted: true,
      timestamp,
    };
  }

  return {
    status: "future",
    badge: "",
    detail: `Expires on ${rawDate}`,
    highlighted: false,
    timestamp,
  };
}

function getExpiryOverview(items) {
  const alertItems = items
    .map((item) => ({ item, expiry: getExpiryDetails(item) }))
    .filter((entry) => entry.expiry.highlighted)
    .sort((a, b) => a.expiry.timestamp - b.expiry.timestamp);

  const counts = alertItems.reduce(
    (summary, entry) => {
      if (entry.expiry.status === "expired") summary.expired += 1;
      else if (entry.expiry.status === "critical") summary.critical += 1;
      else if (entry.expiry.status === "soon") summary.soon += 1;
      return summary;
    },
    { expired: 0, critical: 0, soon: 0 }
  );

  if (!alertItems.length) {
    return {
      alertCount: 0,
      counts,
      tone: "calm",
      headline: "",
      summary: "",
    };
  }

  const nextItem = alertItems[0];
  const alertCount = alertItems.length;
  const plural = alertCount === 1 ? "" : "s";
  const breakdown = [];
  if (counts.expired) breakdown.push(`${counts.expired} expired`);
  if (counts.critical) breakdown.push(`${counts.critical} due within ${EXPIRY_CRITICAL_DAYS} days`);
  if (counts.soon) breakdown.push(`${counts.soon} due this week`);

  return {
    alertCount,
    counts,
    tone: counts.expired ? "expired" : counts.critical ? "critical" : "soon",
    headline: `${alertCount} item${plural} need expiry attention`,
    summary: `${breakdown.join(". ")}. Next up: ${String(nextItem.item && nextItem.item.name ? nextItem.item.name : "Item")} - ${nextItem.expiry.detail}.`,
  };
}

function shellLayout(content, route) {
  const state = getState();
  const restockCount = state.items.filter((item) => item.in_shopping_list).length;
  const expiryOverview = getExpiryOverview(state.items);
  const notificationSummary = getNotificationSummary(state);
  const notificationUnread = notificationSummary.unreadCount;
  const hasNotifications = notificationSummary.totalCount > 0;
  const expiryRoute = "/inventory?q=&cat=all&wear=all&sort=expiry";
  const greeting = state.prefs.profile_name
    ? `Welcome, ${escapeHtml(state.prefs.profile_name)}`
    : "Inventory at a glance";
  const profileName = state.prefs.profile_name || "Profile";
  const photoURL = state.prefs.profile_picture || "";
  const expiryBanner = expiryOverview.alertCount
    ? `
      <section class="global-expiry-alert ${expiryOverview.tone}" role="status" aria-live="polite">
        <div class="global-expiry-alert-copy">
          <p class="global-expiry-alert-kicker">Expiry Alert</p>
          <div class="global-expiry-alert-headline">${escapeHtml(expiryOverview.headline)}</div>
          <p class="global-expiry-alert-text">${escapeHtml(expiryOverview.summary)}</p>
          <div class="global-expiry-alert-chips">
            ${expiryOverview.counts.expired ? `<span class="global-expiry-chip expired">${expiryOverview.counts.expired} expired</span>` : ""}
            ${expiryOverview.counts.critical ? `<span class="global-expiry-chip critical">${expiryOverview.counts.critical} urgent</span>` : ""}
            ${expiryOverview.counts.soon ? `<span class="global-expiry-chip soon">${expiryOverview.counts.soon} this week</span>` : ""}
          </div>
        </div>
        <a class="global-expiry-alert-cta" href="#${expiryRoute}">${route === "/inventory" ? "Sort by expiry" : "Review now"}</a>
      </section>
    `
    : "";
  const pageAction =
    route === "/inventory"
      ? `
        <button
          id="page-floating-action"
          class="page-fab page-fab-inventory"
          type="button"
          data-page-action="inventory-add"
          aria-label="Add an inventory item from here"
          aria-hidden="true"
          tabindex="-1"
        >
          <span class="page-fab-icon" aria-hidden="true">+</span>
          <span class="page-fab-copy">
            <span class="page-fab-kicker">Keep stocking</span>
            <span class="page-fab-label" data-role="page-fab-label">Add Item</span>
            <span class="page-fab-meta" data-role="page-fab-meta">Open a quick add sheet</span>
          </span>
        </button>
      `
      : route === "/shopping"
      ? `
        <button
          id="page-floating-action"
          class="page-fab page-fab-shopping"
          type="button"
          data-page-action="shopping-restock"
          aria-label="Restock checked items from here"
          aria-hidden="true"
          tabindex="-1"
        >
          <span class="page-fab-icon" aria-hidden="true">✓</span>
          <span class="page-fab-copy">
            <span class="page-fab-kicker">Keep moving</span>
            <span class="page-fab-label" data-role="page-fab-label">Restock Checked</span>
            <span class="page-fab-meta" data-role="page-fab-meta">Select items to enable</span>
          </span>
        </button>
      `
      : "";
  const notificationPanel = `
    <aside
      id="norder-notification-center"
      hidden
      aria-label="Inventory notifications"
      style="position:fixed;top:72px;right:14px;z-index:60;width:min(420px,calc(100vw - 28px));max-height:min(72vh,560px);overflow:auto;border:1px solid color-mix(in srgb,var(--primary) 30%,var(--border));border-radius:14px;padding:10px;background:color-mix(in srgb,var(--surface) 96%,var(--bg));box-shadow:0 18px 40px rgba(0,0,0,0.28);"
    >
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">
        <div>
          <div style="font-size:0.72rem;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-soft);">Notifications</div>
          <div style="font-size:0.85rem;color:var(--text-soft);">${notificationUnread} unread of ${notificationSummary.totalCount}</div>
        </div>
        <div style="display:flex;gap:6px;">
          <button type="button" class="ghost" data-action="clear-notifications" ${hasNotifications ? "" : "disabled"}>Clear</button>
          <button type="button" class="ghost" data-action="mark-all-notifications-read" ${hasNotifications ? "" : "disabled"}>Mark all read</button>
          <button type="button" class="ghost" data-action="close-notification-center" aria-label="Close notifications">Close</button>
        </div>
      </div>
      <div style="display:grid;gap:8px;">
        ${
          notificationSummary.notifications.length
            ? notificationSummary.notifications
                .map(
                  (notice) => `
                    <button
                      type="button"
                      class="ghost"
                      data-action="open-notification"
                      data-id="${escapeAttr(notice.id)}"
                      data-route="${escapeAttr(notice.route || "/inventory")}" 
                      style="text-align:left;display:grid;gap:3px;padding:10px;border-radius:10px;border:1px solid color-mix(in srgb,var(--primary) 20%,var(--border));background:${
                        notice.isUnread
                          ? "color-mix(in srgb,var(--primary) 14%,var(--surface))"
                          : "color-mix(in srgb,var(--surface-muted) 68%,var(--surface))"
                      };"
                    >
                      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                        <strong style="font-size:0.9rem;">${escapeHtml(notice.title)}</strong>
                        ${notice.isUnread ? '<span style="font-size:0.7rem;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:var(--primary);">New</span>' : ""}
                      </div>
                      <span style="font-size:0.8rem;color:var(--text-soft);">${escapeHtml(notice.body)}</span>
                    </button>
                  `
                )
                .join("")
            : '<div class="help" style="padding:6px 2px;">No active inventory alerts right now.</div>'
        }
      </div>
    </aside>
  `;

  return `
    <div class="app-shell">
      <header class="topbar">
        <div>
          <div class="brand"><span class="brand-n">n</span>ORDER</div>
          <div class="muted">${greeting}</div>
        </div>
        <div class="row">
          <button type="button" class="ghost budget-launch-btn" onclick="window.location.href='budget.html'" aria-label="Open nORDER Budget Tool" title="Budget Tool">
            <span class="budget-launch-glyph" aria-hidden="true">$</span><span class="topbar-label">Budget</span>
          </button>
          <button id="open-tutorial" class="ghost" aria-label="Open beginner tutorial" title="Beginner tutorial">
            <span class="tutorial-trigger-glyph" aria-hidden="true">?</span><span class="topbar-label">Tutorial</span>
          </button>
          <button
            id="open-notifications"
            class="ghost"
            data-action="toggle-notification-center"
            aria-expanded="false"
            aria-controls="norder-notification-center"
            aria-label="Open notifications"
            style="position:relative;width:42px;height:42px;display:inline-grid;place-items:center;padding:0;border:0;background:transparent;"
          >
            <img src="bell-alt-svgrepo-com.svg" aria-hidden="true" style="width:1.8rem;height:1.8rem;display:block;" alt="">
            ${notificationUnread ? `<span style="position:absolute;top:-2px;right:-2px;min-width:18px;height:18px;padding:0 4px;border-radius:999px;background:linear-gradient(135deg,#d85a4a,#a23224);color:#fff;font-size:0.65rem;font-weight:800;display:inline-grid;place-items:center;">${Math.min(notificationUnread, 99)}</span>` : ""}
            <span class="topbar-label">Alerts</span>
          </button>
          <button id="quick-add" class="primary" aria-label="Add item"><svg class="quick-add-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path d="M12 6C12.5523 6 13 6.44772 13 7V11H17C17.5523 11 18 11.4477 18 12C18 12.5523 17.5523 13 17 13H13V17C13 17.5523 12.5523 18 12 18C11.4477 18 11 17.5523 11 17V13H7C6.44772 13 6 12.5523 6 12C6 11.4477 6.44772 11 7 11H11V7C11 6.44772 11.4477 6 12 6Z" fill="#53c6ab"/><path fill-rule="evenodd" clip-rule="evenodd" d="M2 4.5C2 3.11929 3.11929 2 4.5 2H19.5C20.8807 2 22 3.11929 22 4.5V19.5C22 20.8807 20.8807 22 19.5 22H4.5C3.11929 22 2 20.8807 2 19.5V4.5ZM4.5 4C4.22386 4 4 4.22386 4 4.5V19.5C4 19.7761 4.22386 20 4.5 20H19.5C19.7761 20 20 19.7761 20 19.5V4.5C20 4.22386 19.7761 4 19.5 4H4.5Z" fill="#53c6ab"/></svg><span class="topbar-label">Add item</span></button>
          <button id="switch-profile" class="ghost" aria-label="Switch profile"><svg class="switch-profile-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path d="M18.7153 1.71609C18.3241 1.32351 18.3241 0.687013 18.7153 0.294434C19.1066 -0.0981448 19.7409 -0.0981448 20.1321 0.294434L22.4038 2.57397L22.417 2.58733C23.1935 3.37241 23.1917 4.64056 22.4116 5.42342L20.1371 7.70575C19.7461 8.09808 19.1122 8.09808 18.7213 7.70575C18.3303 7.31342 18.3303 6.67733 18.7213 6.285L20.0018 5L4.99998 5C4.4477 5 3.99998 5.44772 3.99998 6V13C3.99998 13.5523 3.55227 14 2.99998 14C2.4477 14 1.99998 13.5523 1.99998 13V6C1.99998 4.34315 3.34313 3 4.99998 3H19.9948L18.7153 1.71609Z" fill="#43dfc5"/><path d="M22 11C22 10.4477 21.5523 10 21 10C20.4477 10 20 10.4477 20 11V18C20 18.5523 19.5523 19 19 19L4.00264 19L5.28213 17.7161C5.67335 17.3235 5.67335 16.687 5.28212 16.2944C4.8909 15.9019 4.2566 15.9019 3.86537 16.2944L1.59369 18.574L1.58051 18.5873C0.803938 19.3724 0.805727 20.6406 1.58588 21.4234L3.86035 23.7058C4.25133 24.0981 4.88523 24.0981 5.2762 23.7058C5.66718 23.3134 5.66718 22.6773 5.2762 22.285L3.99563 21L19 21C20.6568 21 22 19.6569 22 18L22 11Z" fill="#43dfc5"/></svg><span class="topbar-label">Switch</span></button>
          <button id="open-profile" class="profile-trigger" aria-label="Open profile">
            ${profileAvatar(photoURL, profileName)}
          </button>
        </div>
      </header>
      ${notificationPanel}
      <main class="page">${expiryBanner}${content}</main>
      ${pageAction}
      <nav class="bottom-nav">
        <div class="bottom-nav-inner">
          ${navLink("/inventory", "Inventory", route)}
          ${navLink("/shopping", "Restock", route, restockCount)}
          ${navLink("/dashboard", "Home", route)}
          ${navLink("/settings", "Settings", route)}
          ${navLink("/about", "About", route)}
        </div>
      </nav>
    </div>
  `;
}


// --- Auth and onboarding screens ---
export function renderOnboardingProfile(user) {
  const email = escapeHtml((user && user.email) || "");

  return `
    <div class="welcome">
      <section class="welcome-card">
        <h1>Complete your profile</h1>
        <p class="muted">Add your name before managing inventory with nORDER. You can also add a profile picture.</p>
        <p class="help">Curious about nORDER? <a href="#/about-welcome" style="color:var(--primary);">Meet the team</a></p>
        <div class="grid">
          <label>
            <span class="help">Email</span>
            <input value="${email}" disabled />
          </label>
          <label>
            <span class="help">Name (required)</span>
            <input id="onboarding-name" type="text" maxlength="50" placeholder="Your name" />
          </label>
          <label>
            <span class="help">Profile picture (optional)</span>
            <input id="onboarding-photo-file" type="file" accept="image/*" />
            <div id="onboarding-photo-preview" class="profile-preview" style="margin-top:8px;">
              ${profileAvatar("", "Profile")}
              <div class="help">Preview updates when you choose an image.</div>
            </div>
          </label>
          <button id="complete-onboarding" class="primary">Save and Continue</button>
          <button type="button" class="ghost" onclick="window.location.href='budget.html'">Open nORDER Budget Tool</button>
          <div id="onboarding-error" class="help danger"></div>
        </div>
      </section>
    </div>
  `;
}

export function renderWelcome() {
  const state = getState();
  const profileValue = escapeHtml(state.prefs.profile_name || "");

  return `
    <div class="welcome">
      <section class="welcome-card">
        <h1>Welcome to nORDER</h1>
        ${brandedLogoBlock("compact")}
        <p class="muted">A simple inventory app for home, business, and every space in between.</p>
        <p class="help">Learn more about the creator and mission on our <a href="#/about-welcome" style="color:var(--primary);">About page</a>.</p>
        <div class="grid">
          <label>
            <span class="help">Your name</span>
            <input id="welcome-name" value="${profileValue}" placeholder="e.g. Alex" maxlength="30" />
          </label>
          <label>
            <span class="help">Inventory space name</span>
            <input id="welcome-home" value="${escapeHtml(state.prefs.home_name)}" maxlength="30" />
          </label>
          <button id="welcome-start" class="primary">Open Inventory Hub</button>
          <button type="button" class="ghost" onclick="window.location.href='budget.html'">Open nORDER Budget Tool</button>
          <button id="welcome-reset" class="ghost">Reset Demo Inventory Data</button>
        </div>
      </section>
    </div>
  `;
}

function computeStats() {
  const state = getState();
  const total = state.items.length;
  const low = state.items.filter((i) => isLowStockLevel(getItemStockLevel(i))).length;
  const restock = state.items.filter((i) => i.in_shopping_list).length;
  const expiring = getExpiryOverview(state.items).alertCount;

  return { total, low, restock, expiring };
}

function getContainerSummary(item) {
  const quantity = getItemQuantity(item);
  const type = String(item && item.container_type ? item.container_type : "").trim().toLowerCase();
  if (!type) return `${quantity} ${quantity === 1 ? "unit" : "units"}`;
  if (quantity === 1) return `${quantity} ${type}`;
  if (type === "box") return `${quantity} boxes`;
  return `${quantity} ${type}s`;
}

function getUnitLevelSummary(item) {
  const quantity = getItemQuantity(item);
  if (quantity <= 1) return "";

  const counts = summarizeUnitStockLevels(getItemUnitStockLevels(item));
  const parts = [];
  if (counts.Full) parts.push(`${counts.Full} full`);
  if (counts["Almost Half"]) parts.push(`${counts["Almost Half"]} half full`);
  if (counts.Half) parts.push(`${counts.Half} half`);
  if (counts["Almost Empty"]) parts.push(`${counts["Almost Empty"]} half empty`);
  if (counts.Empty) parts.push(`${counts.Empty} empty`);
  return parts.join(" | ");
}

function normalizeWearLevel(level) {
  const normalized = String(level || "").trim();
  if (normalized === "Severe") return "Replace";
  if (normalized === "BrandNew") return "Brand New";
  return WEAR_LEVELS.includes(normalized) ? normalized : "Moderate";
}

function getWearLevelForPercentage(percentage) {
  const normalizedPercentage = Math.max(0, Math.min(100, Math.round(Number(percentage) || 0)));
  if (normalizedPercentage <= 10) return "Brand New";
  if (normalizedPercentage <= 35) return "Light";
  if (normalizedPercentage <= 50) return "Moderate";
  if (normalizedPercentage <= 75) return "Heavy";
  return "Replace";
}

function getWearAndTearDetails(item) {
  const enabled = Boolean(item && item.wear_and_tear_enabled);
  let level = normalizeWearLevel(item && item.wear_level);
  const percent = Number(item && item.wear_percentage);
  let percentage = Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : WEAR_LEVEL_TO_PERCENT[level];

  const unitWearLevels = Array.isArray(item && item.wear_unit_levels)
    ? item.wear_unit_levels.map((entry) => normalizeWearLevel(entry))
    : [];
  if (enabled && unitWearLevels.length > 1) {
    const allBrandNew = unitWearLevels.every((entry) => entry === "Brand New");
    if (allBrandNew) {
      level = "Brand New";
      percentage = 0;
    } else {
      const avgPercentage = Math.round(
        unitWearLevels.reduce((sum, entry) => sum + (WEAR_LEVEL_TO_PERCENT[entry] || 0), 0) / unitWearLevels.length
      );
      percentage = Math.max(0, Math.min(100, avgPercentage));
      level = getWearLevelForPercentage(percentage);
    }
  }

  return {
    enabled,
    level,
    percentage,
  };
}

export function renderDashboard() {
  const state = getState();
  const stats = computeStats();
  const expiryOverview = getExpiryOverview(state.items);
  const trackedTotal = Math.max(stats.total, 1);
  const restockPercent = Math.min(100, Math.round((stats.restock / trackedTotal) * 100));
  const lowPercent = Math.min(100, Math.round((stats.low / trackedTotal) * 100));
  const expiringPercent = Math.min(100, Math.round((stats.expiring / trackedTotal) * 100));
  const attentionScore = Math.min(
    100,
    Math.round(((stats.restock * 1.05 + stats.low * 1.3 + stats.expiring * 1.15) / (trackedTotal * 2.3)) * 100)
  );
  const attentionState = expiryOverview.counts.expired ? "critical" : attentionScore >= 67 ? "critical" : attentionScore >= 34 ? "watch" : "calm";
  const lowGlow = Math.min(36, 8 + Math.round((stats.low / trackedTotal) * 36));
  const restockRoute = "/shopping";
  const lowRoute = "/inventory?q=&cat=all&wear=all&sort=stock-low";
  const expiringRoute = "/inventory?q=&cat=all&wear=all&sort=expiry";
  const totalRoute = "/inventory?q=&cat=all&wear=all&sort=name-asc";
  const trendPoints = [
    { id: "restock", label: "Restock", value: restockPercent, count: stats.restock, x: 8, route: restockRoute },
    { id: "low", label: "Low", value: lowPercent, count: stats.low, x: 50, route: lowRoute },
    { id: "expiring", label: "Expiring", value: expiringPercent, count: stats.expiring, x: 92, route: expiringRoute },
  ];
  const trendCoordinates = trendPoints.map((point) => ({
    ...point,
    y: Math.max(8, 92 - Math.round(point.value * 0.72)),
  }));
  const trendPath =
    trendCoordinates.length >= 3
      ? `M ${trendCoordinates[0].x} ${trendCoordinates[0].y} Q ${Math.round((trendCoordinates[0].x + trendCoordinates[1].x) / 2)} ${trendCoordinates[0].y} ${trendCoordinates[1].x} ${trendCoordinates[1].y} Q ${Math.round((trendCoordinates[1].x + trendCoordinates[2].x) / 2)} ${trendCoordinates[2].y} ${trendCoordinates[2].x} ${trendCoordinates[2].y}`
      : trendCoordinates.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const lowItems = state.items.filter((i) => isLowStockLevel(getItemStockLevel(i))).slice(0, 5);

  return shellLayout(
    `
    <section class="inventory-dashboard-hero" aria-label="Inventory overview header">
      <h1 class="inventory-dashboard-title">${escapeHtml(state.prefs.home_name)}</h1>
      <p class="inventory-dashboard-subtitle">Track stock levels for home, business, or any operation.</p>
    </section>

    <section class="section-card inventory-pulse-card inventory-pulse-${attentionState}" style="margin-top:10px;--low-glow:${lowGlow}%;">
      <div class="inventory-pulse-head">
        <div>
          <p class="inventory-pulse-kicker">Inventory Pulse</p>
          <h2 class="inventory-pulse-title">Quick look at your inventory</h2>
        </div>
      </div>

      <div class="inventory-pulse-layout">
        <a class="inventory-pulse-core" href="#${totalRoute}" style="--attention:${attentionScore}%" aria-label="Open all tracked items in inventory">
          <div class="inventory-pulse-core-inner">
            <span class="inventory-pulse-core-value">${stats.total}</span>
            <span class="inventory-pulse-core-label">Items Tracked</span>
          </div>
        </a>

        <div class="inventory-pulse-graph" role="img" aria-label="Restock ${stats.restock}, low stock ${stats.low}, expiring soon ${stats.expiring} out of ${stats.total} total items">
          <a class="inventory-pulse-row" href="#${restockRoute}" aria-label="Open restock list with ${stats.restock} items">
            <div class="inventory-pulse-row-label">Restock List</div>
            <div class="inventory-pulse-row-value">${stats.restock}</div>
            <div class="inventory-pulse-track"><span class="inventory-pulse-fill restock" style="width:${restockPercent}%;"></span></div>
          </a>
          <a class="inventory-pulse-row" href="#${lowRoute}" aria-label="Open inventory sorted by lowest stock, currently ${stats.low} low-stock items">
            <div class="inventory-pulse-row-label">Low Stock</div>
            <div class="inventory-pulse-row-value warning">${stats.low}</div>
            <div class="inventory-pulse-track"><span class="inventory-pulse-fill low" style="width:${lowPercent}%;"></span></div>
          </a>
          <a class="inventory-pulse-row" href="#${expiringRoute}" aria-label="Open inventory sorted by nearest expiry, currently ${stats.expiring} expiring soon items">
            <div class="inventory-pulse-row-label">Expiry Alerts</div>
            <div class="inventory-pulse-row-value ${stats.expiring ? "warning" : ""}">${stats.expiring}</div>
            <div class="inventory-pulse-track"><span class="inventory-pulse-fill expiring" style="width:${expiringPercent}%;"></span></div>
          </a>
        </div>
      </div>

      <div class="inventory-pulse-curve-wrap" aria-hidden="true">
        <svg class="inventory-pulse-curve" viewBox="0 0 100 100" preserveAspectRatio="none" role="presentation">
          <defs>
            <linearGradient id="inventoryPulseCurve" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stop-color="#44bc9f" />
              <stop offset="55%" stop-color="#f0be68" />
              <stop offset="100%" stop-color="#ed8f5d" />
            </linearGradient>
          </defs>
          <path class="inventory-pulse-curve-area" d="${trendPath} L 92 100 L 8 100 Z"></path>
          ${trendCoordinates
            .map(
              (point) => `
            <ellipse class="inventory-pulse-point ${point.id}" cx="${point.x}" cy="${point.y}" rx="2" ry="2.4"></ellipse>
          `
            )
            .join("")}
          <path class="inventory-pulse-curve-line" d="${trendPath}"></path>
        </svg>
        <div class="inventory-pulse-point-labels">
          ${trendCoordinates
            .map(
              (point) => `
            <a class="inventory-pulse-point-label ${point.id}" href="#${escapeAttr(point.route)}">${escapeHtml(point.label)}: ${point.count}</a>
          `
            )
            .join("")}
        </div>
      </div>
    </section>

    <section class="section-card" style="margin-top:10px;">
      <h2>Needs Refill</h2>
      <div class="list">
        ${
          lowItems.length
            ? lowItems
                .map(
                  (item) => `
                  <div class="row space">
                    <div>
                      <div class="item-name">${escapeHtml(item.name)}</div>
                      <div class="help">${escapeHtml(item.category)}</div>
                    </div>
                    <button data-action="add-to-shop" data-id="${item.id}">Add to Restock</button>
                  </div>
                `
                )
                .join("")
            : `<p class="help">No low-stock inventory items right now.</p>`
        }
      </div>
    </section>
  `,
    "/dashboard"
  );
}

export function renderInventory() {
  const state = getState();
  const params = getHashParams();
  const query = (params.get("q") || "").toLowerCase();
  const filter = (params.get("cat") || "all").toLowerCase();
  const wearFilter = (params.get("wear") || "all").toLowerCase();
  const sort = (params.get("sort") || "name-asc").toLowerCase();
  const expiryOverview = getExpiryOverview(state.items);

  const compareInventoryItems = (a, b, sortMode) => {
    const nameA = String((a && a.name) || "").toLowerCase();
    const nameB = String((b && b.name) || "").toLowerCase();
    const categoryA = String((a && a.category) || "").toLowerCase();
    const categoryB = String((b && b.category) || "").toLowerCase();
    const stockA = getItemStockPercentage(a);
    const stockB = getItemStockPercentage(b);
    const updatedA = Number((a && a.updated_date) || 0);
    const updatedB = Number((b && b.updated_date) || 0);
    const expiryA = getExpiryTimestamp(a && a.expiry_date);
    const expiryB = getExpiryTimestamp(b && b.expiry_date);
    const wearA = getWearAndTearDetails(a);
    const wearB = getWearAndTearDetails(b);
    const wearPercentageA = wearA.enabled ? wearA.percentage : -1;
    const wearPercentageB = wearB.enabled ? wearB.percentage : -1;

    if (sortMode === "name-desc") return nameB.localeCompare(nameA);
    if (sortMode === "category") {
      const byCategory = categoryA.localeCompare(categoryB);
      return byCategory || nameA.localeCompare(nameB);
    }
    if (sortMode === "stock-low") {
      const byStock = stockA - stockB;
      return byStock || nameA.localeCompare(nameB);
    }
    if (sortMode === "stock-high") {
      const byStock = stockB - stockA;
      return byStock || nameA.localeCompare(nameB);
    }
    if (sortMode === "recent") {
      const byUpdated = updatedB - updatedA;
      return byUpdated || nameA.localeCompare(nameB);
    }
    if (sortMode === "expiry") {
      const byExpiry = expiryA - expiryB;
      return byExpiry || nameA.localeCompare(nameB);
    }
    if (sortMode === "wear-high") {
      const byWear = wearPercentageB - wearPercentageA;
      return byWear || nameA.localeCompare(nameB);
    }
    if (sortMode === "wear-low") {
      const byWear = wearPercentageA - wearPercentageB;
      return byWear || nameA.localeCompare(nameB);
    }
    return nameA.localeCompare(nameB);
  };

  const sortedItems = [...state.items].sort((a, b) => compareInventoryItems(a, b, sort));

  const filtered = sortedItems.filter((item) => {
    const byText = !query || item.name.toLowerCase().includes(query);
    const byCat = filter === "all" || item.category.toLowerCase() === filter;
    const wear = getWearAndTearDetails(item);
    const wearLevelValue = wear.level.toLowerCase().replace(/\s+/g, "-");
    const byWear =
      wearFilter === "all" ||
      (wearFilter === "brand-new" && wear.enabled && wearLevelValue === "brand-new") ||
      (wearFilter === "tracked" && wear.enabled) ||
      (wearFilter === "none" && !wear.enabled) ||
      (wear.enabled && wearLevelValue === wearFilter);
    return byText && byCat && byWear;
  });

  return shellLayout(
    `
    <section class="section-card">
      <div class="row inventory-title-row" style="margin-bottom:8px;">
        <h1>Inventory<br class="inv-title-break"> Workspace</h1>
        <button id="check-inventory-btn" class="inv-check-trigger" aria-label="Check all inventory items" title="Check Inventory">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path fill-rule="evenodd" clip-rule="evenodd" d="M2 4.5C2 3.11929 3.11929 2 4.5 2H19.5C20.8807 2 22 3.11929 22 4.5V19.5C22 20.8807 20.8807 22 19.5 22H4.5C3.11929 22 2 20.8807 2 19.5V4.5ZM4.5 4C4.22386 4 4 4.22386 4 4.5V19.5C4 19.7761 4.22386 20 4.5 20H19.5C19.7761 20 20 19.7761 20 19.5V4.5C20 4.22386 19.7761 4 19.5 4H4.5Z" fill="currentColor"/></svg>
          Check Inventory
        </button>
        <button id="toggle-item-form" aria-label="Add new item" title="Add New"><svg class="quick-add-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path d="M12 6C12.5523 6 13 6.44772 13 7V11H17C17.5523 11 18 11.4477 18 12C18 12.5523 17.5523 13 17 13H13V17C13 17.5523 12.5523 18 12 18C11.4477 18 11 17.5523 11 17V13H7C6.44772 13 6 12.5523 6 12C6 11.4477 6.44772 11 7 11H11V7C11 6.44772 11.4477 6 12 6Z" fill="#53c6ab"/><path fill-rule="evenodd" clip-rule="evenodd" d="M2 4.5C2 3.11929 3.11929 2 4.5 2H19.5C20.8807 2 22 3.11929 22 4.5V19.5C22 20.8807 20.8807 22 19.5 22H4.5C3.11929 22 2 20.8807 2 19.5V4.5ZM4.5 4C4.22386 4 4 4.22386 4 4.5V19.5C4 19.7761 4.22386 20 4.5 20H19.5C19.7761 20 20 19.7761 20 19.5V4.5C20 4.22386 19.7761 4 19.5 4H4.5Z" fill="#53c6ab"/></svg></button>
      </div>

      <div class="toolbar">
        <input id="search-input" placeholder="Search inventory items" value="${escapeHtml(query)}" />
        <select id="category-filter">
          <option value="all">All</option>
          ${state.categories
            .map(
              (c) =>
                `<option value="${escapeAttr(c.name.toLowerCase())}" ${
                  filter === c.name.toLowerCase() ? "selected" : ""
                }>${escapeHtml(c.name)}</option>`
            )
            .join("")}
        </select>
        <select id="wear-filter">
          <option value="all" ${wearFilter === "all" ? "selected" : ""}>Wear: All</option>
          <option value="brand-new" ${wearFilter === "brand-new" ? "selected" : ""}>Wear: Brand New</option>
          <option value="tracked" ${wearFilter === "tracked" ? "selected" : ""}>Wear: Tracked Only</option>
          <option value="none" ${wearFilter === "none" ? "selected" : ""}>Wear: Not Tracked</option>
          ${WEAR_LEVELS.map(
            (level) =>
              `<option value="${escapeAttr(level.toLowerCase().replace(/\s+/g, "-"))}" ${wearFilter === level.toLowerCase().replace(/\s+/g, "-") ? "selected" : ""}>Wear: ${escapeHtml(level)}</option>`
          ).join("")}
        </select>
        <select id="sort-filter">
          <option value="name-asc" ${sort === "name-asc" ? "selected" : ""}>Sort: Name (A-Z)</option>
          <option value="name-desc" ${sort === "name-desc" ? "selected" : ""}>Sort: Name (Z-A)</option>
          <option value="category" ${sort === "category" ? "selected" : ""}>Sort: Category</option>
          <option value="stock-low" ${sort === "stock-low" ? "selected" : ""}>Sort: Stock (Low to High)</option>
          <option value="stock-high" ${sort === "stock-high" ? "selected" : ""}>Sort: Stock (High to Low)</option>
          <option value="wear-high" ${sort === "wear-high" ? "selected" : ""}>Sort: Wear (Highest First)</option>
          <option value="wear-low" ${sort === "wear-low" ? "selected" : ""}>Sort: Wear (Lowest First)</option>
          <option value="recent" ${sort === "recent" ? "selected" : ""}>Sort: Recently Updated</option>
          <option value="expiry" ${sort === "expiry" ? "selected" : ""}>Sort: Expiry (Soonest)</option>
        </select>
      </div>
          <p id="inventory-filtering" class="inventory-filtering" aria-live="polite">Filtering...</p>

      <div id="item-form" class="add-item-overlay" role="dialog" aria-modal="true" aria-labelledby="add-item-modal-title">
        <div class="inv-check-sheet add-item-sheet">
          <div class="inv-check-header">
            <div class="inv-check-header-left">
              <span class="inv-check-kicker">Inventory</span>
              <h2 class="inv-check-title" id="add-item-modal-title">Add New Item</h2>
            </div>
            <button class="icon-btn" data-role="add-item-close" aria-label="Close" title="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
            </button>
          </div>
          <div class="inv-check-body add-item-body">
            <div class="inv-check-fields">
              <label class="field" for="item-name">
                <span class="field-label">Item name</span>
                <input id="item-name" placeholder="e.g. Coffee Beans or Printer Paper" maxlength="50" />
              </label>
              <div class="inv-check-fields-row">
                <label class="field" for="item-brand">
                  <span class="field-label">Brand (optional)</span>
                  <input id="item-brand" placeholder="e.g. Lavazza or HP" maxlength="50" />
                </label>
                <label class="field" for="item-category">
                  <span class="field-label">Category</span>
                  <select id="item-category">
                    ${state.categories.map((c) => `<option>${escapeHtml(c.name)}</option>`).join("")}
                  </select>
                </label>
              </div>
              <label class="field" for="item-stock-level">
                <span class="field-label">Stock level</span>
                <select id="item-stock-level" aria-describedby="item-stock-level-note">
                  ${STOCK_LEVELS.map((level) => `<option>${escapeHtml(level)}</option>`).join("")}
                </select>
                <span id="item-stock-level-note" class="help" style="display:none;margin-top:4px;">Disabled because stock is controlled elsewhere for this item.</span>
              </label>
              <div class="inv-check-fields-row">
                <label class="field" for="item-container-type">
                  <span class="field-label">Container (optional)</span>
                  <select id="item-container-type">
                    <option value="">None</option>
                    <option>Bottle</option>
                    <option>Can</option>
                    <option>Bag</option>
                    <option>Box</option>
                  </select>
                </label>
                <label class="field" for="item-quantity">
                  <span class="field-label">Quantity</span>
                  <input id="item-quantity" type="number" min="1" max="24" value="1" />
                </label>
              </div>
              <label class="field" for="item-enable-wear-and-tear">
                <span class="field-label">Wear and tear (optional)</span>
                <label class="row" style="gap:8px;align-items:center;justify-content:flex-start;margin:0;">
                  <input id="item-enable-wear-and-tear" type="checkbox" style="width:auto;" />
                  <span class="help" style="margin:0;">This item needs wear-and-tear tracking</span>
                </label>
              </label>
              <label id="item-wear-and-tear-config" class="field" for="item-wear-and-tear-level" style="display:none;">
                <span class="field-label">Wear level</span>
                <select id="item-wear-and-tear-level">
                  ${WEAR_LEVELS.map((level) => `<option>${escapeHtml(level)}</option>`).join("")}
                </select>
              </label>
              <div id="item-unit-wear-levels" class="unit-level-wrap"></div>
              <div id="item-unit-stock-levels" class="unit-level-wrap"></div>
              <label class="field" for="item-expiry">
                <span class="field-label">Expiry date</span>
                <input id="item-expiry" type="date" />
              </label>
            </div>
          </div>
          <div class="inv-check-nav">
            <button class="ghost" data-role="add-item-cancel">Cancel</button>
            <button id="save-item" class="primary">Save Item</button>
          </div>
        </div>
      </div>

      <div id="inventory-list" class="list" style="margin-top:10px;">
        ${
          (() => {
            const catColorMap = {};
            state.categories.forEach((c) => { catColorMap[c.name] = c.color || ""; });
            return sortedItems.length
              ? sortedItems
                .map(
                    (item) => {
                      const catColor = catColorMap[item.category] || "";
                      const stockLevel = getItemStockLevel(item);
                      const stockPercent = getItemStockPercentage(item);
                      const updatedDate = Number(item && item.updated_date ? item.updated_date : 0);
                      const expiry = getExpiryDetails(item);
                      const expiryTs = expiry.timestamp;
                      const wear = getWearAndTearDetails(item);
                      const isReplaceWorthy = wear.enabled && (wear.level === "Replace" || wear.percentage >= 100);
                      const isBrandNew = wear.enabled && wear.level === "Brand New";
                      const wearFillPercent = isBrandNew ? 0 : wear.percentage;
                      const wearLevelValue = wear.level.toLowerCase().replace(/\s+/g, "-");
                      const itemBrand = String(item && item.brand_name ? item.brand_name : "").toLowerCase();
                      const byText = !query || item.name.toLowerCase().includes(query) || itemBrand.includes(query);
                      const byCat = filter === "all" || item.category.toLowerCase() === filter;
                      const byWear =
                        wearFilter === "all" ||
                        (wearFilter === "brand-new" && wear.enabled && wearLevelValue === "brand-new") ||
                        (wearFilter === "tracked" && wear.enabled) ||
                        (wearFilter === "none" && !wear.enabled) ||
                        (wear.enabled && wearLevelValue === wearFilter);
                      const isVisible = byText && byCat && byWear;
                      const itemClasses = [
                        "item",
                        isReplaceWorthy ? "replace-needed" : "",
                        isBrandNew ? "brand-new" : "",
                        expiry.highlighted ? `expiry-${expiry.status}` : "",
                      ]
                        .filter(Boolean)
                        .join(" ");
                      return `
                  <article
                    class="${itemClasses}"
                    data-role="inventory-item"
                    data-name="${escapeAttr(item.name.toLowerCase())}"
                    data-brand="${escapeAttr(itemBrand)}"
                    data-category="${escapeAttr(item.category.toLowerCase())}"
                    data-stock="${stockPercent}"
                    data-updated="${updatedDate}"
                    data-expiry="${Number.isFinite(expiryTs) ? expiryTs : Number.MAX_SAFE_INTEGER}"
                    data-wear-enabled="${wear.enabled ? "1" : "0"}"
                    data-wear="${wear.enabled ? wear.percentage : -1}"
                    data-wear-level="${wear.enabled ? escapeAttr(wearLevelValue) : "none"}"
                    style="${catColor ? `--cat-color:${catColor};border-left:4px solid ${catColor};` : ""}${isVisible ? "" : "display:none;"}"
                  >
                    <div class="item-header">
                      <div>
                        <div class="item-name">${escapeHtml(item.name)}</div>
                        <div class="row">
                            ${item.brand_name ? `<div class="help">${escapeHtml(item.brand_name)}</div>` : ""}
                            <span class="badge">${escapeHtml(item.category)}</span>
                          <span class="badge">${escapeHtml(getContainerSummary(item))}</span>
                          ${expiry.highlighted ? `<span class="expiry-badge ${expiry.status}">${escapeHtml(expiry.badge)}</span>` : ""}
                          <span class="help item-expiry-copy ${expiry.highlighted ? expiry.status : ""}">${
                            item.expiry_date
                              ? `Expiry: ${escapeHtml(item.expiry_date)}${expiry.highlighted ? ` • ${escapeHtml(expiry.detail)}` : ""}`
                              : "No expiry set"
                          }</span>
                        </div>
                      </div>
                      <div class="row">
                        <button data-action="edit-item" data-id="${item.id}">Edit</button>
                        <button data-action="delete-item" class="danger" data-id="${item.id}">Delete</button>
                      </div>
                    </div>
                    ${expiry.highlighted ? `<div class="item-expiry-alert ${expiry.status}">${escapeHtml(expiry.detail)}</div>` : ""}
                    ${wear.enabled ? "" : `<div class="progress"><span style="width:${getItemStockPercentage(item)}%"></span></div>`}
                    ${
                      wear.enabled
                        ? `<div class="wear-progress-wrap">
                             <span class="help wear-progress-label ${isReplaceWorthy ? "replace" : isBrandNew ? "new" : ""}">Wear and tear</span>
                             ${isReplaceWorthy ? `<span class="wear-replace-flag">Replace now</span>` : isBrandNew ? `<span class="wear-brand-new-flag">Brand new</span>` : ""}
                             <div class="wear-progress" aria-label="Wear and tear progress">
                               <span style="width:${wearFillPercent}%"></span>
                             </div>
                           </div>`
                        : ""
                    }
                    <div class="row space">
                      <span class="help">${
                        wear.enabled
                          ? `Wear status: ${escapeHtml(wear.level)}`
                          : `Stock status: ${escapeHtml(stockLevel)}${
                              getItemQuantity(item) > 1 ? ` (${escapeHtml(getUnitLevelSummary(item))})` : ""
                            }`
                      }</span>
                      <button data-action="toggle-shopping" data-id="${item.id}">
                        ${item.in_shopping_list ? "Remove from Restock" : "Add to Restock"}
                      </button>
                    </div>
                  </article>
                `;
                  }
                )
                .join("")
            : "";
  })()}
        <p id="inventory-no-matches" class="help" ${filtered.length ? 'style="display:none;"' : ""}>No matching inventory items.</p>
      </div>
    </section>
  `,
    "/inventory"
  );
}

export function renderShopping() {
  const state = getState();
  const items = state.items.filter((i) => i.in_shopping_list);

  return shellLayout(
    `
    <section class="section-card">
      <div class="row space" style="margin-bottom:8px;">
        <h1>Restock List</h1>
        <button id="restock-selected" class="primary">Mark Checked as Restocked</button>
      </div>
      <p class="muted">Track what needs to be replenished for any inventory space.</p>

      <div class="list" style="margin-top:10px;">
        ${
          items.length
            ? items
                .map(
                  (item) => {
                    const wear = getWearAndTearDetails(item);
                    const status = wear.enabled ? `Wear level: ${wear.level}` : `Stock level: ${getItemStockLevel(item)}`;
                    return `
                  <article class="item row space">
                    <label class="row" style="flex:1;">
                      <input type="checkbox" data-role="buy-check" data-id="${item.id}" style="width:auto;" />
                      <span>
                        <strong>${escapeHtml(item.name)}</strong>
                          <span class="help"> ${escapeHtml(item.category)} | ${escapeHtml(status)}</span>
                      </span>
                    </label>
                    <button data-action="remove-shopping" data-id="${item.id}">Remove</button>
                  </article>
                `;
                  }
                )
                .join("")
            : `<p class="help">Restock list is empty.</p>`
        }
      </div>
    </section>
  `,
    "/shopping"
  );
}

export function renderSettings() {
  const state = getState();
  return shellLayout(
    `
    <div class="row space" style="margin-bottom:10px;">
      <h1 style="margin:0;">Settings</h1>
      <span id="sync-indicator" class="sync-indicator" data-state="idle">Sync idle</span>
    </div>
    <section class="section-card" style="margin-top:10px;">
      <h2 style="margin:0 0 8px 0;">Inventory Preferences</h2>
      <p class="help">These settings apply only to the currently selected inventory space.</p>
      <div class="grid" style="margin-top:8px;">
        <label>
          <span class="help">Inventory space name</span>
          <input id="prefs-home" value="${escapeHtml(state.prefs.home_name)}" maxlength="30" />
        </label>
        <section class="section-card" style="padding:10px;">
          <h2 style="margin:0 0 8px 0;">Notification Preferences</h2>
          <p class="help" style="margin-bottom:8px;">Choose which inventory signals should appear in your alert center.</p>
          <div class="grid">
            <label class="row" style="gap:8px;justify-content:flex-start;">
              <input id="prefs-notify-expiry-enabled" type="checkbox" style="width:auto;" ${
                state.prefs.notification_expiry_enabled !== false ? "checked" : ""
              } />
              <span class="help" style="margin:0;">Expiry alerts</span>
            </label>
            <label>
              <span class="help">Expiry "soon" window (days)</span>
              <input id="prefs-notify-expiry-soon-days" type="number" min="1" max="60" step="1" value="${Number(
                state.prefs.notification_expiry_soon_days || 7
              )}" />
            </label>
            <label class="row" style="gap:8px;justify-content:flex-start;">
              <input id="prefs-notify-stock-enabled" type="checkbox" style="width:auto;" ${
                state.prefs.notification_stock_enabled !== false ? "checked" : ""
              } />
              <span class="help" style="margin:0;">Low stock alerts</span>
            </label>
            <label class="row" style="gap:8px;justify-content:flex-start;">
              <input id="prefs-notify-wear-enabled" type="checkbox" style="width:auto;" ${
                state.prefs.notification_wear_enabled !== false ? "checked" : ""
              } />
              <span class="help" style="margin:0;">Wear replacement alerts</span>
            </label>
            <label class="row" style="gap:8px;justify-content:flex-start;">
              <input id="prefs-notify-restock-enabled" type="checkbox" style="width:auto;" ${
                state.prefs.notification_restock_enabled !== false ? "checked" : ""
              } />
              <span class="help" style="margin:0;">Restock queue summary alerts</span>
            </label>
          </div>
        </section>
        <button id="save-prefs" class="primary">Save Inventory Preferences</button>
      </div>
    </section>

    <section class="section-card" style="margin-top:10px;">
      <div class="row space" style="margin-bottom:8px;">
        <h2 style="margin:0;">Categories</h2>
        <button id="add-category">Add Category</button>
      </div>
      <div id="category-add-panel" class="row category-inline-editor" style="display:none; margin-bottom:8px;">
        <input id="category-add-name" data-role="category-add-name-input" maxlength="30" placeholder="Category name" aria-label="Category name" />
        <input id="category-add-icon" data-role="category-add-icon-input" class="category-icon-input" maxlength="2" placeholder="IC" aria-label="Category icon" />
        <input id="category-add-color" data-role="category-add-color-input" type="color" class="category-color-input" value="#6366f1" aria-label="Category color" title="Category color" />
        <button id="save-category-add" data-action="save-category-add" class="primary">Save</button>
        <button id="cancel-category-add" data-action="cancel-category-add">Cancel</button>
      </div>
      <div class="list">
        ${
          state.categories.length
            ? state.categories
                .map(
                  (c) => {
                    const catColor = c.color || "#6366f1";
                    return `
                  <div class="row space category-row" data-role="category-row" data-id="${c.id}">
                    <div data-role="category-display" class="row" style="gap:8px;align-items:center;">
                      <span class="category-color-swatch" style="background:${escapeAttr(catColor)};" aria-hidden="true"></span>
                      <strong>${escapeHtml(c.name)}</strong> <span class="help">${escapeHtml(c.icon)}</span>
                    </div>
                    <div class="row" data-role="category-actions-display">
                      <button data-action="start-edit-category" data-id="${c.id}">Edit</button>
                      <button data-action="delete-category" data-id="${c.id}" class="danger">Delete</button>
                    </div>
                    <div class="row category-inline-editor" data-role="category-edit" style="display:none;">
                      <input
                        data-role="category-name-input"
                        data-original-name="${escapeAttr(c.name)}"
                        value="${escapeAttr(c.name)}"
                        maxlength="30"
                        aria-label="Edit category name"
                      />
                      <input
                        data-role="category-color-input"
                        type="color"
                        class="category-color-input"
                        value="${escapeAttr(catColor)}"
                        data-original-color="${escapeAttr(catColor)}"
                        aria-label="Edit category color"
                        title="Category color"
                      />
                      <button data-action="save-category-edit" data-id="${c.id}" class="primary">Save</button>
                      <button data-action="cancel-category-edit" data-id="${c.id}">Cancel</button>
                    </div>
                  </div>
                `;
                  }
                )
                .join("")
            : `<p class="help">No categories yet.</p>`
        }
      </div>
    </section>

    <section class="section-card" style="margin-top:10px;">
      <h2 style="margin:0 0 8px 0;">Collaboration</h2>
      <div class="collaboration-actions">
        <button id="view-collaboration-settings" class="primary">Manage Team Access</button>
        <button id="view-activity-log">View Change History</button>
      </div>
    </section>

  `,
    "/settings"
  );
}

function formatActivityTime(timestamp) {
  if (!timestamp) return "Unknown time";
  const date = new Date(Number(timestamp));
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function renderActivityLog(logs) {
  const entries = Array.isArray(logs) ? logs : [];

  return shellLayout(
    `
    <section class="section-card activity-header">
      <div class="row space" style="margin-bottom:6px;">
        <h1>Accountability</h1>
        <button onclick="window.location.hash='#/settings'">Back to Settings</button>
      </div>
      <p class="muted">Track who changed inventory data and when each update happened.</p>
    </section>

    <section class="section-card" style="margin-top:10px;">
      <div class="activity-timeline">
        ${
          entries.length
            ? entries
                .map(
                  (entry) => `
                  <article class="activity-item">
                    <div class="activity-meta">
                      <span class="activity-user">${escapeHtml(entry.actor_name || "Unknown member")}</span>
                      <span class="activity-time">${escapeHtml(formatActivityTime(entry.timestamp))}</span>
                    </div>
                    <div class="activity-summary">${escapeHtml(entry.summary || "Inventory record updated")}</div>
                    <div class="activity-action">${escapeHtml((entry.action || "update").replace(/_/g, " "))}</div>
                  </article>
                `
                )
                .join("")
            : `<p class="help">No change history yet. Activity will appear here as people update inventory records.</p>`
        }
      </div>
    </section>
  `,
    "/activity"
  );
}

export function renderLogin() {
  const recentAccounts = getRecentAccounts();
  const hasRecentAccounts = recentAccounts.length > 0;
  const firstName = hasRecentAccounts
    ? escapeHtml((recentAccounts[0].name || "").split(" ")[0] || "")
    : "";

  return `
    <div class="landing-wrap">

      <!-- ── Hero column ── -->
      <div class="landing-hero" aria-label="nORDER inventory platform">
        <div class="landing-orb landing-orb-a" aria-hidden="true"></div>
        <div class="landing-orb landing-orb-b" aria-hidden="true"></div>
        <div class="landing-orb landing-orb-c" aria-hidden="true"></div>

        <div class="landing-hero-inner">
          <img class="landing-logo" src="nORDER%20LOGO.png" alt="nORDER logo" loading="eager" />

          <div class="landing-text-block">
            <h1 class="landing-headline">Keep every space <span class="brand-n">n</span>ORDER</h1>
            <p class="landing-tagline">Smart inventory tracking for home, business, and every space in between.</p>
          </div>

          <ul class="landing-features" aria-label="Key features">
            <li class="landing-feature">
              <span class="landing-feature-icon" aria-hidden="true">📦</span>
              <div>
                <strong>Track Everything</strong>
                <span class="help">Items, stock levels, expiry &amp; more.</span>
              </div>
            </li>
            <li class="landing-feature">
              <span class="landing-feature-icon" aria-hidden="true">🔔</span>
              <div>
                <strong>Low-stock Alerts</strong>
                <span class="help">See what needs restocking before it runs out.</span>
              </div>
            </li>
            <li class="landing-feature">
              <span class="landing-feature-icon" aria-hidden="true">🤝</span>
              <div>
                <strong>Shared Spaces</strong>
                <span class="help">Collaborate with your household or team.</span>
              </div>
            </li>
            <li class="landing-feature">
              <span class="landing-feature-icon" aria-hidden="true">🛒</span>
              <div>
                <strong>No Double Buys</strong>
                <span class="help">Check your inventory while shopping so you never buy the same item twice.</span>
              </div>
            </li>
          </ul>

          <div class="landing-hero-footer">
            <a href="#/about-welcome" class="landing-hero-link">About nORDER</a>
            <span style="color:rgba(238,249,246,0.22);font-size:0.75rem;" aria-hidden="true">·</span>
            <a href="#/terms-welcome" class="landing-hero-link">Terms &amp; Conditions</a>
          </div>

          <div class="landing-mobile-scroll-cue" aria-hidden="true">
            <span class="landing-mobile-scroll-text">Scroll down to sign in</span>
            <span class="landing-mobile-scroll-arrow"></span>
          </div>
        </div>
      </div>

      <!-- ── Auth column ── -->
      <div class="landing-auth" id="landing-auth-start">
        <section class="welcome-card landing-auth-card">

          ${hasRecentAccounts && firstName ? `
            <div class="landing-welcome-back-bar" aria-live="polite">
              <span class="landing-welcome-back-dot" aria-hidden="true"></span>
              <span class="landing-welcome-back-text">Welcome back, ${firstName}!</span>
            </div>
          ` : `
            <div>
              <h1 style="margin:0 0 4px;"><span class="brand-n">n</span>ORDER</h1>
              <p class="muted" style="margin:0;">Inventory management from home to business and beyond</p>
            </div>
          `}

          ${hasRecentAccounts ? `
            <div class="recent-logins">
              <h2 style="margin:0 0 2px;">Quick Access</h2>
              <div class="recent-login-list">
                ${recentAccounts
                  .map(
                    (account) => `
                  <div class="recent-login-card">
                    <button
                      type="button"
                      class="recent-login-select"
                      data-action="quick-login-profile"
                      data-email="${escapeAttr(account.email || "")}">
                      ${profileAvatar(account.photoURL, account.name)}
                      <span class="recent-login-text">
                        <strong>${escapeHtml(account.name || account.email || "User")}</strong>
                        <span class="help">${escapeHtml(account.email || "")}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      class="ghost recent-login-remove"
                      data-action="quick-login-remove"
                      data-email="${escapeAttr(account.email || "")}"
                      aria-label="Remove ${escapeAttr(account.email || "saved account")} from quick access"
                      title="Remove from this device">
                      <span aria-hidden="true">&times;</span>
                    </button>
                  </div>
                `
                  )
                  .join("")}
              </div>
            </div>
          ` : ""}

          <div class="grid">
            <div id="login-form">
              <h2 style="margin:0 0 10px;">${hasRecentAccounts ? "Sign in with a different account" : "Sign In"}</h2>
              <input id="login-email" type="email" placeholder="Email" maxlength="100" />
              <div class="password-input-wrap">
                <input id="login-password" type="password" placeholder="Password" />
                <button
                  type="button"
                  data-action="toggle-password-visibility"
                  data-target="login-password"
                  class="password-toggle">
                  Show
                </button>
              </div>
              <label class="row" style="gap:8px;align-items:center;justify-content:flex-start;margin:2px 0 6px 0;">
                <input id="login-remember" type="checkbox" checked style="width:auto;" />
                <span class="help" style="margin:0;">Remember me on this device</span>
              </label>
              <button id="login-btn" class="primary">Sign In</button>
              <button id="login-reset-password" class="ghost" type="button">Forgot Password?</button>
              <p class="help">
                No account yet?
                <a href="#" id="toggle-signup-btn" style="cursor:pointer;color:var(--primary);">Create one</a>
              </p>
              <div id="login-error" class="help danger"></div>
            </div>

            <div id="signup-form" style="display:none;">
              <h2 style="margin:0 0 10px;">Create Account</h2>
              <input id="signup-name" type="text" placeholder="Your name" maxlength="50" />
              <input id="signup-email" type="email" placeholder="Email" maxlength="100" />
              <div class="password-input-wrap">
                <input id="signup-password" type="password" placeholder="Password" />
                <button
                  type="button"
                  data-action="toggle-password-visibility"
                  data-target="signup-password"
                  class="password-toggle">
                  Show
                </button>
              </div>
              <div class="password-input-wrap">
                <input id="signup-password-confirm" type="password" placeholder="Confirm password" />
                <button
                  type="button"
                  data-action="toggle-password-visibility"
                  data-target="signup-password-confirm"
                  class="password-toggle">
                  Show
                </button>
              </div>
              <button id="signup-btn" class="primary">Create Account</button>
              <p class="help">
                Already have an account?
                <a href="#" id="toggle-login-btn" style="cursor:pointer;color:var(--primary);">Sign in</a>
              </p>
              <div id="signup-error" class="help danger"></div>
            </div>
          </div>

        </section>

        <div class="landing-ph-badge landing-ph-badge--desktop">
          <a href="https://www.producthunt.com/products/norder?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-norder" target="_blank" rel="noopener noreferrer"><img alt="nORDER - Inventory Management from Anywhere | Product Hunt" width="250" height="54" src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1129050&theme=light&t=1776900692227" /></a>
        </div>
        <div class="landing-reddit-link landing-reddit-link--desktop">
          <a href="https://www.reddit.com/r/getnorder/" target="_blank" rel="noopener noreferrer" class="landing-reddit-anchor">
            <img src="https://www.redditstatic.com/desktop2x/img/favicon/android-icon-192x192.png" alt="Reddit" width="20" height="20" />
            <span>follow nORDER</span>
          </a>
        </div>

        <div class="landing-auth-mobile-logo-wrap" aria-hidden="true">
          <img class="landing-auth-mobile-logo" src="nORDER%20LOGO.png" alt="" loading="lazy" />
        </div>

        <div class="landing-ph-badge landing-ph-badge--mobile">
          <a href="https://www.producthunt.com/products/norder?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-norder" target="_blank" rel="noopener noreferrer"><img alt="nORDER - Inventory Management from Anywhere | Product Hunt" width="250" height="54" src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1129050&theme=light&t=1776900692227" /></a>
        </div>
        <div class="landing-reddit-link landing-reddit-link--mobile">
          <a href="https://www.reddit.com/r/getnorder/" target="_blank" rel="noopener noreferrer" class="landing-reddit-anchor">
            <img src="https://www.redditstatic.com/desktop2x/img/favicon/android-icon-192x192.png" alt="Reddit" width="20" height="20" />
            <span>follow nORDER</span>
          </a>
        </div>
      </div>

    </div>
  `;
}

export function renderAboutPage() {
  return shellLayout(
    `
      <section class="section-card about-hero">
        <h1>Built for real inventory operations</h1>
        <div class="about-active-state" aria-label="Current page indicator">
          <span class="about-active-dot" aria-hidden="true">&#10022;</span>
          <span>You are on the About page</span>
        </div>
        <p class="muted">
          nORDER is a practical inventory platform made to reduce waste, avoid duplicate purchases, and make
          shared planning effortless across homes, teams, and businesses.
        </p>
      </section>

      <section class="about-grid" style="margin-top:10px;" aria-label="About nORDER and the creator">
        <article class="about-panel">
          <h2>About the Creator</h2>
          <p class="muted">
            My name is Ahmaad Harvey, and I am a television producer and hobbyist developer with a lot of ideas
            and not enough time in the day. I produce television by day and build dreams at night. Order is a
            high priority for me, whether I am working on shows, running projects, or managing home supplies. I
            wanted to create and share a helpful tool so people can keep every inventory space nORDER.
          </p>
        </article>
        <article class="about-panel">
          <h2>What <span style="text-transform:none;">nORDER</span> is about</h2>
          <p class="muted">
            We help people stay organized with inventory tracking, low-stock visibility, and smarter replenishment
            workflows across homes, businesses, and shared spaces.
          </p>
        </article>
      </section>

      <section class="about-contact section-card" style="margin-top:10px;" aria-label="Contact nORDER team">
        <h2>Need help or have feedback?</h2>
        <p class="muted">Email the nORDER team for account issues, bug reports, partnership inquiries, or support.</p>
        <div class="row" style="flex-wrap:wrap;gap:10px;">
          <a class="about-email-link" href="mailto:getnorder@pm.me" target="_blank" rel="noopener noreferrer">getnorder@pm.me</a>
        </div>
      </section>

      <img class="about-logo-plain" src="nORDER%20LOGO.png" alt="nORDER Logo" loading="lazy" />
    `,
    "/about"
  );
}

export function renderTermsPage() {
  return shellLayout(
    `
      <section class="section-card about-hero">
        <h1>Terms & Conditions</h1>
        <p class="muted">Last updated: April 6, 2026</p>
      </section>

      <section class="section-card" style="margin-top:10px;">
        <h2>Using nORDER</h2>
        <p class="muted">nORDER helps you track inventory and collaborate with invited members in any context, including home or business. You are responsible for the accuracy of information you add to your inventory.</p>

        <h2 style="margin-top:14px;">Accounts and Access</h2>
        <p class="muted">Keep your account credentials private. You are responsible for activity from your account. Do not share invite codes publicly unless you intend broad access to your inventory.</p>

        <h2 style="margin-top:14px;">Collaborative Data</h2>
        <p class="muted">Inventory items and shared inventory settings are visible to collaborators in that inventory. Personal account preferences such as theme and profile image are account-level and should remain private to your account.</p>

        <h2 style="margin-top:14px;">Acceptable Use</h2>
        <p class="muted">Do not use nORDER in ways that break laws, abuse the service, or interfere with other users. We may limit access for harmful or abusive activity.</p>

        <h2 style="margin-top:14px;">Service Availability</h2>
        <p class="muted">nORDER is provided as-is. Features may change over time. We do our best to keep the service available but cannot guarantee uninterrupted operation.</p>

        <h2 style="margin-top:14px;">Contact</h2>
        <p class="muted">Questions about these terms can be sent to <a href="mailto:getnorder@pm.me" style="color:var(--primary);">getnorder@pm.me</a>.</p>
      </section>
    `,
    "/terms"
  );
}

export function renderWelcomeTermsPage(isSignedIn) {
  return `
    <div class="welcome about-page-wrap">
      <section class="welcome-card about-page-card">
        <div class="about-hero">
          <p class="about-kicker">Policy</p>
          <h1>Terms & Conditions</h1>
          <p class="muted">Last updated: April 6, 2026</p>
        </div>

        <section class="about-grid" aria-label="Terms overview">
          <article class="about-panel">
            <h2>Using nORDER</h2>
            <p class="muted">By using nORDER, you agree to use the app responsibly and keep your account secure while managing inventory in any space.</p>
            <h2 style="margin-top:10px;">Shared Inventories</h2>
            <p class="muted">Collaborators can view and update shared inventory content. Only invite people you trust.</p>
          </article>
          <article class="about-panel">
            <h2>Privacy and Preferences</h2>
            <p class="muted">Your personal profile preferences are tied to your account. Shared inventory data remains visible to collaborators in that inventory.</p>
            <h2 style="margin-top:10px;">Support</h2>
            <p class="muted">For questions, contact <a href="mailto:getnorder@pm.me" style="color:var(--primary);">getnorder@pm.me</a>.</p>
          </article>
        </section>

        <div class="row" style="justify-content:space-between;gap:10px;flex-wrap:wrap;">
          <a href="#/login" class="ghost about-back-link">Back to Sign In</a>
        </div>
      </section>
      <img class="about-logo-plain" src="nORDER%20LOGO.png" alt="nORDER Logo" loading="lazy" />
    </div>
  `;
}

export function renderWelcomeAboutPage(isSignedIn) {
  return `
    <div class="welcome about-page-wrap">
      <section class="welcome-card about-page-card">
        <div class="about-hero">
          <p class="about-kicker">Creator Portfolio</p>
          <h1>Built for real inventory operations</h1>
          <div class="about-active-state" aria-label="Current page indicator">
            <span class="about-active-dot" aria-hidden="true">&#10022;</span>
            <span>You are on the About page</span>
          </div>
          <p class="muted">
            nORDER is a practical inventory platform made to reduce waste, avoid duplicate purchases, and make
            shared planning feel effortless.
          </p>
        </div>

        <section class="about-grid" aria-label="About nORDER and the creator">
          <article class="about-panel">
            <h2>About the Creator</h2>
            <p class="muted">
              My name is Ahmaad Harvey, and I am a television producer and hobbyist developer with a lot of ideas
              and not enough time in the day. I produce television by day and build dreams at night. Order is a
              high priority for me, whether I am working on shows, running projects, or managing home supplies. I
              wanted to create and share a helpful tool so people can keep every inventory space nORDER.
            </p>
          </article>
          <article class="about-panel">
            <h2>What <span style="text-transform:none;">nORDER</span> is about</h2>
            <p class="muted">
              We help people stay organized with inventory tracking, low-stock visibility, and smarter replenishment
              workflows across homes, businesses, and shared spaces.
            </p>
          </article>
        </section>

        <section class="about-contact" aria-label="Contact nORDER team">
          <h2>Need help or have feedback?</h2>
          <p class="muted">
            Email the nORDER team for account issues, bug reports, partnership inquiries, or general support.
          </p>
          <div class="row" style="flex-wrap:wrap;gap:10px;">
            <a class="about-email-link" href="mailto:getnorder@pm.me" target="_blank" rel="noopener noreferrer">getnorder@pm.me</a>
          </div>
        </section>

        <div class="row" style="justify-content:space-between;gap:10px;flex-wrap:wrap;">
          <a href="#/login" class="ghost about-back-link">Back to Sign In</a>
        </div>
      </section>
      <img class="about-logo-plain" src="nORDER%20LOGO.png" alt="nORDER Logo" loading="lazy" />
    </div>
  `;
}

export function renderProfile(user) {
  const state = getState();
  const canUseLocalProfile = Boolean(user && state.prefs.profile_uid && state.prefs.profile_uid === user.uid);
  const rawName = (user && user.displayName) || (canUseLocalProfile ? state.prefs.profile_name : "") || "";
  const rawPhoto = (canUseLocalProfile ? state.prefs.profile_picture : "") || (user && user.photoURL) || "";
  const name = escapeHtml(rawName);
  const photo = escapeAttr(rawPhoto);
  const email = escapeHtml((user && user.email) || "");

  return shellLayout(
    `
    <section class="section-card">
      <div class="row space" style="margin-bottom:10px;">
        <h1>My Profile</h1>
        <button onclick="window.location.hash='#/dashboard'">Back</button>
      </div>

      <div class="profile-preview">
        ${profileAvatar(rawPhoto, rawName)}
        <div>
          <div class="item-name">${name || "Your name"}</div>
          <div class="help">${email}</div>
        </div>
      </div>

      <p class="help" style="margin-top:10px;">Account profile details are managed from the Profile Settings page.</p>
    </section>

    <section class="section-card" style="margin-top:10px;">
      <h2 style="margin:0 0 8px 0;">Account</h2>
      <p class="help">Security and preference resets are available on the dedicated Profile Settings page.</p>
      <div class="row" style="gap:8px;flex-wrap:wrap;">
        <button onclick="window.location.hash='#/profile-settings'" class="primary">Open Profile Settings</button>
        <button onclick="window.location.hash='#/terms'" class="ghost">Terms & Conditions</button>
      </div>
    </section>

    <section class="section-card" style="margin-top:10px;">
      <h2 style="margin:0 0 8px 0;">Data</h2>
      <button id="clear-data" class="danger">Clear Everything</button>
      <p class="help" style="margin-top:8px;">Removes all items and categories for this inventory. Account preferences stay unchanged.</p>
    </section>
  `,
    "/profile"
  );
}

export function renderProfileSettings(user) {
  const state = getState();
  const canUseLocalProfile = Boolean(user && state.prefs.profile_uid && state.prefs.profile_uid === user.uid);
  const rawName = (user && user.displayName) || (canUseLocalProfile ? state.prefs.profile_name : "") || "";
  const rawPhoto = (canUseLocalProfile ? state.prefs.profile_picture : "") || (user && user.photoURL) || "";
  const name = escapeHtml(rawName);
  const email = escapeHtml((user && user.email) || "");

  return `
    <div class="welcome">
      <section class="welcome-card">
        <div class="row space" style="margin-bottom:10px;">
          <h1>Profile Settings</h1>
          <button onclick="window.location.hash='#/inventories'">Back</button>
        </div>
        <p class="muted">Manage your account settings before opening an inventory.</p>

        <div class="profile-preview" style="margin-top:10px;">
          <div id="profile-photo-preview">${profileAvatar(rawPhoto, rawName)}</div>
          <div>
            <div class="item-name">${name || "Your name"}</div>
            <div class="help">${email}</div>
          </div>
        </div>

        <div class="grid" style="margin-top:10px;">
          <label>
            <span class="help">Name (required)</span>
            <input id="profile-name" maxlength="50" value="${escapeAttr(rawName)}" />
          </label>
          <label>
            <span class="help">Profile picture (optional)</span>
            <input id="profile-photo-file" type="file" accept="image/*" />
          </label>
          <button id="save-profile" class="primary">Save Profile</button>
          <div id="profile-save-message" class="help"></div>
        </div>

        <section class="section-card" style="margin-top:10px;">
          <h2 style="margin:0 0 8px 0;">Change Password</h2>
          <div class="grid">
            <label>
              <span class="help">Current password</span>
              <div class="password-input-wrap">
                <input id="password-current" type="password" />
                <button
                  type="button"
                  data-action="toggle-password-visibility"
                  data-target="password-current"
                  class="password-toggle">
                  Show
                </button>
              </div>
            </label>
            <label>
              <span class="help">New password</span>
              <div class="password-input-wrap">
                <input id="password-new" type="password" />
                <button
                  type="button"
                  data-action="toggle-password-visibility"
                  data-target="password-new"
                  class="password-toggle">
                  Show
                </button>
              </div>
            </label>
            <label>
              <span class="help">Confirm new password</span>
              <div class="password-input-wrap">
                <input id="password-confirm" type="password" />
                <button
                  type="button"
                  data-action="toggle-password-visibility"
                  data-target="password-confirm"
                  class="password-toggle">
                  Show
                </button>
              </div>
            </label>
            <button id="change-password" class="primary">Update Password</button>
            <div id="password-message" class="help"></div>
          </div>
        </section>

        <section class="section-card" style="margin-top:10px;">
          <h2 style="margin:0 0 8px 0;">Preferences</h2>
          <p class="help">Reset account defaults (teal theme, dark mode on, no profile image).</p>
          <button id="reset-account-prefs" class="ghost">Reset Preferences to Default</button>
          <div id="profile-prefs-message" class="help" style="margin-top:8px;"></div>
        </section>
      </section>
    </div>
  `;
}

export function renderMyInventories(inventories) {
  return `
    <div class="app-shell">
      <header class="topbar">
        <div>
          <div class="brand"><span class="brand-n">n</span>ORDER</div>
          <div class="muted">My Inventory Spaces</div>
        </div>
        <div class="row" style="gap:8px;">
          <button id="logout-btn" class="ghost icon-btn" aria-label="Logout"><svg class="logout-icon" viewBox="0 0 600 600" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path style="fill:#1f7a69;stroke-linecap:round;stroke-linejoin:round" d="M 130 0 C 58.672245 0 0 58.672245 0 130 L 0 470 C 0 541.32776 58.672245 600 130 600 L 301.57812 600 C 367.83331 600 423.13643 549.36696 430.67188 485 L 349.43555 485 C 343.32179 505.66026 324.7036 520 301.57812 520 L 130 520 C 101.60826 520 80 498.39174 80 470 L 80 130 C 80 101.60826 101.60826 80 130 80 L 301.57812 80 C 324.7036 80 343.32179 94.339739 349.43555 115 L 430.67188 115 C 423.13642 50.633038 367.83331 0 301.57812 0 L 130 0 z"/><path style="fill:#ffffff" d="m 476.86328,179.99911 a 40,40 0 0 0 -28.28516,11.71484 40,40 0 0 0 0,56.57032 l 11.71485,11.71484 H 163.72656 a 40,40 0 0 0 -40,40 40,40 0 0 0 40,40 h 296.56641 l -11.71485,11.71484 a 40,40 0 0 0 0,56.57032 40,40 0 0 0 56.57032,0 l 72.79101,-72.79102 A 40,40 0 0 0 600,299.99911 40,40 0 0 0 577.5293,264.09481 l -72.38086,-72.38086 a 40,40 0 0 0 -28.28516,-11.71484 z"/></svg><span class="topbar-label">Logout</span></button>
        </div>
      </header>
      <main class="page">
        <section class="section-card">
          <div class="row space" style="margin-bottom:8px;">
            <h1>My Inventory Spaces</h1>
            <button id="create-new-inventory">New Space</button>
          </div>
          <p class="muted">Select an inventory space to manage, or create a new shared one.</p>

          <div class="list" style="margin-top:10px;">
            ${
              inventories && Object.keys(inventories).length
                ? Object.entries(inventories)
                    .map(
                      ([id, inv]) => `
                  <div class="row space" style="padding:12px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;">
                    <div>
                      <strong>${escapeHtml(inv.name)}</strong>
                      <p class="help" style="margin:4px 0 0 0;">Role: <strong>${inv.role}</strong></p>
                      <p class="help" style="margin:2px 0;">Joined ${new Date(inv.joined_at).toLocaleDateString()}</p>
                    </div>
                    <div class="row" style="gap:8px;">
                      <button data-action="select-inventory" data-id="${id}" class="primary">Open</button>
                      <button
                        data-action="delete-inventory"
                        data-id="${id}"
                        data-role="${escapeAttr(inv.role || "member") }"
                        data-name="${escapeAttr(inv.name || "Inventory") }"
                        class="danger">
                        ${inv.role === "admin" ? "Delete" : "Leave"}
                      </button>
                    </div>
                  </div>
                `
                    )
                    .join("")
                : `<p class="help">No inventory spaces yet. Create one to get started.</p>`
            }
          </div>
        </section>

        <section class="section-card" style="margin-top:10px;">
          <h2>Join Shared Inventory</h2>
          <p class="muted">Already have an invite code for a shared space?</p>
          <div class="grid">
            <input id="join-code-input" placeholder="Paste invitation code here" maxlength="10" />
            <button id="join-inventory-btn" class="primary">Join Space</button>
          </div>
          <div id="join-error" class="help danger" style="margin-top:8px;"></div>
        </section>
      </main>
    </div>
  `;
}

export function renderCollaborationSettings(collaborators, inviteCodes, isOwner, currentUserId) {
  return `
    <section class="section-card" style="margin-top:10px;">
      <h2 style="margin:0 0 8px 0;">Collaborators</h2>
      <div class="list">
        ${
          collaborators && Object.keys(collaborators).length
            ? Object.entries(collaborators)
                .map(
                  ([userId, collab]) => `
                  <div class="row space">
                    <div>
                      <strong>${escapeHtml(collab.name)}</strong>
                      <p class="help" style="margin:2px 0;">${collab.role === "admin" ? "👑 Admin" : "Member"} • Joined ${new Date(collab.joined_at).toLocaleDateString()}</p>
                    </div>
                    ${
                      isOwner
                        ? userId !== currentUserId
                          ? `<button data-action="remove-collaborator" data-id="${userId}" class="danger">Remove</button>`
                          : `<span class="help" title="Inventory creators cannot remove themselves as collaborators.">Owner cannot be removed</span>`
                        : ""
                    }
                  </div>
                `
                )
                .join("")
            : `<p class="help">No collaborators yet.</p>`
        }
      </div>
    </section>

    ${
      isOwner
        ? `
    <section class="section-card" style="margin-top:10px;">
      <div class="row space" style="margin-bottom:8px;">
        <h2 style="margin:0;">Invite Codes</h2>
        <button id="generate-new-code" class="primary">Generate Code</button>
      </div>
      <p class="muted">Share these codes to invite people to this inventory space.</p>
      <div class="list" style="margin-top:10px;">
        ${
          inviteCodes && Object.keys(inviteCodes).length
            ? Object.entries(inviteCodes)
                .map(
                  ([code, codeData]) => `
                  <div class="row space invite-code-row">
                    <div>
                      <code class="invite-code-token">${code}</code>
                      <p class="help" style="margin:4px 0 0 0;">Used ${codeData.uses || 0} time${codeData.uses === 1 ? "" : "s"}</p>
                    </div>
                    <button data-action="delete-invite-code" data-code="${code}" class="danger">Delete</button>
                  </div>
                `
                )
                .join("")
            : `<p class="help">No invite codes yet. Generate one to start sharing.</p>`
        }
      </div>
    </section>
    `
        : ""
    }
  `;
}
