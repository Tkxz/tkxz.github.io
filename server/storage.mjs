import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { initialBooks } from "./seed.mjs";

const defaultFile = fileURLToPath(new URL("../.biblioteca/biblioteca.sqlite", import.meta.url));

// The services depend on read() and update(mutator). An update publishes the
// whole draft atomically, and may run the mutator again after a concurrent write.
export async function createRepository({ file = process.env.BIBLIOTECA_DATA_FILE || defaultFile } = {}) {
  if (file !== ":memory:") {
    file = resolve(file);
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  }

  const database = new DatabaseSync(file, { timeout: 5000 });
  database.exec(`
    CREATE TABLE IF NOT EXISTS library_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      revision INTEGER NOT NULL,
      payload TEXT NOT NULL CHECK (json_valid(payload))
    ) STRICT;
  `);
  database.prepare("INSERT OR IGNORE INTO library_state VALUES (1, 0, ?)").run(JSON.stringify({
    books: initialBooks, reviews: [], loans: [], requests: [], audit: [],
    users: [], sessions: [], loginAttempts: [],
  }));

  const select = database.prepare("SELECT revision, payload FROM library_state WHERE id = 1");
  const replace = database.prepare("UPDATE library_state SET revision = revision + 1, payload = ? WHERE id = 1 AND revision = ?");
  let pending = Promise.resolve();

  return {
    async read() {
      return JSON.parse(select.get().payload);
    },
    update(mutator) {
      const operation = pending.then(async () => {
        for (let attempt = 0; attempt < 10; attempt++) {
          const { revision, payload } = select.get();
          const draft = JSON.parse(payload);
          const result = await mutator(draft);
          const next = JSON.stringify(draft);
          const committed = next === payload
            ? select.get().revision === revision
            : replace.run(next, revision).changes === 1;
          if (committed) return result;
        }
        throw new Error("La base local está ocupada. Vuelve a intentar.");
      });
      pending = operation.catch(() => {});
      return operation;
    },
    async close() {
      await pending;
      database.close();
    },
  };
}
