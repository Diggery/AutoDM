import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// TODO: Replace with your Firebase project configuration
const firebaseConfig = {
  apiKey: "AIzaSyDGfKnUTubJGd839KyemDpSGaHJ6b4I-NM",
  authDomain: "autodm-755e4.firebaseapp.com",
  projectId: "autodm-755e4",
  storageBucket: "autodm-755e4.firebasestorage.app",
  messagingSenderId: "307998629705",
  appId: "1:307998629705:web:101abe730cfc4e024d4498"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
