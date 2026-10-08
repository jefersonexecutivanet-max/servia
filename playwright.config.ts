import { defineConfig } from "@playwright/test";

const integrated = process.env.SERVIA_E2E_INTEGRATED === "true";
const reuseLocalServers = process.env.SERVIA_E2E_REUSE_LOCAL === "true";
const webServer = [
  {
    command: `"${process.execPath}" node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4174 --strictPort`,
    url: "http://127.0.0.1:4174",
    reuseExistingServer: reuseLocalServers,
    timeout: 120_000,
    env: {
      VITE_FIREBASE_API_KEY: "demo-local-only",
      VITE_FIREBASE_AUTH_DOMAIN: "localhost",
      VITE_FIREBASE_PROJECT_ID: integrated ? "demo-servia-e2e" : "demo-servia-local",
      VITE_FIREBASE_STORAGE_BUCKET: "demo-servia-e2e.appspot.com",
      VITE_FIREBASE_MESSAGING_SENDER_ID: "123456789012",
      VITE_FIREBASE_APP_ID: "1:123456789012:web:localtest",
      VITE_ENABLE_APP_CHECK: "false",
      VITE_USE_FIREBASE_EMULATORS: integrated ? "true" : "false",
      VITE_FIREBASE_EMULATOR_HOST: "127.0.0.1",
      VITE_FIREBASE_AUTH_EMULATOR_PORT: "9098",
      VITE_FIRESTORE_EMULATOR_PORT: "8081",
    },
  },
  ...(integrated ? [{
    command: `"${process.execPath}" scripts/e2e-api-server.mjs`,
    url: "http://127.0.0.1:4175/__health",
    reuseExistingServer: reuseLocalServers,
    timeout: 120_000,
  }] : []),
];

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  reporter: "list",
  ...(integrated ? { globalSetup: "./tests/e2e/global-setup.mjs" } : {}),
  use: { baseURL: "http://127.0.0.1:4174", browserName: "chromium", headless: true },
  webServer,
});
