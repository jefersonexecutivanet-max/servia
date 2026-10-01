import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";

const projectId = "demo-servia-rules";
let testEnvironment;

before(async () => {
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: { host: "127.0.0.1", port: 8080, rules },
  });
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const timestamp = Timestamp.now();
    await Promise.all([
      setDoc(doc(db, "restaurants/restaurant-a"), { name: "A", ownerEmail: "owner-a@example.com", status: "active", monthlyPaidUntil: Timestamp.fromMillis(Date.now() + 30 * 86400000) }),
      setDoc(doc(db, "restaurants/restaurant-b"), { name: "B", ownerEmail: "owner-b@example.com", status: "active", monthlyPaidUntil: Timestamp.fromMillis(Date.now() + 30 * 86400000) }),
      setDoc(doc(db, "waiterDirectory/waiter-1"), { restaurantId: "restaurant-a", name: "Ana", active: true }),
      setDoc(doc(db, "waiterDirectory/waiter-2"), { restaurantId: "restaurant-b", name: "Bruno", active: true }),
      setDoc(doc(db, "waiterDirectory/waiter-inactive"), { restaurantId: "restaurant-a", name: "Caio", active: false }),
      setDoc(doc(db, "waiters/waiter-1"), { restaurantId: "restaurant-a", name: "Ana", role: "Garçom", employeeNumber: "101", email: "ana@example.com", uid: "auth-ana", active: true }),
      setDoc(doc(db, "waiters/waiter-2"), { restaurantId: "restaurant-b", name: "Bruno", role: "Garçom", employeeNumber: "102", email: "bruno@example.com", uid: "auth-bruno", active: true }),
      setDoc(doc(db, "waiters/waiter-inactive"), { restaurantId: "restaurant-a", name: "Caio", role: "Garçom", employeeNumber: "103", email: "caio@example.com", uid: "auth-caio", active: false }),
      setDoc(doc(db, "waiters/waiter-unclaimed"), { restaurantId: "restaurant-a", name: "Dani", role: "Garçonete", employeeNumber: "104", email: "", uid: "", active: true }),
      setDoc(doc(db, "waiterTables/restaurant-a_12"), { restaurantId: "restaurant-a", tableNumber: 12, waiterId: "waiter-1" }),
      setDoc(doc(db, "tableCalls/call-1"), {
        restaurantId: "restaurant-a",
        tableNumber: 12,
        waiterId: "waiter-1",
        status: "pending",
        createdAt: timestamp,
      }),
      setDoc(doc(db, "tableCalls/call-2"), {
        restaurantId: "restaurant-b",
        tableNumber: 15,
        waiterId: "waiter-2",
        status: "pending",
        createdAt: timestamp,
      }),
      setDoc(doc(db, "orders/order-1"), {
        restaurantId: "restaurant-a",
        tableNumber: 12,
        waiterId: "waiter-1",
        status: "novo",
      }),
      setDoc(doc(db, "orders/order-2"), {
        restaurantId: "restaurant-b",
        tableNumber: 15,
        waiterId: "waiter-2",
        status: "novo",
      }),
      setDoc(doc(db, "menuItems/menu-a"), { restaurantId: "restaurant-a", name: "Menu A" }),
      setDoc(doc(db, "menuItems/menu-b"), { restaurantId: "restaurant-b", name: "Menu B" }),
    ]);
  });
});

after(async () => {
  await testEnvironment.cleanup();
});

test("cliente pode listar garçons ativos, mas não ler dados privados", async () => {
  const db = testEnvironment.unauthenticatedContext().firestore();
  const directory = await assertSucceeds(
    getDocs(query(
      collection(db, "waiterDirectory"),
      where("restaurantId", "==", "restaurant-a"),
      where("active", "==", true),
    )),
  );

  assert.equal(directory.size, 1);
  await assertFails(getDoc(doc(db, "waiters/waiter-1")));
  await assertFails(getDoc(doc(db, "tableCalls/call-1")));
});

test("garçom só lê e atualiza chamados atribuídos à própria conta", async () => {
  const db = testEnvironment.authenticatedContext("auth-ana", {
    email: "ana@example.com",
    email_verified: true,
  }).firestore();
  const ownCalls = await assertSucceeds(
    getDocs(query(
      collection(db, "tableCalls"),
      where("restaurantId", "==", "restaurant-a"),
      where("waiterId", "==", "waiter-1"),
    )),
  );

  assert.equal(ownCalls.size, 1);
  const ownProfile = await assertSucceeds(
    getDocs(query(
      collection(db, "waiters"),
      where("uid", "==", "auth-ana"),
      where("active", "==", true),
    )),
  );
  assert.equal(ownProfile.size, 1);
  const ownOrders = await assertSucceeds(
    getDocs(query(
      collection(db, "orders"),
      where("restaurantId", "==", "restaurant-a"),
      where("waiterId", "==", "waiter-1"),
    )),
  );
  assert.equal(ownOrders.size, 1);
  await assertFails(getDoc(doc(db, "tableCalls/call-2")));
  await assertFails(getDoc(doc(db, "orders/order-2")));
  await assertFails(getDocs(collection(db, "tableCalls")));
  await assertFails(updateDoc(doc(db, "waiters/waiter-2"), {
    uid: "auth-ana",
    email: "ana@example.com",
  }));
  await assertSucceeds(updateDoc(doc(db, "tableCalls/call-1"), {
    status: "in_progress",
    attendedBy: "Ana",
  }));
  await assertFails(updateDoc(doc(db, "tableCalls/call-1"), {
    waiterId: "waiter-2",
  }));
});

test("pedido de cliente só pode indicar um garçom ativo", async () => {
  const db = testEnvironment.unauthenticatedContext().firestore();
  const validOrder = {
    restaurantId: "restaurant-a",
    tableNumber: 12,
    waiterId: "waiter-1",
    status: "novo",
    source: "qrcode",
    items: [],
    total: 0,
    createdAt: Timestamp.now(),
  };

  await assertSucceeds(addDoc(collection(db, "orders"), validOrder));
  await assertSucceeds(addDoc(collection(db, "orders"), {
    ...validOrder,
    restaurantId: "restaurant-b",
    waiterId: "waiter-2",
  }));
  await assertFails(addDoc(collection(db, "orders"), {
    ...validOrder,
    waiterId: "missing-waiter",
  }));
  const unassignedOrder = { ...validOrder };
  delete unassignedOrder.waiterId;
  await assertSucceeds(addDoc(collection(db, "orders"), unassignedOrder));
});

test("cliente pode criar um chamado validado e atribuir a mesa a um garçom ativo", async () => {
  const db = testEnvironment.unauthenticatedContext().firestore();
  const batch = writeBatch(db);
  batch.set(doc(db, "tableCalls/client-call"), {
    restaurantId: "restaurant-a",
    tableNumber: 12,
    type: "waiter",
    waiterId: "waiter-1",
    waiterName: "Ana",
    status: "pending",
    createdAt: Timestamp.now(),
  });
  batch.set(doc(db, "waiterTables/restaurant-a_12"), {
    restaurantId: "restaurant-a",
    tableNumber: 12,
    waiterId: "waiter-1",
    waiterName: "Ana",
    updatedAt: Timestamp.now(),
  });
  await assertSucceeds(batch.commit());

  const invalidCall = writeBatch(db);
  invalidCall.set(doc(db, "tableCalls/spoofed-call"), {
    restaurantId: "restaurant-a",
    tableNumber: 12,
    type: "waiter",
    waiterId: "waiter-1",
    waiterName: "Outro nome",
    status: "pending",
    createdAt: Timestamp.now(),
  });
  await assertFails(invalidCall.commit());
});

test("garçom desativado perde acesso mesmo com uma sessão ainda válida", async () => {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      updateDoc(doc(db, "waiterDirectory/waiter-1"), { active: false }),
      updateDoc(doc(db, "waiters/waiter-1"), { active: false }),
    ]);
  });

  const db = testEnvironment.authenticatedContext("auth-ana", {
    email: "ana@example.com",
    email_verified: true,
  }).firestore();
  await assertFails(getDoc(doc(db, "tableCalls/call-1")));
});

test("administrador acessa a equipe e os chamados", async () => {
  const db = testEnvironment.authenticatedContext("FOuQD7ivuuVAfDZwlsjaU2Lte753", {
    email: "finho60@hotmail.com",
    email_verified: true,
  }).firestore();
  await assertSucceeds(getDoc(doc(db, "waiters/waiter-1")));
  await assertSucceeds(getDocs(collection(db, "tableCalls")));
  await assertSucceeds(setDoc(doc(db, "menuItems/item-1"), { name: "Suco" }));
  await assertSucceeds(setDoc(doc(db, "restaurants/new-restaurant"), {
    name: "Restaurante Novo",
    cnpj: "12345678000199",
    ownerEmail: "novo@example.com",
    status: "pending_payment",
    paymentStatus: "pending",
  }));
  assert.equal((await getDocs(collection(db, "restaurants"))).size, 3);
  await assertSucceeds(setDoc(doc(db, "restaurants/FOuQD7ivuuVAfDZwlsjaU2Lte753"), {
    restaurant: { name: "Servia Restaurante", cnpj: "00000000000000" },
    payment: { pixKey: "finho60@hotmail.com" },
  }));
});

test("dono entra sem confirmar e-mail, mas precisa corresponder UID e e-mail", async () => {
  const wrongUid = testEnvironment.authenticatedContext("outra-conta", {
    email: "finho60@hotmail.com",
    email_verified: true,
  }).firestore();
  const wrongEmail = testEnvironment.authenticatedContext("FOuQD7ivuuVAfDZwlsjaU2Lte753", {
    email: "outro@example.com",
    email_verified: true,
  }).firestore();
  const owner = testEnvironment.authenticatedContext("FOuQD7ivuuVAfDZwlsjaU2Lte753", {
    email: "finho60@hotmail.com",
    email_verified: false,
  }).firestore();

  await assertFails(getDoc(doc(wrongUid, "waiters/waiter-1")));
  await assertFails(getDoc(doc(wrongEmail, "waiters/waiter-1")));
  await assertSucceeds(getDoc(doc(owner, "waiters/waiter-1")));
  await assertFails(setDoc(doc(wrongUid, "restaurants/outra-conta"), { restaurant: { name: "Invasão" } }));
});

test("conta de restaurante pendente só consegue ler o próprio status", async () => {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "restaurants/restaurant-owner"), {
      ownerEmail: "owner@example.com",
      status: "pending_payment",
      paymentStatus: "pending",
    });
  });

  const owner = testEnvironment.authenticatedContext("restaurant-owner", {
    email: "owner@example.com",
    email_verified: false,
  }).firestore();
  await assertSucceeds(getDoc(doc(owner, "restaurants/restaurant-owner")));
  await assertFails(getDoc(doc(owner, "restaurants/other-restaurant")));
  await assertFails(setDoc(doc(owner, "restaurants/restaurant-owner"), { status: "active" }, { merge: true }));
});

test("conta verificada pode vincular somente um cadastro ainda não reivindicado", async () => {
  const newWaiter = testEnvironment.authenticatedContext("auth-dani", {
    email: "dani@example.com",
    email_verified: true,
  }).firestore();
  await assertSucceeds(updateDoc(doc(newWaiter, "waiters/waiter-unclaimed"), {
    uid: "auth-dani",
    email: "dani@example.com",
  }));
  await assertSucceeds(getDoc(doc(newWaiter, "waiters/waiter-unclaimed")));

  const anotherUser = testEnvironment.authenticatedContext("auth-other", {
    email: "other@example.com",
    email_verified: true,
  }).firestore();
  await assertFails(updateDoc(doc(anotherUser, "waiters/waiter-unclaimed"), {
    uid: "auth-other",
    email: "other@example.com",
  }));
});

test("dono de restaurante não lê comandas de outro tenant", async () => {
  const restaurantA = testEnvironment.authenticatedContext("restaurant-a", {
    email: "owner-a@example.com",
    email_verified: false,
  }).firestore();
  await assertSucceeds(getDoc(doc(restaurantA, "orders/order-1")));
  const ownOrders = await assertSucceeds(
    getDocs(query(collection(restaurantA, "orders"), where("restaurantId", "==", "restaurant-a"))),
  );
  assert.equal(ownOrders.size, 1);
  await assertFails(getDoc(doc(restaurantA, "orders/order-2")));
  await assertFails(setDoc(doc(restaurantA, "menuItems/foreign-menu"), {
    restaurantId: "restaurant-b",
    name: "Alteração cruzada",
  }));
});

test("assinatura vencida bloqueia dados operacionais mesmo com status antigo active", async () => {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, "restaurants/expired-restaurant"), {
        ownerEmail: "expired@example.com",
        status: "active",
        monthlyPaidUntil: Timestamp.fromMillis(Date.now() - 1000),
      }),
      setDoc(doc(db, "orders/expired-order"), {
        restaurantId: "expired-restaurant",
        tableNumber: 1,
        status: "novo",
        createdAt: Timestamp.now(),
      }),
    ]);
  });

  const expiredOwner = testEnvironment.authenticatedContext("expired-restaurant", {
    email: "expired@example.com",
    email_verified: true,
  }).firestore();
  await assertSucceeds(getDoc(doc(expiredOwner, "restaurants/expired-restaurant")));
  await assertFails(getDoc(doc(expiredOwner, "orders/expired-order")));
});