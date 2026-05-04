/*
  views.js
  Purpose:
  - Build HTML strings for every page/screen in the app.
  - Keep rendering logic separate from event wiring (events.js/auth-events.js).
*/

import { getHashParams } from "./router.js";
import { getState } from "./state.js";
import { getRecentAccounts } from "./auth.js";
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

function navLink(route, label, activeRoute) {
  const active = activeRoute === route ? "active" : "";
  return `<a class="nav-link ${active}" href="#${route}">${label}</a>`;
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

function shellLayout(content, route) {
  const state = getState();
  const greeting = state.prefs.profile_name
    ? `Welcome, ${escapeHtml(state.prefs.profile_name)}`
    : "Inventory at a glance";
  const profileName = state.prefs.profile_name || "Profile";
  const photoURL = state.prefs.profile_picture || "";

  return `
    <div class="app-shell">
      <header class="topbar">
        <div>
          <div class="brand"><span class="brand-n">n</span>ORDER</div>
          <div class="muted">${greeting}</div>
        </div>
        <div class="row">
          <button id="quick-add" class="primary" aria-label="Add item"><svg class="quick-add-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path d="M12 6C12.5523 6 13 6.44772 13 7V11H17C17.5523 11 18 11.4477 18 12C18 12.5523 17.5523 13 17 13H13V17C13 17.5523 12.5523 18 12 18C11.4477 18 11 17.5523 11 17V13H7C6.44772 13 6 12.5523 6 12C6 11.4477 6.44772 11 7 11H11V7C11 6.44772 11.4477 6 12 6Z" fill="#53c6ab"/><path fill-rule="evenodd" clip-rule="evenodd" d="M2 4.5C2 3.11929 3.11929 2 4.5 2H19.5C20.8807 2 22 3.11929 22 4.5V19.5C22 20.8807 20.8807 22 19.5 22H4.5C3.11929 22 2 20.8807 2 19.5V4.5ZM4.5 4C4.22386 4 4 4.22386 4 4.5V19.5C4 19.7761 4.22386 20 4.5 20H19.5C19.7761 20 20 19.7761 20 19.5V4.5C20 4.22386 19.7761 4 19.5 4H4.5Z" fill="#53c6ab"/></svg><span class="topbar-label">Add item</span></button>
          <button id="switch-profile" class="ghost" aria-label="Switch profile"><svg class="switch-profile-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path d="M18.7153 1.71609C18.3241 1.32351 18.3241 0.687013 18.7153 0.294434C19.1066 -0.0981448 19.7409 -0.0981448 20.1321 0.294434L22.4038 2.57397L22.417 2.58733C23.1935 3.37241 23.1917 4.64056 22.4116 5.42342L20.1371 7.70575C19.7461 8.09808 19.1122 8.09808 18.7213 7.70575C18.3303 7.31342 18.3303 6.67733 18.7213 6.285L20.0018 5L4.99998 5C4.4477 5 3.99998 5.44772 3.99998 6V13C3.99998 13.5523 3.55227 14 2.99998 14C2.4477 14 1.99998 13.5523 1.99998 13V6C1.99998 4.34315 3.34313 3 4.99998 3H19.9948L18.7153 1.71609Z" fill="#43dfc5"/><path d="M22 11C22 10.4477 21.5523 10 21 10C20.4477 10 20 10.4477 20 11V18C20 18.5523 19.5523 19 19 19L4.00264 19L5.28213 17.7161C5.67335 17.3235 5.67335 16.687 5.28212 16.2944C4.8909 15.9019 4.2566 15.9019 3.86537 16.2944L1.59369 18.574L1.58051 18.5873C0.803938 19.3724 0.805727 20.6406 1.58588 21.4234L3.86035 23.7058C4.25133 24.0981 4.88523 24.0981 5.2762 23.7058C5.66718 23.3134 5.66718 22.6773 5.2762 22.285L3.99563 21L19 21C20.6568 21 22 19.6569 22 18L22 11Z" fill="#43dfc5"/></svg><span class="topbar-label">Switch</span></button>
          <button id="open-profile" class="profile-trigger" aria-label="Open profile">
            ${profileAvatar(photoURL, profileName)}
          </button>
        </div>
      </header>
      <main class="page">${content}</main>
      <nav class="bottom-nav">
        <div class="bottom-nav-inner">
          ${navLink("/dashboard", "Home", route)}
          ${navLink("/inventory", "Inventory", route)}
          ${navLink("/shopping", "Restock", route)}
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
  const expiring = state.items.filter((i) => {
    if (!i.expiry_date) return false;
    const date = new Date(i.expiry_date).getTime();
    const diffDays = (date - Date.now()) / 86400000;
    return diffDays >= 0 && diffDays <= 7;
  }).length;

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

export function renderDashboard() {
  const state = getState();
  const stats = computeStats();
  const lowItems = state.items.filter((i) => isLowStockLevel(getItemStockLevel(i))).slice(0, 5);

  return shellLayout(
    `
    <section class="section-card">
      <h1>${escapeHtml(state.prefs.home_name)}</h1>
      <p class="muted">Track stock levels for home, business, or any operation.</p>
    </section>

    <section class="grid stats" style="margin-top:10px;">
      <article class="section-card"><div class="help">Items Tracked</div><h1>${stats.total}</h1></article>
      <article class="section-card"><div class="help">Restock List</div><h1>${stats.restock}</h1></article>
      <article class="section-card"><div class="help">Low Stock</div><h1 class="warning">${stats.low}</h1></article>
      <article class="section-card"><div class="help">Expiring Soon</div><h1>${stats.expiring}</h1></article>
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

  const filtered = state.items.filter((item) => {
    const byText = !query || item.name.toLowerCase().includes(query);
    const byCat = filter === "all" || item.category.toLowerCase() === filter;
    return byText && byCat;
  });

  return shellLayout(
    `
    <section class="section-card">
      <div class="row space" style="margin-bottom:8px;">
        <h1>Inventory Workspace</h1>
        <button id="toggle-item-form">Add New</button>
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
      </div>
          <p id="inventory-filtering" class="inventory-filtering" aria-live="polite">Filtering...</p>

      <div id="item-form" class="dialog">
        <div class="grid">
          <label class="field" for="item-name">
            <span class="field-label">Item name</span>
            <input id="item-name" placeholder="e.g. Coffee Beans or Printer Paper" maxlength="50" />
          </label>
            <label class="field" for="item-brand">
              <span class="field-label">Brand name (optional)</span>
              <input id="item-brand" placeholder="e.g. Lavazza or HP" maxlength="50" />
            </label>
            <label class="field" for="item-category">
            <span class="field-label">Category</span>
            <select id="item-category">
              ${state.categories.map((c) => `<option>${escapeHtml(c.name)}</option>`).join("")}
            </select>
          </label>
          <label class="field" for="item-stock-level">
            <span class="field-label">Stock level</span>
            <select id="item-stock-level">
              ${STOCK_LEVELS.map((level) => `<option>${escapeHtml(level)}</option>`).join("")}
            </select>
          </label>
          <div class="row form-row-two">
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
          <div id="item-unit-stock-levels" class="unit-level-wrap"></div>
          <label class="field" for="item-expiry">
            <span class="field-label">Expiry date</span>
            <input id="item-expiry" type="date" />
          </label>
          <button id="save-item" class="primary">Save Inventory Item</button>
        </div>
      </div>

      <div id="inventory-list" class="list" style="margin-top:10px;">
        ${
          state.items.length
            ? state.items
                .map(
                    (item) => {
                      const stockLevel = getItemStockLevel(item);
                      const byText = !query || item.name.toLowerCase().includes(query);
                      const byCat = filter === "all" || item.category.toLowerCase() === filter;
                      const isVisible = byText && byCat;
                      return `
                  <article
                    class="item"
                    data-role="inventory-item"
                    data-name="${escapeAttr(item.name.toLowerCase())}"
                    data-category="${escapeAttr(item.category.toLowerCase())}"
                    ${isVisible ? "" : 'style="display:none;"'}
                  >
                    <div class="item-header">
                      <div>
                        <div class="item-name">${escapeHtml(item.name)}</div>
                        <div class="row">
                            ${item.brand_name ? `<div class="help">${escapeHtml(item.brand_name)}</div>` : ""}
                            <span class="badge">${escapeHtml(item.category)}</span>
                          <span class="badge">${escapeHtml(getContainerSummary(item))}</span>
                          <span class="help">${
                            item.expiry_date ? `Exp: ${escapeHtml(item.expiry_date)}` : "No expiry set"
                          }</span>
                        </div>
                      </div>
                      <div class="row">
                        <button data-action="edit-item" data-id="${item.id}">Edit</button>
                        <button data-action="delete-item" class="danger" data-id="${item.id}">Delete</button>
                      </div>
                    </div>
                    <div class="progress"><span style="width:${getItemStockPercentage(item)}%"></span></div>
                    <div class="row space">
                      <span class="help">Stock status: ${escapeHtml(stockLevel)}${
                        getItemQuantity(item) > 1 ? ` (${escapeHtml(getUnitLevelSummary(item))})` : ""
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
            : ""
        }
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
                  (item) => `
                  <article class="item row space">
                    <label class="row" style="flex:1;">
                      <input type="checkbox" data-role="buy-check" data-id="${item.id}" style="width:auto;" />
                      <span>
                        <strong>${escapeHtml(item.name)}</strong>
                          <span class="help"> ${escapeHtml(item.category)} | ${escapeHtml(getItemStockLevel(item))}</span>
                      </span>
                    </label>
                    <button data-action="remove-shopping" data-id="${item.id}">Remove</button>
                  </article>
                `
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
        <button id="save-prefs" class="primary">Save Inventory Preferences</button>
      </div>
    </section>

    <section class="section-card" style="margin-top:10px;">
      <div class="row space" style="margin-bottom:8px;">
        <h2 style="margin:0;">Categories</h2>
        <button id="add-category">Add Category</button>
      </div>
      <div class="list">
        ${
          state.categories.length
            ? state.categories
                .map(
                  (c) => `
                  <div class="row space">
                    <div><strong>${escapeHtml(c.name)}</strong> <span class="help">${escapeHtml(c.icon)}</span></div>
                    <button data-action="delete-category" data-id="${c.id}" class="danger">Delete</button>
                  </div>
                `
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

  return `
    <div class="welcome welcome-login">
      <img class="welcome-logo-plain" src="nORDER%20LOGO.png" alt="nORDER Logo" loading="eager" />
      <section class="welcome-card">
        <h1><span class="brand-n">n</span>ORDER</h1>
        <p class="muted">Inventory management from home to business and beyond</p>
        ${
          recentAccounts.length
            ? `
          <div class="recent-logins">
            <h2 style="margin:0;">Quick Access</h2>
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
        `
            : ""
        }
        <div class="grid">
          <div id="login-form">
            <h2>Sign In</h2>
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
            <p class="help login-about-link">
              Want to know who built this?
              <a href="#/about-welcome" style="cursor:pointer;color:var(--primary);">About nORDER</a>
            </p>
            <p class="help login-about-link">
              By signing in, you agree to our
              <a href="#/terms-welcome" style="cursor:pointer;color:var(--primary);">Terms & Conditions</a>.
            </p>
            <div id="login-error" class="help danger"></div>
          </div>

          <div id="signup-form" style="display:none;">
            <h2>Create Account</h2>
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
        <section class="signin-intro" aria-label="About nORDER">
          <p>
            nORDER helps you track what is in stock, what is running low, and what needs replenishment next across
            any inventory space.
          </p>
        </section>
      </section>
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
          <h2 style="margin:0 0 8px 0;">Appearance</h2>
          <p class="help">Theme and dark mode are account-level and carry across every inventory you open or join.</p>
          <div class="grid">
            <label>
              <span class="help">Theme</span>
              <select id="account-theme">
                ${["teal", "coral", "amber", "blue", "rose"]
                  .map((t) => `<option value="${t}" ${state.prefs.theme === t ? "selected" : ""}>${t}</option>`)
                  .join("")}
              </select>
            </label>
            <label>
              <span class="help">Dark mode</span>
              <select id="account-dark">
                <option value="false" ${state.prefs.dark_mode ? "" : "selected"}>Off</option>
                <option value="true" ${state.prefs.dark_mode ? "selected" : ""}>On</option>
              </select>
            </label>
            <button id="save-account-appearance" class="primary">Save Appearance</button>
            <div id="account-appearance-message" class="help"></div>
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
