const CONFIG = {
  spreadsheetId: '1qwCi8PvocqX7f0K2X8YcdlG4bST9BK_RChiRbbdoRLE',
  mainSheetName: 'DATA',
  catalogSheetName: 'PRODUCTOS',
  timeZone: Session.getScriptTimeZone() || 'America/Caracas',
  lockWaitMs: 5000,
  duplicateLookbackRows: 600,
  requestCacheTtlSeconds: 21600,
  catalogCacheTtlSeconds: 300,
  auth: {
    version: '20260730-users-sheet-v3',
    userSheetName: 'USUARIOS',
    adminUsername: 'ADMIN',
    adminPassword: 'aeiou12345',
    sessionCachePrefix: 'auth-session:',
    sessionTtlSeconds: 21600,
    userColumns: {
      usuario: 1,
      passwordHash: 2,
      salt: 3,
      rol: 4,
      acceso: 5,
      fechaCreacion: 6,
    },
  },
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
    numeroEntrega: 15,
    observaciones: 16,
  },
};

function doGet(e) {
  const action = String(e?.parameter?.action || '').toLowerCase();
  try {
    if (action === 'authversion') {
      ensureUsersSheet_();
      return buildResponse_(true, {
        version: CONFIG.auth.version,
        userSheetName: CONFIG.auth.userSheetName,
        supportsLogin: true,
      }, 'Backend de usuarios disponible.');
    }

    if (action === 'diagnose') {
      const report = diagnoseAccess_();
      return buildResponse_(true, { report }, 'Diagnóstico completado.');
    }

    if (action === 'getproducts') {
      requireAllowedUser_(String(e?.parameter?.token || ''));
      const products = getProducts_({ bypassCache: String(e?.parameter?.force || '') === '1' });
      return buildResponse_(true, { products }, 'Catálogo sincronizado.');
    }

    if (!action || action === 'ping') {
      return buildResponse_(true, { ok: true }, 'Servicio disponible.');
    }

    return buildResponse_(false, null, 'Acción GET no soportada.');
  } catch (error) {
    return buildResponse_(false, null, normalizeAppErrorMessage_(error));
  }
}

function doPost(e) {
  try {
    const { action, payload } = parseBody_(e);
    const normalizedAction = String(action || '').toLowerCase();
    const safePayload = payload || {};
    const result = withLock_(() =>
      withRequestDedup_(normalizedAction, safePayload, () =>
        handleAction_(normalizedAction, safePayload)
      )
    );
    return buildResponse_(true, result.data, result.message);
  } catch (error) {
    return buildResponse_(false, null, normalizeAppErrorMessage_(error));
  }
}

function withRequestDedup_(action, payload, callback) {
  const requestId = sanitizeRequestId_(payload?.requestId);
  if (!requestId) {
    return callback();
  }

  const cachedResult = getProcessedRequest_(action, requestId);
  if (cachedResult) {
    return cachedResult;
  }

  const result = callback();
  rememberProcessedRequest_(action, requestId, result);
  return result;
}

function sanitizeRequestId_(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length > 120) return '';
  if (!/^[a-zA-Z0-9_\-:.]+$/.test(text)) return '';
  return text;
}

function getRequestCacheKey_(action, requestId) {
  return `req:${String(action || '').toLowerCase()}:${requestId}`;
}

function getProcessedRequest_(action, requestId) {
  try {
    const key = getRequestCacheKey_(action, requestId);
    const raw = CacheService.getScriptCache().get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function rememberProcessedRequest_(action, requestId, result) {
  try {
    const key = getRequestCacheKey_(action, requestId);
    CacheService.getScriptCache().put(
      key,
      JSON.stringify(result),
      CONFIG.requestCacheTtlSeconds
    );
  } catch (error) {
  }
}

function handleAction_(action, payload) {
  switch (action) {
    case 'login': {
      const data = loginUser_(payload);
      return { data, message: 'Acceso permitido.' };
    }
    case 'checksession': {
      const data = checkSession_(payload);
      return { data, message: 'Sesion valida.' };
    }
    case 'logout': {
      const data = logoutUser_(payload);
      return { data, message: 'Sesion cerrada.' };
    }
    case 'registeruser': {
      const data = registerUser_(payload);
      return { data, message: 'Usuario creado. Espera aprobacion del administrador.' };
    }
    case 'listusers': {
      requireAdmin_(payload.authToken);
      const data = listUsers_();
      return { data, message: 'Usuarios cargados.' };
    }
    case 'setuseraccess': {
      requireAdmin_(payload.authToken);
      const data = setUserAccess_(payload);
      return { data, message: 'Acceso actualizado.' };
    }
    case 'createsolicitud': {
      requireAllowedUser_(payload.authToken);
      const data = createSolicitud_(payload);
      return { data, message: 'Solicitudes de Sedes registradas.' };
    }
    case 'recordentrega': {
      requireAllowedUser_(payload.authToken);
      const data = recordEntrega_(payload);
      return { data, message: `Entregado a Sedes procesado: ${data.processed}` };
    }
    case 'recordmerma': {
      requireAllowedUser_(payload.authToken);
      const data = recordMerma_(payload);
      return { data, message: `Producción registrada: ${data.processed}` };
    }
    default:
      throw new Error('Acción POST no soportada.');
  }
}

function loginUser_(payload) {
  validateRequired_(payload, ['username', 'password']);
  const username = normalizeUsername_(payload.username);
  const password = String(payload.password || '');
  const user = findUserByUsername_(getUsers_(), username);

  if (!user || !verifyPassword_(password, user.passwordHash, user.salt)) {
    throw new Error('Usuario o contrasena incorrectos.');
  }
  if (!user.acceso) {
    throw new Error('Este usuario esta pendiente de aprobacion del administrador.');
  }

  return { session: createSession_(user) };
}

function checkSession_(payload) {
  const token = payload.token || payload.authToken;
  const user = requireAllowedUser_(token);
  return { session: buildSessionResponse_(token, user) };
}

function logoutUser_(payload) {
  const token = sanitizeToken_(payload.token || payload.authToken);
  if (token) {
    CacheService.getScriptCache().remove(CONFIG.auth.sessionCachePrefix + token);
  }
  return { ok: true };
}

function registerUser_(payload) {
  validateRequired_(payload, ['username', 'password']);
  const username = normalizeUsername_(payload.username);
  const password = String(payload.password || '');

  const users = getUsers_();
  if (findUserByUsername_(users, username)) {
    throw new Error('Ya existe un usuario con ese nombre de usuario.');
  }

  const salt = Utilities.getUuid();
  const now = new Date();
  const user = {
    usuario: username,
    passwordHash: hashPassword_(password, salt),
    salt,
    rol: 'USER',
    acceso: false,
    fechaCreacion: now,
  };

  appendUser_(user);
  return { user: sanitizeUserForClient_(user) };
}

function listUsers_() {
  return { users: getUsers_().map(sanitizeUserForClient_) };
}

function setUserAccess_(payload) {
  validateRequired_(payload, ['username']);
  const username = normalizeUsername_(payload.username);
  if (username === normalizeUsername_(CONFIG.auth.adminUsername)) {
    throw new Error('El usuario ADMIN siempre debe mantener acceso.');
  }

  const sheet = getUsersSheet_();
  const users = getUsers_();
  const user = findUserByUsername_(users, username);
  if (!user) {
    throw new Error('Usuario no encontrado.');
  }

  const rowNumber = findUserRowNumber_(sheet, username);
  if (!rowNumber) {
    throw new Error('No se encontro la fila del usuario.');
  }

  sheet.getRange(rowNumber, CONFIG.auth.userColumns.acceso).setValue(Boolean(payload.access));

  if (!payload.access) {
    revokeUserSessions_(username);
  }

  const updated = findUserByUsername_(getUsers_(), username);
  return { user: sanitizeUserForClient_(updated) };
}

function requireAdmin_(token) {
  const user = requireAllowedUser_(token);
  if (user.rol !== 'ADMIN') {
    throw new Error('Solo ADMIN puede realizar esta accion.');
  }
  return user;
}

function requireAllowedUser_(token) {
  const session = getValidSession_(token);
  if (!session) {
    throw new Error('Sesion invalida o expirada. Inicia sesion nuevamente.');
  }

  const user = findUserByUsername_(getUsers_(), session.username);
  if (!user || !user.acceso) {
    throw new Error('Tu acceso no esta permitido actualmente.');
  }
  return user;
}

function createSession_(user) {
  const token = Utilities.getUuid() + '-' + Utilities.getUuid();
  const session = {
    username: user.usuario,
    role: user.rol,
    expiresAt: Date.now() + CONFIG.auth.sessionTtlSeconds * 1000,
  };
  CacheService.getScriptCache().put(
    CONFIG.auth.sessionCachePrefix + token,
    JSON.stringify(session),
    CONFIG.auth.sessionTtlSeconds
  );
  return buildSessionResponse_(token, user, session.expiresAt);
}

function buildSessionResponse_(token, user, expiresAt) {
  return {
    token: sanitizeToken_(token),
    expiresAt: expiresAt || Date.now() + CONFIG.auth.sessionTtlSeconds * 1000,
    user: sanitizeUserForClient_(user),
  };
}

function getValidSession_(token) {
  const safeToken = sanitizeToken_(token);
  if (!safeToken) return null;
  try {
    const raw = CacheService.getScriptCache().get(CONFIG.auth.sessionCachePrefix + safeToken);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session || Number(session.expiresAt || 0) < Date.now()) return null;
    return session;
  } catch (error) {
    return null;
  }
}

function revokeUserSessions_(username) {
  // CacheService no permite listar llaves; las sesiones vigentes se invalidan al revalidar contra USUARIOS.
}

function getUsers_() {
  const sheet = getUsersSheet_();
  ensureAdminUser_(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet
    .getRange(2, 1, lastRow - 1, CONFIG.auth.userColumns.fechaCreacion)
    .getValues()
    .map(rowToUser_)
    .filter((user) => user.usuario);
}

function getUsersSheet_() {
  const sheet = ensureUsersSheet_();
  return sheet;
}

function ensureUsersSheet_() {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(CONFIG.auth.userSheetName);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.auth.userSheetName);
  }

  const headers = [
    'USUARIO',
    'PASSWORD_HASH',
    'SALT',
    'ROL',
    'ACCESO',
    'FECHA_CREACION',
  ];
  migrateUsersSheetToSingleAccess_(sheet);
  const existing = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const needsHeader = headers.some((header, index) => String(existing[index] || '').trim() !== header);
  if (needsHeader) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function migrateUsersSheetToSingleAccess_(sheet) {
  const oldHeaders = sheet.getRange(1, 1, 1, 7).getValues()[0].map((value) =>
    normalizeText_(value)
  );
  const hasOldBlockedColumn =
    oldHeaders[4] === 'PERMITIDO' &&
    oldHeaders[5] === 'BLOQUEADO' &&
    oldHeaders[6] === 'FECHA_CREACION';

  if (!hasOldBlockedColumn) {
    return;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const oldRows = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
    const migratedRows = oldRows.map((row) => [
      row[0],
      row[1],
      row[2],
      row[3],
      parseSheetBoolean_(row[4]) && !parseSheetBoolean_(row[5]),
      row[6],
    ]);
    sheet.getRange(2, 1, migratedRows.length, 6).setValues(migratedRows);
    sheet.getRange(2, 7, migratedRows.length, 1).clearContent();
  }
}

function ensureAdminUser_(sheet) {
  const adminUsername = normalizeUsername_(CONFIG.auth.adminUsername);
  const rowNumber = findUserRowNumber_(sheet, adminUsername);
  const salt = 'admin-default-salt';
  const admin = {
    usuario: adminUsername,
    passwordHash: hashPassword_(CONFIG.auth.adminPassword, salt),
    salt,
    rol: 'ADMIN',
    acceso: true,
    fechaCreacion: new Date(),
  };

  if (!rowNumber) {
    appendUser_(admin, sheet);
    return;
  }

  const current = rowToUser_(sheet.getRange(rowNumber, 1, 1, CONFIG.auth.userColumns.fechaCreacion).getValues()[0]);
  if (
    current.passwordHash !== admin.passwordHash ||
    current.salt !== admin.salt ||
    current.rol !== 'ADMIN' ||
    current.acceso !== true
  ) {
    sheet.getRange(rowNumber, 1, 1, CONFIG.auth.userColumns.fechaCreacion).setValues([userToRow_(admin)]);
  }
}

function appendUser_(user, existingSheet) {
  const sheet = existingSheet || getUsersSheet_();
  sheet.appendRow(userToRow_(user));
}

function findUserRowNumber_(sheet, username) {
  const normalizedUsername = normalizeUsername_(username);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const usernames = sheet.getRange(2, CONFIG.auth.userColumns.usuario, lastRow - 1, 1).getValues();
  const index = usernames.findIndex((row) => normalizeUsernameSafe_(row[0]) === normalizedUsername);
  return index >= 0 ? index + 2 : 0;
}

function rowToUser_(row) {
  return {
    usuario: normalizeUsernameSafe_(row[CONFIG.auth.userColumns.usuario - 1]),
    passwordHash: String(row[CONFIG.auth.userColumns.passwordHash - 1] || ''),
    salt: String(row[CONFIG.auth.userColumns.salt - 1] || ''),
    rol: normalizeRole_(row[CONFIG.auth.userColumns.rol - 1]),
    acceso: parseSheetBoolean_(row[CONFIG.auth.userColumns.acceso - 1]),
    fechaCreacion: row[CONFIG.auth.userColumns.fechaCreacion - 1] || '',
  };
}

function userToRow_(user) {
  return [
    user.usuario,
    user.passwordHash,
    user.salt,
    user.rol,
    Boolean(user.acceso),
    user.fechaCreacion || new Date(),
  ];
}

function findUserByUsername_(users, username) {
  const normalizedUsername = normalizeUsername_(username);
  return users.find((user) => user.usuario === normalizedUsername) || null;
}

function normalizeUsername_(value) {
  const username = String(value || '').trim();
  if (!username) {
    throw new Error('El usuario es obligatorio.');
  }
  return username;
}

function normalizeUsernameSafe_(value) {
  try {
    return normalizeUsername_(value);
  } catch (error) {
    return '';
  }
}

function normalizeRole_(value) {
  return String(value || '').trim().toUpperCase() === 'ADMIN' ? 'ADMIN' : 'USER';
}

function parseSheetBoolean_(value) {
  if (value === true) return true;
  const text = String(value || '').trim().toUpperCase();
  return ['TRUE', 'VERDADERO', 'SI', 'SÍ', '1', 'YES'].includes(text);
}

function sanitizeToken_(value) {
  const token = String(value || '').trim();
  if (!token || token.length > 120) return '';
  if (!/^[a-zA-Z0-9_-]+(?:-[a-zA-Z0-9_-]+)*$/.test(token)) return '';
  return token;
}

function sanitizeUserForClient_(user) {
  return {
    username: String(user.usuario || ''),
    role: String(user.rol || 'USER'),
    access: Boolean(user.acceso),
    createdAt: formatEmailValue_(user.fechaCreacion || ''),
  };
}

function hashPassword_(password, salt) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    `${String(salt || '')}:${String(password || '')}`
  );
  return bytes
    .map((byte) => {
      const normalized = byte < 0 ? byte + 256 : byte;
      return normalized.toString(16).padStart(2, '0');
    })
    .join('');
}

function verifyPassword_(password, expectedHash, salt) {
  if (!expectedHash || !salt) return false;
  return hashPassword_(password, salt) === String(expectedHash || '');
}

function createSolicitud_(payload) {
  validateRequired_(payload, ['hora', 'fecha', 'sede', 'responsable', 'correoResumen']);
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) throw new Error('Debes enviar al menos un producto.');
  const correoResumen = sanitizeEmail_(payload.correoResumen);

  const registroAutomatico = new Date();
  const productCatalogByCode = getProductCatalogByCode_();
  const mes = getMesDesdeFecha_(payload.fecha, registroAutomatico);

  const sanitizedItems = sanitizeSolicitudItems_(items);
  const sheet = getMainSheet_();
  if (isSolicitudDuplicate_(sheet, payload, sanitizedItems)) {
    throw new Error('Esta respuesta ya fue enviada. Verifica antes de reenviar.');
  }
  const rows = sanitizedItems.map((item) => [
    payload.hora,
    payload.fecha,
    getFamiliaByCode_(item.code, productCatalogByCode),
    item.code,
    item.unit,
    item.description,
    payload.sede,
    item.quantity,
    payload.responsable,
    '',
    '',
    '',
    mes,
    registroAutomatico,
    '',
    payload.observaciones || '',
  ]);

  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  const emailSummary = sendRegistrationSummaryEmail_({
    to: correoResumen,
    moduleName: 'Solicitudes de Sedes',
    subjectPrefix: 'Resumen de solicitud de sede',
    responsibleLabel: 'Responsable de solicitud',
    responsibleName: payload.responsable,
    date: payload.fecha,
    time: payload.hora,
    sede: payload.sede,
    observations: payload.observaciones || '',
    quantityLabel: 'Cantidad solicitada',
    items: sanitizedItems.map((item) => ({
      code: item.code,
      product: item.description,
      unit: item.unit,
      quantity: item.quantity,
    })),
  });
  return { rowsInserted: rows.length, emailSummary };
}

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
  validateRequired_(payload, ['fecha', 'sede', 'responsableEntrega', 'correoResumen']);
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) {
    throw new Error('Debes enviar al menos un producto.');
  }
  const correoResumen = sanitizeEmail_(payload.correoResumen);

  const sanitizedItems = sanitizeEntregaItems_(items);
  const sheet = getMainSheet_();
  const summary = { processed: 0, updated: 0, appended: 0 };
  const registroAutomatico = new Date();
  const productCatalogByCode = getProductCatalogByCode_();
  const mes = getMesDesdeFecha_(payload.fecha, registroAutomatico);
  const numeroEntrega = sanitizeNumeroEntrega_(payload.numeroEntrega);
  const sede = String(payload.sede || '').trim().toUpperCase();
  if (sede === 'BC' && !numeroEntrega) {
    throw new Error('Para la sede BC, el Número de Entrega es obligatorio.');
  }

  if (isEntregaDuplicate_(sheet, payload, sanitizedItems)) {
    throw new Error('Esta respuesta ya fue enviada. Verifica antes de reenviar.');
  }

  const rows = sanitizedItems.map((item) =>
    buildEntregaRow_(
      payload,
      item,
      item.cantidadEntregada,
      registroAutomatico,
      productCatalogByCode,
      mes,
      numeroEntrega
    )
  );

  batchAppendRows_(sheet, rows);
  summary.appended = rows.length;
  summary.processed = rows.length;
  summary.emailSummary = sendRegistrationSummaryEmail_({
    to: correoResumen,
    moduleName: 'Entregado a Sedes',
    subjectPrefix: 'Resumen de entrega a sede',
    responsibleLabel: 'Responsable de entrega',
    responsibleName: payload.responsableEntrega,
    date: payload.fecha,
    time: payload.hora || '',
    sede: payload.sede,
    numeroEntrega,
    observations: payload.observaciones || '',
    quantityLabel: 'Cantidad entregada',
    items: sanitizedItems.map((item) => ({
      code: item.productCode,
      product: item.productName,
      unit: item.unit,
      quantity: item.cantidadEntregada,
    })),
  });

  return summary;
}

function buildEntregaRow_(
  payload,
  item,
  qty,
  registroAutomatico,
  productCatalogByCode,
  mes,
  numeroEntrega
) {
  return [
    payload.hora || '',
    payload.fecha || '',
    getFamiliaByCode_(item.productCode, productCatalogByCode),
    item.productCode || '',
    item.unit || '',
    item.productName || '',
    payload.sede || '',
    '',
    '',
    qty,
    payload.responsableEntrega || '',
    '',
    mes,
    registroAutomatico || new Date(),
    numeroEntrega || '',
    payload.observaciones || '',
  ];
}

function sanitizeEntregaItems_(items) {
  return items.map((item, index) => {
    const productCode = String(item.productCode || '').trim();
    const productName = String(item.productName || '').trim();
    const unit = String(item.unit || '').trim();
    const cantidadEntregada = Number(item.cantidadEntregada);
    const label = productCode || productName || `#${index + 1}`;

    if (!productCode) {
      throw new Error(`El producto ${label} necesita un código.`);
    }
    if (!productName) {
      throw new Error(`El producto ${label} necesita una descripción.`);
    }
    if (!unit) {
      throw new Error(`La unidad del producto ${label} es obligatoria.`);
    }
    if (!Number.isFinite(cantidadEntregada) || cantidadEntregada <= 0) {
      throw new Error(`La cantidad entregada debe ser mayor a cero (${label}).`);
    }

    return { productCode, productName, unit, cantidadEntregada };
  });
}

function appendEntregaDirecta_(
  sheet,
  payload,
  item,
  qty,
  registroAutomatico,
  productCatalogByCode,
  mes,
  numeroEntrega
) {
  const row = [
    payload.hora || '',
    payload.fecha || '',
    getFamiliaByCode_(item.productCode, productCatalogByCode),
    item.productCode || '',
    item.unit || '',
    item.productName || '',
    payload.sede || '',
    '',
    '',
    qty,
    payload.responsableEntrega || '',
    '',
    mes,
    registroAutomatico || new Date(),
    numeroEntrega || '',
    payload.observaciones || '',
  ];
  sheet.appendRow(row);
  return sheet.getLastRow();
}

function sanitizeNumeroEntrega_(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const num = Number(raw);
  if (!Number.isInteger(num) || num < 1 || num > 10) {
    throw new Error('Número de Entrega inválido. Debe estar entre 1 y 10.');
  }
  return String(num);
}

function isSolicitudDuplicate_(sheet, payload, items) {
  if (!sheet || !items.length) return false;

  const rows = getTailRows_(sheet, CONFIG.duplicateLookbackRows);
  if (!rows.length) return false;

  const existingRowKeys = rows.reduce((acc, row) => {
    const key = buildDuplicateRowKey_({
      hora: row[CONFIG.columns.hora - 1],
      fecha: row[CONFIG.columns.fecha - 1],
      codigo: row[CONFIG.columns.codigo - 1],
      producto: row[CONFIG.columns.producto - 1],
      sede: row[CONFIG.columns.sede - 1],
      cantidadSolicitada: row[CONFIG.columns.cantidadSolicitada - 1],
      responsableSolicitud: row[CONFIG.columns.responsableSolicitud - 1],
      cantidadEntregada: row[CONFIG.columns.cantidadEntregada - 1],
      responsableEntrega: row[CONFIG.columns.responsableEntrega - 1],
    });
    acc[key] = true;
    return acc;
  }, {});

  return items.some((item) => {
    const incomingKey = buildDuplicateRowKey_({
      hora: payload.hora,
      fecha: payload.fecha,
      codigo: item.code,
      producto: item.description,
      sede: payload.sede,
      cantidadSolicitada: item.quantity,
      responsableSolicitud: payload.responsable,
      cantidadEntregada: '',
      responsableEntrega: '',
    });
    return Boolean(existingRowKeys[incomingKey]);
  });
}

function isEntregaDuplicate_(sheet, payload, items) {
  if (!sheet || !items.length) return false;

  const rows = getTailRows_(sheet, CONFIG.duplicateLookbackRows);
  if (!rows.length) return false;

  const existingRowKeys = rows.reduce((acc, row) => {
    const key = buildDuplicateRowKey_({
      hora: row[CONFIG.columns.hora - 1],
      fecha: row[CONFIG.columns.fecha - 1],
      codigo: row[CONFIG.columns.codigo - 1],
      producto: row[CONFIG.columns.producto - 1],
      sede: row[CONFIG.columns.sede - 1],
      cantidadSolicitada: row[CONFIG.columns.cantidadSolicitada - 1],
      responsableSolicitud: row[CONFIG.columns.responsableSolicitud - 1],
      cantidadEntregada: row[CONFIG.columns.cantidadEntregada - 1],
      responsableEntrega: row[CONFIG.columns.responsableEntrega - 1],
    });
    acc[key] = true;
    return acc;
  }, {});

  return items.some((item) => {
    const incomingKey = buildDuplicateRowKey_({
      hora: payload.hora || '',
      fecha: payload.fecha,
      codigo: item.productCode,
      producto: item.productName,
      sede: payload.sede,
      cantidadSolicitada: '',
      responsableSolicitud: '',
      cantidadEntregada: item.cantidadEntregada,
      responsableEntrega: payload.responsableEntrega,
    });
    return Boolean(existingRowKeys[incomingKey]);
  });
}

function buildDuplicateRowKey_(record) {
  return [
    normalizeHora_(record.hora),
    normalizeDate_(record.fecha),
    normalizeText_(record.codigo),
    normalizeText_(record.producto),
    normalizeText_(record.sede),
    normalizeNumber_(record.cantidadSolicitada),
    normalizeText_(record.responsableSolicitud),
    normalizeNumber_(record.cantidadEntregada),
    normalizeText_(record.responsableEntrega),
  ].join('||');
}

function normalizeHora_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, CONFIG.timeZone, 'HH:mm');
  }

  const text = String(value || '').trim();
  if (!text) return '';

  const match = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (match) {
    const hh = String(Math.max(0, Math.min(23, Number(match[1])))).padStart(2, '0');
    const mm = String(Math.max(0, Math.min(59, Number(match[2])))).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  return normalizeText_(text);
}

function normalizeNumber_(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  return String(num);
}

function getAllDataRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, CONFIG.columns.observaciones).getValues();
}

function getBatchId_(row, index) {
  const timestampValue = row[CONFIG.columns.timestamp - 1];
  const normalizedTimestamp = normalizeTimestamp_(timestampValue);
  if (normalizedTimestamp) {
    return normalizedTimestamp;
  }
  return `legacy-${index}`;
}

function normalizeTimestamp_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return String(value.getTime());
  }
  const text = String(value || '').trim();
  if (!text) return '';
  const parsed = new Date(text);
  if (!isNaN(parsed.getTime())) {
    return String(parsed.getTime());
  }
  return text;
}

function getTailRows_(sheet, count) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2 || count <= 0) return [];
  const totalDataRows = lastRow - 1;
  const rowsToRead = Math.min(count, totalDataRows);
  const startRow = lastRow - rowsToRead + 1;
  return sheet.getRange(startRow, 1, rowsToRead, CONFIG.columns.observaciones).getValues();
}

function appendMermaSinSolicitud_(sheet, payload, item, qty, productCatalogByCode, mes) {
  const row = [
    payload.hora || '',
    payload.fecha || '',
    getFamiliaByCode_(item.productCode, productCatalogByCode),
    item.productCode || '',
    item.unit || '',
    item.productName || '',
    payload.sede || '',
    '',
    'SIN SOLICITUD',
    '',
    '',
    qty,
    mes,
    new Date(),
    '',
    payload.observaciones || '',
  ];
  sheet.appendRow(row);
  return sheet.getLastRow();
}

function recordMerma_(payload) {
  validateRequired_(payload, ['fecha', 'sede', 'responsable', 'correoResumen']);
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) {
    throw new Error('Debes enviar al menos un producto.');
  }
  const correoResumen = sanitizeEmail_(payload.correoResumen);

  const sanitizedItems = sanitizeMermaItems_(items);
  const sheet = getMainSheet_();
  const summary = { processed: 0, updated: 0, appended: 0 };
  const registroAutomatico = new Date();
  const productCatalogByCode = getProductCatalogByCode_();
  const mes = getMesDesdeFecha_(payload.fecha, registroAutomatico);

  const rows = sanitizedItems.map((item) =>
    buildMermaRow_(payload, item, item.cantidadMerma, registroAutomatico, productCatalogByCode, mes)
  );

  batchAppendRows_(sheet, rows);
  summary.appended = rows.length;
  summary.processed = rows.length;
  summary.emailSummary = sendRegistrationSummaryEmail_({
    to: correoResumen,
    moduleName: 'Produccion',
    subjectPrefix: 'Resumen de produccion',
    responsibleLabel: 'Responsable',
    responsibleName: payload.responsable || '',
    date: payload.fecha,
    time: payload.hora || '',
    sede: payload.sede,
    observations: payload.observaciones || '',
    quantityLabel: 'Cantidad producida',
    items: sanitizedItems.map((item) => ({
      code: item.productCode,
      product: item.productName,
      unit: item.unit,
      quantity: item.cantidadMerma,
    })),
  });

  return summary;
}

function sanitizeMermaItems_(items) {
  return items.map((item, index) => {
    const productCode = String(item.productCode || '').trim();
    const productName = String(item.productName || '').trim();
    const unit = String(item.unit || '').trim();
    const cantidadMerma = Number(item.cantidadMerma);
    const label = productCode || productName || `#${index + 1}`;

    if (!productCode) {
      throw new Error(`El producto ${label} necesita un código.`);
    }
    if (!productName) {
      throw new Error(`El producto ${label} necesita una descripción.`);
    }
    if (!unit) {
      throw new Error(`La unidad del producto ${label} es obligatoria.`);
    }
    if (!Number.isFinite(cantidadMerma) || cantidadMerma <= 0) {
      throw new Error(`La merma debe ser mayor a cero (${label}).`);
    }

    return { productCode, productName, unit, cantidadMerma };
  });
}

function buildMermaRow_(payload, item, qty, registroAutomatico, productCatalogByCode, mes) {
  return [
    payload.hora || '',
    payload.fecha || '',
    getFamiliaByCode_(item.productCode, productCatalogByCode),
    item.productCode || '',
    item.unit || '',
    item.productName || '',
    payload.sede || '',
    '',
    'SIN SOLICITUD',
    '',
    '',
    qty,
    mes,
    registroAutomatico || new Date(),
    '',
    payload.observaciones || '',
  ];
}

function batchAppendRows_(sheet, rows) {
  if (!sheet || !Array.isArray(rows) || !rows.length) return;
  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);
}

function getProducts_(options) {
  const bypassCache = Boolean(options?.bypassCache);
  const cacheKey = 'products-catalog-v1';
  if (!bypassCache) {
    try {
      const cached = CacheService.getScriptCache().get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch (error) {
    }
  }

  const sheet = getSpreadsheet_().getSheetByName(CONFIG.catalogSheetName);
  if (!sheet) throw new Error('No se encontró la pestaña PRODUCTOS.');
  const values = sheet.getDataRange().getValues();
  const [, ...rows] = values;
  const products = rows
    .filter((row) => row[0] && row[1])
    .map((row) => ({
      code: String(row[0]).trim(),
      description: String(row[1]).trim(),
      unit: String(row[2] || '').trim() || 'UND',
      family: String(row[3] || '').trim(),
    }));

  try {
    CacheService.getScriptCache().put(
      cacheKey,
      JSON.stringify(products),
      CONFIG.catalogCacheTtlSeconds
    );
  } catch (error) {
  }

  return products;
}

function getProductCatalogByCode_() {
  return getProducts_().reduce((acc, product) => {
    acc[normalizeText_(product.code)] = {
      family: String(product.family || '').trim(),
    };
    return acc;
  }, {});
}

function getFamiliaByCode_(productCode, productCatalogByCode) {
  const normalizedCode = normalizeText_(productCode);
  if (!normalizedCode) return '';
  return String(productCatalogByCode?.[normalizedCode]?.family || '').trim();
}

function getMesDesdeFecha_(fecha, fallbackDate) {
  const monthNames = [
    'ENERO',
    'FEBRERO',
    'MARZO',
    'ABRIL',
    'MAYO',
    'JUNIO',
    'JULIO',
    'AGOSTO',
    'SEPTIEMBRE',
    'OCTUBRE',
    'NOVIEMBRE',
    'DICIEMBRE',
  ];

  let parsedDate = null;
  if (fecha instanceof Date && !isNaN(fecha.getTime())) {
    parsedDate = fecha;
  } else {
    const raw = String(fecha || '').trim();
    if (raw) {
      const ddmmyyyy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (ddmmyyyy) {
        parsedDate = new Date(Number(ddmmyyyy[3]), Number(ddmmyyyy[2]) - 1, Number(ddmmyyyy[1]));
      } else {
        const tentative = new Date(raw);
        if (!isNaN(tentative.getTime())) {
          parsedDate = tentative;
        }
      }
    }
  }

  const safeDate = parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate : (fallbackDate || new Date());
  return monthNames[safeDate.getMonth()] || '';
}

function sanitizeEmail_(value) {
  const email = String(value || '').trim();
  if (!email) {
    throw new Error('El correo electronico es obligatorio para enviar el resumen.');
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Ingresa un correo electronico valido para recibir el resumen.');
  }
  return email;
}

function sendRegistrationSummaryEmail_(summary) {
  const to = String(summary?.to || '').trim();
  try {
    const recipient = sanitizeEmail_(to);
    const subjectParts = [
      summary.subjectPrefix || 'Resumen de registro',
      summary.sede || '',
      summary.date || '',
    ].filter(Boolean);
    const subject = subjectParts.join(' - ');
    const body = buildSummaryTextBody_(summary);
    const htmlBody = buildSummaryHtmlBody_(summary);

    MailApp.sendEmail({
      to: recipient,
      subject,
      body,
      htmlBody,
      name: 'Formularios EL CENTRO',
    });

    return { sent: true, to: recipient };
  } catch (error) {
    Logger.log(`No se pudo enviar el resumen a ${to}: ${error && error.message ? error.message : error}`);
    return {
      sent: false,
      to,
      error: normalizeAppErrorMessage_(error),
    };
  }
}

function buildSummaryTextBody_(summary) {
  const lines = [
    `Resumen de ${summary.moduleName || 'registro'}`,
    '',
    `Fecha: ${formatEmailValue_(summary.date)}`,
    `Hora: ${formatEmailValue_(summary.time)}`,
    `Sede: ${formatEmailValue_(summary.sede)}`,
    `${summary.responsibleLabel || 'Responsable'}: ${formatEmailValue_(summary.responsibleName)}`,
  ];

  if (summary.numeroEntrega) {
    lines.push(`Numero de Entrega: ${formatEmailValue_(summary.numeroEntrega)}`);
  }

  if (summary.observations) {
    lines.push(`Observaciones: ${formatEmailValue_(summary.observations)}`);
  }

  lines.push('', 'Productos:');
  const items = Array.isArray(summary.items) ? summary.items : [];
  items.forEach((item, index) => {
    lines.push(
      `${index + 1}. ${formatEmailValue_(item.code)} - ${formatEmailValue_(item.product)} | Unidad: ${formatEmailValue_(item.unit)} | ${summary.quantityLabel || 'Cantidad'}: ${formatEmailValue_(item.quantity)}`
    );
  });

  lines.push('', 'Este correo fue generado automaticamente por el formulario de EL CENTRO.');
  return lines.join('\n');
}

function buildSummaryHtmlBody_(summary) {
  const items = Array.isArray(summary.items) ? summary.items : [];
  const rows = items
    .map(
      (item) => `
        <tr>
          <td style="border: 1px solid #d9c8ab;">${escapeEmailHtml_(item.code)}</td>
          <td style="border: 1px solid #d9c8ab;">${escapeEmailHtml_(item.product)}</td>
          <td style="border: 1px solid #d9c8ab;">${escapeEmailHtml_(item.unit)}</td>
          <td style="border: 1px solid #d9c8ab;">${escapeEmailHtml_(item.quantity)}</td>
        </tr>`
    )
    .join('');

  const numeroEntregaRow = summary.numeroEntrega
    ? `<p><strong>Numero de Entrega:</strong> ${escapeEmailHtml_(summary.numeroEntrega)}</p>`
    : '';
  const observationsRow = summary.observations
    ? `<p><strong>Observaciones:</strong> ${escapeEmailHtml_(summary.observations)}</p>`
    : '';

  return `
    <div style="font-family: Arial, sans-serif; color: #111; line-height: 1.45;">
      <h2 style="margin: 0 0 12px;">Resumen de ${escapeEmailHtml_(summary.moduleName || 'registro')}</h2>
      <p><strong>Fecha:</strong> ${escapeEmailHtml_(summary.date)}</p>
      <p><strong>Hora:</strong> ${escapeEmailHtml_(summary.time)}</p>
      <p><strong>Sede:</strong> ${escapeEmailHtml_(summary.sede)}</p>
      <p><strong>${escapeEmailHtml_(summary.responsibleLabel || 'Responsable')}:</strong> ${escapeEmailHtml_(summary.responsibleName)}</p>
      ${numeroEntregaRow}
      ${observationsRow}
      <table cellpadding="8" cellspacing="0" style="border-collapse: collapse; margin-top: 16px; width: 100%; max-width: 760px;">
        <thead>
          <tr style="background: #f4ebdc;">
            <th align="left" style="border: 1px solid #d9c8ab;">Codigo</th>
            <th align="left" style="border: 1px solid #d9c8ab;">Producto</th>
            <th align="left" style="border: 1px solid #d9c8ab;">Unidad</th>
            <th align="left" style="border: 1px solid #d9c8ab;">${escapeEmailHtml_(summary.quantityLabel || 'Cantidad')}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top: 16px; color: #5d5147;">Este correo fue generado automaticamente por el formulario de EL CENTRO.</p>
    </div>
  `;
}

function formatEmailValue_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, CONFIG.timeZone, 'yyyy-MM-dd HH:mm');
  }
  return String(value === undefined || value === null || value === '' ? '-' : value);
}

function escapeEmailHtml_(value) {
  return formatEmailValue_(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseBody_(e) {
  if (!e?.postData?.contents) throw new Error('Cuerpo vacío.');
  return JSON.parse(e.postData.contents);
}

function diagnoseAccess_() {
  const report = {
    spreadsheetId: CONFIG.spreadsheetId,
    mainSheetName: CONFIG.mainSheetName,
    catalogSheetName: CONFIG.catalogSheetName,
    timeZone: CONFIG.timeZone,
    canOpenSpreadsheet: false,
    hasMainSheet: false,
    hasCatalogSheet: false,
    protections: {
      sheetCount: 0,
      rangeCount: 0,
    },
    canWriteMainSheet: false,
    writeError: '',
  };

  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  report.canOpenSpreadsheet = Boolean(ss);

  const main = ss.getSheetByName(CONFIG.mainSheetName);
  const catalog = ss.getSheetByName(CONFIG.catalogSheetName);
  report.hasMainSheet = Boolean(main);
  report.hasCatalogSheet = Boolean(catalog);

  if (!main) {
    report.writeError = `No se encontró la hoja principal: ${CONFIG.mainSheetName}`;
    return report;
  }

  try {
    report.protections.sheetCount = main.getProtections(SpreadsheetApp.ProtectionType.SHEET).length;
    report.protections.rangeCount = main.getProtections(SpreadsheetApp.ProtectionType.RANGE).length;
  } catch (_) {}

  try {
    const testRange = main.getRange(1, CONFIG.columns.timestamp);
    const previous = testRange.getValue();
    testRange.setValue(previous);
    report.canWriteMainSheet = true;
  } catch (error) {
    report.canWriteMainSheet = false;
    report.writeError = String(error && error.message ? error.message : error || 'Error de escritura desconocido.');
  }

  return report;
}

function getSpreadsheet_() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
    if (!ss) throw new Error('No se pudo abrir el Spreadsheet.');
    return ss;
  } catch (error) {
    const rawMessage = String(error && error.message ? error.message : error || '');
    if (/no tienes permiso para acceder al documento solicitado|you do not have permission/i.test(rawMessage)) {
      throw new Error(
        'Sin acceso al Google Sheets. Corrige el despliegue: 1) Deploy > Manage deployments > Web app > Execute as: Me (propietario). 2) Who has access: Anyone (o Anyone with the link). 3) Verifica que el spreadsheetId sea el correcto y que el propietario del script tenga acceso de editor.'
      );
    }
    throw error;
  }
}

function getMainSheet_() {
  const sheet = getSpreadsheet_().getSheetByName(CONFIG.mainSheetName);
  if (!sheet) throw new Error('No se encontró la pestaña principal.');
  ensureMainSheetStructure_(sheet);
  return sheet;
}

function ensureMainSheetStructure_(sheet) {
  const headerCell = sheet.getRange(1, CONFIG.columns.numeroEntrega);
  const headerValue = String(headerCell.getValue() || '').trim();
  if (!headerValue) {
    headerCell.setValue('NUMERO DE ENTREGA');
  }

  const observationsHeader = sheet.getRange(1, CONFIG.columns.observaciones);
  const observationsValue = String(observationsHeader.getValue() || '').trim();
  if (!observationsValue) {
    observationsHeader.setValue('OBSERVACIONES');
  }
}

function withLock_(callback) {
  const lock = getSafeLock_();
  const acquired = lock.tryLock(CONFIG.lockWaitMs);
  if (!acquired) {
    throw new Error('Hay muchas solicitudes en curso. Intenta nuevamente en 5 segundos.');
  }
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

function normalizeAppErrorMessage_(error) {
  const rawMessage = String(error && error.message ? error.message : error || '').trim();
  if (!rawMessage) {
    return 'Error interno del Apps Script.';
  }

  if (
    /cannot edit protected|rango protegido|hoja protegida|protected range|protected sheet/i.test(
      rawMessage
    )
  ) {
    return (
      'La hoja DATA o alguno de sus rangos está protegido para la cuenta que ejecuta el Web App. ' +
      'En Google Sheets, revisa Datos > Hojas y rangos protegidos y permite edición al propietario del Apps Script.'
    );
  }

  if (
    /no tienes permiso para acceder al documento solicitado|you do not have permission|insufficient permissions/i.test(
      rawMessage
    )
  ) {
    return (
      'No hay permisos de escritura sobre la hoja de cálculo. Verifica: 1) Deploy > Manage deployments > Web app > Execute as: Me (propietario). ' +
      '2) Who has access: Anyone o Anyone with the link. 3) El propietario del script debe tener rol Editor en el Google Sheets.'
    );
  }

  return rawMessage;
}

function buildResponse_(success, data, message) {
  return ContentService.createTextOutput(
    JSON.stringify({ success, data, message })
  ).setMimeType(ContentService.MimeType.JSON);
}

function autorizarMailApp() {
  MailApp.sendEmail({
    to: 'pasantias.pdt@gmail.com',
    subject: 'Prueba de autorizacion MailApp',
    body: 'Permiso de envio de correos autorizado correctamente.',
  });
}
