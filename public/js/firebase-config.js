/*
  firebase-config.js
  Purpose:
  - Store Firebase project settings.
  - Initialize Firebase app once (singleton style).
*/

// Firebase configuration used by compat SDK loaded in index.html.
// Update these values for your active Firebase app before deploying.
const baseFirebaseConfig = {
  apiKey: "AIzaSyAasmmRFsdVdJO4rBtRRMuiQ1snoBNvsKc",
  authDomain: "norder-c9425.firebaseapp.com",
  databaseURL: "https://norder-c9425-default-rtdb.firebaseio.com",
  projectId: "norder-c9425",
  storageBucket: "norder-c9425.firebasestorage.app",
  messagingSenderId: "778027272874",
  appId: "1:778027272874:web:8b464191351fd1f7bf5ed3",
  measurementId: "G-CS009LW7NN",
};

const runtimeFirebaseConfig =
  typeof window !== "undefined" && window.__NORDER_FIREBASE_CONFIG__ && typeof window.__NORDER_FIREBASE_CONFIG__ === "object"
    ? window.__NORDER_FIREBASE_CONFIG__
    : {};

export const firebaseConfig = {
  ...baseFirebaseConfig,
  ...runtimeFirebaseConfig,
};

function isPlaceholder(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .startsWith("REPLACE_WITH_");
}

function getMissingFirebaseKeys(config) {
  const requiredKeys = [
    "apiKey",
    "authDomain",
    "databaseURL",
    "projectId",
    "storageBucket",
    "messagingSenderId",
    "appId",
  ];

  return requiredKeys.filter((key) => {
    const value = String((config && config[key]) || "").trim();
    return !value || isPlaceholder(value);
  });
}

export let firebaseInitialized = false;

export async function initializeFirebase() {
  if (firebaseInitialized) return true;
  if (typeof firebase === "undefined") return false;

  const missingKeys = getMissingFirebaseKeys(firebaseConfig);
  if (missingKeys.length) {
    console.error(
      "Firebase config is incomplete. Update firebase-config.js (or set window.__NORDER_FIREBASE_CONFIG__) with your new app credentials. Missing keys:",
      missingKeys.join(", ")
    );
    return false;
  }

  try {
    if (!firebase.apps || !firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    firebaseInitialized = true;
    return true;
  } catch (error) {
    console.error("Firebase initialization error:", error);
    return false;
  }
}
