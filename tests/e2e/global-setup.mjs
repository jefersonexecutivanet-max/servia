import { createFixture } from "./seed.mjs";

export default async function globalSetup() {
  await createFixture();
}
