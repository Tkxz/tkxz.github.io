# Biblioteca Escolar JMC

## Abrir la aplicación

La aplicación funciona completamente en el navegador, sin servidor ni instalación de dependencias. Abre `estudiantes.html` o `admin.html` directamente en tu navegador.

Las cuentas de prueba están definidas en `data.js`:

| Acceso | Identificador | Contraseña |
| --- | --- | --- |
| Estudiante | `99.999.999-9` | `5nLrX_Z4zux3-gdQ` |
| Administrador | `admin@demo.example` | `9p94fwf6JT11Bg3F` |

El catálogo inicial y la lista de expresiones prohibidas también están en `data.js`. Modifica ese archivo para cambiar los datos que se cargan en un navegador por primera vez.

## Datos locales

La aplicación guarda cuentas, catálogo, reseñas, préstamos, peticiones e historial en `localStorage` del navegador. Cada pestaña mantiene su inicio de sesión independiente mediante `sessionStorage`, así que puedes tener abiertas a la vez las páginas de estudiante y administración. Los datos se comparten entre pestañas del mismo navegador, pero no se sincronizan entre equipos. Las nuevas cuentas que agregues a `demoAccounts` se incorporan automáticamente al abrir la app. Para restablecer los datos iniciales, borra el almacenamiento local de la biblioteca o abre la aplicación en un perfil de navegador nuevo.

Este modo es solo para desarrollo y pruebas: las cuentas y contraseñas demo están incluidas en archivos JavaScript públicos, y los datos del navegador no están protegidos para producción. No uses contraseñas reales ni información personal. El servidor y la base de datos se incorporarán más adelante.
