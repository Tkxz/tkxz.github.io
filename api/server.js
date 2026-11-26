const http = require("node:http");
const XLSX = require("xlsx");

const PORT = Number(process.env.PORT || 3000);
const CATALOG_URL = "https://bibliotecas-cra.cl/wp-content/uploads/2025/06/Catalogo-cra-historico_coleccion-2024_FINAL.xlsx";
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 24 * 60 * 60 * 1000);
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_DOWNLOAD_BYTES = 40 * 1024 * 1024;
// CRA cataloga la edición impresa; algunas fichas de BDEscolar muestran el eISBN.
const ISBN_ALIASES = {
  "9788427725577": ["9788427725560"],
};

let catalogCache = null;
let catalogRequest = null;

function normalizeIsbn(value) {
  return String(value ?? "").toUpperCase().replace(/[^0-9X]/g, "");
}

function normalizeHeader(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function findIsbnColumns(headers) {
  return headers.filter((header) => {
    const normalized = normalizeHeader(header);
    return normalized.includes("isbn") || normalized.includes("isbd");
  });
}

async function downloadCatalog() {
  const response = await fetch(CATALOG_URL, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { "user-agent": "BibliotecaEscolarJMC/1.0 (consulta de catalogo CRA)" },
  });

  if (!response.ok) {
    throw new Error(`CRA respondió HTTP ${response.status} al descargar el catálogo`);
  }

  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_DOWNLOAD_BYTES) {
    throw new Error("El archivo del catálogo excede el tamaño permitido");
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_DOWNLOAD_BYTES) {
    throw new Error("El archivo del catálogo excede el tamaño permitido");
  }

  const workbook = XLSX.read(bytes, { type: "buffer", cellDates: true });
  const records = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false });
    if (rows.length === 0) continue;

    const headers = Object.keys(rows[0]);
    const isbnColumns = findIsbnColumns(headers);
    if (isbnColumns.length === 0) continue;

    for (const row of rows) {
      const isbns = isbnColumns
        .map((column) => ({ columna: column, valor: row[column] }))
        .filter((item) => normalizeIsbn(item.valor).length >= 10);
      if (isbns.length > 0) records.push({ hoja: sheetName, datos: row, isbns });
    }
  }

  if (records.length === 0) {
    throw new Error("No se encontraron columnas ISBN en el catálogo CRA descargado");
  }

  return { records, loadedAt: new Date().toISOString() };
}

async function getCatalog() {
  if (catalogCache && Date.now() - catalogCache.loadedAtMs < CACHE_TTL_MS) {
    return catalogCache;
  }
  if (!catalogRequest) {
    catalogRequest = downloadCatalog()
      .then(({ records, loadedAt }) => {
        catalogCache = { records, loadedAt, loadedAtMs: Date.now() };
        return catalogCache;
      })
      .finally(() => {
        catalogRequest = null;
      });
  }
  return catalogRequest;
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body, null, 2));
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    return response.end();
  }

  if (request.method !== "GET") {
    return sendJson(response, 405, { error: "Método no permitido. Usa GET." });
  }

  if (url.pathname === "/api/health") {
    return sendJson(response, 200, {
      estado: "ok",
      catalogoCargado: Boolean(catalogCache),
      ultimaCarga: catalogCache?.loadedAt ?? null,
      fuente: CATALOG_URL,
    });
  }

  let isbn = url.searchParams.get("isbn");
  if (url.pathname.startsWith("/api/libros/")) {
    isbn = decodeURIComponent(url.pathname.slice("/api/libros/".length));
  } else if (url.pathname !== "/api/libros") {
    return sendJson(response, 404, { error: "Ruta no encontrada" });
  }

  const normalizedIsbn = normalizeIsbn(isbn);
  if (normalizedIsbn.length < 10 || normalizedIsbn.length > 13) {
    return sendJson(response, 400, {
      error: "Indica un ISBN válido de 10 o 13 caracteres.",
      ejemplo: "/api/libros/9789560000000",
    });
  }

  try {
    const catalog = await getCatalog();
    const searchIsbns = [normalizedIsbn, ...(ISBN_ALIASES[normalizedIsbn] || [])];
    const matches = catalog.records
      .filter((record) => record.isbns.some((item) => searchIsbns.includes(normalizeIsbn(item.valor))))
      .map(({ hoja, datos, isbns }) => ({
        isbnSolicitado: normalizedIsbn,
        isbnCoincidente: isbns.find((item) => searchIsbns.includes(normalizeIsbn(item.valor)))?.valor,
        coincidenciaPor: isbns.some((item) => normalizeIsbn(item.valor) === normalizedIsbn)
          ? "ISBN exacto"
          : "ISBN alternativo de la edición impresa",
        hoja,
        ...datos,
      }));

    return sendJson(response, 200, {
      consulta: { isbn: normalizedIsbn, isbnsAlternativosBuscados: searchIsbns.slice(1) },
      cantidad: matches.length,
      libros: matches,
      fuente: {
        nombre: "Catálogo Histórico de Bibliotecas Escolares CRA",
        url: "https://bibliotecas-cra.cl/gestion/administracion-y-gestion-de-bibliotecas/catalogo-historico-cra/",
        archivo: CATALOG_URL,
        ultimaCarga: catalog.loadedAt,
      },
    });
  } catch (error) {
    console.error("Error consultando el catálogo CRA:", error.message);
    return sendJson(response, 502, {
      error: "No se pudo consultar el catálogo CRA en este momento.",
      detalle: error.message,
    });
  }
});

server.listen(PORT, () => {
  console.log(`API CRA disponible en http://localhost:${PORT}`);
});
