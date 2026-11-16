# Biblioteca Escolar JMC

## Ejecutar en local

Usa Node.js 24 LTS actualizado. El proyecto usa el módulo SQLite incluido en Node.js y no requiere instalar paquetes.

1. Desde la carpeta del proyecto, ejecuta `node server/create-user.mjs` en una terminal interactiva. Repite el comando para crear las cuentas que quieras probar.

   | Rol en la terminal | Identificador | Acceso en la página |
   | --- | --- | --- |
   | `student` | RUT con dígito verificador | Catálogo, solicitudes, préstamos propios y reseñas |
   | `teacher` | Dirección `@gmail.com` | Consulta, publicación y edición de reseñas propias |
   | `admin` | Correo electrónico | Inventario, préstamos, peticiones, reseñas, moderación e historial |

   Ingresa una contraseña exclusiva para la biblioteca, de al menos 12 caracteres. El comando la solicita dos veces con entrada oculta.

2. Ejecuta `node server/index.mjs` y deja la terminal abierta.
3. Abre [Estudiantes](http://127.0.0.1:3000/estudiantes.html) o [Profesores y administración](http://127.0.0.1:3000/admin.html). En el segundo acceso, selecciona el tipo de cuenta. Para cambiar de perfil dentro del mismo navegador, cierra sesión primero.

El servidor escucha en `127.0.0.1`. Puedes definir `BIBLIOTECA_PORT` para usar otro puerto. Para probar el diseño móvil en el mismo equipo, activa la emulación móvil en las herramientas del navegador.

## Probar las mejoras

Ejecuta `node --test` para verificar los flujos de la API con una base temporal.

| Mejora | Prueba manual |
| --- | --- |
| Filtros de opiniones | Publica reseñas con distintas calificaciones y abre **Mi panel → Opiniones de la comunidad**. Filtra por libro, prueba los tres órdenes, selecciona un título sin reseñas y pulsa **Restablecer filtros**. |
| Catálogo desplazable | Agrega libros desde el inventario hasta superar el alto del listado. En **Catálogo**, llega al último libro usando la rueda o el teclado. Repite en emulación móvil con desplazamiento táctil. |
| Inicio de sesión | Ingresa con el mismo RUT con y sin puntos. Usa mayúsculas en la dirección de Gmail de un profesor y luego prueba un correo con otro dominio. En una cuenta de prueba, haz cinco intentos incorrectos y comprueba que el siguiente quede bloqueado durante 15 minutos. También se limita el origen tras 25 intentos fallidos dentro de la misma ventana. |
| Historial | Como administrador, crea, edita y elimina un libro, y elimina una reseña. En **Historial de acciones**, revisa la fecha y hora de Chile, la acción, el elemento y la identidad de la cuenta. Entra como profesor y comprueba que el historial no aparece. |
| Filtro de lenguaje | Intenta publicar una reseña con una expresión de la lista. Corrige el comentario y publícalo. Luego edítalo, repite la prueba y comprueba que el texto original sigue publicado mientras la edición esté rechazada. |
| Persistencia | Detén el servidor con `Ctrl+C` y vuelve a iniciarlo. Comprueba que siguen las cuentas, los cambios del catálogo, las reseñas y el historial. |

## Almacenamiento y configuración

- `server/storage.mjs` implementa `createRepository()`. Por defecto, guarda la base en `.biblioteca/biblioteca.sqlite`. Si defines `BIBLIOTECA_DATA_FILE`, el servidor y el comando de creación de cuentas deben usar el mismo valor.
- Para conectar otra base de datos, adapta `read()` y `update(mutator)` en el repositorio. `read()` devuelve un estado independiente y `update()` aplica los cambios de forma atómica. El adaptador puede volver a ejecutar el mutador si hay una escritura concurrente. El servidor inyecta el repositorio en `server/auth.mjs` y `server/library.mjs`, que contienen la autenticación, los permisos y las validaciones. Las pantallas consumen la API en `server/http.mjs`.
- `config/prohibited-expressions.json` contiene la lista de expresiones del filtro. Edita el arreglo JSON y reinicia el servidor para cargar los cambios. Se comparan palabras y frases completas sin distinguir mayúsculas ni tildes.
- La base se inicializa con los seis libros de muestra. Los datos de la versión anterior siguen en el `localStorage` del navegador donde se usó y requieren una migración explícita para incorporarse a SQLite.
