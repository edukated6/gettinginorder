/*
  auth.js
  Purpose:
  - Wrap Firebase Authentication operations.
  - Track current user and auth readiness.
  - Provide quick-login account history and session lock helpers.
*/

import { initializeFirebase } from "./firebase-config.js";

let currentUser = null;
let authInitialized = false;
let authCallbacks = [];
const RECENT_ACCOUNTS_KEY = "norder_recent_accounts";
const HIDDEN_RECENT_ACCOUNTS_KEY = "norder_hidden_recent_accounts";
const USER_PREFS_BY_UID_KEY = "norder_user_prefs_by_uid";
const LOCKED_SESSION_EMAIL_KEY = "norder_locked_session_email";
const RECENT_ACCOUNTS_PRUNE_INTERVAL_MS = 15 * 60 * 1000;
let lastRecentAccountsPruneAt = 0;
let pruneRecentAccountsPromise = null;
let lockedSessionEmail = localStorage.getItem(LOCKED_SESSION_EMAIL_KEY) || "";
let authReadyResolved = false;
let resolveAuthReady;
const authReadyPromise = new Promise((resolve) => {
  resolveAuthReady = resolve;
});

function setLockedSessionEmail(email) {
  lockedSessionEmail = String(email || "").trim();
  if (lockedSessionEmail) {
    localStorage.setItem(LOCKED_SESSION_EMAIL_KEY, lockedSessionEmail);
  } else {
    localStorage.removeItem(LOCKED_SESSION_EMAIL_KEY);
  }
}

function deepClone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function readRecentAccounts() {
  try {
    const raw = localStorage.getItem(RECENT_ACCOUNTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function readHiddenRecentAccountEmails() {
  try {
    const raw = localStorage.getItem(HIDDEN_RECENT_ACCOUNTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((email) => String(email || "").trim().toLowerCase())
      .filter(Boolean);
  } catch (_error) {
    return [];
  }
}

function writeHiddenRecentAccountEmails(emails) {
  const next = Array.isArray(emails)
    ? [...new Set(emails.map((email) => String(email || "").trim().toLowerCase()).filter(Boolean))]
    : [];
  localStorage.setItem(HIDDEN_RECENT_ACCOUNTS_KEY, JSON.stringify(next));
}

function hideRecentAccountEmail(email) {
  const target = String(email || "").trim().toLowerCase();
  if (!target) return;

  const hidden = readHiddenRecentAccountEmails();
  if (hidden.includes(target)) return;
  writeHiddenRecentAccountEmails([...hidden, target]);
}

function unhideRecentAccountEmail(email) {
  const target = String(email || "").trim().toLowerCase();
  if (!target) return;

  const hidden = readHiddenRecentAccountEmails();
  if (!hidden.length) return;
  writeHiddenRecentAccountEmails(hidden.filter((item) => item !== target));
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

function saveRecentAccount(user) {
  if (!user || !user.email) return;
  const normalizedEmail = String(user.email || "").trim().toLowerCase();
  if (!normalizedEmail) return;

  const hidden = readHiddenRecentAccountEmails();
  if (hidden.includes(normalizedEmail)) return;

  const account = {
    email: user.email,
    uid: user.uid || null,
    name: user.displayName || user.email,
    photoURL: user.photoURL || "",
    lastUsedAt: Date.now(),
  };

  const existing = readRecentAccounts().filter((item) => item.email !== user.email);
  const updated = [account, ...existing].slice(0, 6);
  localStorage.setItem(RECENT_ACCOUNTS_KEY, JSON.stringify(updated));
}

function writeRecentAccounts(accounts) {
  const next = Array.isArray(accounts) ? accounts : [];
  localStorage.setItem(RECENT_ACCOUNTS_KEY, JSON.stringify(next));
}

// Register callback for auth state changes
export function onAuthStateChanged(callback) {
  authCallbacks.push(callback);
}

// Notify all listeners when auth state changes
function notifyAuthStateChange(user) {
  currentUser = user;
  if (!user) setLockedSessionEmail("");
  if (user) saveRecentAccount(user);
  authCallbacks.forEach((cb) => cb(user));
}

// Initialize Firebase Auth
export async function initializeAuth() {
  if (authInitialized) return currentUser;

  const firebaseReady = await initializeFirebase();

  if (!firebaseReady) {
    throw new Error("Firebase is not initialized. Update firebase-config.js with the new Firebase app credentials.");
  }

  if (typeof firebase === "undefined") {
    console.error("Firebase SDK not available");
    return null;
  }

  try {
    await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);
  } catch (error) {
    // Keep going even if persistence API is unavailable on a given browser.
    console.warn("Could not set auth persistence to LOCAL:", error);
  }

  // Set up auth state listener
  firebase.auth().onAuthStateChanged((user) => {
    notifyAuthStateChange(user);
    if (!authReadyResolved) {
      authReadyResolved = true;
      resolveAuthReady();
    }
  });

  authInitialized = true;
  return currentUser;
}

export function getCurrentUser() {
  return currentUser;
}

export async function signUp(email, password, displayName) {
  try {
    const result = await firebase
      .auth()
      .createUserWithEmailAndPassword(email, password);

    if (displayName) {
      await result.user.updateProfile({ displayName });
    }

    setLockedSessionEmail("");
    return result.user;
  } catch (error) {
    throw new Error(error.message);
  }
}

export async function signIn(email, password, rememberMe) {
  try {
    const targetEmail = String(email || "").trim().toLowerCase();
    const activeUser = firebase.auth().currentUser;
    const activeEmail = String((activeUser && activeUser.email) || "").trim().toLowerCase();
    if (activeUser && targetEmail && activeEmail && activeEmail !== targetEmail) {
      await firebase.auth().signOut();
    }

    const keepSignedIn = rememberMe !== false;
    const persistence = keepSignedIn
      ? firebase.auth.Auth.Persistence.LOCAL
      : firebase.auth.Auth.Persistence.SESSION;

    await firebase.auth().setPersistence(persistence);

    const result = await firebase
      .auth()
      .signInWithEmailAndPassword(email, password);
    unhideRecentAccountEmail(result && result.user ? result.user.email : email);
    if (result && result.user) {
      saveRecentAccount(result.user);
    }
    setLockedSessionEmail("");
    return result.user;
  } catch (error) {
    throw new Error(error.message);
  }
}

export function lockAuthSession() {
  const user = currentUser || (typeof firebase !== "undefined" ? firebase.auth().currentUser : null);
  const email = String((user && user.email) || "").trim();
  if (!email) return false;
  setLockedSessionEmail(email);
  return true;
}

export function unlockAuthSession() {
  setLockedSessionEmail("");
}

export function isAuthSessionLocked() {
  if (!lockedSessionEmail) return false;
  const user = currentUser || (typeof firebase !== "undefined" ? firebase.auth().currentUser : null);
  const email = String((user && user.email) || "").trim();
  return Boolean(email) && email.toLowerCase() === lockedSessionEmail.toLowerCase();
}

export async function signOut() {
  try {
    setLockedSessionEmail("");
    await firebase.auth().signOut();
    currentUser = null;
  } catch (error) {
    throw new Error(error.message);
  }
}

export async function resetPassword(email) {
  try {
    await firebase.auth().sendPasswordResetEmail(email);
  } catch (error) {
    throw new Error(error.message);
  }
}

export function isSignedIn() {
  return currentUser !== null;
}

export function isOnboardingRequired(user = currentUser) {
  if (!user) return false;
  const name = String(user.displayName || "").trim();
  return !name;
}

export async function updateUserProfile({ displayName, photoURL }) {
  const user = firebase.auth().currentUser;
  if (!user) {
    throw new Error("You must be signed in to update profile details.");
  }

  const payload = {
    displayName: String(displayName || "").trim() || null,
    photoURL: String(photoURL || "").trim() || null,
  };

  if (!payload.displayName) {
    throw new Error("Name is required.");
  }

  await user.updateProfile(payload);
  saveRecentAccount(user);
  notifyAuthStateChange(user);
  return user;
}

export async function changeUserPassword(currentPassword, newPassword) {
  const user = firebase.auth().currentUser;
  if (!user || !user.email) {
    throw new Error("You must be signed in to change password.");
  }

  const current = String(currentPassword || "");
  const next = String(newPassword || "");
  if (!current || !next) {
    throw new Error("Current and new password are required.");
  }

  const credential = firebase.auth.EmailAuthProvider.credential(user.email, current);
  await user.reauthenticateWithCredential(credential);
  await user.updatePassword(next);
}

export function getRecentAccounts() {
  const hidden = readHiddenRecentAccountEmails();
  const list = readRecentAccounts().filter(
    (account) => !hidden.includes(String((account && account.email) || "").trim().toLowerCase())
  );
  const prefsByUid = readUserPrefsByUid();
  const hydrated = deepClone(list).map((account) => {
    const uid = String((account && account.uid) || "").trim();
    const cached = uid && prefsByUid && prefsByUid[uid] ? prefsByUid[uid] : null;
    const cachedPhoto = cached && typeof cached.profile_picture === "string"
      ? String(cached.profile_picture || "").trim()
      : "";
    const currentPhoto = String((account && account.photoURL) || "").trim();

    return {
      ...account,
      photoURL: cachedPhoto || currentPhoto,
    };
  });

  return hydrated.sort((a, b) => Number(b.lastUsedAt || 0) - Number(a.lastUsedAt || 0));
}

export function removeRecentAccountByEmail(email) {
  const target = String(email || "").trim().toLowerCase();
  if (!target) return;
  hideRecentAccountEmail(target);

  const filtered = readRecentAccounts().filter(
    (account) => String(account && account.email ? account.email : "").trim().toLowerCase() !== target
  );
  writeRecentAccounts(filtered);
}

export async function pruneStaleRecentAccounts(force = false) {
  const now = Date.now();
  if (!force && now - lastRecentAccountsPruneAt < RECENT_ACCOUNTS_PRUNE_INTERVAL_MS) {
    return getRecentAccounts();
  }

  if (pruneRecentAccountsPromise) {
    return pruneRecentAccountsPromise;
  }

  pruneRecentAccountsPromise = (async () => {
    const existing = readRecentAccounts();
    if (!existing.length || typeof firebase === "undefined") {
      lastRecentAccountsPruneAt = Date.now();
      return getRecentAccounts();
    }

    const checks = await Promise.all(
      existing.map(async (account) => {
        const email = String((account && account.email) || "").trim();
        if (!email) return null;

        try {
          const methods = await firebase.auth().fetchSignInMethodsForEmail(email);
          // Empty results can happen when email-enumeration protection is enabled.
          // Keep the account to avoid incorrectly deleting valid quick-login entries.
          if (Array.isArray(methods) && methods.length === 0) {
            return account;
          }
          return account;
        } catch (_error) {
          // Keep the account if validation fails due to connectivity or temporary auth issues.
          return account;
        }
      })
    );

    const pruned = checks.filter(Boolean);
    if (pruned.length !== existing.length) {
      writeRecentAccounts(pruned);
    }

    lastRecentAccountsPruneAt = Date.now();
    return getRecentAccounts();
  })().finally(() => {
    pruneRecentAccountsPromise = null;
  });

  return pruneRecentAccountsPromise;
}

export function waitForAuthReady() {
  return authReadyPromise;
}
