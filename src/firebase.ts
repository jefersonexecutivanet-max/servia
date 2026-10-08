import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import {
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  setPersistence,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";

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
const provisioningApp = initializeApp(firebaseConfig, "restaurant-provisioning");
const customerApp = initializeApp(firebaseConfig, "customer-session");
if (import.meta.env.VITE_ENABLE_APP_CHECK === "true" && import.meta.env.VITE_RECAPTCHA_SITE_KEY) {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(import.meta.env.VITE_RECAPTCHA_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  });
  initializeAppCheck(customerApp, {
    provider: new ReCaptchaV3Provider(import.meta.env.VITE_RECAPTCHA_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  });
}

export const auth = getAuth(app);
export const restaurantProvisioningAuth = getAuth(provisioningApp);
export const customerAuth = getAuth(customerApp);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});
export const customerDb = initializeFirestore(customerApp, {});

if (import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true") {
  const emulatorHost = import.meta.env.VITE_FIREBASE_EMULATOR_HOST || "127.0.0.1";
  const authPort = Number(import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_PORT || 9098);
  const firestorePort = Number(import.meta.env.VITE_FIRESTORE_EMULATOR_PORT || 8081);
  const authEmulatorUrl = `http://${emulatorHost}:${authPort}`;

  connectAuthEmulator(auth, authEmulatorUrl, { disableWarnings: true });
  connectAuthEmulator(restaurantProvisioningAuth, authEmulatorUrl, { disableWarnings: true });
  connectAuthEmulator(customerAuth, authEmulatorUrl, { disableWarnings: true });
  connectFirestoreEmulator(db, emulatorHost, firestorePort);
  connectFirestoreEmulator(customerDb, emulatorHost, firestorePort);
}

setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.error("Erro ao configurar persistência:", error);
});

setPersistence(restaurantProvisioningAuth, browserLocalPersistence).catch((error) => {
  console.error("Erro ao configurar cadastro de restaurante:", error);
});

setPersistence(customerAuth, browserLocalPersistence).catch((error) => {
  console.error("Erro ao configurar sessão do cliente:", error);
});
