# Verificador de Identidad (estático, sin Actions)

**Cómo publicarlo sin instalar nada:**

1. Crea un repositorio en GitHub (vacío) con nombre `verificador-id`.
2. Pulsa **Upload files** y arrastra **el CONTENIDO** de esta carpeta (no la carpeta en sí):
   - `index.html`, `styles.css`, `app.js`, `manifest.json`, `sw.js`, `robots.txt`, `LICENSE`, `README.md`, carpeta `data/` y `libs/`.
3. Ve a **Settings → Pages**:
   - **Source: Deploy from a branch**
   - **Branch: main** y **Folder: /(root)** → Save
4. Espera 1–3 min; tu web será: `https://TU-USUARIO.github.io/verificador-id/`.

Si prefieres usar **GitHub Actions** más tarde, puedes añadir `.github/workflows/pages.yml`.
