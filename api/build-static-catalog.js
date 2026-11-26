const fs = require("node:fs/promises");
const path = require("node:path");
const { downloadCatalog, CATALOG_URL, ISBN_ALIASES } = require("./server");

async function main() {
  const catalog = await downloadCatalog();
  const output = {
    generatedAt: catalog.loadedAt,
    fuente: {
      nombre: "Catálogo Histórico de Bibliotecas Escolares CRA",
      url: "https://bibliotecas-cra.cl/gestion/administracion-y-gestion-de-bibliotecas/catalogo-historico-cra/",
      archivo: CATALOG_URL,
      ultimaCarga: catalog.loadedAt,
    },
    isbnAliases: ISBN_ALIASES,
    records: catalog.records,
  };
  const destination = path.join(__dirname, "catalogo-cra.json");
  await fs.writeFile(destination, `${JSON.stringify(output)}\n`, "utf8");
  const { size } = await fs.stat(destination);
  if (size > 95 * 1024 * 1024) throw new Error("El índice supera 95 MB y no se puede publicar como un archivo normal de GitHub.");
  console.log(`Índice CRA actualizado: ${catalog.records.length} registros, ${(size / (1024 * 1024)).toFixed(2)} MB.`);
}

main().catch((error) => {
  console.error(`No se pudo generar el índice CRA: ${error.message}`);
  process.exitCode = 1;
});
