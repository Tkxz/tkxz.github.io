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

La aplicación guarda cuentas, catálogo, reseñas, préstamos, peticiones e historial en `localStorage` del navegador. Los cambios permanecen en ese perfil de navegador y no se sincronizan entre equipos. Para volver a cargar las cuentas y el catálogo inicial, borra los datos locales de la biblioteca en el navegador o abre la aplicación en un perfil de navegador nuevo.

Este modo es solo para desarrollo y pruebas: las cuentas y contraseñas demo están incluidas en archivos JavaScript públicos, y los datos del navegador no están protegidos para producción. No uses contraseñas reales ni información personal. El servidor y la base de datos se incorporarán más adelante.

## Pruebas

Con Node.js 24 o superior, ejecuta `node --test` para comprobar los flujos locales de inicio de sesión, persistencia, préstamos, reseñas y permisos.
