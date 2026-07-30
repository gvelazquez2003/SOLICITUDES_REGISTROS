'use strict';

const CURRENT_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbzsJttokbSkW6AP8laHa4mvwk8xy8ESCpor5E4ClSlPlEktLG0g3xneahR0XXC99r8I/exec';
const APPS_SCRIPT_URL = String(window.APPS_SCRIPT_URL || CURRENT_APPS_SCRIPT_URL || '').trim();
const SEDES = ['SL', 'LPG', 'SC', 'SCH', 'PB-2', 'E PB-2', 'LG', 'VM', 'BC', 'LA GUAIRA'];
const MERMA_SEDES = ['BC', 'LPG'];
const FORCED_HORA_SEDES = ['BC', 'PB-2', 'VM'];
const FORCED_HORA_VALUE = '09:00';
const STORAGE_KEY = 'latata-catalog-v1';
const AUTH_STORAGE_KEY = 'latata-auth-session-v1';
const DECIMAL_COMMA_PRODUCT_CODES = new Set([
  'MDMP0234',
  'STMP0014',
  'STMZ0004',
  'STMZ0014',
  'STMA0081',
  'STMZ0026',
  'STMZ0027',
  'STMZ0082',
  'STMZ0084',
]);

const state = {
  products: [],
  auth: null,
  authReady: false,
  authenticatedDataLoaded: false,
};

const elements = {
  appShell: document.getElementById('app-shell'),
  authScreen: document.getElementById('auth-screen'),
  loginForm: document.getElementById('login-form'),
  registerForm: document.getElementById('register-form'),
  authStatus: document.getElementById('auth-status'),
  authTabs: () => document.querySelectorAll('[data-auth-panel-target]'),
  authPanels: () => document.querySelectorAll('[data-auth-panel]'),
  adminOnly: () => document.querySelectorAll('[data-admin-only]'),
  sessionUser: document.getElementById('session-user'),
  sessionRole: document.getElementById('session-role'),
  logoutBtn: document.getElementById('logout-btn'),
  usersBody: document.getElementById('users-body'),
  refreshUsersBtn: document.getElementById('refresh-users'),
  navButtons: () => document.querySelectorAll('.nav-btn'),
  viewTriggers: () => document.querySelectorAll('[data-view-target]'),
  views: () => document.querySelectorAll('.view'),
  solicitudRows: document.getElementById('solicitud-product-rows'),
  addSolicitudRowBtn: document.getElementById('add-product-row'),
  registroRows: document.getElementById('registros-product-rows'),
  addRegistroRowBtn: document.getElementById('add-registro-row'),
  mermaRows: document.getElementById('merma-product-rows'),
  addMermaRowBtn: document.getElementById('add-merma-row'),
  catalogBody: document.getElementById('catalog-body'),
  catalogStatus: document.getElementById('catalog-status'),
  catalogSearch: document.getElementById('catalog-search'),
  refreshCatalogBtn: document.getElementById('refresh-catalog'),
  toast: document.getElementById('toast'),
  envWarning: document.getElementById('env-warning'),
  productOptions: document.getElementById('product-options'),
  confirmModal: document.getElementById('confirm-modal'),
  confirmSummary: document.getElementById('confirm-summary'),
  confirmAccept: document.getElementById('confirm-accept'),
  confirmAcceptText: document.getElementById('confirm-accept-text'),
  confirmSubmitBtn: document.getElementById('confirm-submit-btn'),
  confirmTitle: document.getElementById('confirm-title'),
  confirmCloseTriggers: () => document.querySelectorAll('[data-close-confirm]'),
};

let confirmResolver = null;

function createRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function refreshFormRequestId(form) {
  if (!form) return;
  form.dataset.requestId = createRequestId();
}

function getFormRequestId(form) {
  if (!form) return createRequestId();
  if (!form.dataset.requestId) {
    refreshFormRequestId(form);
  }
  return form.dataset.requestId;
}

function setupFormRequestIdTracking(form) {
  if (!form || form.dataset.requestTrackingBound === 'true') return;

  const updateRequestId = () => refreshFormRequestId(form);
  form.addEventListener('input', updateRequestId);
  form.addEventListener('change', updateRequestId);
  refreshFormRequestId(form);
  form.dataset.requestTrackingBound = 'true';
}

const queryAll = (scope, selector) => {
  if (!scope) return [];
  if (typeof scope.querySelectorAll === 'function') {
    return scope.querySelectorAll(selector);
  }
  return [];
};

init();

function init() {
  setupAuthUi();
  setupNavigation();
  populateSedeSelects();
  setupHoraAutoForSedes();
  setupNumeroEntregaForRegistros();
  initSolicitudesForm();
  initRegistrosForm();
  initMermaForm();
  setupProductCombos();
  syncProductCombosState();
  setupSingleProductHintButtons();
  setupConfirmModalEvents();
  setupUserManagement();
  initCatalogView();
  toggleEnvWarning(!APPS_SCRIPT_URL);
  bootAuth();
}

function setupAuthUi() {
  elements.authTabs().forEach((tab) => {
    tab.addEventListener('click', () => showAuthPanel(tab.dataset.authPanelTarget));
  });

  elements.loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    await runAuthAction(form, async () => {
      const response = await postPublicData('login', {
        username: formData.get('username') || '',
        password: formData.get('password') || '',
      });
      applySession(response?.data?.session);
      form.reset();
      showToast('Acceso permitido.', 'success');
    });
  });

  elements.registerForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    await runAuthAction(form, async () => {
      await postPublicData('registerUser', {
        name: formData.get('name') || '',
        username: formData.get('username') || '',
        password: formData.get('password') || '',
      });
      form.reset();
      showAuthPanel('login');
      setAuthStatus('Usuario creado. Espera la aprobacion del ADMIN para entrar.', 'success');
    });
  });

  elements.logoutBtn?.addEventListener('click', async () => {
    const token = state.auth?.token;
    clearSession();
    showAuthPanel('login');
    if (token) {
      try {
        await postPublicData('logout', { token });
      } catch (error) {
      }
    }
  });
}

async function runAuthAction(form, callback) {
  try {
    setAuthStatus('Procesando...', '');
    toggleFormLoading(form, true);
    await callback();
  } catch (error) {
    setAuthStatus(error.message || 'No se pudo completar la accion.', 'error');
  } finally {
    toggleFormLoading(form, false);
  }
}

function showAuthPanel(target) {
  const safeTarget = target === 'register' ? 'register' : 'login';
  elements.authTabs().forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.authPanelTarget === safeTarget);
  });
  elements.authPanels().forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.authPanel === safeTarget);
  });
  setAuthStatus('', '');
}

async function bootAuth() {
  const savedSession = readStoredSession();
  if (!savedSession?.token) {
    clearSession(false);
    return;
  }

  try {
    setAuthStatus('Verificando sesion...', '');
    const response = await postPublicData('checkSession', { token: savedSession.token });
    applySession(response?.data?.session);
  } catch (error) {
    clearSession();
    setAuthStatus('Inicia sesion para continuar.', '');
  }
}

function readStoredSession() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || 'null');
  } catch (error) {
    return null;
  }
}

function applySession(session) {
  if (!session?.token || !session?.user) {
    throw new Error('Sesion invalida.');
  }

  state.auth = session;
  state.authReady = true;
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  renderSessionState();
  loadAuthenticatedData();
}

function clearSession(removeStorage = true) {
  state.auth = null;
  state.authReady = false;
  state.authenticatedDataLoaded = false;
  if (removeStorage) {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }
  renderSessionState();
}

function renderSessionState() {
  const isAuthenticated = Boolean(state.auth?.token);
  const user = state.auth?.user || {};
  const isAdmin = user.role === 'ADMIN';

  elements.authScreen?.classList.toggle('hidden', isAuthenticated);
  elements.appShell?.classList.toggle('hidden', !isAuthenticated);
  elements.adminOnly().forEach((element) => element.classList.toggle('hidden', !isAdmin));

  if (elements.sessionUser) {
    elements.sessionUser.textContent = user.name || user.username || 'Usuario';
  }
  if (elements.sessionRole) {
    elements.sessionRole.textContent = user.role || 'USER';
  }

  if (!isAdmin && document.querySelector('.view.active')?.dataset.view === 'usuarios') {
    showView('home');
  }
}

function loadAuthenticatedData() {
  if (state.authenticatedDataLoaded) return;
  state.authenticatedDataLoaded = true;
  loadCatalogFromCache();
  fetchProducts();
  if (state.auth?.user?.role === 'ADMIN') {
    fetchUsers();
  }
}

function setAuthStatus(message, type) {
  if (!elements.authStatus) return;
  elements.authStatus.textContent = message || '';
  elements.authStatus.className = `auth-status ${type || ''}`.trim();
}

function requireSession() {
  if (!state.auth?.token) {
    clearSession(false);
    throw new Error('Inicia sesion para continuar.');
  }
  return state.auth.token;
}

function setupConfirmModalEvents() {
  elements.confirmCloseTriggers().forEach((trigger) => {
    trigger.addEventListener('click', () => closeConfirmationModal(false));
  });

  elements.confirmSubmitBtn?.addEventListener('click', () => closeConfirmationModal(true));

  elements.confirmAccept?.addEventListener('change', () => {
    if (!elements.confirmSubmitBtn || !elements.confirmAccept) return;
    elements.confirmSubmitBtn.disabled = !elements.confirmAccept.checked;
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !elements.confirmModal?.classList.contains('hidden')) {
      closeConfirmationModal(false);
    }
  });
}

function setupNavigation() {
  elements.viewTriggers().forEach((trigger) => {
    trigger.addEventListener('click', () => showView(trigger.dataset.viewTarget));
  });
}

function showView(target) {
  if (!target) return;
  if (target === 'usuarios' && state.auth?.user?.role !== 'ADMIN') {
    showToast('Solo ADMIN puede gestionar usuarios.', 'error');
    return;
  }
  elements.views().forEach((view) => {
    view.classList.toggle('active', view.dataset.view === target);
  });
  elements.navButtons().forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.viewTarget === target);
  });
  if (target === 'usuarios') {
    fetchUsers();
  }
}

function populateSedeSelects() {
  document.querySelectorAll('[data-role="sede-select"]').forEach((select) => {
    const currentValue = select.value;
    const scope = String(select.dataset.scope || '').toLowerCase();
    const availableSedes = scope === 'merma' ? MERMA_SEDES : SEDES;
    const options = [
      '<option value="" disabled selected>Selecciona una sede</option>',
      ...availableSedes.map((sede) => `<option value="${sede}">${sede}</option>`),
    ].join('');
    select.innerHTML = options;
    if (currentValue && availableSedes.includes(currentValue)) {
      select.value = currentValue;
    }
  });
}

function isForcedHoraSede(sede) {
  return FORCED_HORA_SEDES.includes(String(sede || '').trim());
}

function setupHoraAutoForSedes() {
  document.querySelectorAll('[data-role="sede-select"]').forEach((select) => {
    if (select.dataset.horaBound === 'true') return;
    const form = select.closest('form');
    const horaField = form?.querySelector('[name="hora"]');
    if (!horaField) return;

    const applyHoraRule = () => {
      const sede = select.value;
      if (isForcedHoraSede(sede)) {
        horaField.value = FORCED_HORA_VALUE;
        horaField.dataset.locked = 'true';
      } else {
        if (horaField.dataset.locked === 'true' && horaField.value === FORCED_HORA_VALUE) {
          horaField.value = '';
        }
        delete horaField.dataset.locked;
      }
    };

    select.addEventListener('change', applyHoraRule);
    horaField.addEventListener('change', () => {
      if (horaField.dataset.locked === 'true' && horaField.value !== FORCED_HORA_VALUE) {
        horaField.value = FORCED_HORA_VALUE;
        showToast('Para esta sede la hora es 09:00.', 'info');
      }
    });
    horaField.addEventListener('input', () => {
      if (horaField.dataset.locked === 'true' && horaField.value !== FORCED_HORA_VALUE) {
        horaField.value = FORCED_HORA_VALUE;
      }
    });

    applyHoraRule();
    select.dataset.horaBound = 'true';
  });
}

function setupNumeroEntregaForRegistros() {
  const form = document.getElementById('registros-form');
  if (!form) return;

  const sedeSelect = form.querySelector('select[name="sede"]');
  const numeroEntregaWrap = document.getElementById('registros-numero-entrega-wrap');
  const numeroEntregaSelect = document.getElementById('registros-numero-entrega');
  if (!sedeSelect || !numeroEntregaWrap || !numeroEntregaSelect) return;

  const syncVisibility = () => {
    const isBC = String(sedeSelect.value || '').trim().toUpperCase() === 'BC';
    numeroEntregaWrap.style.display = isBC ? 'flex' : 'none';
    numeroEntregaSelect.required = isBC;
    if (!isBC) {
      numeroEntregaSelect.value = '';
    }
  };

  sedeSelect.addEventListener('change', syncVisibility);
  syncVisibility();
}

function initSolicitudesForm() {
  const form = document.getElementById('solicitudes-form');
  if (!form || !elements.solicitudRows) return;

  setupFormRequestIdTracking(form);
  resetSolicitudRows();
  elements.addSolicitudRowBtn?.addEventListener('click', () => addSolicitudRow());

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (typeof form.reportValidity === 'function' && !form.reportValidity()) {
      return;
    }
    const formData = new FormData(form);
    let items;

    try {
      items = collectSolicitudItems();
    } catch (error) {
      showToast(error.message || 'Corrige las cantidades ingresadas.', 'error');
      return;
    }

    if (!items.length) {
      showToast('Agrega al menos un producto.', 'error');
      return;
    }

    if (hasDuplicateProducts(items)) {
      showToast('No puedes repetir un producto en la solicitud de sede.', 'error');
      return;
    }

    const sede = formData.get('sede') || '';
    const payload = {
      fecha: formData.get('fecha') || '',
      hora: isForcedHoraSede(sede) ? FORCED_HORA_VALUE : formData.get('hora') || '',
      sede,
      responsable: formData.get('responsable') || '',
      correoResumen: String(formData.get('correoResumen') || '').trim(),
      observaciones: String(formData.get('observaciones') || '').trim(),
      requestId: getFormRequestId(form),
      items,
    };

    const observationFields = payload.observaciones
      ? [{ label: 'Observaciones', value: payload.observaciones }]
      : [];

    const confirmed = await requestTwoStepConfirmation({
      title: 'Confirmar solicitud de sede',
      agreementName: payload.responsable,
      fields: [
        { label: 'Fecha', value: payload.fecha },
        { label: 'Hora', value: payload.hora },
        { label: 'Sede', value: payload.sede },
        { label: 'Responsable', value: payload.responsable },
        { label: 'Correo', value: payload.correoResumen },
        ...observationFields,
      ],
      items: payload.items.map((item) => ({
        code: item.code,
        description: item.description,
        unit: item.unit,
        quantity: item.quantityDisplay || item.quantity,
      })),
      quantityLabel: 'Cantidad solicitada',
    });

    if (!confirmed) {
      showToast('Envío cancelado. Puedes revisar y editar la solicitud.', 'info');
      return;
    }

    try {
      toggleFormLoading(form, true);
      const response = await postData('createSolicitud', payload);
      showSubmissionResult('Solicitud de sede registrada correctamente.', response);
      form.reset();
      resetSolicitudRows();
      refreshFormRequestId(form);
    } catch (error) {
      showToast(error.message || 'Error al registrar la solicitud de sede.', 'error');
    } finally {
      toggleFormLoading(form, false);
    }
  });
}

function collectSolicitudItems() {
  return collectItems(elements.solicitudRows, 'cantidad solicitada', (product, quantity) => ({
    code: product.code,
    description: product.description,
    unit: product.unit,
    quantity,
  }));
}

function resetSolicitudRows() {
  if (!elements.solicitudRows) return;
  elements.solicitudRows.innerHTML = '';
  addSolicitudRow();
}

function addSolicitudRow() {
  if (!elements.solicitudRows) return;
  const row = document.createElement('div');
  row.className = 'product-row';
  row.innerHTML = `
    <label>
      <span>Producto</span>
      <input type="hidden" data-role="product-value" />
      <input
        type="text"
        class="product-combo"
        data-role="product-combo"
        placeholder="Seleccione o escriba un producto"
        list="product-options"
        autocomplete="off"
        required
      />
      <small class="unit-hint" data-unit-output>Unidad: --</small>
    </label>
    <label>
      <span>Cantidad solicitada</span>
      <input type="text" inputmode="numeric" data-role="quantity-input" value="1" required />
    </label>
    <div class="product-row__actions">
      <span class="unit-badge" data-unit>--</span>
      <button type="button" class="remove-row">Eliminar</button>
    </div>
  `;

  elements.solicitudRows.appendChild(row);
  setupProductCombos(row);
  row.querySelector('.remove-row').addEventListener('click', () =>
    removeProductRow(row, elements.solicitudRows)
  );
  updateRowUnit(row);
}

function removeProductRow(row, container) {
  const target = container || row.parentElement;
  if (!target) return;
  if (target.children.length === 1) {
    showToast('Debes mantener al menos un producto.', 'error');
    return;
  }
  row.remove();
}

function initRegistrosForm() {
  const form = document.getElementById('registros-form');
  if (!form || !elements.registroRows) return;

  setupFormRequestIdTracking(form);
  resetRegistroRows();
  elements.addRegistroRowBtn?.addEventListener('click', () => addRegistroRow());

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (typeof form.reportValidity === 'function' && !form.reportValidity()) {
      return;
    }
    const formData = new FormData(form);
    let items;

    try {
      items = collectRegistroItems();
    } catch (error) {
      showToast(error.message || 'Corrige las cantidades ingresadas.', 'error');
      return;
    }

    if (!items.length) {
      showToast('Agrega al menos un producto.', 'error');
      return;
    }

    if (hasDuplicateProducts(items)) {
      showToast('Cada producto solo puede aparecer una vez por registro.', 'error');
      return;
    }

    const sede = formData.get('sede') || '';
    const numeroEntrega = sede === 'BC' ? String(formData.get('numeroEntrega') || '').trim() : '';
    if (sede === 'BC' && !numeroEntrega) {
      const numeroEntregaSelect = document.getElementById('registros-numero-entrega');
      numeroEntregaSelect?.focus();
      showToast('Para la sede BC, el Número de Entrega es obligatorio.', 'error');
      return;
    }
    const payload = {
      fecha: formData.get('fecha') || '',
      hora: isForcedHoraSede(sede) ? FORCED_HORA_VALUE : formData.get('hora') || '',
      sede,
      responsableEntrega: formData.get('responsableEntrega') || '',
      correoResumen: String(formData.get('correoResumen') || '').trim(),
      observaciones: String(formData.get('observaciones') || '').trim(),
      numeroEntrega,
      requestId: getFormRequestId(form),
      items,
    };

    const observationFields = payload.observaciones
      ? [{ label: 'Observaciones', value: payload.observaciones }]
      : [];

    const confirmed = await requestTwoStepConfirmation({
      title: 'Confirmar entrega a sede',
      agreementName: payload.responsableEntrega,
      fields: [
        { label: 'Fecha', value: payload.fecha },
        { label: 'Hora', value: payload.hora },
        { label: 'Sede', value: payload.sede },
        { label: 'Responsable entrega', value: payload.responsableEntrega },
        { label: 'Correo', value: payload.correoResumen },
        { label: 'Número de Entrega', value: payload.numeroEntrega || '-' },
        ...observationFields,
      ],
      items: payload.items.map((item) => ({
        code: item.productCode,
        description: item.productName,
        unit: item.unit,
        quantity: item.quantityDisplay || item.cantidadEntregada,
      })),
      quantityLabel: 'Cantidad entregada',
    });

    if (!confirmed) {
      showToast('Envío cancelado. Puedes revisar y editar la entrega.', 'info');
      return;
    }

    try {
      toggleFormLoading(form, true);
      const response = await postData('recordEntrega', payload);
      showSubmissionResult('Entregado a Sedes procesado.', response);
      form.reset();
      resetRegistroRows();
      refreshFormRequestId(form);
    } catch (error) {
      showToast(error.message || 'Error al registrar la entrega.', 'error');
    } finally {
      toggleFormLoading(form, false);
    }
  });
}

function addRegistroRow() {
  if (!elements.registroRows) return;
  const row = document.createElement('div');
  row.className = 'product-row';
  row.innerHTML = `
    <label>
      <span>Producto</span>
      <input type="hidden" data-role="product-value" />
      <input
        type="text"
        class="product-combo"
        data-role="product-combo"
        placeholder="Seleccione o escriba un producto"
        list="product-options"
        autocomplete="off"
        required
      />
      <small class="unit-hint" data-unit-output>Unidad: --</small>
    </label>
    <label>
      <span>Cantidad entregada</span>
      <input type="text" inputmode="numeric" data-role="quantity-input" value="1" required />
    </label>
    <div class="product-row__actions">
      <span class="unit-badge" data-unit>--</span>
      <button type="button" class="remove-row">Eliminar</button>
    </div>
  `;

  elements.registroRows.appendChild(row);
  setupProductCombos(row);
  row.querySelector('.remove-row').addEventListener('click', () =>
    removeProductRow(row, elements.registroRows)
  );
  updateRowUnit(row);
}

function resetRegistroRows() {
  if (!elements.registroRows) return;
  elements.registroRows.innerHTML = '';
  addRegistroRow();
}

function collectRegistroItems() {
  return collectItems(elements.registroRows, 'cantidad entregada', (product, quantity) => ({
    productCode: product.code,
    productName: product.description,
    unit: product.unit,
    cantidadEntregada: quantity,
  }));
}

function initMermaForm() {
  const form = document.getElementById('merma-form');
  if (!form || !elements.mermaRows) return;

  setupFormRequestIdTracking(form);
  resetMermaRows();
  elements.addMermaRowBtn?.addEventListener('click', () => addMermaRow());

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (typeof form.reportValidity === 'function' && !form.reportValidity()) {
      return;
    }
    const formData = new FormData(form);
    let items;

    try {
      items = collectMermaItems();
    } catch (error) {
      showToast(error.message || 'Corrige las cantidades ingresadas.', 'error');
      return;
    }

    if (!items.length) {
      showToast('Agrega al menos un producto.', 'error');
      return;
    }

    if (hasDuplicateProducts(items)) {
      showToast('No repitas productos en Producción.', 'error');
      return;
    }

    const sede = formData.get('sede') || MERMA_SEDES[0];
    const payload = {
      fecha: formData.get('fecha') || '',
      hora: isForcedHoraSede(sede) ? FORCED_HORA_VALUE : formData.get('hora') || '',
      sede,
      responsable: formData.get('responsable') || '',
      correoResumen: String(formData.get('correoResumen') || '').trim(),
      observaciones: String(formData.get('observaciones') || '').trim(),
      requestId: getFormRequestId(form),
      items,
    };

    const observationFields = payload.observaciones
      ? [{ label: 'Observaciones', value: payload.observaciones }]
      : [];

    const confirmed = await requestTwoStepConfirmation({
      title: 'Confirmar produccion',
      agreementName: payload.responsable,
      fields: [
        { label: 'Fecha', value: payload.fecha },
        { label: 'Hora', value: payload.hora },
        { label: 'Sede', value: payload.sede },
        { label: 'Responsable', value: payload.responsable },
        { label: 'Correo', value: payload.correoResumen },
        ...observationFields,
      ],
      items: payload.items.map((item) => ({
        code: item.productCode,
        description: item.productName,
        unit: item.unit,
        quantity: item.quantityDisplay || item.cantidadMerma,
      })),
      quantityLabel: 'Cantidad producida',
    });

    if (!confirmed) {
      showToast('Envio cancelado. Puedes revisar y editar la produccion.', 'info');
      return;
    }

    try {
      toggleFormLoading(form, true);
      const response = await postData('recordMerma', payload);
      showSubmissionResult(`Produccion registrada para ${payload.sede}.`, response);
      form.reset();
      resetMermaRows();
      refreshFormRequestId(form);
    } catch (error) {
      showToast(error.message || 'Error al registrar la producción.', 'error');
    } finally {
      toggleFormLoading(form, false);
    }
  });
}

function addMermaRow() {
  if (!elements.mermaRows) return;
  const row = document.createElement('div');
  row.className = 'product-row';
  row.innerHTML = `
    <label>
      <span>Producto</span>
      <input type="hidden" data-role="product-value" />
      <input
        type="text"
        class="product-combo"
        data-role="product-combo"
        placeholder="Seleccione o escriba un producto"
        list="product-options"
        autocomplete="off"
        required
      />
      <small class="unit-hint" data-unit-output>Unidad: --</small>
    </label>
    <label>
      <span>Cantidad producida</span>
      <input type="text" inputmode="numeric" data-role="quantity-input" value="1" required />
    </label>
    <div class="product-row__actions">
      <span class="unit-badge" data-unit>--</span>
      <button type="button" class="remove-row">Eliminar</button>
    </div>
  `;

  elements.mermaRows.appendChild(row);
  setupProductCombos(row);
  row.querySelector('.remove-row').addEventListener('click', () =>
    removeProductRow(row, elements.mermaRows)
  );
  updateRowUnit(row);
}

function resetMermaRows() {
  if (!elements.mermaRows) return;
  elements.mermaRows.innerHTML = '';
  addMermaRow();
}

function collectMermaItems() {
  return collectItems(elements.mermaRows, 'cantidad producida', (product, quantity) => ({
    productCode: product.code,
    productName: product.description,
    unit: product.unit,
    cantidadMerma: quantity,
  }));
}

function setupProductCombos(scope = document) {
  const inputs = queryAll(scope, '[data-role="product-combo"]');
  inputs.forEach((input) => {
    if (!input || input.dataset.comboBound === 'true') return;
    const hiddenInput = input.parentElement?.querySelector('[data-role="product-value"]');
    const unitOutput = input.parentElement?.querySelector('[data-unit-output]');
    const getRow = () => input.closest('.product-row');
    const getBadge = () => input.closest('.product-row')?.querySelector('[data-unit]');

    const clearSelection = () => {
      delete input.dataset.code;
      if (hiddenInput) hiddenInput.value = '';
      if (unitOutput) unitOutput.textContent = 'Unidad: --';
      const badge = getBadge();
      if (badge) badge.textContent = '--';
      setQuantityInputMode(getRow(), null);
    };

    const commitSelection = () => {
      const product = getProductFromInput(input);
      if (!product) {
        clearSelection();
        return null;
      }
      input.dataset.code = product.code;
      input.value = formatProductOption(product);
      if (hiddenInput) hiddenInput.value = product.code;
      if (unitOutput) unitOutput.textContent = `Unidad: ${product.unit}`;
      const badge = getBadge();
      if (badge) badge.textContent = product.unit;
      setQuantityInputMode(getRow(), product);
      return product;
    };

    input.addEventListener('input', () => {
      clearSelection();
    });

    input.addEventListener('change', commitSelection);

    input.addEventListener('blur', () => {
      if (!commitSelection() && input.value.trim()) {
        showToast('Selecciona un producto del catálogo.', 'error');
        input.value = '';
      }
    });

    input.dataset.comboBound = 'true';
  });
}

function updateRowUnit(row) {
  const input = row.querySelector('[data-role="product-combo"]');
  const product = getProductFromInput(input);
  const badge = row.querySelector('[data-unit]');
  const unitHint = row.querySelector('[data-unit-output]');
  const unitLabel = product?.unit || '--';
  if (badge) badge.textContent = unitLabel;
  if (unitHint) unitHint.textContent = `Unidad: ${unitLabel}`;
  setQuantityInputMode(row, product);
}

function isDecimalCommaProduct(codeOrProduct) {
  const code =
    typeof codeOrProduct === 'string'
      ? codeOrProduct
      : String(codeOrProduct?.code || '').trim();
  return DECIMAL_COMMA_PRODUCT_CODES.has(String(code || '').trim().toUpperCase());
}

function setQuantityInputMode(row, product) {
  const quantityInput = row?.querySelector('[data-role="quantity-input"]');
  if (!quantityInput) return;

  const decimalMode = isDecimalCommaProduct(product);
  quantityInput.dataset.quantityMode = decimalMode ? 'decimal-comma' : 'integer';
  quantityInput.inputMode = decimalMode ? 'decimal' : 'numeric';
  quantityInput.placeholder = decimalMode ? '0,0' : '1';
}

function getProductFromInput(input) {
  if (!input) return null;
  if (input.dataset.code) {
    const productByDataset = findProduct(input.dataset.code);
    if (productByDataset) return productByDataset;
  }

  const rawValue = input.value?.trim();
  if (!rawValue) return null;
  const [codeCandidate] = rawValue.split(' · ');
  if (codeCandidate) {
    const productByCode = findProduct(codeCandidate.trim());
    if (productByCode) return productByCode;
  }

  return (
    state.products.find((product) => {
      const formatted = formatProductOption(product).toLowerCase();
      return (
        formatted === rawValue.toLowerCase() ||
        product.description.toLowerCase() === rawValue.toLowerCase()
      );
    }) || null
  );
}

function formatProductOption(product) {
  return `${product.code} · ${product.description}`;
}

function updateProductOptionsList() {
  if (!elements.productOptions) return;
  elements.productOptions.innerHTML = state.products
    .map((product) => `<option value="${formatProductOption(product)}"></option>`)
    .join('');
}

function syncProductCombosState() {
  const hasProducts = state.products.length > 0;
  document.querySelectorAll('[data-role="product-combo"]').forEach((input) => {
    input.placeholder = hasProducts
      ? 'Seleccione o escriba un producto'
      : 'Sin catálogo disponible';
    input.disabled = !hasProducts;
    if (hasProducts && input.dataset.code) {
      const product = findProduct(input.dataset.code);
      if (product) {
        input.value = formatProductOption(product);
        const unitOutput = input.parentElement?.querySelector('[data-unit-output]');
        if (unitOutput) unitOutput.textContent = `Unidad: ${product.unit}`;
        const badge = input.closest('.product-row')?.querySelector('[data-unit]');
        if (badge) badge.textContent = product.unit;
        setQuantityInputMode(input.closest('.product-row'), product);
      } else {
        setQuantityInputMode(input.closest('.product-row'), null);
      }
    } else {
      setQuantityInputMode(input.closest('.product-row'), null);
    }
  });
}

function refreshProductCombos() {
  updateProductOptionsList();
  syncProductCombosState();
}

function resetProductCombos(scope = document) {
  queryAll(scope, '[data-role="product-combo"]').forEach((input) => {
    delete input.dataset.code;
    input.value = '';
    const hiddenInput = input.parentElement?.querySelector('[data-role="product-value"]');
    if (hiddenInput) hiddenInput.value = '';
    const unitOutput = input.parentElement?.querySelector('[data-unit-output]');
    if (unitOutput) unitOutput.textContent = 'Unidad: --';
    const badge = input.closest('.product-row')?.querySelector('[data-unit]');
    if (badge) badge.textContent = '--';
  });
}

function hasDuplicateProducts(items) {
  const seen = new Set();
  for (const item of items) {
    const code = item.code || item.productCode;
    if (!code) {
      continue;
    }
    if (seen.has(code)) {
      return true;
    }
    seen.add(code);
  }
  return false;
}

function setupSingleProductHintButtons() {
  document.querySelectorAll('[data-prefill-product]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = document.querySelector(button.dataset.prefillProduct);
      if (target) {
        target.focus();
        showToast('Selecciona un producto del catálogo.', 'info');
      }
    });
  });
}

function collectItems(container, quantityLabel, mapper) {
  const rows = container?.querySelectorAll('.product-row');
  if (!rows) return [];

  const items = [];
  for (const row of rows) {
    const combo = row.querySelector('[data-role="product-combo"]');
    const quantityInput = row.querySelector('[data-role="quantity-input"]');
    const product = getProductFromInput(combo);
    if (!product) {
      combo?.focus?.();
      throw new Error('Selecciona un producto del catálogo en cada fila.');
    }

    let parsedQuantity;
    try {
      parsedQuantity = parseQuantityByProduct(quantityInput?.value, product, quantityLabel);
    } catch (error) {
      quantityInput?.focus();
      throw error;
    }

    const mapped = mapper(product, parsedQuantity.value);
    mapped.quantityDisplay = parsedQuantity.display;
    items.push(mapped);
  }

  return items;
}

function setupUserManagement() {
  elements.refreshUsersBtn?.addEventListener('click', () => fetchUsers(true));
}

async function fetchUsers(showSuccessToast = false) {
  if (state.auth?.user?.role !== 'ADMIN' || !elements.usersBody) return;

  elements.usersBody.innerHTML = '<tr><td colspan="6" class="muted">Cargando usuarios...</td></tr>';

  try {
    const response = await postData('listUsers', {});
    const users = Array.isArray(response?.data?.users) ? response.data.users : [];
    renderUsers(users);
    if (showSuccessToast) {
      showToast('Usuarios actualizados.', 'success');
    }
  } catch (error) {
    elements.usersBody.innerHTML = `<tr><td colspan="6" class="muted">${escapeHtml(error.message || 'No se pudieron cargar los usuarios.')}</td></tr>`;
  }
}

function renderUsers(users) {
  if (!elements.usersBody) return;
  if (!users.length) {
    elements.usersBody.innerHTML = '<tr><td colspan="6" class="muted">No hay usuarios creados.</td></tr>';
    return;
  }

  elements.usersBody.innerHTML = users.map(buildUserRow).join('');
  elements.usersBody.querySelectorAll('[data-user-access-toggle]').forEach((checkbox) => {
    checkbox.addEventListener('change', () => updateUserAccessFromRow(checkbox));
  });
}

function buildUserRow(user) {
  const isAdmin = user.role === 'ADMIN';
  const status = getUserStatus(user);
  const disabled = isAdmin ? 'disabled' : '';
  return `
    <tr data-user-id="${escapeHtml(user.id || '')}">
      <td>${escapeHtml(user.username || '')}</td>
      <td>${escapeHtml(user.name || '-')}</td>
      <td>${escapeHtml(user.role || 'USER')}</td>
      <td>
        <label class="user-toggle">
          <input
            type="checkbox"
            data-user-access-toggle="allowed"
            ${user.allowed ? 'checked' : ''}
            ${disabled}
          />
        </label>
      </td>
      <td>
        <label class="user-toggle">
          <input
            type="checkbox"
            data-user-access-toggle="blocked"
            ${user.blocked ? 'checked' : ''}
            ${disabled}
          />
        </label>
      </td>
      <td><span class="user-status ${status.className}">${status.label}</span></td>
    </tr>
  `;
}

function getUserStatus(user) {
  if (user.blocked) {
    return { label: 'Bloqueado', className: 'blocked' };
  }
  if (user.allowed) {
    return { label: 'Permitido', className: 'allowed' };
  }
  return { label: 'Pendiente', className: '' };
}

async function updateUserAccessFromRow(checkbox) {
  const row = checkbox.closest('tr');
  if (!row) return;

  const allowed = row.querySelector('[data-user-access-toggle="allowed"]')?.checked || false;
  const blocked = row.querySelector('[data-user-access-toggle="blocked"]')?.checked || false;

  try {
    row.classList.add('is-updating');
    await postData('setUserAccess', {
      userId: row.dataset.userId || '',
      allowed,
      blocked,
    });
    showToast('Acceso de usuario actualizado.', 'success');
    fetchUsers();
  } catch (error) {
    showToast(error.message || 'No se pudo actualizar el usuario.', 'error');
    fetchUsers();
  } finally {
    row.classList.remove('is-updating');
  }
}

function initCatalogView() {
  elements.catalogSearch?.addEventListener('input', (event) => {
    const term = event.target.value.trim().toLowerCase();
    const filtered = state.products.filter(
      (product) =>
        product.code.toLowerCase().includes(term) ||
        product.description.toLowerCase().includes(term)
    );
    renderCatalog(filtered);
  });

  elements.refreshCatalogBtn?.addEventListener('click', () => fetchProducts(true, true));
}

function loadCatalogFromCache() {
  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (!cached) return;
    const parsed = JSON.parse(cached);
    if (Array.isArray(parsed)) {
      state.products = parsed;
      refreshProductCombos();
      renderCatalog(parsed);
      setCatalogStatus('Catálogo desde caché', false);
    }
  } catch (error) {
    console.warn('No se pudo leer el catálogo en caché.', error);
  }
}

function parseQuantityByProduct(value, product, quantityLabel) {
  const raw = typeof value === 'number' ? value.toString() : String(value ?? '').trim();
  if (raw === '') {
    throw new Error(`La ${quantityLabel} es obligatoria.`);
  }

  if (isDecimalCommaProduct(product)) {
    if (raw.includes('.')) {
      throw new Error('Ingresa la cantidad decimal seguida de (,).');
    }

    if (!/^\d+(,\d+)?$/.test(raw)) {
      throw new Error(
        `La ${quantityLabel} de ${product.code} debe ser un número válido (usa coma para decimales).`
      );
    }

    const parsedDecimal = Number(raw.replace(',', '.'));
    if (!Number.isFinite(parsedDecimal) || parsedDecimal < 0) {
      throw new Error(`La ${quantityLabel} de ${product.code} debe ser mayor o igual a 0.`);
    }

    return {
      value: parsedDecimal,
      display: raw,
    };
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`La ${quantityLabel} debe ser un número entero mayor o igual a 0.`);
  }

  return {
    value: parsed,
    display: String(parsed),
  };
}

async function fetchProducts(showToastOnSuccess = false, forceRefresh = false) {
  if (!state.auth?.token) {
    setCatalogStatus('Inicia sesion para sincronizar.', true);
    return;
  }
  if (!APPS_SCRIPT_URL) {
    setCatalogStatus('Configura la URL del Apps Script.', true);
    return;
  }

  setCatalogStatus('Sincronizando catálogo...', false);

  try {
    const forceQuery = forceRefresh ? '&force=1' : '';
    const tokenQuery = `&token=${encodeURIComponent(requireSession())}`;
    const response = await fetch(`${APPS_SCRIPT_URL}?action=getProducts${forceQuery}${tokenQuery}`, {
      cache: 'no-store',
    });
    const data = await readResponseData(response);
    if (!data.success) {
      throw new Error(data.message || 'No se pudo sincronizar el catálogo.');
    }

    if (!Array.isArray(data?.data?.products)) {
      throw new Error(
        'El Apps Script no devolvió el catálogo. Implementa la acción getProducts y retorna JSON.'
      );
    }

    state.products = data.data.products;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.products));
    refreshProductCombos();
    renderCatalog(state.products);
    setCatalogStatus('Catálogo actualizado', false);
    if (showToastOnSuccess) {
      showToast('Catálogo sincronizado.', 'success');
    }
  } catch (error) {
    const normalizedError = normalizeNetworkError(error);
    console.error(normalizedError);
    setCatalogStatus(normalizedError.message, true);
    showToast(normalizedError.message, 'error');
  }
}

function renderCatalog(products) {
  if (!elements.catalogBody) return;
  if (!products.length) {
    elements.catalogBody.innerHTML = '<tr><td colspan="3" class="muted">Sin resultados.</td></tr>';
    return;
  }

  const rows = products
    .map(
      (product) => `
        <tr>
          <td>${product.code}</td>
          <td>${product.description}</td>
          <td>${product.unit}</td>
        </tr>`
    )
    .join('');
  elements.catalogBody.innerHTML = rows;
}

function findProduct(code) {
  return state.products.find((product) => product.code === code);
}

async function postData(action, payload) {
  return postDataInternal(action, {
    ...(payload || {}),
    authToken: requireSession(),
  });
}

async function postPublicData(action, payload) {
  return postDataInternal(action, payload || {});
}

async function postDataInternal(action, payload) {
  if (!APPS_SCRIPT_URL) {
    throw new Error('Configura la URL del Apps Script.');
  }

  let response;
  try {
    response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ action, payload }),
    });
  } catch (error) {
    throw normalizeNetworkError(error);
  }

  const data = await readResponseData(response);
  if (!data.success) {
    throw new Error(normalizeBackendErrorMessage(data.message || 'Error en la operación.'));
  }
  return data;
}

function showSubmissionResult(defaultMessage, response) {
  const emailSummary = response?.data?.emailSummary;
  if (!emailSummary) {
    showToast(
      `${defaultMessage} El servidor no confirmo el envio del resumen; revisa el despliegue de Apps Script.`,
      'info'
    );
    return;
  }
  if (emailSummary && emailSummary.sent === false) {
    const detail = String(emailSummary.error || '').trim();
    const suffix = detail ? ` Detalle: ${detail}` : '';
    showToast(
      `${defaultMessage} No se pudo enviar el resumen al correo indicado.${suffix}`,
      'info'
    );
    return;
  }
  showToast(`${defaultMessage} Resumen enviado al correo indicado.`, 'success');
}

function normalizeBackendErrorMessage(message) {
  const text = String(message || '').trim();
  if (/cannot edit protected|rango protegido|hoja protegida|protected range|protected sheet/i.test(text)) {
    return 'La hoja DATA o algún rango está protegido. Abre Google Sheets > Datos > Hojas y rangos protegidos y permite edición a la cuenta propietaria del Apps Script.';
  }
  if (
    /no tienes permiso para acceder al documento solicitado|you do not have permission/i.test(text)
  ) {
    return 'No hay permisos sobre la hoja de cálculo. En Apps Script despliega el Web App con Execute as: Me (propietario), acceso Anyone/Anyone with the link y verifica que el spreadsheetId sea correcto.';
  }
  return text || 'Error en la operación.';
}

function normalizeNetworkError(error) {
  if (error instanceof TypeError && /Failed to fetch/i.test(error.message || '')) {
    return new Error(
      `No se pudo conectar con Apps Script (${APPS_SCRIPT_URL}). Revisa permisos del despliegue (Anyone), URL activa y CORS.`
    );
  }
  return error instanceof Error ? error : new Error('Error de red al conectar con Apps Script.');
}

async function readResponseData(response) {
  const raw = await response.text();
  const text = raw.trim();

  if (!text) {
    return { success: response.ok };
  }

  try {
    return JSON.parse(text);
  } catch {
    if (/^ok$/i.test(text)) {
      return { success: response.ok, message: text };
    }
    throw new Error(text);
  }
}

function toggleFormLoading(form, loading) {
  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = loading;
  }
}

function setCatalogStatus(message, isError) {
  if (!elements.catalogStatus) return;
  elements.catalogStatus.textContent = message;
  elements.catalogStatus.classList.toggle('error', Boolean(isError));
}

function toggleEnvWarning(show) {
  if (!elements.envWarning) return;
  elements.envWarning.classList.toggle('hidden', !show);
}

let toastTimeout;
function showToast(message, type = 'info') {
  if (!elements.toast) return;
  elements.toast.textContent = message;
  elements.toast.className = `toast show ${type}`;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    elements.toast.classList.remove('show');
  }, 3500);
}

function requestTwoStepConfirmation(config) {
  if (!elements.confirmModal || !elements.confirmSummary || !elements.confirmAcceptText) {
    return Promise.resolve(true);
  }

  const safeTitle = String(config?.title || 'Confirmar envío').trim() || 'Confirmar envío';
  const agreementName = String(config?.agreementName || '').trim();
  const normalizedName = agreementName || 'responsable del formulario';
  const fields = Array.isArray(config?.fields) ? config.fields : [];
  const items = Array.isArray(config?.items) ? config.items : [];
  const quantityLabel = String(config?.quantityLabel || 'Cantidad').trim() || 'Cantidad';

  if (elements.confirmTitle) {
    elements.confirmTitle.textContent = safeTitle;
  }

  elements.confirmSummary.innerHTML = buildConfirmationSummary(fields, items, quantityLabel);
  elements.confirmAcceptText.textContent = `Yo, ${normalizedName}, estoy de acuerdo con estas cantidades y productos.`;

  if (elements.confirmAccept) {
    elements.confirmAccept.checked = false;
  }
  if (elements.confirmSubmitBtn) {
    elements.confirmSubmitBtn.disabled = true;
  }

  elements.confirmModal.classList.remove('hidden');
  document.body.classList.add('is-modal-open');

  return new Promise((resolve) => {
    confirmResolver = resolve;
  });
}

function closeConfirmationModal(accepted) {
  if (!elements.confirmModal) return;
  elements.confirmModal.classList.add('hidden');
  document.body.classList.remove('is-modal-open');
  if (typeof confirmResolver === 'function') {
    const resolver = confirmResolver;
    confirmResolver = null;
    resolver(Boolean(accepted));
  }
}

function buildConfirmationSummary(fields, items, quantityLabel) {
  const safeFields = Array.isArray(fields) ? fields : [];
  const safeItems = Array.isArray(items) ? items : [];
  const infoRows = safeFields
    .map(
      (field) => {
        const label = String(field.label || '').trim().toLowerCase();
        const fieldClass = label === 'observaciones'
          ? 'confirm-summary__field confirm-summary__field--wide'
          : 'confirm-summary__field';

        return `
      <div class="${fieldClass}">
        <dt>${escapeHtml(field.label || '')}</dt>
        <dd>${escapeHtml(field.value || '--')}</dd>
      </div>`;
      }
    )
    .join('');

  const itemsRows = safeItems
    .map(
      (item) => `
      <tr>
        <td>${escapeHtml(item.code || '')}</td>
        <td>${escapeHtml(item.description || '')}</td>
        <td>${escapeHtml(item.unit || '')}</td>
        <td>${escapeHtml(String(item.quantity ?? ''))}</td>
      </tr>`
    )
    .join('');

  return `
    <dl class="confirm-summary__fields">${infoRows}</dl>
    <div class="confirm-summary__table-wrap">
      <table class="confirm-summary__table">
        <thead>
          <tr>
            <th>Código</th>
            <th>Producto</th>
            <th>Unidad</th>
            <th>${escapeHtml(quantityLabel)}</th>
          </tr>
        </thead>
        <tbody>${itemsRows}</tbody>
      </table>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
