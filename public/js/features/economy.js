import { state } from '../core/state.js';
import { api } from '../core/api.js';
import { escapeHtml, formatMoney } from '../core/utils.js';

let editingWallet = null;
let editingService = null;

/* ================= FASE 2: ECONOMÍA, BILLETERAS Y ANALÍTICA ================= */
async function renderEconomyTab(container, ctx) {
  const data = await api('/api/economy');
  const { wallets, transactions, recurringServices = [], globalAnalytics } = data;
  const selectedWallet = wallets.find(w => w.id === state.selectedWalletId) || null;

  // Calcular total de débitos mensuales activos
  const activeServices = recurringServices.filter(s => s.active);
  const totalMonthlyServices = activeServices.reduce((acc, s) => acc + Number(s.amount || 0), 0);

  container.innerHTML = `
    <!-- Analítica Global -->
    <section class="card" aria-labelledby="econ-global-title">
      <h2 id="econ-global-title"><i class="fa-solid fa-chart-pie"></i> Analítica Global (Todos los Medios de Pago)</h2>
      <div class="grid-3" style="margin-block-end:1rem;">
        <div class="stat-box">
          <div class="text-muted">Ingresos Globales</div>
          <div class="stat-value text-ok">+${formatMoney(globalAnalytics.totalIncome)}</div>
        </div>
        <div class="stat-box">
          <div class="text-muted">Expensas / Egresos Globales</div>
          <div class="stat-value text-danger">-${formatMoney(globalAnalytics.totalExpense)}</div>
        </div>
        <div class="stat-box">
          <div class="text-muted">Balance Global</div>
          <div class="stat-value">${formatMoney(globalAnalytics.netBalance)}</div>
        </div>
      </div>

      <h3>Resumen Global por Categoría (Ingresos y Expensas)</h3>
      ${
        globalAnalytics.byCategory.length === 0
          ? '<p class="text-muted">Aún no hay movimientos registrados.</p>'
          : `<div tabindex="0" role="region" aria-labelledby="cat-table-caption" class="table-wrapper">
              <table style="--label-2:'Tipo'; --label-3:'Movimientos'; --label-4:'Total';">
                <caption id="cat-table-caption" class="text-muted" style="padding:0.5rem;">Totales por categoría en todos los medios de pago</caption>
                <thead>
                  <tr>
                    <th>Categoría</th>
                    <th>Tipo</th>
                    <th>Movimientos</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${globalAnalytics.byCategory
                    .map(
                      c => `<tr>
                        <th>${escapeHtml(c.category)}</th>
                        <td><span class="badge">${c.kind === 'ingreso' ? 'Ingreso' : 'Expensa / Egreso'}</span></td>
                        <td>${c.count}</td>
                        <td class="${c.kind === 'ingreso' ? 'text-ok' : 'text-danger'}"><strong>${formatMoney(c.total)}</strong></td>
                      </tr>`
                    )
                    .join('')}
                </tbody>
              </table>
            </div>`
      }
    </section>

    <!-- Billeteras y Medios de Pago -->
    <section class="card" aria-labelledby="wallets-title">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem; margin-block-end:0.5rem;">
        <div>
          <h2 id="wallets-title" style="margin:0;"><i class="fa-solid fa-credit-card"></i> Billeteras y Tarjetas</h2>
          <p class="text-muted" style="margin:0.25rem 0 0 0;">Configura tus tarjetas, medios de pago o consulta su analítica detallada.</p>
        </div>
      </div>

      <div class="grid-3" style="margin-block:1rem;">
        ${wallets
          .map(w => {
            const ownerLabel =
              w.owner_user_id === state.user.id
                ? state.user.first_name
                : w.owner_user_id && state.partner && w.owner_user_id === state.partner.id
                ? state.partner.first_name
                : 'Compartida (Ambos)';
            const isSelected = selectedWallet && selectedWallet.id === w.id;
            return `<div class="stat-box" style="border-width:${isSelected ? '2px' : '1px'}; border-color:${isSelected ? 'var(--brand)' : 'var(--border)'};">
              <div style="display:flex; justify-content:space-between; align-items:start; gap:0.4rem;">
                <strong>${escapeHtml(w.name)}</strong>
                <span class="badge">${escapeHtml(w.type)}</span>
              </div>
              <div class="text-muted">Dueño: ${escapeHtml(ownerLabel)} ${w.details ? `· ${escapeHtml(w.details)}` : ''}</div>
              <div class="stat-value">${formatMoney(w.balance)}</div>
              <div class="text-muted" style="margin-block:0.35rem;">
                <span class="text-ok">+${formatMoney(w.income)}</span> / <span class="text-danger">-${formatMoney(w.expense)}</span>
              </div>
              <div style="display:flex; gap:0.35rem; flex-wrap:wrap; margin-block-start:0.5rem;">
                <button type="button" class="btn btn-sm ${isSelected ? 'btn-primary' : ''}" data-action="select-wallet" data-id="${w.id}">
                  ${isSelected ? 'Viendo Analítica' : 'Ver Analítica'}
                </button>
                <button type="button" class="btn btn-sm" data-action="open-wallet-config" data-wallet='${escapeHtml(JSON.stringify(w))}'>
                  <i class="fa-solid fa-gear"></i> Configurar
                </button>
                <button type="button" class="btn btn-sm btn-danger" data-action="delete-wallet" data-id="${w.id}" aria-label="Eliminar billetera ${escapeHtml(w.name)}"><i class="fa-solid fa-xmark"></i></button>
              </div>
            </div>`;
          })
          .join('')}
      </div>

      ${
        selectedWallet
          ? `<div class="card" style="background:var(--surface-alt);">
              <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap;">
                <h3 style="margin:0;"><i class="fa-solid fa-magnifying-glass-chart"></i> Analítica de: ${escapeHtml(selectedWallet.name)} (${escapeHtml(selectedWallet.type)})</h3>
                <button type="button" class="btn btn-sm" data-action="select-wallet" data-id="">Cerrar detalle</button>
              </div>
              <p class="text-muted">Ingresos en este medio: <strong class="text-ok">+${formatMoney(selectedWallet.income)}</strong> · Egresos en este medio: <strong class="text-danger">-${formatMoney(selectedWallet.expense)}</strong> · Saldo actual: <strong>${formatMoney(selectedWallet.balance)}</strong></p>
              ${renderTransactionsTable(selectedWallet.transactions, `Movimientos de ${selectedWallet.name}`)}
            </div>`
          : ''
      }
    </section>

    <!-- Débitos y Pagos Mensuales por Servicios -->
    <section class="card" aria-labelledby="recurring-title">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem;">
        <div>
          <h2 id="recurring-title" style="margin:0;"><i class="fa-solid fa-arrows-rotate"></i> Débitos y Pagos Mensuales por Servicios</h2>
          <p class="text-muted" style="margin:0.25rem 0 0 0;">Llegada la fecha configurada, el dinero se descuenta automáticamente de la cuenta y se suma al balance (ej: Disney+ $7.500).</p>
        </div>
        <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
          <button type="button" class="btn btn-sm btn-primary" data-action="open-service-dialog">
            <i class="fa-solid fa-plus"></i> Programar Servicio / Débito
          </button>
          <button type="button" class="btn btn-sm" data-action="process-recurring-debits">
            <i class="fa-solid fa-bolt"></i> Procesar Débitos Ahora
          </button>
        </div>
      </div>

      <div class="stat-box" style="margin-block:1rem; border-color:var(--brand);">
        <div class="text-muted">Total mensual en servicios automáticos activos:</div>
        <div class="stat-value" style="color:var(--danger);">${formatMoney(totalMonthlyServices)} / mes</div>
        <small class="text-muted">${activeServices.length} servicios activos de ${recurringServices.length} programados.</small>
      </div>

      ${
        recurringServices.length === 0
          ? '<p class="text-muted">No hay débitos mensuales programados aún. Haz clic en "Programar Servicio / Débito" para agregar suscripciones como Disney, Netflix, Spotify, alquiler, internet o luz.</p>'
          : `<div class="grid-2">
              ${recurringServices
                .map(s => {
                  const currentMonth = new Date().toISOString().slice(0, 7);
                  const isDebitedThisMonth = s.last_processed_date === currentMonth;
                  const whoName = s.user_first_name || 'Ambos';
                  return `<div class="stat-box" style="opacity:${s.active ? '1' : '0.65'};">
                    <div style="display:flex; justify-content:space-between; align-items:start; gap:0.5rem;">
                      <div>
                        <strong>${escapeHtml(s.name)}</strong>
                        <span class="badge">${escapeHtml(s.category)}</span>
                        ${s.active ? '<span class="badge" style="background:var(--ok); color:#000;">Activo</span>' : '<span class="badge">Pausado</span>'}
                      </div>
                      <div class="stat-value" style="font-size:1.25rem; color:var(--danger); margin:0;">
                        ${formatMoney(s.amount)}
                      </div>
                    </div>
                    <p style="margin:0.4rem 0;">
                      <i class="fa-solid fa-calendar-day"></i> <strong>Día ${s.day_of_month} de cada mes</strong> · Medio: <strong>${escapeHtml(s.wallet_name || 'Billetera')}</strong> (${escapeHtml(s.wallet_type || '')})
                    </p>
                    <p class="text-muted" style="margin:0.2rem 0; font-size:0.85rem;">
                      A cargo de: ${escapeHtml(whoName)} · Modo: ${escapeHtml(s.mode)} ${s.description ? `· ${escapeHtml(s.description)}` : ''}
                    </p>
                    <div style="margin-block:0.4rem; font-size:0.85rem;">
                      ${isDebitedThisMonth ? '<span class="text-ok"><i class="fa-solid fa-circle-check"></i> Descontado en el balance este mes</span>' : '<span class="text-muted"><i class="fa-solid fa-hourglass-half"></i> Pendiente para el día ' + s.day_of_month + '</span>'}
                    </div>
                    <div style="display:flex; gap:0.35rem; flex-wrap:wrap; margin-block-start:0.5rem;">
                      <button type="button" class="btn btn-sm" data-action="toggle-service" data-id="${s.id}" data-active="${s.active ? 0 : 1}">
                        ${s.active ? '<i class="fa-solid fa-pause"></i> Pausar' : '<i class="fa-solid fa-play"></i> Activar'}
                      </button>
                      <button type="button" class="btn btn-sm" data-action="edit-service" data-service='${escapeHtml(JSON.stringify(s))}'>
                        <i class="fa-solid fa-pen-to-square"></i> Editar
                      </button>
                      <button type="button" class="btn btn-sm btn-danger" data-action="delete-service" data-id="${s.id}">
                        <i class="fa-solid fa-xmark"></i>
                      </button>
                    </div>
                  </div>`;
                })
                .join('')}
            </div>`
      }
    </section>

    <!-- Formularios para Registrar Movimiento y Agregar Billetera -->
    <div class="grid-2">
      <section class="card" aria-labelledby="new-tx-title">
        <h2 id="new-tx-title"><i class="fa-solid fa-plus"></i> Registrar Movimiento Manual</h2>
        <form id="form-new-transaction">
          <div class="grid-2">
            <div class="field">
              <label for="tx-kind">Tipo de movimiento *</label>
              <select id="tx-kind" name="kind" required>
                <option value="egreso">Egreso / Gasto</option>
                <option value="ingreso">Ingreso de dinero</option>
              </select>
            </div>
            <div class="field">
              <label for="tx-scope">Alcance *</label>
              <select id="tx-scope" name="scope" required>
                <option value="compartido">Gasto / Ingreso Compartido</option>
                <option value="particular">Gasto / Ingreso Particular</option>
              </select>
            </div>
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="tx-wallet">Medio de pago (Billetera) *</label>
              <select id="tx-wallet" name="wallet_id" required>
                ${wallets.map(w => `<option value="${w.id}">${escapeHtml(w.name)} (${escapeHtml(w.type)})</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label for="tx-mode">Modo de operación *</label>
              <select id="tx-mode" name="mode" required>
                <option value="transferencia">Transferencia</option>
                <option value="efectivo">Efectivo</option>
                <option value="tarjeta_credito">Tarjeta de Crédito</option>
                <option value="tarjeta_debito">Tarjeta de Débito</option>
                <option value="debito_automatico">Débito Automático</option>
                <option value="qr">QR / Billetera Virtual</option>
              </select>
            </div>
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="tx-who">¿Quién realizó la acción? *</label>
              <select id="tx-who" name="user_id" required>
                <option value="${state.user.id}">${escapeHtml(state.user.first_name)}</option>
                ${state.partner ? `<option value="${state.partner.id}">${escapeHtml(state.partner.first_name)}</option>` : ''}
              </select>
            </div>
            <div class="field">
              <label for="tx-amount">Monto *</label>
              <input type="number" id="tx-amount" name="amount" step="0.01" min="0.01" required>
            </div>
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="tx-category">Categoría (En qué se gastó / origen) *</label>
              <input type="text" id="tx-category" name="category" placeholder="Ej: Supermercado, Alquiler, Cita, Sueldo" required>
            </div>
            <div class="field">
              <label for="tx-date">Fecha *</label>
              <input type="date" id="tx-date" name="date" value="${new Date().toISOString().slice(0, 10)}" required>
            </div>
          </div>
          <div class="field">
            <label for="tx-desc">Detalle adicional</label>
            <input type="text" id="tx-desc" name="description" placeholder="Ej: Compra semanal en Coto">
          </div>
          <button type="submit" class="btn btn-primary">Guardar Movimiento</button>
        </form>
      </section>

      <section class="card" aria-labelledby="new-wallet-title">
        <h2 id="new-wallet-title"><i class="fa-solid fa-building-columns"></i> Agregar Medio de Pago / Billetera</h2>
        <form id="form-new-wallet">
          <div class="field">
            <label for="w-name">Nombre del medio de pago *</label>
            <input type="text" id="w-name" name="name" placeholder="Ej: Visa Galicia, MercadoPago, Efectivo Casa" required>
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="w-type">Tipo *</label>
              <select id="w-type" name="type" required>
                <option value="billetera_virtual">Billetera Virtual</option>
                <option value="tarjeta_credito">Tarjeta de Crédito</option>
                <option value="tarjeta_debito">Tarjeta de Débito</option>
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Cuenta Bancaria</option>
              </select>
            </div>
            <div class="field">
              <label for="w-owner">Dueño de la billetera</label>
              <select id="w-owner" name="owner_user_id">
                <option value="">Compartida (Ambos)</option>
                <option value="${state.user.id}">${escapeHtml(state.user.first_name)}</option>
                ${state.partner ? `<option value="${state.partner.id}">${escapeHtml(state.partner.first_name)}</option>` : ''}
              </select>
            </div>
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="w-balance">Monto / Saldo inicial</label>
              <input type="number" id="w-balance" name="initial_balance" step="0.01" value="0">
            </div>
            <div class="field">
              <label for="w-details">Datos / Alias / Últimos 4 dígitos</label>
              <input type="text" id="w-details" name="details" placeholder="Ej: Alias pareja.mp / *4512">
            </div>
          </div>
          <button type="submit" class="btn btn-primary"><i class="fa-solid fa-plus"></i> Crear Billetera</button>
        </form>
      </section>
    </div>

    <!-- Historial de Movimientos -->
    <section class="card">
      <h2><i class="fa-solid fa-receipt"></i> Historial Global de Movimientos</h2>
      ${renderTransactionsTable(transactions, 'Todos los movimientos de la pareja')}
    </section>

    <!-- Diálogo nativo: Configurar Tarjeta / Billetera -->
    <dialog id="dialog-config-wallet" aria-labelledby="wallet-config-title">
      <h2 id="wallet-config-title"><i class="fa-solid fa-gear"></i> Configuración del Medio de Pago</h2>
      <p class="text-muted">Modifica el nombre, tipo, saldo o datos faltantes de esta tarjeta o billetera.</p>
      <div id="wallet-dialog-error" class="card text-danger" style="display:none; margin-block:0.5rem; padding:0.5rem 0.75rem; border-color:var(--danger); background:rgba(255,0,0,0.08); font-size:0.9rem;"></div>
      <form id="form-config-wallet">
        <input type="hidden" id="cfg-wallet-id" name="id">
        <div class="field">
          <label for="cfg-wallet-name">Nombre del medio de pago *</label>
          <input type="text" id="cfg-wallet-name" name="name" required>
        </div>
        <div class="grid-2">
          <div class="field">
            <label for="cfg-wallet-type">Tipo de medio *</label>
            <select id="cfg-wallet-type" name="type" required>
              <option value="tarjeta_credito">Tarjeta de Crédito</option>
              <option value="tarjeta_debito">Tarjeta de Débito</option>
              <option value="billetera_virtual">Billetera Virtual</option>
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Cuenta Bancaria</option>
            </select>
          </div>
          <div class="field">
            <label for="cfg-wallet-owner">Dueño</label>
            <select id="cfg-wallet-owner" name="owner_user_id">
              <option value="">Compartida (Ambos)</option>
              <option value="${state.user.id}">${escapeHtml(state.user.first_name)}</option>
              ${state.partner ? `<option value="${state.partner.id}">${escapeHtml(state.partner.first_name)}</option>` : ''}
            </select>
          </div>
        </div>
        <div class="grid-2">
          <div class="field">
            <label for="cfg-wallet-balance">Saldo Inicial</label>
            <input type="number" id="cfg-wallet-balance" name="initial_balance" step="0.01">
          </div>
          <div class="field">
            <label for="cfg-wallet-details">Datos / Alias / Últimos 4 dígitos</label>
            <input type="text" id="cfg-wallet-details" name="details" placeholder="Ej: *9821 / Alias">
          </div>
        </div>
        <div style="display:flex; justify-content:flex-end; gap:0.5rem; margin-top:1rem;">
          <button type="button" class="btn" data-action="close-wallet-dialog" id="btn-close-wallet-dialog">Cancelar</button>
          <button type="submit" class="btn btn-primary" id="btn-submit-wallet">Guardar Cambios</button>
        </div>
      </form>
    </dialog>

    <!-- Diálogo nativo: Programar / Editar Servicio Mensual Recurrente -->
    <dialog id="dialog-recurring-service" aria-labelledby="service-dialog-title">
      <h2 id="service-dialog-title"><i class="fa-solid fa-arrows-rotate"></i> Programar Débito / Servicio Mensual</h2>
      <p class="text-muted">Llegada la fecha configurada cada mes, el sistema registrará el egreso y descontará automáticamente el dinero de la cuenta.</p>
      <div id="service-dialog-error" class="card text-danger" style="display:none; margin-block:0.5rem; padding:0.5rem 0.75rem; border-color:var(--danger); background:rgba(255,0,0,0.08); font-size:0.9rem;"></div>
      <form id="form-recurring-service">
        <input type="hidden" id="srv-id" name="id">
        <div class="grid-2">
          <div class="field">
            <label for="srv-name">Nombre del servicio *</label>
            <input type="text" id="srv-name" name="name" placeholder="Ej: Disney+, Netflix, Alquiler, Spotify" required>
          </div>
          <div class="field">
            <label for="srv-wallet">Medio de pago / Tarjeta donde se debita *</label>
            <select id="srv-wallet" name="wallet_id" required>
              ${wallets.length === 0
                ? '<option value="">Primero agrega una billetera arriba</option>'
                : wallets.map(w => `<option value="${w.id}">${escapeHtml(w.name)} (${escapeHtml(w.type)})</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="grid-3">
          <div class="field">
            <label for="srv-amount">Monto a descontar *</label>
            <input type="number" id="srv-amount" name="amount" step="0.01" min="0.01" placeholder="Ej: 7500" required>
          </div>
          <div class="field">
            <label for="srv-day">Día del mes de cobro (1 al 31) *</label>
            <input type="number" id="srv-day" name="day_of_month" min="1" max="31" value="10" required>
          </div>
          <div class="field">
            <label for="srv-category">Categoría</label>
            <input type="text" id="srv-category" name="category" value="Suscripciones y Servicios" required>
          </div>
        </div>
        <div class="grid-2">
          <div class="field">
            <label for="srv-user">Titular / Responsable</label>
            <select id="srv-user" name="user_id">
              <option value="${state.user.id}">${escapeHtml(state.user.first_name)}</option>
              ${state.partner ? `<option value="${state.partner.id}">${escapeHtml(state.partner.first_name)}</option>` : ''}
            </select>
          </div>
          <div class="field">
            <label for="srv-scope">Alcance</label>
            <select id="srv-scope" name="scope">
              <option value="compartido">Compartido</option>
              <option value="particular">Particular</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label for="srv-desc">Descripción o notas (opcional)</label>
          <input type="text" id="srv-desc" name="description" placeholder="Ej: Plan estándar familiar con impuestos">
        </div>
        <div style="display:flex; justify-content:flex-end; gap:0.5rem; margin-top:1rem;">
          <button type="button" class="btn" data-action="close-service-dialog" id="btn-close-service-dialog">Cancelar</button>
          <button type="submit" class="btn btn-primary" id="btn-submit-service">Guardar Débito Mensual</button>
        </div>
      </form>
    </dialog>
  `;

  // Controladores de cierre y guardado directo de modales
  document.getElementById('btn-close-wallet-dialog')?.addEventListener('click', () => {
    const dialog = document.getElementById('dialog-config-wallet');
    if (dialog) {
      try { dialog.close(); } catch (_) {}
      dialog.removeAttribute('open');
    }
  });
  document.getElementById('btn-close-service-dialog')?.addEventListener('click', () => {
    const dialog = document.getElementById('dialog-recurring-service');
    if (dialog) {
      try { dialog.close(); } catch (_) {}
      dialog.removeAttribute('open');
    }
  });

  // Envío directo del formulario de débito / servicio mensual para máxima fiabilidad
  const srvForm = document.getElementById('form-recurring-service');
  srvForm?.addEventListener('submit', async e => {
    e.preventDefault();
    e.stopPropagation();
    const btn = document.getElementById('btn-submit-service');
    const errBox = document.getElementById('service-dialog-error');
    if (errBox) { errBox.style.display = 'none'; errBox.textContent = ''; }
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

    try {
      const fd = new FormData(srvForm);
      const data = Object.fromEntries(fd.entries());
      await economyFeature.forms['form-recurring-service'](ctx, data, srvForm);
    } catch (err) {
      if (errBox) {
        errBox.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> ' + escapeHtml(err.message);
        errBox.style.display = 'block';
      }
      ctx?.showStatus?.(err.message, true);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Guardar Débito Mensual'; }
    }
  });

  // Envío directo del formulario de configurar billetera
  const walletForm = document.getElementById('form-config-wallet');
  walletForm?.addEventListener('submit', async e => {
    e.preventDefault();
    e.stopPropagation();
    const btn = document.getElementById('btn-submit-wallet');
    const errBox = document.getElementById('wallet-dialog-error');
    if (errBox) { errBox.style.display = 'none'; errBox.textContent = ''; }
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

    try {
      const fd = new FormData(walletForm);
      const data = Object.fromEntries(fd.entries());
      await economyFeature.forms['form-config-wallet'](ctx, data, walletForm);
    } catch (err) {
      if (errBox) {
        errBox.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> ' + escapeHtml(err.message);
        errBox.style.display = 'block';
      }
      ctx?.showStatus?.(err.message, true);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Guardar Cambios'; }
    }
  });
}

function renderTransactionsTable(txs, captionText) {
  if (!txs || txs.length === 0) {
    return '<p class="text-muted">Sin movimientos registrados.</p>';
  }
  return `
    <div tabindex="0" role="region" aria-label="${escapeHtml(captionText)}" class="table-wrapper">
      <table style="--label-2:'Medio / Modo'; --label-3:'En qué / Categoría'; --label-4:'Quién'; --label-5:'Monto'; --label-6:'Acción';">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Medio / Modo</th>
            <th>En qué se gastó / Categoría</th>
            <th>Quién lo realizó</th>
            <th>Monto</th>
            <th>Acción</th>
          </tr>
        </thead>
        <tbody>
          ${txs
            .map(
              tx => `<tr>
                <th>${escapeHtml(tx.date)}</th>
                <td>${escapeHtml(tx.wallet_name || '')} <span class="badge">${escapeHtml(tx.mode)} · ${escapeHtml(tx.scope)}</span></td>
                <td><strong>${escapeHtml(tx.category)}</strong> ${tx.description ? `— ${escapeHtml(tx.description)}` : ''}</td>
                <td>${escapeHtml(tx.user_first_name || '')}</td>
                <td class="${tx.kind === 'ingreso' ? 'text-ok' : 'text-danger'}">
                  <strong>${tx.kind === 'ingreso' ? '+' : '-'}${formatMoney(tx.amount)}</strong>
                </td>
                <td>
                  <button type="button" class="btn btn-sm btn-danger" data-action="delete-tx" data-id="${tx.id}">Eliminar</button>
                </td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

const economyFeature = {
  id: 'economy',
  render: renderEconomyTab,
  actions: {
    'select-wallet': (ctx, el) => {
      state.selectedWalletId = el.dataset.id ? Number(el.dataset.id) : null;
      ctx.refresh();
    },
    'open-wallet-config': (ctx, el) => {
      const w = JSON.parse(el.dataset.wallet || '{}');
      const dialog = document.getElementById('dialog-config-wallet');
      if (!dialog) return;
      document.getElementById('cfg-wallet-id').value = w.id || '';
      document.getElementById('cfg-wallet-name').value = w.name || '';
      document.getElementById('cfg-wallet-type').value = w.type || 'billetera_virtual';
      document.getElementById('cfg-wallet-owner').value = w.owner_user_id || '';
      document.getElementById('cfg-wallet-balance').value = w.initial_balance !== undefined ? w.initial_balance : 0;
      document.getElementById('cfg-wallet-details').value = w.details || '';
      dialog.showModal();
    },
    'delete-wallet': async (ctx, el) => {
      await api(`/api/wallets/${el.dataset.id}`, { method: 'DELETE' });
      ctx.refresh();
    },
    'delete-tx': async (ctx, el) => {
      await api(`/api/transactions/${el.dataset.id}`, { method: 'DELETE' });
      ctx.refresh();
    },
    'open-service-dialog': (ctx) => {
      const dialog = document.getElementById('dialog-recurring-service');
      if (!dialog) return;
      document.getElementById('form-recurring-service')?.reset();
      document.getElementById('srv-id').value = '';
      const errBox = document.getElementById('service-dialog-error');
      if (errBox) { errBox.style.display = 'none'; errBox.textContent = ''; }
      document.getElementById('service-dialog-title').innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Programar Débito / Servicio Mensual';
      if (!dialog.open) {
        dialog.showModal();
      }
    },
    'edit-service': (ctx, el) => {
      const s = JSON.parse(el.dataset.service || '{}');
      const dialog = document.getElementById('dialog-recurring-service');
      if (!dialog) return;
      document.getElementById('srv-id').value = s.id || '';
      document.getElementById('srv-name').value = s.name || '';
      document.getElementById('srv-wallet').value = s.wallet_id || '';
      document.getElementById('srv-amount').value = s.amount || '';
      document.getElementById('srv-day').value = s.day_of_month || 10;
      document.getElementById('srv-category').value = s.category || 'Suscripciones y Servicios';
      document.getElementById('srv-user').value = s.user_id || state.user.id;
      document.getElementById('srv-scope').value = s.scope || 'compartido';
      document.getElementById('srv-desc').value = s.description || '';
      const errBox = document.getElementById('service-dialog-error');
      if (errBox) { errBox.style.display = 'none'; errBox.textContent = ''; }
      document.getElementById('service-dialog-title').innerHTML = `<i class="fa-solid fa-pen-to-square"></i> Editar Servicio: ${escapeHtml(s.name)}`;
      if (!dialog.open) {
        dialog.showModal();
      }
    },
    'toggle-service': async (ctx, el) => {
      const id = el.dataset.id;
      const active = el.dataset.active === '1';
      await api(`/api/recurring-services/${id}`, {
        method: 'PATCH',
        body: { active }
      });
      ctx.showStatus(active ? 'Servicio mensual activado.' : 'Servicio mensual pausado.');
      ctx.refresh();
    },
    'delete-service': async (ctx, el) => {
      await api(`/api/recurring-services/${el.dataset.id}`, { method: 'DELETE' });
      ctx.showStatus('Servicio recurrente eliminado.');
      ctx.refresh();
    },
    'process-recurring-debits': async (ctx) => {
      const res = await api('/api/recurring-services/process', { method: 'POST' });
      ctx.showStatus(`Débitos automáticos procesados. Se aplicaron ${res.applied || 0} débitos vencidos.`);
      ctx.refresh();
    },
    'close-wallet-dialog': () => {
      const dialog = document.getElementById('dialog-config-wallet');
      if (dialog) {
        try { dialog.close(); } catch (_) {}
        dialog.removeAttribute('open');
      }
    },
    'close-service-dialog': () => {
      const dialog = document.getElementById('dialog-recurring-service');
      if (dialog) {
        try { dialog.close(); } catch (_) {}
        dialog.removeAttribute('open');
      }
    }
  },
  forms: {
    'form-new-transaction': async (ctx, data) => {
      await api('/api/transactions', { method: 'POST', body: data });
      ctx.showStatus('Movimiento registrado.');
      ctx.refresh();
    },
    'form-new-wallet': async (ctx, data) => {
      await api('/api/wallets', { method: 'POST', body: data });
      ctx.showStatus('Medio de pago creado.');
      ctx.refresh();
    },
    'form-config-wallet': async (ctx, data) => {
      const id = data.id;
      const dialog = document.getElementById('dialog-config-wallet');
      await api(`/api/wallets/${id}`, {
        method: 'PUT',
        body: {
          name: String(data.name || '').trim(),
          type: data.type,
          owner_user_id: data.owner_user_id ? Number(data.owner_user_id) : null,
          details: data.details,
          initial_balance: Number(data.initial_balance || 0)
        }
      });
      if (dialog) {
        try { dialog.close(); } catch (_) {}
        dialog.removeAttribute('open');
      }
      ctx.showStatus('Configuración del medio de pago actualizada.');
      await ctx.refresh();
    },
    'form-recurring-service': async (ctx, data) => {
      const dialog = document.getElementById('dialog-recurring-service');
      const id = data.id ? Number(data.id) : null;
      const walletId = Number(data.wallet_id);
      const rawAmount = String(data.amount || '').replace(',', '.').trim();
      const amount = Number(rawAmount);
      const dayOfMonth = Math.min(Math.max(1, Number(data.day_of_month || 1)), 31);
      const name = String(data.name || '').trim();

      if (!name) {
        throw new Error('Ingresa el nombre del servicio (ej: Disney+, Netflix).');
      }
      if (!walletId || isNaN(walletId)) {
        throw new Error('Selecciona un medio de pago / tarjeta válido.');
      }
      if (!amount || isNaN(amount) || amount <= 0) {
        throw new Error('Ingresa un monto válido mayor a 0 (ej: 7500).');
      }

      const payload = {
        name,
        wallet_id: walletId,
        amount,
        day_of_month: dayOfMonth,
        category: String(data.category || 'Suscripciones y Servicios').trim(),
        user_id: data.user_id ? Number(data.user_id) : state.user.id,
        scope: data.scope || 'compartido',
        mode: 'debito_automatico',
        description: String(data.description || '').trim()
      };

      if (id) {
        await api(`/api/recurring-services/${id}`, {
          method: 'PUT',
          body: payload
        });
        ctx.showStatus('Servicio mensual actualizado correctamente.');
      } else {
        await api('/api/recurring-services', {
          method: 'POST',
          body: payload
        });
        ctx.showStatus('Servicio mensual programado con éxito.');
      }

      if (dialog) {
        try { dialog.close(); } catch (_) {}
        dialog.removeAttribute('open');
      }
      await ctx.refresh();
    }
  }
};

export default economyFeature;
