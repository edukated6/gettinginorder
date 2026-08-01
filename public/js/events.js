/*
  events.js
  Purpose:
  - Wire inventory/settings/dashboard page interactions.
  - Update local app state after user actions.
*/

import { defaultHomeName, getState, resetInventoryData, resetState, saveState, setState } from "./state.js";
import { getHashParams, getRoute, setRoute } from "./router.js";
import {
  STOCK_LEVELS,
  buildUnitStockLevels,
  escapeAttr,
  escapeHtml,
  getItemQuantity,
  getItemStockLevel,
  getItemStockPercentage,
  getItemUnitStockLevels,
  isLowStockLevel,
  normalizeItemQuantity,
  normalizeStockLevel,
  stockLevelToPercentage,
} from "./utils.js";
import { announceUnreadNotifications, dismissNotifications, markNotificationsRead } from "./notifications.js";
import { getCurrentInventoryId } from "./state.js";
import { getCurrentUser } from "./auth.js";
import {
  logInventoryChange,
} from "./collaboration.js";

let delegatedHandlersBound = false;
const CONTAINER_TYPES = ["Bottle", "Can", "Bag", "Box"];
const WEAR_LEVELS = ["Brand New", "Light", "Moderate", "Heavy", "Replace"];
const WEAR_LEVEL_TO_PERCENT = {
  "Brand New": 0,
  Light: 25,
  Moderate: 50,
  Heavy: 75,
  Replace: 100,
};
const WEAR_DECAY_INTERVAL_MS = 12 * 60 * 60 * 1000;
const WEAR_DECAY_PERCENT_PER_INTERVAL = 2;
const QUICK_EDIT_MODAL_ID = "norder-quick-edit";
const RESTOCK_PROMPT_MODAL_ID = "norder-restock-prompt";
const TUTORIAL_OVERLAY_ID = "norder-beginner-tutorial";
const TUTORIAL_HIGHLIGHT_CLASS = "tutorial-target-highlight";
const TUTORIAL_SEEN_BY_UID_KEY = "norder_tutorial_seen_by_uid";
const TUTORIAL_SEEN_LOCAL_KEY = "norder_tutorial_seen_local";
const TUTORIAL_VERSION = 2;
let pendingSearchFocus = null;
let filterIndicatorHideTimer = null;
let saveNoticeHideTimer = null;
let quickEditKeydownHandler = null;
let pageFloatingActionCleanup = null;
const LANDING_ACTIVE_TAB_KEY = "norder_landing_active_tab";
const tutorialState = {
  active: false,
  stepIndex: 0,
};

function isDesktopLocalMode() {
  return typeof window !== "undefined" && Boolean(window.__NORDER_DESKTOP_LOCAL__);
}

const BASE_TUTORIAL_STEPS = [
  {
    title: "Welcome to nORDER",
    body: "This top area is your control center. Use the bottom bar to move between Inventory, Restock, Home, Settings, and About.",
    route: "/dashboard",
    selector: ".topbar",
  },
  {
    title: "Switch Inventory Spaces",
    body: "Use this switch icon to move between inventory spaces. You can create, join, open, leave, or delete spaces from My Inventory Spaces.",
    route: "/dashboard",
    selector: "#switch-profile",
    cloudOnly: true,
  },
  {
    title: "Add Inventory Fast",
    body: "Use the plus icon to jump into adding items. This takes you to Inventory and lets you open the Add New form instantly.",
    route: "/inventory",
    selector: "#quick-add",
    action: "open-add-form",
    actionLabel: "Open Add Form",
  },
  {
    title: "Richer Item Details",
    body: "In Add New, you can set quantity, container type, and expiry. Multi-quantity items support per-unit stock levels so tracking stays precise.",
    route: "/inventory",
    selector: "#toggle-item-form",
  },
  {
    title: "Find Items Quickly",
    body: "Use search, category, wear, and sort filters to narrow large inventories in seconds.",
    route: "/inventory",
    selector: ".toolbar",
  },
  {
    title: "Manage Restock List",
    body: "The Restock tab centralizes low-stock items so you can quickly mark them as replenished in bulk.",
    route: "/shopping",
    selector: "#restock-selected",
  },
  {
    title: "Team Access and Invite Codes",
    body: "Open Manage Team Access to generate invite codes, review collaborators, and control who can work in this inventory space.",
    route: "/settings",
    selector: "#view-collaboration-settings",
    overlayPosition: "top",
    cloudOnly: true,
  },
  {
    title: "Accountability History",
    body: "View Change History shows who changed what and when, giving your team clear accountability.",
    route: "/settings",
    selector: "#view-activity-log",
    overlayPosition: "top",
    cloudOnly: true,
  },
  {
    title: "Inventory Preferences",
    body: "Save inventory-specific settings like space name and tombstone retention days in this section.",
    route: "/settings",
    selector: "#save-prefs",
  },
  {
    title: "Account Profile and Appearance",
    body: "Use your profile avatar to open profile settings for account-level options like password, theme, dark mode, and avatar.",
    route: "/dashboard",
    selector: "#open-profile",
  },
  {
    title: "You are Ready",
    body: "Tutorial complete. Use the question mark button anytime to replay this guide and onboard new collaborators faster.",
    route: "/dashboard",
    selector: "#open-tutorial",
  },
];

function getTutorialSteps() {
  if (!isDesktopLocalMode()) return BASE_TUTORIAL_STEPS;
  return BASE_TUTORIAL_STEPS.filter((step) => !step.cloudOnly);
}

function deepClone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function toDomainOnlyUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ""), window.location.origin);
    if (!/^https?:$/i.test(parsed.protocol)) return "#";
    return `${parsed.protocol}//${parsed.host}/`;
  } catch (_) {
    return "#";
  }
}

function toDomainLabel(rawUrl, fallback = "Website") {
  try {
    const parsed = new URL(String(rawUrl || ""), window.location.origin);
    return parsed.hostname.replace(/^www\./i, "") || fallback;
  } catch (_) {
    return fallback;
  }
}

function safeUuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getTutorialStep() {
  const steps = getTutorialSteps();
  return steps[tutorialState.stepIndex] || null;
}

function readTutorialSeenByUid() {
  try {
    const raw = localStorage.getItem(TUTORIAL_SEEN_BY_UID_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function writeTutorialSeenByUid(data) {
  try {
    localStorage.setItem(TUTORIAL_SEEN_BY_UID_KEY, JSON.stringify(data || {}));
  } catch (_error) {
    // Ignore storage issues and continue without persistence.
  }
}

function hasSeenTutorialForCurrentUser() {
  const user = getCurrentUser();
  const uid = String((user && user.uid) || "").trim();
  if (!uid) {
    if (!isDesktopLocalMode()) return false;
    try {
      return Number(localStorage.getItem(TUTORIAL_SEEN_LOCAL_KEY) || 0) >= TUTORIAL_VERSION;
    } catch (_error) {
      return false;
    }
  }
  const map = readTutorialSeenByUid();
  return Number(map[uid]) >= TUTORIAL_VERSION;
}

function markTutorialSeenForCurrentUser() {
  const user = getCurrentUser();
  const uid = String((user && user.uid) || "").trim();
  if (!uid) {
    if (!isDesktopLocalMode()) return;
    try {
      localStorage.setItem(TUTORIAL_SEEN_LOCAL_KEY, String(TUTORIAL_VERSION));
    } catch (_error) {
      // Ignore local storage failures.
    }
    return;
  }
  const map = readTutorialSeenByUid();
  map[uid] = TUTORIAL_VERSION;
  writeTutorialSeenByUid(map);
}

function clearTutorialHighlight() {
  document.querySelectorAll(`.${TUTORIAL_HIGHLIGHT_CLASS}`).forEach((element) => {
    element.classList.remove(TUTORIAL_HIGHLIGHT_CLASS);
  });
}

function removeTutorialOverlay() {
  const overlay = document.getElementById(TUTORIAL_OVERLAY_ID);
  if (overlay && overlay.parentNode) {
    overlay.parentNode.removeChild(overlay);
  }
}

function closeTutorial() {
  tutorialState.active = false;
  markTutorialSeenForCurrentUser();
  removeTutorialOverlay();
  clearTutorialHighlight();
}

function applyTutorialHighlight() {
  clearTutorialHighlight();
  const step = getTutorialStep();
  if (!tutorialState.active || !step || !step.selector) return;

  const target = document.querySelector(step.selector);
  if (!target) return;

  target.classList.add(TUTORIAL_HIGHLIGHT_CLASS);
  if (typeof target.scrollIntoView === "function") {
    target.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

function renderTutorialOverlay() {
  if (!tutorialState.active) return;
  const step = getTutorialStep();
  if (!step) {
    closeTutorial();
    return;
  }

  removeTutorialOverlay();

  const overlay = document.createElement("div");
  overlay.id = TUTORIAL_OVERLAY_ID;
  overlay.className = `tutorial-overlay ${step.overlayPosition === "top" ? "tutorial-overlay-top" : ""}`.trim();
  overlay.innerHTML = `
    <section class="tutorial-card" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
      <div class="tutorial-kicker">Beginner Tutorial</div>
      <h2 id="tutorial-title" class="tutorial-title">${step.title}</h2>
      <p class="tutorial-copy">${step.body}</p>
      <div class="tutorial-progress-wrap" aria-hidden="true">
        <div class="tutorial-progress-bar"><span style="width:${Math.round(((tutorialState.stepIndex + 1) / getTutorialSteps().length) * 100)}%;"></span></div>
        <div class="tutorial-progress-label">Step ${tutorialState.stepIndex + 1} of ${getTutorialSteps().length}</div>
      </div>
      <div class="tutorial-actions">
        <button type="button" id="tutorial-skip" class="ghost">Skip</button>
        <button type="button" id="tutorial-back" class="ghost" ${tutorialState.stepIndex === 0 ? "disabled" : ""}>Back</button>
        ${step.action === "open-add-form" ? `<button type="button" id="tutorial-step-action" class="ghost">${step.actionLabel || "Try it"}</button>` : ""}
        <button type="button" id="tutorial-next" class="primary">${tutorialState.stepIndex === getTutorialSteps().length - 1 ? "Finish" : "Next"}</button>
      </div>
    </section>
  `;

  document.body.appendChild(overlay);

  const skipBtn = document.getElementById("tutorial-skip");
  if (skipBtn) {
    skipBtn.addEventListener("click", () => {
      closeTutorial();
    });
  }

  const backBtn = document.getElementById("tutorial-back");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      setTutorialStep(tutorialState.stepIndex - 1);
    });
  }

  const actionBtn = document.getElementById("tutorial-step-action");
  if (actionBtn) {
    actionBtn.addEventListener("click", () => {
      if (getRoute() !== "/inventory") {
        setRoute("/inventory");
        return;
      }
      toggleForm(true);
      applyTutorialHighlight();
    });
  }

  const nextBtn = document.getElementById("tutorial-next");
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      if (tutorialState.stepIndex >= getTutorialSteps().length - 1) {
        closeTutorial();
        return;
      }
      setTutorialStep(tutorialState.stepIndex + 1);
    });
  }

  applyTutorialHighlight();
}

function setTutorialStep(stepIndex) {
  const steps = getTutorialSteps();
  const boundedStep = Math.max(0, Math.min(steps.length - 1, Number(stepIndex) || 0));
  tutorialState.stepIndex = boundedStep;
  tutorialState.active = true;

  const step = getTutorialStep();
  if (step && step.route && getRoute() !== step.route) {
    setRoute(step.route);
    return;
  }

  renderTutorialOverlay();
}

function startTutorial() {
  setTutorialStep(0);
}

function restorePendingSearchFocus() {
  if (!pendingSearchFocus) return;

  const search = document.getElementById("search-input");
  const cat = document.getElementById("category-filter");
  const wear = document.getElementById("wear-filter");
  const sort = document.getElementById("sort-filter");
  if (!search) return;

  const expectedValue = typeof pendingSearchFocus.value === "string" ? pendingSearchFocus.value : "";
  if (search.value !== expectedValue) {
    search.value = expectedValue;
  }

  search.focus();
  const nextCursor = Math.min(
    Number.isInteger(pendingSearchFocus.cursor) ? pendingSearchFocus.cursor : expectedValue.length,
    search.value.length
  );
  if (typeof search.setSelectionRange === "function") {
    search.setSelectionRange(nextCursor, nextCursor);
  }

  applyInventoryListFilter(
    search.value,
    cat ? cat.value : "all",
    wear ? wear.value : "all",
    sort ? sort.value : "name-asc"
  );
}

function applyInventoryListFilter(queryValue, categoryValue, wearValue, sortValue) {
  const list = document.getElementById("inventory-list");
  const cards = [...document.querySelectorAll("[data-role='inventory-item']")];
  const noMatches = document.getElementById("inventory-no-matches");
  const sort = String(sortValue || "name-asc").trim().toLowerCase() || "name-asc";
  if (!cards.length) {
    if (noMatches) noMatches.style.display = "";
    return;
  }

  const sortedCards = [...cards].sort((a, b) => {
    const nameA = String(a.getAttribute("data-name") || "").toLowerCase();
    const nameB = String(b.getAttribute("data-name") || "").toLowerCase();
    const categoryA = String(a.getAttribute("data-category") || "").toLowerCase();
    const categoryB = String(b.getAttribute("data-category") || "").toLowerCase();
    const stockA = Number(a.getAttribute("data-stock") || 0);
    const stockB = Number(b.getAttribute("data-stock") || 0);
    const updatedA = Number(a.getAttribute("data-updated") || 0);
    const updatedB = Number(b.getAttribute("data-updated") || 0);
    const expiryA = Number(a.getAttribute("data-expiry") || Number.MAX_SAFE_INTEGER);
    const expiryB = Number(b.getAttribute("data-expiry") || Number.MAX_SAFE_INTEGER);
    const wearA = Number(a.getAttribute("data-wear") || -1);
    const wearB = Number(b.getAttribute("data-wear") || -1);

    if (sort === "name-desc") return nameB.localeCompare(nameA);
    if (sort === "category") {
      const byCategory = categoryA.localeCompare(categoryB);
      return byCategory || nameA.localeCompare(nameB);
    }
    if (sort === "stock-low") {
      const byStock = stockA - stockB;
      return byStock || nameA.localeCompare(nameB);
    }
    if (sort === "stock-high") {
      const byStock = stockB - stockA;
      return byStock || nameA.localeCompare(nameB);
    }
    if (sort === "wear-high") {
      const byWear = wearB - wearA;
      return byWear || nameA.localeCompare(nameB);
    }
    if (sort === "wear-low") {
      const byWear = wearA - wearB;
      return byWear || nameA.localeCompare(nameB);
    }
    if (sort === "recent") {
      const byUpdated = updatedB - updatedA;
      return byUpdated || nameA.localeCompare(nameB);
    }
    if (sort === "expiry") {
      const byExpiry = expiryA - expiryB;
      return byExpiry || nameA.localeCompare(nameB);
    }
    return nameA.localeCompare(nameB);
  });

  if (list) {
    sortedCards.forEach((card) => {
      list.appendChild(card);
    });
  }

  const query = String(queryValue || "").trim().toLowerCase();
  const category = String(categoryValue || "all").trim().toLowerCase() || "all";
  const wear = String(wearValue || "all").trim().toLowerCase() || "all";
  let visibleCount = 0;

  sortedCards.forEach((card) => {
    const itemName = String(card.getAttribute("data-name") || "").toLowerCase();
    const itemBrand = String(card.getAttribute("data-brand") || "").toLowerCase();
    const itemCategory = String(card.getAttribute("data-category") || "").toLowerCase();
    const wearEnabled = card.getAttribute("data-wear-enabled") === "1";
    const wearLevel = String(card.getAttribute("data-wear-level") || "none").toLowerCase();
    const byText = !query || itemName.includes(query) || itemBrand.includes(query);
    const byCategory = category === "all" || itemCategory === category;
    const byWear =
      wear === "all" ||
      (wear === "brand-new" && wearEnabled && wearLevel === "brand-new") ||
      (wear === "tracked" && wearEnabled) ||
      (wear === "none" && !wearEnabled) ||
      (wearEnabled && wearLevel === wear);
    const isVisible = byText && byCategory && byWear;
    card.style.display = isVisible ? "" : "none";
    if (isVisible) visibleCount += 1;
  });

  if (noMatches) {
    noMatches.style.display = visibleCount ? "none" : "";
  }
}

function setInventoryFilteringIndicator(isVisible) {
  const indicator = document.getElementById("inventory-filtering");
  if (!indicator) return;

  if (filterIndicatorHideTimer) {
    clearTimeout(filterIndicatorHideTimer);
    filterIndicatorHideTimer = null;
  }

  if (isVisible) {
    indicator.classList.add("is-visible");
    return;
  }

  filterIndicatorHideTimer = setTimeout(() => {
    indicator.classList.remove("is-visible");
    filterIndicatorHideTimer = null;
  }, 120);
}

function setNotificationCenterOpen(isOpen) {
  const panel = document.getElementById("norder-notification-center");
  const trigger = document.getElementById("open-notifications");
  if (!panel || !trigger) return;

  if (isOpen) {
    panel.removeAttribute("hidden");
    trigger.setAttribute("aria-expanded", "true");
  } else {
    panel.setAttribute("hidden", "hidden");
    trigger.setAttribute("aria-expanded", "false");
  }
}

function setCategoryEditMode(row, isEditing) {
  if (!row) return;
  const display = row.querySelector("[data-role='category-display']");
  const displayActions = row.querySelector("[data-role='category-actions-display']");
  const editPanel = row.querySelector("[data-role='category-edit']");
  const input = row.querySelector("[data-role='category-name-input']");
  const colorInput = row.querySelector("[data-role='category-color-input']");

  if (display) display.style.display = isEditing ? "none" : "";
  if (displayActions) displayActions.style.display = isEditing ? "none" : "";
  if (editPanel) editPanel.style.display = isEditing ? "flex" : "none";

  if (!input) return;
  if (isEditing) {
    input.focus();
    if (typeof input.select === "function") input.select();
  } else {
    const originalName = String(input.getAttribute("data-original-name") || "");
    input.value = originalName;
    if (colorInput) {
      const originalColor = String(colorInput.getAttribute("data-original-color") || "#6366f1");
      colorInput.value = originalColor;
    }
  }
}

function setCategoryAddMode(isAdding) {
  const panel = document.getElementById("category-add-panel");
  const nameInput = document.getElementById("category-add-name");
  const iconInput = document.getElementById("category-add-icon");
  const colorInput = document.getElementById("category-add-color");
  if (!panel || !nameInput || !iconInput) return;

  panel.style.display = isAdding ? "flex" : "none";
  if (isAdding) {
    nameInput.focus();
    if (typeof nameInput.select === "function") nameInput.select();
    return;
  }

  nameInput.value = "";
  iconInput.value = "";
  if (colorInput) colorInput.value = "#6366f1";
}

function showSaveNotification(message) {
  if (typeof document === "undefined") return;
  const id = "norder-save-notice";
  let notice = document.getElementById(id);
  if (!notice) {
    notice = document.createElement("div");
    notice.id = id;
    notice.className = "save-notice";
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-live", "polite");
    document.body.appendChild(notice);
  }

  if (saveNoticeHideTimer) {
    clearTimeout(saveNoticeHideTimer);
    saveNoticeHideTimer = null;
  }

  notice.textContent = String(message || "Saved");
  notice.classList.add("is-visible");
  saveNoticeHideTimer = setTimeout(() => {
    notice.classList.remove("is-visible");
    saveNoticeHideTimer = null;
  }, 1800);
}

function closeQuickItemEditor() {
  const modal = document.getElementById(QUICK_EDIT_MODAL_ID);
  if (modal && modal.parentNode) {
    modal.parentNode.removeChild(modal);
  }

  if (quickEditKeydownHandler) {
    document.removeEventListener("keydown", quickEditKeydownHandler);
    quickEditKeydownHandler = null;
  }

  if (document.body) {
    document.body.classList.remove("quick-edit-open");
  }
}

function closeRestockPurchasePrompt() {
  const modal = document.getElementById(RESTOCK_PROMPT_MODAL_ID);
  if (modal && modal.parentNode) {
    modal.parentNode.removeChild(modal);
  }

  if (document.body) {
    document.body.classList.remove("quick-edit-open");
  }
}

const CHECK_INVENTORY_MODAL_ID = "norder-check-inventory";
let checkInventoryKeydownHandler = null;
let addItemKeydownHandler = null;

function _addItemBackdropClick(e) {
  if (e.target === e.currentTarget) toggleForm(false);
}

function closeInventoryCheck() {
  const modal = document.getElementById(CHECK_INVENTORY_MODAL_ID);
  if (modal && modal.parentNode) {
    modal.parentNode.removeChild(modal);
  }
  if (checkInventoryKeydownHandler) {
    document.removeEventListener("keydown", checkInventoryKeydownHandler);
    checkInventoryKeydownHandler = null;
  }
  if (document.body) {
    document.body.classList.remove("quick-edit-open");
  }
}

function openInventoryCheck(onRender) {
  if (typeof document === "undefined") return;
  closeInventoryCheck();

  const state = getState();
  const items = [...state.items];
  if (!items.length) {
    alert("No inventory items to check.");
    return;
  }

  const catColorMap = {};
  (state.categories || []).forEach((c) => { catColorMap[c.name] = c.color || ""; });

  let currentIndex = 0;
  let skippedCount = 0;
  let savedCount = 0;
  const pendingChanges = {};

  const overlay = document.createElement("div");
  overlay.id = CHECK_INVENTORY_MODAL_ID;
  overlay.className = "quick-edit-overlay";
  overlay.style.cssText = "align-items: center;";
  overlay.innerHTML = `
    <section class="inv-check-sheet" role="dialog" aria-modal="true" aria-labelledby="inv-check-dialog-title">
      <div class="inv-check-header">
        <div class="inv-check-header-left">
          <div class="inv-check-kicker">&#9776; Inventory Check</div>
          <h2 id="inv-check-dialog-title" class="inv-check-title">Review Your Items</h2>
        </div>
        <button type="button" class="ghost" data-role="inv-check-exit" aria-label="Exit inventory check">Exit</button>
      </div>
      <div class="inv-check-progress-wrap">
        <div class="inv-check-progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${items.length}" aria-valuenow="0">
          <span style="width:0%"></span>
        </div>
        <div class="inv-check-progress-label">
          <span data-role="inv-check-progress-text">Item 1 of ${items.length}</span>
          <span class="inv-check-progress-badge" data-role="inv-check-badge">${items.length} to review</span>
        </div>
      </div>
      <div class="inv-check-body" data-role="inv-check-body"></div>
      <div class="inv-check-nav" data-role="inv-check-nav">
        <button type="button" class="ghost" data-role="inv-check-back" disabled>&#8592; Back</button>
        <span class="inv-check-nav-hint" data-role="inv-check-hint">Enter to save &amp; next &bull; Esc to exit</span>
        <div style="display:flex;gap:8px;">
          <button type="button" class="ghost" data-role="inv-check-skip">Skip &#8594;</button>
          <button type="button" class="primary" data-role="inv-check-save">Save &amp; Next &#8594;</button>
        </div>
      </div>
    </section>
  `;

  document.body.appendChild(overlay);
  document.body.classList.add("quick-edit-open");

  const body = overlay.querySelector("[data-role='inv-check-body']");
  const progressBar = overlay.querySelector(".inv-check-progress-bar > span");
  const progressText = overlay.querySelector("[data-role='inv-check-progress-text']");
  const progressBadge = overlay.querySelector("[data-role='inv-check-badge']");
  const nav = overlay.querySelector("[data-role='inv-check-nav']");

  function getItemFieldValues() {
    const stockSel = body.querySelector("[data-role='inv-check-stock']");
    const wearSel = body.querySelector("[data-role='inv-check-wear']");
    const expInput = body.querySelector("[data-role='inv-check-expiry']");
    const qtyInput = body.querySelector("[data-role='inv-check-qty']");
    const nameInput = body.querySelector("[data-role='inv-check-name']");
    const brandInput = body.querySelector("[data-role='inv-check-brand']");
    const catSel = body.querySelector("[data-role='inv-check-category']");
    return {
      stock_level: stockSel ? stockSel.value : null,
      wear_level: wearSel ? wearSel.value : null,
      expiry_date: expInput ? expInput.value : null,
      quantity: qtyInput ? normalizeItemQuantity(qtyInput.value) : null,
      name: nameInput ? String(nameInput.value || "").trim() : null,
      brand_name: brandInput ? String(brandInput.value || "").trim() : null,
      category: catSel ? catSel.value : null,
    };
  }

  function updateProgress(index) {
    const pct = items.length > 0 ? Math.round(((index + 1) / items.length) * 100) : 0;
    if (progressBar) progressBar.style.width = pct + "%";
    const progressBarEl = overlay.querySelector(".inv-check-progress-bar");
    if (progressBarEl) progressBarEl.setAttribute("aria-valuenow", String(index));
    if (progressText) progressText.textContent = `Item ${Math.min(index + 1, items.length)} of ${items.length}`;
    const remaining = items.length - index;
    if (progressBadge) {
      progressBadge.textContent = remaining > 0 ? `${remaining} remaining` : "Done!";
    }
  }

  function renderCurrentItem(animateIn = true) {
    const item = items[currentIndex];
    if (!item) return;

    const catColor = catColorMap[item.category] || "";
    const wear = getItemWearAndTear(item);
    const stockPct = getItemStockPercentage(item);
    const wearPct = wear.enabled ? wear.percentage : 0;
    const isReplace = wear.enabled && wear.percentage >= 100;
    const categories = (state.categories || []).map((c) => c.name);
    const quantity = getItemQuantity(item);
    const pending = pendingChanges[item.id] || {};

    const currentName = pending.name !== undefined ? pending.name : (item.name || "");
    const currentBrand = pending.brand_name !== undefined ? pending.brand_name : (item.brand_name || "");
    const currentStock = pending.stock_level !== undefined ? pending.stock_level : getItemStockLevel(item);
    const currentWear = pending.wear_level !== undefined ? pending.wear_level : (wear.level || "Moderate");
    const currentExpiry = pending.expiry_date !== undefined ? pending.expiry_date : (item.expiry_date || "");
    const currentQty = pending.quantity !== undefined ? pending.quantity : quantity;
    const currentCat = pending.category !== undefined ? pending.category : (item.category || "");

    const barClass = wear.enabled ? (isReplace ? "wear-replace" : "wear") : "";
    const barPct = wear.enabled ? wearPct : stockPct;
    const barLabel = wear.enabled ? `Wear: ${wear.level}` : `Stock: ${getItemStockLevel(item)}`;
    const wearEnabled = wear.enabled;

    const html = `
      <div class="inv-check-card" style="--inv-check-cat-color:${catColor || "var(--primary)"};">
        <div>
          <div class="inv-check-item-name">${escapeHtml(item.name)}</div>
          <div class="inv-check-item-meta">
            <span class="badge">${escapeHtml(item.category)}</span>
            ${item.brand_name ? `<span class="badge">${escapeHtml(item.brand_name)}</span>` : ""}
            ${item.container_type ? `<span class="badge">${escapeHtml(item.container_type)}</span>` : ""}
            ${item.expiry_date ? `<span class="help" style="font-size:0.74rem;">Exp: ${escapeHtml(item.expiry_date)}</span>` : ""}
          </div>
        </div>
        <div class="inv-check-status-bar-wrap">
          <div class="inv-check-status-bar-label">
            <span>${escapeHtml(barLabel)}</span>
            <span>${barPct}%</span>
          </div>
          <div class="inv-check-status-bar ${barClass}">
            <span style="width:${barPct}%"></span>
          </div>
        </div>
        <div class="inv-check-fields">
          <div class="inv-check-fields-row">
            <label class="field" for="inv-check-name-input">
              <span class="field-label">Item name</span>
              <input id="inv-check-name-input" data-role="inv-check-name" maxlength="50" value="${escapeAttr(currentName)}" />
            </label>
            <label class="field" for="inv-check-brand-input">
              <span class="field-label">Brand (optional)</span>
              <input id="inv-check-brand-input" data-role="inv-check-brand" maxlength="50" value="${escapeAttr(currentBrand)}" />
            </label>
          </div>
          <div class="inv-check-fields-row">
            <label class="field" for="inv-check-category-sel">
              <span class="field-label">Category</span>
              <select id="inv-check-category-sel" data-role="inv-check-category">
                ${categories.map((c) => `<option${c === currentCat ? " selected" : ""}>${escapeHtml(c)}</option>`).join("")}
              </select>
            </label>
            <label class="field" for="inv-check-qty-input">
              <span class="field-label">Quantity</span>
              <input id="inv-check-qty-input" data-role="inv-check-qty" type="number" min="1" max="24" value="${currentQty}" />
            </label>
          </div>
          ${
            !wearEnabled
              ? `<label class="field" for="inv-check-stock-sel">
              <span class="field-label">Stock level</span>
              <select id="inv-check-stock-sel" data-role="inv-check-stock">
                ${STOCK_LEVELS.map((l) => `<option${l === currentStock ? " selected" : ""}>${escapeHtml(l)}</option>`).join("")}
              </select>
            </label>`
              : ""
          }
          ${
            wearEnabled
              ? `<label class="field" for="inv-check-wear-sel">
              <span class="field-label">Wear level</span>
              <select id="inv-check-wear-sel" data-role="inv-check-wear">
                ${WEAR_LEVELS.map((l) => `<option${l === currentWear ? " selected" : ""}>${escapeHtml(l)}</option>`).join("")}
              </select>
            </label>`
              : ""
          }
          <label class="field" for="inv-check-expiry-input">
            <span class="field-label">Expiry date</span>
            <input id="inv-check-expiry-input" data-role="inv-check-expiry" type="date" value="${escapeAttr(currentExpiry)}" style="max-width:180px;" />
          </label>
        </div>
      </div>
    `;

    body.innerHTML = html;
    if (animateIn) {
      const card = body.querySelector(".inv-check-card");
      if (card) {
        card.style.animation = "none";
        card.style.opacity = "0";
        card.style.transform = "translateY(12px) scale(0.98)";
        requestAnimationFrame(() => {
          card.style.animation = "";
          card.style.opacity = "";
          card.style.transform = "";
        });
      }
    }

    updateProgress(currentIndex);

    const backBtn = overlay.querySelector("[data-role='inv-check-back']");
    if (backBtn) backBtn.disabled = currentIndex === 0;

    const firstInput = body.querySelector("input, select");
    if (firstInput) firstInput.focus();
  }

  function commitSave() {
    const item = items[currentIndex];
    if (!item) return;

    const vals = getItemFieldValues();
    const name = vals.name;
    if (!name) {
      const nameInput = body.querySelector("[data-role='inv-check-name']");
      if (nameInput) nameInput.focus();
      return false;
    }

    const wearEnabled = getItemWearAndTear(item).enabled;
    const stockLevel = !wearEnabled ? normalizeStockLevel(vals.stock_level, 50) : getItemStockLevel(item);
    const wearLevel = wearEnabled ? normalizeWearLevel(vals.wear_level || "") : "";
    const qty = vals.quantity || getItemQuantity(item);
    const expiry = vals.expiry_date !== null ? vals.expiry_date : (item.expiry_date || "");

    pendingChanges[item.id] = {
      name,
      brand_name: vals.brand_name !== null ? vals.brand_name : (item.brand_name || ""),
      category: vals.category || item.category,
      stock_level: stockLevel,
      wear_level: wearLevel,
      expiry_date: expiry,
      quantity: qty,
    };
    savedCount++;
    return true;
  }

  function applyAllAndClose() {
    const next = deepClone(getState());
    let changedCount = 0;

    next.items = next.items.map((item) => {
      const changes = pendingChanges[item.id];
      if (!changes) return item;
      changedCount++;

      const wearEnabled = item.wear_and_tear_enabled;
      const newQty = normalizeItemQuantity(changes.quantity);
      const newWearLevel = wearEnabled ? normalizeWearLevel(changes.wear_level || "") : "";
      const newWearPct = wearEnabled ? getWearPercentageForLevel(newWearLevel) : 0;
      const newStockLevel = !wearEnabled ? normalizeStockLevel(changes.stock_level, 50) : "Full";
      const newStockPct = !wearEnabled ? stockLevelToPercentage(newStockLevel) : 100;
      const unitStockLevels = !wearEnabled && newQty > 1
        ? buildUnitStockLevels(newQty, getItemUnitStockLevels(item), newStockLevel)
        : [];
      const unitWearLevels = wearEnabled && newQty > 1
        ? buildUnitWearLevels(newQty, getItemUnitWearLevels(item), newWearLevel)
        : [];
      const shouldRestock = wearEnabled
        ? isReplaceWorthyWear(true, newWearLevel, newWearPct)
        : isLowStockLevel(newStockLevel);

      return {
        ...item,
        name: changes.name,
        brand_name: changes.brand_name,
        category: changes.category,
        stock_level: newStockLevel,
        percentage: newStockPct,
        unit_stock_levels: unitStockLevels,
        wear_level: newWearLevel,
        wear_percentage: newWearPct,
        wear_unit_levels: unitWearLevels,
        expiry_date: changes.expiry_date,
        quantity: newQty,
        in_shopping_list: shouldRestock,
        updated_date: Date.now(),
      };
    });

    setState(next);
    saveState();

    if (changedCount > 0) {
      trackInventoryChange("bulk_inventory_check", `Inventory check completed: ${changedCount} item(s) updated`, {
        updated_count: changedCount,
        skipped_count: skippedCount,
      });
    }

    onRender();
    if (changedCount > 0) {
      showSaveNotification(`Inventory check done. ${changedCount} item${changedCount === 1 ? "" : "s"} updated.`);
    }
  }

  function showCompletionScreen() {
    if (progressBar) progressBar.style.width = "100%";
    if (progressText) progressText.textContent = `All ${items.length} items reviewed`;
    if (progressBadge) progressBadge.textContent = "Complete!";

    body.innerHTML = `
      <div class="inv-check-complete">
        <div class="inv-check-complete-icon">&#127942;</div>
        <h3 class="inv-check-complete-title">Inventory Check Complete!</h3>
        <p class="inv-check-complete-copy">You've reviewed all ${items.length} item${items.length === 1 ? "" : "s"} in this inventory space.</p>
        <div class="inv-check-complete-stats">
          <div class="inv-check-stat-card">
            <div class="inv-check-stat-number">${items.length}</div>
            <div class="inv-check-stat-label">Total</div>
          </div>
          <div class="inv-check-stat-card">
            <div class="inv-check-stat-number">${savedCount}</div>
            <div class="inv-check-stat-label">Saved</div>
          </div>
          <div class="inv-check-stat-card">
            <div class="inv-check-stat-number">${skippedCount}</div>
            <div class="inv-check-stat-label">Skipped</div>
          </div>
        </div>
      </div>
    `;

    if (nav) {
      nav.innerHTML = `
        <span></span>
        <span class="inv-check-nav-hint">Changes have been saved to your inventory.</span>
        <button type="button" class="primary" data-role="inv-check-done">Close &amp; Apply</button>
      `;
      const doneBtn = nav.querySelector("[data-role='inv-check-done']");
      if (doneBtn) {
        doneBtn.addEventListener("click", () => {
          applyAllAndClose();
          closeInventoryCheck();
        });
      }
    }
  }

  function goToNext(wasSaved) {
    if (wasSaved) {
      const card = body.querySelector(".inv-check-card");
      if (card) {
        card.classList.add("inv-check-card-exit");
        setTimeout(() => {
          currentIndex++;
          if (currentIndex >= items.length) {
            showCompletionScreen();
          } else {
            renderCurrentItem(true);
          }
        }, 150);
      } else {
        currentIndex++;
        if (currentIndex >= items.length) {
          showCompletionScreen();
        } else {
          renderCurrentItem(true);
        }
      }
    } else {
      currentIndex++;
      if (currentIndex >= items.length) {
        showCompletionScreen();
      } else {
        renderCurrentItem(true);
      }
    }
  }

  overlay.addEventListener("click", (e) => {
    const role = e.target.closest("[data-role]")?.getAttribute("data-role");
    if (e.target === overlay) {
      closeInventoryCheck();
      return;
    }
    if (role === "inv-check-exit") {
      closeInventoryCheck();
      return;
    }
    if (role === "inv-check-save") {
      const saved = commitSave();
      if (saved === false) return;
      goToNext(true);
      return;
    }
    if (role === "inv-check-skip") {
      skippedCount++;
      goToNext(false);
      return;
    }
    if (role === "inv-check-back") {
      if (currentIndex > 0) {
        currentIndex--;
        renderCurrentItem(true);
      }
      return;
    }
  });

  checkInventoryKeydownHandler = (e) => {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
      if (e.key === "Enter" && tag !== "TEXTAREA") {
        e.preventDefault();
        const saveBtn = overlay.querySelector("[data-role='inv-check-save']");
        if (saveBtn && !saveBtn.hidden) saveBtn.click();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeInventoryCheck();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeInventoryCheck();
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const saveBtn = overlay.querySelector("[data-role='inv-check-save']");
      if (saveBtn && !saveBtn.hidden) saveBtn.click();
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      const skipBtn = overlay.querySelector("[data-role='inv-check-skip']");
      if (skipBtn && !skipBtn.hidden) skipBtn.click();
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      const backBtn = overlay.querySelector("[data-role='inv-check-back']");
      if (backBtn && !backBtn.disabled && !backBtn.hidden) backBtn.click();
    }
  };

  document.addEventListener("keydown", checkInventoryKeydownHandler);

  renderCurrentItem(false);
}

function askRestockPurchaseDetails(items) {
  if (!Array.isArray(items) || !items.length || typeof document === "undefined") {
    return Promise.resolve({});
  }

  closeRestockPurchasePrompt();

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.id = RESTOCK_PROMPT_MODAL_ID;
    overlay.className = "quick-edit-overlay restock-prompt-overlay";
    overlay.innerHTML = `
      <section class="quick-edit-sheet restock-prompt-sheet" role="dialog" aria-modal="true" aria-labelledby="restock-prompt-title">
        <div class="quick-edit-header">
          <div>
            <div class="restock-prompt-kicker">Restock Check-In</div>
            <h2 id="restock-prompt-title" class="restock-prompt-title">Did you buy more items?</h2>
            <p class="restock-prompt-copy">For each checked item, confirm whether you purchased extra quantity and enter how many.</p>
          </div>
          <button type="button" class="ghost" data-role="restock-prompt-cancel">Close</button>
        </div>
        <div class="restock-prompt-list" data-role="restock-prompt-list"></div>
        <div class="quick-edit-actions">
          <button type="button" class="ghost" data-role="restock-prompt-cancel">Cancel</button>
          <button type="button" class="primary" data-role="restock-prompt-confirm">Apply Restock</button>
        </div>
      </section>
    `;

    document.body.appendChild(overlay);
    document.body.classList.add("quick-edit-open");

    const list = overlay.querySelector("[data-role='restock-prompt-list']");
    const confirmBtn = overlay.querySelector("[data-role='restock-prompt-confirm']");
    if (!list || !confirmBtn) {
      closeRestockPurchasePrompt();
      resolve({});
      return;
    }

    items.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "restock-prompt-row";

      const header = document.createElement("div");
      header.className = "restock-prompt-row-header";

      const itemName = document.createElement("div");
      itemName.className = "item-name";
      itemName.textContent = String(item && item.name ? item.name : "Item");

      const currentQty = document.createElement("div");
      currentQty.className = "restock-prompt-current-qty";
      const knownQuantity = getItemQuantity(item);
      currentQty.textContent = `Current quantity: ${knownQuantity}`;

      header.appendChild(itemName);
      header.appendChild(currentQty);

      const controls = document.createElement("div");
      controls.className = "restock-prompt-controls";

      const currentBrand = String((item && item.brand_name) || "").trim();
      const previousItem = index > 0 ? items[index - 1] : null;
      const lastItemBrand = String((previousItem && previousItem.brand_name) || currentBrand || "").trim();
      const sameBrandReference = lastItemBrand || currentBrand;

      const toggleLabel = document.createElement("label");
      toggleLabel.className = "restock-prompt-toggle";
      const toggleInput = document.createElement("input");
      toggleInput.type = "checkbox";
      toggleInput.setAttribute("data-role", "restock-prompt-toggle");
      toggleInput.setAttribute("data-id", String(item.id || ""));
      const toggleText = document.createElement("span");
      toggleText.textContent = "Yes, I purchased more";
      toggleLabel.appendChild(toggleInput);
      toggleLabel.appendChild(toggleText);

      const sameBrandLabel = document.createElement("label");
      sameBrandLabel.className = "restock-prompt-toggle";
      const sameBrandInput = document.createElement("input");
      sameBrandInput.type = "checkbox";
      sameBrandInput.checked = true;
      sameBrandInput.setAttribute("data-role", "restock-prompt-same-brand");
      sameBrandInput.setAttribute("data-id", String(item.id || ""));
      sameBrandInput.setAttribute("data-brand-reference", sameBrandReference);
      sameBrandInput.setAttribute("data-current-brand", currentBrand);
      const sameBrandText = document.createElement("span");
      sameBrandText.textContent = "Is this the same brand as the last item added?";
      sameBrandLabel.appendChild(sameBrandInput);
      sameBrandLabel.appendChild(sameBrandText);

      const brandField = document.createElement("label");
      brandField.className = "restock-prompt-extra";
      brandField.setAttribute("data-role", "restock-prompt-brand-field");
      brandField.style.display = "none";

      const brandText = document.createElement("span");
      brandText.className = "field-label";
      brandText.textContent = "Brand name";

      const brandInput = document.createElement("input");
      brandInput.type = "text";
      brandInput.maxLength = "50";
      brandInput.value = currentBrand;
      brandInput.setAttribute("data-role", "restock-prompt-brand");
      brandInput.setAttribute("data-id", String(item.id || ""));

      brandField.appendChild(brandText);
      brandField.appendChild(brandInput);

      const quantityField = document.createElement("label");
      quantityField.className = "restock-prompt-extra";
      quantityField.setAttribute("data-role", "restock-prompt-extra-field");
      quantityField.style.display = "none";

      const quantityText = document.createElement("span");
      quantityText.className = "field-label";
      quantityText.textContent = "How many more?";

      const quantityInput = document.createElement("input");
      quantityInput.type = "number";
      quantityInput.min = "1";
      quantityInput.step = "1";
      quantityInput.value = "1";
      quantityInput.inputMode = "numeric";
      quantityInput.setAttribute("data-role", "restock-prompt-extra");
      quantityInput.setAttribute("data-id", String(item.id || ""));

      quantityField.appendChild(quantityText);
      quantityField.appendChild(quantityInput);

      toggleInput.addEventListener("change", () => {
        const isChecked = Boolean(toggleInput.checked);
        quantityField.style.display = isChecked ? "grid" : "none";
        if (isChecked) {
          quantityInput.focus();
          if (typeof quantityInput.select === "function") quantityInput.select();
        }
      });

      sameBrandInput.addEventListener("change", () => {
        const isSameBrand = Boolean(sameBrandInput.checked);
        brandField.style.display = isSameBrand ? "none" : "grid";
        if (!isSameBrand) {
          brandInput.focus();
          if (typeof brandInput.select === "function") brandInput.select();
        }
      });

      controls.appendChild(toggleLabel);
      controls.appendChild(sameBrandLabel);
      controls.appendChild(brandField);
      controls.appendChild(quantityField);

      row.appendChild(header);
      row.appendChild(controls);
      list.appendChild(row);
    });

    let handled = false;
    const finish = (result) => {
      if (handled) return;
      handled = true;
      document.removeEventListener("keydown", onKeydown);
      closeRestockPurchasePrompt();
      resolve(result);
    };

    const onKeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(null);
      }
    };

    document.addEventListener("keydown", onKeydown);

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        finish(null);
      }
    });

    overlay.querySelectorAll("[data-role='restock-prompt-cancel']").forEach((btn) => {
      btn.addEventListener("click", () => finish(null));
    });

    confirmBtn.addEventListener("click", () => {
      const details = {};
      const quantityInputs = overlay.querySelectorAll("[data-role='restock-prompt-extra']");
      for (const input of quantityInputs) {
        const id = input.getAttribute("data-id");
        if (!id) continue;

        const toggle = overlay.querySelector(`[data-role='restock-prompt-toggle'][data-id='${id}']`);
        const isChecked = Boolean(toggle && toggle.checked);
        const sameBrandToggle = overlay.querySelector(`[data-role='restock-prompt-same-brand'][data-id='${id}']`);
        const isSameBrand = Boolean(sameBrandToggle && sameBrandToggle.checked);
        const brandInput = overlay.querySelector(`[data-role='restock-prompt-brand'][data-id='${id}']`);
        const currentBrand = String((sameBrandToggle && sameBrandToggle.getAttribute("data-current-brand")) || "").trim();
        const referenceBrand = String((sameBrandToggle && sameBrandToggle.getAttribute("data-brand-reference")) || currentBrand).trim();

        let brandName = referenceBrand;
        if (!isSameBrand) {
          brandName = String((brandInput && brandInput.value) || "").trim();
        }

        if (!isChecked) {
          details[id] = {
            added_quantity: 0,
            brand_name: brandName,
          };
          continue;
        }

        const value = Number.parseInt(String(input.value || "0"), 10);
        if (!Number.isFinite(value) || value < 1) {
          input.focus();
          if (typeof input.select === "function") input.select();
          return;
        }

        details[id] = {
          added_quantity: value,
          brand_name: brandName,
        };
      }

      finish(details);
    });
  });
}

function openQuickItemEditor(item, onRender, options = {}) {
  if (typeof document === "undefined") return;

  closeQuickItemEditor();

  const isCreateMode = !item || options.mode === "create";
  const state = getState();
  const categories = state.categories && state.categories.length
    ? state.categories.map((category) => String(category && category.name ? category.name : "").trim()).filter(Boolean)
    : ["Unsorted"];
  const fallbackCategory = categories[0] || "Unsorted";
  const oldQuantity = isCreateMode ? 1 : getItemQuantity(item);
  const oldStockLevel = isCreateMode ? "Full" : getItemStockLevel(item);
  const oldWearAndTear = isCreateMode ? { enabled: false, level: "Moderate" } : getItemWearAndTear(item);
  const title = isCreateMode ? "Add Item" : "Edit Item";
  const saveLabel = isCreateMode ? "Save Item" : "Save Changes";

  const overlay = document.createElement("div");
  overlay.id = QUICK_EDIT_MODAL_ID;
  overlay.className = "quick-edit-overlay";
  overlay.innerHTML = `
    <section class="quick-edit-sheet" role="dialog" aria-modal="true" aria-labelledby="quick-edit-title">
      <div class="quick-edit-header">
        <h2 id="quick-edit-title">${title}</h2>
        <button type="button" class="ghost" data-role="quick-edit-cancel">Close</button>
      </div>
      <div class="quick-edit-grid">
        <label class="field" for="quick-edit-name">
          <span class="field-label">Item name</span>
          <input id="quick-edit-name" maxlength="50" />
        </label>
        <label class="field" for="quick-edit-brand">
          <span class="field-label">Brand name (optional)</span>
          <input id="quick-edit-brand" maxlength="50" />
        </label>
        <label class="field" for="quick-edit-category">
          <span class="field-label">Category</span>
          <select id="quick-edit-category"></select>
        </label>
        <label class="field" for="quick-edit-stock-level">
          <span class="field-label">Stock level</span>
          <select id="quick-edit-stock-level" aria-describedby="quick-edit-stock-level-note"></select>
          <span id="quick-edit-stock-level-note" class="help" style="display:none;margin-top:4px;">Disabled because stock is controlled elsewhere for this item.</span>
        </label>
        <div class="row form-row-two">
          <label class="field" for="quick-edit-container-type">
            <span class="field-label">Container (optional)</span>
            <select id="quick-edit-container-type"></select>
          </label>
          <label class="field" for="quick-edit-quantity">
            <span class="field-label">Quantity</span>
            <input id="quick-edit-quantity" type="number" min="1" max="24" />
          </label>
        </div>
        <label class="field" for="quick-edit-enable-wear-and-tear">
          <span class="field-label">Wear and tear (optional)</span>
          <label class="row" style="gap:8px;align-items:center;justify-content:flex-start;margin:0;">
            <input id="quick-edit-enable-wear-and-tear" type="checkbox" style="width:auto;" />
            <span class="help" style="margin:0;">This item needs wear-and-tear tracking</span>
          </label>
        </label>
        <label id="quick-edit-wear-and-tear-config" class="field" for="quick-edit-wear-and-tear-level" style="display:none;">
          <span class="field-label">Wear level</span>
          <select id="quick-edit-wear-and-tear-level"></select>
        </label>
        <div id="quick-edit-unit-wear-levels" class="unit-level-wrap"></div>
        <div id="quick-edit-unit-stock-levels" class="unit-level-wrap"></div>
        <label class="field" for="quick-edit-expiry">
          <span class="field-label">Expiry date</span>
          <input id="quick-edit-expiry" type="date" style="max-width:160px;" />
        </label>
        <p class="help">For multi-quantity items, set stock and wear levels for each unit below.</p>
      </div>
      <div class="quick-edit-actions">
        <button type="button" class="ghost" data-role="quick-edit-cancel">Cancel</button>
        <button type="button" class="primary" data-role="quick-edit-save">${saveLabel}</button>
      </div>
    </section>
  `;

  document.body.appendChild(overlay);
  document.body.classList.add("quick-edit-open");

  const nameInput = document.getElementById("quick-edit-name");
  const categoryInput = document.getElementById("quick-edit-category");
  const stockLevelInput = document.getElementById("quick-edit-stock-level");
  const brandNameInput = document.getElementById("quick-edit-brand");
  const containerTypeInput = document.getElementById("quick-edit-container-type");
  const quantityInput = document.getElementById("quick-edit-quantity");
  const expiryInput = document.getElementById("quick-edit-expiry");
  const wearAndTearEnabledInput = document.getElementById("quick-edit-enable-wear-and-tear");
  const wearAndTearLevelInput = document.getElementById("quick-edit-wear-and-tear-level");
  const wearAndTearConfig = document.getElementById("quick-edit-wear-and-tear-config");
  const unitWearLevelsContainer = document.getElementById("quick-edit-unit-wear-levels");
  const unitLevelsContainer = document.getElementById("quick-edit-unit-stock-levels");

  if (
    !nameInput ||
    !categoryInput ||
    !stockLevelInput ||
    !containerTypeInput ||
    !quantityInput ||
    !expiryInput ||
    !wearAndTearEnabledInput ||
    !wearAndTearLevelInput ||
    !wearAndTearConfig ||
    !unitWearLevelsContainer ||
    !unitLevelsContainer
  ) {
    closeQuickItemEditor();
    return;
  }

  function syncQuickWearAndTearFields() {
    const enabled = Boolean(wearAndTearEnabledInput.checked);
    wearAndTearConfig.style.display = enabled ? "" : "none";
    syncQuickStockLevelAvailability();
    if (enabled) {
      wearAndTearLevelInput.value = normalizeWearLevel(wearAndTearLevelInput.value);
    }
  }

  function syncQuickStockLevelAvailability(unitLevels) {
    const stockLevelNote = document.getElementById("quick-edit-stock-level-note");
    const quantity = normalizeItemQuantity(quantityInput.value);
    const wearEnabled = Boolean(wearAndTearEnabledInput.checked);
    const message = getStockLevelDisableMessage(quantity, wearEnabled);
    stockLevelInput.disabled = Boolean(message);
    if (stockLevelNote) {
      stockLevelNote.textContent = message;
      stockLevelNote.style.display = message ? "" : "none";
    }

    const safeLevels = Array.isArray(unitLevels) ? unitLevels : getQuickFormUnitStockLevels();
    if (!wearEnabled && quantity > 1 && safeLevels.length > 1) {
      stockLevelInput.value = getAggregateStockLevel(safeLevels, stockLevelInput.value);
    }
  }

  function getQuickFormUnitStockLevels() {
    return [...unitLevelsContainer.querySelectorAll("[data-role='quick-edit-unit-stock-level']")].map((el) =>
      normalizeStockLevel(el && el.value, 50)
    );
  }

  function getQuickFormUnitWearLevels() {
    return [...unitWearLevelsContainer.querySelectorAll("[data-role='quick-edit-unit-wear-level']")].map((el) =>
      normalizeWearLevel(el && el.value)
    );
  }

  function renderQuickUnitStockLevelFields(levels) {
    const safeLevels = Array.isArray(levels) ? levels : [];
    if (safeLevels.length <= 1) {
      unitLevelsContainer.innerHTML = "";
      unitLevelsContainer.classList.remove("open");
      return;
    }

    unitLevelsContainer.classList.add("open");
    unitLevelsContainer.innerHTML = `
      <div class="help">Set fill level for each item:</div>
      <div class="unit-level-grid">
        ${safeLevels
          .map(
            (level, index) => `
              <label class="field" for="quick-edit-unit-level-${index}">
                <span class="field-label">Item ${index + 1}</span>
                <select id="quick-edit-unit-level-${index}" data-role="quick-edit-unit-stock-level">
                  ${STOCK_LEVELS.map(
                    (stockLevel) => `<option ${level === stockLevel ? "selected" : ""}>${stockLevel}</option>`
                  ).join("")}
                </select>
              </label>
            `
          )
          .join("")}
      </div>
    `;
  }

  function renderQuickUnitWearLevelFields(levels) {
    const safeLevels = Array.isArray(levels) ? levels : [];
    if (safeLevels.length <= 1) {
      unitWearLevelsContainer.innerHTML = "";
      unitWearLevelsContainer.classList.remove("open");
      return;
    }

    unitWearLevelsContainer.classList.add("open");
    unitWearLevelsContainer.innerHTML = `
      <div class="help">Set wear level for each item:</div>
      <div class="unit-level-grid">
        ${safeLevels
          .map(
            (level, index) => `
              <label class="field" for="quick-edit-unit-wear-level-${index}">
                <span class="field-label">Item ${index + 1}</span>
                <select id="quick-edit-unit-wear-level-${index}" data-role="quick-edit-unit-wear-level">
                  ${WEAR_LEVELS.map((wearLevel) => `<option ${level === wearLevel ? "selected" : ""}>${wearLevel}</option>`).join("")}
                </select>
              </label>
            `
          )
          .join("")}
      </div>
    `;
  }

  function syncQuickUnitStockLevelFields(preferredLevels, options = {}) {
    if (wearAndTearEnabledInput.checked) {
      renderQuickUnitStockLevelFields([]);
      syncQuickStockLevelAvailability([]);
      return;
    }

    const commitQuantity = Boolean(options && options.commitQuantity);
    const rawQuantity = typeof quantityInput.value === "string" ? quantityInput.value.trim() : "";
    if (!rawQuantity) {
      if (!commitQuantity) {
        renderQuickUnitStockLevelFields([]);
        return;
      }
      const fallbackQuantity = normalizeItemQuantity(rawQuantity);
      quantityInput.value = String(fallbackQuantity);
    }

    const quantity = normalizeItemQuantity(quantityInput.value);
    if (commitQuantity) quantityInput.value = String(quantity);
    const fallbackStockLevel = normalizeStockLevel(stockLevelInput.value, 50);
    const sourceLevels = Array.isArray(preferredLevels) ? preferredLevels : getQuickFormUnitStockLevels();
    const normalizedLevels = quantity > 1 ? buildUnitStockLevels(quantity, sourceLevels, fallbackStockLevel) : [];
    renderQuickUnitStockLevelFields(normalizedLevels);
    syncQuickStockLevelAvailability(normalizedLevels);
  }

  function syncQuickUnitWearLevelFields(preferredLevels, options = {}) {
    const commitQuantity = Boolean(options && options.commitQuantity);
    const enabled = Boolean(wearAndTearEnabledInput.checked);
    if (!enabled) {
      renderQuickUnitWearLevelFields([]);
      return;
    }

    const rawQuantity = typeof quantityInput.value === "string" ? quantityInput.value.trim() : "";
    if (!rawQuantity) {
      if (!commitQuantity) {
        renderQuickUnitWearLevelFields([]);
        return;
      }
      quantityInput.value = String(normalizeItemQuantity(rawQuantity));
    }

    const quantity = normalizeItemQuantity(quantityInput.value);
    if (commitQuantity) quantityInput.value = String(quantity);
    const fallbackWearLevel = normalizeWearLevel(wearAndTearLevelInput.value);
    const sourceLevels = Array.isArray(preferredLevels) ? preferredLevels : getQuickFormUnitWearLevels();
    const normalizedLevels = buildUnitWearLevels(quantity, sourceLevels, fallbackWearLevel);
    renderQuickUnitWearLevelFields(normalizedLevels);
  }

  categoryInput.innerHTML = categories.map((name) => `<option>${name}</option>`).join("");
  stockLevelInput.innerHTML = STOCK_LEVELS.map((level) => `<option>${level}</option>`).join("");
  containerTypeInput.innerHTML = ["", ...CONTAINER_TYPES]
    .map((type) => `<option value="${type}">${type || "None"}</option>`)
    .join("");
  wearAndTearLevelInput.innerHTML = WEAR_LEVELS.map((level) => `<option>${level}</option>`).join("");

  nameInput.value = isCreateMode ? "" : item.name || "";
  if (brandNameInput) brandNameInput.value = isCreateMode ? "" : item.brand_name || "";
  categoryInput.value = !isCreateMode && categories.includes(item.category) ? item.category : fallbackCategory;
  stockLevelInput.value = oldStockLevel;
  containerTypeInput.value = isCreateMode ? "" : normalizeContainerType(item.container_type);
  quantityInput.value = String(oldQuantity);
  expiryInput.value = isCreateMode ? "" : item.expiry_date || "";
  wearAndTearEnabledInput.checked = oldWearAndTear.enabled;
  wearAndTearLevelInput.value = oldWearAndTear.level;
  syncQuickWearAndTearFields();
  syncQuickUnitWearLevelFields(isCreateMode ? [] : getItemUnitWearLevels(item), { commitQuantity: true });
  syncQuickUnitStockLevelFields(isCreateMode ? [] : getItemUnitStockLevels(item), { commitQuantity: true });

  quantityInput.addEventListener("input", () => {
    syncQuickUnitStockLevelFields();
    syncQuickUnitWearLevelFields();
  });
  quantityInput.addEventListener("blur", () => {
    syncQuickUnitStockLevelFields(undefined, { commitQuantity: true });
    syncQuickUnitWearLevelFields(undefined, { commitQuantity: true });
  });
  stockLevelInput.addEventListener("change", () => syncQuickUnitStockLevelFields());
  unitLevelsContainer.addEventListener("change", (event) => {
    if (event.target && event.target.matches("[data-role='quick-edit-unit-stock-level']")) {
      syncQuickStockLevelAvailability();
    }
  });
  wearAndTearEnabledInput.addEventListener("change", () => {
    syncQuickWearAndTearFields();
    syncQuickUnitWearLevelFields();
  });
  wearAndTearLevelInput.addEventListener("change", () => {
    wearAndTearLevelInput.value = normalizeWearLevel(wearAndTearLevelInput.value);
    syncQuickUnitWearLevelFields();
  });

  nameInput.focus();
  if (typeof nameInput.select === "function") {
    nameInput.select();
  }

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      closeQuickItemEditor();
    }
  });

  overlay.querySelectorAll("[data-role='quick-edit-cancel']").forEach((btn) => {
    btn.addEventListener("click", () => {
      closeQuickItemEditor();
    });
  });

  const saveBtn = overlay.querySelector("[data-role='quick-edit-save']");
  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      const name = String(nameInput.value || "").trim();
      if (!name) {
        alert("Please add an item name.");
        nameInput.focus();
        return;
      }

      const category = String(categoryInput.value || fallbackCategory);
      const brandName = (brandNameInput && brandNameInput.value ? brandNameInput.value : "").trim();
      const selectedStockLevel = normalizeStockLevel(stockLevelInput.value, 50);
      const quantity = normalizeItemQuantity(quantityInput.value);
      const containerType = normalizeContainerType(containerTypeInput.value);
      const expiry = String(expiryInput.value || "");
      const wearAndTearEnabled = Boolean(wearAndTearEnabledInput.checked);
      const wearAndTearLevel = normalizeWearLevel(wearAndTearLevelInput.value);
      const unitWearLevels = wearAndTearEnabled && quantity > 1
        ? buildUnitWearLevels(quantity, getQuickFormUnitWearLevels(), wearAndTearLevel)
        : [];
      const wearAndTearPercentage = wearAndTearEnabled
        ? unitWearLevels.length
          ? Math.round(unitWearLevels.reduce((sum, level) => sum + getWearPercentageForLevel(level), 0) / unitWearLevels.length)
          : getWearPercentageForLevel(wearAndTearLevel)
        : 0;
      const resolvedWearLevel = wearAndTearEnabled
        ? unitWearLevels.length
          ? getWearLevelForPercentage(wearAndTearPercentage)
          : wearAndTearLevel
        : "";

      const unitStockLevels = quantity > 1
        ? buildUnitStockLevels(quantity, getQuickFormUnitStockLevels(), selectedStockLevel)
        : [];

      const unitAveragePercentage = unitStockLevels.length
        ? Math.round(
            unitStockLevels.reduce((sum, level) => sum + stockLevelToPercentage(level), 0) / unitStockLevels.length
          )
        : 0;
      const stockLevel = unitStockLevels.length
        ? normalizeStockLevel(undefined, unitAveragePercentage)
        : selectedStockLevel;
      const stockPercentage = unitStockLevels.length ? unitAveragePercentage : stockLevelToPercentage(stockLevel);
      const shouldRestock = wearAndTearEnabled
        ? isReplaceWorthyWear(true, resolvedWearLevel, wearAndTearPercentage)
        : isLowStockLevel(stockLevel);

      const next = deepClone(getState());
      const previousScrollY = window.scrollY;

      if (isCreateMode) {
        const newId = safeUuid();
        next.items.unshift({
          id: newId,
          name,
          brand_name: brandName,
          category,
          quantity,
          container_type: containerType,
          unit_stock_levels: unitStockLevels,
          stock_level: stockLevel,
          percentage: stockPercentage,
          wear_and_tear_enabled: wearAndTearEnabled,
          wear_level: resolvedWearLevel,
          wear_percentage: wearAndTearPercentage,
          wear_unit_levels: wearAndTearEnabled ? unitWearLevels : [],
          wear_decay_updated_at: wearAndTearEnabled ? Date.now() : 0,
          in_shopping_list: shouldRestock,
          expiry_date: expiry,
          updated_date: Date.now(),
        });
        if (next.item_tombstones && typeof next.item_tombstones === "object") {
          delete next.item_tombstones[newId];
        }
        trackInventoryChange("item_added", `Added item \"${name}\"`, {
          item_id: newId,
          item_name: name,
          brand_name: brandName || null,
          quantity,
          container_type: containerType || null,
          stock_level: stockLevel,
          wear_and_tear_enabled: wearAndTearEnabled,
          wear_level: resolvedWearLevel || null,
          wear_unit_count: unitWearLevels.length || null,
          expiry_date: expiry,
          category,
        });
      } else {
        next.items = next.items.map((existing) =>
          existing.id === item.id
            ? {
                ...existing,
                name,
                brand_name: brandName,
                category,
                quantity,
                container_type: containerType,
                unit_stock_levels: unitStockLevels,
                stock_level: stockLevel,
                percentage: stockPercentage,
                wear_and_tear_enabled: wearAndTearEnabled,
                wear_level: resolvedWearLevel,
                wear_percentage: wearAndTearPercentage,
                wear_unit_levels: wearAndTearEnabled ? unitWearLevels : [],
                wear_decay_updated_at: wearAndTearEnabled ? Date.now() : 0,
                expiry_date: expiry,
                in_shopping_list: shouldRestock,
                updated_date: Number(existing.updated_date) || Date.now(),
              }
            : existing
        );

        if (next.item_tombstones && typeof next.item_tombstones === "object") {
          delete next.item_tombstones[item.id];
        }

        trackInventoryChange("item_updated", `Updated item \"${name}\"`, {
          item_id: item.id,
          item_name: name,
          brand_name: brandName || null,
          quantity,
          container_type: containerType || null,
          stock_level: stockLevel,
          wear_and_tear_enabled: wearAndTearEnabled,
          wear_level: resolvedWearLevel || null,
          wear_unit_count: unitWearLevels.length || null,
          expiry_date: expiry,
          category,
        });
      }

      setState(next);
      saveState();
      closeQuickItemEditor();
      onRender();
      requestAnimationFrame(() => {
        window.scrollTo({ top: previousScrollY, behavior: "auto" });
      });
      showSaveNotification(`${isCreateMode ? "Added" : "Saved"} item: ${name}`);
    });
  }

  quickEditKeydownHandler = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeQuickItemEditor();
    }
  };
  document.addEventListener("keydown", quickEditKeydownHandler);
}

function setPageFloatingActionVisibility(button, isVisible) {
  if (!button) return;
  button.classList.toggle("is-visible", isVisible);
  button.setAttribute("aria-hidden", isVisible ? "false" : "true");
  button.tabIndex = isVisible ? 0 : -1;
}

function getPageFloatingActionRevealThreshold() {
  if (typeof window === "undefined") return 72;
  const topbarHeight = document.querySelector(".topbar")?.offsetHeight || 56;
  return window.innerWidth <= 640 ? topbarHeight + 40 : topbarHeight + 16;
}

function getPageFloatingActionScrollRoom() {
  if (typeof document === "undefined" || typeof window === "undefined") return 0;
  const root = document.documentElement;
  const body = document.body;
  const contentHeight = Math.max(
    root?.scrollHeight || 0,
    body?.scrollHeight || 0,
    root?.offsetHeight || 0,
    body?.offsetHeight || 0
  );
  return Math.max(0, contentHeight - window.innerHeight);
}

function wirePageFloatingAction(onRender) {
  if (pageFloatingActionCleanup) {
    pageFloatingActionCleanup();
    pageFloatingActionCleanup = null;
  }

  const button = document.getElementById("page-floating-action");
  if (!button) return;

  const label = button.querySelector("[data-role='page-fab-label']");
  const meta = button.querySelector("[data-role='page-fab-meta']");
  const action = button.getAttribute("data-page-action");
  const shoppingChecks = [...document.querySelectorAll("[data-role='buy-check']")];
  const initialScrollY = window.scrollY;
  let isTicking = false;
  let hideTimer = null;
  const IDLE_TIMEOUT_MS = 2500;

  const scheduleHide = () => {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      setPageFloatingActionVisibility(button, false);
      hideTimer = null;
    }, IDLE_TIMEOUT_MS);
  };

  const cancelHide = () => {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  };

  const syncShoppingButton = () => {
    if (action !== "shopping-restock") return;
    const checkedCount = document.querySelectorAll("[data-role='buy-check']:checked").length;
    const hasSelection = checkedCount > 0;
    button.classList.toggle("is-disabled", !hasSelection);
    button.disabled = !hasSelection;
    if (label) {
      label.textContent = hasSelection
        ? `Restock ${checkedCount} Item${checkedCount === 1 ? "" : "s"}`
        : "Restock Checked";
    }
    if (meta) {
      meta.textContent = hasSelection ? "Apply restock now" : "Select items to enable";
    }
  };

  const syncVisibility = () => {
    isTicking = false;
    const revealThreshold = getPageFloatingActionRevealThreshold();
    const scrollRoom = getPageFloatingActionScrollRoom();
    const hasEnoughScrollRoom = scrollRoom > revealThreshold;
    const hasScrolledPastThreshold =
      action === "shopping-restock"
        ? window.scrollY - initialScrollY > revealThreshold
        : window.scrollY > revealThreshold;
    const shouldShow = hasEnoughScrollRoom && hasScrolledPastThreshold;
    setPageFloatingActionVisibility(button, shouldShow);
    if (shouldShow) scheduleHide();
    else cancelHide();
  };

  const requestVisibilitySync = () => {
    cancelHide();
    if (isTicking) return;
    isTicking = true;
    window.requestAnimationFrame(syncVisibility);
  };

  const handleClick = () => {
    if (action === "inventory-add") {
      openQuickItemEditor(null, onRender, { mode: "create" });
      return;
    }

    if (action === "shopping-restock") {
      const restockButton = document.getElementById("restock-selected");
      if (restockButton && !button.disabled) {
        restockButton.click();
      }
    }
  };

  syncVisibility();
  syncShoppingButton();

  window.addEventListener("scroll", requestVisibilitySync, { passive: true });
  window.addEventListener("resize", requestVisibilitySync);
  button.addEventListener("click", handleClick);
  shoppingChecks.forEach((checkbox) => {
    checkbox.addEventListener("change", syncShoppingButton);
  });

  pageFloatingActionCleanup = () => {
    cancelHide();
    window.removeEventListener("scroll", requestVisibilitySync);
    window.removeEventListener("resize", requestVisibilitySync);
    button.removeEventListener("click", handleClick);
    shoppingChecks.forEach((checkbox) => {
      checkbox.removeEventListener("change", syncShoppingButton);
    });
  };
}

function trackInventoryChange(action, summary, details) {
  const inventoryId = getCurrentInventoryId();
  const user = getCurrentUser();
  if (!inventoryId || !user) return;

  logInventoryChange(inventoryId, {
    action,
    summary,
    details,
    actor_uid: user.uid,
    actor_name: user.displayName || user.email || "Member",
    actor_email: user.email || null,
  });
}

function normalizeContainerType(value) {
  const next = typeof value === "string" ? value.trim() : "";
  return CONTAINER_TYPES.includes(next) ? next : "";
}

function normalizeWearLevel(value) {
  const next = typeof value === "string" ? value.trim() : "";
  if (next === "Severe") return "Replace";
  if (next === "BrandNew") return "Brand New";
  return WEAR_LEVELS.includes(next) ? next : "Moderate";
}

function getWearPercentageForLevel(level) {
  return WEAR_LEVEL_TO_PERCENT[normalizeWearLevel(level)] || 50;
}

function getWearLevelForPercentage(percentage) {
  const normalizedPercentage = Math.max(0, Math.min(100, Math.round(Number(percentage) || 0)));
  if (normalizedPercentage <= 10) return "Brand New";
  if (normalizedPercentage <= 35) return "Light";
  if (normalizedPercentage <= 50) return "Moderate";
  if (normalizedPercentage <= 75) return "Heavy";
  return "Replace";
}

function getAggregateStockLevel(levels, fallbackLevel) {
  const safeLevels = Array.isArray(levels) ? levels.map((level) => normalizeStockLevel(level, 50)) : [];
  if (!safeLevels.length) return normalizeStockLevel(fallbackLevel, 50);

  const averagePercentage = Math.round(
    safeLevels.reduce((sum, level) => sum + stockLevelToPercentage(level), 0) / safeLevels.length
  );
  return normalizeStockLevel(undefined, averagePercentage);
}

function getStockLevelDisableMessage(quantity, wearEnabled) {
  if (wearEnabled) return "Disabled while wear tracking is enabled.";
  if (quantity > 1) return "Disabled because quantity above 1 uses the stock level set for each item below.";
  return "";
}

function isReplaceWorthyWear(enabled, level, percentage) {
  if (!enabled) return false;
  const normalizedLevel = normalizeWearLevel(level);
  const normalizedPercentage = Math.max(0, Math.min(100, Math.round(Number(percentage) || 0)));
  return normalizedLevel === "Replace" || normalizedPercentage >= 100;
}

function getItemWearAndTear(item) {
  const enabled = Boolean(item && item.wear_and_tear_enabled);
  const level = normalizeWearLevel(item && item.wear_level);
  const storedPercentage = Number(item && item.wear_percentage);
  return {
    enabled,
    level,
    percentage: Number.isFinite(storedPercentage)
      ? Math.max(0, Math.min(100, Math.round(storedPercentage)))
      : getWearPercentageForLevel(level),
  };
}

function buildUnitWearLevels(quantity, levels, fallbackLevel) {
  const safeQuantity = normalizeItemQuantity(quantity);
  if (safeQuantity <= 1) return [];

  const fallback = normalizeWearLevel(fallbackLevel);
  const source = Array.isArray(levels) ? levels : [];
  return Array.from({ length: safeQuantity }, (_value, index) => normalizeWearLevel(source[index] || fallback));
}

function getItemUnitWearLevels(item) {
  const quantity = getItemQuantity(item);
  const wear = getItemWearAndTear(item);
  if (!wear.enabled || quantity <= 1) return [];
  return buildUnitWearLevels(quantity, item && item.wear_unit_levels, wear.level);
}

function applyAutomaticWearAndTearDecay() {
  const state = getState();
  const items = Array.isArray(state.items) ? state.items : [];
  if (!items.length) return false;

  const now = Date.now();
  let hasChanges = false;
  const next = deepClone(state);

  next.items = items.map((item) => {
    const wear = getItemWearAndTear(item);
    const quantity = getItemQuantity(item);
    if (!wear.enabled) {
      const hadUnitWear = Array.isArray(item && item.wear_unit_levels) && item.wear_unit_levels.length > 0;
      if (Number(item && item.wear_decay_updated_at) > 0 || hadUnitWear) {
        hasChanges = true;
        return {
          ...item,
          wear_decay_updated_at: 0,
          wear_unit_levels: [],
        };
      }
      return item;
    }

    const storedDecayTs = Number(item && item.wear_decay_updated_at);
    const fallbackTs = Number(item && item.updated_date);
    const baselineTs = Number.isFinite(storedDecayTs) && storedDecayTs > 0
      ? storedDecayTs
      : Number.isFinite(fallbackTs) && fallbackTs > 0
      ? fallbackTs
      : now;
    const elapsed = Math.max(0, now - baselineTs);
    const cycles = Math.floor(elapsed / WEAR_DECAY_INTERVAL_MS);
    const stockLevel = getItemStockLevel(item);
    const restockByStock = !wear.enabled && isLowStockLevel(stockLevel);
    const restockByWear = isReplaceWorthyWear(wear.enabled, wear.level, wear.percentage);
    const shouldBeInShopping = Boolean(item.in_shopping_list) || restockByStock || restockByWear;

    if (cycles <= 0) {
      if (!(Number.isFinite(storedDecayTs) && storedDecayTs > 0) || (shouldBeInShopping && !item.in_shopping_list)) {
        hasChanges = true;
        return {
          ...item,
          in_shopping_list: shouldBeInShopping,
          wear_decay_updated_at: now,
        };
      }
      return item;
    }

    const wearDelta = cycles * WEAR_DECAY_PERCENT_PER_INTERVAL;
    const hasUnitWear = quantity > 1;
    const sourceUnitWear = hasUnitWear ? getItemUnitWearLevels(item) : [];
    const nextUnitWearLevels = hasUnitWear
      ? sourceUnitWear.map((level) => {
          const nextPercentage = Math.min(100, getWearPercentageForLevel(level) + wearDelta);
          return getWearLevelForPercentage(nextPercentage);
        })
      : [];
    const nextWearPercentage = nextUnitWearLevels.length
      ? Math.round(
          nextUnitWearLevels.reduce((sum, level) => sum + getWearPercentageForLevel(level), 0) / nextUnitWearLevels.length
        )
      : Math.min(100, wear.percentage + wearDelta);
    const nextWearLevel = getWearLevelForPercentage(nextWearPercentage);
    const nextDecayTs = baselineTs + (cycles * WEAR_DECAY_INTERVAL_MS);
    const nextShouldBeInShopping = Boolean(item.in_shopping_list) || restockByStock || isReplaceWorthyWear(true, nextWearLevel, nextWearPercentage);

    hasChanges = true;
    return {
      ...item,
      in_shopping_list: nextShouldBeInShopping,
      wear_percentage: nextWearPercentage,
      wear_level: nextWearLevel,
      wear_unit_levels: nextUnitWearLevels,
      wear_decay_updated_at: nextDecayTs,
    };
  });

  if (!hasChanges) return false;
  setState(next);
  saveState();
  return true;
}

function syncWearAndTearFormFields() {
  const enabledInput = document.getElementById("item-enable-wear-and-tear");
  const levelInput = document.getElementById("item-wear-and-tear-level");
  const levelWrap = document.getElementById("item-wear-and-tear-config");
  if (!enabledInput || !levelInput || !levelWrap) return;

  const enabled = Boolean(enabledInput.checked);
  levelWrap.style.display = enabled ? "" : "none";
  syncInventoryStockLevelAvailability();
  if (enabled) {
    levelInput.value = normalizeWearLevel(levelInput.value);
  }
}

function syncInventoryStockLevelAvailability(options = {}) {
  const quantityInput = document.getElementById("item-quantity");
  const stockLevelInput = document.getElementById("item-stock-level");
  const stockLevelNote = document.getElementById("item-stock-level-note");
  const wearEnabledInput = document.getElementById("item-enable-wear-and-tear");
  if (!quantityInput || !stockLevelInput) return;

  const quantity = normalizeItemQuantity(quantityInput.value);
  const wearEnabled = Boolean(wearEnabledInput && wearEnabledInput.checked);
  const message = getStockLevelDisableMessage(quantity, wearEnabled);
  stockLevelInput.disabled = Boolean(message);
  if (stockLevelNote) {
    stockLevelNote.textContent = message;
    stockLevelNote.style.display = message ? "" : "none";
  }

  const unitLevels = Array.isArray(options.unitLevels) ? options.unitLevels : getFormUnitStockLevels();
  if (!wearEnabled && quantity > 1 && unitLevels.length > 1) {
    stockLevelInput.value = getAggregateStockLevel(unitLevels, stockLevelInput.value);
  }
}

function getFormUnitWearLevels() {
  return [...document.querySelectorAll("[data-role='unit-wear-level']")].map((el) => normalizeWearLevel(el && el.value));
}

function renderUnitWearLevelFields(levels) {
  const container = document.getElementById("item-unit-wear-levels");
  if (!container) return;

  const safeLevels = Array.isArray(levels) ? levels : [];
  if (safeLevels.length <= 1) {
    container.innerHTML = "";
    container.classList.remove("open");
    return;
  }

  container.classList.add("open");
  container.innerHTML = `
    <div class="help">Set wear level for each item:</div>
    <div class="unit-level-grid">
      ${safeLevels
        .map(
          (level, index) => `
            <label class="field" for="item-unit-wear-level-${index}">
              <span class="field-label">Item ${index + 1}</span>
              <select id="item-unit-wear-level-${index}" data-role="unit-wear-level">
                ${WEAR_LEVELS.map((wearLevel) => `<option ${level === wearLevel ? "selected" : ""}>${wearLevel}</option>`).join("")}
              </select>
            </label>
          `
        )
        .join("")}
    </div>
  `;
}

function syncUnitWearLevelFields(preferredLevels, options = {}) {
  const quantityInput = document.getElementById("item-quantity");
  const wearEnabledInput = document.getElementById("item-enable-wear-and-tear");
  const wearLevelInput = document.getElementById("item-wear-and-tear-level");
  if (!quantityInput || !wearEnabledInput || !wearLevelInput) return;

  const commitQuantity = Boolean(options && options.commitQuantity);
  const enabled = Boolean(wearEnabledInput.checked);
  if (!enabled) {
    renderUnitWearLevelFields([]);
    return;
  }

  const rawQuantity = typeof quantityInput.value === "string" ? quantityInput.value.trim() : "";
  if (!rawQuantity) {
    if (!commitQuantity) {
      renderUnitWearLevelFields([]);
      return;
    }
    quantityInput.value = String(normalizeItemQuantity(rawQuantity));
  }

  const quantity = normalizeItemQuantity(quantityInput.value);
  if (commitQuantity) quantityInput.value = String(quantity);
  const fallbackWearLevel = normalizeWearLevel(wearLevelInput.value);
  const sourceLevels = Array.isArray(preferredLevels) ? preferredLevels : getFormUnitWearLevels();
  const normalizedLevels = buildUnitWearLevels(quantity, sourceLevels, fallbackWearLevel);
  renderUnitWearLevelFields(normalizedLevels);
}

function getFormUnitStockLevels() {
  return [...document.querySelectorAll("[data-role='unit-stock-level']")].map((el) =>
    normalizeStockLevel(el && el.value, 50)
  );
}

function renderUnitStockLevelFields(levels) {
  const container = document.getElementById("item-unit-stock-levels");
  if (!container) return;

  const safeLevels = Array.isArray(levels) ? levels : [];
  if (safeLevels.length <= 1) {
    container.innerHTML = "";
    container.classList.remove("open");
    return;
  }

  container.classList.add("open");
  container.innerHTML = `
    <div class="help">Set fill level for each item:</div>
    <div class="unit-level-grid">
      ${safeLevels
        .map(
          (level, index) => `
            <label class="field" for="item-unit-level-${index}">
              <span class="field-label">Item ${index + 1}</span>
              <select id="item-unit-level-${index}" data-role="unit-stock-level">
                ${STOCK_LEVELS.map(
                  (stockLevel) => `<option ${level === stockLevel ? "selected" : ""}>${stockLevel}</option>`
                ).join("")}
              </select>
            </label>
          `
        )
        .join("")}
    </div>
  `;
}

function syncUnitStockLevelFields(preferredLevels, options = {}) {
  const quantityInput = document.getElementById("item-quantity");
  const stockLevelInput = document.getElementById("item-stock-level");
  const wearEnabledInput = document.getElementById("item-enable-wear-and-tear");
  if (!quantityInput || !stockLevelInput) return;

  if (wearEnabledInput && wearEnabledInput.checked) {
    renderUnitStockLevelFields([]);
    syncInventoryStockLevelAvailability({ unitLevels: [] });
    return;
  }

  const commitQuantity = Boolean(options && options.commitQuantity);
  const rawQuantity = typeof quantityInput.value === "string" ? quantityInput.value.trim() : "";
  if (!rawQuantity) {
    if (commitQuantity) {
      const fallbackQuantity = normalizeItemQuantity(rawQuantity);
      quantityInput.value = String(fallbackQuantity);
      const fallbackStockLevel = normalizeStockLevel(stockLevelInput.value, 50);
      const normalizedLevels = buildUnitStockLevels(fallbackQuantity, getFormUnitStockLevels(), fallbackStockLevel);
      renderUnitStockLevelFields(normalizedLevels);
      syncInventoryStockLevelAvailability({ unitLevels: normalizedLevels });
      return;
    }

    renderUnitStockLevelFields([]);
    syncInventoryStockLevelAvailability({ unitLevels: [] });
    return;
  }

  const quantity = normalizeItemQuantity(rawQuantity);
  if (commitQuantity) quantityInput.value = String(quantity);

  const fallbackStockLevel = normalizeStockLevel(stockLevelInput.value, 50);
  const sourceLevels = Array.isArray(preferredLevels) ? preferredLevels : getFormUnitStockLevels();
  const normalizedLevels = buildUnitStockLevels(quantity, sourceLevels, fallbackStockLevel);
  renderUnitStockLevelFields(normalizedLevels);
  syncInventoryStockLevelAvailability({ unitLevels: normalizedLevels });
}

function redirectPublicLandingToAuth(mode = "login") {
  if (isDesktopLocalMode()) {
    setRoute("/dashboard");
    return;
  }
  const authMode = mode === "signup" ? "signup" : "login";
  setRoute(`/login?mode=${authMode}&intent=add-item`);
}

export function wirePublicLandingEvents() {
  const allowedTabs = new Set(["home", "inventory", "restock", "settings", "budget"]);

  const readSavedLandingTab = () => {
    try {
      const saved = String(sessionStorage.getItem(LANDING_ACTIVE_TAB_KEY) || "").trim();
      return allowedTabs.has(saved) ? saved : "home";
    } catch (_error) {
      return "home";
    }
  };

  const setLandingTab = (tabName) => {
    const raw = String(tabName || "home").trim() || "home";
    const next = allowedTabs.has(raw) ? raw : "home";

    try {
      sessionStorage.setItem(LANDING_ACTIVE_TAB_KEY, next);
    } catch (_error) {
      // Ignore storage failures and continue with in-memory tab state.
    }

    document.querySelectorAll("[data-landing-tab]").forEach((button) => {
      const active = button.getAttribute("data-landing-tab") === next;
      button.classList.toggle("active", active);
      if (button.hasAttribute("aria-pressed")) {
        button.setAttribute("aria-pressed", active ? "true" : "false");
      }
    });

    document.querySelectorAll("[data-landing-panel]").forEach((panel) => {
      panel.hidden = panel.getAttribute("data-landing-panel") !== next;
    });
  };

  document.querySelectorAll("[data-landing-tab]").forEach((button) => {
    button.addEventListener("click", (event) => {
      if (event) event.preventDefault();
      setLandingTab(button.getAttribute("data-landing-tab") || "home");
    });
  });

  const signinBtn = document.getElementById("landing-signin-btn");
  if (signinBtn) {
    signinBtn.addEventListener("click", () => redirectPublicLandingToAuth("login"));
  }

  const signupBtn = document.getElementById("landing-signup-btn");
  if (signupBtn) {
    signupBtn.addEventListener("click", () => redirectPublicLandingToAuth("signup"));
  }

  const openLocalBtn = document.getElementById("landing-open-local-btn");
  if (openLocalBtn) {
    openLocalBtn.addEventListener("click", () => setRoute("/dashboard"));
  }

  const toggleBtn = document.getElementById("landing-toggle-item-form");
  const form = document.getElementById("landing-item-form");
  if (toggleBtn && form) {
    toggleBtn.addEventListener("click", () => {
      form.classList.toggle("open", !form.classList.contains("open"));
    });
  }

  const saveBtn = document.getElementById("landing-save-item");
  if (saveBtn) {
    saveBtn.addEventListener("click", () => redirectPublicLandingToAuth("signup"));
  }

  document.querySelectorAll(".landing-auth-required-action").forEach((button) => {
    button.addEventListener("click", () => redirectPublicLandingToAuth("signup"));
  });

  setLandingTab(readSavedLandingTab());
}

export function wireWelcomeEvents(onRender) {
  const start = document.getElementById("welcome-start");
  const reset = document.getElementById("welcome-reset");

  if (start) start.addEventListener("click", () => {
    const state = getState();
    const n = document.getElementById("welcome-name");
    const h = document.getElementById("welcome-home");

    const next = deepClone(state);
    next.prefs.profile_name = ((n && n.value) || "").trim();
    next.prefs.home_name = ((h && h.value) || defaultHomeName).trim() || defaultHomeName;
    next.prefs.onboarding_complete = true;
    next.prefs.signed_in = false;

    setState(next);
    saveState();
    setRoute("/dashboard");
  });

  if (reset) reset.addEventListener("click", () => {
    resetState();
    saveState();
    onRender();
  });
}

export function wireSharedEvents(onRender) {
  if (pageFloatingActionCleanup) {
    pageFloatingActionCleanup();
    pageFloatingActionCleanup = null;
  }
      // Find My Location button wiring
      const findBtn = document.getElementById('find-my-location');
      const statusEl = document.getElementById('find-location-status');
      if (findBtn) {
        findBtn.addEventListener('click', async () => {
          if (!navigator.geolocation) {
            if (statusEl) statusEl.textContent = 'Location not available.';
            return;
          }
          // Check geolocation permission state if supported
          if (navigator.permissions && navigator.permissions.query) {
            try {
              const perm = await navigator.permissions.query({ name: 'geolocation' });
              if (perm.state === 'denied') {
                if (statusEl) statusEl.innerHTML = 'Location permission is <b>denied</b>. <br>Please enable location access in your browser or device settings and retry.';
                return;
              }
            } catch (e) { /* ignore */ }
          }
          if (statusEl) statusEl.textContent = 'Getting your location...';
          navigator.geolocation.getCurrentPosition(
            (position) => {
              const lat = Number(position.coords && position.coords.latitude);
              const lng = Number(position.coords && position.coords.longitude);
              if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
                if (statusEl) statusEl.textContent = 'Could not read your location.';
                return;
              }
              // Persist to localStorage for dropdowns and map (both keys for compatibility)
              let persisted = {};
              try { persisted = JSON.parse(localStorage.getItem('norder_restock_map_ui_v1') || '{}'); } catch (_) {}
              persisted.center = { lat, lng };
              localStorage.setItem('norder_restock_map_ui_v1', JSON.stringify(persisted));
              // Also update old key for transition
              localStorage.setItem('restock_map_ui', JSON.stringify(persisted));
              if (statusEl) statusEl.textContent = 'Location updated!';
            },
            (error) => {
              let message = error && error.message;
              if (error && error.code === 1) message = 'Location permission denied. <br>Please enable location access in your browser or device settings and retry.';
              else if (error && error.code === 2) message = 'Location unavailable. <br>Please check your device settings.';
              else if (!message) message = 'Could not access your location.';
              if (statusEl) statusEl.innerHTML = message + '<br><button class="find-location-retry" type="button">Retry</button>';
              // Add retry button handler
              const retryBtn = statusEl.querySelector('.find-location-retry');
              if (retryBtn) retryBtn.onclick = () => findBtn.click();
            },
            { enableHighAccuracy: true, timeout: 10000 }
          );
        });
      }
    // Nearby Stores chips population
    document.querySelectorAll('.nearby-stores-chips').forEach(async (chips) => {
      const itemId = chips.id.replace('nearby-stores-chips-', '');
      chips.innerHTML = '<span class="help">No location set. <button class="find-location-inline primary" type="button">Find This Item</button></span>';
      // Add inline event for retry (direct geolocation logic)
      const btn = chips.querySelector('.find-location-inline');
      if (btn) btn.onclick = async () => {
        const statusEl = document.getElementById('find-location-status');
        if (!navigator.geolocation) {
          if (statusEl) statusEl.textContent = 'Location not available.';
          return;
        }
        if (navigator.permissions && navigator.permissions.query) {
          try {
            const perm = await navigator.permissions.query({ name: 'geolocation' });
            if (perm.state === 'denied') {
              if (statusEl) statusEl.innerHTML = 'Location permission is <b>denied</b>. <br>Please enable location access in your browser or device settings and retry.';
              return;
            }
          } catch (e) { /* ignore */ }
        }
        if (statusEl) statusEl.textContent = 'Getting your location...';
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const lat = Number(position.coords && position.coords.latitude);
            const lng = Number(position.coords && position.coords.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
              if (statusEl) statusEl.textContent = 'Could not read your location.';
              return;
            }
            let persisted = {};
            try { persisted = JSON.parse(localStorage.getItem('norder_restock_map_ui_v1') || '{}'); } catch (_) {}
            persisted.center = { lat, lng };
            localStorage.setItem('norder_restock_map_ui_v1', JSON.stringify(persisted));
            localStorage.setItem('restock_map_ui', JSON.stringify(persisted));
            if (statusEl) statusEl.textContent = 'Location updated!';
            // Re-render chips after location update
            onRender && onRender();
          },
          (error) => {
            let message = error && error.message;
            if (error && error.code === 1) message = 'Location permission denied. <br>Please enable location access in your browser or device settings and retry.';
            else if (error && error.code === 2) message = 'Location unavailable. <br>Please check your device settings.';
            else if (!message) message = 'Could not access your location.';
            if (statusEl) statusEl.innerHTML = message + '<br><button class="find-location-retry" type="button">Retry</button>';
            const retryBtn = statusEl.querySelector('.find-location-retry');
            if (retryBtn) retryBtn.onclick = () => btn.click();
          },
          { enableHighAccuracy: true, timeout: 10000 }
        );
      };
      // Get last known location/search from localStorage (persisted by restock-map.js)
      let persisted = {};
      // Try new key first, then fallback to old key for backward compatibility
      try {
        persisted = JSON.parse(localStorage.getItem('norder_restock_map_ui_v1') || '{}');
        if (!persisted.center) {
          const fallback = JSON.parse(localStorage.getItem('restock_map_ui') || '{}');
          if (fallback.center) persisted.center = fallback.center;
        }
      } catch (_) {}
      const center = persisted.center;
      if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng)) {
        chips.innerHTML = '<span class="help">No location set. <button class="find-location-inline" type="button">Find This Item</button></span>';
        // Add inline event for retry
        const btn = chips.querySelector('.find-location-inline');
        if (btn) btn.onclick = () => document.getElementById('find-my-location')?.click();
        return;
      }
      // Dynamically import store lookup from restock-map.js
      let lookupStores;
      try {
        lookupStores = (await import('./restock-map.js')).lookupStores;
      } catch (_) {}
      if (typeof lookupStores !== 'function') {
        chips.innerHTML = '<span class="help">Store lookup unavailable.</span>';
        return;
      }
      try {
        const stores = await lookupStores(center, 8);
        if (!stores || !stores.length) {
          chips.innerHTML = '<span class="help">No nearby stores found.</span>';
          return;
        }
        // Use item name for store-site search links
        const state = getState();
        const item = state.items.find((i) => i.id === itemId);
        const itemName = item ? item.name : '';
        chips.innerHTML = stores.map((store) => {
          const searchResult = window.buildStoreWebsiteSearch ? window.buildStoreWebsiteSearch(store, itemName) : null;
          const domainUrl = toDomainOnlyUrl(searchResult && searchResult.url);
          const domainLabel = toDomainLabel(searchResult && searchResult.url, store.name);
          return `<a class="store-chip" href="${domainUrl}" target="_blank" rel="noopener" title="${domainLabel} (${store.category_label}${store.address ? ' | ' + store.address : ''})">${domainLabel}<span class="chip-meta">${store.category_label}${store.distance_m ? ' · ' + (store.distance_m < 1000 ? Math.round(store.distance_m) + 'm' : (store.distance_m/1609.344).toFixed(1) + 'mi') : ''}</span></a>`;
        }).join('');
      } catch (err) {
        chips.innerHTML = '<span class="help">Failed to load stores.</span>';
      }
    });
  if (applyAutomaticWearAndTearDecay()) {
    onRender();
    return;
  }

  if (getRoute() !== "/inventory") {
    closeQuickItemEditor();
  }

  const quick = document.getElementById("quick-add");
  if (quick) quick.addEventListener("click", () => {
    if (getRoute() !== "/inventory") {
      setRoute("/inventory");
      return;
    }
    toggleForm(true);
  });

  const tutorialBtn = document.getElementById("open-tutorial");
  if (tutorialBtn) tutorialBtn.addEventListener("click", () => {
    startTutorial();
  });

  const openProfileBtn = document.getElementById("open-profile");
  if (openProfileBtn) openProfileBtn.addEventListener("click", () => {
    setRoute("/profile");
  });

  const switchProfileBtn = document.getElementById("switch-profile");
  if (switchProfileBtn) switchProfileBtn.addEventListener("click", () => {
    setRoute(isDesktopLocalMode() ? "/settings" : "/inventories");
  });

  if (!delegatedHandlersBound) {
    document.addEventListener("click", (e) => delegatedClick(e, onRender));
    document.addEventListener("keydown", delegatedKeydown);
    delegatedHandlersBound = true;
  }

  const search = document.getElementById("search-input");
  const cat = document.getElementById("category-filter");
  const wear = document.getElementById("wear-filter");
  const sort = document.getElementById("sort-filter");
  if (search && cat && wear && sort) {
    const syncInventoryRoute = () => {
      const params = getHashParams();
      params.set("q", search.value);
      params.set("cat", cat.value);
      params.set("wear", wear.value);
      params.set("sort", sort.value || "name-asc");
      setRoute(`/inventory?${params.toString()}`);
    };

    search.addEventListener("input", () => {
      const cursorPosition = typeof search.selectionStart === "number" ? search.selectionStart : search.value.length;
      pendingSearchFocus = {
        value: search.value,
        cursor: cursorPosition,
      };
      setInventoryFilteringIndicator(true);
      applyInventoryListFilter(search.value, cat.value, wear.value, sort.value);
      setInventoryFilteringIndicator(false);
    });

    search.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      pendingSearchFocus = null;
      setInventoryFilteringIndicator(false);
      syncInventoryRoute();
    });

    search.addEventListener("blur", () => {
      pendingSearchFocus = null;
      setInventoryFilteringIndicator(false);
      syncInventoryRoute();
    });

    cat.addEventListener("change", () => {
      setInventoryFilteringIndicator(true);
      applyInventoryListFilter(search.value, cat.value, wear.value, sort.value);
      setInventoryFilteringIndicator(false);
      syncInventoryRoute();
    });

    wear.addEventListener("change", () => {
      setInventoryFilteringIndicator(true);
      applyInventoryListFilter(search.value, cat.value, wear.value, sort.value);
      setInventoryFilteringIndicator(false);
      syncInventoryRoute();
    });

    sort.addEventListener("change", () => {
      setInventoryFilteringIndicator(true);
      applyInventoryListFilter(search.value, cat.value, wear.value, sort.value);
      setInventoryFilteringIndicator(false);
      syncInventoryRoute();
    });

    applyInventoryListFilter(search.value, cat.value, wear.value, sort.value);
  }

  const saveItemBtn = document.getElementById("save-item");
  if (saveItemBtn) saveItemBtn.addEventListener("click", () => {
    const saved = saveInventoryItem();
    if (saved) {
      toggleForm(false);
      onRender();
    }
  });

  const addItemCloseBtn = document.querySelector("[data-role='add-item-close']");
  if (addItemCloseBtn) addItemCloseBtn.addEventListener("click", () => toggleForm(false));
  const addItemCancelBtn = document.querySelector("[data-role='add-item-cancel']");
  if (addItemCancelBtn) addItemCancelBtn.addEventListener("click", () => toggleForm(false));

  const quantityInput = document.getElementById("item-quantity");
  if (quantityInput) {
    quantityInput.addEventListener("input", () => {
      syncUnitStockLevelFields();
      syncUnitWearLevelFields();
    });
    quantityInput.addEventListener("blur", () => {
      syncUnitStockLevelFields(undefined, { commitQuantity: true });
      syncUnitWearLevelFields(undefined, { commitQuantity: true });
    });
  }

  const stockLevelInput = document.getElementById("item-stock-level");
  if (stockLevelInput) stockLevelInput.addEventListener("change", () => syncUnitStockLevelFields());
  const unitStockLevelsContainer = document.getElementById("item-unit-stock-levels");
  if (unitStockLevelsContainer) {
    unitStockLevelsContainer.addEventListener("change", (event) => {
      if (event.target && event.target.matches("[data-role='unit-stock-level']")) {
        syncInventoryStockLevelAvailability();
      }
    });
  }

  const wearAndTearEnabledInput = document.getElementById("item-enable-wear-and-tear");
  const wearAndTearLevelInput = document.getElementById("item-wear-and-tear-level");
  if (wearAndTearEnabledInput) {
    wearAndTearEnabledInput.addEventListener("change", () => {
      syncWearAndTearFormFields();
      syncUnitWearLevelFields();
    });
  }
  if (wearAndTearLevelInput) {
    wearAndTearLevelInput.addEventListener("change", () => {
      wearAndTearLevelInput.value = normalizeWearLevel(wearAndTearLevelInput.value);
      syncUnitWearLevelFields();
    });
  }

  if (quantityInput || stockLevelInput) {
    syncUnitStockLevelFields(undefined, { commitQuantity: true });
  }
  if (wearAndTearEnabledInput || wearAndTearLevelInput) {
    syncWearAndTearFormFields();
    syncUnitWearLevelFields(undefined, { commitQuantity: true });
  }

  restorePendingSearchFocus();

  const toggleFormBtn = document.getElementById("toggle-item-form");
  if (toggleFormBtn) toggleFormBtn.addEventListener("click", () => toggleForm());

  const checkInventoryBtn = document.getElementById("check-inventory-btn");
  if (checkInventoryBtn) checkInventoryBtn.addEventListener("click", () => openInventoryCheck(onRender));

  const savePrefsBtn = document.getElementById("save-prefs");
  if (savePrefsBtn) savePrefsBtn.addEventListener("click", () => {
    saveInventoryPrefs();
    onRender();
  });

  const viewLogBtn = document.getElementById("view-activity-log");
  if (viewLogBtn) viewLogBtn.addEventListener("click", () => {
    setRoute("/activity");
  });

  const addCategoryBtn = document.getElementById("add-category");
  if (addCategoryBtn) addCategoryBtn.addEventListener("click", () => {
    setCategoryAddMode(true);
  });

  const clear = document.getElementById("clear-data");
  if (clear) clear.addEventListener("click", () => {
    if (!confirm("Delete all inventory items and categories for this inventory space?")) return;
    trackInventoryChange("inventory_cleared", "Cleared inventory records and categories", null);
    resetInventoryData();
    saveState();
    onRender();
  });

  const restock = document.getElementById("restock-selected");
  if (restock) restock.addEventListener("click", async () => {
    const selected = [...document.querySelectorAll("[data-role='buy-check']:checked")].map((el) =>
      el.getAttribute("data-id")
    );

    if (!selected.length) return;

    const state = getState();
    const selectedItems = state.items.filter((item) => selected.includes(item.id));
    const wearResetCount = selectedItems.filter((item) => getItemWearAndTear(item).enabled).length;
    const restockDetails = await askRestockPurchaseDetails(selectedItems);
    if (restockDetails === null) return;

    const next = deepClone(state);
    next.items = next.items.map((item) => {
      if (!selected.includes(item.id)) return item;
      const baseQuantity = getItemQuantity(item);
      const itemDetails = restockDetails[item.id] || {};
      const extraQuantityRaw = Number.parseInt(String(itemDetails.added_quantity || "0"), 10);
      const extraQuantity = Number.isFinite(extraQuantityRaw) && extraQuantityRaw > 0 ? extraQuantityRaw : 0;
      const quantity = baseQuantity + extraQuantity;
      const wearAndTear = getItemWearAndTear(item);
      const wearUnitLevels = wearAndTear.enabled && quantity > 1 ? Array.from({ length: quantity }, () => "Brand New") : [];
      const nextBrandName = typeof itemDetails.brand_name === "string" ? itemDetails.brand_name : String(item.brand_name || "");
      return {
        ...item,
        brand_name: nextBrandName,
        quantity,
        unit_stock_levels: quantity > 1 ? Array.from({ length: quantity }, () => "Full") : [],
        stock_level: "Full",
        percentage: stockLevelToPercentage("Full"),
        wear_level: wearAndTear.enabled ? "Brand New" : "",
        wear_percentage: wearAndTear.enabled ? 0 : 0,
        wear_unit_levels: wearUnitLevels,
        wear_decay_updated_at: wearAndTear.enabled ? Date.now() : 0,
        in_shopping_list: false,
        updated_date: Date.now(),
      };
    });

    setState(next);
    saveState();
    const expandedItems = Object.entries(restockDetails)
      .map(([itemId, details]) => ({ item_id: itemId, added_quantity: Number(details && details.added_quantity) || 0 }))
      .filter((entry) => entry.added_quantity > 0);
    const brandUpdatedItems = selectedItems
      .map((selectedItem) => {
        const details = restockDetails[selectedItem.id] || {};
        const previousBrand = String(selectedItem.brand_name || "").trim();
        const nextBrand = typeof details.brand_name === "string" ? details.brand_name.trim() : previousBrand;
        return {
          item_id: selectedItem.id,
          previous_brand_name: previousBrand,
          brand_name: nextBrand,
        };
      })
      .filter((entry) => entry.brand_name !== entry.previous_brand_name);
    trackInventoryChange("bulk_restock", `Restocked ${selected.length} restock item(s)`, {
      item_ids: selected,
      increased_quantity_items: expandedItems,
      updated_brand_items: brandUpdatedItems,
    });
    onRender();

    const toastParts = [`Restocked ${selected.length} item${selected.length === 1 ? "" : "s"}.`];
    if (expandedItems.length) {
      toastParts.push(`Increased quantity on ${expandedItems.length} item${expandedItems.length === 1 ? "" : "s"}.`);
    }
    if (brandUpdatedItems.length) {
      toastParts.push(`Updated brand on ${brandUpdatedItems.length} item${brandUpdatedItems.length === 1 ? "" : "s"}.`);
    }
    if (wearResetCount) {
      toastParts.push(`Reset wear-and-tear on ${wearResetCount} item${wearResetCount === 1 ? "" : "s"}.`);
    }
    showSaveNotification(toastParts.join(" "));
  });

  wirePageFloatingAction(onRender);
  announceUnreadNotifications();

  if (tutorialState.active) {
    renderTutorialOverlay();
  } else {
    if (!hasSeenTutorialForCurrentUser()) {
      startTutorial();
      return;
    }
    removeTutorialOverlay();
    clearTutorialHighlight();
  }
}

function delegatedKeydown(e) {
  if (tutorialState.active && e && e.key === "Escape") {
    e.preventDefault();
    closeTutorial();
    return;
  }

  if (e && e.key === "Escape") {
    const panel = document.getElementById("norder-notification-center");
    if (panel && !panel.hasAttribute("hidden")) {
      e.preventDefault();
      setNotificationCenterOpen(false);
      return;
    }
  }

  const target = e && e.target;
  if (!(target instanceof HTMLElement)) return;
  const role = target.getAttribute("data-role");
  if (role !== "category-name-input" && role !== "category-add-name-input" && role !== "category-add-icon-input" && role !== "category-color-input" && role !== "category-add-color-input") {
    return;
  }

  if (role === "category-add-name-input" || role === "category-add-icon-input") {
    if (e.key === "Enter") {
      e.preventDefault();
      document.getElementById("save-category-add")?.click();
    }

    if (e.key === "Escape") {
      e.preventDefault();
      setCategoryAddMode(false);
    }
    return;
  }

  const row = target.closest("[data-role='category-row']");
  if (!row) return;

  if (e.key === "Enter") {
    e.preventDefault();
    const saveBtn = row.querySelector("button[data-action='save-category-edit']");
    if (saveBtn) saveBtn.click();
  }

  if (e.key === "Escape") {
    e.preventDefault();
    setCategoryEditMode(row, false);
  }
}

async function delegatedClick(e, onRender) {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const action = btn.getAttribute("data-action");
  const id = btn.getAttribute("data-id");

  if (action === "toggle-notification-center") {
    const panel = document.getElementById("norder-notification-center");
    const isOpen = Boolean(panel && !panel.hasAttribute("hidden"));
    setNotificationCenterOpen(!isOpen);
    return;
  }

  if (action === "close-notification-center") {
    setNotificationCenterOpen(false);
    return;
  }

  if (action === "mark-all-notifications-read") {
    const ids = [...document.querySelectorAll("button[data-action='open-notification'][data-id]")]
      .map((el) => String(el.getAttribute("data-id") || "").trim())
      .filter(Boolean);
    if (ids.length) {
      markNotificationsRead(ids);
      setNotificationCenterOpen(false);
      onRender();
    }
    return;
  }

  if (action === "clear-notifications") {
    const ids = [...document.querySelectorAll("button[data-action='open-notification'][data-id]")]
      .map((el) => String(el.getAttribute("data-id") || "").trim())
      .filter(Boolean);
    if (ids.length) {
      dismissNotifications(ids);
      setNotificationCenterOpen(false);
      onRender();
    }
    return;
  }

  if (action === "open-notification") {
    const route = String(btn.getAttribute("data-route") || "/inventory").trim() || "/inventory";
    if (id) {
      markNotificationsRead([id]);
    }
    setNotificationCenterOpen(false);
    if (getRoute() === route) {
      onRender();
      return;
    }
    setRoute(route);
    return;
  }

  const state = getState();
  const next = deepClone(state);
  const item = next.items.find((i) => i.id === id);
  const categoryRow = btn.closest("[data-role='category-row']");
  let shouldPersist = false;
  let postSaveNotice = "";

  if (action === "start-edit-category") {
    if (categoryRow) setCategoryEditMode(categoryRow, true);
    return;
  }

  if (action === "cancel-category-edit") {
    if (categoryRow) setCategoryEditMode(categoryRow, false);
    return;
  }

  if (action === "cancel-category-add") {
    setCategoryAddMode(false);
    return;
  }

  if (action === "delete-item") {
    const removedItem = next.items.find((i) => i.id === id);
    next.items = next.items.filter((i) => i.id !== id);
    if (removedItem) {
      if (!next.item_tombstones || typeof next.item_tombstones !== "object") {
        next.item_tombstones = {};
      }
      next.item_tombstones[removedItem.id] = Date.now();
      trackInventoryChange("item_deleted", `Deleted item \"${removedItem.name}\"`, {
        item_id: removedItem.id,
        item_name: removedItem.name,
      });
    }
    shouldPersist = true;
  }

  if (action === "edit-item" && item) {
    openQuickItemEditor(item, onRender);
    return;
  }

  if (action === "toggle-shopping" && item) {
    item.in_shopping_list = !item.in_shopping_list;
    item.updated_date = Date.now();
    trackInventoryChange(
      "shopping_toggle",
      `${item.in_shopping_list ? "Added" : "Removed"} \"${item.name}\" ${
        item.in_shopping_list ? "to" : "from"
      } restock list`,
      { item_id: item.id, item_name: item.name, in_shopping_list: item.in_shopping_list }
    );
    shouldPersist = true;
  }

  if (action === "remove-shopping" && item) {
    item.in_shopping_list = false;
    item.updated_date = Date.now();
    trackInventoryChange("shopping_removed", `Removed \"${item.name}\" from restock list`, {
      item_id: item.id,
      item_name: item.name,
    });
    shouldPersist = true;
  }

  if (action === "add-to-shop" && item) {
    item.in_shopping_list = true;
    item.updated_date = Date.now();
    trackInventoryChange("shopping_added", `Added \"${item.name}\" to restock list`, {
      item_id: item.id,
      item_name: item.name,
    });
    shouldPersist = true;
  }

  if (action === "delete-category") {
    const cat = next.categories.find((c) => c.id === id);
    if (cat) {
      const removedItems = next.items.filter((i) => i.category === cat.name);
      const confirmationMessage = removedItems.length
        ? `Delete category \"${cat.name}\" and ${removedItems.length} item${removedItems.length === 1 ? "" : "s"} in it?`
        : `Delete category \"${cat.name}\"?`;
      if (!confirm(confirmationMessage)) return;
      next.categories = next.categories.filter((c) => c.id !== id);
      next.items = next.items.filter((i) => i.category !== cat.name);
      if (!next.item_tombstones || typeof next.item_tombstones !== "object") {
        next.item_tombstones = {};
      }
      removedItems.forEach((removedItem) => {
        next.item_tombstones[removedItem.id] = Date.now();
      });
      trackInventoryChange("category_deleted", `Deleted category \"${cat.name}\"`, {
        category_id: cat.id,
        category_name: cat.name,
        deleted_item_count: removedItems.length,
        deleted_item_ids: removedItems.map((removedItem) => removedItem.id),
      });
      next.categories_updated_at = Date.now();
      shouldPersist = true;
    }
  }

  if (action === "save-category-edit") {
    const cat = next.categories.find((c) => c.id === id);
    if (cat) {
      const oldName = String(cat.name || "").trim();
      const input = categoryRow ? categoryRow.querySelector("[data-role='category-name-input']") : null;
      const colorInput = categoryRow ? categoryRow.querySelector("[data-role='category-color-input']") : null;
      const newName = String((input && input.value) || "").trim();
      const newColor = String((colorInput && colorInput.value) || "").trim() || cat.color || "";
      if (!newName) {
        alert("Category name cannot be empty.");
        if (input) input.focus();
        return;
      }

      const nameUnchanged = newName.toLowerCase() === oldName.toLowerCase();
      const colorUnchanged = newColor === (cat.color || "");
      if (nameUnchanged && colorUnchanged) {
        if (categoryRow) setCategoryEditMode(categoryRow, false);
        return;
      }

      if (!nameUnchanged) {
        const duplicate = next.categories.some(
          (category) => category.id !== id && String(category.name || "").trim().toLowerCase() === newName.toLowerCase()
        );
        if (duplicate) {
          alert("A category with that name already exists.");
          if (input) input.focus();
          return;
        }
      }

      cat.name = newName;
      cat.color = newColor;
      next.items = next.items.map((item) => (item.category === oldName ? { ...item, category: newName } : item));
      trackInventoryChange("category_renamed", `Renamed category \"${oldName}\" to \"${newName}\"`, {
        category_id: cat.id,
        previous_name: oldName,
        category_name: newName,
      });
      postSaveNotice = `Saved category: Renamed to \"${newName}\"`;
      next.categories_updated_at = Date.now();
      shouldPersist = true;
    }
  }

  if (action === "save-category-add") {
    const nameInput = document.getElementById("category-add-name");
    const iconInput = document.getElementById("category-add-icon");
    const colorInput = document.getElementById("category-add-color");
    const name = String((nameInput && nameInput.value) || "").trim();
    if (!name) {
      alert("Category name cannot be empty.");
      if (nameInput) nameInput.focus();
      return;
    }

    const duplicate = next.categories.some(
      (category) => String(category.name || "").trim().toLowerCase() === name.toLowerCase()
    );
    if (duplicate) {
      alert("A category with that name already exists.");
      if (nameInput) nameInput.focus();
      return;
    }

    const fallbackIcon = name.slice(0, 2).toUpperCase() || "CT";
    const icon = String((iconInput && iconInput.value) || "").trim().toUpperCase().slice(0, 2) || fallbackIcon;
    const color = String((colorInput && colorInput.value) || "").trim() || "#6366f1";

    next.categories.push({
      id: safeUuid(),
      name,
      icon,
      color,
    });
    trackInventoryChange("category_added", `Added category \"${name}\"`, {
      category_name: name,
    });
    postSaveNotice = `Saved category: Added \"${name}\"`;
    setCategoryAddMode(false);
    next.categories_updated_at = Date.now();
    shouldPersist = true;
  }

  if (!shouldPersist) return;

  setState(next);
  saveState();
  onRender();
  if (postSaveNotice) showSaveNotification(postSaveNotice);
}

function toggleForm(open) {
  if (open) {
    closeQuickItemEditor();
  }

  const panel = document.getElementById("item-form");
  if (!panel) return;
  const forceOpen = typeof open === "boolean" ? open : !panel.classList.contains("open");
  panel.classList.toggle("open", forceOpen);

  if (forceOpen) {
    const titleEl = document.getElementById("add-item-modal-title");
    const saveBtn = document.getElementById("save-item");
    const isEdit = saveBtn && saveBtn.getAttribute("data-edit-id");
    if (titleEl) titleEl.textContent = isEdit ? "Edit Item" : "Add New Item";
    if (addItemKeydownHandler) document.removeEventListener("keydown", addItemKeydownHandler);
    addItemKeydownHandler = (e) => { if (e.key === "Escape") toggleForm(false); };
    document.addEventListener("keydown", addItemKeydownHandler);
    panel.addEventListener("click", _addItemBackdropClick);
  } else {
    if (addItemKeydownHandler) {
      document.removeEventListener("keydown", addItemKeydownHandler);
      addItemKeydownHandler = null;
    }
    panel.removeEventListener("click", _addItemBackdropClick);
  }
}

function fillItemForm(item) {
  const state = getState();
  const name = document.getElementById("item-name");
  const brand = document.getElementById("item-brand");
  const category = document.getElementById("item-category");
  const stockLevel = document.getElementById("item-stock-level");
  const quantity = document.getElementById("item-quantity");
  const containerType = document.getElementById("item-container-type");
  const expiry = document.getElementById("item-expiry");
  const wearAndTearEnabled = document.getElementById("item-enable-wear-and-tear");
  const wearAndTearLevel = document.getElementById("item-wear-and-tear-level");
  const wearAndTear = getItemWearAndTear(item);

  if (name) name.value = item.name || "";
  const firstCategory = state.categories.length ? state.categories[0].name : "Unsorted";
  if (brand) brand.value = item.brand_name || "";
  if (category) category.value = item.category || firstCategory || "Unsorted";
  if (stockLevel) stockLevel.value = getItemStockLevel(item);
  if (quantity) quantity.value = String(getItemQuantity(item));
  if (containerType) containerType.value = normalizeContainerType(item.container_type);
  if (wearAndTearEnabled) wearAndTearEnabled.checked = wearAndTear.enabled;
  if (wearAndTearLevel) wearAndTearLevel.value = wearAndTear.level;
  syncWearAndTearFormFields();
  syncUnitWearLevelFields(getItemUnitWearLevels(item), { commitQuantity: true });
  syncUnitStockLevelFields(getItemUnitStockLevels(item), { commitQuantity: true });
  if (expiry) expiry.value = item.expiry_date || "";
}

function saveInventoryItem() {
  const nameInput = document.getElementById("item-name");
  const brandNameInput = document.getElementById("item-brand");
  const categoryInput = document.getElementById("item-category");
  const stockLevelInput = document.getElementById("item-stock-level");
  const quantityInput = document.getElementById("item-quantity");
  const containerTypeInput = document.getElementById("item-container-type");
  const expiryInput = document.getElementById("item-expiry");
  const wearAndTearEnabledInput = document.getElementById("item-enable-wear-and-tear");
  const wearAndTearLevelInput = document.getElementById("item-wear-and-tear-level");

  const name = (nameInput && nameInput.value ? nameInput.value : "").trim();
  const brandName = (brandNameInput && brandNameInput.value ? brandNameInput.value : "").trim();
  const category = (categoryInput && categoryInput.value) || "Unsorted";
  const selectedStockLevel = normalizeStockLevel(stockLevelInput && stockLevelInput.value, 50);
  const quantity = normalizeItemQuantity(quantityInput && quantityInput.value);
  const containerType = normalizeContainerType(containerTypeInput && containerTypeInput.value);
  const unitStockLevels = quantity > 1 ? buildUnitStockLevels(quantity, getFormUnitStockLevels(), selectedStockLevel) : [];
  const unitAveragePercentage = unitStockLevels.length
    ? Math.round(
        unitStockLevels.reduce((sum, level) => sum + stockLevelToPercentage(level), 0) / unitStockLevels.length
      )
    : 0;
  const stockLevel = unitStockLevels.length
    ? normalizeStockLevel(undefined, unitAveragePercentage)
    : selectedStockLevel;
  const stockPercentage = unitStockLevels.length ? unitAveragePercentage : stockLevelToPercentage(stockLevel);
  const expiry = (expiryInput && expiryInput.value) || "";
  const wearAndTearEnabled = Boolean(wearAndTearEnabledInput && wearAndTearEnabledInput.checked);
  const wearAndTearLevel = normalizeWearLevel(wearAndTearLevelInput && wearAndTearLevelInput.value);
  const unitWearLevels = wearAndTearEnabled && quantity > 1
    ? buildUnitWearLevels(quantity, getFormUnitWearLevels(), wearAndTearLevel)
    : [];
  const wearAndTearPercentage = wearAndTearEnabled
    ? unitWearLevels.length
      ? Math.round(unitWearLevels.reduce((sum, level) => sum + getWearPercentageForLevel(level), 0) / unitWearLevels.length)
      : getWearPercentageForLevel(wearAndTearLevel)
    : 0;
  const resolvedWearLevel = wearAndTearEnabled
    ? unitWearLevels.length
      ? getWearLevelForPercentage(wearAndTearPercentage)
      : wearAndTearLevel
    : "";
  const shouldRestock = wearAndTearEnabled
    ? isReplaceWorthyWear(true, resolvedWearLevel, wearAndTearPercentage)
    : isLowStockLevel(stockLevel);
  const btn = document.getElementById("save-item");
  const editId = (btn && btn.getAttribute("data-edit-id")) || "";

  if (!name) {
    alert("Please add an item name.");
    return false;
  }

  const state = getState();
  const next = deepClone(state);

  if (editId) {
    next.items = next.items.map((item) =>
      item.id === editId
        ? {
            ...item,
            name,
          brand_name: brandName,
            category,
            quantity,
            container_type: containerType,
            unit_stock_levels: unitStockLevels,
            stock_level: stockLevel,
            percentage: stockPercentage,
            wear_and_tear_enabled: wearAndTearEnabled,
            wear_level: resolvedWearLevel,
            wear_percentage: wearAndTearPercentage,
            wear_unit_levels: wearAndTearEnabled ? unitWearLevels : [],
            wear_decay_updated_at: wearAndTearEnabled ? Date.now() : 0,
            expiry_date: expiry,
            in_shopping_list: shouldRestock,
            updated_date: Number(item.updated_date) || Date.now(),
          }
        : item
    );
    if (next.item_tombstones && typeof next.item_tombstones === "object") {
      delete next.item_tombstones[editId];
    }
    trackInventoryChange("item_updated", `Updated item \"${name}\"`, {
      item_id: editId,
      item_name: name,
      brand_name: brandName || null,
      quantity,
      container_type: containerType || null,
      stock_level: stockLevel,
      wear_and_tear_enabled: wearAndTearEnabled,
      wear_level: resolvedWearLevel || null,
      wear_unit_count: unitWearLevels.length || null,
      expiry_date: expiry,
      category,
    });
    if (btn) btn.removeAttribute("data-edit-id");
  } else {
    const newId = safeUuid();
    next.items.unshift({
      id: newId,
      name,
      brand_name: brandName,
      category,
      quantity,
      container_type: containerType,
      unit_stock_levels: unitStockLevels,
      stock_level: stockLevel,
      percentage: stockPercentage,
      wear_and_tear_enabled: wearAndTearEnabled,
      wear_level: resolvedWearLevel,
      wear_percentage: wearAndTearPercentage,
      wear_unit_levels: wearAndTearEnabled ? unitWearLevels : [],
      wear_decay_updated_at: wearAndTearEnabled ? Date.now() : 0,
      in_shopping_list: shouldRestock,
      expiry_date: expiry,
      updated_date: Date.now(),
    });
    if (next.item_tombstones && typeof next.item_tombstones === "object") {
      delete next.item_tombstones[newId];
    }
    trackInventoryChange("item_added", `Added item \"${name}\"`, {
      item_id: newId,
      item_name: name,
      brand_name: brandName || null,
      quantity,
      container_type: containerType || null,
      stock_level: stockLevel,
      wear_and_tear_enabled: wearAndTearEnabled,
      wear_level: resolvedWearLevel || null,
      wear_unit_count: unitWearLevels.length || null,
      expiry_date: expiry,
      category,
    });
  }

  setState(next);
  saveState();
  return true;
}

function saveInventoryPrefs() {
  const homeInput = document.getElementById("prefs-home");
  const tombstoneDaysInput = document.getElementById("prefs-tombstone-days");
  const notifyExpiryEnabledInput = document.getElementById("prefs-notify-expiry-enabled");
  const notifyExpirySoonDaysInput = document.getElementById("prefs-notify-expiry-soon-days");
  const notifyStockEnabledInput = document.getElementById("prefs-notify-stock-enabled");
  const notifyWearEnabledInput = document.getElementById("prefs-notify-wear-enabled");
  const notifyRestockEnabledInput = document.getElementById("prefs-notify-restock-enabled");

  const home = (homeInput && homeInput.value ? homeInput.value : "").trim() || defaultHomeName;
  const parsedRetentionDays = Number(tombstoneDaysInput && tombstoneDaysInput.value);
  const tombstoneRetentionDays = Number.isFinite(parsedRetentionDays)
    ? Math.min(365, Math.max(1, Math.round(parsedRetentionDays)))
    : 30;
  const parsedExpirySoonDays = Number(notifyExpirySoonDaysInput && notifyExpirySoonDaysInput.value);
  const expirySoonDays = Number.isFinite(parsedExpirySoonDays)
    ? Math.min(60, Math.max(1, Math.round(parsedExpirySoonDays)))
    : 7;
  const notifyExpiryEnabled = notifyExpiryEnabledInput ? Boolean(notifyExpiryEnabledInput.checked) : true;
  const notifyStockEnabled = notifyStockEnabledInput ? Boolean(notifyStockEnabledInput.checked) : true;
  const notifyWearEnabled = notifyWearEnabledInput ? Boolean(notifyWearEnabledInput.checked) : true;
  const notifyRestockEnabled = notifyRestockEnabledInput ? Boolean(notifyRestockEnabledInput.checked) : true;

  const state = getState();
  const next = deepClone(state);
  next.prefs.home_name = home;
  next.prefs.item_tombstone_retention_days = tombstoneRetentionDays;
  next.prefs.notification_expiry_enabled = notifyExpiryEnabled;
  next.prefs.notification_stock_enabled = notifyStockEnabled;
  next.prefs.notification_wear_enabled = notifyWearEnabled;
  next.prefs.notification_restock_enabled = notifyRestockEnabled;
  next.prefs.notification_expiry_soon_days = expirySoonDays;

  setState(next);
  saveState();
  trackInventoryChange("preferences_updated", "Updated inventory preferences", {
    home_name: home,
    item_tombstone_retention_days: tombstoneRetentionDays,
    notification_expiry_enabled: notifyExpiryEnabled,
    notification_stock_enabled: notifyStockEnabled,
    notification_wear_enabled: notifyWearEnabled,
    notification_restock_enabled: notifyRestockEnabled,
    notification_expiry_soon_days: expirySoonDays,
  });
}
