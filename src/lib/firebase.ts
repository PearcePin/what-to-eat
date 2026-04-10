import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, Auth } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let app;
let auth: Auth | undefined;
let googleProvider: GoogleAuthProvider | undefined;

// 只有在瀏覽器環境執行
if (typeof window !== "undefined") {
  if (process.env.NEXT_PUBLIC_FIREBASE_API_KEY) {
    app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
    auth = getAuth(app);
    googleProvider = new GoogleAuthProvider();
  }
}

export { auth, googleProvider };

export const loginWithGoogle = async () => {
  if (!auth || !googleProvider) {
    console.error("Firebase not initialized");
    return;
  }
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    console.error("Google Login Error", error);
    throw error;
  }
};

export const logout = async () => {
  if (auth) return signOut(auth);
};
