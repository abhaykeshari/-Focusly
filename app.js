/* =========================
   Constants and state
   ========================= */
const KEY = 'taskflow.v1';
const DEF = [['personal', 'Personal'], ['work', 'Work'], ['study', 'Study'], ['shopping', 'Shopping'], ['health', 'Health'], ['other', 'Other']].map(([id, name]) => ({ id, name }));
const DEF_IDS = DEF.map((c) => c.id);
const PL = { high: 'High', medium: 'Medium', low: 'Low' };
const PO = { high: 0, medium: 1, low: 2 };
const CATCOL = ['#6366F1', '#8B5CF6', '#06B6D4', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#64748B'];
const LABEL = {
  dashboard: 'Your tasks',
  all: 'All tasks',
  today: 'Due today',
  upcoming: 'Upcoming',
  overdue: 'Overdue',
  completed: 'Completed',
  important: 'Important',
  pending: 'Pending',
  high: 'High priority',
};

const NAV = [
  ['dashboard', 'Dashboard', () => true],
  ['all', 'All tasks', () => true],
  ['today', 'Today', (t) => isToday(t)],
  ['upcoming', 'Upcoming', (t) => isUpcoming(t)],
  ['overdue', 'Overdue', (t) => isOverdue(t)],
  ['important', 'Important', (t) => t.important],
  ['completed', 'Completed', (t) => t.completed],
];

const SORTS = {
  'created-desc': (a, b) => b.createdAt.localeCompare(a.createdAt),
  'created-asc': (a, b) => a.createdAt.localeCompare(b.createdAt),
  'due-asc': (a, b) => due(a).localeCompare(due(b)),
  'due-desc': (a, b) => (!a.dueDate) - (!b.dueDate) || due(b).localeCompare(due(a)),
  prio: (a, b) => (PO[a.priority] - PO[b.priority]) || b.createdAt.localeCompare(a.createdAt),
  alpha: (a, b) => a.title.localeCompare(b.title),
};

let S = {
  tasks: [],
  categories: DEF.map((c) => ({ ...c })),
  theme: null,
  view: 'dashboard',
  cat: null,
  q: '',
  sort: 'created-desc',
  prio: 'all',
};

let editId = null;
let pendingFn = null;
const seen = new Set();

/* =========================
   DOM and utility helpers
   ========================= */
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const pad = (value) => String(value).padStart(2, '0');
const dstr = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const today = () => dstr(new Date());
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const catName = (categoryId) => (S.categories.find((c) => c.id === categoryId) || { name: 'Other' }).name;
const catColor = (id) => {
  let hash = 0;
  for (const char of id) hash += char.charCodeAt(0);
  return CATCOL[hash % CATCOL.length];
};
const due = (task) => `${task.dueDate || '9999-12-31'} ${task.dueTime || '23:59'}`;
const dueMoment = (task) => (task.dueDate ? new Date(`${task.dueDate}T${task.dueTime || '23:59'}`) : null);
const isOverdue = (task) => !task.completed && !!dueMoment(task) && dueMoment(task) < new Date();
const isToday = (task) => task.dueDate === today();
const isUpcoming = (task) => !task.completed && !!task.dueDate && task.dueDate > today();

function fmtDue(task) {
  const date = new Date(task.dueDate + 'T00:00');
  let label = task.dueDate === today() ? 'Today'
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });

  if (task.dueTime) {
    const [hours, minutes] = task.dueTime.split(':');
    label += ' at ' + new Date(2000, 0, 1, +hours, +minutes).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  return label;
}

function matchView(task, view) {
  switch (view) {
    case 'today':
      return isToday(task);
    case 'upcoming':
      return isUpcoming(task);
    case 'overdue':
      return isOverdue(task);
    case 'completed':
      return task.completed;
    case 'important':
      return task.important;
    case 'pending':
      return !task.completed;
    case 'high':
      return task.priority === 'high' && !task.completed;
    default:
      return true;
  }
}

function matches(task) {
  const query = S.q.trim().toLowerCase();
  if (!matchView(task, S.view)) return false;
  if (S.cat && task.categoryId !== S.cat) return false;
  if (S.prio !== 'all' && task.priority !== S.prio) return false;

  if (query) {
    const haystack = [task.title, task.description, catName(task.categoryId), ...(task.tags || [])].join(' ').toLowerCase();
    if (!haystack.includes(query)) return false;
  }

  return true;
}

/* =========================
   Storage
   ========================= */
function load() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!data || typeof data !== 'object') return;

    if (Array.isArray(data.tasks)) {
      S.tasks = data.tasks
        .filter((task) => task && typeof task === 'object' && typeof task.title === 'string' && task.title.trim())
        .map((task) => ({
          id: String(task.id || uid()),
          title: task.title.slice(0, 120),
          description: String(task.description || ''),
          categoryId: task.categoryId || 'other',
          priority: PO[task.priority] !== undefined ? task.priority : 'medium',
          dueDate: task.dueDate || '',
          dueTime: task.dueTime || '',
          completed: !!task.completed,
          important: !!task.important,
          tags: Array.isArray(task.tags) ? task.tags.map(String) : [],
          createdAt: task.createdAt || new Date().toISOString(),
          updatedAt: task.updatedAt || new Date().toISOString(),
          completedAt: task.completedAt || null,
        }));
    }

    if (Array.isArray(data.categories) && data.categories.length) {
      S.categories = data.categories.filter((c) => c && c.id && c.name);
      DEF.forEach((category) => {
        if (!S.categories.some((existing) => existing.id === category.id)) {
          S.categories.unshift({ ...category });
        }
      });
    }

    if (data.theme) S.theme = data.theme;
    if (data.sort && SORTS[data.sort]) S.sort = data.sort;
  } catch (error) {
    toast('Saved data could not be read, so Focusly started fresh.', 'error');
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      tasks: S.tasks,
      categories: S.categories,
      theme: S.theme,
      sort: S.sort,
    }));
  } catch (error) {
    toast("Couldn't save changes. Browser storage may be full or blocked.", 'error');
  }
}

/* =========================
   Rendering
   ========================= */
function render() {
  renderHeader();
  renderNav();
  renderDash();
  renderList();
}

function renderHeader() {
  const now = new Date();
  const hour = now.getHours();
  $('#date').textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  $('#greet').textContent = (hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening') + '!';

  const openTasks = S.tasks.filter((task) => !task.completed).length;
  const overdueCount = S.tasks.filter(isOverdue).length;
  $('#sub').textContent = !S.tasks.length
    ? 'Nothing planned yet. Add a task to get started.'
    : `${openTasks} open ${openTasks === 1 ? 'task' : 'tasks'}${overdueCount ? `, ${overdueCount} overdue` : ''}.`;
}

function renderNav() {
  $('#nav').innerHTML = NAV.map(([view, label, filter]) =>
    `<li><button data-view="${view}"${!S.cat && S.view === view ? ' aria-current="page"' : ''}><span>${label}</span><span class="count">${S.tasks.filter(filter).length}</span></button></li>`
  ).join('');

  $('#catList').innerHTML = S.categories.map((category) => {
    const count = S.tasks.filter((task) => task.categoryId === category.id).length;
    const current = S.cat === category.id ? ' aria-current="page"' : '';
    const deleteAction = DEF_IDS.includes(category.id) ? ''
      : `<button class="x" data-del-cat="${esc(category.id)}" aria-label="Delete category ${esc(category.name)}">�</button>`;

    return `<li class="catrow"><button data-cat="${esc(category.id)}"${current}><span style="display:flex;align-items:center;gap:8px"><i class="dot" style="background:${catColor(category.id)}"></i>${esc(category.name)}</span><span class="count">${count}</span></button>${deleteAction}</li>`;
  }).join('');
}

function renderDash() {
  const total = S.tasks.length;
  const done = S.tasks.filter((task) => task.completed).length;
  const pending = total - done;
  const overdue = S.tasks.filter(isOverdue).length;
  const percent = total ? Math.round((done / total) * 100) : 0;
  const stat = (view, label, amount, modifier) => `<button class="stat ${modifier}" data-view="${view}"><span class="n">${amount}</span><span class="l">${label}</span></button>`;
  const chips = [['all', 'All'], ['pending', 'Pending'], ['completed', 'Completed'], ['high', 'High priority'], ['today', 'Due today']];

  $('#dash').innerHTML = `
    <div class="stats">
      ${stat('all', 'Total tasks', total, '')}
      ${stat('completed', 'Completed', done, 'ok')}
      ${stat('pending', 'Pending', pending, 'warn')}
      ${stat('overdue', 'Overdue', overdue, 'danger')}
    </div>
    <div class="progress">
      <div><strong>${percent}% complete</strong><p class="sub">${done} of ${total} ${total === 1 ? 'task' : 'tasks'} done</p></div>
      <div class="bar" role="progressbar" aria-label="Completion" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span style="width:${percent}%"></span></div>
    </div>
    <div class="chips" role="group" aria-label="Quick filters">
      ${chips.map(([view, label]) => `<button class="chip-btn" data-view="${view}" aria-pressed="${S.view === view}">${label}</button>`).join('')}
    </div>`;
}

function card(task, index, isFresh) {
  const overdueFlag = isOverdue(task);
  return `<li class="task p-${task.priority}${task.completed ? ' done' : ''}${isFresh ? ' fresh' : ''}" style="--i:${Math.min(index, 8)}" data-id="${esc(task.id)}">
    <button class="check" data-act="toggle" aria-pressed="${task.completed}" aria-label="${task.completed ? 'Mark as pending' : 'Mark as completed'}: ${esc(task.title)}"></button>
    <div class="body">
      <h3 class="title">${esc(task.title)}</h3>
      ${task.description ? `<p class="desc">${esc(task.description)}</p>` : ''}
      <div class="meta">
        <span class="pill"><i class="dot" style="background:${catColor(task.categoryId)}"></i>${esc(catName(task.categoryId))}</span>
        <span class="pill">${PL[task.priority] || 'Medium'} priority</span>
        ${task.dueDate ? `<span class="pill${overdueFlag ? ' over' : ''}">${overdueFlag ? 'Overdue: ' : ''}${esc(fmtDue(task))}</span>` : ''}
        ${(task.tags || []).map((tag) => `<span class="tag">#${esc(tag)}</span>`).join('')}
      </div>
    </div>
    <div class="acts">
      <button class="star${task.important ? ' on' : ''}" data-act="star" aria-label="${task.important ? 'Remove from important' : 'Mark as important'}"><span aria-hidden="true">?</span></button>
      <button data-act="edit">Edit</button>
      <button class="del" data-act="del">Delete</button>
    </div>
  </li>`;
}

function renderList() {
  const list = S.tasks.filter(matches).sort(SORTS[S.sort]);
  $('#listTitle').textContent = S.cat ? catName(S.cat) : (LABEL[S.view] || 'Tasks');
  $('#list').innerHTML = list.map((task, index) => card(task, index, !seen.has(task.id))).join('');
  list.forEach((task) => seen.add(task.id));

  const empty = $('#empty');
  empty.hidden = list.length > 0;

  if (!list.length) {
    empty.innerHTML = S.tasks.length
      ? `<h3>Nothing matches these filters</h3><p>Try another search, or <button class="link" data-reset>reset filters</button>.</p>`
      : `<h3>No tasks yet</h3><p>Add your first task. It will be saved in this browser.</p><button class="primary" data-open-form>Add a task</button>`;
  }
}

/* =========================
   Navigation and filters
   ========================= */
function go(view) {
  S.view = view;
  S.cat = null;
  closeNav();
  render();
}

function openNav() {
  document.body.classList.add('nav-open');
  $('#menuBtn').setAttribute('aria-expanded', 'true');
}

function closeNav() {
  document.body.classList.remove('nav-open');
  $('#menuBtn').setAttribute('aria-expanded', 'false');
}

function resetFilters() {
  S.q = '';
  $('#q').value = '';
  S.prio = 'all';
  $('#prio').value = 'all';
  S.cat = null;
  S.view = 'dashboard';
  render();
}

/* =========================
   Task actions
   ========================= */
function commit(message, type = 'ok') {
  save();
  render();
  if (message) toast(message, type);
}

function toggle(task) {
  task.completed = !task.completed;
  task.completedAt = task.completed ? new Date().toISOString() : null;
  task.updatedAt = new Date().toISOString();
  commit(task.completed ? 'Task marked as completed.' : 'Task moved back to pending.');
}

function star(task) {
  task.important = !task.important;
  task.updatedAt = new Date().toISOString();
  commit(task.important ? 'Added to Important.' : 'Removed from Important.');
}

function askDelete(task) {
  ask(`Delete "${task.title}"? This can't be undone.`, 'Delete task', () => {
    S.tasks = S.tasks.filter((item) => item.id !== task.id);
    commit('Task deleted.');
  });
}

function askDelCat(categoryId) {
  const category = S.categories.find((item) => item.id === categoryId);
  if (!category) return;

  ask(`Delete the "${category.name}" category? Its tasks move to Other.`, 'Delete category', () => {
    S.tasks.forEach((task) => {
      if (task.categoryId === categoryId) task.categoryId = 'other';
    });
    S.categories = S.categories.filter((item) => item.id !== categoryId);
    if (S.cat === categoryId) S.cat = null;
    commit('Category deleted. Its tasks moved to Other.');
  });
}

function ask(message, label, fn) {
  $('#cMsg').textContent = message;
  $('#cOk').textContent = label;
  pendingFn = fn;
  $('#confirm').showModal();
}

/* =========================
   Task form
   ========================= */
function clearErr() {
  $('#f-title-err').textContent = '';
  $('#f-time-err').textContent = '';
  $('#f-title').removeAttribute('aria-invalid');
  $('#f-time').removeAttribute('aria-invalid');
}

function openForm(task) {
  editId = task ? task.id : null;
  $('#formTitle').textContent = task ? 'Edit task' : 'New task';
  $('#f-cat').innerHTML = S.categories.map((category) => `<option value="${esc(category.id)}">${esc(category.name)}</option>`).join('');

  const targetCategory = task ? task.categoryId : (S.cat || 'personal');
  $('#f-cat').value = S.categories.some((category) => category.id === targetCategory) ? targetCategory : 'other';
  $('#f-title').value = task ? task.title : '';
  $('#f-desc').value = task ? task.description : '';
  $('#f-prio').value = task ? task.priority : 'medium';
  $('#f-date').value = task ? task.dueDate : '';
  $('#f-time').value = task ? task.dueTime : '';
  $('#f-tags').value = task ? (task.tags || []).join(', ') : '';
  $('#f-star').checked = task ? task.important : false;

  clearErr();
  $('#form').showModal();
}

/* =========================
   Theme and toast helpers
   ========================= */
function applyTheme() {
  document.documentElement.dataset.theme = S.theme;
  $('#themeBtn').textContent = S.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
}

function toast(message, type = 'ok') {
  const element = document.createElement('div');
  element.className = 'toast ' + type;
  element.textContent = message;
  $('#toasts').append(element);

  setTimeout(() => {
    element.classList.add('out');
    setTimeout(() => element.remove(), 320);
  }, 3200);
}

/* =========================
   Event wiring
   ========================= */
document.addEventListener('click', (event) => {
  const viewButton = event.target.closest('[data-view]');
  if (viewButton) return go(viewButton.dataset.view);

  const categoryButton = event.target.closest('[data-cat]');
  if (categoryButton) {
    S.cat = categoryButton.dataset.cat;
    S.view = 'all';
    closeNav();
    return render();
  }

  const deleteCategoryButton = event.target.closest('[data-del-cat]');
  if (deleteCategoryButton) return askDelCat(deleteCategoryButton.dataset.delCat);
  if (event.target.closest('[data-open-form]')) return openForm(null);
  if (event.target.closest('[data-reset]')) return resetFilters();

  const closeTarget = event.target.closest('[data-close]');
  if (closeTarget) closeTarget.closest('dialog').close();
});

$('#list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-act]');
  if (!button) return;

  const task = S.tasks.find((item) => item.id === button.closest('[data-id]').dataset.id);
  if (!task) return;

  const action = button.dataset.act;
  if (action === 'toggle') toggle(task);
  else if (action === 'star') star(task);
  else if (action === 'edit') openForm(task);
  else if (action === 'del') askDelete(task);
});

$('#q').addEventListener('input', (event) => {
  S.q = event.target.value;
  renderList();
});

$('#prio').addEventListener('change', (event) => {
  S.prio = event.target.value;
  renderList();
});

$('#sort').addEventListener('change', (event) => {
  S.sort = event.target.value;
  save();
  renderList();
});

$('#taskForm').addEventListener('submit', (event) => {
  event.preventDefault();
  clearErr();

  const title = $('#f-title').value.trim();
  const dueDate = $('#f-date').value;
  const dueTime = $('#f-time').value;
  let isInvalid = false;

  if (!title) {
    $('#f-title-err').textContent = 'Enter a task title to save.';
    $('#f-title').setAttribute('aria-invalid', 'true');
    isInvalid = true;
  }

  if (dueTime && !dueDate) {
    $('#f-time-err').textContent = 'Pick a due date before setting a time.';
    $('#f-time').setAttribute('aria-invalid', 'true');
    isInvalid = true;
  }

  if (isInvalid) {
    (title ? $('#f-time') : $('#f-title')).focus();
    return;
  }

  const now = new Date().toISOString();
  const data = {
    title: title.slice(0, 120),
    description: $('#f-desc').value.trim(),
    categoryId: $('#f-cat').value,
    priority: $('#f-prio').value,
    dueDate,
    dueTime: dueDate ? dueTime : '',
    important: $('#f-star').checked,
    tags: $('#f-tags').value.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 8),
  };

  const existing = editId && S.tasks.find((task) => task.id === editId);
  if (existing) {
    Object.assign(existing, data, { updatedAt: now });
  } else {
    S.tasks.push({
      id: uid(),
      ...data,
      completed: false,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    });
  }

  $('#form').close();
  commit(existing ? 'Task updated.' : 'Task created.');
});

$('#confirm').addEventListener('close', () => {
  pendingFn = null;
});

$('#cOk').addEventListener('click', () => {
  const fn = pendingFn;
  pendingFn = null;
  $('#confirm').close();
  if (fn) fn();
});

$('#catForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = $('#catName');
  const name = input.value.trim().slice(0, 24);

  if (!name) return toast('Enter a category name.', 'error');
  if (S.categories.some((category) => category.name.toLowerCase() === name.toLowerCase())) return toast('That category already exists.', 'error');

  S.categories.push({ id: 'c' + uid(), name });
  input.value = '';
  commit(`Category "${name}" added.`);
});

$('#themeBtn').addEventListener('click', () => {
  S.theme = S.theme === 'dark' ? 'light' : 'dark';
  applyTheme();
  save();
});

$('#menuBtn').addEventListener('click', () => {
  document.body.classList.contains('nav-open') ? closeNav() : openNav();
});

$('#scrim').addEventListener('click', closeNav);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeNav();
});

/* =========================
   Initialization
   ========================= */
load();
if (!S.theme) S.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
$('#sort').value = S.sort;
applyTheme();
render();