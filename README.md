# Subir a GitHub (PWA)

Web app instalable para subir fotos, videos y documentos a GitHub desde el celular.
No tiene servidor ni dependencias: son archivos estáticos.

## Cómo publicarla (GitHub Pages)

1. Crea un repositorio **público** aparte, por ejemplo `subir-archivos-app`. Aquí NO se guarda ningún secreto: el token lo escribes tú en el celular.
2. Sube estos archivos a la raíz del repositorio: `index.html`, `app.js`, `sw.js`, `manifest.webmanifest` y los tres `.png`.
3. En Settings → Pages, elige "Deploy from a branch", rama `main`, carpeta `/ (root)`.
4. Abre `https://TU_USUARIO.github.io/subir-archivos-app/` en Safari (iPhone) o Chrome (Android).
5. Instálala: en iPhone, Compartir → "Añadir a pantalla de inicio"; en Android, menú → "Instalar app".

## Configuración dentro de la app

- **Usuario / Repositorio**: el repositorio PRIVADO donde guardarás tus archivos (distinto del que aloja la app).
- **Rama**: normalmente `main`.
- **Carpeta base (opcional)**: si la dejas vacía, las carpetas se crean en la raíz del repositorio.
- **Token**: fine-grained, limitado a ese único repositorio, con permiso **Contents: Read and write**.

Usa "Probar conexión" para comprobar que el token funciona y tiene permiso de escritura.

## Cómo decide dónde sube

Todo se guarda en el repositorio, ordenado por tipo y mes, con un commit por archivo:
`fotos/2026-10/…`, `videos/2026-10/…`, `audios/2026-10/…` y `documentos/2026-10/…`.

### Archivos grandes: se dividen en partes

- Hasta 15 MB: se suben directo.
- Más de 15 MB (hasta 500 MB): se dividen en partes de 10 MB dentro de una carpeta
  `<nombre>.partes/` con `parte001`, `parte002`, … más dos archivos de ayuda:
  - `LEEME-UNIR.txt`: los comandos exactos para unir las partes (Windows, Mac y Linux).
  - `manifest.json`: el índice que usa la app para unirlas sola.
- Si una subida se corta, al pulsar **Subir** de nuevo continúa desde la parte donde quedó.

Para recuperar el archivo completo:
- **Con la app:** sección «Archivos divididos» → Buscar → Descargar (mejor desde un computador).
- **Con comandos:** descarga todas las partes en una carpeta y ejecuta, dentro de ella,
  Windows (cmd): `copy /b parte* "archivo.pdf"`; Mac o Linux: `cat parte* > "archivo.pdf"`.
  El comando con el nombre real del archivo está en `LEEME-UNIR.txt`.

Un repositorio con muchos archivos pesados crece rápido; GitHub recomienda mantenerlo por debajo de 1 GB.
(Las subidas por el sistema de Releases de GitHub no funcionan desde el navegador, por eso no se usan.)

Cada archivo se renombra con fecha y hora para evitar choques de nombre.

## Notas

- El token se guarda solo en el almacenamiento local del navegador de ese dispositivo. Si pierdes el celular, revócalo en GitHub.
- En un repositorio privado, los enlaces de los archivos solo abren con tu sesión de GitHub iniciada.
- El repositorio de la app puede ser público sin riesgo, porque el código no contiene credenciales.
