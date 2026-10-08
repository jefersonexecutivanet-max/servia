import { randomBytes } from "node:crypto";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const applyChanges = process.argv.includes("--apply");
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

if (!serviceAccountJson) {
  console.error("FIREBASE_SERVICE_ACCOUNT_JSON precisa estar configurado no ambiente desta migração.");
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(serviceAccountJson);
} catch {
  console.error("FIREBASE_SERVICE_ACCOUNT_JSON não contém um JSON válido.");
  process.exit(1);
}

if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id,
  });
}

const db = getFirestore();
const snapshot = await db.collection("tables").get();
const needsToken = snapshot.docs.filter((table) => !/^[0-9a-f]{48}$/.test(String(table.data().accessToken || "")));

console.log(`Projeto: ${process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id || "não identificado"}`);
console.log(`Mesas analisadas: ${snapshot.size}`);
console.log(`Mesas sem token válido: ${needsToken.length}`);

if (!applyChanges) {
  console.log("Simulação concluída sem gravar dados. Use --apply após conferir o projeto e fazer backup.");
  process.exit(0);
}

for (let offset = 0; offset < needsToken.length; offset += 400) {
  const batch = db.batch();
  for (const table of needsToken.slice(offset, offset + 400)) {
    batch.update(table.ref, { accessToken: randomBytes(24).toString("hex") });
  }
  await batch.commit();
}

console.log(`Migração aplicada: ${needsToken.length} mesas receberam tokens aleatórios.`);
