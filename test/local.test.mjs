import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createLocalApp } = require("../local.js");
const seed = require("../data.js");

class MemoryStorage {
  #values = new Map();
  getItem(key) { return this.#values.get(key) ?? null; }
  setItem(key, value) { this.#values.set(key, String(value)); }
}

function openApp(storage = new MemoryStorage()) {
  let id = 0;
  const app = createLocalApp({
    storage,
    seed,
    now: () => new Date("2026-01-15T12:00:00.000Z"),
    createId: () => `test-${++id}`,
  });
  return { app, storage };
}

test("Cuentas demo inician sesión y los cambios persisten en el almacenamiento local", async () => {
  const { app, storage } = openApp();
  await assert.rejects(app.request("/state"), { status: 401 });
  await assert.rejects(app.request("/login", "POST", {
    role: "student",
    identifier: "99.999.999-9",
    password: "incorrecta",
  }), { status: 401 });

  const login = await app.request("/login", "POST", {
    role: "student",
    identifier: "999999999",
    password: seed.demoAccounts[0].password,
  });
  assert.equal(login.user.id, "demo-student");
  assert.equal((await app.request("/state")).books.length, seed.initialBooks.length);

  const reopened = createLocalApp({ storage, seed });
  assert.equal((await reopened.request("/state")).user.id, "demo-student");
  await reopened.request("/logout", "POST");
  await assert.rejects(reopened.request("/state"), { status: 401 });
});

test("Estudiantes solicitan préstamos y administración aprueba y registra devoluciones", async () => {
  const { app } = openApp();
  await app.request("/login", "POST", seed.demoAccounts[0]);
  const book = (await app.request("/state")).books.find((item) => item.id === "b1");
  await app.request("/requests", "POST", { type: "loan", bookId: book.id });
  const pending = (await app.request("/state")).requests[0];
  assert.equal(pending.status, "Pendiente");
  await app.request("/logout", "POST");

  await app.request("/login", "POST", seed.demoAccounts[1]);
  await app.request(`/requests/${pending.id}`, "PATCH", { approve: true });
  assert.equal((await app.request("/state")).books.find((item) => item.id === book.id).available, book.available - 1);
  const loan = (await app.request("/state")).loans[0];
  await app.request("/loans/" + loan.id + "/return", "POST");
  assert.equal((await app.request("/state")).books.find((item) => item.id === book.id).available, book.available);
  assert.equal((await app.request("/audit")).entries.length, 2);
});

test("Solo la persona autora edita su reseña y administración puede moderarla", async () => {
  const { app } = openApp();
  await app.request("/login", "POST", seed.demoAccounts[0]);
  const bookId = (await app.request("/state")).books[0].id;
  await app.request("/reviews", "POST", { bookId, rating: 5, comment: "Una historia muy entretenida." });
  const [review] = (await app.request("/state")).reviews;
  await assert.rejects(
    app.request(`/reviews/${review.id}`, "PATCH", { bookId, rating: 4, comment: "Cambiar la reseña." }, "otra-sesion"),
    { code: "SESSION_CHANGED" },
  );
  await assert.rejects(
    app.request("/reviews", "POST", { bookId, rating: 5, comment: "Qué imbécil es." }),
    { code: "prohibited_expression" },
  );

  await app.request("/logout", "POST");
  await app.request("/login", "POST", seed.demoAccounts[1]);
  await assert.rejects(
    app.request(`/reviews/${review.id}`, "PATCH", { bookId, rating: 4, comment: "Otra reseña válida." }),
    { status: 403 },
  );
  await app.request(`/reviews/${review.id}`, "DELETE");
  assert.equal((await app.request("/state")).reviews.length, 0);
});
