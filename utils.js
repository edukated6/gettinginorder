export function clamp(value) {
  const n = Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

export const STOCK_LEVELS = ["Empty", "Almost Empty", "Half", "Almost Half", "Full"];
export const UNIT_STOCK_LEVELS = [...STOCK_LEVELS];

const STOCK_LEVEL_TO_PERCENT = {
  Empty: 0,
  "Almost Empty": 20,
  Half: 50,
  "Almost Half": 75,
  Full: 100,
};

export function percentageToStockLevel(value) {
  const percent = clamp(Number(value));
  if (percent <= 5) return "Empty";
  if (percent <= 30) return "Almost Empty";
  if (percent <= 60) return "Half";
  if (percent <= 85) return "Almost Half";
  return "Full";
}

export function normalizeStockLevel(level, fallbackPercent = 50) {
  if (typeof level === "string" && STOCK_LEVEL_TO_PERCENT[level] !== undefined) {
    return level;
  }
  return percentageToStockLevel(fallbackPercent);
}

export function stockLevelToPercentage(level) {
  return STOCK_LEVEL_TO_PERCENT[normalizeStockLevel(level)] || 0;
}

export function normalizeItemQuantity(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, 24);
}

export function normalizeUnitStockLevel(level, fallback = "Half") {
  const normalizedFallback = UNIT_STOCK_LEVELS.includes(fallback) ? fallback : "Half";
  return UNIT_STOCK_LEVELS.includes(level) ? level : normalizedFallback;
}

export function buildUnitStockLevels(quantity, levels, fallback = "Half") {
  const normalizedQuantity = normalizeItemQuantity(quantity);
  const safeLevels = Array.isArray(levels) ? levels : [];
  const fallbackUnit = normalizeUnitStockLevel(normalizeStockLevel(fallback));

  return Array.from({ length: normalizedQuantity }, (_, index) => {
    const next = safeLevels[index];
    return normalizeUnitStockLevel(next, fallbackUnit);
  });
}

export function summarizeUnitStockLevels(levels) {
  const summary = { Empty: 0, "Almost Empty": 0, Half: 0, "Almost Half": 0, Full: 0 };
  const safeLevels = Array.isArray(levels) ? levels : [];

  safeLevels.forEach((level) => {
    const normalized = normalizeUnitStockLevel(level);
    summary[normalized] += 1;
  });

  return summary;
}

export function getItemQuantity(item) {
  return normalizeItemQuantity(item && item.quantity);
}

function getUnitStockAveragePercentage(levels) {
  const safeLevels = Array.isArray(levels) ? levels : [];
  if (!safeLevels.length) return 50;

  const total = safeLevels.reduce((sum, level) => {
    const normalized = normalizeUnitStockLevel(level);
    return sum + stockLevelToPercentage(normalized);
  }, 0);

  return total / safeLevels.length;
}

function getLegacyItemStockLevel(item) {
  if (!item) return "Half";
  return normalizeStockLevel(item.stock_level, item.percentage);
}

export function getItemUnitStockLevels(item) {
  if (!item) return ["Half"];

  const quantity = getItemQuantity(item);
  const existing = Array.isArray(item.unit_stock_levels) ? item.unit_stock_levels : [];
  const fallback = getLegacyItemStockLevel(item);
  return buildUnitStockLevels(quantity, existing, fallback);
}

export function getItemStockLevel(item) {
  if (!item) return "Half";

  const quantity = getItemQuantity(item);
  if (quantity > 1) {
    return normalizeStockLevel(undefined, getUnitStockAveragePercentage(getItemUnitStockLevels(item)));
  }

  return getLegacyItemStockLevel(item);
}

export function getItemStockPercentage(item) {
  if (!item) return stockLevelToPercentage("Half");

  const quantity = getItemQuantity(item);
  if (quantity > 1) {
    return clamp(getUnitStockAveragePercentage(getItemUnitStockLevels(item)));
  }

  return stockLevelToPercentage(getItemStockLevel(item));
}

export function isLowStockLevel(level) {
  const normalized = normalizeStockLevel(level);
  return normalized === "Empty" || normalized === "Almost Empty";
}
