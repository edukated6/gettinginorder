import { getCurrentUser, signUp, signIn, signOut } from "./auth.js";
import { setRoute } from "./router.js";
import { getState, setCurrentInventory, getCurrentInventoryId, setState, saveState } from "./state.js";
import {
  createSharedInventory,
  joinInventoryWithCode,
  getCollaborators,
  getInviteCodes,
  generateNewInviteCode,
  removeCollaborator,
  deleteInviteCode,
} from "./collaboration.js";

// Auth Events
export function wireAuthEvents(onRender) {
  // Login
  const loginBtn = document.getElementById("login-btn");
  if (loginBtn) loginBtn.addEventListener("click", async () => {
    const emailEl = document.getElementById("login-email");
    const passwordEl = document.getElementById("login-password");
    const rememberEl = document.getElementById("login-remember");
    const email = emailEl ? emailEl.value : "";
    const password = passwordEl ? passwordEl.value : "";
    const rememberMe = rememberEl ? Boolean(rememberEl.checked) : true;
    const errorDiv = document.getElementById("login-error");

    if (!email || !password) {
      if (errorDiv) errorDiv.innerText = "Missing email or password";
      return;
    }

    try {
      if (errorDiv) errorDiv.innerText = "Signing in...";
      await signIn(email, password, rememberMe);
      setRoute("/inventories");
    } catch (error) {
      if (errorDiv) errorDiv.innerText = error.message;
    }
  });

  // Signup
  const signupBtn = document.getElementById("signup-btn");
  if (signupBtn) signupBtn.addEventListener("click", async () => {
    const nameEl = document.getElementById("signup-name");
    const emailEl = document.getElementById("signup-email");
    const passwordEl = document.getElementById("signup-password");
    const confirmEl = document.getElementById("signup-password-confirm");
    const name = nameEl ? nameEl.value : "";
    const email = emailEl ? emailEl.value : "";
    const password = passwordEl ? passwordEl.value : "";
    const confirm = confirmEl ? confirmEl.value : "";
    const errorDiv = document.getElementById("signup-error");

    if (!name || !email || !password || !confirm) {
      if (errorDiv) errorDiv.innerText = "All fields are required";
      return;
    }

    if (password !== confirm) {
      if (errorDiv) errorDiv.innerText = "Passwords don't match";
      return;
    }

    if (password.length < 6) {
      if (errorDiv) errorDiv.innerText = "Password must be at least 6 characters";
      return;
    }

    try {
      if (errorDiv) errorDiv.innerText = "Creating account...";
      await signUp(email, password, name);
      setRoute("/inventories");
    } catch (error) {
      if (errorDiv) errorDiv.innerText = error.message;
    }
  });

  // Toggle between login and signup forms
  const toggleSignupBtn = document.getElementById("toggle-signup-btn");
  if (toggleSignupBtn) toggleSignupBtn.addEventListener("click", (e) => {
    e.preventDefault();
    document.getElementById("login-form").style.display = "none";
    document.getElementById("signup-form").style.display = "block";
  });

  const toggleLoginBtn = document.getElementById("toggle-login-btn");
  if (toggleLoginBtn) toggleLoginBtn.addEventListener("click", (e) => {
    e.preventDefault();
    document.getElementById("signup-form").style.display = "none";
    document.getElementById("login-form").style.display = "block";
  });
}

// Inventory Selection Events
export function wireInventorySelectionEvents(onRender) {
  const createBtn = document.getElementById("create-new-inventory");
  if (createBtn) createBtn.addEventListener("click", async () => {
    const name = prompt("Inventory name:", "My Inventory");
    if (!name) return;

    try {
      const user = getCurrentUser();
      const state = getState();
      const inventoryData = {
        prefs: state.prefs,
        categories: state.categories,
        items: state.items,
      };

      const result = await createSharedInventory(user.uid, name, inventoryData);
      setCurrentInventory(result.inventoryId);

      // Show invite code
      alert(`Inventory created!\n\nInvite code: ${result.inviteCode}\n\nShare this code with others to collaborate.`);
      setRoute("/dashboard");
    } catch (error) {
      const msg = String(error && error.message ? error.message : error);
      const isPermission = /permission|denied/i.test(msg);
      if (isPermission) {
        alert(
          "Firebase denied access while creating inventory.\n\nOpen Realtime Database Rules and use the rules in FIREBASE_SETUP.md (Step 3), then publish and try again."
        );
      } else {
        alert("Error: " + msg);
      }
    }
  });

  // Join inventory with code
  const joinBtn = document.getElementById("join-inventory-btn");
  if (joinBtn) joinBtn.addEventListener("click", async () => {
    const codeInput = document.getElementById("join-code-input");
    const codeValue = codeInput ? codeInput.value : "";
    const code = codeValue ? codeValue.toUpperCase() : "";
    const errorDiv = document.getElementById("join-error");

    if (!code) {
      if (errorDiv) errorDiv.innerText = "Please enter a code";
      return;
    }

    try {
      if (errorDiv) errorDiv.innerText = "";
      const user = getCurrentUser();
      // Note: In a real app, you'd need to look up the inventory ID from the code
      // This is simplified - you'd need to store a mapping in Firebase
      alert("Please ask the inventory owner for the full inventory ID to join.");
    } catch (error) {
      if (errorDiv) errorDiv.innerText = error.message;
    }
  });

  // Select inventory
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action='select-inventory']");
    if (!btn) return;

    const inventoryId = btn.getAttribute("data-id");
    setCurrentInventory(inventoryId);
    setRoute("/dashboard");
  });

  // Logout
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) logoutBtn.addEventListener("click", async () => {
    try {
      await signOut();
      setCurrentInventory(null);
      setRoute("/login");
    } catch (error) {
      alert("Logout failed: " + error.message);
    }
  });
}

// Collaboration Events
export function wireCollaborationEvents(onRender) {
  const viewCollabBtn = document.getElementById("view-collaboration-settings");
  if (viewCollabBtn) viewCollabBtn.addEventListener("click", () => {
    setRoute("/collaboration");
  });

  const switchBtn = document.getElementById("switch-inventory");
  if (switchBtn) switchBtn.addEventListener("click", () => {
    setRoute("/inventories");
  });

  // Collaboration settings page
  document.addEventListener("click", async (e) => {
    const removeBtn = e.target.closest("button[data-action='remove-collaborator']");
    if (removeBtn) {
      const collaboratorId = removeBtn.getAttribute("data-id");
      if (confirm("Remove this collaborator?")) {
        try {
          const user = getCurrentUser();
          const inventoryId = getCurrentInventoryId();
          await removeCollaborator(inventoryId, user.uid, collaboratorId);
          onRender();
        } catch (error) {
          alert("Error: " + error.message);
        }
      }
      return;
    }

    const deleteCodeBtn = e.target.closest("button[data-action='delete-invite-code']");
    if (deleteCodeBtn) {
      const code = deleteCodeBtn.getAttribute("data-code");
      if (confirm("Delete this invite code?")) {
        try {
          const user = getCurrentUser();
          const inventoryId = getCurrentInventoryId();
          await deleteInviteCode(inventoryId, user.uid, code);
          onRender();
        } catch (error) {
          alert("Error: " + error.message);
        }
      }
      return;
    }
  });

  const generateCodeBtn = document.getElementById("generate-new-code");
  if (generateCodeBtn) generateCodeBtn.addEventListener("click", async () => {
    try {
      const user = getCurrentUser();
      const inventoryId = getCurrentInventoryId();
      const newCode = await generateNewInviteCode(inventoryId, user.uid);
      alert(`New invite code: ${newCode}`);
      onRender();
    } catch (error) {
      alert("Error: " + error.message);
    }
  });
}
