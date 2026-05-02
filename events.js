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
  getItemQuantity,
  getItemStockLevel,
  getItemUnitStockLevels,
  isLowStockLevel,
  normalizeItemQuantity,
  normalizeStockLevel,
  stockLevelToPercentage,
} from "./utils.js";
import { getCurrentInventoryId } from "./state.js";
import { getCurrentUser } from "./auth.js";
import { logInventoryChange } from "./collaboration.js";

let delegatedHandlersBound = false;
const CONTAINER_TYPES = ["Bottle", "Can", "Bag", "Box"];
let pendingSearchFocus = null;
let filterIndicatorHideTimer = null;

function deepClone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function safeUuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function restorePendingSearchFocus() {
  if (!pendingSearchFocus) return;

  const search = document.getElementById("search-input");
  const cat = document.getElementById("category-filter");
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

  applyInventoryListFilter(search.value, cat ? cat.value : "all");
}

function applyInventoryListFilter(queryValue, categoryValue) {
  const cards = [...document.querySelectorAll("[data-role='inventory-item']")];
  const noMatches = document.getElementById("inventory-no-matches");
  if (!cards.length) {
    if (noMatches) noMatches.style.display = "";
    return;
  }

  const query = String(queryValue || "").trim().toLowerCase();
  const category = String(categoryValue || "all").trim().toLowerCase() || "all";
  let visibleCount = 0;

  cards.forEach((card) => {
    const itemName = String(card.getAttribute("data-name") || "").toLowerCase();
    const itemCategory = String(card.getAttribute("data-category") || "").toLowerCase();
    const byText = !query || itemName.includes(query);
    const byCategory = category === "all" || itemCategory === category;
    const isVisible = byText && byCategory;
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
  if (!quantityInput || !stockLevelInput) return;

  const commitQuantity = Boolean(options && options.commitQuantity);
  const rawQuantity = typeof quantityInput.value === "string" ? quantityInput.value.trim() : "";
  if (!rawQuantity) {
    if (commitQuantity) {
      const fallbackQuantity = normalizeItemQuantity(rawQuantity);
      quantityInput.value = String(fallbackQuantity);
      const fallbackStockLevel = normalizeStockLevel(stockLevelInput.value, 50);
      const normalizedLevels = buildUnitStockLevels(fallbackQuantity, getFormUnitStockLevels(), fallbackStockLevel);
      renderUnitStockLevelFields(normalizedLevels);
      return;
    }

    renderUnitStockLevelFields([]);
    return;
  }

  const quantity = normalizeItemQuantity(rawQuantity);
  if (commitQuantity) quantityInput.value = String(quantity);

  const fallbackStockLevel = normalizeStockLevel(stockLevelInput.value, 50);
  const sourceLevels = Array.isArray(preferredLevels) ? preferredLevels : getFormUnitStockLevels();
  const normalizedLevels = buildUnitStockLevels(quantity, sourceLevels, fallbackStockLevel);
  renderUnitStockLevelFields(normalizedLevels);
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
  const quick = document.getElementById("quick-add");
  if (quick) quick.addEventListener("click", () => {
    if (getRoute() !== "/inventory") {
      setRoute("/inventory");
      return;
    }
    toggleForm(true);
  });

  const openProfileBtn = document.getElementById("open-profile");
  if (openProfileBtn) openProfileBtn.addEventListener("click", () => {
    setRoute("/profile");
  });

  const switchProfileBtn = document.getElementById("switch-profile");
  if (switchProfileBtn) switchProfileBtn.addEventListener("click", () => {
    setRoute("/inventories");
  });

  if (!delegatedHandlersBound) {
    document.addEventListener("click", (e) => delegatedClick(e, onRender));
    delegatedHandlersBound = true;
  }

  const search = document.getElementById("search-input");
  const cat = document.getElementById("category-filter");
  if (search && cat) {
    const syncInventoryRoute = () => {
      const params = getHashParams();
      params.set("q", search.value);
      params.set("cat", cat.value);
      setRoute(`/inventory?${params.toString()}`);
    };

    search.addEventListener("input", () => {
      const cursorPosition = typeof search.selectionStart === "number" ? search.selectionStart : search.value.length;
      pendingSearchFocus = {
        value: search.value,
        cursor: cursorPosition,
      };
      setInventoryFilteringIndicator(true);
      applyInventoryListFilter(search.value, cat.value);
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
      applyInventoryListFilter(search.value, cat.value);
      setInventoryFilteringIndicator(false);
      syncInventoryRoute();
    });

    applyInventoryListFilter(search.value, cat.value);
  }

  const saveItemBtn = document.getElementById("save-item");
  if (saveItemBtn) saveItemBtn.addEventListener("click", () => {
    saveInventoryItem();
    onRender();
  });

  const quantityInput = document.getElementById("item-quantity");
  if (quantityInput) {
    quantityInput.addEventListener("input", () => syncUnitStockLevelFields());
    quantityInput.addEventListener("blur", () => syncUnitStockLevelFields(undefined, { commitQuantity: true }));
  }

  const stockLevelInput = document.getElementById("item-stock-level");
  if (stockLevelInput) stockLevelInput.addEventListener("change", () => syncUnitStockLevelFields());

  if (quantityInput || stockLevelInput) {
    syncUnitStockLevelFields(undefined, { commitQuantity: true });
  }

  restorePendingSearchFocus();

  const toggleFormBtn = document.getElementById("toggle-item-form");
  if (toggleFormBtn) toggleFormBtn.addEventListener("click", () => toggleForm());

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
    const name = prompt("Category name for this inventory space");
    if (!name) return;
    const icon = prompt("Short icon text (2 letters)", "CT") || "CT";

    const state = getState();
    const next = deepClone(state);
    next.categories.push({
      id: safeUuid(),
      name: name.trim(),
      icon: icon.trim().toUpperCase().slice(0, 2),
    });

    setState(next);
    saveState();
    trackInventoryChange("category_added", `Added category \"${name.trim()}\"`, {
      category_name: name.trim(),
    });
    onRender();
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
  if (restock) restock.addEventListener("click", () => {
    const selected = [...document.querySelectorAll("[data-role='buy-check']:checked")].map((el) =>
      el.getAttribute("data-id")
    );

    const state = getState();
    const next = deepClone(state);
    next.items = next.items.map((item) => {
      if (!selected.includes(item.id)) return item;
      const quantity = getItemQuantity(item);
      return {
        ...item,
        quantity,
        unit_stock_levels: quantity > 1 ? Array.from({ length: quantity }, () => "Full") : [],
        stock_level: "Full",
        percentage: stockLevelToPercentage("Full"),
        in_shopping_list: false,
        updated_date: Date.now(),
      };
    });

    setState(next);
    saveState();
    trackInventoryChange("bulk_restock", `Restocked ${selected.length} restock item(s)`, {
      item_ids: selected,
    });
    onRender();
  });
}

function delegatedClick(e, onRender) {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const action = btn.getAttribute("data-action");
  const id = btn.getAttribute("data-id");
  const state = getState();
  const next = deepClone(state);
  const item = next.items.find((i) => i.id === id);
  let shouldPersist = false;

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
    toggleForm(true);
    fillItemForm(item);
    const saveBtn = document.getElementById("save-item");
    if (saveBtn) saveBtn.setAttribute("data-edit-id", item.id);
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
      shouldPersist = true;
    }
  }

  if (!shouldPersist) return;

  setState(next);
  saveState();
  onRender();
}

function toggleForm(open) {
  const panel = document.getElementById("item-form");
  if (!panel) return;
  const forceOpen = typeof open === "boolean" ? open : !panel.classList.contains("open");
  panel.classList.toggle("open", forceOpen);
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

  if (name) name.value = item.name || "";
  if (brand) brand.value = item.brand_name || "";
  const firstCategory = state.categories.length ? state.categories[0].name : "Unsorted";
  if (category) category.value = item.category || firstCategory || "Unsorted";
  if (stockLevel) stockLevel.value = getItemStockLevel(item);
  if (quantity) quantity.value = String(getItemQuantity(item));
  if (containerType) containerType.value = normalizeContainerType(item.container_type);
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
  const btn = document.getElementById("save-item");
  const editId = (btn && btn.getAttribute("data-edit-id")) || "";

  if (!name) {
    alert("Please add an item name.");
    return;
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
            expiry_date: expiry,
            in_shopping_list: isLowStockLevel(stockLevel),
            updated_date: Date.now(),
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
      in_shopping_list: isLowStockLevel(stockLevel),
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
      expiry_date: expiry,
      category,
    });
  }

  setState(next);
  saveState();
}

function saveInventoryPrefs() {
  const homeInput = document.getElementById("prefs-home");
  const tombstoneDaysInput = document.getElementById("prefs-tombstone-days");

  const home = (homeInput && homeInput.value ? homeInput.value : "").trim() || defaultHomeName;
  const parsedRetentionDays = Number(tombstoneDaysInput && tombstoneDaysInput.value);
  const tombstoneRetentionDays = Number.isFinite(parsedRetentionDays)
    ? Math.min(365, Math.max(1, Math.round(parsedRetentionDays)))
    : 30;

  const state = getState();
  const next = deepClone(state);
  next.prefs.home_name = home;
  next.prefs.item_tombstone_retention_days = tombstoneRetentionDays;

  setState(next);
  saveState();
  trackInventoryChange("preferences_updated", "Updated inventory preferences", {
    home_name: home,
    item_tombstone_retention_days: tombstoneRetentionDays,
  });
}
