# Formularios · EL CENTRO

Implementación estática (HTML/CSS/JS) para administrar los formularios de **Solicitudes de Sedes**, **Entregado a Sedes** y **Merma de Producción** de productos terminados conectados a la hoja de cálculo proporcionada. El proyecto replica la interfaz del formulario de inventario existente e incluye un catálogo sincronizado desde la pestaña `PRODUCTOS` del mismo Google Sheets.

## Contenido

- `index.html`: estructura y vistas del panel (menú, formularios y catálogo).
- `styles.css`: estilos con la línea gráfica usada previamente.
- `script.js`: lógica para navegación, catálogo, formularios y comunicación con Apps Script.
- `GOOGLE_APPS_SCRIPT.md`: instrucciones del Apps Script que se despliega junto al Sheets.
- `vercel.json`: configuración mínima para desplegar el sitio estático en Vercel.

## Requisitos previos

1. Google Sheets con las pestañas `EL CENTRO` y `PRODUCTOS` (ya configuradas con las columnas mostradas en las capturas). El Apps Script creara la pestaña `USUARIOS` automaticamente.
2. Apps Script desplegado como **Web App** con acceso "Anyone" o "Anyone with the link".
3. URL pública del Web App copiada en la constante `window.APPS_SCRIPT_URL` ubicada al final de `index.html`.

```html
<script>
  window.APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxz04-8iX-_WbiesS0Et1IcsMAzY1-LBjYwk0j2k36SinN4qKPnan3SaFim-qvJUjLA/exec';
</script>
```

> **Tip:** si usarás entornos de Vercel, crea un archivo `app-config.js` o script inline diferente para no versionar la URL productiva.

## Cómo ejecutar localmente

1. Instala dependencias opcionales para servir archivos estáticos (por ejemplo `npm install -g serve`).
2. En la raíz del proyecto, ejecuta `serve .` o usa cualquier servidor HTTP simple. Abrir `index.html` directamente con `file://` puede bloquear las peticiones `fetch` al Apps Script.
3. Asegúrate de haber pegado la URL del Apps Script antes de probar los formularios.
4. Verifica `TU_URL/exec?action=authVersion`; debe responder `20260730-users-sheet-v5`.

## Control de acceso

- El administrador inicial es `ADMIN` con contrasena `aeiou12345`.
- Los usuarios nuevos se crean desde la pantalla inicial y quedan pendientes.
- El campo `USUARIO` acepta cualquier texto no vacio, sin formato obligatorio.
- Multiples dispositivos pueden iniciar sesion con el mismo `USUARIO` al mismo tiempo.
- La pestaña `USUARIOS` no usa columna `NOMBRE`; el identificador es `USUARIO`.
- Estructura creada por Apps Script: `USUARIO | PASSWORD_HASH | SALT | ROL | ACCESO | FECHA_CREACION`.
- Solo `ADMIN` ve la vista `Gestion de Usuarios` y puede crear usuarios, eliminar usuarios y prender/apagar `ACCESO`.
- Los usuarios creados desde `Gestion de Usuarios` quedan como `USER`; si el switch `Acceso` esta activo, pueden entrar inmediatamente.

## Flujo de cada formulario

- **Solicitudes de Sedes**: registra `Fecha, Hora, Sede, Responsable` y una lista dinámica de productos con cantidades solicitadas. Cada producto genera una fila nueva en la hoja con la columna *FAMILIA* vacía.
- **Entregado a Sedes**: busca una fila existente por combinación `Fecha + Sede + Código de producto` y actualiza `Cantidad Entregada` y `Responsable Entrega`. Si se marca "entrega sin solicitud", se crea una fila nueva con el texto `SIN SOLICITUD` en la columna de responsable de solicitud.
- **Merma de Producción**: busca la fila correspondiente (Fecha + Sede + Producto) y actualiza únicamente la columna `MERMA`. Actualmente solo están habilitadas las sedes `BC` y `LPG`.
- **Catálogo**: consulta la pestaña `PRODUCTOS` del Sheets y permite filtrar por código o descripción. Los datos se guardan en `localStorage` para cargar más rápido sin conexión.

## Despliegue en Vercel

1. Crea un nuevo proyecto en Vercel apuntando a este repositorio/carpeta.
2. Selecciona **Other** como framework (es un sitio estático). Vercel detectará `index.html` automáticamente.
3. Publica. Si necesitas diferentes URLs de Apps Script por ambiente, crea una rama por entorno y ajusta el valor de `window.APPS_SCRIPT_URL` antes de desplegar.

## Personalización

- Las sedes disponibles se definen en `script.js` (`const SEDES = [...]`).
- La paleta de colores y tipografía se controlan en `styles.css`.
- Puedes desactivar el cache local del catálogo quitando el uso de `localStorage` dentro de `script.js`.

Consulta `GOOGLE_APPS_SCRIPT.md` para ver cómo instalar/actualizar el backend en Apps Script.
