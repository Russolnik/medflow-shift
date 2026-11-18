const STORAGE_KEY = 'medflow-prototype-v1';

const DEFAULT_DIRECTIONS = [
  { id: 'operation', label: 'Операция', locked: true },
  { id: 'xray', label: 'Рентген' },
  { id: 'ecg', label: 'ЭКГ' },
  { id: 'ultrasound', label: 'УЗИ' },
  { id: 'ct', label: 'КТ' },
  { id: 'mri', label: 'МРТ' },
  { id: 'echo', label: 'Эхо' },
  { id: 'baro', label: 'Барокамера' }
];

const SYSTEM_STEPS = [
  { id: 'icu', label: 'Реанимация' },
  { id: 'ward', label: 'Палата' },
  { id: 'other', label: 'Другое' }
];

const SORT_MODES = ['priority', 'time-asc', 'time-desc'];

function uid() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `mf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function clone(value) {
  if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

const seed = {
  patients: [
    {
      id: uid(), surname: 'Иванов', room: '6', block: 'xo', transport: 'Кресло', priority: 'operation', pinned: false,
      steps: [
        { id: uid(), type: 'ecg', title: 'ЭКГ', state: 'done' },
        { id: uid(), type: 'xray', title: 'Рентген', state: 'active' },
        { id: uid(), type: 'operation', title: 'Операция', state: 'waiting' }
      ], note: 'Рентген по пути к оперблоку', events: []
    },
    {
      id: uid(), surname: 'Петрова', room: '12', block: 'angio', transport: 'Каталка', priority: 'operation', pinned: false,
      steps: [
        { id: uid(), type: 'operation', title: 'Операция', state: 'in_or', startedAt: Date.now() - 76 * 60000 }
      ], note: '', events: []
    },
    {
      id: uid(), surname: 'Смирнов', room: '3', block: '', transport: 'Пешком', priority: 'urgent', pinned: false,
      steps: [{ id: uid(), type: 'ct', title: 'Срочное КТ', state: 'active', urgent: true }],
      note: 'Уточнить сопровождение на посту', events: []
    }
  ],
  archive: [],
  directions: clone(DEFAULT_DIRECTIONS),
  settings: { sortMode: 'priority' }
};

let state = load();
let view = 'today';
let direction = 'all';
let modal = null;
let showCompleted = false;

function load() {
  try { return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY)) || clone(seed)); }
  catch { return normalizeState(clone(seed)); }
}
function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function esc(value='') { return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function normalizeState(value) {
  const next = value && typeof value === 'object' ? value : clone(seed);
  next.patients = Array.isArray(next.patients) ? next.patients : [];
  next.archive = Array.isArray(next.archive) ? next.archive : [];
  next.settings = next.settings && typeof next.settings === 'object' ? next.settings : {};
  if (!SORT_MODES.includes(next.settings.sortMode)) next.settings.sortMode = 'priority';
  if (!Array.isArray(next.directions)) next.directions = clone(DEFAULT_DIRECTIONS);
  next.directions = next.directions
    .filter(item => item && item.id && String(item.label || '').trim())
    .map(item => ({ id: String(item.id), label: String(item.label).trim(), locked: item.id === 'operation' }));
  if (!next.directions.some(item => item.id === 'operation')) next.directions.unshift(clone(DEFAULT_DIRECTIONS[0]));
  return next;
}
function getDirections() { return state.directions || DEFAULT_DIRECTIONS; }
function directionOptions(selected='', includeSystem=false) {
  const items = includeSystem ? [...getDirections(), ...SYSTEM_STEPS] : getDirections();
  return items.map(item => `<option value="${esc(item.id)}" ${item.id===selected?'selected':''}>${esc(item.label)}</option>`).join('');
}
function currentStep(patient) { return patient.steps.find(s => !['done','cancelled'].includes(s.state)); }
function isComplete(patient) { return patient.steps.every(s => ['done','cancelled'].includes(s.state)); }
function isOperationStep(step) {
  return Boolean(step && (step.type === 'operation' || /операц|оперблок|операцион/i.test(step.title || '')));
}
function hasTodayOperation(patient) {
  return Boolean(patient?.steps?.some(step => step.state !== 'cancelled' && isOperationStep(step)));
}
function syncPatientPriority(patient, urgent=false) {
  const hasOperation = hasTodayOperation(patient);
  patient.priority = urgent ? 'urgent' : hasOperation ? 'operation' : 'normal';
  if (!hasOperation) patient.block = '';
  return patient.priority;
}
function score(patient) {
  const step = currentStep(patient);
  if (!step) return -100;
  if (patient.pinned) return 10000;
  if (step.urgent || patient.priority === 'urgent') return 5000;
  if (hasTodayOperation(patient)) return 3000;
  if (step.time) return 2000;
  return 1000;
}
function parseTime(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const hours = Number(match[1]), minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}
function patientTimeMinutes(patient) {
  const pending = patient.steps.filter(step => !['done','cancelled'].includes(step.state));
  const source = pending.length ? pending : patient.steps.filter(step => step.state === 'done');
  const times = source.map(step => parseTime(step.time)).filter(value => value !== null);
  return times.length ? Math.min(...times) : null;
}
function comparePatients(a, b, mode=state.settings.sortMode) {
  if (mode === 'priority') return score(b) - score(a);
  const fixedPriority = patient => patient.pinned ? 3 : (currentStep(patient)?.urgent || patient.priority === 'urgent') ? 2 : hasTodayOperation(patient) ? 1 : 0;
  const priorityDifference = fixedPriority(b) - fixedPriority(a);
  if (priorityDifference) return priorityDifference;
  const aTime = patientTimeMinutes(a), bTime = patientTimeMinutes(b);
  if (aTime === null && bTime === null) return score(b) - score(a);
  if (aTime === null) return 1;
  if (bTime === null) return -1;
  const timeDifference = mode === 'time-desc' ? bTime - aTime : aTime - bTime;
  return timeDifference || score(b) - score(a);
}
function sortPatients(patients, mode=state.settings.sortMode) {
  return [...patients].sort((a,b) => comparePatients(a,b,mode));
}
function sortControl(compact=false) {
  return `<div class="sort-control ${compact?'compact-sort':''}">${compact?'':'<label for="sort-mode">Сортировка</label>'}<select id="sort-mode" data-sort-mode aria-label="Сортировка очереди">
    <option value="priority" ${state.settings.sortMode==='priority'?'selected':''}>${compact?'Приоритет':'По приоритету'}</option>
    <option value="time-asc" ${state.settings.sortMode==='time-asc'?'selected':''}>${compact?'Время ↑':'По времени: сначала ранние'}</option>
    <option value="time-desc" ${state.settings.sortMode==='time-desc'?'selected':''}>${compact?'Время ↓':'По времени: сначала поздние'}</option>
  </select></div>`;
}
function blockLabel(block) { return ({gxo:'ГХО',xo:'ХО',angio:'АНГИО'})[block] || ''; }
function typeLabel(type) {
  return getDirections().find(item => item.id === type)?.label || SYSTEM_STEPS.find(item => item.id === type)?.label || type;
}
function stepMatchesDirection(step, selected) {
  if (selected === 'all') return true;
  return selected === 'operation' ? isOperationStep(step) : step.type === selected;
}
function fmtDuration(ms) {
  const mins = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h} ч ${m} мин` : `${m} мин`;
}
function timerClass(ms) { const m = ms/60000; return m < 60 ? 'green' : m < 120 ? 'yellow' : 'red'; }
function shiftProgress(patients) {
  return patients.reduce((progress, patient) => {
    patient.steps.forEach(step => {
      if (step.state === 'cancelled') return;
      const operation = isOperationStep(step);
      progress.total += operation ? 2 : 1;
      if (step.state === 'done') progress.done += operation ? 2 : 1;
      else if (operation && ['in_or','pickup'].includes(step.state)) progress.done += 1;
    });
    return progress;
  }, { done:0, total:0 });
}
function stepTitle(step) {
  if (step.state === 'in_or') return 'В оперблоке — ожидается вызов';
  if (step.state === 'pickup') return 'Позвонили — нужно забрать';
  if (step.state === 'in_progress') return `Сейчас: ${step.title}`;
  if (step.state === 'active') return step.title;
  if (step.state === 'waiting') return `Предстоит: ${step.title}`;
  return step.title;
}
function actionLabel(step) {
  if (isOperationStep(step) && ['active','waiting','in_progress'].includes(step.state)) return 'Доставлен в оперблок';
  if (step.state === 'in_or') return 'Позвонили — забирать';
  if (step.state === 'pickup') return 'Забран из оперблока';
  if (step.state === 'in_progress') return 'Завершить';
  return 'Начать';
}

function render() {
  const active = sortPatients(state.patients.filter(p => !isComplete(p)));
  const completed = sortPatients(state.patients.filter(isComplete));
  const ops = state.patients.filter(hasTodayOperation).length;
  const inOr = state.patients.filter(p => p.steps.some(s => ['in_or','pickup'].includes(s.state))).length;
  document.getElementById('app').innerHTML = `
    <main class="shell">
      <header class="topbar">
        <div class="brand"><div class="logo">M</div><div><h1>MedFlow</h1><div class="eyebrow">Личная смена · демо-данные</div></div></div>
        <button class="icon-btn" data-action="add">＋ Записать</button>
      </header>
      ${view === 'directions' ? sortControl() : ''}
      ${view === 'today' ? todayView(active, completed, ops, inOr) : view === 'directions' ? directionsView() : historyView()}
    </main>
    <nav class="nav">
      ${navButton('today','⌂','Сегодня')}
      ${navButton('directions','⌘','Направления')}
      ${navButton('history','↶','История')}
    </nav>
    ${modal ? modalView() : ''}
  `;
  bind();
}

function navButton(id, icon, text) { return `<button class="nav-btn ${view===id?'active':''}" data-view="${id}"><b>${icon}</b>${text}</button>`; }
function todayView(active, completed, ops, inOr) {
  const progress = shiftProgress(state.patients);
  const progressPercent = progress.total ? Math.round(progress.done / progress.total * 100) : 0;
  const engagedPatients = active.filter(p => p.steps.some(s => ['in_progress','in_or','pickup'].includes(s.state)));
  const queuedPatients = active.filter(p => !engagedPatients.includes(p));
  const engaged = engagedPatients.length;
  return `
    <section class="shift-progress" aria-label="Прогресс смены">
      <div class="shift-progress-line">
        <div><strong>Сделано за смену</strong><span>по текущему плану</span></div>
        <b>${progress.total ? `${progress.done}/${progress.total}` : '0'}</b>
      </div>
      <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="${progress.total}" aria-valuenow="${progress.done}"><i style="width:${progressPercent}%"></i></div>
    </section>
    ${engagedPatients.length ? `
      <div class="section-head workstream-head"><h2>Сейчас вне палаты</h2><span>${engaged} задействовано</span></div>
      <div class="patient-list">${engagedPatients.map(compactPatientCard).join('')}</div>
    ` : ''}
    <div class="section-head workstream-head queue-head"><h2>Очередь</h2>${sortControl(true)}</div>
    <div class="patient-list">${queuedPatients.length ? queuedPatients.map(compactPatientCard).join('') : '<div class="empty compact-empty">Очередь свободна</div>'}</div>
    <section class="shift-summary" aria-label="Сводка смены">
      <div class="stat"><strong>${engaged}</strong><span>активных сейчас</span></div>
      <div class="stat"><strong>${ops}</strong><span>операции сегодня</span></div>
      <div class="stat"><strong>${inOr}</strong><span>в оперблоке</span></div>
    </section>
    <button class="completed-toggle" data-action="toggle-completed" aria-expanded="${showCompleted}">
      <span>Выполнено сегодня</span>
      <strong><span>${completed.length}</span><i class="toggle-chevron ${showCompleted ? 'open' : ''}" aria-hidden="true"></i></strong>
    </button>
    ${showCompleted ? `<div class="patient-list" style="margin-top:10px">${completed.map(compactPatientCard).join('') || '<div class="empty">Пока ничего</div>'}</div>` : ''}
  `;
}

function directionsView() {
  const dirs = [{id:'all',label:'Все'}, ...getDirections(), {id:'other',label:'Другое'}];
  const patients = state.patients.filter(p => p.steps.some(s=>stepMatchesDirection(s,direction)));
  const waiting = sortPatients(patients.filter(p => p.steps.some(s => stepMatchesDirection(s,direction) && !['done','cancelled'].includes(s.state))));
  const done = sortPatients(patients.filter(p => p.steps.some(s => stepMatchesDirection(s,direction) && s.state==='done')));
  return `
    <div class="section-head directions-head"><div><h2>По направлениям</h2><span>операции, процедуры и другое</span></div><button class="secondary-btn manage-directions-btn" data-action="manage-directions">Настроить</button></div>
    <div class="filters">${dirs.map(d=>`<button class="chip ${direction===d.id?'active':''}" data-direction="${esc(d.id)}">${esc(d.label)}</button>`).join('')}</div>
    <div class="section-head"><h2>Ожидают</h2><span>${waiting.length}</span></div>
    <div class="patient-list">${waiting.map(compactPatientCard).join('') || '<div class="empty">Никого не ожидает</div>'}</div>
    <div class="section-head"><h2>Прошли сегодня</h2><span>${done.length}</span></div>
    <div class="patient-list">${done.map(compactPatientCard).join('') || '<div class="empty">Пока нет выполненных</div>'}</div>
  `;
}

function historyView() {
  const events = state.patients.flatMap(p => (p.events||[]).map(e=>({...e,patient:p.surname}))).sort((a,b)=>b.at-a.at);
  const archived = state.archive || [];
  return `
    <div class="section-head"><h2>История смены</h2><span>${events.length} событий</span></div>
    ${events.length ? events.map(e=>`<div class="history-day"><div class="between row"><strong>${esc(e.patient)}</strong><span class="eyebrow">${new Date(e.at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</span></div><p>${esc(e.text)}</p></div>`).join('') : '<div class="empty">Здесь появятся выполненные этапы, отмены и передачи.</div>'}
    <div class="section-head"><h2>Прошлые смены</h2><span>${archived.length}</span></div>
    ${archived.length ? archived.slice().reverse().map(shift=>`<div class="history-day"><div class="between row"><strong>${new Date(shift.closedAt).toLocaleDateString('ru-RU')}</strong><span class="eyebrow">${shift.patients.length} карточек</span></div><p>Выполнено маршрутов: ${shift.patients.filter(isComplete).length} · событий: ${shift.patients.reduce((n,p)=>n+(p.events?.length||0),0)}</p></div>`).join('') : '<div class="empty">Завершённые смены появятся здесь</div>'}
    <div class="section-head"><h2>Управление сменой</h2></div>
    <div class="patient-list"><button class="primary-btn" data-action="new-shift">Начать новую пустую смену</button><button class="danger-btn" data-action="reset">Вернуть демонстрационные данные</button></div>
  `;
}

function compactPatientCard(p) {
  const step = currentStep(p);
  const next = nextWaitingStep(p);
  const urgent = step?.urgent || p.priority === 'urgent';
  const orStep = p.steps.find(s => ['in_or','pickup'].includes(s.state));
  const elapsed = orStep?.startedAt ? Date.now() - orStep.startedAt : 0;
  const currentIndex = step ? p.steps.indexOf(step) : -1;
  const upcoming = currentIndex >= 0
    ? p.steps.slice(currentIndex + 1).filter(s => !['done','cancelled'].includes(s.state)).slice(0, 2)
    : [];
  return `<article class="patient-card compact-card ${urgent?'urgent':''}">
    <div class="compact-head">
      <div class="patient-name">${esc(p.surname)} <span class="patient-room">· п.${esc(p.room || '?')}</span></div>
      <div class="badges">${urgent?'<span class="badge urgent">СРОЧНО</span>':''}${p.block?`<span class="badge ${p.block}">${blockLabel(p.block)}</span>`:hasTodayOperation(p)?'<span class="badge operation">ОПЕРАЦИЯ</span>':''}${p.pinned?'<span class="badge warn">СЛЕДУЮЩИЙ</span>':''}</div>
    </div>
    <div class="compact-main">
      <div class="compact-copy">
        <div class="current-label">Сейчас</div>
        <div class="compact-title">${step ? esc(stepTitle(step)) : 'Маршрут завершён'}</div>
        ${step ? `<div class="compact-meta"><span>↗ ${esc(p.transport || 'способ уточнить')}</span>${step.time?`<span>◷ ${esc(step.time)}</span>`:''}${step.needsClarification?'<span>⚠ уточнить данные</span>':''}</div>` : ''}
        ${upcoming.length ? `<div class="compact-next">Далее: ${upcoming.map(s=>`${esc(s.title)}${s.time?` · ${esc(s.time)}`:''}`).join(' → ')}</div>` : ''}
      </div>
      ${orStep ? `<div class="timer ${timerClass(elapsed)}">${fmtDuration(elapsed)}</div>` : ''}
    </div>
    ${step ? `<div class="compact-actions ${canContinueNow(p)?'with-next':''}"><button class="primary-btn" data-action="advance" data-patient="${p.id}">${actionLabel(step)}</button>${canContinueNow(p)?`<button class="secondary-btn continue-btn" data-action="advance-next" data-patient="${p.id}">Дальше: ${esc(next.title)}</button>`:''}<button class="secondary-btn details-btn" data-action="edit-patient" data-patient="${p.id}" aria-label="Редактировать">✎</button><button class="secondary-btn details-btn" data-action="details" data-patient="${p.id}" aria-label="Подробности">•••</button></div>` : `<div class="compact-actions"><button class="secondary-btn" data-action="edit-patient" data-patient="${p.id}">Редактировать</button><button class="secondary-btn compact-details" data-action="details" data-patient="${p.id}">Подробнее</button></div>`}
  </article>`;
}

function patientCard(p) {
  const step = currentStep(p);
  const urgent = step?.urgent || p.priority==='urgent';
  const orStep = p.steps.find(s=>['in_or','pickup'].includes(s.state));
  const elapsed = orStep?.startedAt ? Date.now()-orStep.startedAt : 0;
  return `<article class="patient-card ${urgent?'urgent':''}">
    <div class="patient-top">
      <div class="row between"><div><div class="patient-name">${esc(p.surname)} <span class="patient-room">· п.${esc(p.room||'?')}</span></div></div>
      <div class="badges">${urgent?'<span class="badge urgent">СРОЧНО</span>':''}${p.block?`<span class="badge ${p.block}">${blockLabel(p.block)}</span>`:hasTodayOperation(p)?'<span class="badge operation">ОПЕРАЦИЯ</span>':''}${p.pinned?'<span class="badge warn">СЛЕДУЮЩИЙ</span>':''}</div></div>
    </div>
    <div class="route">${p.steps.map((s,i)=>`<span class="step ${s.state==='done'?'done':s===step?'active':''}"><i>${s.state==='done'?'✓':i+1}</i>${esc(s.title)}</span>`).join('')}</div>
    <div class="current">
      <div class="row between"><div><div class="current-label">${step?'Текущий этап':'Маршрут завершён'}</div><div class="current-title">${step?esc(stepTitle(step)):'Всё выполнено'}</div></div>${orStep?`<div class="timer ${timerClass(elapsed)}">${fmtDuration(elapsed)}</div>`:''}</div>
      <div class="meta"><span>↗ ${esc(p.transport||'Способ уточнить')}</span>${step?.time?`<span>◷ ${esc(step.time)}</span>`:''}${step?.needsClarification?'<span>⚠ Уточнить на посту</span>':''}</div>
      ${p.note?`<div class="note">${esc(p.note)}</div>`:''}
      ${step ? `<div class="actions"><button class="primary-btn" data-action="advance" data-patient="${p.id}">${actionLabel(step)}</button><button class="secondary-btn" data-action="pin" data-patient="${p.id}">${p.pinned?'Снять':'Следующей'}</button><button class="secondary-btn" data-action="more" data-patient="${p.id}">•••</button></div>`:''}
    </div>
  </article>`;
}

function modalView() {
  if (modal.type === 'details') {
    const p = state.patients.find(x => x.id === modal.patient);
    if (!p) return '';
    return `<div class="modal-backdrop" data-action="close"><section class="modal" onclick="event.stopPropagation()">
      <div class="row between"><div><h2>${esc(p.surname)} · палата ${esc(p.room || 'уточнить')}</h2><p class="modal-sub">Полная карточка пациента</p></div>${p.block?`<span class="badge ${p.block}">${blockLabel(p.block)}</span>`:''}</div>
      <div class="detail-block"><div class="current-label">Маршрут на сегодня</div><div class="route-detail">${p.steps.map((s,i)=>`<div class="route-detail-item ${s.state==='done'?'done':s===currentStep(p)?'active':''}"><span>${s.state==='done'?'✓':i+1}</span><b>${esc(s.title)}${s.time?` <small>· ${esc(s.time)}</small>`:''}</b></div>`).join('')}</div></div>
      <div class="detail-grid"><div><span>Передвижение</span><b>${esc(p.transport || 'Не указано')}</b></div><div><span>Приоритет</span><b>${p.priority==='urgent'?'Срочный':hasTodayOperation(p)?'Операция сегодня':'Обычный'}</b></div></div>
      ${p.note?`<div class="note">${esc(p.note)}</div>`:''}
      <div class="patient-list detail-actions">
        <button class="secondary-btn" data-action="edit-patient" data-patient="${p.id}">Редактировать данные</button>
        <button class="primary-btn" data-action="edit-route" data-patient="${p.id}">Изменить цепочку</button>
        <button class="secondary-btn" data-action="pin" data-patient="${p.id}">${p.pinned?'Снять ручной приоритет':'Сделать следующим'}</button>
        <button class="secondary-btn" data-action="cancel-step" data-patient="${p.id}">Отменить текущий этап</button>
        <button class="secondary-btn" data-action="postpone-step" data-patient="${p.id}">Перенести текущий этап</button>
        <button class="secondary-btn" data-action="handoff" data-patient="${p.id}">Передать другому сотруднику</button>
        <button class="danger-btn" data-action="delete-patient" data-patient="${p.id}">Удалить ошибочную карточку</button>
      </div>
      <div class="modal-actions"><button class="secondary-btn" data-action="close">Закрыть</button></div>
    </section></div>`;
  }
  if (modal.type === 'edit-patient') {
    const p = state.patients.find(x => x.id === modal.patient);
    if (!p) return '';
    const editedStep = currentStep(p);
    const urgent = editedStep?.urgent || p.priority === 'urgent';
    return `<div class="modal-backdrop" data-action="close"><section class="modal" onclick="event.stopPropagation()">
      <h2>Данные карточки</h2><p class="modal-sub">Быстрая правка без изменения маршрута</p>
      <form id="edit-patient-form" class="form-grid">
        <div class="field"><label>Фамилия</label><input required name="surname" value="${esc(p.surname)}" /></div>
        <div class="field"><label>Палата</label><input name="room" value="${esc(p.room || '')}" placeholder="Можно уточнить позже" /></div>
        <div class="field"><label>Передвижение</label><select name="transport">
          ${['','Пешком с сопровождением','Кресло','Каталка'].map(x=>`<option value="${x}" ${p.transport===x?'selected':''}>${x||'Уточнить позже'}</option>`).join('')}
        </select></div>
        <div class="field"><label>Оперблок</label><select name="block">
          <option value="" ${!p.block?'selected':''}>Не указан</option><option value="gxo" ${p.block==='gxo'?'selected':''}>ГХО</option><option value="xo" ${p.block==='xo'?'selected':''}>ХО</option><option value="angio" ${p.block==='angio'?'selected':''}>Ангио</option>
        </select></div>
        <div class="field"><label>Время текущего этапа</label><input type="time" name="time" value="${esc(editedStep?.time || '')}" /></div>
        <label class="urgent-toggle full"><input type="checkbox" name="urgent" ${urgent?'checked':''} /><span><b>Срочно</b><small>Поднять пациента наверх очереди</small></span></label>
        <div class="field full"><label>Заметка</label><textarea name="note" placeholder="Короткое уточнение">${esc(p.note || '')}</textarea></div>
      </form>
      <div class="modal-actions"><button class="secondary-btn" data-action="details" data-patient="${p.id}">Назад</button><button class="primary-btn" data-action="save-patient" data-patient="${p.id}">Сохранить</button></div>
    </section></div>`;
  }
  if (modal.type === 'directions') {
    return `<div class="modal-backdrop" data-action="close"><section class="modal" onclick="event.stopPropagation()">
      <h2>Направления</h2><p class="modal-sub">Переименовывай существующие или добавляй свои. Изменения попадут в фильтры и новые цепочки.</p>
      <div class="direction-catalog">${modal.directions.map((item,i)=>`<div class="direction-catalog-item"><input data-direction-name="${esc(item.id)}" value="${esc(item.label)}" aria-label="Название направления" /><button class="direction-remove" data-action="direction-remove" data-index="${i}" ${item.locked?'disabled title="Операцию нельзя удалить"':'title="Убрать из списка"'}>×</button></div>`).join('')}</div>
      ${modal.error?`<p class="form-error">${esc(modal.error)}</p>`:''}
      <div class="direction-new"><input id="direction-new-name" placeholder="Например, ФГДС" /><button class="secondary-btn" data-action="direction-add">＋ Добавить</button></div>
      <div class="modal-actions"><button class="secondary-btn" data-action="close">Отмена</button><button class="primary-btn" data-action="direction-save">Сохранить</button></div>
    </section></div>`;
  }
  if (modal.type === 'route') {
    const p = state.patients.find(x => x.id === modal.patient);
    return `<div class="modal-backdrop" data-action="close"><section class="modal" onclick="event.stopPropagation()">
      <h2>Цепочка · ${esc(p?.surname || '')}</h2><p class="modal-sub">Расставь этапы в любом порядке</p>
      <div class="route-editor">${modal.steps.map((s,i)=>{const movable=s.state==='waiting';const canUp=movable&&i>0&&modal.steps[i-1].state==='waiting';const canDown=movable&&i<modal.steps.length-1&&modal.steps[i+1].state==='waiting';return `<div class="route-editor-item ${movable?'':'locked'}"><span class="route-index">${i+1}</span><div class="route-item-copy"><input class="route-title-input" data-route-title="${i}" value="${esc(s.title)}" aria-label="Название этапа ${i+1}" /><input class="route-time-input" type="time" data-route-time="${i}" value="${esc(s.time || '')}" aria-label="Время этапа ${i+1}" />${movable?'':'<small>Порядок текущего или завершённого этапа защищён</small>'}</div><div class="route-tools"><button data-action="route-up" data-index="${i}" ${canUp?'':'disabled'}>↑</button><button data-action="route-down" data-index="${i}" ${canDown?'':'disabled'}>↓</button><button data-action="route-delete" data-index="${i}" ${movable?'':'disabled'}>×</button></div></div>`;}).join('')}</div>
      <div class="route-add"><select id="route-type">${directionOptions('', true)}</select><input id="route-custom" placeholder="Своё название" /><input id="route-time" type="time" aria-label="Время нового этапа" /><button class="secondary-btn" data-action="route-add">＋ Добавить</button></div>
      <div class="modal-actions"><button class="secondary-btn" data-action="details" data-patient="${modal.patient}">Назад</button><button class="primary-btn" data-action="route-save" data-patient="${modal.patient}">Сохранить цепочку</button></div>
    </section></div>`;
  }
  if (modal.type === 'quick') {
    return `<div class="modal-backdrop" data-action="close"><section class="modal quick-modal" onclick="event.stopPropagation()">
      <h2>Быстрая запись</h2><p class="modal-sub">Сейчас — только главное. Маршрут можно дополнить позже.</p>
      <form id="quick-form" class="quick-form">
        <div class="field"><label>Фамилия</label><input required name="surname" placeholder="Иванов" autofocus /></div>
        <div class="field"><label>Палата</label><input name="room" placeholder="Можно позже" /></div>
        <div class="field"><label>Что сейчас</label><select name="type">${directionOptions('', true)}</select></div>
        <div class="field"><label>Уточнение</label><input name="title" placeholder="Например, ХО или срочное КТ" /></div>
        <div class="field"><label>Время</label><input type="time" name="time" /></div>
        <label class="urgent-toggle"><input type="checkbox" name="urgent" /><span><b>Срочно</b><small>Поднять поручение наверх</small></span></label>
      </form>
      <div class="modal-actions"><button class="secondary-btn" data-action="close">Отмена</button><button class="primary-btn" data-action="submit-quick">Записать</button></div>
    </section></div>`;
  }
  if (modal.type === 'add' || modal.type === 'urgent') {
    const urgent = modal.type === 'urgent';
    return `<div class="modal-backdrop" data-action="close"><section class="modal" onclick="event.stopPropagation()">
      <h2>${urgent?'Срочное поручение':'Новый пациент'}</h2><p class="modal-sub">Только вымышленные данные для проверки прототипа</p>
      <form id="patient-form" class="form-grid">
        <input type="hidden" name="urgent" value="${urgent?'1':'0'}" />
        <div class="field"><label>Фамилия / условное имя</label><input required name="surname" placeholder="Например, Иванов" autofocus /></div>
        <div class="field"><label>Палата</label><input name="room" placeholder="Можно уточнить позже" /></div>
        <div class="field"><label>Ближайшее действие</label><select name="type">${directionOptions('', true)}</select></div>
        <div class="field"><label>Куда везти</label><input required name="destination" placeholder="ХО, КТ, кабинет…" /></div>
        <div class="field"><label>Время ближайшего действия</label><input type="time" name="time" /></div>
        <div class="field"><label>Способ передвижения</label><select name="transport"><option value="">Уточнить позже</option><option>Пешком с сопровождением</option><option>Кресло</option><option>Каталка</option></select></div>
        <div class="field"><label>Оперблок (только для операции)</label><select name="block"><option value="">Не указан</option><option value="gxo">ГХО</option><option value="xo">ХО</option><option value="angio">Ангио</option></select></div>
        <div class="field full"><label>Что ещё предстоит сегодня</label><div class="direction-checks">${getDirections().map(item=>`<label><input type="checkbox" name="extra-direction" value="${esc(item.id)}" /> ${esc(item.label)}</label>`).join('')}</div></div>
        <div class="field full"><label>Заметка</label><textarea name="note" placeholder="Короткое уточнение"></textarea></div>
      </form>
      <div class="modal-actions"><button class="secondary-btn" data-action="close">Отмена</button><button class="primary-btn" data-action="submit-patient">Сохранить</button></div>
    </section></div>`;
  }
  if (modal.type === 'more') {
    return `<div class="modal-backdrop" data-action="close"><section class="modal" onclick="event.stopPropagation()"><h2>Изменить маршрут</h2><p class="modal-sub">Сохранить событие в истории</p>
      <div class="patient-list" style="margin-top:16px">
        <button class="secondary-btn" data-action="cancel-step" data-patient="${modal.patient}">Отменить текущий этап</button>
        <button class="secondary-btn" data-action="postpone-step" data-patient="${modal.patient}">Перенести на другой день</button>
        <button class="secondary-btn" data-action="handoff" data-patient="${modal.patient}">Передал другому сотруднику</button>
        <button class="danger-btn" data-action="delete-patient" data-patient="${modal.patient}">Удалить ошибочную карточку</button>
      </div><div class="modal-actions"><button class="secondary-btn" data-action="close">Закрыть</button></div></section></div>`;
  }
  if (modal.type === 'confirm-delete') {
    const p = state.patients.find(x => x.id === modal.patient);
    if (!p) return '';
    return `<div class="modal-backdrop" data-action="close"><section class="modal confirm-modal" onclick="event.stopPropagation()">
      <h2>Удалить карточку?</h2><p class="modal-sub">${esc(p.surname)} исчезнет из текущей смены вместе с историей этапов.</p>
      <div class="modal-actions"><button class="secondary-btn" data-action="details" data-patient="${p.id}">Не удалять</button><button class="danger-btn" data-action="confirm-delete-patient" data-patient="${p.id}">Удалить</button></div>
    </section></div>`;
  }
  if (modal.type === 'confirm-new-shift') {
    return `<div class="modal-backdrop" data-action="close"><section class="modal confirm-modal" onclick="event.stopPropagation()"><h2>Начать новую смену?</h2><p class="modal-sub">Текущие карточки уйдут в «Прошлые смены», а главный экран станет пустым.</p><div class="modal-actions"><button class="secondary-btn" data-action="close">Отмена</button><button class="primary-btn" data-action="confirm-new-shift">Начать</button></div></section></div>`;
  }
  if (modal.type === 'confirm-reset') {
    return `<div class="modal-backdrop" data-action="close"><section class="modal confirm-modal" onclick="event.stopPropagation()"><h2>Вернуть демо-данные?</h2><p class="modal-sub">Текущая и прошлые смены будут заменены исходным учебным примером.</p><div class="modal-actions"><button class="secondary-btn" data-action="close">Отмена</button><button class="danger-btn" data-action="confirm-reset">Вернуть демо</button></div></section></div>`;
  }
  if (modal.type === 'destination') {
    const p = state.patients.find(x => x.id === modal.patient);
    const next = p ? nextWaitingStep(p) : null;
    return `<div class="modal-backdrop"><section class="modal"><h2>Куда доставлен пациент?</h2><p class="modal-sub">Таймер остановится после выбора</p>
      ${next?`<label class="continue-toggle"><input id="continue-after-operation" type="checkbox" /><span><b>Сразу перейти дальше</b><small>Следующий этап: ${esc(next.title)}</small></span></label>`:''}
      <div class="patient-list" style="margin-top:16px">
      ${['Вернулся в свою палату','Переведён в реанимацию','Переведён в другое отделение','Передан другому сотруднику','Другое место'].map(x=>`<button class="secondary-btn" data-action="finish-operation" data-patient="${modal.patient}" data-destination="${x}">${x}</button>`).join('')}
      <button class="secondary-btn" data-action="close">Назад, пока не выбирать</button></div></section></div>`;
  }
  return '';
}

function bind() {
  document.querySelectorAll('[data-view]').forEach(el=>el.onclick=()=>{view=el.dataset.view; render();});
  document.querySelectorAll('[data-direction]').forEach(el=>el.onclick=()=>{direction=el.dataset.direction; render();});
  document.querySelectorAll('[data-sort-mode]').forEach(el=>el.onchange=()=>{ state.settings.sortMode=SORT_MODES.includes(el.value)?el.value:'priority'; save(); render(); });
  document.querySelectorAll('[data-route-title]').forEach(el=>el.oninput=()=>{ if(modal?.type==='route' && modal.steps[Number(el.dataset.routeTitle)]) modal.steps[Number(el.dataset.routeTitle)].title=el.value; });
  document.querySelectorAll('[data-route-time]').forEach(el=>el.oninput=()=>{ if(modal?.type==='route' && modal.steps[Number(el.dataset.routeTime)]) modal.steps[Number(el.dataset.routeTime)].time=el.value; });
  document.querySelectorAll('[data-direction-name]').forEach(el=>el.oninput=()=>{ const item=modal?.directions?.find(item=>item.id===el.dataset.directionName); if(item) item.label=el.value; });
  document.querySelectorAll('[data-action]').forEach(el=>el.onclick=(e)=>handleAction(el.dataset.action, el, e));
}
function log(p,text) { p.events ||= []; p.events.push({at:Date.now(),text}); }
function nextWaitingStep(p) { return p.steps.find(s=>s.state==='waiting'); }
function activateNext(p) { const next=nextWaitingStep(p); if(next) next.state='active'; return next; }
function canContinueNow(p) { const step=currentStep(p); return step?.state==='in_progress' && !isOperationStep(step) && Boolean(nextWaitingStep(p)); }
function completeCurrentStep(p, startNext=false) {
  const step=currentStep(p);
  if(!step) return {step:null,next:null};
  step.state='done'; step.finishedAt=Date.now();
  const next=activateNext(p);
  if(startNext && next) { next.state='in_progress'; next.startedAt ||= Date.now(); }
  return {step,next};
}

function handleAction(action, el, e) {
  if (action==='add') { modal={type:'quick'}; return render(); }
  if (action==='close') { modal=null; return render(); }
  if (action==='toggle-completed') { showCompleted=!showCompleted; return render(); }
  if (action==='manage-directions') { modal={type:'directions',directions:clone(getDirections()),error:''}; return render(); }
  if (action==='direction-remove') {
    const item=modal?.directions?.[Number(el.dataset.index)];
    if(item && !item.locked) modal.directions.splice(Number(el.dataset.index),1);
    return render();
  }
  if (action==='direction-add') {
    const input=document.getElementById('direction-new-name');
    const label=input?.value.trim();
    if(!label) { modal.error='Введи название направления'; return render(); }
    if(modal.directions.some(item=>item.label.trim().toLocaleLowerCase('ru-RU')===label.toLocaleLowerCase('ru-RU'))) { modal.error='Такое направление уже есть'; return render(); }
    modal.directions.push({id:`custom-${uid()}`,label,locked:false}); modal.error=''; return render();
  }
  if (action==='direction-save') {
    const cleaned=[];
    const labels=new Set();
    for(const item of modal.directions) {
      const label=String(item.label||'').trim();
      const key=label.toLocaleLowerCase('ru-RU');
      if(!label || labels.has(key)) continue;
      labels.add(key); cleaned.push({id:item.id,label,locked:item.id==='operation'});
    }
    if(!cleaned.some(item=>item.id==='operation')) cleaned.unshift(clone(DEFAULT_DIRECTIONS[0]));
    const oldLabels=new Map(getDirections().map(item=>[item.id,item.label]));
    const newLabels=new Map(cleaned.map(item=>[item.id,item.label]));
    state.patients.forEach(patient=>patient.steps.forEach(step=>{ if(newLabels.has(step.type) && step.title===oldLabels.get(step.type)) step.title=newLabels.get(step.type); }));
    state.directions=cleaned;
    if(direction!=='all' && direction!=='other' && !cleaned.some(item=>item.id===direction)) direction='all';
    modal=null; save(); return render();
  }
  if (action==='details') { modal={type:'details',patient:el.dataset.patient}; return render(); }
  if (action==='edit-patient') { modal={type:'edit-patient',patient:el.dataset.patient}; return render(); }
  if (action==='save-patient') {
    const form=document.getElementById('edit-patient-form'); if(!form.reportValidity()) return;
    const fd=new FormData(form), p=state.patients.find(p=>p.id===el.dataset.patient), step=currentStep(p);
    p.surname=fd.get('surname').trim(); p.room=fd.get('room').trim(); p.transport=fd.get('transport'); p.block=fd.get('block'); p.note=fd.get('note').trim();
    const urgent=fd.get('urgent')==='on';
    if(step) { step.urgent=urgent; step.time=fd.get('time') || ''; step.needsClarification=!p.room||!p.transport; }
    syncPatientPriority(p,urgent);
    log(p,'Данные карточки изменены'); modal={type:'details',patient:p.id}; save(); return render();
  }
  if (action==='edit-route') {
    const p=state.patients.find(p=>p.id===el.dataset.patient);
    modal={type:'route',patient:p.id,steps:clone(p.steps)};
    return render();
  }
  if (action==='route-up' || action==='route-down') {
    const i=Number(el.dataset.index), j=action==='route-up'?i-1:i+1;
    if(j>=0 && j<modal.steps.length && modal.steps[i].state==='waiting' && modal.steps[j].state==='waiting') [modal.steps[i],modal.steps[j]]=[modal.steps[j],modal.steps[i]];
    return render();
  }
  if (action==='route-delete') { const i=Number(el.dataset.index); if(modal.steps[i]?.state==='waiting') modal.steps.splice(i,1); return render(); }
  if (action==='route-add') {
    const type=document.getElementById('route-type').value;
    const custom=document.getElementById('route-custom').value.trim();
    const time=document.getElementById('route-time').value;
    modal.steps.push({id:uid(),type,title:custom||typeLabel(type),time,state:'waiting'});
    return render();
  }
  if (action==='route-save') {
    const p=state.patients.find(p=>p.id===el.dataset.patient);
    p.steps=modal.steps;
    if(!p.steps.some(s=>!['done','cancelled'].includes(s.state))) {
      p.steps.push({id:uid(),type:'other',title:'Новый этап',state:'active'});
    }
    const pending=p.steps.filter(s=>!['done','cancelled'].includes(s.state));
    if(pending.length && !pending.some(s=>s.state!=='waiting')) pending[0].state='active';
    syncPatientPriority(p,p.priority==='urgent');
    log(p,'Маршрут изменён'); modal={type:'details',patient:p.id}; save(); return render();
  }
  if (action==='more') { modal={type:'more',patient:el.dataset.patient}; return render(); }
  if (action==='pin') {
    state.patients.forEach(p=>{ if(p.id!==el.dataset.patient) p.pinned=false; });
    const p=state.patients.find(p=>p.id===el.dataset.patient); p.pinned=!p.pinned; log(p,p.pinned?'Назначен следующим':'Ручной приоритет снят'); save(); return render();
  }
  if (action==='advance') {
    const p=state.patients.find(p=>p.id===el.dataset.patient), s=currentStep(p); if(!s)return;
    p.pinned=false;
    if (isOperationStep(s) && ['active','waiting','in_progress'].includes(s.state)) { s.state='in_or'; s.startedAt=Date.now(); log(p,'Доставлен в оперблок, таймер запущен'); }
    else if (s.state==='in_or') { s.state='pickup'; log(p,'Поступил вызов: пациента нужно забрать'); }
    else if (s.state==='pickup') { modal={type:'destination',patient:p.id}; return render(); }
    else if (s.state==='in_progress') { const finished=completeCurrentStep(p); log(p,`Выполнено: ${finished.step.title}`); }
    else { s.state='in_progress'; log(p,`Начато: ${s.title}`); }
    save(); return render();
  }
  if (action==='advance-next') {
    const p=state.patients.find(p=>p.id===el.dataset.patient), s=currentStep(p);
    if(!p || !s || s.state!=='in_progress' || !nextWaitingStep(p)) return;
    p.pinned=false;
    const moved=completeCurrentStep(p,true);
    log(p,`Выполнено: ${moved.step.title} → начато: ${moved.next.title}`);
    save(); return render();
  }
  if (action==='finish-operation') {
    const p=state.patients.find(p=>p.id===el.dataset.patient);
    const continueNow=Boolean(document.getElementById('continue-after-operation')?.checked);
    const finished=completeCurrentStep(p,continueNow);
    log(p,`Забран из оперблока: ${el.dataset.destination}${continueNow&&finished.next?` → начато: ${finished.next.title}`:''}`);
    modal=null; save(); return render();
  }
  if (action==='submit-quick') {
    const form=document.getElementById('quick-form'); if(!form.reportValidity()) return;
    const fd=new FormData(form), type=fd.get('type'), urgent=fd.get('urgent')==='on';
    const title=fd.get('title').trim() || typeLabel(type);
    const p={id:uid(),surname:fd.get('surname').trim(),room:fd.get('room').trim(),block:'',transport:'',priority:'normal',pinned:false,steps:[{id:uid(),type,title,time:fd.get('time')||'',state:'active',urgent,needsClarification:!fd.get('room')}],note:'',events:[]};
    syncPatientPriority(p,urgent);
    log(p,urgent?'Добавлено срочное поручение':'Создана быстрая запись');
    state.patients.push(p); modal=null; save(); return render();
  }
  if (action==='submit-patient') {
    const form=document.getElementById('patient-form'); if(!form.reportValidity()) return;
    const fd=new FormData(form), type=fd.get('type'), urgent=fd.get('urgent')==='1';
    let types=fd.getAll('extra-direction').map(String); if(!types.includes(type))types.unshift(type);
    types=[...new Set(types)];
    const steps=types.map((t,i)=>({id:uid(),type:t,title:t===type?fd.get('destination'):typeLabel(t),time:i===0?(fd.get('time')||''):'',state:i===0?'active':'waiting',urgent:urgent&&i===0,needsClarification:!fd.get('room')||!fd.get('transport')}));
    const p={id:uid(),surname:fd.get('surname'),room:fd.get('room'),block:fd.get('block'),transport:fd.get('transport'),priority:'normal',pinned:false,steps,note:fd.get('note'),events:[]};
    syncPatientPriority(p,urgent);
    log(p,urgent?'Добавлено срочное поручение':'Создан маршрут на сегодня'); state.patients.push(p); modal=null; save(); return render();
  }
  if (['cancel-step','postpone-step','handoff'].includes(action)) {
    const p=state.patients.find(p=>p.id===el.dataset.patient), s=currentStep(p); if(!s)return;
    const text=action==='cancel-step'?`Отменено: ${s.title}`:action==='postpone-step'?`Перенесено: ${s.title}`:`Передано другому сотруднику: ${s.title}`;
    s.state=action==='handoff'?'done':'cancelled'; log(p,text); activateNext(p);
    syncPatientPriority(p,Boolean(currentStep(p)?.urgent)); modal=null; save(); return render();
  }
  if (action==='delete-patient') { modal={type:'confirm-delete',patient:el.dataset.patient}; return render(); }
  if (action==='confirm-delete-patient') { state.patients=state.patients.filter(p=>p.id!==el.dataset.patient); modal=null; save(); return render(); }
  if (action==='new-shift') { modal={type:'confirm-new-shift'}; return render(); }
  if (action==='confirm-new-shift') {
    state.archive ||= [];
    if(state.patients.length) state.archive.push({id:uid(),closedAt:Date.now(),patients:clone(state.patients)});
    state.patients=[]; modal=null; view='today'; save(); return render();
  }
  if (action==='reset') { modal={type:'confirm-reset'}; return render(); }
  if (action==='confirm-reset') { localStorage.removeItem(STORAGE_KEY); state=clone(seed); modal=null; view='today'; save(); return render(); }
}

globalThis.__MEDFLOW_TEST__={currentStep,isComplete,score,nextWaitingStep,activateNext,canContinueNow,completeCurrentStep,actionLabel,timerClass,shiftProgress,esc,isOperationStep,hasTodayOperation,normalizeState,typeLabel,syncPatientPriority,stepMatchesDirection,parseTime,patientTimeMinutes,comparePatients,sortPatients};
setInterval(()=>{ if(document.querySelector('.timer')) render(); },30000);
render();
