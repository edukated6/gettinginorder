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

function createDefaults() {
  return {
    prefs: {
      home_name: "Home Stock",
      profile_name: "",
      theme: "teal",
      dark_mode: false,
      onboarding_complete: false,
      signed_in: false,
    },
    categories: [
      { id: "cat-kitchen", name: "Kitchen", icon: "KT" },
      { id: "cat-bath", name: "Bath", icon: "BT" },
      { id: "cat-clean", name: "Cleaning", icon: "CL" },
    ],
    items: [
      {
        id: safeUuid(),
        name: "Olive Oil",
        category: "Kitchen",
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
        percentage: 22,
        low_threshold: 30,
        in_shopping_list: true,
        updated_date: Date.now(),
        expiry_date: "",
      },
    ],
  };
}

function loadState() {
  const defaults = createDefaults();
  try {
    const raw = localStorage.getItem(DATA_KEY);
    if (!raw) return deepClone(defaults);
    const parsed = JSON.parse(raw);
    return {
      ...deepClone(defaults),
      ...parsed,
      prefs: { ...defaults.prefs, ...(parsed.prefs || {}) },
      categories: parsed.categories || deepClone(defaults.categories),
      items: parsed.items || deepClone(defaults.items),
    };
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
  state = nextState;
}

export function updateState(updater) {
  const next = updater(deepClone(state));
  state = next;
}

export function resetState() {
  state = createDefaults();
}

export function saveState() {
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

export function applyTheme() {
  document.documentElement.classList.toggle("dark", Boolean(state.prefs.dark_mode));

  const palette = {
    teal: "#1f7a69",
    coral: "#e26c45",
    amber: "#c98526",
    blue: "#366fc9",
    rose: "#c8486b",
  };
  const color = palette[state.prefs.theme] || palette.teal;
  document.documentElement.style.setProperty("--primary", color);
}

export const defaultHomeName = createDefaults().prefs.home_name;

