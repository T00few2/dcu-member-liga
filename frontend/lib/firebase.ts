import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBytONfVKtjkskfektK3ekFdcb8Mv1nhDg",
  authDomain: "dcu-member-liga-479507.firebaseapp.com",
  projectId: "dcu-member-liga-479507",
  storageBucket: "dcu-member-liga-479507.firebasestorage.app",
  messagingSenderId: "85378712824",
  appId: "1:85378712824:web:44bb6ae3c989852ae2e70d",
  measurementId: "G-SE29VER7SX"
};

// Initialize Firebase only once
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db };

