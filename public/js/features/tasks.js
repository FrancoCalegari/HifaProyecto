import { state } from '../core/state.js';
import { api } from '../core/api.js';
import { escapeHtml } from '../core/utils.js';

/* ================= TAREAS Y TABLEROS COMPARTIDOS ================= */
async function renderTasksTab(container) {
  const { tasks } = await api('/api/tasks');
  const boards = Array.from(new Set(['General', 'Hogar', 'Compras y Trámites', ...tasks.map(t => t.board_name)]));

  container.innerHTML = `
    <section class="card">
      <h2><i class="fa-solid fa-list-check"></i> Tableros de Tareas Compartidos</h2>
      <form id="form-new-task">
        <div class="grid-3">
          <div class="field">
            <label for="task-title">Tarea propuesta *</label>
            <input type="text" id="task-title" name="title" placeholder="Ej: Pagar expensas, Limpiar balcón" required>
          </div>
          <div class="field">
            <label for="task-board">Tablero</label>
            <input type="text" id="task-board" name="board_name" list="board-suggestions" value="General" required>
            <datalist id="board-suggestions">
              ${boards.map(b => `<option value="${escapeHtml(b)}">`).join('')}
            </datalist>
          </div>
          <div class="field">
            <label for="task-priority">Prioridad</label>
            <select id="task-priority" name="priority">
              <option value="alta">Alta</option>
              <option value="media" selected>Media</option>
              <option value="baja">Baja</option>
            </select>
          </div>
        </div>
        <div class="grid-2">
          <div class="field">
            <label for="task-assigned">¿Para quién es?</label>
            <select id="task-assigned" name="assigned_to">
              <option value="both">Ambos</option>
              <option value="${state.user.id}">${escapeHtml(state.user.first_name)}</option>
              ${state.partner ? `<option value="${state.partner.id}">${escapeHtml(state.partner.first_name)}</option>` : ''}
            </select>
          </div>
          <div class="field">
            <label for="task-due">Fecha y hora de la tarea</label>
            <input type="datetime-local" id="task-due" name="due_datetime">
          </div>
        </div>
        <button type="submit" class="btn btn-primary"><i class="fa-solid fa-plus"></i> Agregar Tarea al Tablero</button>
      </form>
    </section>

    <div class="grid-2">
      ${boards
        .map(board => {
          const boardTasks = tasks.filter(t => t.board_name === board);
          return `<section class="card">
            <h3><i class="fa-solid fa-list-check"></i> Tablero: ${escapeHtml(board)} (${boardTasks.length})</h3>
            ${
              boardTasks.length === 0
                ? '<p class="text-muted">Sin tareas en este tablero.</p>'
                : `<ul style="list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:0.6rem;">
                    ${boardTasks
                      .map(t => {
                        const who =
                          t.assigned_to === 'both'
                            ? 'Ambos'
                            : Number(t.assigned_to) === state.user.id
                            ? state.user.first_name
                            : state.partner?.first_name || 'Pareja';
                        return `<li class="stat-box" style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem;">
                          <label style="display:flex; align-items:center; gap:0.6rem; font-weight:500; cursor:pointer;">
                            <input type="checkbox" data-action="toggle-task" data-id="${t.id}" ${t.completed ? 'checked' : ''}>
                            <span style="${t.completed ? 'text-decoration:line-through; opacity:0.6;' : ''}">
                              <strong>${escapeHtml(t.title)}</strong>
                              <span class="badge">${escapeHtml(t.priority)}</span>
                              <span class="badge">Para: ${escapeHtml(who)}</span>
                              ${t.due_datetime ? `<small class="text-muted"> · <i class="fa-regular fa-clock"></i> ${escapeHtml(t.due_datetime.replace('T', ' '))}</small>` : ''}
                            </span>
                          </label>
                          <button type="button" class="btn btn-sm btn-danger" data-action="delete-task" data-id="${t.id}" aria-label="Eliminar"><i class="fa-solid fa-trash-can"></i></button>
                        </li>`;
                      })
                      .join('')}
                  </ul>`
            }
          </section>`;
        })
        .join('')}
    </div>
  `;
}

export default {
  id: 'tasks',
  render: renderTasksTab,
  actions: {
    'toggle-task': async (ctx, el) => {
      await api(`/api/tasks/${el.dataset.id}`, { method: 'PATCH', body: { completed: el.checked } });
      ctx.refresh();
    },
    'delete-task': async (ctx, el) => {
      await api(`/api/tasks/${el.dataset.id}`, { method: 'DELETE' });
      ctx.refresh();
    }
  },
  forms: {
    'form-new-task': async (ctx, data) => {
      await api('/api/tasks', { method: 'POST', body: data });
      ctx.showStatus('Tarea agregada al tablero.');
      ctx.refresh();
    }
  }
};
