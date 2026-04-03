import { initializeAuth, getCurrentUser, onAuthStateChanged, waitForAuthReady } from "./js/auth.js";
import { wireAuthEvents, wireInventorySelectionEvents, wireCollaborationEvents } from "./js/auth-events.js";
import { getRoute, setRoute } from "./js/router.js";
import { getState, setState, saveState, resetState, applyTheme, getCurrentInventoryId, setCurrentInventory, defaultHomeName } from "./js/state.js";
import { wireWelcomeEvents, wireSharedEvents } from "./js/events.js";
import {
  renderWelcome,
  renderDashboard,
  renderInventory,
  renderShopping,
  renderSettings,
  renderLogin,
  renderMyInventories,
  renderCollaborationSettings,
} from "./js/views.js";
import { getHashParams } from "./js/router.js";
import { getUserInventories, getCollaborators, getInviteCodes } from "./js/collaboration.js";

let authInitialized = false;
let firebaseAvailable = false;
let userInventories = {};
let collaborators = {};
let inviteCodes = {};
let isOwner = false;
let authStateReady = false;

// Check if Firebase is available
function checkFirebaseAvailable() {
  return typeof firebase !== "undefined" && firebase.auth && firebase.database;
}

// Main render function
async function render() {
  applyTheme();
  const app = document.getElementById("app");
  const route = getRoute();
  const user = getCurrentUser();

  // If Firebase isn't available, show local-only mode
  if (!firebaseAvailable) {
    // Use local-only mode
    if (route === "/") {
      app.innerHTML = renderWelcome();
      wireWelcomeEvents(render);
      return;
    }

    if (route === "/dashboard") app.innerHTML = renderDashboard();
    else if (route === "/inventory") app.innerHTML = renderInventory();
    else if (route === "/shopping") app.innerHTML = renderShopping();
    else if (route === "/settings") {
      app.innerHTML = renderSettings();
      wireCollaborationEvents(render);
    } else {
      setRoute("/dashboard");
      return;
    }

    wireSharedEvents(render);
    return;
  }

  // Firebase-enabled mode (authentication)

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

  // Auth routes (before login)
  if (route === "/login") {
    if (user) {
      setRoute("/inventories");
      return;
    }
    app.innerHTML = renderLogin();
    wireAuthEvents(render);
    return;
  }

  // If not authenticated, show login
  if (!user) {
    if (route !== "/login") {
      setRoute("/login");
    }
    return;
  }

  // Authenticated routes
  if (route === "/inventories") {
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

  // If user is authenticated but no inventory selected, show inventories list
  const currentInventoryId = getCurrentInventoryId();
  if (!currentInventoryId) {
    setRoute("/inventories");
    return;
  }

  // Collaboration settings
  if (route === "/collaboration") {
    try {
      collaborators = await getCollaborators(currentInventoryId);
      inviteCodes = await getInviteCodes(currentInventoryId);
      isOwner = Object.values(collaborators).some((c) => c.role === "admin" && c.name === user.displayName);

      app.innerHTML = renderSettings();
      const collabHtml = renderCollaborationSettings(collaborators, inviteCodes, isOwner);
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

  // App routes (dashboard, inventory, shopping, settings)
  if (route === "/dashboard") app.innerHTML = renderDashboard();
  else if (route === "/inventory") app.innerHTML = renderInventory();
  else if (route === "/shopping") app.innerHTML = renderShopping();
  else if (route === "/settings") {
    app.innerHTML = renderSettings();
    wireCollaborationEvents(render);
  } else {
    setRoute("/dashboard");
    return;
  }

  wireSharedEvents(render);
}

// Initialize app
async function initApp() {
  try {
    // Check if Firebase is available
    firebaseAvailable = checkFirebaseAvailable();

    if (firebaseAvailable) {
      try {
        // Initialize Firebase auth
        await initializeAuth();

        // Listen for auth state changes
        onAuthStateChanged((user) => {
          if (!authInitialized) {
            authInitialized = true;
          }
          render();
        });

        await waitForAuthReady();
        authStateReady = true;
      } catch (error) {
        console.warn("Firebase initialization failed, using local-only mode:", error);
        firebaseAvailable = false;
        render();
      }
    } else {
      // Firebase not available - use local mode
      console.log("Firebase SDK not loaded. Using local-only mode.");
      render();
    }

    // Handle hash navigation
    window.addEventListener("hashchange", render);

    // Always perform one initial paint after listeners are wired.
    // This avoids a blank screen if hash changed before listener attachment.
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

// Start app when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
