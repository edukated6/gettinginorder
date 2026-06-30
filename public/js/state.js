/*
  state.js
  Purpose:
  - Hold local app state and persistence helpers.
  - Track current inventory and apply theme variables.
*/

const DATA_KEY = "norder_vanilla_data";
const INVENTORY_KEY = "norder_current_inventory";

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

function toFiniteTimestamp(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

const ACCOUNT_PREF_DEFAULTS = {
  profile_name: "",
  profile_picture: "",
  profile_uid: "",
  theme: "teal",
  dark_mode: true,
  onboarding_complete: false,
  signed_in: false,
};

const INVENTORY_PREF_DEFAULTS = {
  home_name: "Inventory Hub",
  item_tombstone_retention_days: 30,
  notification_expiry_enabled: true,
  notification_stock_enabled: true,
  notification_wear_enabled: true,
  notification_restock_enabled: true,
  notification_expiry_soon_days: 7,
};

function createDefaults() {
  return {
    account: {
      ...ACCOUNT_PREF_DEFAULTS,
    },
    inventory: {
      ...INVENTORY_PREF_DEFAULTS,
    },
    prefs: {
      ...INVENTORY_PREF_DEFAULTS,
      ...ACCOUNT_PREF_DEFAULTS,
    },
    categories: [
      { id: "cat-kitchen", name: "Kitchen", icon: "KT", color: "#f59e0b" },
      { id: "cat-bath", name: "Bath", icon: "BT", color: "#3b82f6" },
      { id: "cat-clean", name: "Cleaning", icon: "CL", color: "#10b981" },
    ],
    categories_updated_at: 0,
    items: [
      {
        id: safeUuid(),
        name: "Olive Oil",
        category: "Kitchen",
        stock_level: "Half",
        percentage: 35,
        low_threshold: 25,
        in_shopping_list: false,
        updated_date: Date.now(),
        expiry_date: "",
      },
      {
        id: safeUuid(),
        name: "Shampoo",
        category: "Bath",
        stock_level: "Almost Empty",
        percentage: 22,
        low_threshold: 30,
        in_shopping_list: true,
        updated_date: Date.now(),
        expiry_date: "",
      },
    ],
    item_tombstones: {},
    budget: {
      monthly_income: 0,
      bills: [],
    },
  };
}

function pickByTemplate(source, template) {
  const input = source && typeof source === "object" ? source : {};
  const result = {};
  Object.keys(template).forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      result[key] = input[key];
    }
  });
  return result;
}

function composePrefs(account, inventory) {
  const merged = {
    ...INVENTORY_PREF_DEFAULTS,
    ...ACCOUNT_PREF_DEFAULTS,
    ...(inventory && typeof inventory === "object" ? inventory : {}),
    ...(account && typeof account === "object" ? account : {}),
  };
  return {
    ...merged,
    theme: "teal",
    dark_mode: true,
  };
}

function normalizeStateShape(inputState, defaults = createDefaults()) {
  const input = inputState && typeof inputState === "object" ? inputState : {};
  const legacyPrefs = input.prefs && typeof input.prefs === "object" ? input.prefs : {};

  const account = {
    ...defaults.account,
    ...pickByTemplate(input.account, ACCOUNT_PREF_DEFAULTS),
    // Treat merged prefs as the source of truth when both structures are present.
    ...pickByTemplate(legacyPrefs, ACCOUNT_PREF_DEFAULTS),
    theme: "teal",
    dark_mode: true,
  };

  const inventory = {
    ...defaults.inventory,
    ...pickByTemplate(input.inventory, INVENTORY_PREF_DEFAULTS),
    // Treat merged prefs as the source of truth when both structures are present.
    ...pickByTemplate(legacyPrefs, INVENTORY_PREF_DEFAULTS),
  };

  const budget = {
    monthly_income: 0,
    bills: [],
    ...(input.budget && typeof input.budget === "object" ? input.budget : {}),
  };

  return {
    ...deepClone(defaults),
    ...input,
    account,
    inventory,
    prefs: composePrefs(account, inventory),
    budget,
    categories: Array.isArray(input.categories) ? input.categories : deepClone(defaults.categories),
    categories_updated_at: toFiniteTimestamp(input.categories_updated_at),
    items: Array.isArray(input.items) ? input.items : deepClone(defaults.items),
    item_tombstones:
      input.item_tombstones && typeof input.item_tombstones === "object"
        ? input.item_tombstones
        : {},
  };
}

function loadState() {
  const defaults = createDefaults();
  try {
    const raw = localStorage.getItem(DATA_KEY);
    if (!raw) return deepClone(defaults);
    const parsed = JSON.parse(raw);
    return normalizeStateShape(parsed, defaults);
  } catch {
    return deepClone(defaults);
  }
}

let state = loadState();
let currentInventoryId = localStorage.getItem(INVENTORY_KEY);

export function getState() {
  return state;
}

export function setState(nextState) {
  state = normalizeStateShape(nextState);
}

export function updateState(updater) {
  const next = updater(deepClone(state));
  state = normalizeStateShape(next);
}

export function resetState() {
  state = createDefaults();
}

export function resetInventoryData() {
  state = {
    ...state,
    categories: deepClone(createDefaults().categories),
    categories_updated_at: Date.now(),
    items: [],
    item_tombstones: {},
  };
}

export function saveState() {
  localStorage.setItem(DATA_KEY, JSON.stringify(state));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("norder:state-saved"));
  }
}

export function saveStateLocalOnly() {
  localStorage.setItem(DATA_KEY, JSON.stringify(state));
}

export function setCurrentInventory(inventoryId) {
  currentInventoryId = inventoryId;
  if (inventoryId) {
    localStorage.setItem(INVENTORY_KEY, inventoryId);
  } else {
    localStorage.removeItem(INVENTORY_KEY);
  }
}

export function getCurrentInventoryId() {
  return currentInventoryId;
}

export function getDefaultCategories() {
  return deepClone(createDefaults().categories);
}

export function applyTheme() {
  const darkMode = state.prefs.dark_mode;
  document.documentElement.classList.toggle("dark", Boolean(darkMode));

  const palette = {
    teal: "#1f7a69",
    coral: "#e26c45",
    amber: "#c98526",
    blue: "#366fc9",
    rose: "#c8486b",
  };
  const theme = state.prefs.theme;
  const color = palette[theme] || palette.teal;
  document.documentElement.style.setProperty("--primary", color);
}

export const defaultHomeName = INVENTORY_PREF_DEFAULTS.home_name;

