import { state } from '../core/state.js';
import { api } from '../core/api.js';
import { escapeHtml, formatMoney } from '../core/utils.js';

/* ================= FASE 2: ECONOMÍA, BILLETERAS Y ANALÍTICA ================= */
async function renderEconomyTab(container) {
  const data = await api('/api/economy');
  const { wallets, transactions, globalAnalytics } = data;
  const selectedWallet = wallets.find(w => w.id === state.selectedWalletId) || null;

  container.innerHTML = `
    <section class="card" aria-labelledby="econ-global-title">
      <h2 id="econ-global-title">📊 Analítica Global (Todos los Medios de Pago)</h2>
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

    <section class="card" aria-labelledby="wallets-title">
      <h2 id="wallets-title">💳 Billeteras y Medios de Pago (Separados por Dueño)</h2>
      <p class="text-muted">Selecciona cualquier medio de pago para inspeccionar su analítica individual y sus movimientos detallados.</p>
      <div class="grid-3" style="margin-block-end:1rem;">
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
              <div style="display:flex; justify-content:space-between; align-items:start;">
                <strong>${escapeHtml(w.name)}</strong>
                <span class="badge">${escapeHtml(w.type)}</span>
              </div>
              <div class="text-muted">Dueño: ${escapeHtml(ownerLabel)} ${w.details ? `· ${escapeHtml(w.details)}` : ''}</div>
              <div class="stat-value">${formatMoney(w.balance)}</div>
              <div class="text-muted" style="margin-block:0.35rem;">
                <span class="text-ok">+${formatMoney(w.income)}</span> / <span class="text-danger">-${formatMoney(w.expense)}</span>
              </div>
              <div style="display:flex; gap:0.4rem; margin-block-start:0.5rem;">
                <button type="button" class="btn btn-sm ${isSelected ? 'btn-primary' : ''}" data-action="select-wallet" data-id="${w.id}">
                  ${isSelected ? 'Viendo Analítica' : 'Ver Analítica del Medio'}
                </button>
                <button type="button" class="btn btn-sm btn-danger" data-action="delete-wallet" data-id="${w.id}" aria-label="Eliminar billetera ${escapeHtml(w.name)}">✕</button>
              </div>
            </div>`;
          })
          .join('')}
      </div>

      ${
        selectedWallet
          ? `<div class="card" style="background:var(--surface-alt);">
              <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap;">
                <h3 style="margin:0;">🔍 Analítica de: ${escapeHtml(selectedWallet.name)} (${escapeHtml(selectedWallet.type)})</h3>
                <button type="button" class="btn btn-sm" data-action="select-wallet" data-id="">Cerrar detalle</button>
              </div>
              <p class="text-muted">Ingresos en este medio: <strong class="text-ok">+${formatMoney(selectedWallet.income)}</strong> · Egresos en este medio: <strong class="text-danger">-${formatMoney(selectedWallet.expense)}</strong> · Saldo actual: <strong>${formatMoney(selectedWallet.balance)}</strong></p>
              ${renderTransactionsTable(selectedWallet.transactions, `Movimientos de ${selectedWallet.name}`)}
            </div>`
          : ''
      }
    </section>

    <div class="grid-2">
      <section class="card" aria-labelledby="new-tx-title">
        <h2 id="new-tx-title">➕ Registrar Movimiento (Ingreso / Egreso)</h2>
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
        <h2 id="new-wallet-title">🏦 Agregar Medio de Pago / Billetera</h2>
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
          <button type="submit" class="btn btn-primary">Crear Billetera</button>
        </form>
      </section>
    </div>

    <section class="card">
      <h2>📜 Historial Global de Movimientos</h2>
      ${renderTransactionsTable(transactions, 'Todos los movimientos de la pareja')}
    </section>
  `;
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

export default {
  id: 'economy',
  render: renderEconomyTab,
  actions: {
    'select-wallet': (ctx, el) => {
      state.selectedWalletId = el.dataset.id ? Number(el.dataset.id) : null;
      ctx.refresh();
    },
    'delete-wallet': async (ctx, el) => {
      await api(`/api/wallets/${el.dataset.id}`, { method: 'DELETE' });
      ctx.refresh();
    },
    'delete-tx': async (ctx, el) => {
      await api(`/api/transactions/${el.dataset.id}`, { method: 'DELETE' });
      ctx.refresh();
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
    }
  }
};
