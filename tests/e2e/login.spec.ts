import { expect, test } from "@playwright/test";

const localHost = "127.0.0.1";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === localHost || url.hostname === "localhost") {
      await route.continue();
      return;
    }
    await route.abort();
  });
});

test("carrega login e bloqueia envio com campos vazios", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");
  await expect(page).toHaveTitle(/Servia/);
  await expect(page.getByText("Bem-vindo de volta")).toBeVisible();
  await expect(page.getByText("Sistema de gestão para restaurantes")).toBeVisible();

  const email = page.locator('input[name="email"]');
  const password = page.locator('input[name="password"]');
  await expect(email).toHaveAttribute("required", "");
  await expect(password).toHaveAttribute("required", "");

  await page.getByRole("button", { name: "Entrar no Servia" }).click();
  await expect.poll(async () => email.evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(false);
  await expect.poll(async () => password.evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(false);
  expect(pageErrors).toEqual([]);
});

test("abre o acesso de funcionário por PIN", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Entrar como funcionário com PIN" }).click();
  await expect(page.getByText("Acesso do funcionário")).toBeVisible();
  await expect(page.getByText("Entre com seu ID de funcionário e PIN.")).toBeVisible();
});
