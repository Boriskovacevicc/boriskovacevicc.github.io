/**
 * Where Boki Games keeps its saved data.
 *
 * backend "firebase" shares names, Riki Tiki history and chess results
 * between the family's devices. localStorage is always the offline copy.
 *
 * Analytics is intentionally not used.
 * measurementId is kept here so it matches the Firebase console, and the
 * site never loads it.
 *
 * Anonymous sign-in has to be switched on in the Firebase console.
 * The steps are in the README.
 */
export const storeConfig = {
  backend: "firebase",
  firebase: {
    apiKey: "AIzaSyAFwL_ldrdUFjy6oSAuaen79GCQfPDo86Y",
    authDomain: "boki-games.firebaseapp.com",
    projectId: "boki-games",
    storageBucket: "boki-games.firebasestorage.app",
    messagingSenderId: "1075568553770",
    appId: "1:1075568553770:web:584e91ed74d4f5a24d3853",
    measurementId: "G-MDBJQQNLFR",
  },
};
