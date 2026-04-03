import { initializeFirebase, firebaseConfig } from "./firebase-config.js";

let currentUser = null;
let authInitialized = false;
let authCallbacks = [];
let authReadyResolved = false;
let resolveAuthReady;
const authReadyPromise = new Promise((resolve) => {
  resolveAuthReady = resolve;
});

// Register callback for auth state changes
export function onAuthStateChanged(callback) {
  authCallbacks.push(callback);
}

// Notify all listeners when auth state changes
function notifyAuthStateChange(user) {
  currentUser = user;
  authCallbacks.forEach((cb) => cb(user));
}

// Initialize Firebase Auth
export async function initializeAuth() {
  if (authInitialized) return currentUser;

  await initializeFirebase();

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

    return result.user;
  } catch (error) {
    throw new Error(error.message);
  }
}

export async function signIn(email, password, rememberMe) {
  try {
    const keepSignedIn = rememberMe !== false;
    const persistence = keepSignedIn
      ? firebase.auth.Auth.Persistence.LOCAL
      : firebase.auth.Auth.Persistence.SESSION;

    await firebase.auth().setPersistence(persistence);

    const result = await firebase
      .auth()
      .signInWithEmailAndPassword(email, password);
    return result.user;
  } catch (error) {
    throw new Error(error.message);
  }
}

export async function signOut() {
  try {
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

export function waitForAuthReady() {
  return authReadyPromise;
}
