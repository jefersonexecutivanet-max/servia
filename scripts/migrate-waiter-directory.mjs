import admin from "firebase-admin";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const accountPath = process.env.FIREBASE_SERVICE_ACCOUNT || "./firebase-service-account.json";
const serviceAccount = JSON.parse(await readFile(resolve(accountPath), "utf8"));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const db = admin.firestore();
const directory = await db.collection("waiterDirectory").get();
let batch = db.batch();
let writes = 0;

for (const snapshot of directory.docs) {
  const data = snapshot.data();
  if (!data.restaurantId || typeof data.name !== "string") continue;
  const publicRef = db.collection("waiterDirectory").doc(data.restaurantId).collection("staff").doc(snapshot.id);
  batch.set(publicRef, {
    restaurantId: data.restaurantId,
    name: data.name,
    role: data.role || "WAITER",
    active: data.active === true,
  });
  writes += 1;
  if (writes % 450 === 0) {
    await batch.commit();
    batch = db.batch();
  }
}

if (writes % 450 !== 0) await batch.commit();
console.log(`Migrated ${writes} public staff profiles into restaurant-scoped directories.`);
