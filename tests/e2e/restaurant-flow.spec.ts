import { expect, test } from "@playwright/test";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, getDocs, query, where } from "firebase/firestore";
import { restaurantId, tableToken, testUsers } from "./seed.mjs";

const integrated = process.env.SERVIA_E2E_INTEGRATED === "true";

test.skip(!integrated, "Fluxo completo roda somente com os emuladores Firebase dedicados.");

test("simula cliente, cozinha e caixa em mesa de teste", async ({ browser }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  const dialogs: string[] = [];
  const makePage = async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("net::ERR_FAILED")) errors.push(message.text());
    });
    page.on("response", async (response) => {
      if (response.status() >= 400 && new URL(response.url()).hostname === "127.0.0.1") {
        const body = await response.text().catch(() => "");
        errors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname} ${body.slice(0, 500)}`);
      }
    });
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
        await route.abort();
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        const response = await route.fetch({
          url: `http://127.0.0.1:4175${url.pathname}${url.search}`,
          headers: {
            ...route.request().headers(),
            "x-forwarded-host": "127.0.0.1:4174",
            "x-forwarded-proto": "http",
          },
        });
        await route.fulfill({ response });
        return;
      }
      await route.continue();
    });
    return { context, page };
  };

  const signIn = async (page: import("@playwright/test").Page, user: typeof testUsers.waiter) => {
    await page.goto("/");
    await page.locator('input[name="email"]').fill(user.email);
    await page.locator('input[name="password"]').fill(user.password);
    await page.getByRole("button", { name: "Entrar no Servia" }).click();
    await expect(page.getByText(user.name, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  };

  const customer = await makePage();
  await customer.page.goto(`/mesa/${restaurantId}/1?t=${tableToken}`);
  await expect(customer.page.getByText("Hambúrguer E2E")).toBeVisible({ timeout: 20_000 });
  await customer.page.getByRole("button", { name: /Adicionar/ }).first().click();
  await customer.page.getByLabel("Queijo").check();
  await customer.page.locator("textarea").fill("Sem cebola · teste descartável");
  await customer.page.getByRole("button", { name: /Adicionar · R\$ 15,00/ }).click();
  await customer.page.getByRole("button", { name: /Ver pedido/ }).click();
  await expect(customer.page.getByText(/R\$\s*15,00/).first()).toBeVisible();
  await customer.page.getByRole("button", { name: /Enviar pedido/ }).click();
  await expect(customer.page.getByText("Pedido enviado!")).toBeVisible({ timeout: 20_000 });
  await expect(customer.page.getByText("Hambúrguer E2E").last()).toBeVisible();

  await customer.page.getByRole("button", { name: "Chamar garçom" }).click();
  await customer.page.getByRole("combobox", { name: "Garçom" }).selectOption(testUsers.waiter.uid);
  await customer.page.getByRole("button", { name: "Chamar garçom", exact: true }).last().click();
  await expect(customer.page.getByText("Chamado enviado, aguardando")).toBeVisible({ timeout: 15_000 });

  await customer.page.getByRole("button", { name: "Pedir a conta" }).click();
  await customer.page.getByRole("combobox", { name: "Garçom" }).selectOption(testUsers.waiter.uid);
  await customer.page.getByRole("button", { name: "Solicitar conta" }).click();
  await expect(customer.page.getByText(/Pedido de conta enviado para Garçom Teste/)).toBeVisible({ timeout: 15_000 });

  const kitchen = await makePage();
  await signIn(kitchen.page, testUsers.kitchen);
  await kitchen.page.getByRole("button", { name: "Cozinha" }).click();
  await expect(kitchen.page.getByText("Hambúrguer E2E")).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => (await readFixtureOrders())[0]?.status).toBe("preparando");
  await expect.poll(async () => (await readFixtureOrders())[0]?.printedBy).toBe(testUsers.kitchen.uid);
  await kitchen.page.getByRole("button", { name: "Marcar como pronto" }).click();
  await expect.poll(async () => (await readFixtureOrders())[0]?.status).toBe("pronto");
  await expect(customer.page.getByText("Pronto", { exact: true })).toBeVisible({ timeout: 15_000 });

  await expect.poll(async () => readFixtureCollectionCount("tableCalls")).toBe(1);
  await expect.poll(async () => readFixtureCollectionCount("billRequests")).toBe(1);

  const cashier = await makePage();
  await signIn(cashier.page, testUsers.cashier);
  await cashier.page.getByRole("button", { name: "Caixa" }).click();
  await cashier.page.getByRole("button", { name: "Abrir caixa" }).click();
  const openingDialog = cashier.page.getByText("Fundo de troco (R$)").locator("..")
    .locator("input");
  await openingDialog.fill("100");
  await cashier.page.getByRole("button", { name: "Abrir caixa", exact: true }).last().click();
  await expect(cashier.page.getByRole("button", { name: "Receber mesa" })).toBeVisible();
  await cashier.page.getByRole("button", { name: "Receber mesa" }).click();
  await cashier.page.locator(".modal-content input[type='number']").first().fill("1");
  await cashier.page.getByRole("button", { name: "Conferir conta no servidor" }).click();
  const summary = cashier.page.locator(".closing-summary");
  await expect(summary.getByText("Total", { exact: true })).toBeVisible({ timeout: 20_000 });
  const totalText = await summary.locator(".closing-total strong").textContent();
  expect(totalText).toContain("16.50");
  const paymentPart = cashier.page.locator(".cash-payment-part").last();
  await paymentPart.locator("select").selectOption("cash");
  await paymentPart.locator("input[type='number']").fill("16.50");
  await cashier.page.locator(".modal-content .form-group input[type='number']").last().fill("20");
  cashier.page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.accept();
  });
  await cashier.page.getByRole("button", { name: "Confirmar pagamento" }).click();
  await expect.poll(() => dialogs.length).toBe(2);
  expect(dialogs).toContain("Receber e fechar a conta da mesa 1 no valor de R$ 16.50?");
  expect(dialogs.some((message) => message.includes("Conta fechada. Total recebido: R$ 16.50. Troco: R$ 3.50."))).toBe(true);

  const firestore = await initializeTestEnvironment({
    projectId: "demo-servia-e2e",
    firestore: { host: "127.0.0.1", port: 8081 },
  });
  try {
    await firestore.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      const orders = await getDocs(query(collection(db, "orders"), where("restaurantId", "==", restaurantId)));
      expect(orders.size).toBe(1);
      expect(orders.docs[0].data().paymentStatus).toBe("paid");
      expect(orders.docs[0].data().items[0].notes).toContain("Sem cebola");
      expect(orders.docs[0].data().printedBy).toBe(testUsers.kitchen.uid);
      expect(orders.docs[0].data().printedAt).toBeTruthy();
      const payments = await getDocs(query(collection(db, "payments"), where("restaurantId", "==", restaurantId)));
      expect(payments.size).toBe(1);
      expect(payments.docs[0].data().amount).toBe(16.5);
      expect(payments.docs[0].data().change).toBe(3.5);
      const stock = await getDocs(collection(db, "stock"));
      expect(stock.docs.find((item) => item.id === "ingredient-e2e")?.data().quantity).toBe(48);
    });
  } finally {
    await firestore.cleanup();
  }

  const recoveredFirestoreConflict = errors.some((error) => error.includes("stored version (") && error.includes("FAILED_PRECONDITION"));
  const unexpectedErrors = errors.filter((error) =>
    !/favicon|ResizeObserver/i.test(error)
    && !error.includes("stored version (")
    && !(recoveredFirestoreConflict && error.includes("Failed to load resource: the server responded with a status of 400 (Bad Request)")),
  );
  expect(unexpectedErrors).toEqual([]);
  await Promise.all([customer.context.close(), kitchen.context.close(), cashier.context.close()]);
});

async function readFixtureOrders() {
  const firestore = await initializeTestEnvironment({
    projectId: "demo-servia-e2e",
    firestore: { host: "127.0.0.1", port: 8081 },
  });
  try {
    let orders: Record<string, unknown>[] = [];
    await firestore.withSecurityRulesDisabled(async (context) => {
      const snapshot = await getDocs(query(collection(context.firestore(), "orders"), where("restaurantId", "==", restaurantId)));
      orders = snapshot.docs.map((item) => item.data());
    });
    return orders;
  } finally {
    await firestore.cleanup();
  }
}

async function readFixtureCollectionCount(collectionName: string) {
  const firestore = await initializeTestEnvironment({
    projectId: "demo-servia-e2e",
    firestore: { host: "127.0.0.1", port: 8081 },
  });
  try {
    let count = 0;
    await firestore.withSecurityRulesDisabled(async (context) => {
      const snapshot = await getDocs(query(collection(context.firestore(), collectionName), where("restaurantId", "==", restaurantId)));
      count = snapshot.size;
    });
    return count;
  } finally {
    await firestore.cleanup();
  }
}
