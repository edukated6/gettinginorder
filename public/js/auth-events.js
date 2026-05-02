/*
  auth-events.js
  Purpose:
  - Attach DOM event handlers for login/signup/profile/inventory selection screens.
  - Translate button clicks into auth and collaboration actions.
*/

import {
  changeUserPassword,
  getCurrentUser,
  isAuthSessionLocked,
  isOnboardingRequired,
  lockAuthSession,
  removeRecentAccountByEmail,
  resetPassword,
  signIn,
  signOut,
  signUp,
  unlockAuthSession,
  updateUserProfile,
} from "./auth.js";
import { setRoute } from "./router.js";
import {
  defaultHomeName,
  applyTheme,
  getDefaultCategories,
  getState,
  setCurrentInventory,
  getCurrentInventoryId,
  setState,
  saveState,
  saveStateLocalOnly,
} from "./state.js";
import {
  createSharedInventory,
  deleteInventory,
  logInventoryChange,
  findInventoryIdByInviteCode,
  joinInventoryWithCode,
  updateUserAccountPrefs,
  getCollaborators,
  getInviteCodes,
  generateNewInviteCode,
  removeCollaborator,
  deleteInviteCode,
} from "./collaboration.js";

let collaborationOnRender = null;
let authOnRender = null;
let collaborationClickHandlerAttached = false;
let inventorySelectionClickHandlerAttached = false;
let inventorySelectionOnRender = null;
let quickLoginClickHandlerAttached = false;
let passwordToggleClickHandlerAttached = false;
const USER_PREFS_BY_UID_KEY = "norder_user_prefs_by_uid";
const SUPPRESS_RESUME_SYNC_UNTIL_KEY = "__norderSuppressResumeSyncUntil";
const IMAGE_PICKER_SUPPRESS_MS = 120000;
const MAX_PROFILE_IMAGE_DIMENSION = 640;
const TARGET_PROFILE_IMAGE_DATA_URL_LENGTH = 180000;
const pendingPhotoDataUrlByInputId = {};

function showToast(message, type = "success") {
  const text = String(message || "").trim();
  if (!text) return;

  const id = "norder-toast-root";
  let root = document.getElementById(id);
  if (!root) {
    root = document.createElement("div");
    root.id = id;
    root.style.position = "fixed";
    root.style.left = "50%";
    root.style.bottom = "22px";
    root.style.transform = "translateX(-50%)";
    root.style.zIndex = "9999";
    root.style.display = "flex";
    root.style.flexDirection = "column";
    root.style.gap = "8px";
    root.style.alignItems = "center";
    root.style.pointerEvents = "none";
    document.body.appendChild(root);
  }

  const toast = document.createElement("div");
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  toast.textContent = text;
  toast.style.padding = "10px 14px";
  toast.style.borderRadius = "10px";
  toast.style.border = "1px solid rgba(255,255,255,0.15)";
  toast.style.background = type === "error" ? "var(--danger)" : "var(--primary)";
  toast.style.color = "var(--on-primary, #ffffff)";
  toast.style.fontWeight = "600";
  toast.style.boxShadow = "0 8px 24px rgba(0,0,0,0.25)";
  toast.style.pointerEvents = "none";
  toast.style.opacity = "0";
  toast.style.transition = "opacity 160ms ease";

  root.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = "1";
  });

  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
      if (root && !root.childNodes.length && root.parentNode) {
        root.parentNode.removeChild(root);
      }
    }, 180);
  }, 2400);
}

function resetLocalInventoryView(homeNameFallback) {
  const state = getState();
  const nextHomeName = String(homeNameFallback || state.prefs.home_name || defaultHomeName).trim() || defaultHomeName;
  setState({
    ...state,
    prefs: {
      ...state.prefs,
      home_name: nextHomeName,
    },
    categories: getDefaultCategories(),
    items: [],
  });
}

function getCachedUserPrefs(uid) {
  const key = String(uid || "").trim();
  if (!key) return null;

  try {
    const raw = localStorage.getItem(USER_PREFS_BY_UID_KEY);
    const map = raw ? JSON.parse(raw) : {};
    const entry = map && typeof map === "object" ? map[key] : null;
    return entry && typeof entry === "object" ? entry : null;
  } catch (_error) {
    return null;
  }
}

function setCachedUserPrefs(uid, prefs) {
  const key = String(uid || "").trim();
  if (!key || !prefs || typeof prefs !== "object") return;

  try {
    const raw = localStorage.getItem(USER_PREFS_BY_UID_KEY);
    const map = raw ? JSON.parse(raw) : {};
    const next = map && typeof map === "object" ? map : {};
    next[key] = { ...(next[key] || {}), ...prefs };
    localStorage.setItem(USER_PREFS_BY_UID_KEY, JSON.stringify(next));
  } catch (_error) {
    // Ignore local cache write failures.
  }
}

function getPendingPhotoDataUrl(inputId) {
  return String(pendingPhotoDataUrlByInputId[inputId] || "").trim();
}

function setPendingPhotoDataUrl(inputId, dataUrl) {
  pendingPhotoDataUrlByInputId[inputId] = String(dataUrl || "").trim();
}

function suppressResumeSyncForImagePicker() {
  if (typeof window === "undefined") return;
  window[SUPPRESS_RESUME_SYNC_UNTIL_KEY] = Date.now() + IMAGE_PICKER_SUPPRESS_MS;
}

function clearResumeSyncSuppression() {
  if (typeof window === "undefined") return;
  window[SUPPRESS_RESUME_SYNC_UNTIL_KEY] = 0;
}

async function readSelectedOrPendingPhotoDataUrl(photoInput, inputId) {
  const photoFile = photoInput && photoInput.files && photoInput.files[0] ? photoInput.files[0] : null;
  if (photoFile) {
    return readImageFileAsDataUrl(photoFile);
  }
  return getPendingPhotoDataUrl(inputId);
}

function loadImageElement(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not process selected image."));
    img.src = dataUrl;
  });
}

async function optimizeProfileImageDataUrl(dataUrl) {
  const raw = String(dataUrl || "");
  if (!raw.startsWith("data:image/")) return raw;

  const image = await loadImageElement(raw);
  const sourceWidth = Number(image.naturalWidth || image.width || 0);
  const sourceHeight = Number(image.naturalHeight || image.height || 0);
  if (!sourceWidth || !sourceHeight) return raw;

  const scale = Math.min(1, MAX_PROFILE_IMAGE_DIMENSION / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return raw;

  ctx.drawImage(image, 0, 0, width, height);
  const qualities = [0.82, 0.74, 0.66, 0.58, 0.5, 0.42];
  let best = raw;

  qualities.forEach((quality) => {
    const candidate = canvas.toDataURL("image/jpeg", quality);
    if (!best || candidate.length < best.length) {
      best = candidate;
    }
  });

  if (best.length <= TARGET_PROFILE_IMAGE_DATA_URL_LENGTH) return best;
  return best.length < raw.length ? best : raw;
}

function readImageFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const rawDataUrl = String(reader.result || "");
      try {
        const optimized = await optimizeProfileImageDataUrl(rawDataUrl);
        resolve(String(optimized || rawDataUrl));
      } catch (_error) {
        resolve(rawDataUrl);
      }
    };
    reader.onerror = () => reject(new Error("Could not read selected image file."));
    reader.readAsDataURL(file);
  });
}

function renderAvatarPreview(container, photoDataUrl, nameValue) {
  if (!container) return;

  const fallbackName = String(nameValue || "").trim();
  const fallbackInitial = (fallbackName.charAt(0) || "P").toUpperCase();
  container.innerHTML = "";

  if (photoDataUrl) {
    const img = document.createElement("img");
    img.className = "avatar";
    img.src = photoDataUrl;
    img.alt = "Selected profile picture preview";
    container.appendChild(img);
    return;
  }

  const fallback = document.createElement("span");
  fallback.className = "avatar avatar-fallback";
  fallback.setAttribute("aria-hidden", "true");
  fallback.textContent = fallbackInitial;
  container.appendChild(fallback);
}

function wireImagePreview(inputId, previewId, nameInputId) {
  const photoInput = document.getElementById(inputId);
  const previewContainer = document.getElementById(previewId);
  const nameInput = nameInputId ? document.getElementById(nameInputId) : null;

  if (!photoInput || !previewContainer) return;

  const refresh = () => {
    const photoFile = photoInput.files && photoInput.files[0] ? photoInput.files[0] : null;
    const currentName = String((nameInput && nameInput.value) || "").trim();

    if (!photoFile) {
      setPendingPhotoDataUrl(inputId, "");
      renderAvatarPreview(previewContainer, "", currentName);
      clearResumeSyncSuppression();
      return;
    }

    if (!String(photoFile.type || "").toLowerCase().startsWith("image/")) {
      setPendingPhotoDataUrl(inputId, "");
      renderAvatarPreview(previewContainer, "", currentName);
      clearResumeSyncSuppression();
      return;
    }

    readImageFileAsDataUrl(photoFile)
      .then((photoDataUrl) => {
        setPendingPhotoDataUrl(inputId, photoDataUrl);
        renderAvatarPreview(previewContainer, photoDataUrl, currentName);
        clearResumeSyncSuppression();
      })
      .catch(() => {
        setPendingPhotoDataUrl(inputId, "");
        renderAvatarPreview(previewContainer, "", currentName);
        clearResumeSyncSuppression();
      });
  };

  photoInput.addEventListener("click", suppressResumeSyncForImagePicker);
  photoInput.addEventListener("touchstart", suppressResumeSyncForImagePicker, { passive: true });
  photoInput.addEventListener("pointerdown", suppressResumeSyncForImagePicker);
  photoInput.addEventListener("change", refresh);

  const existingPending = getPendingPhotoDataUrl(inputId);
  if (existingPending) {
    renderAvatarPreview(previewContainer, existingPending, String((nameInput && nameInput.value) || "").trim());
  }

  if (nameInput) {
    nameInput.addEventListener("input", () => {
      const hasFile = Boolean(photoInput.files && photoInput.files[0]);
      if (!hasFile) {
        const pending = getPendingPhotoDataUrl(inputId);
        renderAvatarPreview(previewContainer, pending, String(nameInput.value || "").trim());
      }
    });
  }
}

function getFriendlySignInError(error) {
  const code = String((error && error.code) || "").toLowerCase();
  const rawMessage = String((error && error.message) || error || "").toLowerCase();

  if (code.includes("user-not-found") || rawMessage.includes("user-not-found")) {
    return "Sign-in error: no account was found for this email. Create an account first, or reset your password if you already signed up before.";
  }

  if (
    code.includes("wrong-password") ||
    code.includes("invalid-credential") ||
    rawMessage.includes("wrong-password") ||
    rawMessage.includes("invalid login credentials")
  ) {
    return "Sign-in error: email or password is incorrect. Check your password, or reset/change your password if needed.";
  }

  if (code.includes("too-many-requests") || rawMessage.includes("too-many-requests")) {
    return "Sign-in error: too many attempts. Please wait a moment, then try again or reset your password.";
  }

  return "Sign-in error: we could not sign you in. If you do not have an account, create one. If you forgot your password, reset it and try again.";
}

function getFriendlyPasswordPolicyError(error) {
  const code = String((error && error.code) || "").toLowerCase();
  const rawMessage = String((error && error.message) || error || "");
  const normalized = rawMessage.toLowerCase();

  if (
    code.includes("password-does-not-meet-requirements") ||
    normalized.includes("missing password requirements") ||
    normalized.includes("password does not meet requirements")
  ) {
    const requirements = [];
    if (normalized.includes("lower case")) requirements.push("at least one lowercase letter");
    if (normalized.includes("upper case")) requirements.push("at least one uppercase letter");
    if (normalized.includes("non-alphanumeric")) requirements.push("at least one symbol (like !, @, #)");

    const requirementText = requirements.length
      ? requirements.join(", ")
      : "uppercase, lowercase, and a symbol";

    return `Password requirements not met: use ${requirementText}.`;
  }

  return String((error && error.message) || error || "Password update failed.");
}

async function syncLocalProfile(user, localPhotoOverride) {
  if (!user) return;
  const state = getState();
  const sameUser = state.prefs.profile_uid === user.uid;
  const cachedPrefs = getCachedUserPrefs(user.uid);
  const localPhoto = String(localPhotoOverride || "").trim();
  const shouldPersistAccountPrefsNow = Boolean(localPhoto);
  const remotePhoto = String(user.photoURL || "").trim();
  const cachedPhoto =
    cachedPrefs && typeof cachedPrefs.profile_picture === "string"
      ? String(cachedPrefs.profile_picture || "").trim()
      : "";
  const cachedTheme =
    cachedPrefs && typeof cachedPrefs.theme === "string" && cachedPrefs.theme ? cachedPrefs.theme : null;
  const cachedDark =
    cachedPrefs && typeof cachedPrefs.dark_mode === "boolean" ? cachedPrefs.dark_mode : null;
  const existingPhoto =
    sameUser ? String(state.prefs.profile_picture || "").trim() : "";
  const profilePicture = localPhoto || existingPhoto || cachedPhoto || remotePhoto;
  const nextTheme = cachedTheme || (sameUser ? state.prefs.theme : "teal");
  const nextDark = cachedDark === null ? (sameUser ? Boolean(state.prefs.dark_mode) : true) : cachedDark;

  const next = {
    ...state,
    prefs: {
      ...state.prefs,
      profile_uid: user.uid || "",
      profile_name: user.displayName || state.prefs.profile_name || "",
      profile_picture: profilePicture,
      theme: nextTheme,
      dark_mode: nextDark,
      onboarding_complete: true,
    },
  };

  if (shouldPersistAccountPrefsNow) {
    setCachedUserPrefs(user.uid, {
      theme: nextTheme,
      dark_mode: nextDark,
      profile_picture: profilePicture,
    });
    const didPersist = await updateUserAccountPrefs(user.uid, {
      theme: nextTheme,
      dark_mode: nextDark,
      profile_picture: profilePicture,
    });
    if (!didPersist) {
      throw new Error("Could not save profile picture to your account preferences.");
    }
  }

  // Apply local state after persistence to prevent stale listener snapshots from winning races.
  setState(next);
  saveState();
}

function trackProfileLog(action, summary, details) {
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

async function handleInventorySelectionDocumentClick(e) {
  const openBtn = e.target.closest("button[data-action='select-inventory']");
  if (openBtn) {
    const inventoryId = String(openBtn.getAttribute("data-id") || "").trim();
    if (!inventoryId) return;

    setCurrentInventory(inventoryId);
    resetLocalInventoryView();
    saveStateLocalOnly();
    setRoute("/dashboard");
    if (typeof inventorySelectionOnRender === "function") {
      inventorySelectionOnRender();
    }
    return;
  }

  const deleteBtn = e.target.closest("button[data-action='delete-inventory']");
  if (!deleteBtn) return;

  const inventoryId = String(deleteBtn.getAttribute("data-id") || "").trim();
  const inventoryName = String(deleteBtn.getAttribute("data-name") || "inventory").trim() || "inventory";
  const role = String(deleteBtn.getAttribute("data-role") || "member").trim().toLowerCase();
  const isOwner = role === "admin";

  const confirmMsg = isOwner
    ? `Delete "${inventoryName}" for all collaborators? This cannot be undone.`
    : `Leave "${inventoryName}"? You can join again with an invite code.`;
  if (!confirm(confirmMsg)) return;

  try {
    const user = getCurrentUser();
    if (!user || !user.uid) {
      throw new Error("You must be signed in to delete inventories.");
    }

    await deleteInventory(user.uid, inventoryId);

    if (getCurrentInventoryId() === inventoryId) {
      setCurrentInventory(null);
      resetLocalInventoryView(defaultHomeName);
      saveState();
    }

    if (typeof inventorySelectionOnRender === "function") {
      inventorySelectionOnRender();
    }

    showToast(isOwner ? "Inventory deleted." : "You left the inventory.");
  } catch (error) {
    const msg = String(error && error.message ? error.message : error);
    alert("Error deleting inventory: " + msg);
  }
}

async function handleCollaborationDocumentClick(e) {
  const removeBtn = e.target.closest("button[data-action='remove-collaborator']");
  if (removeBtn) {
    const collaboratorId = removeBtn.getAttribute("data-id");
    const user = getCurrentUser();
    if (user && collaboratorId === user.uid) {
      alert("Inventory creators cannot remove themselves as collaborators.");
      return;
    }
    if (confirm("Remove this collaborator?")) {
      try {
        const inventoryId = getCurrentInventoryId();
        await removeCollaborator(inventoryId, user.uid, collaboratorId);
        if (collaborationOnRender) collaborationOnRender();
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
        if (collaborationOnRender) collaborationOnRender();
      } catch (error) {
        alert("Error: " + error.message);
      }
    }
    return;
  }
}

function handleQuickLoginClick(e) {
  const removeBtn = e.target.closest("button[data-action='quick-login-remove']");
  if (removeBtn) {
    const email = String(removeBtn.getAttribute("data-email") || "").trim();
    if (!email) return;

    removeRecentAccountByEmail(email);

    const emailInput = document.getElementById("login-email");
    if (emailInput && String(emailInput.value || "").trim().toLowerCase() === email.toLowerCase()) {
      emailInput.value = "";
    }

    if (typeof authOnRender === "function") {
      authOnRender();
      showToast(`${email} removed from Quick Access on this device.`, "success");
      return;
    }

    const loginError = document.getElementById("login-error");
    if (loginError) {
      loginError.style.color = "var(--text-soft)";
      loginError.innerText = `${email} removed from Quick Access on this device.`;
    }
    return;
  }

  const profileBtn = e.target.closest("button[data-action='quick-login-profile']");
  if (!profileBtn) return;

  const email = profileBtn.getAttribute("data-email") || "";
  const emailInput = document.getElementById("login-email");
  const passwordInput = document.getElementById("login-password");
  const loginError = document.getElementById("login-error");

  if (emailInput) emailInput.value = email;

  const user = getCurrentUser();
  if (user && isAuthSessionLocked() && String(user.email || "").toLowerCase() === email.toLowerCase()) {
    unlockAuthSession();
    setRoute(isOnboardingRequired(user) ? "/onboarding" : "/inventories");
    return;
  }

  if (passwordInput) {
    passwordInput.focus();
    passwordInput.select();
  }
  if (loginError) {
    loginError.style.color = "var(--text-soft)";
    loginError.innerText = `Profile selected for ${email}. Enter your password to access your inventory spaces, or use Forgot Password.`;
  }
}

function handlePasswordToggleClick(e) {
  const toggleBtn = e.target.closest("button[data-action='toggle-password-visibility']");
  if (!toggleBtn) return;

  const targetId = toggleBtn.getAttribute("data-target");
  if (!targetId) return;

  const input = document.getElementById(targetId);
  if (!input || input.tagName !== "INPUT") return;

  const currentlyHidden = input.getAttribute("type") === "password";
  input.setAttribute("type", currentlyHidden ? "text" : "password");
  toggleBtn.innerText = currentlyHidden ? "Hide" : "Show";
}

// Auth Events
export function wireAuthEvents(onRender) {
  authOnRender = onRender;

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
      const user = await signIn(email, password, rememberMe);
      await syncLocalProfile(user);
      setRoute(isOnboardingRequired(user) ? "/onboarding" : "/inventories");
    } catch (error) {
      const msg = String(error && error.message ? error.message : error);
      const code = String((error && error.code) || "").toLowerCase();
      if (/permission|denied/i.test(msg)) {
        if (errorDiv) {
          errorDiv.innerText =
            "Invite lookup is blocked by Firebase rules. Ask the owner to update Realtime Database rules in FIREBASE_SETUP.md Step 3.";
        }
      } else if (errorDiv) {
        if (code.includes("user-not-found") || /user-not-found/i.test(msg)) {
          removeRecentAccountByEmail(email);
        }
        errorDiv.innerText = getFriendlySignInError(error);
      }
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
      const user = await signUp(email, password, name);
      await syncLocalProfile(user);
      setRoute("/onboarding");
    } catch (error) {
      if (errorDiv) errorDiv.innerText = getFriendlyPasswordPolicyError(error);
    }
  });

  // Toggle between login and signup forms
  const resetPasswordBtn = document.getElementById("login-reset-password");
  if (resetPasswordBtn) resetPasswordBtn.addEventListener("click", async () => {
    const emailEl = document.getElementById("login-email");
    const errorDiv = document.getElementById("login-error");
    const email = String((emailEl && emailEl.value) || "").trim();

    if (!email) {
      if (errorDiv) {
        errorDiv.style.color = "var(--danger)";
        errorDiv.innerText = "Enter your email first, then tap Forgot Password.";
      }
      return;
    }

    try {
      if (errorDiv) {
        errorDiv.style.color = "var(--text-soft)";
        errorDiv.innerText = "Sending reset email...";
      }
      await resetPassword(email);
      if (errorDiv) {
        errorDiv.style.color = "var(--success)";
        errorDiv.innerText = "Password reset email sent. Check your inbox.";
      }
    } catch (_error) {
      if (errorDiv) {
        errorDiv.style.color = "var(--danger)";
        errorDiv.innerText = "Could not send reset email. Verify the email and try again.";
      }
    }
  });

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

  if (!quickLoginClickHandlerAttached) {
    quickLoginClickHandlerAttached = true;
    document.addEventListener("click", handleQuickLoginClick);
  }

  if (!passwordToggleClickHandlerAttached) {
    passwordToggleClickHandlerAttached = true;
    document.addEventListener("click", handlePasswordToggleClick);
  }
}

export function wireOnboardingEvents(onRender) {
  const saveBtn = document.getElementById("complete-onboarding");
  if (!saveBtn) return;

  wireImagePreview("onboarding-photo-file", "onboarding-photo-preview", "onboarding-name");

  saveBtn.addEventListener("click", async () => {
    const nameInput = document.getElementById("onboarding-name");
    const photoInput = document.getElementById("onboarding-photo-file");
    const errorDiv = document.getElementById("onboarding-error");

    const name = String((nameInput && nameInput.value) || "").trim();
    if (!name) {
      if (errorDiv) errorDiv.innerText = "Name is required.";
      return;
    }

    try {
      if (errorDiv) errorDiv.innerText = "Saving profile...";

      const localPhotoDataUrl = await readSelectedOrPendingPhotoDataUrl(photoInput, "onboarding-photo-file");

      const user = await updateUserProfile({ displayName: name, photoURL: "" });
      await syncLocalProfile(user, localPhotoDataUrl);
      setPendingPhotoDataUrl("onboarding-photo-file", "");
      clearResumeSyncSuppression();
      trackProfileLog("profile_onboarded", "Completed user onboarding profile", {
        profile_name: name,
        has_profile_picture: Boolean(localPhotoDataUrl || (user && user.photoURL)),
      });
      if (errorDiv) errorDiv.innerText = "";
      setRoute("/inventories");
      if (typeof onRender === "function") onRender();
    } catch (error) {
      if (errorDiv) errorDiv.innerText = String(error.message || error);
      clearResumeSyncSuppression();
    }
  });
}

export function wireProfileEvents(onRender) {
  if (!passwordToggleClickHandlerAttached) {
    passwordToggleClickHandlerAttached = true;
    document.addEventListener("click", handlePasswordToggleClick);
  }

  wireImagePreview("profile-photo-file", "profile-photo-preview", "profile-name");

  const saveProfileBtn = document.getElementById("save-profile");
  if (saveProfileBtn) saveProfileBtn.addEventListener("click", async () => {
    const nameInput = document.getElementById("profile-name");
    const photoInput = document.getElementById("profile-photo-file");
    const message = document.getElementById("profile-save-message");

    const displayName = String((nameInput && nameInput.value) || "").trim();
    if (!displayName) {
      if (message) {
        message.style.color = "var(--danger)";
        message.innerText = "Name is required.";
      }
      return;
    }

    try {
      if (message) {
        message.style.color = "var(--text-soft)";
        message.innerText = "Saving...";
      }

      const localPhotoDataUrl = await readSelectedOrPendingPhotoDataUrl(photoInput, "profile-photo-file");

      const current = getCurrentUser();
      const existingRemotePhoto = String((current && current.photoURL) || "").trim();
      const user = await updateUserProfile({ displayName, photoURL: existingRemotePhoto });
      await syncLocalProfile(user, localPhotoDataUrl);
      setPendingPhotoDataUrl("profile-photo-file", "");
      clearResumeSyncSuppression();
      trackProfileLog("profile_updated", "Updated profile details", {
        profile_name: displayName,
        has_profile_picture: Boolean(localPhotoDataUrl || (user && user.photoURL)),
      });
      if (message) {
        message.style.color = "var(--success)";
        message.innerText = "Profile saved.";
      }
      if (typeof onRender === "function") onRender();
    } catch (error) {
      if (message) {
        message.style.color = "var(--danger)";
        message.innerText = String(error.message || error);
      }
      clearResumeSyncSuppression();
    }
  });

  const changePasswordBtn = document.getElementById("change-password");
  if (changePasswordBtn) changePasswordBtn.addEventListener("click", async () => {
    const currentInput = document.getElementById("password-current");
    const newInput = document.getElementById("password-new");
    const confirmInput = document.getElementById("password-confirm");
    const message = document.getElementById("password-message");

    const currentPassword = String((currentInput && currentInput.value) || "");
    const newPassword = String((newInput && newInput.value) || "");
    const confirmPassword = String((confirmInput && confirmInput.value) || "");

    if (!currentPassword || !newPassword || !confirmPassword) {
      if (message) {
        message.style.color = "var(--danger)";
        message.innerText = "All password fields are required.";
      }
      return;
    }

    if (newPassword.length < 6) {
      if (message) {
        message.style.color = "var(--danger)";
        message.innerText = "New password must be at least 6 characters.";
      }
      return;
    }

    if (newPassword !== confirmPassword) {
      if (message) {
        message.style.color = "var(--danger)";
        message.innerText = "New passwords do not match.";
      }
      return;
    }

    try {
      if (message) {
        message.style.color = "var(--text-soft)";
        message.innerText = "Updating password...";
      }
      await changeUserPassword(currentPassword, newPassword);
      trackProfileLog("password_changed", "Changed account password", null);
      if (message) {
        message.style.color = "var(--success)";
        message.innerText = "Password updated.";
      }
      if (currentInput) currentInput.value = "";
      if (newInput) newInput.value = "";
      if (confirmInput) confirmInput.value = "";
    } catch (error) {
      if (message) {
        message.style.color = "var(--danger)";
        message.innerText = getFriendlyPasswordPolicyError(error);
      }
    }
  });

  const resetPrefsBtn = document.getElementById("reset-account-prefs");
  if (resetPrefsBtn) resetPrefsBtn.addEventListener("click", async () => {
    const message = document.getElementById("profile-prefs-message");
    const user = getCurrentUser();

    if (!user || !user.uid) {
      if (message) {
        message.style.color = "var(--danger)";
        message.innerText = "You must be signed in to reset preferences.";
      }
      return;
    }

    if (!confirm("Reset account preferences to default values for your profile?")) return;

    try {
      if (message) {
        message.style.color = "var(--text-soft)";
        message.innerText = "Resetting preferences...";
      }

      const state = getState();
      const next = {
        ...state,
        prefs: {
          ...state.prefs,
          theme: "teal",
          dark_mode: true,
          profile_picture: "",
        },
      };

      setState(next);
      setCachedUserPrefs(user.uid, {
        theme: "teal",
        dark_mode: true,
        profile_picture: "",
      });
      await updateUserAccountPrefs(user.uid, {
        theme: "teal",
        dark_mode: true,
        profile_picture: "",
      });
      saveState();
      applyTheme();

      trackProfileLog("account_preferences_reset", "Reset account preferences to default", {
        theme: "teal",
        dark_mode: true,
        profile_picture: "",
      });

      if (message) {
        message.style.color = "var(--success)";
        message.innerText = "Preferences reset to default.";
      }

      if (typeof onRender === "function") onRender();
    } catch (error) {
      if (message) {
        message.style.color = "var(--danger)";
        message.innerText = String(error && error.message ? error.message : error);
      }
    }
  });
}

// Inventory Selection Events
export function wireInventorySelectionEvents(onRender) {
  inventorySelectionOnRender = onRender;

  const createBtn = document.getElementById("create-new-inventory");
  if (createBtn) createBtn.addEventListener("click", async () => {
    const name = prompt("Inventory space name:", "My Inventory Space");
    if (!name) return;

    try {
      const user = getCurrentUser();
      const state = getState();
      const nextHomeName = String(name || "").trim() || state.prefs.home_name || defaultHomeName;
      const inventoryData = {
        prefs: {
          home_name: nextHomeName,
        },
        categories: getDefaultCategories(),
        items: [],
      };

      const result = await createSharedInventory(user.uid, name, inventoryData);
      setCurrentInventory(result.inventoryId);
      resetLocalInventoryView(nextHomeName);
      saveStateLocalOnly();

      // Show invite code
      alert(`Inventory space created!\n\nInvite code: ${result.inviteCode}\n\nShare this code with collaborators to manage stock together.`);
      setRoute("/dashboard");
      if (typeof inventorySelectionOnRender === "function") {
        inventorySelectionOnRender();
      }
    } catch (error) {
      const msg = String(error && error.message ? error.message : error);
      const isPermission = /permission|denied/i.test(msg);
      if (isPermission) {
        alert(
          "Firebase denied access while creating the inventory space.\n\nOpen Realtime Database Rules and use the rules in FIREBASE_SETUP.md (Step 3), then publish and try again."
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
      if (errorDiv) errorDiv.innerText = "Please enter an invite code";
      return;
    }

    try {
      if (errorDiv) errorDiv.innerText = "Joining inventory space...";
      const user = getCurrentUser();
      if (!user || !user.uid) {
        throw new Error("You must be signed in to join an inventory space");
      }

      const inventoryId = await findInventoryIdByInviteCode(code);
      if (!inventoryId) {
        if (errorDiv) errorDiv.innerText = "Invalid invite code for an inventory space";
        return;
      }

      await joinInventoryWithCode(user.uid, inventoryId, code);
      setCurrentInventory(inventoryId);
      resetLocalInventoryView();
      saveStateLocalOnly();
      if (codeInput) codeInput.value = "";
      setRoute("/dashboard");
      if (typeof inventorySelectionOnRender === "function") {
        inventorySelectionOnRender();
      }
    } catch (error) {
      if (errorDiv) errorDiv.innerText = error.message;
    }
  });

  if (!inventorySelectionClickHandlerAttached) {
    inventorySelectionClickHandlerAttached = true;
    document.addEventListener("click", handleInventorySelectionDocumentClick);
  }

  // Logout
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) logoutBtn.addEventListener("click", async () => {
    try {
      await signOut();
      setCurrentInventory(null);
      setRoute("/login");
    } catch (error) {
      alert("Logout failed: " + (error && error.message ? error.message : error));
    }
  });
}

// Collaboration Events
export function wireCollaborationEvents(onRender) {
  collaborationOnRender = onRender;

  const viewCollabBtn = document.getElementById("view-collaboration-settings");
  if (viewCollabBtn) viewCollabBtn.addEventListener("click", () => {
    setRoute("/collaboration");
  });

  const switchBtn = document.getElementById("switch-inventory");
  if (switchBtn) switchBtn.addEventListener("click", () => {
    setRoute("/inventories");
  });

  if (!collaborationClickHandlerAttached) {
    collaborationClickHandlerAttached = true;
    document.addEventListener("click", handleCollaborationDocumentClick);
  }

  const generateCodeBtn = document.getElementById("generate-new-code");
  if (generateCodeBtn) generateCodeBtn.addEventListener("click", async () => {
    try {
      const user = getCurrentUser();
      const inventoryId = getCurrentInventoryId();
      const newCode = await generateNewInviteCode(inventoryId, user.uid);
      alert(`New inventory-space invite code: ${newCode}`);
      onRender();
    } catch (error) {
      alert("Error: " + error.message);
    }
  });
}
