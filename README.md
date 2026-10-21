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
- **Etiqueta del release**: para videos y archivos grandes (por defecto `media`). Si no existe, la app la crea.
- **Token**: fine-grained, limitado a ese único repositorio, con permiso **Contents: Read and write**.

Usa "Probar conexión" para comprobar que el token funciona y tiene permiso de escritura.

## Cómo decide dónde sube

- Fotos y documentos de hasta 25 MB: se guardan en el repositorio, ordenados por tipo y mes, con un commit por archivo. Ejemplo: `fotos/2026-10/20261021-163005-1abc-playa.jpg` y `documentos/2026-10/...`.
- Videos y cualquier archivo de más de 25 MB: adjunto del release (hasta 2 GB por archivo). Los adjuntos no admiten carpetas, así que el tipo va al inicio del nombre: `videos-20261021-...mov`.

Cada archivo se renombra con fecha y hora para evitar choques de nombre.

## Notas

- El token se guarda solo en el almacenamiento local del navegador de ese dispositivo. Si pierdes el celular, revócalo en GitHub.
- En un repositorio privado, los enlaces de los archivos solo abren con tu sesión de GitHub iniciada.
- El repositorio de la app puede ser público sin riesgo, porque el código no contiene credenciales.
