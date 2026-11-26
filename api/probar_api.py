"""Prueba la API CRA local usando solo la biblioteca estándar de Python.

Uso:
    python probar_api.py
    python probar_api.py --isbn 9789561214231
    python probar_api.py --base-url http://localhost:3000 --isbn 9789561214231
"""

import argparse
import json
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def solicitar(url):
    request = Request(url, headers={"Accept": "application/json"})
    try:
        with urlopen(request, timeout=35) as response:
            status = response.status
            body = response.read().decode("utf-8")
    except HTTPError as error:
        status = error.code
        body = error.read().decode("utf-8", errors="replace")
    except URLError as error:
        raise RuntimeError(
            f"No se pudo conectar con {url}. ¿Está iniciada la API? Detalle: {error.reason}"
        ) from error

    try:
        return status, json.loads(body)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"La API no devolvió JSON válido desde {url}") from error


def probar(base_url, isbn):
    base_url = base_url.rstrip("/")
    errores = []

    print(f"Probando API en {base_url}")

    try:
        status, health = solicitar(f"{base_url}/api/health")
        if status == 200 and health.get("estado") == "ok":
            print("[OK] /api/health responde correctamente")
            print(f"     Catálogo cargado: {health.get('catalogoCargado')}")
        else:
            errores.append(f"/api/health respondió HTTP {status}: {health}")
            print(f"[ERROR] {errores[-1]}")

        status, invalid = solicitar(f"{base_url}/api/libros/no-es-un-isbn")
        if status == 400:
            print("[OK] La API rechaza un ISBN inválido con HTTP 400")
        else:
            errores.append(f"Se esperaba HTTP 400 para ISBN inválido; llegó {status}: {invalid}")
            print(f"[ERROR] {errores[-1]}")

        if isbn:
            status, result = solicitar(f"{base_url}/api/libros/{isbn}")
            books = result.get("libros") if isinstance(result, dict) else None
            count = result.get("cantidad") if isinstance(result, dict) else None

            if status != 200:
                errores.append(f"La consulta del ISBN respondió HTTP {status}: {result}")
                print(f"[ERROR] {errores[-1]}")
            elif not isinstance(books, list) or count != len(books):
                errores.append("La respuesta no incluye 'libros' y 'cantidad' con el formato esperado")
                print(f"[ERROR] {errores[-1]}")
            else:
                print(f"[OK] Consulta ISBN {isbn}: {count} registro(s)")
                for index, book in enumerate(books, start=1):
                    print(f"\nLibro {index}:")
                    print(json.dumps(book, ensure_ascii=False, indent=2))
                if count == 0:
                    print("El ISBN tiene formato válido, pero no aparece en el catálogo consultado.")

    except RuntimeError as error:
        errores.append(str(error))
        print(f"[ERROR] {error}")

    if errores:
        print(f"\nPrueba finalizada con {len(errores)} error(es).")
        return 1

    print("\nPrueba finalizada correctamente.")
    return 0


def main():
    parser = argparse.ArgumentParser(description="Prueba la API del catálogo histórico CRA.")
    parser.add_argument(
        "--base-url",
        default="http://localhost:3000",
        help="URL base de la API (por defecto: http://localhost:3000)",
    )
    parser.add_argument(
        "--isbn",
        default="9788427725577",
        help="ISBN para consultar (por defecto: 9788427725577)",
    )
    args = parser.parse_args()
    return probar(args.base_url, args.isbn)


if __name__ == "__main__":
    sys.exit(main())
