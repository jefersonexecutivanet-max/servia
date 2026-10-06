import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
} from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const app = initializeApp(firebaseConfig);
if (import.meta.env.VITE_ENABLE_APP_CHECK === "true" && import.meta.env.VITE_RECAPTCHA_SITE_KEY) {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(import.meta.env.VITE_RECAPTCHA_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  });
}
const provisioningApp = initializeApp(firebaseConfig, "restaurant-provisioning");

export const auth = getAuth(app);
export const restaurantProvisioningAuth = getAuth(provisioningApp);
export const functions = getFunctions(app, "us-central1");
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.error("Erro ao configurar persistência:", error);
});

setPersistence(restaurantProvisioningAuth, browserLocalPersistence).catch((error) => {
  console.error("Erro ao configurar cadastro de restaurante:", error);
});
