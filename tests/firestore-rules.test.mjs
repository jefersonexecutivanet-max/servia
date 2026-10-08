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
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  serverTimestamp,
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
      setDoc(doc(db, "waiterDirectory/waiter-1"), { restaurantId: "restaurant-a", name: "Ana", role: "WAITER", active: true }),
      setDoc(doc(db, "waiterDirectory/waiter-2"), { restaurantId: "restaurant-b", name: "Bruno", role: "WAITER", active: true }),
      setDoc(doc(db, "waiterDirectory/waiter-inactive"), { restaurantId: "restaurant-a", name: "Caio", role: "WAITER", active: false }),
      setDoc(doc(db, "waiterDirectory/restaurant-a/staff/waiter-1"), { restaurantId: "restaurant-a", name: "Ana", role: "WAITER", active: true }),
      setDoc(doc(db, "waiterDirectory/restaurant-a/staff/waiter-inactive"), { restaurantId: "restaurant-a", name: "Caio", role: "WAITER", active: false }),
      setDoc(doc(db, "waiterDirectory/restaurant-b/staff/waiter-2"), { restaurantId: "restaurant-b", name: "Bruno", role: "WAITER", active: true }),
      setDoc(doc(db, "employeeSecrets/waiter-pin"), { pinHash: "never-readable-by-client" }),
      setDoc(doc(db, "employeeCodes/FUNC-ABCDEFGHIJKLMNOPQRST"), { employeeId: "waiter-1", restaurantId: "restaurant-a", active: true }),
      setDoc(doc(db, "waiters/waiter-1"), { restaurantId: "restaurant-a", name: "Ana", role: "Garçom", employeeNumber: "101", email: "ana@example.com", uid: "auth-ana", active: true }),
      setDoc(doc(db, "waiters/waiter-2"), { restaurantId: "restaurant-b", name: "Bruno", role: "Garçom", employeeNumber: "102", email: "bruno@example.com", uid: "auth-bruno", active: true }),
      setDoc(doc(db, "waiters/waiter-inactive"), { restaurantId: "restaurant-a", name: "Caio", role: "Garçom", employeeNumber: "103", email: "caio@example.com", uid: "auth-caio", active: false }),
      setDoc(doc(db, "waiters/waiter-unclaimed"), { restaurantId: "restaurant-a", name: "Dani", role: "Garçonete", employeeNumber: "104", email: "", uid: "", active: true }),
      setDoc(doc(db, "waiters/waiter-legacy-unclaimed"), { restaurantId: "restaurant-a", name: "Eva", role: "Garçonete", employeeNumber: "105", email: "", active: true }),
      setDoc(doc(db, "waiterTables/restaurant-a_12"), { restaurantId: "restaurant-a", tableNumber: 12, waiterId: "waiter-1" }),
      setDoc(doc(db, "tables/restaurant-a_12"), { restaurantId: "restaurant-a", number: 12, status: "livre" }),
      setDoc(doc(db, "tables/restaurant-b_15"), { restaurantId: "restaurant-b", number: 15, status: "livre" }),
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

function writeCustomerOrder(db, order) {
  const batch = writeBatch(db);
  batch.set(doc(collection(db, "orders")), order);
  batch.update(doc(db, "tables", order.tableId), { lastOrderAt: serverTimestamp() });
  return batch.commit();
}

async function clearOrderCooldown(tableId) {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), "tables", tableId), { lastOrderAt: deleteField() });
  });
}

test("cliente pode listar garçons ativos, mas não ler dados privados", async () => {
  const db = testEnvironment.authenticatedContext("customer-a", { firebase: { sign_in_provider: "anonymous" } }).firestore();
  const directory = await assertSucceeds(
    getDocs(query(
      collection(db, "waiterDirectory", "restaurant-a", "staff"),
      where("restaurantId", "==", "restaurant-a"),
      where("active", "==", true),
    )),
  );

  assert.equal(directory.size, 1);
  await assertFails(getDocs(collection(db, "waiterDirectory")));
  await assertFails(getDoc(doc(db, "waiters/waiter-1")));
  await assertFails(getDoc(doc(db, "tableCalls/call-1")));
});

test("PIN employee account can use assigned data without an email and cannot read PIN storage", async () => {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), "waiters/waiter-1"), { uid: "pin-staff", email: "" });
  });
  const db = testEnvironment.authenticatedContext("pin-staff", {
    employee: true,
    employeeId: "waiter-1",
    restaurantId: "restaurant-a",
    role: "WAITER",
  }).firestore();
  await assertSucceeds(getDoc(doc(db, "tableCalls/call-1")));
  await assertFails(getDoc(doc(db, "employeeSecrets/waiter-pin")));
  await assertFails(getDoc(doc(db, "employeeCodes/FUNC-ABCDEFGHIJKLMNOPQRST")));
});

test("cliente anônimo não pode reatribuir a mesa a outro garçom", async () => {
  const db = testEnvironment.authenticatedContext("customer-a", { firebase: { sign_in_provider: "anonymous" } }).firestore();
  await assertFails(updateDoc(doc(db, "waiterTables/restaurant-a_12"), { waiterId: "waiter-2" }));
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

test("cliente anônimo não pode criar pedidos diretamente no Firestore (deve usar API segura)", async (t) => {
  const db = testEnvironment.authenticatedContext("customer-a", { firebase: { sign_in_provider: "anonymous" } }).firestore();
  const validOrder = {
    restaurantId: "restaurant-a",
    tableId: "restaurant-a_12",
    tableNumber: 12,
    waiterId: "waiter-1",
    status: "novo",
    source: "qrcode",
    items: [{ productId: "item-a", quantity: 1, price: 0 }],
    total: 0,
    createdAt: Timestamp.now(),
    customerUid: "customer-a",
  };

  await t.test("rejects direct order creation by anonymous client", async () => {
    await assertFails(writeCustomerOrder(db, validOrder));
  });
  await t.test("rejects order with missing waiter", async () => {
    await assertFails(writeCustomerOrder(db, {
      ...validOrder,
      waiterId: "missing-waiter",
    }));
  });
  await t.test("rejects order without waiter assignment", async () => {
    await clearOrderCooldown("restaurant-a_12");
    const unassignedOrder = { ...validOrder };
    delete unassignedOrder.waiterId;
    await assertFails(writeCustomerOrder(db, unassignedOrder));
  });
  await t.test("rejects order for another restaurant", async () => {
    await assertFails(writeCustomerOrder(db, {
      ...validOrder,
      restaurantId: "restaurant-b",
      tableId: "restaurant-b_15",
      tableNumber: 15,
      waiterId: "waiter-2",
    }));
  });
});

test("cliente pode criar um chamado validado e atribuir a mesa a um garçom ativo", async () => {
  const db = testEnvironment.authenticatedContext("customer-a", { firebase: { sign_in_provider: "anonymous" } }).firestore();
  const batch = writeBatch(db);
  batch.set(doc(db, "tableCalls/restaurant-a_12_waiter"), {
    restaurantId: "restaurant-a",
    tableId: "restaurant-a_12",
    tableNumber: 12,
    type: "waiter",
    waiterId: "waiter-1",
    waiterName: "Ana",
    status: "pending",
    createdAt: Timestamp.now(),
    customerUid: "customer-a",
  });
  await assertSucceeds(batch.commit());

  await assertFails(setDoc(doc(db, "tableCalls/spoofed-call"), {
    restaurantId: "restaurant-a",
    tableId: "restaurant-a_12",
    tableNumber: 12,
    type: "waiter",
    waiterId: "waiter-1",
    waiterName: "Outro nome",
    status: "pending",
    createdAt: Timestamp.now(),
    customerUid: "customer-a",
  }));
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

test("system administrator manages restaurants and staff", async () => {
  const db = testEnvironment.authenticatedContext("KVoJiEGKnnceyADEqFhcflynohr2", { email: "finho60@hotmail.com", email_verified: false }).firestore();
  await assertSucceeds(getDoc(doc(db, "waiters/waiter-1")));
  await assertSucceeds(getDocs(collection(db, "tableCalls")));
  await assertSucceeds(setDoc(doc(db, "menuItems/item-1"), { name: "Juice" }));
  await assertSucceeds(setDoc(doc(db, "restaurants/new-restaurant"), { name: "New restaurant", cnpj: "12345678000199", ownerEmail: "new@example.com", status: "pending_payment", paymentStatus: "pending" }));
  assert.equal((await getDocs(collection(db, "restaurants"))).size, 3);
  await assertSucceeds(setDoc(doc(db, "restaurants/KVoJiEGKnnceyADEqFhcflynohr2"), { restaurant: { name: "Servia Restaurant", cnpj: "00000000000000" }, payment: { pixKey: "pix@example.test" } }));
});

test("system owner requires the configured uid and email", async () => {
  const owner = testEnvironment.authenticatedContext("KVoJiEGKnnceyADEqFhcflynohr2", { email: "finho60@hotmail.com", email_verified: false }).firestore();
  const wrongUid = testEnvironment.authenticatedContext("other-uid", { email: "finho60@hotmail.com", email_verified: true }).firestore();
  const wrongEmail = testEnvironment.authenticatedContext("KVoJiEGKnnceyADEqFhcflynohr2", { email: "other@example.com", email_verified: true }).firestore();
  await assertFails(getDoc(doc(wrongUid, "waiters/waiter-1")));
  await assertFails(getDoc(doc(wrongEmail, "waiters/waiter-1")));
  await assertSucceeds(getDoc(doc(owner, "waiters/waiter-1")));
  await assertFails(setDoc(doc(wrongEmail, "restaurants/other"), { restaurant: { name: "Unauthorized" } }));
});

test("restaurant owner manages own staff without system privileges", async () => {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), "restaurants/restaurant-a"), { ownerEmail: "jeferson.executiva.net@gmail.com" });
  });
  const owner = testEnvironment.authenticatedContext("restaurant-a", { email: "jeferson.executiva.net@gmail.com", email_verified: true }).firestore();
  await assertSucceeds(setDoc(doc(owner, "waiterDirectory/new-staff"), { restaurantId: "restaurant-a", name: "New staff", role: "WAITER", active: true }));
  await assertFails(getDoc(doc(owner, "waiters/waiter-2")));
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
  const unverified = testEnvironment.authenticatedContext("auth-unverified", {
    email: "unverified@example.com",
    email_verified: false,
  }).firestore();
  await assertFails(updateDoc(doc(unverified, "waiters/waiter-unclaimed"), {
    uid: "auth-unverified",
    email: "unverified@example.com",
  }));

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

  await assertSucceeds(updateDoc(doc(newWaiter, "waiters/waiter-legacy-unclaimed"), {
    uid: "auth-dani",
    email: "dani@example.com",
  }));
  await assertSucceeds(getDoc(doc(newWaiter, "waiters/waiter-legacy-unclaimed")));
});

test("token válido da mesa não permite criar pedido diretamente no Firestore", async () => {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), "tables/restaurant-a_12"), { accessToken: "a".repeat(48) });
  });
  const db = testEnvironment.authenticatedContext("customer-token", { firebase: { sign_in_provider: "anonymous" } }).firestore();
  const order = {
    restaurantId: "restaurant-a", tableId: "restaurant-a_12", tableNumber: 12,
    status: "novo", source: "qrcode", items: [{ productId: "item-a", quantity: 1, price: 0 }], total: 0, createdAt: Timestamp.now(),
    customerUid: "customer-token",
  };
  await assertFails(addDoc(collection(db, "orders"), order));
  await assertFails(addDoc(collection(db, "orders"), { ...order, accessToken: "b".repeat(48) }));
  await assertFails(writeCustomerOrder(db, { ...order, accessToken: "a".repeat(48) }));
});

test("chamado tokenizado impede spam enquanto estiver pendente", async () => {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), "tables/restaurant-a_12"), { accessToken: "c".repeat(48) });
  });
  const db = testEnvironment.authenticatedContext("customer-token", { firebase: { sign_in_provider: "anonymous" } }).firestore();
  const request = {
    restaurantId: "restaurant-a", tableId: "restaurant-a_12", tableNumber: 12, type: "waiter",
    waiterId: "waiter-1", waiterName: "Ana", status: "pending", createdAt: Timestamp.now(),
    customerUid: "customer-token", accessToken: "c".repeat(48),
  };
  const requestRef = doc(db, "tableCalls/restaurant-a_12_waiter");
  await assertSucceeds(setDoc(requestRef, request));
  await assertFails(setDoc(requestRef, request));
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

test("pagamentos de pedidos só são registrados pela API e pedidos pagos ficam imutáveis", async () => {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "orders/paid-order"), {
      restaurantId: "restaurant-a",
      tableNumber: 12,
      status: "entregue",
      paymentStatus: "paid",
      paymentId: "payment-a",
      total: 25,
    });
    await setDoc(doc(context.firestore(), "restaurantStaff/cashier-a"), {
      restaurantId: "restaurant-a",
      role: "CASHIER",
      active: true,
    });
  });

  const owner = testEnvironment.authenticatedContext("restaurant-a", {
    email: "owner-a@example.com",
    email_verified: true,
  }).firestore();
  const cashier = testEnvironment.authenticatedContext("cashier-a").firestore();

  await assertFails(updateDoc(doc(owner, "orders/order-1"), {
    paymentStatus: "paid",
    paymentId: "forged-payment",
  }));
  await assertFails(updateDoc(doc(cashier, "orders/order-1"), {
    paymentStatus: "paid",
    paymentId: "forged-payment",
  }));
  await assertFails(updateDoc(doc(owner, "orders/paid-order"), { total: 0.01 }));
  await assertFails(updateDoc(doc(owner, "orders/paid-order"), { status: "cancelado" }));
  await assertFails(deleteDoc(doc(owner, "orders/paid-order")));
});

test("proprietário ativo gerencia dados operacionais apenas no próprio tenant", async () => {
  const owner = testEnvironment.authenticatedContext("restaurant-a", {
    email: "owner-a@example.com",
    email_verified: true,
  }).firestore();

  await assertSucceeds(setDoc(doc(owner, "stock/stock-a"), {
    restaurantId: "restaurant-a", name: "Farinha", category: "Insumos", quantity: 10,
    unit: "kg", minQuantity: 2, price: 5, lastUpdated: Timestamp.now(),
  }));
  await assertFails(setDoc(doc(owner, "stock/stock-b"), {
    restaurantId: "restaurant-b", name: "Item externo", category: "Insumos", quantity: 1,
    unit: "un", minQuantity: 0, price: 1, lastUpdated: Timestamp.now(),
  }));
  await assertSucceeds(setDoc(doc(owner, "cashTransactions/expense-a"), {
    restaurantId: "restaurant-a", type: "saida", category: "Insumos", description: "Compra",
    amount: 50, paymentMethod: "pix", createdAt: Timestamp.now(),
  }));
  await assertFails(setDoc(doc(owner, "cashTransactions/expense-b"), {
    restaurantId: "restaurant-b", type: "saida", category: "Insumos", description: "Externo",
    amount: 50, paymentMethod: "pix", createdAt: Timestamp.now(),
  }));
  await assertFails(setDoc(doc(owner, "payments/payment-a"), {
    restaurantId: "restaurant-a", tableId: "restaurant-a_12", tableNumber: 12, method: "pix", amount: 25,
    items: 1, status: "completed", createdAt: Timestamp.now(),
  }));
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "payments/payment-a"), {
      restaurantId: "restaurant-a", tableId: "restaurant-a_12", tableNumber: 12, method: "pix", amount: 25,
      items: 1, status: "completed", createdAt: Timestamp.now(),
    });
  });
  await assertFails(updateDoc(doc(owner, "payments/payment-a"), { amount: 1 }));
  await assertFails(deleteDoc(doc(owner, "payments/payment-a")));
  const ownStock = await assertSucceeds(getDocs(query(collection(owner, "stock"), where("restaurantId", "==", "restaurant-a"))));
  assert.equal(ownStock.size, 1);
  await assertFails(getDocs(query(collection(owner, "stock"), where("restaurantId", "==", "restaurant-b"))));
  const ownCash = await assertSucceeds(getDocs(query(collection(owner, "cashTransactions"), where("restaurantId", "==", "restaurant-a"))));
  assert.equal(ownCash.size, 1);
  const ownPayments = await assertSucceeds(getDocs(query(collection(owner, "payments"), where("restaurantId", "==", "restaurant-a"))));
  assert.equal(ownPayments.size, 1);
  await assertSucceeds(updateDoc(doc(owner, "stock/stock-a"), { quantity: 8 }));
  await assertFails(updateDoc(doc(owner, "cashTransactions/expense-a"), { description: "Compra registrada" }));
  await assertSucceeds(deleteDoc(doc(owner, "stock/stock-a")));
  await assertFails(deleteDoc(doc(owner, "cashTransactions/expense-a")));
  await assertSucceeds(setDoc(doc(owner, "cashTransactions/estorno_expense-a"), {
    restaurantId: "restaurant-a", type: "estorno", category: "Insumos", description: "Estorno: Compra",
    amount: 50, paymentMethod: "pix", reference: "expense-a", createdBy: "restaurant-a", createdAt: Timestamp.now(),
  }));
  await assertFails(getDoc(doc(owner, "orders/order-2")));
  await assertFails(getDoc(doc(owner, "payments/payment-b")));
});

test("cliente só solicita liberação para uma mesa pertencente ao restaurante", async () => {
  const db = testEnvironment.authenticatedContext("customer-a", { firebase: { sign_in_provider: "anonymous" } }).firestore();
  await assertSucceeds(setDoc(doc(db, "tableReleases/release-a"), {
    restaurantId: "restaurant-a", tableId: "restaurant-a_12", tableNumber: 12,
    totalAmount: 25, paymentMethod: "pix", status: "pending", createdAt: Timestamp.now(),
  }));
  await assertFails(setDoc(doc(db, "tableReleases/release-spoofed"), {
    restaurantId: "restaurant-a", tableId: "restaurant-b_15", tableNumber: 15,
    totalAmount: 25, paymentMethod: "pix", status: "pending", createdAt: Timestamp.now(),
  }));
});

test("restaurante novo não herda pedidos, pagamentos, caixa ou estoque", async () => {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "restaurants/restaurant-empty"), {
      ownerEmail: "empty@example.com",
      status: "active",
      monthlyPaidUntil: Timestamp.fromMillis(Date.now() + 86400000),
    });
  });
  const owner = testEnvironment.authenticatedContext("restaurant-empty", {
    email: "empty@example.com",
    email_verified: true,
  }).firestore();

  for (const name of ["orders", "payments", "cashTransactions", "stock"]) {
    const snapshot = await assertSucceeds(getDocs(query(collection(owner, name), where("restaurantId", "==", "restaurant-empty"))));
    assert.equal(snapshot.size, 0, `${name} should be empty for a newly created restaurant`);
  }
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

test("equipe de restaurante vencido perde leitura operacional", async () => {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await updateDoc(doc(db, "restaurants/restaurant-a"), { monthlyPaidUntil: Timestamp.fromMillis(Date.now() - 1000) });
    await setDoc(doc(db, "restaurantStaff/kitchen-expired"), {
      restaurantId: "restaurant-a", waiterId: "kitchen-expired", role: "KITCHEN", active: true,
    });
  });
  const staffDb = testEnvironment.authenticatedContext("kitchen-expired", { email_verified: true }).firestore();
  await assertFails(getDoc(doc(staffDb, "orders/order-1")));
});
