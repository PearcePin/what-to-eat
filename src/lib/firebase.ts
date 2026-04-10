import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// 只有在瀏覽器環境且有金鑰時才初始化
const getFirebase = () => {
  if (typeof window !== "undefined" && process.env.NEXT_PUBLIC_FIREBASE_API_KEY) {
    try {
      const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
      const auth = getAuth(app);
      const googleProvider = new GoogleAuthProvider();
      return { auth, googleProvider };
    } catch (error) {
      console.error("Firebase init error:", error);
    }
  }
  return { auth: null, googleProvider: null };
};

export const { auth, googleProvider } = getFirebase();

export const loginWithGoogle = async () => {
  if (!auth) return;
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
