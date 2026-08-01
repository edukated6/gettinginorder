/*
  router.js
  Purpose:
  - Route utilities with masked URLs.
  - Keep visible URL pinned to origin while routing in memory.
*/

let activeRoute = "/";
let activeQuery = "";

function toNormalizedRoute(input) {
  const raw = String(input || "").trim();
  if (!raw) return { path: "/", query: "" };

  const withoutHash = raw.startsWith("#") ? raw.slice(1) : raw;
  const withLeadingSlash = withoutHash.startsWith("/") ? withoutHash : `/${withoutHash}`;
  const [pathPart, queryPart = ""] = withLeadingSlash.split("?");

  return {
    path: pathPart || "/",
    query: queryPart,
  };
}

function clearVisibleUrl() {
  if (typeof window === "undefined" || !window.history || !window.history.replaceState) return;
  const params = new URLSearchParams(window.location.search || "");
  const budgetMarkerActive = String(params.get("app") || "").trim().toLowerCase() === "budget";
  if (budgetMarkerActive) {
    if (window.location.pathname === "/" && window.location.search === "?app=budget" && !window.location.hash) return;
    window.history.replaceState(null, "", "/?app=budget");
    return;
  }
  if (window.location.pathname === "/" && !window.location.search && !window.location.hash) return;
  window.history.replaceState(null, "", "/");
}

function emitRouteChange() {
  window.dispatchEvent(new Event("norder:routechange"));
}

function applyRoute(routeLike, shouldEmit = false) {
  const next = toNormalizedRoute(routeLike);
  activeRoute = next.path;
  activeQuery = next.query;
  clearVisibleUrl();
  if (shouldEmit) emitRouteChange();
}

function getRouteLikeFromLocation() {
  if (window.location.hash) {
    return window.location.hash.slice(1);
  }

  if (window.location.pathname && window.location.pathname !== "/") {
    return `${window.location.pathname}${window.location.search || ""}`;
  }

  return "/";
}

applyRoute(getRouteLikeFromLocation(), false);

window.addEventListener("hashchange", () => {
  if (!window.location.hash) return;
  applyRoute(window.location.hash.slice(1), true);
});

export function getRoute() {
  return activeRoute;
}

export function getHashParams() {
  return new URLSearchParams(activeQuery);
}

export function setRoute(route) {
  const next = toNormalizedRoute(route);
  if (next.path === activeRoute && next.query === activeQuery) return;
  applyRoute(route, true);
}
