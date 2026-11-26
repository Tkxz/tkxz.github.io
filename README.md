# Biblioteca Escolar JMC

## Abrir la aplicación

La aplicación funciona completamente en el navegador, sin servidor ni instalación de dependencias. Abre `estudiantes.html` o `admin.html` directamente en tu navegador.

La autenticación aún no está configurada. La página de estudiantes y la de administración cargan directamente su vista local correspondiente; mientras no se integre el acceso, la administración no está protegida.

El catálogo inicial y la lista de expresiones prohibidas también están en `data.js`. Modifica ese archivo para cambiar los datos que se cargan en un navegador por primera vez.

## Datos locales

La aplicación guarda el catálogo, reseñas, préstamos, peticiones e historial en `localStorage` del navegador. Los datos se comparten entre las páginas del mismo navegador, pero no se sincronizan entre equipos. Para restablecer los datos iniciales, borra el almacenamiento local de la biblioteca o abre la aplicación en un perfil de navegador nuevo.

Al solicitar un préstamo, el estudiante puede elegir la devolución entre hoy y los próximos 14 días. Cada préstamo genera obligatoriamente un ticket físico con identificador único al aprobar la petición; el ticket puede consultarse e imprimirse desde administración, tanto en los préstamos como en el historial de acciones. El envío de comprobantes por correo requiere un backend y un proveedor de correo; esta versión local no envía emails.

Al registrar un préstamo desde administración se genera y puede imprimirse el ticket en ese momento. Al registrar una devolución se genera un ticket independiente con la fecha y hora exactas; el resultado aparece en verde si se devolvió dentro de la fecha elegida y en rojo si fue después. Los estudiantes solo pueden publicar o editar reseñas de libros para los que hayan enviado una solicitud de préstamo.

Al eliminar una reseña, el historial de administración conserva el comentario y el nombre de alumno que tenía asociado para poder consultarlos después. Como esta versión no tiene autenticación, el nombre de estudiante configurado actualmente es genérico.

Cada reseña eliminada también recibe un ticket de moderación imprimible, disponible desde la columna Ticket del historial.

La lista de préstamos en administración muestra solo préstamos vigentes y solo administración puede registrar devoluciones. Al hacerlo, el ejemplar vuelve al inventario y los contadores se actualizan; los préstamos devueltos se conservan en el historial del estudiante.

En el panel del estudiante, los préstamos devueltos se identifican como libros leídos. El contador de libros leídos muestra los títulos únicos y permite volver a solicitar cualquier libro que siga en el catálogo y tenga ejemplares disponibles.

Este modo es solo para desarrollo y pruebas: las páginas y los datos del navegador no están protegidos para producción. No uses información personal. La autenticación, el servidor y la base de datos se incorporarán más adelante.

## API del catálogo histórico CRA

La carpeta `api` contiene un servicio HTTP que consulta el archivo público del Catálogo Histórico de Bibliotecas Escolares CRA publicado por Mineduc. El catálogo incluye registros bibliográficos hasta 2025; no corresponde al inventario privado ni a los préstamos de un establecimiento en SGB-CRA.

Para iniciar el servicio, entra a `api`, ejecuta `npm install` y luego `npm start`. El servidor escucha en `http://localhost:3000` (puedes cambiar el puerto con la variable `PORT`). La primera consulta descarga el Excel oficial y lo mantiene en memoria por 24 horas.

Endpoints:

- `GET /api/libros/{isbn}`: busca un ISBN de 10 o 13 caracteres; también acepta guiones y espacios.
- `GET /api/libros?isbn={isbn}`: la misma búsqueda mediante query string.
- `GET /api/health`: estado del servicio y fecha de la última carga del catálogo.

La respuesta contiene `cantidad`, `libros` (con las columnas bibliográficas del Excel) y `fuente`. Cada resultado indica `isbnSolicitado`, `isbnCoincidente` y si fue una coincidencia exacta o por ISBN alternativo. Por ejemplo, la ficha digital `9788427725577` también se busca como la edición impresa CRA `9788427725560`. Si no aparece ningún ISBN exacto o alternativo configurado, `cantidad` será `0` y `libros` estará vacío. Ejemplo: `http://localhost:3000/api/libros/9789560000000`.

En administración, el formulario **Registrar libro** permite escanear el ISBN con la cámara, buscarlo en CRA y ver una vista previa EAN-13 debajo del ISBN. El botón **Escanear código de barras** del inventario consulta el ISBN leído en CRA y muestra todos los campos bibliográficos disponibles, además de los datos locales de existencias cuando el libro ya está registrado. Los tickets muestran los datos del préstamo o devolución, sin código de barras. Administración puede aprobar solicitudes de devolución directamente; también puede registrar una devolución desde el detalle del préstamo, sin escaneo.

Las fichas muestran editorial y año de edición cuando están registrados. Administración puede filtrar el catálogo estudiantil y su inventario por editorial, y editar el año en la ficha del libro. Los registros antiguos sin año muestran “sin registrar” hasta que el equipo agregue el dato.

Para escanear ISBN en el formulario de administración, sirve la carpeta del proyecto desde localhost: en la raíz ejecuta `python -m http.server 8000` y abre `http://localhost:8000/admin.html`. El navegador solicitará permiso para usar la cámara. Si no tiene `BarcodeDetector`, la app carga el lector ZXing desde un CDN, por lo que necesita conexión a internet; si la descarga falla, puedes usar un lector USB o ingresar el ISBN manualmente. La API CRA debe estar iniciada para buscar datos bibliográficos; el registro de devolución usa los préstamos locales de la app.
