# Google Apps Script · Formularios EL CENTRO

Sigue estos pasos para conectar los formularios con el Google Sheets mostrado en las capturas:

1. Abre el Google Sheets `EL CENTRO` y navega a **Extensiones → Apps Script**.
2. Elimina cualquier código existente y pega el script que encontrarás más abajo.
3. Guarda el proyecto, asígnale un nombre (por ejemplo `formularios-latata`) y presiona **Deploy → New deployment**.
4. Selecciona **Web app**, elige *Anyone* o *Anyone with the link* para permitir que Vercel acceda, y copia la URL pública.
5. Sustituye la constante `window.APPS_SCRIPT_URL` en `index.html` con la URL copiada.

> Si actualizas el script en el futuro, recuerda crear un nuevo deployment o actualizar el existente para que mantenga la misma URL.

## Código del Apps Script

```javascript
const CONFIG = {
  spreadsheetId: '1qwCi8PvocqX7f0K2X8YcdlG4bST9BK_RChiRbbdoRLE',
  mainSheetName: 'DATA',
  catalogSheetName: 'PRODUCTOS',
  timeZone: Session.getScriptTimeZone() || 'America/Caracas',
  columns: {
    hora: 1,
    fecha: 2,
    familia: 3,
    codigo: 4,
    unidad: 5,
    producto: 6,
    sede: 7,
    cantidadSolicitada: 8,
    responsableSolicitud: 9,
    cantidadEntregada: 10,
    responsableEntrega: 11,
    merma: 12,
    mes: 13,
    timestamp: 14,
  },
};

function doGet(e) {
  const action = String(e?.parameter?.action || '').toLowerCase();
  try {
    if (action === 'getproducts') {
      const products = getProducts_();
      return buildResponse_(true, { products }, 'Catálogo sincronizado.');
    }

    if (!action || action === 'ping') {
      return buildResponse_(true, { ok: true }, 'Servicio disponible.');
    }

    return buildResponse_(false, null, 'Acción GET no soportada.');
  } catch (error) {
    return buildResponse_(false, null, error.message);
  }
}

function doPost(e) {
  try {
    const { action, payload } = parseBody_(e);
    const normalizedAction = String(action || '').toLowerCase();
    const result = withLock_(() => handleAction_(normalizedAction, payload || {}));
    return buildResponse_(true, result.data, result.message);
  } catch (error) {
    return buildResponse_(false, null, error.message);
  }
}

function handleAction_(action, payload) {
  switch (action) {
    case 'createsolicitud': {
      const data = createSolicitud_(payload);
      return { data, message: 'Solicitudes de Sedes registradas.' };
    }
    case 'recordentrega': {
      const data = recordEntrega_(payload);
      return { data, message: `Entregado a Sedes procesado: ${data.processed}` };
    }
    case 'recordmerma': {
      const data = recordMerma_(payload);
      return { data, message: `Producción registrada: ${data.processed}` };
    }
    default:
      throw new Error('Acción POST no soportada.');
  }
}

function createSolicitud_(payload) {
  validateRequired_(payload, ['hora', 'fecha', 'sede', 'responsable']);
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) throw new Error('Debes enviar al menos un producto.');

  const registroAutomatico = new Date();

  const sanitizedItems = sanitizeSolicitudItems_(items);
  const sheet = getMainSheet_();
  const rows = sanitizedItems.map((item) => [
    payload.hora,
    payload.fecha,
    '',
    item.code,
    item.unit,
    item.description,
    payload.sede,
    item.quantity,
    payload.responsable,
    '',
    '',
    '',
    '',
    registroAutomatico,
  ]);

  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  return { rowsInserted: rows.length };
}

// Garantiza que cada producto tenga datos mínimos antes de insertar filas.
function sanitizeSolicitudItems_(items) {
  return items.map((item, index) => {
    const code = String(item.code || '').trim();
    const description = String(item.description || '').trim();
    const unit = String(item.unit || '').trim();
    const quantity = Number(item.quantity);
    const label = code || description || `#${index + 1}`;

    if (!code) {
      throw new Error(`El producto ${label} necesita un código.`);
    }

    if (!description) {
      throw new Error(`El producto ${label} necesita una descripción.`);
    }

    if (!unit) {
      throw new Error(`La unidad del producto ${label} es obligatoria.`);
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`La cantidad solicitada de ${label} debe ser mayor a cero.`);
    }

    return { code, description, unit, quantity };
  });
}

function recordEntrega_(payload) {
  validateRequired_(payload, ['fecha', 'sede', 'responsableEntrega']);
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) {
    throw new Error('Debes enviar al menos un producto.');
  }

  const sheet = getMainSheet_();
  const summary = { processed: 0, updated: 0, appended: 0 };

  items.forEach((item) => {
    const qty = Number(item.cantidadEntregada) || 0;
    if (qty <= 0) {
      throw new Error(`La cantidad entregada debe ser mayor a cero (${item.productCode || 'sin código'}).`);
    }

    if (payload.sinSolicitud) {
      appendEntregaSinSolicitud_(sheet, payload, item, qty);
    } else {
      appendEntregaDirecta_(sheet, payload, item, qty);
    }

    summary.appended += 1;
    summary.processed += 1;
  });

  return summary;
}

function appendEntregaDirecta_(sheet, payload, item, qty) {
  const row = [
    payload.hora || '',
    payload.fecha || '',
    '',
    item.productCode || '',
    item.unit || '',
    item.productName || '',
    payload.sede || '',
    '',
    '',
    qty,
    payload.responsableEntrega || '',
    '',
    '',
    new Date(),
  ];
  sheet.appendRow(row);
  return sheet.getLastRow();
}

function appendEntregaSinSolicitud_(sheet, payload, item, qty) {
  const row = [
    payload.hora || '',
    payload.fecha || '',
    '',
    item.productCode || '',
    item.unit || '',
    item.productName || '',
    payload.sede || '',
    '',
    'SIN SOLICITUD',
    qty,
    payload.responsableEntrega || '',
    '',
    '',
    new Date(),
  ];
  sheet.appendRow(row);
  return sheet.getLastRow();
}

function appendMermaSinSolicitud_(sheet, payload, item, qty) {
  const row = [
    payload.hora || '',
    payload.fecha || '',
    '',
    item.productCode || '',
    item.unit || '',
    item.productName || '',
    payload.sede || '',
    '',
    'SIN SOLICITUD',
    '',
    '',
    qty,
    '',
    new Date(),
  ];
  sheet.appendRow(row);
  return sheet.getLastRow();
}

function recordMerma_(payload) {
  validateRequired_(payload, ['fecha', 'sede']);
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) {
    throw new Error('Debes enviar al menos un producto.');
  }

  const sheet = getMainSheet_();
  const summary = { processed: 0, updated: 0, appended: 0 };
  items.forEach((item) => {
    const qty = Number(item.cantidadMerma) || 0;
    if (qty <= 0) {
      throw new Error(`La merma debe ser mayor a cero (${item.productCode || 'sin código'}).`);
    }

    appendMermaDirecta_(sheet, payload, item, qty);
    summary.appended += 1;
    summary.processed += 1;
  });

  return summary;
}

function appendMermaDirecta_(sheet, payload, item, qty) {
  const row = [
    payload.hora || '',
    payload.fecha || '',
    '',
    item.productCode || '',
    item.unit || '',
    item.productName || '',
    payload.sede || '',
    '',
    'SIN SOLICITUD',
    '',
    '',
    qty,
    '',
    new Date(),
  ];
  sheet.appendRow(row);
  return sheet.getLastRow();
}

function getProducts_() {
  const sheet = getSpreadsheet_().getSheetByName(CONFIG.catalogSheetName);
  if (!sheet) throw new Error('No se encontró la pestaña PRODUCTOS.');
  const values = sheet.getDataRange().getValues();
  const [, ...rows] = values;
  return rows
    .filter((row) => row[0] && row[1])
    .map((row) => ({
      code: String(row[0]).trim(),
      description: String(row[1]).trim(),
      unit: String(row[2] || '').trim() || 'UND',
    }));
}

function parseBody_(e) {
  if (!e?.postData?.contents) throw new Error('Cuerpo vacío.');
  return JSON.parse(e.postData.contents);
}

function getSpreadsheet_() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  if (!ss) throw new Error('No se pudo abrir el Spreadsheet.');
  return ss;
}

function getMainSheet_() {
  const sheet = getSpreadsheet_().getSheetByName(CONFIG.mainSheetName);
  if (!sheet) throw new Error('No se encontró la pestaña principal.');
  return sheet;
}

function withLock_(callback) {
  const lock = getSafeLock_();
  lock.waitLock(20000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function getSafeLock_() {
  try {
    const docLock = LockService.getDocumentLock();
    if (docLock) {
      return docLock;
    }
  } catch (error) {
    // Sigue con el ScriptLock si el documento no existe (script standalone)
  }
  return LockService.getScriptLock();
}

function validateRequired_(payload, fields) {
  fields.forEach((field) => {
    const value = payload[field];
    const isString = typeof value === 'string';
    const normalized = isString ? value.trim() : value;
    if (isString) {
      payload[field] = normalized;
    }
    if (normalized === undefined || normalized === null) {
      throw new Error(`El campo ${field} es obligatorio.`);
    }
    if (typeof normalized === 'string' && normalized === '') {
      throw new Error(`El campo ${field} es obligatorio.`);
    }
  });
}

function normalizeDate_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, CONFIG.timeZone, 'yyyy-MM-dd');
  }
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(text)) {
    const [day, month, year] = text.split('/');
    return `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return text;
}

function normalizeText_(value) {
  return String(value || '').trim().toUpperCase();
}

function buildResponse_(success, data, message) {
  return ContentService.createTextOutput(
    JSON.stringify({ success, data, message })
  ).setMimeType(ContentService.MimeType.JSON);
}
```

> El script utiliza `LockService` para evitar que dos usuarios escriban al mismo tiempo y se basa en la combinación `Fecha + Sede + Código` para ubicar las filas. Ajusta los nombres de las pestañas o columnas dentro del objeto `CONFIG` si tu hoja cambia en el futuro.
