import { readFile } from "node:fs/promises";
import { createAuthService } from "./auth.mjs";
import { createHttpServer } from "./http.mjs";
import { createLibraryService } from "./library.mjs";
import { createRepository } from "./storage.mjs";

const port = Number(process.env.BIBLIOTECA_PORT || 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error("BIBLIOTECA_PORT debe ser un número de puerto válido.");
}

const prohibitedExpressions = JSON.parse(await readFile(
  new URL("../config/prohibited-expressions.json", import.meta.url), "utf8",
));
const repository = await createRepository();
const auth = createAuthService(repository);
const library = createLibraryService(repository, { prohibitedExpressions });
const server = createHttpServer({ auth, library });
server.listen(port, "127.0.0.1", () => {
  console.log(`Biblioteca disponible en http://127.0.0.1:${server.address().port}`);
});
