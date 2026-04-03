// Firebase configuration used by compat SDK loaded in index.html.
export const firebaseConfig = {
  apiKey: "AIzaSyAasmmRFsdVdJO4rBtRRMuiQ1snoBNvsKc",
  authDomain: "norder-c9425.firebaseapp.com",
  databaseURL: "https://norder-c9425-default-rtdb.firebaseio.com",
  projectId: "norder-c9425",
  storageBucket: "norder-c9425.firebasestorage.app",
  messagingSenderId: "778027272874",
  appId: "1:778027272874:web:b76b301978f1d702bf5ed3",
  measurementId: "G-Z174C3Q5NT",
};

export let firebaseInitialized = false;

export async function initializeFirebase() {
  if (firebaseInitialized) return true;
  if (typeof firebase === "undefined") return false;

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
