import { defaultHomeName, getState, resetState, saveState, setState } from "./state.js";
import { getHashParams, getRoute, setRoute } from "./router.js";
import { clamp } from "./utils.js";

let delegatedHandlersBound = false;

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

  if (!delegatedHandlersBound) {
    document.addEventListener("click", (e) => delegatedClick(e, onRender));
    delegatedHandlersBound = true;
  }

  const search = document.getElementById("search-input");
  const cat = document.getElementById("category-filter");
  if (search && cat) {
    search.addEventListener("input", () => {
      const params = getHashParams();
      params.set("q", search.value);
      params.set("cat", cat.value);
      setRoute(`/inventory?${params.toString()}`);
    });

    cat.addEventListener("change", () => {
      const params = getHashParams();
      params.set("q", search.value);
      params.set("cat", cat.value);
      setRoute(`/inventory?${params.toString()}`);
    });
  }

  const saveItemBtn = document.getElementById("save-item");
  if (saveItemBtn) saveItemBtn.addEventListener("click", () => {
    saveInventoryItem();
    onRender();
  });

  const toggleFormBtn = document.getElementById("toggle-item-form");
  if (toggleFormBtn) toggleFormBtn.addEventListener("click", () => toggleForm());

  const savePrefsBtn = document.getElementById("save-prefs");
  if (savePrefsBtn) savePrefsBtn.addEventListener("click", () => {
    savePrefs();
    onRender();
  });

  const addCategoryBtn = document.getElementById("add-category");
  if (addCategoryBtn) addCategoryBtn.addEventListener("click", () => {
    const name = prompt("Category name");
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
    onRender();
  });

  const clear = document.getElementById("clear-data");
  if (clear) clear.addEventListener("click", () => {
    if (!confirm("Delete all data?")) return;
    resetState();
    saveState();
    setRoute("/");
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
      return { ...item, percentage: 100, in_shopping_list: false, updated_date: Date.now() };
    });

    setState(next);
    saveState();
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

  if (action === "delete-item") {
    next.items = next.items.filter((i) => i.id !== id);
  }

  if (action === "edit-item" && item) {
    toggleForm(true);
    fillItemForm(item);
    const saveBtn = document.getElementById("save-item");
    if (saveBtn) saveBtn.setAttribute("data-edit-id", item.id);
  }

  if (action === "toggle-shopping" && item) {
    item.in_shopping_list = !item.in_shopping_list;
    item.updated_date = Date.now();
  }

  if (action === "remove-shopping" && item) {
    item.in_shopping_list = false;
    item.updated_date = Date.now();
  }

  if (action === "add-to-shop" && item) {
    item.in_shopping_list = true;
    item.updated_date = Date.now();
  }

  if (action === "delete-category") {
    const cat = next.categories.find((c) => c.id === id);
    if (cat) {
      next.categories = next.categories.filter((c) => c.id !== id);
      next.items = next.items.map((i) => (i.category === cat.name ? { ...i, category: "Unsorted" } : i));
    }
  }

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
  const category = document.getElementById("item-category");
  const stock = document.getElementById("item-stock");
  const threshold = document.getElementById("item-threshold");
  const expiry = document.getElementById("item-expiry");

  if (name) name.value = item.name || "";
  const firstCategory = state.categories.length ? state.categories[0].name : "Unsorted";
  if (category) category.value = item.category || firstCategory || "Unsorted";
  if (stock) stock.value = String(clamp(item.percentage || 0));
  if (threshold) threshold.value = String(clamp(item.low_threshold || 25));
  if (expiry) expiry.value = item.expiry_date || "";
}

function saveInventoryItem() {
  const nameInput = document.getElementById("item-name");
  const categoryInput = document.getElementById("item-category");
  const stockInput = document.getElementById("item-stock");
  const thresholdInput = document.getElementById("item-threshold");
  const expiryInput = document.getElementById("item-expiry");

  const name = (nameInput && nameInput.value ? nameInput.value : "").trim();
  const category = (categoryInput && categoryInput.value) || "Unsorted";
  const stock = clamp(Number((stockInput && stockInput.value) || 0));
  const threshold = clamp(Number((thresholdInput && thresholdInput.value) || 25));
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
            category,
            percentage: stock,
            low_threshold: threshold,
            expiry_date: expiry,
            updated_date: Date.now(),
          }
        : item
    );
    if (btn) btn.removeAttribute("data-edit-id");
  } else {
    next.items.unshift({
      id: safeUuid(),
      name,
      category,
      percentage: stock,
      low_threshold: threshold,
      in_shopping_list: stock <= threshold,
      expiry_date: expiry,
      updated_date: Date.now(),
    });
  }

  setState(next);
  saveState();
}

function savePrefs() {
  const profileInput = document.getElementById("prefs-profile");
  const homeInput = document.getElementById("prefs-home");
  const themeInput = document.getElementById("prefs-theme");
  const darkInput = document.getElementById("prefs-dark");

  const profile = (profileInput && profileInput.value ? profileInput.value : "").trim();
  const home = (homeInput && homeInput.value ? homeInput.value : "").trim() || defaultHomeName;
  const theme = (themeInput && themeInput.value) || "teal";
  const dark = (darkInput && darkInput.value) === "true";

  const state = getState();
  const next = deepClone(state);
  next.prefs.profile_name = profile;
  next.prefs.home_name = home;
  next.prefs.theme = theme;
  next.prefs.dark_mode = dark;

  setState(next);
  saveState();
}
