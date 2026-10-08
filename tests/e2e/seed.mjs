import { generateKeyPairSync } from "node:crypto";
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";

export const restaurantId = "restaurant-e2e-001";
export const tableToken = "a1b2c3d4e5f607182930a1b2c3d4e5f607182930a1b2c3d4";
export const testUsers = {
  owner: { uid: restaurantId, email: "owner@servia-e2e.test", password: "Owner-Test-9284!", name: "Dono Teste" },
  waiter: { uid: "staff-waiter-e2e", email: "waiter@servia-e2e.test", password: "Waiter-Test-3829!", role: "WAITER", name: "Garçom Teste" },
  kitchen: { uid: "staff-kitchen-e2e", email: "kitchen@servia-e2e.test", password: "Kitchen-Test-4137!", role: "KITCHEN", name: "Cozinha Teste" },
  cashier: { uid: "staff-cashier-e2e", email: "cashier@servia-e2e.test", password: "Cashier-Test-7192!", role: "CASHIER", name: "Caixa Teste" },
};

function testCredential() {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return cert({ project_id: "demo-servia-e2e", client_email: "e2e-seeder@demo-servia-e2e.iam.gserviceaccount.com", private_key: privateKey });
}

export async function createFixture() {
  if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8081" || process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9098") {
    throw new Error("Fixtures são permitidas somente no ambiente demo-servia-e2e local.");
  }
  const app = initializeApp({ credential: testCredential(), projectId: "demo-servia-e2e" }, "servia-e2e-seed");
  const auth = getAuth(app);
  const db = getFirestore(app);
  for (const collection of await db.listCollections()) await db.recursiveDelete(collection);

  for (const user of Object.values(testUsers)) {
    await auth.deleteUser(user.uid).catch(() => undefined);
    await auth.createUser({ uid: user.uid, email: user.email, password: user.password, displayName: user.name, emailVerified: true, disabled: false });
  }

  const paidUntil = Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const batch = db.batch();
  batch.set(db.doc("restaurants/" + restaurantId), {
    name: "Servia Restaurante E2E", ownerEmail: testUsers.owner.email, ownerName: testUsers.owner.name,
    status: "active", monthlyPaidUntil: paidUntil, createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.doc("tables/" + restaurantId + "_1"), {
    id: restaurantId + "_1", restaurantId, number: 1, name: "Mesa 01", status: "livre", capacity: 4, accessToken: tableToken,
  });
  batch.set(db.doc("menuItems/" + restaurantId + "_burger"), {
    id: "burger", restaurantId, name: "Hambúrguer E2E", description: "Produto descartável de teste", price: 10,
    category: "Pratos", available: true, featured: true, notesEnabled: true,
    extras: [{ id: "cheese", name: "Queijo", price: 5 }], recipe: [{ stockId: "ingredient-e2e", quantity: 2 }],
  });
  batch.set(db.doc("stock/ingredient-e2e"), { restaurantId, name: "Ingrediente E2E", unit: "un", quantity: 50, minQuantity: 0 });

  for (const user of [testUsers.waiter, testUsers.kitchen, testUsers.cashier]) {
    const waiterId = user.uid;
    batch.set(db.doc("restaurantStaff/" + user.uid), { restaurantId, waiterId, role: user.role, active: true, name: user.name });
    batch.set(db.doc("waiters/" + waiterId), { id: waiterId, restaurantId, uid: user.uid, email: user.email, name: user.name, role: user.role, employeeNumber: waiterId, active: true, pinEnabled: false, mustChangePassword: false });
    batch.set(db.doc("waiterDirectory/" + waiterId), { restaurantId, name: user.name, role: user.role, active: true });
    batch.set(db.doc("waiterDirectory/" + restaurantId + "/staff/" + waiterId), { restaurantId, name: user.name, role: user.role, active: true });
  }
  await batch.commit();
  await app.delete();
}
