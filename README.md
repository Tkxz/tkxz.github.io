# Biblioteca Escolar JMC

## Abrir la aplicación

La aplicación funciona completamente en el navegador, sin servidor ni instalación de dependencias. Abre `estudiantes.html` o `admin.html` directamente en tu navegador.

La autenticación aún no está configurada. La página de estudiantes y la de administración cargan directamente su vista local correspondiente; mientras no se integre el acceso, la administración no está protegida.

El catálogo inicial y la lista de expresiones prohibidas también están en `data.js`. Modifica ese archivo para cambiar los datos que se cargan en un navegador por primera vez.

## Datos locales

La aplicación guarda el catálogo, reseñas, préstamos, peticiones e historial en `localStorage` del navegador. Los datos se comparten entre las páginas del mismo navegador, pero no se sincronizan entre equipos. Para restablecer los datos iniciales, borra el almacenamiento local de la biblioteca o abre la aplicación en un perfil de navegador nuevo.

Al solicitar un préstamo, el estudiante puede elegir la devolución entre hoy y los próximos 14 días y pedir opcionalmente un ticket físico. El ticket, con identificador único, se genera al aprobar la petición y puede consultarse e imprimirse desde administración, tanto en los préstamos como en el historial de acciones. El envío de comprobantes por correo requiere un backend y un proveedor de correo; esta versión local no envía emails.

Al registrar un préstamo desde administración también se puede generar e imprimir el ticket en ese momento. Los estudiantes solo pueden publicar o editar reseñas de libros para los que hayan enviado una solicitud de préstamo.

Al eliminar una reseña, el historial de administración conserva el comentario y el nombre de alumno que tenía asociado para poder consultarlos después. Como esta versión no tiene autenticación, el nombre de estudiante configurado actualmente es genérico.

Cada reseña eliminada también recibe un ticket de moderación imprimible, disponible desde la columna Ticket del historial.

La lista de préstamos en administración muestra solo préstamos vigentes. Al registrar una devolución, el ejemplar vuelve al inventario y los contadores se actualizan; los préstamos devueltos se conservan en el historial del estudiante.

Este modo es solo para desarrollo y pruebas: las páginas y los datos del navegador no están protegidos para producción. No uses información personal. La autenticación, el servidor y la base de datos se incorporarán más adelante.
