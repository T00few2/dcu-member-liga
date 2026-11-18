import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID
};

// Initialize Firebase only once
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
// Local testing only: point Auth at the Firebase emulator when configured.
const authEmulatorHost = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST;
if (authEmulatorHost && !auth.emulatorConfig) {
  connectAuthEmulator(auth, `http://${authEmulatorHost}`, { disableWarnings: true });
}
const db = getFirestore(app);
const storage = getStorage(app);

export { app, auth, db, storage };
