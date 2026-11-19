# Biblioteca Escolar JMC

## Abrir la aplicación

La aplicación funciona completamente en el navegador, sin servidor ni instalación de dependencias. Abre `estudiantes.html` o `admin.html` directamente en tu navegador.

El inicio de sesión está desactivado temporalmente para la integración de autenticación. Cada página abre automáticamente el perfil demo de su rol; por lo tanto, administración no está protegida y cualquier persona que acceda a ella puede modificar los datos locales. No uses este modo en producción ni guardes información real.

Las cuentas de prueba están definidas en `data.js`:

| Acceso | Identificador | Contraseña |
| --- | --- | --- |
| Estudiante | `99.999.999-9` | `5nLrX_Z4zux3-gdQ` |
| Administrador | `admin@demo.example` | `9p94fwf6JT11Bg3F` |

El catálogo inicial y la lista de expresiones prohibidas también están en `data.js`. Modifica ese archivo para cambiar los datos que se cargan en un navegador por primera vez.

## Datos locales

La aplicación guarda cuentas, catálogo, reseñas, préstamos, peticiones e historial en `localStorage` del navegador. Cada pestaña mantiene su inicio de sesión independiente mediante `sessionStorage`, así que puedes tener abiertas a la vez las páginas de estudiante y administración. Los datos se comparten entre pestañas del mismo navegador, pero no se sincronizan entre equipos. Las nuevas cuentas que agregues a `demoAccounts` se incorporan automáticamente al abrir la app. Para restablecer los datos iniciales, borra el almacenamiento local de la biblioteca o abre la aplicación en un perfil de navegador nuevo.

Al solicitar un préstamo, el estudiante puede elegir la devolución entre hoy y los próximos 14 días y pedir opcionalmente un ticket físico. El ticket, con identificador único, se genera al aprobar la petición y puede consultarse e imprimirse desde administración. El envío de comprobantes por correo requiere un backend y un proveedor de correo; esta versión local no envía emails.

La lista de préstamos en administración muestra solo préstamos vigentes. Al registrar una devolución, el ejemplar vuelve al inventario y los contadores se actualizan; los préstamos devueltos se conservan en el historial del estudiante.

Este modo es solo para desarrollo y pruebas: las cuentas y contraseñas demo están incluidas en archivos JavaScript públicos, y los datos del navegador no están protegidos para producción. No uses contraseñas reales ni información personal. El servidor y la base de datos se incorporarán más adelante.
