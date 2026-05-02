/*
  public/app.js
  Purpose:
  - Main application controller and route renderer.
  - Connects auth, inventory sync, and page rendering.
  - Decides what screen to show for each hash route.

  Editing tips:
  - Add a new screen: create a render function in views.js, then wire route handling in render().
  - Add data syncing: collaboration.js handles Firebase reads/writes.
  - Keep this file focused on orchestration, not UI markup.
*/

import {
  initializeAuth,
  getCurrentUser,
  isAuthSessionLocked,
  isOnboardingRequired,
  lockAuthSession,
  onAuthStateChanged,
  pruneStaleRecentAccounts,
  waitForAuthReady,
} from "./js/auth.js";
import {
  wireAuthEvents,
  wireInventorySelectionEvents,
  wireCollaborationEvents,
  wireOnboardingEvents,
  wireProfileEvents,
} from "./js/auth-events.js";
import { getRoute, setRoute } from "./js/router.js";
import {
  getState,
  setState,
  saveState,
  applyTheme,
  getDefaultCategories,
  getCurrentInventoryId,
} from "./js/state.js";
import { wireWelcomeEvents, wireSharedEvents } from "./js/events.js";
import {
  renderWelcome,
  renderDashboard,
  renderInventory,
  renderShopping,
  renderSettings,
  renderActivityLog,
  renderLogin,
  renderAboutPage,
  renderTermsPage,
  renderWelcomeTermsPage,
  renderWelcomeAboutPage,
  renderOnboardingProfile,
  renderProfile,
  renderProfileSettings,
  renderMyInventories,
  renderCollaborationSettings,
} from "./js/views.js?v=20260502b";
import {
  getUserInventories,
  getCollaborators,
  getInviteCodes,
  getInventoryActivityLogs,
  getUserAccountPrefs,
  listenToInventory,
  updateInventoryData,
  listenToUserAccountPrefs,
  updateUserAccountPrefs,
} from "./js/collaboration.js";

let authInitialized = false;
let firebaseAvailable = false;
let userInventories = {};
let collaborators = {};
let inviteCodes = {};
let activityLogs = [];
let isOwner = false;
let authStateReady = false;

let activeInventorySyncId = null;
let unsubscribeInventorySync = null;
let awaitingInitialInventorySnapshot = false;
let suppressCloudUpload = false;
let lastUploadedInventorySnapshot = "";
let activeUserPrefsSyncKey = "";
let unsubscribeUserPrefsSync = null;
let suppressUserPrefsCloudUpload = false;
let lastUploadedUserPrefsSnapshot = "";
let userPrefsSyncReady = false;
let lastAuthUid = "";

let syncIndicatorState = "idle";
let syncIndicatorText = "Sync idle";
const USER_PREFS_BY_UID_KEY = "norder_user_prefs_by_uid";
const SESSION_LOGIN_GATE_KEY = "norder_login_gate_initialized";
const SUPPRESS_RESUME_SYNC_UNTIL_KEY = "__norderSuppressResumeSyncUntil";
const DEFAULT_ITEM_TOMBSTONE_RETENTION_DAYS = 30;
const MIN_ITEM_TOMBSTONE_RETENTION_DAYS = 1;
const MAX_ITEM_TOMBSTONE_RETENTION_DAYS = 365;

function shouldSuppressResumeSync() {
  if (typeof window === "undefined") return false;
  const until = Number(window[SUPPRESS_RESUME_SYNC_UNTIL_KEY] || 0);
  return Number.isFinite(until) && until > Date.now();
}

// Forces every fresh browser session to start at login screen.
function enforceFreshSessionLoginGate() {
  if (typeof sessionStorage === "undefined") return;
  if (sessionStorage.getItem(SESSION_LOGIN_GATE_KEY) === "1") return;
  sessionStorage.setItem(SESSION_LOGIN_GATE_KEY, "1");
  lockAuthSession();
}

function readUserPrefsByUid() {
  try {
    const raw = localStorage.getItem(USER_PREFS_BY_UID_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function writeUserPrefsByUid(data) {
  try {
    localStorage.setItem(USER_PREFS_BY_UID_KEY, JSON.stringify(data || {}));
  } catch (_error) {
    // Ignore storage failures and continue without per-user preference caching.
  }
}

function getStoredUserPrefs(uid) {
  const key = String(uid || "").trim();
  if (!key) return null;
  const map = readUserPrefsByUid();
  const entry = map[key];
  return entry && typeof entry === "object" ? entry : null;
}

function persistCurrentUserPrefs(user) {
  if (!user || !user.uid) return;
  if (!userPrefsSyncReady) return;
  const state = getState();
  const stateUid = String((state && state.prefs && state.prefs.profile_uid) || "").trim();
  if (stateUid && stateUid !== user.uid) return;
  const map = readUserPrefsByUid();
  map[user.uid] = {
    theme: String(state.prefs.theme || "teal"),
    dark_mode: Boolean(state.prefs.dark_mode),
    profile_picture: String(state.prefs.profile_picture || ""),
  };
  writeUserPrefsByUid(map);
}

function checkFirebaseAvailable() {
  return typeof firebase !== "undefined" && firebase.auth && firebase.database;
}

function getSyncIndicatorText(state) {
  if (state === "synced") return "Synced";
  if (state === "syncing") return "Syncing...";
  if (state === "error") return "Sync error";
  if (state === "local") return "Local only";
  return "Sync idle";
}

function setSyncIndicator(state, text) {
  syncIndicatorState = state;
  syncIndicatorText = text || getSyncIndicatorText(state);

  const indicator = document.getElementById("sync-indicator");
  if (!indicator) return;
  indicator.setAttribute("data-state", syncIndicatorState);
  indicator.innerText = syncIndicatorText;
}

function refreshSyncIndicator() {
  setSyncIndicator(syncIndicatorState, syncIndicatorText);
}

function showResumeSyncBanner(text = "Syncing...") {
  if (typeof document === "undefined") return;
  const id = "norder-resume-sync-banner";
  let banner = document.getElementById(id);
  if (!banner) {
    banner = document.createElement("div");
    banner.id = id;
    banner.style.position = "fixed";
    banner.style.top = "12px";
    banner.style.left = "50%";
    banner.style.transform = "translateX(-50%)";
    banner.style.zIndex = "9998";
    banner.style.padding = "8px 12px";
    banner.style.borderRadius = "999px";
    banner.style.fontSize = "0.85rem";
    banner.style.fontWeight = "600";
    banner.style.background = "color-mix(in srgb, var(--primary) 90%, black 10%)";
    banner.style.color = "var(--on-primary, #fff)";
    banner.style.boxShadow = "0 6px 20px rgba(0, 0, 0, 0.22)";
    banner.style.pointerEvents = "none";
    banner.style.opacity = "0";
    banner.style.transition = "opacity 120ms ease";
    document.body.appendChild(banner);
  }

  banner.textContent = String(text || "Syncing...");
  banner.style.display = "block";
  requestAnimationFrame(() => {
    banner.style.opacity = "1";
  });
}

function hideResumeSyncBanner() {
  if (typeof document === "undefined") return;
  const banner = document.getElementById("norder-resume-sync-banner");
  if (!banner) return;
  banner.style.opacity = "0";
  setTimeout(() => {
    if (banner && banner.parentNode) {
      banner.parentNode.removeChild(banner);
    }
  }, 140);
}

function enforceSignInThemeDefault() {
  const root = document.documentElement;
  root.classList.add("dark");
  root.style.setProperty("--primary", "#1f7a69");
}

function syncUserPrefsFromAuth(user) {
  if (!user) return;
  const state = getState();
  const sameUser = state.prefs.profile_uid === user.uid;
  const storedPrefs = getStoredUserPrefs(user.uid);
  const nextName = String(user.displayName || "").trim();
  const authPhoto = String(user.photoURL || "").trim();
  const cachedPhoto =
    storedPrefs && typeof storedPrefs.profile_picture === "string"
      ? String(storedPrefs.profile_picture || "").trim()
      : "";
  const existingPhoto = sameUser ? String(state.prefs.profile_picture || "").trim() : "";
  // For active sessions, keep the current in-memory value ahead of cached values to avoid stale-photo regressions.
  const nextPhoto = sameUser ? (existingPhoto || cachedPhoto || authPhoto) : (cachedPhoto || authPhoto);
  const nextTheme =
    storedPrefs && typeof storedPrefs.theme === "string" && storedPrefs.theme
      ? storedPrefs.theme
      : sameUser
      ? state.prefs.theme
      : "teal";
  const nextDark =
    storedPrefs && typeof storedPrefs.dark_mode === "boolean"
      ? storedPrefs.dark_mode
      : sameUser
      ? Boolean(state.prefs.dark_mode)
      : true;
  const nextOnboarding = Boolean(nextName);
  const hasChanged =
    state.prefs.profile_uid !== (user.uid || "") ||
    state.prefs.profile_name !== nextName ||
    state.prefs.profile_picture !== nextPhoto ||
    state.prefs.theme !== nextTheme ||
    Boolean(state.prefs.dark_mode) !== Boolean(nextDark) ||
    state.prefs.onboarding_complete !== nextOnboarding;

  if (!hasChanged) return;

  setState({
    ...state,
    prefs: {
      ...state.prefs,
      profile_uid: user.uid || "",
      profile_name: nextName,
      profile_picture: nextPhoto,
      theme: nextTheme,
      dark_mode: nextDark,
      onboarding_complete: nextOnboarding,
    },
  });
  saveState();
  applyTheme();
}

function toInventoryPayload() {
  const state = getState();
  const items = Array.isArray(state.items) ? state.items : [];
  const retentionDays = normalizeRetentionDays(state.prefs.item_tombstone_retention_days);
  const tombstones = pruneLocalItemTombstones(state.item_tombstones, items, retentionDays);
  return {
    prefs: {
      home_name: state.prefs.home_name,
      item_tombstone_retention_days: retentionDays,
    },
    categories: state.categories,
    categories_updated_at: toFiniteTimestamp(state.categories_updated_at),
    items,
    item_tombstones: tombstones,
  };
}

function toFiniteTimestamp(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeRetentionDays(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_ITEM_TOMBSTONE_RETENTION_DAYS;
  return Math.min(MAX_ITEM_TOMBSTONE_RETENTION_DAYS, Math.max(MIN_ITEM_TOMBSTONE_RETENTION_DAYS, Math.round(parsed)));
}

function retentionDaysToMs(days) {
  return normalizeRetentionDays(days) * 24 * 60 * 60 * 1000;
}

function pruneLocalItemTombstones(tombstones, items, retentionDays) {
  const nowTs = Date.now();
  const cutoffTs = nowTs - retentionDaysToMs(retentionDays);
  const normalized =
    tombstones && typeof tombstones === "object"
      ? tombstones
      : {};

  const latestItemTsById = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    if (!item || typeof item !== "object") return;
    const id = String(item.id || "").trim();
    if (!id) return;
    const updatedTs = toFiniteTimestamp(item.updated_date);
    const existing = toFiniteTimestamp(latestItemTsById.get(id));
    latestItemTsById.set(id, Math.max(existing, updatedTs));
  });

  const next = {};
  Object.entries(normalized).forEach(([rawId, rawTs]) => {
    const id = String(rawId || "").trim();
    if (!id) return;
    const ts = toFiniteTimestamp(rawTs);
    if (!ts || ts <= cutoffTs) return;
    const latestItemTs = toFiniteTimestamp(latestItemTsById.get(id));
    if (latestItemTs > ts) return;
    next[id] = ts;
  });

  return next;
}

function toUserPrefsPayload() {
  const state = getState();
  return {
    theme: String(state.prefs.theme || "teal"),
    dark_mode: Boolean(state.prefs.dark_mode),
    profile_picture: String(state.prefs.profile_picture || ""),
  };
}

function coerceDarkMode(value, fallback) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
      return false;
    }
  }
  return Boolean(fallback);
}

function applyRemoteUserPrefs(remotePrefs) {
  if (!remotePrefs || typeof remotePrefs !== "object") return;

  const state = getState();
  const theme = String((remotePrefs && remotePrefs.theme) || "").trim() || state.prefs.theme || "teal";
  const dark = coerceDarkMode(remotePrefs.dark_mode, state.prefs.dark_mode);
  const currentPhoto = String(state.prefs.profile_picture || "").trim();
  const hasExplicitProfilePicture = Object.prototype.hasOwnProperty.call(remotePrefs, "profile_picture");
  const legacyPhoto =
    typeof remotePrefs.photoURL === "string"
      ? String(remotePrefs.photoURL || "").trim()
      : "";
  const photo = hasExplicitProfilePicture
    ? String(remotePrefs.profile_picture || "").trim()
    : (legacyPhoto || currentPhoto);

  const hasChanged =
    state.prefs.theme !== theme ||
    Boolean(state.prefs.dark_mode) !== Boolean(dark) ||
    String(state.prefs.profile_picture || "") !== photo;

  if (!hasChanged) {
    lastUploadedUserPrefsSnapshot = JSON.stringify(toUserPrefsPayload());
    return;
  }

  suppressUserPrefsCloudUpload = true;
  setState({
    ...state,
    prefs: {
      ...state.prefs,
      theme,
      dark_mode: dark,
      profile_picture: photo,
    },
  });
  saveState();
  applyTheme();
  suppressUserPrefsCloudUpload = false;

  lastUploadedUserPrefsSnapshot = JSON.stringify(toUserPrefsPayload());
}

function stopInventorySync() {
  if (typeof unsubscribeInventorySync === "function") {
    unsubscribeInventorySync();
  }
  unsubscribeInventorySync = null;
  activeInventorySyncId = null;
  awaitingInitialInventorySnapshot = false;
  lastUploadedInventorySnapshot = "";
  setSyncIndicator(firebaseAvailable ? "idle" : "local");
}

function stopUserPrefsSync() {
  if (typeof unsubscribeUserPrefsSync === "function") {
    unsubscribeUserPrefsSync();
  }
  unsubscribeUserPrefsSync = null;
  activeUserPrefsSyncKey = "";
  lastUploadedUserPrefsSnapshot = "";
  userPrefsSyncReady = false;
}

function applyRemoteInventoryData(remoteData) {
  if (!remoteData || typeof remoteData !== "object") return;
  const state = getState();
  const remotePrefs = remoteData && typeof remoteData.prefs === "object" ? remoteData.prefs : {};
  const fallbackCategories = getDefaultCategories();
  const sharedPrefs = {
    home_name: String((remotePrefs && remotePrefs.home_name) || state.prefs.home_name || "").trim() ||
      state.prefs.home_name,
    item_tombstone_retention_days: normalizeRetentionDays(
      (remotePrefs && remotePrefs.item_tombstone_retention_days) || state.prefs.item_tombstone_retention_days
    ),
  };
  const nextItems = Array.isArray(remoteData.items) ? remoteData.items : [];
  const nextTombstones = pruneLocalItemTombstones(
    remoteData.item_tombstones,
    nextItems,
    sharedPrefs.item_tombstone_retention_days
  );
  const next = {
    ...state,
    prefs: { ...state.prefs, ...sharedPrefs },
    categories: Array.isArray(remoteData.categories) ? remoteData.categories : fallbackCategories,
    categories_updated_at: toFiniteTimestamp(remoteData.categories_updated_at),
    items: nextItems,
    item_tombstones: nextTombstones,
  };

  suppressCloudUpload = true;
  setState(next);
  saveState();
  suppressCloudUpload = false;

  lastUploadedInventorySnapshot = JSON.stringify(toInventoryPayload());
  setSyncIndicator("synced");
}

async function pushLocalInventoryToCloud() {
  if (!firebaseAvailable || suppressCloudUpload) return;

  const user = getCurrentUser();
  const inventoryId = getCurrentInventoryId();
  if (!user || !inventoryId) return;

  const payload = toInventoryPayload();
  const snapshot = JSON.stringify(payload);
  if (snapshot === lastUploadedInventorySnapshot) return;

  setSyncIndicator("syncing");
  const ok = await updateInventoryData(inventoryId, payload);
  if (ok) {
    lastUploadedInventorySnapshot = snapshot;
    setSyncIndicator("synced");
  } else {
    setSyncIndicator("error");
  }
}

async function pushLocalUserPrefsToCloud(force = false) {
  if (!firebaseAvailable || suppressUserPrefsCloudUpload) return;
  if (!force && !userPrefsSyncReady) return;

  const user = getCurrentUser();
  if (!user || !user.uid) return;

  const state = getState();
  const stateUid = String((state && state.prefs && state.prefs.profile_uid) || "").trim();
  // Avoid writing account B state into account A cloud prefs during auth handoff races.
  if (stateUid && stateUid !== user.uid) return;

  const payload = toUserPrefsPayload();
  const snapshot = JSON.stringify(payload);
  if (snapshot === lastUploadedUserPrefsSnapshot) return;

  const ok = await updateUserAccountPrefs(user.uid, payload);
  if (ok) {
    lastUploadedUserPrefsSnapshot = snapshot;
  }
}

function ensureInventorySync(inventoryId) {
  if (!inventoryId) {
    stopInventorySync();
    return;
  }

  if (activeInventorySyncId === inventoryId && typeof unsubscribeInventorySync === "function") {
    return;
  }

  stopInventorySync();
  activeInventorySyncId = inventoryId;
  awaitingInitialInventorySnapshot = true;
  setSyncIndicator("syncing");
  unsubscribeInventorySync = listenToInventory(inventoryId, (remoteData) => {
    awaitingInitialInventorySnapshot = false;
    if (remoteData && typeof remoteData === "object") {
      applyRemoteInventoryData(remoteData);
    } else {
      setSyncIndicator("synced");
    }
    render();
  });
}

function shouldGuardInventoryRoute(route) {
  return (
    route === "/dashboard" ||
    route === "/inventory" ||
    route === "/shopping" ||
    route === "/settings"
  );
}

async function ensureUserPrefsSync(userId) {
  if (!userId) {
    stopUserPrefsSync();
    return;
  }

  const nextKey = String(userId);
  if (activeUserPrefsSyncKey === nextKey && typeof unsubscribeUserPrefsSync === "function") {
    return;
  }

  stopUserPrefsSync();
  activeUserPrefsSyncKey = nextKey;

  try {
    const remotePrefs = await getUserAccountPrefs(userId);
    if (typeof remotePrefs === "undefined") {
      // Read failed (often transient on mobile); wait for realtime listener below.
    } else if (remotePrefs && typeof remotePrefs === "object") {
      applyRemoteUserPrefs(remotePrefs);
      userPrefsSyncReady = true;
    } else {
      userPrefsSyncReady = true;
      // Do not bootstrap-write local prefs when the initial snapshot is empty.
      // A transient empty read can happen before realtime catches up and would
      // overwrite newer avatar/theme data from another device.
    }
  } catch (error) {
    console.warn("User preference sync bootstrap failed:", error);
  }

  unsubscribeUserPrefsSync = listenToUserAccountPrefs(userId, (remotePrefs) => {
    if (remotePrefs && typeof remotePrefs === "object") {
      applyRemoteUserPrefs(remotePrefs);
    }
    userPrefsSyncReady = true;
    render();
  });
}

// Core route renderer. This is the main app state machine.
async function render() {
  applyTheme();
  const app = document.getElementById("app");
  const route = getRoute();
  const user = getCurrentUser();

  if (!firebaseAvailable) {
    if (route === "/") {
      app.innerHTML = renderWelcome();
      wireWelcomeEvents(render);
      return;
    }

    if (route === "/about-welcome") {
      enforceSignInThemeDefault();
      app.innerHTML = renderWelcomeAboutPage(false);
      return;
    }

    if (route === "/terms-welcome") {
      enforceSignInThemeDefault();
      app.innerHTML = renderWelcomeTermsPage(false);
      return;
    }

    if (route === "/about") {
      app.innerHTML = renderAboutPage();
      wireSharedEvents(render);
      return;
    }

    if (route === "/terms") {
      app.innerHTML = renderTermsPage();
      wireSharedEvents(render);
      return;
    }

    if (route === "/dashboard") app.innerHTML = renderDashboard();
    else if (route === "/inventory") app.innerHTML = renderInventory();
    else if (route === "/shopping") app.innerHTML = renderShopping();
    else if (route === "/settings") {
      app.innerHTML = renderSettings();
      setSyncIndicator("local");
      wireCollaborationEvents(render);
    } else {
      setRoute("/dashboard");
      return;
    }

    wireSharedEvents(render);
    return;
  }

  if (!authStateReady) {
    app.innerHTML = `
      <div class="welcome">
        <section class="welcome-card">
          <h1>nORDER</h1>
          <p class="muted">Restoring your session...</p>
        </section>
      </div>
    `;
    return;
  }

  if (route === "/about-welcome") {
    enforceSignInThemeDefault();
    app.innerHTML = renderWelcomeAboutPage(false);
    return;
  }

  if (route === "/terms-welcome") {
    enforceSignInThemeDefault();
    app.innerHTML = renderWelcomeTermsPage(false);
    return;
  }

  if (route === "/about") {
    if (!user) {
      setRoute("/about-welcome");
      return;
    }

    app.innerHTML = renderAboutPage();
    wireSharedEvents(render);
    return;
  }

  if (route === "/terms") {
    if (!user) {
      app.innerHTML = renderWelcomeTermsPage(false);
      return;
    }

    app.innerHTML = renderTermsPage();
    wireSharedEvents(render);
    return;
  }

  if (route === "/login") {
    enforceSignInThemeDefault();
    if (user) {
      syncUserPrefsFromAuth(user);
      await ensureUserPrefsSync(user.uid);
    }
    if (user && !isAuthSessionLocked()) {
      setRoute(isOnboardingRequired(user) ? "/onboarding" : "/inventories");
      return;
    }

    try {
      await pruneStaleRecentAccounts();
    } catch (_error) {
      // Keep login available even if stale account pruning fails.
    }

    app.innerHTML = renderLogin();
    wireAuthEvents(render);
    return;
  }

  if (!user) {
    stopInventorySync();
    stopUserPrefsSync();
    if (route !== "/login") {
      setRoute("/login");
    }
    return;
  }

  if (isAuthSessionLocked() && route !== "/login" && route !== "/about-welcome" && route !== "/terms-welcome") {
    stopInventorySync();
    setRoute("/login");
    return;
  }

  syncUserPrefsFromAuth(user);
  await ensureUserPrefsSync(user.uid);

  if (route === "/onboarding") {
    if (!isOnboardingRequired(user)) {
      setRoute("/inventories");
      return;
    }

    app.innerHTML = renderOnboardingProfile(user);
    wireOnboardingEvents(render);
    return;
  }

  if (isOnboardingRequired(user)) {
    setRoute("/onboarding");
    return;
  }

  if (route === "/profile-settings") {
    app.innerHTML = renderProfileSettings(user);
    wireProfileEvents(render);
    return;
  }

  if (route === "/profile") {
    if (!getCurrentInventoryId()) {
      setRoute("/profile-settings");
      return;
    }
    app.innerHTML = renderProfile(user);
    wireProfileEvents(render);
    wireSharedEvents(render);
    return;
  }

  if (route === "/inventories") {
    stopInventorySync();
    try {
      userInventories = await getUserInventories(user.uid);
      app.innerHTML = renderMyInventories(userInventories);
      wireInventorySelectionEvents(render);
    } catch (error) {
      console.error("Error loading inventories:", error);
      app.innerHTML = `<div style="padding:20px;"><p>Error loading inventories: ${error.message}</p></div>`;
    }
    return;
  }

  const currentInventoryId = getCurrentInventoryId();
  if (!currentInventoryId) {
    stopInventorySync();
    setRoute("/inventories");
    return;
  }

  ensureInventorySync(currentInventoryId);

  if (awaitingInitialInventorySnapshot && shouldGuardInventoryRoute(route)) {
    app.innerHTML = `
      <div class="welcome">
        <section class="welcome-card">
          <h1>Loading inventory...</h1>
          <p class="muted">Syncing the latest data before enabling edits.</p>
        </section>
      </div>
    `;
    return;
  }

  if (route === "/collaboration") {
    try {
      collaborators = await getCollaborators(currentInventoryId);
      inviteCodes = await getInviteCodes(currentInventoryId);
      isOwner = Boolean(collaborators && collaborators[user.uid] && collaborators[user.uid].role === "admin");

      app.innerHTML = renderSettings();
      refreshSyncIndicator();
      const collabHtml = renderCollaborationSettings(collaborators, inviteCodes, isOwner, user.uid);
      const collabSection = document.querySelector("section:last-child");
      if (collabSection) {
        collabSection.insertAdjacentHTML("beforebegin", collabHtml);
      }
      wireCollaborationEvents(render);
      wireSharedEvents(render);
    } catch (error) {
      console.error("Error loading collaboration:", error);
    }
    return;
  }

  if (route === "/activity") {
    try {
      activityLogs = await getInventoryActivityLogs(currentInventoryId, 120);
      app.innerHTML = renderActivityLog(activityLogs);
      wireSharedEvents(render);
    } catch (error) {
      console.error("Error loading activity log:", error);
      app.innerHTML = `<div style="padding:20px;"><p>Error loading change history: ${error.message}</p></div>`;
    }
    return;
  }

  if (route === "/dashboard") app.innerHTML = renderDashboard();
  else if (route === "/inventory") app.innerHTML = renderInventory();
  else if (route === "/shopping") app.innerHTML = renderShopping();
  else if (route === "/settings") {
    app.innerHTML = renderSettings();
    refreshSyncIndicator();
    wireCollaborationEvents(render);
  } else {
    setRoute("/dashboard");
    return;
  }

  wireSharedEvents(render);
}

async function initApp() {
  try {
    firebaseAvailable = checkFirebaseAvailable();

    if (firebaseAvailable) {
      try {
        await initializeAuth();

        onAuthStateChanged(() => {
          const authUser = getCurrentUser();
          const nextAuthUid = String((authUser && authUser.uid) || "");
          if (nextAuthUid !== lastAuthUid) {
            stopUserPrefsSync();
            lastAuthUid = nextAuthUid;
          }
          if (!authInitialized) {
            authInitialized = true;
          }
          render();
        });

        await waitForAuthReady();
        authStateReady = true;
        enforceFreshSessionLoginGate();
      } catch (error) {
        console.warn("Firebase initialization failed, using local-only mode:", error);
        firebaseAvailable = false;
      }
    } else {
      console.log("Firebase SDK not loaded. Using local-only mode.");
    }

    window.addEventListener("hashchange", render);
    window.addEventListener("norder:state-saved", () => {
      persistCurrentUserPrefs(getCurrentUser());
      pushLocalInventoryToCloud();
      pushLocalUserPrefsToCloud();
    });

    const resumeSync = () => {
      if (shouldSuppressResumeSync()) return;
      showResumeSyncBanner("Syncing latest changes...");
      const user = getCurrentUser();
      if (!user) {
        hideResumeSyncBanner();
        render();
        return;
      }

      // Browsers may aggressively pause background tabs; refresh auth-bound sync on resume.
      ensureUserPrefsSync(user.uid).finally(() => {
        pushLocalUserPrefsToCloud();
        pushLocalInventoryToCloud();
        render();
        hideResumeSyncBanner();
      });
    };

    window.addEventListener("pageshow", resumeSync);
    window.addEventListener("focus", resumeSync);
    window.addEventListener("online", resumeSync);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        resumeSync();
      }
    });

    render();
  } catch (error) {
    console.error("Failed to initialize app:", error);
    const app = document.getElementById("app");
    app.innerHTML = `
      <div class="welcome">
        <section class="welcome-card">
          <h1>nORDER</h1>
          <p class="muted">Local Mode</p>
          <p class="muted">Firebase is not configured, but you can use the app locally.</p>
          <button onclick="window.location.hash = '#/'" class="primary">Start</button>
        </section>
      </div>
    `;
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
