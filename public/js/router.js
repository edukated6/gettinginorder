export function getRoute() {
  const hash = window.location.hash || "#/";
  const normalized = hash.startsWith("#") ? hash.slice(1) : hash;
  const [path] = normalized.split("?");
  return path || "/";
}

export function getHashParams() {
  const hash = window.location.hash || "#/";
  const normalized = hash.startsWith("#") ? hash.slice(1) : hash;
  const query = normalized.includes("?") ? normalized.split("?")[1] : "";
  return new URLSearchParams(query);
}

export function setRoute(route) {
  window.location.hash = route.startsWith("#") ? route : `#${route}`;
}
