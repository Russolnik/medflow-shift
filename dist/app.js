const STORAGE_KEY = 'medflow-prototype-v1';
const AUTH_STORAGE_KEY = 'medflow-supabase-session-v1';
const SYNC_META_KEY = 'medflow-sync-meta-v1';
const SYNC_STATE_KEY = 'medflow-sync-state-v2';
const RETRY_DELAYS = [5000, 15000, 30000];
const SUPABASE_URL = 'https://lzntgijkwzrptvkgetyx.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_VwHAjChFPXOxMVpomhYwCw_JjfL7ryV';

const DEFAULT_DIRECTIONS = [
  { id: 'operation', label: 'Операция', locked: true },
  { id: 'xray', label: 'Рентген' },
  { id: 'ecg', label: 'ЭКГ' },
  { id: 'ultrasound', label: 'УЗИ' },
  { id: 'ct', label: 'КТ' },
  { id: 'mri', label: 'МРТ' },
  { id: 'echo', label: 'Эхо' },
  { id: 'baro', label: 'Барокамера' },
  { id: 'fgs', label: 'ФГС' }
];

const SYSTEM_STEPS = [
  { id: 'icu', label: 'Реанимация' },
  { id: 'ward', label: 'Палата' },
  { id: 'other', label: 'Другое' }
];

const DEFAULT_DEPARTMENTS = [
  { id: 'department-own', label: 'Наше отделение' }
];

const CONTACT_ROLES = [
  { id: 'doctor', label: 'Врач' },
  { id: 'nurse', label: 'Медсестра' },
  { id: 'orderly', label: 'Санитар / санитарка' },
  { id: 'other', label: 'Другое' }
];

const SORT_MODES = ['priority', 'department', 'time-asc', 'time-desc'];
const ADD_BUTTON_POSITIONS = ['floating', 'inline'];
const DOCUMENT_STATUSES = ['taken', 'not_required'];

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
  schemaVersion: 6,
  shiftStartedAt: Date.now(),
  patients: [
    {
      id: uid(), surname: 'Иванов', room: '6', departmentId: 'department-own', block: 'op', transport: 'Кресло', priority: 'operation', pinned: false,
      steps: [
        { id: uid(), type: 'ecg', title: 'ЭКГ', state: 'done' },
        { id: uid(), type: 'xray', title: 'Рентген', state: 'active' },
        { id: uid(), type: 'operation', title: 'Операция', state: 'waiting' }
      ], note: 'Рентген по пути к оперблоку', events: []
    },
    {
      id: uid(), surname: 'Петрова', room: '12', departmentId: 'department-own', block: 'angio', transport: 'Каталка', priority: 'operation', pinned: false,
      steps: [
        { id: uid(), type: 'operation', title: 'Операция', state: 'in_or', startedAt: Date.now() - 76 * 60000 }
      ], note: '', events: []
    },
    {
      id: uid(), surname: 'Смирнов', room: '3', departmentId: 'department-own', block: '', transport: 'Пешком', priority: 'urgent', pinned: false,
      steps: [{ id: uid(), type: 'ct', title: 'Срочное КТ', state: 'active', urgent: true }],
      note: 'Уточнить сопровождение на посту', events: []
    }
  ],
  archive: [],
  directions: clone(DEFAULT_DIRECTIONS),
  departments: clone(DEFAULT_DEPARTMENTS),
  contacts: [],
  settings: { sortMode: 'priority', addButtonPosition: 'floating', ownDepartmentId: 'department-own' }
};

let state = load();
let view = 'today';
let direction = 'all';
let departmentFilter = 'all';
let contactDepartmentFilter = 'all';
let contactRoleFilter = 'all';
let modal = null;
let showCompleted = false;
let localUpdatedAt = Number(localStorage.getItem(SYNC_META_KEY)) || 0;
let syncTimer = null;
let retryTimer = null;
let retryAttempt = 0;
let syncMeta = loadSyncMeta();
let cloud = {
  session: loadCloudSession(),
  status: navigator.onLine ? 'local' : 'offline',
  message: '',
  syncing: false,
  lastSyncedAt: syncMeta.lastSyncAt || 0
};

function load() {
  try { return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY)) || clone(seed)); }
  catch { return normalizeState(clone(seed)); }
}
function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  localUpdatedAt = Date.now();
  localStorage.setItem(SYNC_META_KEY, String(localUpdatedAt));
  scheduleCloudSync();
}
function loadSyncMeta() {
  try {
    const value=JSON.parse(localStorage.getItem(SYNC_STATE_KEY))||{};
    return { lastRemoteVersion:Number(value.lastRemoteVersion)||0, lastLocalAt:Number(value.lastLocalAt)||0, lastSyncAt:Number(value.lastSyncAt)||0 };
  } catch { return {lastRemoteVersion:0,lastLocalAt:0,lastSyncAt:0}; }
}
function storeSyncMeta(next={}) {
  syncMeta={...syncMeta,...next};
  localStorage.setItem(SYNC_STATE_KEY,JSON.stringify(syncMeta));
  cloud.lastSyncedAt=syncMeta.lastSyncAt||0;
}
function clearCloudRetry() {
  if(retryTimer) clearTimeout(retryTimer);
  retryTimer=null; retryAttempt=0;
}
function scheduleCloudRetry() {
  if(retryTimer || !cloud.session?.user?.id || !navigator.onLine) return;
  const delay=RETRY_DELAYS[Math.min(retryAttempt,RETRY_DELAYS.length-1)];
  retryAttempt+=1;
  cloud.message=`Повторная попытка через ${Math.round(delay/1000)} сек.`;
  retryTimer=setTimeout(()=>{ retryTimer=null; syncCloudState(); },delay);
}
function loadCloudSession() {
  try { return JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY)) || null; }
  catch { return null; }
}
function storeCloudSession(session) {
  cloud.session = session || null;
  if (session) localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  else localStorage.removeItem(AUTH_STORAGE_KEY);
}
function sessionEmail() { return cloud.session?.user?.email || ''; }
function cloudHeaders(auth=true) {
  const headers = { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' };
  if (auth && cloud.session?.access_token) headers.Authorization = `Bearer ${cloud.session.access_token}`;
  return headers;
}
async function cloudRequest(path, options={}, auth=true) {
  const response = await fetch(`${SUPABASE_URL}${path}`, { ...options, headers: { ...cloudHeaders(auth), ...(options.headers || {}) } });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(body?.msg || body?.message || body?.error_description || body?.error || `Ошибка ${response.status}`);
  return body;
}
async function refreshCloudSession() {
  const token = cloud.session?.refresh_token;
  if (!token || !navigator.onLine) return false;
  try {
    const session = await cloudRequest('/auth/v1/token?grant_type=refresh_token', { method:'POST', body:JSON.stringify({refresh_token:token}) }, false);
    storeCloudSession(session);
    return true;
  } catch {
    storeCloudSession(null);
    cloud.status = 'local';
    cloud.message = 'Нужно войти снова';
    return false;
  }
}
async function ensureCloudSession() {
  if (!cloud.session?.access_token) return false;
  const expiresAt = Number(cloud.session.expires_at || 0) * 1000;
  if (expiresAt && expiresAt < Date.now() + 60000) return refreshCloudSession();
  return true;
}
async function pushCloudState() {
  if (!cloud.session?.user?.id || !navigator.onLine) return false;
  const ready = await ensureCloudSession();
  if (!ready) return false;
  const at = localUpdatedAt || Date.now();
  const rows=await cloudRequest('/rest/v1/medflow_states?on_conflict=user_id&select=client_updated_at,updated_at', {
    method:'POST',
    headers:{ Prefer:'resolution=merge-duplicates,return=representation' },
    body:JSON.stringify({ user_id:cloud.session.user.id, payload:state, client_updated_at:new Date(at).toISOString() })
  });
  const row=Array.isArray(rows)?rows[0]:rows;
  const remoteVersion=row?.updated_at?new Date(row.updated_at).getTime():Date.now();
  const syncedAt=Date.now();
  storeSyncMeta({lastRemoteVersion:remoteVersion,lastLocalAt:at,lastSyncAt:syncedAt});
  clearCloudRetry();
  cloud.status = 'synced';
  cloud.message = '';
  return true;
}
function applyRemoteState(remote, message='Данные загружены из облака') {
  state=normalizeState(clone(remote.payload));
  localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
  localUpdatedAt=new Date(remote.client_updated_at||remote.updated_at).getTime()||Date.now();
  localStorage.setItem(SYNC_META_KEY,String(localUpdatedAt));
  const now=Date.now();
  storeSyncMeta({lastRemoteVersion:new Date(remote.updated_at).getTime()||now,lastLocalAt:localUpdatedAt,lastSyncAt:now});
  clearCloudRetry();
  cloud.status='synced'; cloud.message=message;
}
async function syncCloudState({preferRemote=false}={}) {
  if (cloud.syncing || !cloud.session?.user?.id) return;
  if (!navigator.onLine) { cloud.status='offline'; cloud.message='Изменения сохранены на устройстве'; return; }
  cloud.syncing = true;
  cloud.status = 'syncing';
  if (view === 'settings' || view === 'today') render(true);
  try {
    const ready = await ensureCloudSession();
    if (!ready) return;
    const rows = await cloudRequest(`/rest/v1/medflow_states?select=payload,client_updated_at,updated_at&user_id=eq.${encodeURIComponent(cloud.session.user.id)}&limit=1`);
    const remote = rows?.[0];
    const remoteAt = remote ? new Date(remote.client_updated_at || remote.updated_at).getTime() : 0;
    const remoteVersion=remote?new Date(remote.updated_at).getTime():0;
    const localDirty=localUpdatedAt>(syncMeta.lastLocalAt||0);
    const hasBaseline=Boolean(syncMeta.lastRemoteVersion);
    const remoteChanged=Boolean(remote && hasBaseline && remoteVersion!==syncMeta.lastRemoteVersion);
    if(remote && localDirty && (remoteChanged || !hasBaseline) && !preferRemote) {
      cloud.status='conflict'; cloud.message='Есть изменения на другом устройстве';
      modal={type:'sync-conflict',localState:clone(state),remoteState:normalizeState(clone(remote.payload)),remoteVersion,remoteAt};
      render(true); return;
    }
    if(remote && (preferRemote || (!localDirty && remoteChanged) || (!hasBaseline && remoteAt>localUpdatedAt))) {
      applyRemoteState(remote); render(true);
    } else if(remote && !localDirty && !remoteChanged) {
      const now=Date.now(); storeSyncMeta({lastRemoteVersion:remoteVersion,lastLocalAt:localUpdatedAt,lastSyncAt:now}); clearCloudRetry(); cloud.status='synced'; cloud.message='';
    } else await pushCloudState();
  } catch (error) {
    cloud.status = 'error';
    cloud.message = error.message || 'Не удалось синхронизировать';
    scheduleCloudRetry();
  } finally {
    cloud.syncing = false;
    if (view === 'settings' || view === 'today') render(true);
  }
}
function scheduleCloudSync() {
  if (!cloud.session?.user?.id) return;
  clearTimeout(syncTimer);
  cloud.status = navigator.onLine ? 'pending' : 'offline';
  syncTimer = setTimeout(()=>syncCloudState(), 900);
}
async function signInCloud(email,password) {
  const session = await cloudRequest('/auth/v1/token?grant_type=password', { method:'POST', body:JSON.stringify({email,password}) }, false);
  storeCloudSession(session);
  cloud.message = 'Вход выполнен';
  await syncCloudState();
}
async function signUpCloud(email,password) {
  const result = await cloudRequest('/auth/v1/signup', { method:'POST', body:JSON.stringify({email,password}) }, false);
  if (result?.access_token) {
    storeCloudSession(result);
    cloud.message = 'Аккаунт создан';
    await syncCloudState();
  } else {
    cloud.message = 'Проверь почту и подтверди регистрацию, затем войди';
  }
}
async function signOutCloud() {
  try {
    if (cloud.session?.access_token && navigator.onLine) await cloudRequest('/auth/v1/logout', {method:'POST'});
  } catch {}
  clearCloudRetry();
  storeCloudSession(null);
  cloud.status = navigator.onLine ? 'local' : 'offline';
  cloud.message = 'Облачная сессия завершена. Локальные данные сохранены';
}
function authErrorMessage(error) {
  const message=String(error?.message||'').toLowerCase();
  if(message.includes('invalid login credentials')) return 'Неверный email или пароль';
  if(message.includes('email not confirmed')) return 'Сначала подтверди email по ссылке из письма';
  if(message.includes('user already registered')) return 'Аккаунт с таким email уже существует — попробуй войти';
  if(message.includes('password should be')) return 'Пароль должен содержать минимум 8 символов';
  if(message.includes('rate limit')) return 'Слишком много попыток. Подожди немного и повтори';
  return error?.message||'Не удалось выполнить вход';
}
function stepTouchedAt(step={}) {
  return Math.max(0,...['startedAt','arrivedAt','readyAt','pickedUpAt','finishedAt'].map(key=>Number(step[key])||0));
}
function stepStateRank(value) {
  return ({waiting:0,active:1,in_progress:2,in_or:3,pickup:4,postponed:5,cancelled:5,done:6})[value] ?? 0;
}
function mergeStep(localStep,remoteStep) {
  if(!localStep) return clone(remoteStep);
  if(!remoteStep) return clone(localStep);
  const localTime=stepTouchedAt(localStep), remoteTime=stepTouchedAt(remoteStep);
  const preferred=remoteTime>localTime || (remoteTime===localTime && stepStateRank(remoteStep.state)>stepStateRank(localStep.state)) ? remoteStep : localStep;
  return {...clone(localStep),...clone(remoteStep),...clone(preferred),documents:{...(localStep.documents||{}),...(remoteStep.documents||{}),...(preferred.documents||{})}};
}
function mergePatient(localPatient,remotePatient) {
  if(!localPatient) return clone(remotePatient);
  if(!remotePatient) return clone(localPatient);
  const localSteps=new Map((localPatient.steps||[]).map(step=>[step.id,step]));
  const remoteSteps=new Map((remotePatient.steps||[]).map(step=>[step.id,step]));
  const stepIds=[...new Set([...localSteps.keys(),...remoteSteps.keys()])];
  const events=[...(localPatient.events||[]),...(remotePatient.events||[])].filter((event,index,all)=>index===all.findIndex(item=>item.at===event.at&&item.text===event.text)).sort((a,b)=>(a.at||0)-(b.at||0));
  const patientTime=patient=>Math.max(0,...(patient.steps||[]).map(stepTouchedAt),...(patient.events||[]).map(event=>Number(event.at)||0));
  const preferred=patientTime(remotePatient)>patientTime(localPatient)?remotePatient:localPatient;
  return {...clone(localPatient),...clone(remotePatient),...clone(preferred),steps:stepIds.map(id=>mergeStep(localSteps.get(id),remoteSteps.get(id))),events};
}
function mergeStates(localState,remoteState) {
  const local=normalizeState(clone(localState)), remote=normalizeState(clone(remoteState));
  const localPatients=new Map(local.patients.map(patient=>[patient.id,patient]));
  const remotePatients=new Map(remote.patients.map(patient=>[patient.id,patient]));
  const patientIds=[...new Set([...localPatients.keys(),...remotePatients.keys()])];
  const archives=[...(remote.archive||[]),...(local.archive||[])].filter((shift,index,all)=>index===all.findIndex(item=>item.id===shift.id));
  const directions=[...(local.directions||[]),...(remote.directions||[])].filter((item,index,all)=>index===all.findIndex(entry=>entry.id===item.id));
  const departments=[...(local.departments||[]),...(remote.departments||[])].filter((item,index,all)=>index===all.findIndex(entry=>entry.id===item.id));
  const contacts=[...(local.contacts||[]),...(remote.contacts||[])].filter((item,index,all)=>index===all.findIndex(entry=>entry.id===item.id));
  return normalizeState({...remote,...local,patients:patientIds.map(id=>mergePatient(localPatients.get(id),remotePatients.get(id))),archive:archives,directions,departments,contacts});
}
function backupEnvelope() {
  return {format:'medflow-backup',version:1,exportedAt:new Date().toISOString(),state:clone(state)};
}
function exportBackup() {
  const blob=new Blob([JSON.stringify(backupEnvelope(),null,2)],{type:'application/json'});
  const link=document.createElement('a');
  link.href=URL.createObjectURL(blob);
  link.download=`medflow-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(link.href);
}
async function requestPasswordReset(email) {
  const redirectTo=typeof location==='undefined'?'':`${location.origin}${location.pathname}`;
  return cloudRequest(`/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`,{method:'POST',body:JSON.stringify({email})},false);
}
async function handleAuthRedirect() {
  if(typeof location==='undefined' || !location.hash) return;
  const params=new URLSearchParams(location.hash.slice(1));
  if(params.get('type')!=='recovery' || !params.get('access_token')) return;
  const accessToken=params.get('access_token'), refreshToken=params.get('refresh_token');
  const user=await cloudRequest('/auth/v1/user',{headers:{Authorization:`Bearer ${accessToken}`}},false);
  storeCloudSession({access_token:accessToken,refresh_token:refreshToken,expires_at:Math.floor(Date.now()/1000)+Number(params.get('expires_in')||3600),user});
  if(typeof history!=='undefined') history.replaceState(null,'',`${location.pathname}${location.search}`);
  modal={type:'password-update',error:''}; render();
}
function esc(value='') { return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function validTimestamp(value) { return Number.isFinite(value) && value > 0 ? value : null; }
function normalizeDocumentRecord(value) {
  if (!value || !DOCUMENT_STATUSES.includes(value.status)) return null;
  return { status:value.status, at:validTimestamp(value.at) };
}
function normalizeStep(step) {
  if (!step || typeof step !== 'object') return null;
  step.documents = step.documents && typeof step.documents === 'object' ? step.documents : {};
  const start = normalizeDocumentRecord(step.documents.start);
  const finish = normalizeDocumentRecord(step.documents.finish);
  step.documents = {};
  if (start) step.documents.start = start;
  if (finish) step.documents.finish = finish;
  if (isOperationStep(step) && validTimestamp(step.startedAt) && !validTimestamp(step.arrivedAt) && ['in_or','pickup','done'].includes(step.state)) {
    step.arrivedAt = step.startedAt;
    delete step.startedAt;
  }
  return step;
}
function normalizePatient(patient) {
  if (!patient || typeof patient !== 'object') return null;
  patient.steps = Array.isArray(patient.steps) ? patient.steps.map(normalizeStep).filter(Boolean) : [];
  patient.events = Array.isArray(patient.events) ? patient.events : [];
  patient.departmentId = String(patient.departmentId || '');
  patient.doctorId = String(patient.doctorId || '');
  patient.doctorName = String(patient.doctorName || '');
  patient.block = ['gxo','xo','op'].includes(patient.block) ? 'op' : patient.block === 'angio' ? 'angio' : '';
  return patient;
}
function normalizeContact(contact) {
  if (!contact || typeof contact !== 'object') return null;
  const name=String(contact.name||'').trim();
  if(!name) return null;
  return {id:String(contact.id||uid()),name,role:CONTACT_ROLES.some(item=>item.id===contact.role)?contact.role:'other',departmentId:String(contact.departmentId||''),phone:String(contact.phone||'').trim(),note:String(contact.note||'').trim()};
}
function inferShiftStart(patients) {
  const timestamps = (Array.isArray(patients) ? patients : []).flatMap(patient => [
    ...(Array.isArray(patient?.events) ? patient.events.map(event => validTimestamp(event?.at)) : []),
    ...(Array.isArray(patient?.steps) ? patient.steps.flatMap(step => ['startedAt','arrivedAt','readyAt','pickedUpAt','finishedAt'].map(key => validTimestamp(step?.[key]))) : [])
  ]).filter(Boolean);
  return timestamps.length ? Math.min(...timestamps) : null;
}
function normalizeState(value) {
  const next = value && typeof value === 'object' ? value : clone(seed);
  const incomingVersion = Number(next.schemaVersion) || 1;
  next.schemaVersion = 6;
  next.patients = Array.isArray(next.patients) ? next.patients.map(normalizePatient).filter(Boolean) : [];
  next.shiftStartedAt = validTimestamp(next.shiftStartedAt) || inferShiftStart(next.patients) || Date.now();
  next.archive = Array.isArray(next.archive) ? next.archive.filter(shift => shift && typeof shift === 'object') : [];
  next.archive.forEach(shift => {
    shift.patients = Array.isArray(shift.patients) ? shift.patients.map(normalizePatient).filter(Boolean) : [];
    shift.startedAt = validTimestamp(shift.startedAt) || inferShiftStart(shift.patients);
    shift.closedAt = validTimestamp(shift.closedAt);
  });
  next.settings = next.settings && typeof next.settings === 'object' ? next.settings : {};
  if (!SORT_MODES.includes(next.settings.sortMode)) next.settings.sortMode = 'priority';
  if (!ADD_BUTTON_POSITIONS.includes(next.settings.addButtonPosition)) next.settings.addButtonPosition = 'floating';
  if (!Array.isArray(next.departments)) next.departments = clone(DEFAULT_DEPARTMENTS);
  const departmentIds = new Set();
  next.departments = next.departments
    .filter(item => item && String(item.label || '').trim())
    .map(item => ({ id: String(item.id || `department-${uid()}`), label: String(item.label).trim() }))
    .filter(item => !departmentIds.has(item.id) && departmentIds.add(item.id));
  if (!next.departments.length) next.departments = clone(DEFAULT_DEPARTMENTS);
  if (!next.departments.some(item => item.id === next.settings.ownDepartmentId)) next.settings.ownDepartmentId = next.departments[0].id;
  const validDepartmentIds = new Set(next.departments.map(item => item.id));
  next.patients.forEach(patient => { if (!validDepartmentIds.has(patient.departmentId)) patient.departmentId = ''; });
  next.archive.forEach(shift => shift.patients.forEach(patient => { if (!validDepartmentIds.has(patient.departmentId)) patient.departmentId = ''; }));
  next.contacts = Array.isArray(next.contacts) ? next.contacts.map(normalizeContact).filter(Boolean) : [];
  next.contacts.forEach(contact => { if(!validDepartmentIds.has(contact.departmentId)) contact.departmentId=''; });
  const validContactIds=new Set(next.contacts.map(contact=>contact.id));
  const normalizeDoctorLink=patient=>{ if(patient.doctorId && patient.doctorId!=='external' && !validContactIds.has(patient.doctorId)) patient.doctorId=patient.doctorName?'external':''; };
  next.patients.forEach(normalizeDoctorLink);
  next.archive.forEach(shift=>shift.patients.forEach(normalizeDoctorLink));
  if (!Array.isArray(next.directions)) next.directions = clone(DEFAULT_DIRECTIONS);
  next.directions = next.directions
    .filter(item => item && item.id && String(item.label || '').trim())
    .map(item => ({ id: String(item.id), label: String(item.label).trim(), locked: item.id === 'operation' }));
  if (!next.directions.some(item => item.id === 'operation')) next.directions.unshift(clone(DEFAULT_DIRECTIONS[0]));
  if (incomingVersion < 3 && !next.directions.some(item => item.id === 'fgs')) next.directions.push(clone(DEFAULT_DIRECTIONS.find(item=>item.id==='fgs')));
  return next;
}
function getDirections() { return state.directions || DEFAULT_DIRECTIONS; }
function getDepartments() { return state.departments || DEFAULT_DEPARTMENTS; }
function ownDepartmentId() { return state.settings?.ownDepartmentId || getDepartments()[0]?.id || ''; }
function departmentLabel(id) { return getDepartments().find(item => item.id === id)?.label || 'Не указано'; }
function isOwnDepartment(patient) { return Boolean(patient?.departmentId && patient.departmentId === ownDepartmentId()); }
function departmentOptions(selected='', includeUnknown=true) {
  return `${includeUnknown ? `<option value="" ${!selected?'selected':''}>Не указано</option>` : ''}${getDepartments().map(item => `<option value="${esc(item.id)}" ${item.id===selected?'selected':''}>${esc(item.label)}${item.id===ownDepartmentId()?' · наше':''}</option>`).join('')}`;
}
function patientMatchesDepartment(patient, selected=departmentFilter) {
  return selected === 'all' || (selected === 'none' ? !patient.departmentId : patient.departmentId === selected);
}
function getContacts() { return state.contacts || []; }
function contactRoleLabel(role) { return CONTACT_ROLES.find(item=>item.id===role)?.label || 'Другое'; }
function doctorContacts() { return getContacts().filter(contact=>contact.role==='doctor').sort((a,b)=>a.name.localeCompare(b.name,'ru')); }
function doctorOptions(patient={}) {
  return `<option value="">Не указан</option><option value="external" ${patient.doctorId==='external'?'selected':''}>Врач другого отделения / вручную</option>${doctorContacts().map(contact=>`<option value="${esc(contact.id)}" ${patient.doctorId===contact.id?'selected':''}>${esc(contact.name)} · ${esc(departmentLabel(contact.departmentId))}</option>`).join('')}`;
}
function patientDoctor(patient) {
  const contact=getContacts().find(item=>item.id===patient?.doctorId);
  if(contact) return {name:contact.name,departmentId:contact.departmentId,phone:contact.phone,role:contact.role};
  if(patient?.doctorId==='external' || patient?.doctorName) return {name:patient.doctorName||'Врач другого отделения',departmentId:patient.departmentId||'',phone:'',role:'doctor'};
  return null;
}
function phoneHref(phone='') {
  const cleaned=String(phone).trim().replace(/[^\d+*#,;]/g,'');
  return cleaned ? `tel:${cleaned}` : '';
}
function directionOptions(selected='', includeSystem=false) {
  const items = includeSystem ? [...getDirections(), ...SYSTEM_STEPS] : getDirections();
  return items.map(item => `<option value="${esc(item.id)}" ${item.id===selected?'selected':''}>${esc(item.label)}</option>`).join('');
}
function isStoppedStep(step) { return ['cancelled','postponed'].includes(step?.state); }
function isTerminalStep(step) { return step?.state === 'done' || isStoppedStep(step); }
function isHistoryStep(step) { return isTerminalStep(step); }
function currentStep(patient) { return patient.steps.find(step => !isTerminalStep(step)); }
function isComplete(patient) { return patient.steps.every(isTerminalStep); }
function isOperationStep(step) {
  return Boolean(step && (step.type === 'operation' || /операц|оперблок|операцион/i.test(step.title || '')));
}
function hasTodayOperation(patient) {
  return Boolean(patient?.steps?.some(step => !isStoppedStep(step) && isOperationStep(step)));
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
  const pending = patient.steps.filter(step => !isTerminalStep(step));
  const source = pending.length ? pending : patient.steps.filter(step => step.state === 'done');
  const times = source.map(step => parseTime(step.time)).filter(value => value !== null);
  return times.length ? Math.min(...times) : null;
}
function comparePatients(a, b, mode=state.settings.sortMode) {
  if (mode === 'priority') return score(b) - score(a);
  const fixedPriority = patient => patient.pinned ? 3 : (currentStep(patient)?.urgent || patient.priority === 'urgent') ? 2 : hasTodayOperation(patient) ? 1 : 0;
  const priorityDifference = fixedPriority(b) - fixedPriority(a);
  if (priorityDifference) return priorityDifference;
  if (mode === 'department') {
    const departmentDifference = departmentLabel(a.departmentId).localeCompare(departmentLabel(b.departmentId), 'ru');
    return departmentDifference || score(b) - score(a);
  }
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
    <option value="department" ${state.settings.sortMode==='department'?'selected':''}>${compact?'Отделение':'По отделению'}</option>
    <option value="time-asc" ${state.settings.sortMode==='time-asc'?'selected':''}>${compact?'Время ↑':'По времени: сначала ранние'}</option>
    <option value="time-desc" ${state.settings.sortMode==='time-desc'?'selected':''}>${compact?'Время ↓':'По времени: сначала поздние'}</option>
  </select></div>`;
}
function blockLabel(block) { return ({op:'ОПРБЛК',angio:'АНГБЛК'})[block] || ''; }
function typeLabel(type) {
  return getDirections().find(item => item.id === type)?.label || SYSTEM_STEPS.find(item => item.id === type)?.label || type;
}
function stepMatchesDirection(step, selected) {
  if (selected === 'all') return true;
  return selected === 'operation' ? isOperationStep(step) : step.type === selected;
}
function canEditRouteStep(step) { return Boolean(step && ['active','waiting'].includes(step.state)); }
function changeRouteStepType(step, type) {
  if(!canEditRouteStep(step)) return false;
  step.type=type;
  step.title=typeLabel(type);
  return true;
}
function fmtDuration(ms) {
  const mins = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h} ч ${m} мин` : `${m} мин`;
}
function timerClass(ms) { const m = ms/60000; return m < 60 ? 'green' : m < 120 ? 'yellow' : 'red'; }
function fmtClock(value) {
  const timestamp = validTimestamp(value);
  return timestamp ? new Date(timestamp).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}) : '—';
}
function durationBetween(start, end) {
  const from = validTimestamp(start), to = validTimestamp(end);
  return from && to && to >= from ? to - from : null;
}
function operationElapsed(step, now=Date.now()) {
  const started = validTimestamp(step?.arrivedAt) || validTimestamp(step?.startedAt);
  if (!started) return 0;
  const ended = validTimestamp(step?.pickedUpAt) || validTimestamp(now);
  return ended && ended >= started ? ended - started : 0;
}
function pickupTravelElapsed(step, now=Date.now()) {
  const started=validTimestamp(step?.pickedUpAt);
  if(!started) return 0;
  const ended=validTimestamp(step?.finishedAt)||validTimestamp(now);
  return ended && ended>=started ? ended-started : 0;
}
function operationTimersView(step) {
  if(!step) return '';
  const operationTime=operationElapsed(step);
  if(validTimestamp(step.pickedUpAt)) {
    const travelTime=pickupTravelElapsed(step);
    return `<div class="timer-stack"><div class="timer operation-time ${timerClass(operationTime)}"><small>Оперблок</small><b>${fmtDuration(operationTime)}</b></div><div class="timer travel-time"><small>В пути</small><b>${fmtDuration(travelTime)}</b></div></div>`;
  }
  return `<div class="timer ${timerClass(operationTime)}"><small>В оперблоке</small><b>${fmtDuration(operationTime)}</b></div>`;
}
function setStepDocument(step, stage, status, at=Date.now()) {
  if (!step || !['start','finish'].includes(stage) || !DOCUMENT_STATUSES.includes(status)) return false;
  step.documents ||= {};
  step.documents[stage] = {status, at:validTimestamp(at)};
  return true;
}
function documentStatusLabel(record, stage='start') {
  if (record?.status === 'taken') return stage === 'finish' ? 'документы забраны' : 'документы взяты';
  if (record?.status === 'not_required') return 'документы не требовались';
  return 'документы не отмечены';
}
function stepHistoryFacts(step, now=Date.now()) {
  const operation = isOperationStep(step);
  const startedAt = validTimestamp(step?.startedAt);
  const arrivedAt = validTimestamp(step?.arrivedAt);
  const readyAt = validTimestamp(step?.readyAt);
  const pickedUpAt = validTimestamp(step?.pickedUpAt);
  const finishedAt = validTimestamp(step?.finishedAt);
  const preopCheckedAt = validTimestamp(step?.preopCheck?.at);
  const operationEnd = pickedUpAt || (['in_or','pickup'].includes(step?.state) ? validTimestamp(now) : finishedAt || readyAt);
  return {
    title:step?.title || typeLabel(step?.type),
    state:step?.state || 'waiting',
    operation,
    startedAt,
    arrivedAt,
    readyAt,
    pickedUpAt,
    finishedAt,
    preopCheckedAt,
    duration:durationBetween(operation ? arrivedAt : startedAt, operation ? operationEnd : finishedAt),
    travelDuration:operation && pickedUpAt ? durationBetween(pickedUpAt, finishedAt || (step?.state==='pickup' ? validTimestamp(now) : null)) : null,
    destination:step?.destination || '',
    startDocuments:documentStatusLabel(step?.documents?.start,'start'),
    finishDocuments:documentStatusLabel(step?.documents?.finish,'finish')
  };
}
function addButtonPosition(settings=state.settings) {
  return ADD_BUTTON_POSITIONS.includes(settings?.addButtonPosition) ? settings.addButtonPosition : 'floating';
}
function showFloatingAdd(currentView=view, settings=state.settings) {
  return ['today','directions'].includes(currentView) && addButtonPosition(settings) === 'floating';
}
function captureViewPosition() {
  const filters=Array.from(document.querySelectorAll?.('.filters') || []);
  return {
    top:Number.isFinite(globalThis.scrollY) ? globalThis.scrollY : 0,
    filtersLeft:(filters[0] || document.querySelector?.('.filters'))?.scrollLeft || 0,
    filterScrolls:filters.map(node=>node.scrollLeft || 0),
    modalTop:document.querySelector?.('.modal')?.scrollTop || 0
  };
}
function restoreViewPosition(position) {
  if (!position) return;
  const restore = () => {
    const filters=Array.from(document.querySelectorAll?.('.filters') || []);
    if(filters.length) filters.forEach((node,index)=>{ node.scrollLeft=position.filterScrolls?.[index] ?? (index===0?position.filtersLeft:0); });
    else {
      const filter=document.querySelector?.('.filters');
      if(filter) filter.scrollLeft=position.filtersLeft;
    }
    const modalNode=document.querySelector?.('.modal');
    if(modalNode) modalNode.scrollTop=position.modalTop || 0;
    globalThis.scrollTo?.(0, position.top);
  };
  if (typeof globalThis.requestAnimationFrame === 'function') globalThis.requestAnimationFrame(restore);
  else restore();
}
function shiftProgress(patients) {
  const counted = patients.filter(patient => patient.steps.length > 0);
  const taskSteps = counted.flatMap(patient => patient.steps);
  const taskDone = taskSteps.filter(step => step.state === 'done').length;
  const taskRunning = taskSteps.filter(step => ['in_progress','in_or','pickup'].includes(step.state)).length;
  const taskStopped = taskSteps.filter(isStoppedStep).length;
  const taskWaiting = Math.max(0, taskSteps.length - taskDone - taskRunning - taskStopped);
  return {
    patients: {
      done: counted.filter(isComplete).length,
      total: counted.length
    },
    tasks: {
      done: taskDone,
      total: taskSteps.length,
      active: taskRunning,
      cancelled: taskStopped,
      waiting: taskWaiting,
      handled: taskDone + taskStopped,
      remaining: taskRunning + taskWaiting
    }
  };
}
function stepTitle(step) {
  if (step.state === 'in_or') return 'В оперблоке — ожидается вызов';
  if (step.state === 'pickup') return step.pickedUpAt ? 'Забран — укажи место доставки' : 'Позвонили — нужно забрать';
  if (isOperationStep(step) && step.state === 'in_progress') return 'В пути в оперблок';
  if (step.state === 'in_progress') return `Сейчас: ${step.title}`;
  if (step.state === 'active') return step.title;
  if (step.state === 'waiting') return `Предстоит: ${step.title}`;
  return step.title;
}
function actionLabel(step) {
  if (isOperationStep(step) && step.state === 'in_progress') return 'Доставлен в оперблок';
  if (step.state === 'in_or') return 'Позвонили — забирать';
  if (step.state === 'pickup') return step.pickedUpAt ? 'Куда доставлен' : 'Забран из оперблока';
  if (step.state === 'in_progress') return 'Завершить';
  return 'Начать';
}

function render(preservePosition=false) {
  const position = preservePosition ? captureViewPosition() : null;
  const active = sortPatients(state.patients.filter(p => !isComplete(p)));
  const completed = sortPatients(state.patients.filter(isComplete));
  document.getElementById('app').innerHTML = `
    <main class="shell">
      ${topbarView()}
      ${view === 'directions' ? sortControl() : ''}
      ${view === 'today' ? todayView(active, completed) : view === 'directions' ? directionsView() : view === 'contacts' ? contactsView() : view === 'history' ? historyView() : settingsView()}
    </main>
    ${showFloatingAdd() ? '<button class="fab" data-action="add" aria-label="Записать пациента">＋</button>' : ''}
    <nav class="nav">
      ${navButton('today','⌂','Сегодня')}
      ${navButton('directions','⌘','Направления')}
      ${navButton('contacts','☎','Контакты')}
      ${navButton('history','↶','История')}
      ${navButton('settings','⚙','Настройки')}
    </nav>
    <input id="backup-file" class="visually-hidden" type="file" accept="application/json,.json" />
    ${modal ? modalView() : ''}
  `;
  bind();
  restoreViewPosition(position);
}

function navButton(id, icon, text) { return `<button class="nav-btn ${view===id?'active':''}" data-view="${id}"><b>${icon}</b>${text}</button>`; }
function topbarView() {
  const inlineAdd = addButtonPosition() === 'inline';
  if (view !== 'today') {
    const title = view === 'directions' ? 'Направления' : view === 'contacts' ? 'Контакты' : view === 'history' ? 'История' : 'Настройки';
    return `<header class="topbar section-topbar"><h1>${title}</h1>${view==='directions'&&inlineAdd?'<button class="icon-btn quick-add-btn" data-action="add" aria-label="Записать пациента">＋</button>':''}</header>`;
  }
  const progress = shiftProgress(state.patients);
  const taskPercent = value => progress.tasks.total ? (value / progress.tasks.total * 100).toFixed(2) : 0;
  const patientCount = progress.patients.total ? `${progress.patients.done}/${progress.patients.total}` : '0';
  return `<header class="topbar today-topbar ${inlineAdd?'inline-add':''}">
    <details class="shift-progress">
      <summary aria-label="Завершено маршрутов пациентов: ${progress.patients.done} из ${progress.patients.total}">
        <span class="progress-track" role="img" aria-label="Задачи: выполнено ${progress.tasks.done}, выполняется ${progress.tasks.active}, отменено или перенесено ${progress.tasks.cancelled}, ожидает ${progress.tasks.waiting}">
          <i class="progress-segment done" style="width:${taskPercent(progress.tasks.done)}%"></i>
          <i class="progress-segment running" style="width:${taskPercent(progress.tasks.active)}%"></i>
          <i class="progress-segment stopped" style="width:${taskPercent(progress.tasks.cancelled)}%"></i>
        </span>
        <b>${patientCount}</b><i class="toggle-chevron" aria-hidden="true"></i>
      </summary>
      <div class="progress-breakdown">
        <div class="done"><b>${progress.tasks.done}</b><span>выполнено</span></div>
        <div class="running"><b>${progress.tasks.active}</b><span>выполняется</span></div>
        <div class="stopped"><b>${progress.tasks.cancelled}</b><span>отмена / перенос</span></div>
        <div><b>${progress.tasks.waiting}</b><span>ожидает</span></div>
      </div>
      <p>Счётчик — пациенты, полоска — задачи. Удалённые ошибки не учитываются.</p>
    </details>
    ${syncPillView()}
    ${inlineAdd?'<button class="icon-btn quick-add-btn" data-action="add" aria-label="Записать пациента">＋</button>':''}
  </header>`;
}
function syncPillView() {
  const status=!navigator.onLine?'offline':!cloud.session?'local':cloud.status;
  const labels={local:'Локально',synced:'Сохранено',syncing:'Синхронизация',pending:'Ожидает',offline:'Офлайн',error:'Ошибка',conflict:'Конфликт'};
  const savedAt=cloud.lastSyncedAt||localUpdatedAt;
  const time=savedAt ? ` · ${fmtClock(savedAt)}` : '';
  return `<button class="sync-pill ${esc(status)}" data-action="cloud-status" title="${esc(cloud.message||cloudStatusLabel())}"><i aria-hidden="true"></i><span>${labels[status]||'Облако'}${time}</span></button>`;
}
function departmentFiltersView() {
  const filters = [{id:'all',label:'Все'}, ...getDepartments(), {id:'none',label:'Не указано'}];
  return `<div class="department-filter-wrap"><span>Отделение</span><div class="filters department-filters">${filters.map(item=>`<button class="chip ${departmentFilter===item.id?'active':''}" data-department-filter="${esc(item.id)}">${esc(item.label)}${item.id===ownDepartmentId()?' · наше':''}</button>`).join('')}</div></div>`;
}
function todayView(active, completed) {
  const visibleActive = active.filter(patient => patientMatchesDepartment(patient));
  const visibleCompleted = completed.filter(patient => patientMatchesDepartment(patient));
  const ops = [...visibleActive, ...visibleCompleted].filter(hasTodayOperation).length;
  const inOr = visibleActive.filter(p => p.steps.some(s => ['in_or','pickup'].includes(s.state))).length;
  const engagedPatients = visibleActive.filter(p => p.steps.some(s => ['in_progress','in_or','pickup'].includes(s.state)));
  const queuedPatients = visibleActive.filter(p => !engagedPatients.includes(p));
  const engaged = engagedPatients.length;
  return `
    ${departmentFiltersView()}
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
      <strong><span>${visibleCompleted.length}</span><i class="toggle-chevron ${showCompleted ? 'open' : ''}" aria-hidden="true"></i></strong>
    </button>
    ${showCompleted ? `<div class="patient-list" style="margin-top:10px">${visibleCompleted.map(compactPatientCard).join('') || '<div class="empty">Пока ничего</div>'}</div>` : ''}
  `;
}

function directionsView() {
  const dirs = [{id:'all',label:'Все'}, ...getDirections(), {id:'other',label:'Другое'}];
  const patients = state.patients.filter(p => patientMatchesDepartment(p) && p.steps.some(s=>stepMatchesDirection(s,direction)));
  const waiting = sortPatients(patients.filter(p => p.steps.some(s => stepMatchesDirection(s,direction) && !isTerminalStep(s))));
  const done = sortPatients(patients.filter(p => p.steps.some(s => stepMatchesDirection(s,direction) && isTerminalStep(s))));
  return `
    <div class="section-head directions-head"><div><h2>По направлениям</h2><span>операции, процедуры и другое</span></div><button class="secondary-btn manage-directions-btn" data-action="manage-directions">Настроить</button></div>
    <div class="filters">${dirs.map(d=>`<button class="chip ${direction===d.id?'active':''}" data-direction="${esc(d.id)}">${esc(d.label)}</button>`).join('')}</div>
    ${departmentFiltersView()}
    <div class="section-head"><h2>Ожидают</h2><span>${waiting.length}</span></div>
    <div class="patient-list">${waiting.map(compactPatientCard).join('') || '<div class="empty">Никого не ожидает</div>'}</div>
    <div class="section-head"><h2>Обработано сегодня</h2><span>${done.length}</span></div>
    <div class="patient-list">${done.map(compactPatientCard).join('') || '<div class="empty">Пока ничего не обработано</div>'}</div>
  `;
}

function contactsView() {
  const departments=[{id:'all',label:'Все отделения'},...getDepartments(),{id:'none',label:'Без отделения'}];
  const roles=[{id:'all',label:'Все роли'},...CONTACT_ROLES];
  const contacts=getContacts()
    .filter(contact=>contactDepartmentFilter==='all'||(contactDepartmentFilter==='none'?!contact.departmentId:contact.departmentId===contactDepartmentFilter))
    .filter(contact=>contactRoleFilter==='all'||contact.role===contactRoleFilter)
    .sort((a,b)=>a.name.localeCompare(b.name,'ru'));
  return `<div class="contacts-toolbar"><div><h2>Контакты отделений</h2><span>${getContacts().length} сохранено</span></div><button class="primary-btn contact-add-btn" data-action="contact-add">＋ Добавить</button></div>
    <div class="filter-caption">Отделение</div><div class="filters">${departments.map(item=>`<button class="chip ${contactDepartmentFilter===item.id?'active':''}" data-contact-department="${esc(item.id)}">${esc(item.label)}${item.id===ownDepartmentId()?' · наше':''}</button>`).join('')}</div>
    <div class="filter-caption">Роль</div><div class="filters">${roles.map(item=>`<button class="chip ${contactRoleFilter===item.id?'active':''}" data-contact-role="${esc(item.id)}">${esc(item.label)}</button>`).join('')}</div>
    <div class="contact-list">${contacts.map(contactCard).join('')||'<div class="empty compact-empty">Добавь врача, медсестру или санитара — номер будет доступен в одно нажатие</div>'}</div>`;
}
function contactCard(contact) {
  const href=phoneHref(contact.phone);
  return `<article class="contact-card"><div class="contact-copy"><div class="contact-name">${esc(contact.name)}</div><div class="contact-meta"><span>${esc(contactRoleLabel(contact.role))}</span><span>${esc(departmentLabel(contact.departmentId))}${contact.departmentId===ownDepartmentId()?' · наше':''}</span>${contact.phone?`<span>${esc(contact.phone)}</span>`:''}</div>${contact.note?`<p>${esc(contact.note)}</p>`:''}</div><div class="contact-actions">${href?`<a class="call-btn" href="${esc(href)}" aria-label="Позвонить ${esc(contact.name)}">☎</a>`:''}<button class="secondary-btn contact-edit-btn" data-action="contact-edit" data-contact="${esc(contact.id)}" aria-label="Редактировать ${esc(contact.name)}">✎</button></div></article>`;
}

function historyStepView(step, patient={id:'',steps:[]}, source='current') {
  const facts = stepHistoryFacts(step);
  const stopped = isStoppedStep(step);
  const status = step.state === 'done' ? 'Готово' : step.state === 'cancelled' ? 'Отменено' : step.state === 'postponed' ? 'Перенесено' : ['in_progress','in_or','pickup'].includes(step.state) ? 'В работе' : 'Ожидает';
  const timeline = [];
  if (facts.operation) {
    if (facts.preopCheckedAt) timeline.push(`проверка перед операцией ${fmtClock(facts.preopCheckedAt)}`);
    if (facts.startedAt) timeline.push(`взял из палаты ${fmtClock(facts.startedAt)}`);
    if (facts.arrivedAt) timeline.push(`доставлен ${fmtClock(facts.arrivedAt)}`);
    if (facts.duration !== null) timeline.push(`в оперблоке ${fmtDuration(facts.duration)}`);
    if (facts.readyAt) timeline.push(`вызов ${fmtClock(facts.readyAt)}`);
    if (facts.pickedUpAt) timeline.push(`забран ${fmtClock(facts.pickedUpAt)}`);
    if (facts.travelDuration !== null) timeline.push(`в пути ${fmtDuration(facts.travelDuration)}`);
    if (!stopped && facts.finishedAt) timeline.push(`${facts.destination || 'завершено'} ${fmtClock(facts.finishedAt)}`);
  } else if (stopped) {
    if (facts.startedAt) timeline.push(`начато ${fmtClock(facts.startedAt)}`);
    if (facts.duration !== null) timeline.push(fmtDuration(facts.duration));
  } else {
    if (facts.startedAt && facts.finishedAt) timeline.push(`${fmtClock(facts.startedAt)}–${fmtClock(facts.finishedAt)}`);
    else if (facts.startedAt) timeline.push(`начато ${fmtClock(facts.startedAt)}`);
    else if (facts.finishedAt) timeline.push(`завершено ${fmtClock(facts.finishedAt)}`);
    if (facts.duration !== null) timeline.push(fmtDuration(facts.duration));
  }
  if (stopped) timeline.push(`${status}${facts.finishedAt ? ` ${fmtClock(facts.finishedAt)}` : ''}`);
  if (!timeline.length) timeline.push(step.state === 'done' ? 'выполнено · время не записано' : 'время пока не записано');
  return `<div class="history-step ${stopped?'stopped':step.state==='done'?'done':['in_progress','in_or','pickup'].includes(step.state)?'running':''}">
    <div class="history-step-head"><b>${esc(facts.title)}</b><span>${status}</span></div>
    <p>${timeline.map(esc).join(' · ')}</p>
    <small>Перед выходом: ${esc(facts.startDocuments)} · при завершении: ${esc(facts.finishDocuments)}</small>
    <button class="history-restore-btn" data-action="restore-step" data-patient="${esc(patient.id)}" data-step="${esc(step.id)}" data-source="${esc(source)}">${currentStep(patient)?'Добавить повторно':'Вернуть в очередь'}</button>
  </div>`;
}

function historyPatientCard(patient, source='current') {
  const steps = patient.steps.filter(isHistoryStep);
  if (!steps.length) return '';
  const doctor=patientDoctor(patient);
  return `<article class="history-patient">
    <div class="history-patient-head"><b>${esc(patient.surname || 'Без фамилии')} <span>· п.${esc(patient.room || '?')}</span></b><small>${esc(patient.transport || 'способ не указан')}${doctor?` · врач ${esc(doctor.name)}`:''}</small></div>
    <div class="history-steps">${steps.map(step=>historyStepView(step,patient,source)).join('')}</div>
  </article>`;
}

function shiftCardView(shift, current=false) {
  const patients = (Array.isArray(shift.patients) ? shift.patients : []).filter(patient=>patient.steps.some(isHistoryStep));
  const progress = shiftProgress(patients.map(patient=>({...patient,steps:patient.steps.filter(isHistoryStep)})));
  const source = current ? 'current' : shift.id;
  const datedAt = validTimestamp(shift.closedAt) || validTimestamp(shift.startedAt);
  const label = current ? 'Текущая смена' : datedAt ? new Date(datedAt).toLocaleDateString('ru-RU') : 'Дата не записана';
  const period = current
    ? `с ${fmtClock(shift.startedAt)}`
    : shift.startedAt && shift.closedAt ? `${fmtClock(shift.startedAt)}–${fmtClock(shift.closedAt)}` : shift.startedAt ? `с ${fmtClock(shift.startedAt)}` : shift.closedAt ? `до ${fmtClock(shift.closedAt)}` : 'время не записано';
  return `<details class="shift-card ${current?'current':''}">
    <summary><div><b>${label}</b><span>${patients.length} пациентов · ${progress.tasks.handled}/${progress.tasks.total} задач обработано</span></div><div class="shift-period"><small>${period}</small><i class="toggle-chevron" aria-hidden="true"></i></div></summary>
    <div class="shift-details">${patients.map(patient=>historyPatientCard(patient,source)).join('') || '<div class="empty compact-empty">Пока нет завершённых, отменённых или перенесённых этапов</div>'}</div>
  </details>`;
}

function historyView() {
  const archived = state.archive || [];
  return `
    <div class="section-head"><h2>Смены</h2><span>${archived.length + 1}</span></div>
    ${shiftCardView({startedAt:state.shiftStartedAt,patients:state.patients},true)}
    <div class="section-head"><h2>Прошлые смены</h2><span>${archived.length}</span></div>
    <div class="shift-list">${archived.length ? archived.slice().reverse().map(shift=>shiftCardView(shift)).join('') : '<div class="empty">Завершённые смены появятся здесь</div>'}</div>
  `;
}

function cloudStatusLabel() {
  if (!cloud.session) return navigator.onLine ? 'Только на этом устройстве' : 'Офлайн · только на устройстве';
  return ({ synced:'Синхронизировано', syncing:'Синхронизация…', pending:'Есть несохранённые изменения', offline:'Офлайн · синхронизируем позже', error:'Ошибка синхронизации', conflict:'Нужно выбрать версию' })[cloud.status] || 'Облако подключено';
}
function cloudSettingsView() {
  if (!cloud.session) return `<section class="settings-card cloud-card">
    <div class="settings-card-head"><h2>Облачное хранение</h2><span>${cloudStatusLabel()}</span></div>
    <p>Войди, чтобы смены сохранялись в Supabase и открывались на другом устройстве. Без входа MedFlow по-прежнему работает локально и офлайн.</p>
    ${cloud.message?`<p class="cloud-message">${esc(cloud.message)}</p>`:''}
    <button class="primary-btn" data-action="cloud-auth">Войти или создать аккаунт</button>
  </section>`;
  return `<section class="settings-card cloud-card">
    <div class="settings-card-head"><h2>Облачное хранение</h2><span class="cloud-status ${esc(cloud.status)}">${cloudStatusLabel()}</span></div>
    <p><b>${esc(sessionEmail())}</b><br>Локальная копия остаётся на телефоне, а изменения отправляются в защищённое хранилище при появлении сети.</p>
    ${cloud.message?`<p class="cloud-message">${esc(cloud.message)}</p>`:''}
    <div class="settings-actions"><button class="primary-btn" data-action="cloud-sync" ${cloud.syncing?'disabled':''}>Синхронизировать сейчас</button><button class="secondary-btn" data-action="cloud-logout">Выйти</button></div>
  </section>`;
}

function settingsView() {
  const buttonPosition = addButtonPosition();
  return `
    ${cloudSettingsView()}
    <section class="settings-card">
      <div class="settings-card-head"><h2>Отделения</h2><span>${getDepartments().length} в списке</span></div>
      <p>Наше отделение: <b>${esc(departmentLabel(ownDepartmentId()))}</b>. Оно выбирается по умолчанию для новых пациентов.</p>
      <button class="secondary-btn" data-action="manage-departments">Настроить отделения</button>
    </section>
    <section class="settings-card">
      <div class="settings-card-head"><h2>Резервная копия</h2><span>файл на телефоне или ПК</span></div>
      <p>Скачай всю текущую смену, историю и настройки. Файл можно восстановить на этом или другом устройстве.</p>
      <div class="settings-actions backup-actions"><button class="primary-btn" data-action="export-backup">Скачать смену</button><button class="secondary-btn" data-action="import-backup">Восстановить из файла</button></div>
    </section>
    <section class="settings-card">
      <div class="settings-card-head"><h2>Быстрая запись</h2><span>положение кнопки «＋»</span></div>
      <p>Выбери, где удобнее держать кнопку добавления на экранах «Сегодня» и «Направления».</p>
      <div class="position-options">
        <button class="position-option ${buttonPosition==='floating'?'active':''}" data-action="set-add-position" data-position="floating" aria-pressed="${buttonPosition==='floating'}"><b>Справа снизу</b><span>Поверх экрана, над навигацией</span></button>
        <button class="position-option ${buttonPosition==='inline'?'active':''}" data-action="set-add-position" data-position="inline" aria-pressed="${buttonPosition==='inline'}"><b>В верхней строке</b><span>Рядом с прогрессом или заголовком</span></button>
      </div>
    </section>
    <section class="settings-card">
      <div class="settings-card-head"><h2>Смена и данные</h2><span>служебные действия</span></div>
      <div class="settings-actions"><button class="primary-btn" data-action="new-shift">Начать новую пустую смену</button><button class="danger-btn" data-action="reset">Вернуть демонстрационные данные</button></div>
    </section>
    <details class="about-panel">
      <summary><div><b>О MedFlow</b><span>для кого и зачем создан прототип</span></div><i class="toggle-chevron" aria-hidden="true"></i></summary>
      <div class="about-content">
        <p><b>MedFlow</b> — личный рабочий прототип для координации перемещений пациентов, операций и процедур в течение смены.</p>
        <p><b>Для кого.</b> Первая версия сделана для сотрудника хирургического отделения, который подаёт и забирает пациентов и одновременно держит в голове несколько поручений.</p>
        <p><b>Зачем.</b> Чтобы быстрее видеть следующую задачу, не терять изменения плана и хранить цепочку «ЭКГ → рентген → операция → палата» в одном месте.</p>
        <p><b>Автор идеи.</b> Сотрудник стационара, ежедневно работающий с внутрибольничной транспортировкой пациентов.</p>
        <p class="about-note">Это личный MVP, а не официальная медицинская система. Он не назначает клинический приоритет. Без входа данные хранятся только на устройстве; после входа — ещё и в личной защищённой записи Supabase.</p>
      </div>
    </details>
  `;
}

function compactPatientCard(p) {
  const step = currentStep(p);
  const lastTerminal = [...p.steps].reverse().find(isTerminalStep);
  const next = nextWaitingStep(p);
  const urgent = step?.urgent || p.priority === 'urgent';
  const orStep = p.steps.find(s => ['in_or','pickup'].includes(s.state));
  const currentIndex = step ? p.steps.indexOf(step) : -1;
  const upcoming = currentIndex >= 0
    ? p.steps.slice(currentIndex + 1).filter(s => !isTerminalStep(s)).slice(0, 2)
    : [];
  const compactTitle = step?.state === 'in_progress' ? step.title : step ? stepTitle(step) : 'Маршрут завершён';
  const doctor = patientDoctor(p);
  return `<article class="patient-card compact-card ${urgent?'urgent':''}">
    <div class="compact-head">
      <div class="patient-name">${esc(p.surname)} <span class="patient-room">· п.${esc(p.room || '?')}</span></div>
      <div class="badges">${p.departmentId?`<span class="badge department ${isOwnDepartment(p)?'own':''}" title="${esc(departmentLabel(p.departmentId))}">${esc(departmentLabel(p.departmentId))}${isOwnDepartment(p)?' · НАШЕ':''}</span>`:''}${urgent?'<span class="badge urgent">СРОЧНО</span>':''}${p.block?`<span class="badge ${p.block}">${blockLabel(p.block)}</span>`:hasTodayOperation(p)?'<span class="badge operation">ОПЕРАЦИЯ</span>':''}${p.pinned?'<span class="badge warn">СЛЕДУЮЩИЙ</span>':''}</div>
    </div>
    <div class="compact-body">
      <div class="compact-copy">
        <div class="current-label">Сейчас</div>
        <div class="compact-title">${esc(compactTitle)}</div>
        ${step ? `<div class="compact-meta"><span>↗ ${esc(p.transport || 'способ уточнить')}</span>${step.time?`<span>◷ ${esc(step.time)}</span>`:''}${step.needsClarification?'<span>⚠ уточнить данные</span>':''}</div>` : ''}
        ${doctor?`<div class="compact-doctor"><span>Врач: ${esc(doctor.name)}${doctor.departmentId?` · ${esc(departmentLabel(doctor.departmentId))}`:''}</span>${phoneHref(doctor.phone)?`<a href="${esc(phoneHref(doctor.phone))}" aria-label="Позвонить врачу ${esc(doctor.name)}">☎</a>`:''}</div>`:''}
        ${upcoming.length ? `<div class="compact-next">Далее: ${upcoming.map(s=>`${esc(s.title)}${s.time?` · ${esc(s.time)}`:''}`).join(' → ')}</div>` : ''}
      </div>
      <div class="compact-controls">
        ${operationTimersView(orStep)}
        ${step ? `<button class="primary-btn" data-action="advance" data-patient="${p.id}">${actionLabel(step)}</button>${canContinueNow(p)?`<button class="secondary-btn continue-btn" data-action="advance-next" data-patient="${p.id}">Дальше: ${esc(next.title)}</button>`:''}` : lastTerminal ? `<button class="secondary-btn restore-btn" data-action="restore-step" data-patient="${p.id}" data-step="${lastTerminal.id}" data-source="current">Вернуть в очередь</button>` : ''}
        <div class="compact-tools"><button class="secondary-btn details-btn" data-action="edit-patient" data-patient="${p.id}" aria-label="Редактировать">✎</button><button class="secondary-btn details-btn" data-action="details" data-patient="${p.id}" aria-label="Подробности">•••</button></div>
      </div>
    </div>
  </article>`;
}

function patientCard(p) {
  const step = currentStep(p);
  const urgent = step?.urgent || p.priority==='urgent';
  const orStep = p.steps.find(s=>['in_or','pickup'].includes(s.state));
  return `<article class="patient-card ${urgent?'urgent':''}">
    <div class="patient-top">
      <div class="row between"><div><div class="patient-name">${esc(p.surname)} <span class="patient-room">· п.${esc(p.room||'?')}</span></div></div>
      <div class="badges">${urgent?'<span class="badge urgent">СРОЧНО</span>':''}${p.block?`<span class="badge ${p.block}">${blockLabel(p.block)}</span>`:hasTodayOperation(p)?'<span class="badge operation">ОПЕРАЦИЯ</span>':''}${p.pinned?'<span class="badge warn">СЛЕДУЮЩИЙ</span>':''}</div></div>
    </div>
    <div class="route">${p.steps.map((s,i)=>`<span class="step ${s.state==='done'?'done':s===step?'active':''}"><i>${s.state==='done'?'✓':i+1}</i>${esc(s.title)}</span>`).join('')}</div>
    <div class="current">
      <div class="row between"><div><div class="current-label">${step?'Текущий этап':'Маршрут завершён'}</div><div class="current-title">${step?esc(stepTitle(step)):'Всё выполнено'}</div></div>${operationTimersView(orStep)}</div>
      <div class="meta"><span>↗ ${esc(p.transport||'Способ уточнить')}</span>${step?.time?`<span>◷ ${esc(step.time)}</span>`:''}${step?.needsClarification?'<span>⚠ Уточнить на посту</span>':''}</div>
      ${p.note?`<div class="note">${esc(p.note)}</div>`:''}
      ${step ? `<div class="actions"><button class="primary-btn" data-action="advance" data-patient="${p.id}">${actionLabel(step)}</button><button class="secondary-btn" data-action="pin" data-patient="${p.id}">${p.pinned?'Снять':'Следующей'}</button><button class="secondary-btn" data-action="more" data-patient="${p.id}">•••</button></div>`:''}
    </div>
  </article>`;
}

function documentChoice(name, stage, title) {
  const taken = stage === 'finish' ? 'Забрал историю / талон / направление' : 'Взял историю / талон / направление';
  return `<fieldset class="document-choice"><legend>${esc(title)}</legend>
    <label><input required type="radio" name="${name}" value="taken" /><span><b>${taken}</b><small>Отметка сохранится со временем телефона</small></span></label>
    <label><input required type="radio" name="${name}" value="not_required" /><span><b>Не требуется</b><small>Для этого этапа документы не нужны</small></span></label>
  </fieldset>`;
}

function preopChecklistView() {
  return `<fieldset class="document-choice preop-checklist"><legend>Перед выходом на операцию</legend>
    <p>Отметь после проверки или уточнения у медперсонала:</p>
    <label><input required type="checkbox" name="preop-dentures" /><span><b>Съёмные зубные протезы сняты или отсутствуют</b><small>В том числе съёмные «челюсти»</small></span></label>
    <label><input required type="checkbox" name="preop-jewelry" /><span><b>Украшения и часы сняты или отсутствуют</b><small>Цепочки, серьги, кольца, пирсинг и другие съёмные предметы</small></span></label>
    <label><input required type="checkbox" name="preop-belongings" /><span><b>Другие съёмные вещи уточнены</b><small>Очки, слуховой аппарат и личные вещи — по указанию медперсонала</small></span></label>
  </fieldset>`;
}

function modalView() {
  if (modal.type === 'cloud-auth') {
    const authMode=['signup','recover'].includes(modal.authMode)?modal.authMode:'signin';
    const isSignup=authMode==='signup';
    const isRecover=authMode==='recover';
    return `<div class="modal-backdrop" data-action="close"><section class="modal auth-modal" onclick="event.stopPropagation()">
      <div class="auth-heading"><div class="auth-mark" aria-hidden="true">M</div><div><h2>${isRecover?'Восстановить пароль':isSignup?'Создать аккаунт':'Войти в MedFlow'}</h2><p class="modal-sub">${isRecover?'Пришлём безопасную ссылку на почту':'Смены будут доступны на телефоне и компьютере'}</p></div></div>
      <div class="auth-benefits"><span>✓ Работает офлайн</span><span>✓ Синхронизирует после подключения</span></div>
      ${!isRecover?`<div class="auth-switch" role="tablist" aria-label="Вход или регистрация">
        <button type="button" role="tab" aria-selected="${!isSignup}" class="${!isSignup?'active':''}" data-action="cloud-auth-mode" data-mode="signin">Вход</button>
        <button type="button" role="tab" aria-selected="${isSignup}" class="${isSignup?'active':''}" data-action="cloud-auth-mode" data-mode="signup">Регистрация</button>
      </div>`:''}
      <form id="cloud-auth-form" class="auth-form">
        <label class="auth-field"><span>Email</span><input name="email" type="email" inputmode="email" autocomplete="email" required placeholder="name@example.com"></label>
        ${!isRecover?`<label class="auth-field"><span>Пароль</span><div class="password-field"><input id="cloud-password" name="password" type="password" autocomplete="${isSignup?'new-password':'current-password'}" required minlength="8" placeholder="Минимум 8 символов"><button type="button" data-action="cloud-password-toggle" aria-label="Показать пароль">Показать</button></div></label>`:''}
        ${modal.error?`<p class="form-error auth-error" role="alert">${esc(modal.error)}</p>`:''}
        <button type="submit" class="primary-btn auth-submit" data-action="${isRecover?'cloud-recover':isSignup?'cloud-signup':'cloud-signin'}">${isRecover?'Отправить ссылку':isSignup?'Создать аккаунт':'Войти'}</button>
      </form>
      ${!isSignup&&!isRecover?'<button type="button" class="auth-recover" data-action="cloud-auth-mode" data-mode="recover">Забыл пароль</button>':''}
      ${isRecover?'<button type="button" class="auth-recover" data-action="cloud-auth-mode" data-mode="signin">Вернуться ко входу</button>':''}
      <p class="auth-note">${isRecover?'Ссылка откроет MedFlow и предложит задать новый пароль.':isSignup?'После регистрации может понадобиться подтверждение email.':'Данные на этом устройстве останутся доступны даже без интернета.'}</p>
      <button type="button" class="auth-close" data-action="close">Не сейчас</button>
    </section></div>`;
  }
  if (modal.type === 'password-update') {
    return `<div class="modal-backdrop"><section class="modal auth-modal"><div class="auth-heading"><div class="auth-mark">M</div><div><h2>Новый пароль</h2><p class="modal-sub">Придумай пароль минимум из 8 символов</p></div></div>
      <form id="password-update-form" class="auth-form">
        <label class="auth-field"><span>Новый пароль</span><input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
        <label class="auth-field"><span>Повтори пароль</span><input name="confirm" type="password" required minlength="8" autocomplete="new-password"></label>
        ${modal.error?`<p class="form-error auth-error">${esc(modal.error)}</p>`:''}
        <button class="primary-btn auth-submit" type="submit" data-action="cloud-password-update">Сохранить пароль</button>
      </form></section></div>`;
  }
  if (modal.type === 'sync-conflict') {
    const localCount=modal.localState?.patients?.length||0, remoteCount=modal.remoteState?.patients?.length||0;
    return `<div class="modal-backdrop"><section class="modal confirm-modal"><h2>Изменения на двух устройствах</h2><p class="modal-sub">Облачная версия изменилась после последней синхронизации. Ничего не будет перезаписано без твоего выбора.</p>
      <div class="conflict-versions"><div><b>Это устройство</b><span>${localCount} пациентов</span></div><div><b>Облако</b><span>${remoteCount} пациентов</span></div></div>
      <div class="conflict-actions"><button class="primary-btn" data-action="sync-conflict-merge">Объединить безопасно</button><button class="secondary-btn" data-action="sync-conflict-local">Оставить это устройство</button><button class="secondary-btn" data-action="sync-conflict-remote">Взять облачную версию</button></div>
      <p class="modal-sub">При объединении карточки и этапы с обоих устройств сохранятся; для одного и того же этапа берётся более поздний статус.</p></section></div>`;
  }
  if (modal.type === 'import-backup-confirm') {
    return `<div class="modal-backdrop" data-action="close"><section class="modal confirm-modal" onclick="event.stopPropagation()"><h2>Восстановить копию?</h2><p class="modal-sub">В файле: ${modal.importState?.patients?.length||0} пациентов в текущей смене и ${modal.importState?.archive?.length||0} прошлых смен. Текущие данные будут заменены.</p><div class="modal-actions"><button class="secondary-btn" data-action="close">Отмена</button><button class="primary-btn" data-action="confirm-import-backup">Восстановить</button></div></section></div>`;
  }
  if (modal.type === 'documents') {
    const p = state.patients.find(x => x.id === modal.patient);
    const step = p && currentStep(p);
    const next = p && nextWaitingStep(p);
    if (!p || !step) return '';
    const mode = modal.mode;
    const title = mode === 'start' ? 'Начало сопровождения' : mode === 'finish' ? 'Перед завершением' : mode === 'continue' ? 'Перейти к следующему этапу' : mode === 'handoff' ? 'Перед передачей' : mode === 'stop' ? (modal.stopAction === 'postpone-step' ? 'Перед переносом' : 'Перед отменой') : 'Перед забором пациента';
    const subtitle = mode === 'continue' && next ? `${step.title} → ${next.title}` : mode === 'start' ? `Погрузка / выход · ${step.title}` : step.title;
    const needsStart = ['start','continue'].includes(mode);
    const needsFinish = ['finish','continue','operation-pickup','handoff','stop'].includes(mode);
    const needsPreopCheck = mode === 'start' && isOperationStep(step);
    return `<div class="modal-backdrop" data-action="close"><section class="modal document-modal" onclick="event.stopPropagation()">
      <h2>${title}</h2><p class="modal-sub">${esc(subtitle)} · выбери один вариант в каждом блоке</p>
      <form id="documents-form" class="document-form">
        ${needsPreopCheck?preopChecklistView():''}
        ${needsFinish?documentChoice('finish-documents','finish','Что с документами при завершении?'):''}
        ${needsStart?documentChoice('start-documents','start',mode==='continue'?'Что взять на следующий этап?':'Что взять с собой?'):''}
      </form>
      <div class="modal-actions"><button class="secondary-btn" data-action="close">Назад</button><button class="primary-btn" data-action="confirm-documents">Подтвердить</button></div>
    </section></div>`;
  }
  if (modal.type === 'details') {
    const p = state.patients.find(x => x.id === modal.patient);
    if (!p) return '';
    return `<div class="modal-backdrop" data-action="close"><section class="modal" onclick="event.stopPropagation()">
      <div class="row between"><div><h2>${esc(p.surname)} · палата ${esc(p.room || 'уточнить')}</h2><p class="modal-sub">Полная карточка пациента</p></div>${p.block?`<span class="badge ${p.block}">${blockLabel(p.block)}</span>`:''}</div>
      <div class="detail-block"><div class="current-label">Маршрут на сегодня</div><div class="route-detail">${p.steps.map((s,i)=>`<div class="route-detail-item ${s.state==='done'?'done':s===currentStep(p)?'active':''}"><span>${s.state==='done'?'✓':i+1}</span><b>${esc(s.title)}${s.time?` <small>· ${esc(s.time)}</small>`:''}</b></div>`).join('')}</div></div>
      <div class="detail-grid"><div><span>Отделение</span><b>${esc(departmentLabel(p.departmentId))}${isOwnDepartment(p)?' · наше':''}</b></div><div><span>Врач</span><b>${esc(patientDoctor(p)?.name||'Не указан')}</b></div><div><span>Передвижение</span><b>${esc(p.transport || 'Не указано')}</b></div><div><span>Приоритет</span><b>${p.priority==='urgent'?'Срочный':hasTodayOperation(p)?'Операция сегодня':'Обычный'}</b></div></div>
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
        <div class="field"><label>Отделение</label><select name="department">${departmentOptions(p.departmentId)}</select></div>
        <div class="field"><label>Врач</label><select name="doctor">${doctorOptions(p)}</select></div>
        <div class="field"><label>Врач вручную</label><input name="doctor-name" value="${esc(p.doctorName||'')}" placeholder="Если врача нет в контактах" /></div>
        <div class="field"><label>Передвижение</label><select name="transport">
          ${['','Пешком с сопровождением','Кресло','Каталка'].map(x=>`<option value="${x}" ${p.transport===x?'selected':''}>${x||'Уточнить позже'}</option>`).join('')}
        </select></div>
        <div class="field"><label>Оперблок</label><select name="block">
          <option value="" ${!p.block?'selected':''}>Не указан</option><option value="op" ${p.block==='op'?'selected':''}>Оперблок (ОПРБЛК)</option><option value="angio" ${p.block==='angio'?'selected':''}>Ангиоблок (АНГБЛК)</option>
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
  if (modal.type === 'departments') {
    return `<div class="modal-backdrop" data-action="close"><section class="modal" onclick="event.stopPropagation()">
      <h2>Отделения</h2><p class="modal-sub">Отметь своё отделение — оно будет выбрано у новых пациентов. Остальные можно добавлять, переименовывать и удалять.</p>
      <div class="department-catalog">${modal.departments.map((item,i)=>`<div class="department-catalog-item"><label class="own-department-choice"><input type="radio" name="own-department" data-department-own="${esc(item.id)}" ${item.id===modal.ownDepartmentId?'checked':''}><span>Наше</span></label><input data-department-name="${esc(item.id)}" value="${esc(item.label)}" aria-label="Название отделения"><button class="direction-remove" data-action="department-remove" data-index="${i}" ${modal.departments.length===1?'disabled title="Должно остаться хотя бы одно отделение"':'title="Убрать из списка"'}>×</button></div>`).join('')}</div>
      ${modal.error?`<p class="form-error">${esc(modal.error)}</p>`:''}
      <div class="direction-new"><input id="department-new-name" placeholder="Например, Урология" /><button class="secondary-btn" data-action="department-add">＋ Добавить</button></div>
      <div class="modal-actions"><button class="secondary-btn" data-action="close">Отмена</button><button class="primary-btn" data-action="department-save">Сохранить</button></div>
    </section></div>`;
  }
  if (modal.type === 'contact') {
    const contact = getContacts().find(item=>item.id===modal.contact) || {name:'',role:'doctor',departmentId:ownDepartmentId(),phone:'',note:''};
    return `<div class="modal-backdrop" data-action="close"><section class="modal" onclick="event.stopPropagation()">
      <h2>${modal.contact?'Редактировать контакт':'Новый контакт'}</h2><p class="modal-sub">Номер хранится вместе с личными данными MedFlow. Кнопка звонка только откроет приложение «Телефон».</p>
      <form id="contact-form" class="form-grid">
        <div class="field"><label>Имя / фамилия</label><input required name="name" value="${esc(contact.name)}" placeholder="Например, Иванов И.И." autofocus /></div>
        <div class="field"><label>Роль</label><select name="role">${CONTACT_ROLES.map(item=>`<option value="${item.id}" ${contact.role===item.id?'selected':''}>${esc(item.label)}</option>`).join('')}</select></div>
        <div class="field"><label>Отделение</label><select name="department">${departmentOptions(contact.departmentId)}</select></div>
        <div class="field"><label>Телефон</label><input name="phone" type="tel" inputmode="tel" value="${esc(contact.phone)}" placeholder="+7… или внутренний номер" /></div>
        <div class="field full"><label>Заметка</label><textarea name="note" placeholder="Когда звонить, кабинет, смена…">${esc(contact.note)}</textarea></div>
      </form>
      <div class="modal-actions"><button class="secondary-btn" data-action="close">Отмена</button>${modal.contact?'<button class="danger-btn" data-action="contact-delete">Удалить</button>':''}<button class="primary-btn" data-action="contact-save">Сохранить</button></div>
    </section></div>`;
  }
  if (modal.type === 'route') {
    const p = state.patients.find(x => x.id === modal.patient);
    return `<div class="modal-backdrop" data-action="close"><section class="modal" onclick="event.stopPropagation()">
      <h2>Цепочка · ${esc(p?.surname || '')}</h2><p class="modal-sub">Направление текущего этапа можно менять до начала выполнения</p>
      <div class="route-editor">${modal.steps.map((s,i)=>{const editable=canEditRouteStep(s);const movable=s.state==='waiting';const canUp=movable&&i>0&&modal.steps[i-1].state==='waiting';const canDown=movable&&i<modal.steps.length-1&&modal.steps[i+1].state==='waiting';const hint=!editable?'Выполняемый или завершённый этап защищён':!movable?'Текущий этап можно изменить, но нельзя переставить':'Можно изменить, переставить или удалить';return `<div class="route-editor-item ${editable?'':'locked'}"><span class="route-index">${i+1}</span><div class="route-item-copy"><select class="route-type-select" data-route-type="${i}" aria-label="Направление этапа ${i+1}" ${editable?'':'disabled'}>${directionOptions(s.type,true)}</select><input class="route-title-input" data-route-title="${i}" value="${esc(s.title)}" aria-label="Название этапа ${i+1}" ${editable?'':'disabled'} /><input class="route-time-input" type="time" data-route-time="${i}" value="${esc(s.time || '')}" aria-label="Время этапа ${i+1}" ${editable?'':'disabled'} /><small>${hint}</small></div><div class="route-tools"><button data-action="route-up" data-index="${i}" ${canUp?'':'disabled'}>↑</button><button data-action="route-down" data-index="${i}" ${canDown?'':'disabled'}>↓</button><button data-action="route-delete" data-index="${i}" ${movable?'':'disabled'}>×</button></div></div>`;}).join('')}</div>
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
        <div class="field"><label>Отделение</label><select name="department">${departmentOptions(ownDepartmentId())}</select></div>
        <div class="field"><label>Врач</label><select name="doctor">${doctorOptions()}</select></div>
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
        <div class="field"><label>Отделение</label><select name="department">${departmentOptions(ownDepartmentId())}</select></div>
        <div class="field"><label>Врач</label><select name="doctor">${doctorOptions()}</select></div>
        <div class="field"><label>Врач вручную</label><input name="doctor-name" placeholder="Если врача нет в контактах" /></div>
        <div class="field"><label>Ближайшее действие</label><select name="type">${directionOptions('', true)}</select></div>
        <div class="field"><label>Куда везти</label><input required name="destination" placeholder="ХО, КТ, кабинет…" /></div>
        <div class="field"><label>Время ближайшего действия</label><input type="time" name="time" /></div>
        <div class="field"><label>Способ передвижения</label><select name="transport"><option value="">Уточнить позже</option><option>Пешком с сопровождением</option><option>Кресло</option><option>Каталка</option></select></div>
        <div class="field"><label>Оперблок (только для операции)</label><select name="block"><option value="">Не указан</option><option value="op">Оперблок (ОПРБЛК)</option><option value="angio">Ангиоблок (АНГБЛК)</option></select></div>
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
    const destinations=[next?.title,'Вернулся в свою палату','Переведён в реанимацию','Переведён в другое отделение','Передан другому сотруднику','Другое место'].filter((item,index,all)=>item&&all.indexOf(item)===index);
    return `<div class="modal-backdrop"><section class="modal"><h2>Куда доставлен пациент?</h2><p class="modal-sub">Таймер пути остановится после выбора</p>
      ${next?`<label class="continue-toggle"><input id="continue-after-operation" type="checkbox" /><span><b>После доставки открыть следующий этап</b><small>Следующий этап: ${esc(next.title)} · документы подтвердим отдельно</small></span></label>`:''}
      <div class="patient-list" style="margin-top:16px">
      ${destinations.map((x,index)=>`<button class="secondary-btn ${index===0&&next?'next-destination':''}" data-action="finish-operation" data-patient="${modal.patient}" data-destination="${esc(x)}">${index===0&&next?'Следующий пункт: ':''}${esc(x)}</button>`).join('')}
      <button class="secondary-btn" data-action="close">Назад, пока не выбирать</button></div></section></div>`;
  }
  return '';
}

function bind() {
  document.querySelectorAll('[data-view]').forEach(el=>el.onclick=()=>{view=el.dataset.view; render();});
  document.querySelectorAll('[data-direction]').forEach(el=>el.onclick=()=>{direction=el.dataset.direction; render(true);});
  document.querySelectorAll('[data-department-filter]').forEach(el=>el.onclick=()=>{departmentFilter=el.dataset.departmentFilter; render(true);});
  document.querySelectorAll('[data-contact-department]').forEach(el=>el.onclick=()=>{contactDepartmentFilter=el.dataset.contactDepartment; render(true);});
  document.querySelectorAll('[data-contact-role]').forEach(el=>el.onclick=()=>{contactRoleFilter=el.dataset.contactRole; render(true);});
  document.querySelectorAll('[data-sort-mode]').forEach(el=>el.onchange=()=>{ state.settings.sortMode=SORT_MODES.includes(el.value)?el.value:'priority'; save(); render(true); });
  document.querySelectorAll('[data-route-title]').forEach(el=>el.oninput=()=>{ if(modal?.type==='route' && modal.steps[Number(el.dataset.routeTitle)]) modal.steps[Number(el.dataset.routeTitle)].title=el.value; });
  document.querySelectorAll('[data-route-time]').forEach(el=>el.oninput=()=>{ if(modal?.type==='route' && modal.steps[Number(el.dataset.routeTime)]) modal.steps[Number(el.dataset.routeTime)].time=el.value; });
  document.querySelectorAll('[data-route-type]').forEach(el=>el.onchange=()=>{ const index=Number(el.dataset.routeType),step=modal?.type==='route'?modal.steps[index]:null;if(changeRouteStepType(step,el.value)){const title=document.querySelector(`[data-route-title="${index}"]`);if(title)title.value=step.title;} });
  document.querySelectorAll('[data-direction-name]').forEach(el=>el.oninput=()=>{ const item=modal?.directions?.find(item=>item.id===el.dataset.directionName); if(item) item.label=el.value; });
  document.querySelectorAll('[data-department-name]').forEach(el=>el.oninput=()=>{ const item=modal?.departments?.find(item=>item.id===el.dataset.departmentName); if(item) item.label=el.value; });
  document.querySelectorAll('[data-department-own]').forEach(el=>el.onchange=()=>{ if(modal?.type==='departments' && el.checked) modal.ownDepartmentId=el.dataset.departmentOwn; });
  document.querySelectorAll('[data-action]').forEach(el=>el.onclick=(e)=>handleAction(el.dataset.action, el, e));
  const authForm=document.getElementById('cloud-auth-form');
  if(authForm) authForm.onsubmit=(e)=>{
    e.preventDefault();
    const action=modal?.authMode==='recover'?'cloud-recover':modal?.authMode==='signup'?'cloud-signup':'cloud-signin';
    const submit=authForm.querySelector(`[data-action="${action}"]`);
    if(submit) handleAction(action,submit,e);
  };
  const passwordForm=document.getElementById('password-update-form');
  if(passwordForm) passwordForm.onsubmit=(e)=>{e.preventDefault();handleAction('cloud-password-update',passwordForm.querySelector('[data-action="cloud-password-update"]'),e);};
  const backupFile=document.getElementById('backup-file');
  if(backupFile) backupFile.onchange=async()=>{
    const file=backupFile.files?.[0]; if(!file)return;
    try {
      const raw=JSON.parse(await file.text());
      const imported=raw?.format==='medflow-backup'?raw.state:raw;
      if(!imported || !Array.isArray(imported.patients) || !Array.isArray(imported.archive)) throw new Error('Это не резервная копия MedFlow');
      modal={type:'import-backup-confirm',importState:normalizeState(clone(imported))}; render();
    } catch(error) { cloud.message=error.message||'Не удалось прочитать файл'; view='settings'; render(); }
  };
}
function log(p,text) { p.events ||= []; p.events.push({at:Date.now(),text}); }
function nextWaitingStep(p) { return p.steps.find(s=>s.state==='waiting'); }
function activateNext(p) { const next=nextWaitingStep(p); if(next) next.state='active'; return next; }
function canContinueNow(p) { const step=currentStep(p); return step?.state==='in_progress' && !isOperationStep(step) && Boolean(nextWaitingStep(p)); }
function completeCurrentStep(p, startNext=false, at=Date.now()) {
  const step=currentStep(p);
  if(!step) return {step:null,next:null};
  step.state='done'; step.finishedAt=at;
  const next=activateNext(p);
  if(startNext && next) { next.state='in_progress'; next.startedAt ||= at; }
  return {step,next};
}
function stopCurrentStep(p, action, at=Date.now()) {
  const step=currentStep(p);
  if(!step || !['cancel-step','postpone-step'].includes(action)) return null;
  step.state=action==='postpone-step'?'postponed':'cancelled';
  step.finishedAt=at;
  activateNext(p);
  syncPatientPriority(p,Boolean(currentStep(p)?.urgent));
  return step;
}

function resetStepTracking(step) {
  ['startedAt','arrivedAt','readyAt','pickedUpAt','finishedAt','destination','documents','preopCheck'].forEach(key=>delete step[key]);
  step.urgent=false;
  return step;
}
function restoreOrRepeatStep(patient, stepId) {
  const original=patient?.steps?.find(step=>step.id===stepId && isTerminalStep(step));
  if(!original) return {mode:null,step:null};
  const hasOpen=Boolean(currentStep(patient));
  let step;
  if(hasOpen) {
    step=resetStepTracking({...clone(original),id:uid(),state:'waiting'});
    patient.steps.push(step);
  } else {
    step=resetStepTracking(original);
    step.state='active';
  }
  patient.pinned=false;
  syncPatientPriority(patient,false);
  return {mode:hasOpen?'repeat':'restore',step};
}
function restoreArchivedStep(shiftId, patientId, stepId) {
  const shift=(state.archive||[]).find(item=>item.id===shiftId);
  const sourcePatient=shift?.patients?.find(patient=>patient.id===patientId);
  const sourceStep=sourcePatient?.steps?.find(step=>step.id===stepId && isTerminalStep(step));
  if(!sourcePatient || !sourceStep) return null;
  const patient={...clone(sourcePatient),id:uid(),steps:[resetStepTracking({...clone(sourceStep),id:uid(),state:'active'})],events:[],pinned:false};
  syncPatientPriority(patient,false);
  state.patients.push(patient);
  return patient;
}

async function handleAction(action, el, e) {
  if (action==='add') { modal={type:'quick'}; return render(true); }
  if (action==='contact-add') { modal={type:'contact',contact:null}; return render(true); }
  if (action==='contact-edit') { modal={type:'contact',contact:el.dataset.contact}; return render(true); }
  if (action==='contact-save') {
    const form=document.getElementById('contact-form'); if(!form?.reportValidity()) return;
    const fd=new FormData(form), value=normalizeContact({id:modal.contact||uid(),name:fd.get('name'),role:fd.get('role'),departmentId:fd.get('department'),phone:fd.get('phone'),note:fd.get('note')});
    if(!value)return;
    const index=getContacts().findIndex(item=>item.id===value.id);
    if(index>=0) state.contacts[index]=value; else state.contacts.push(value);
    modal=null; save(); return render(true);
  }
  if (action==='contact-delete') {
    const contact=getContacts().find(item=>item.id===modal.contact); if(!contact)return;
    const preserve=patient=>{ if(patient.doctorId===contact.id){ patient.doctorId='external'; patient.doctorName=patient.doctorName||contact.name; } };
    state.patients.forEach(preserve); state.archive.forEach(shift=>(shift.patients||[]).forEach(preserve));
    state.contacts=state.contacts.filter(item=>item.id!==contact.id); modal=null; save(); return render(true);
  }
  if (action==='close') { modal=null; return render(true); }
  if (action==='cloud-status') { view='settings'; return render(); }
  if (action==='cloud-auth') { cloud.message=''; modal={type:'cloud-auth',authMode:'signin',error:''}; return render(); }
  if (action==='cloud-auth-mode') { modal.authMode=['signup','recover'].includes(el.dataset.mode)?el.dataset.mode:'signin'; modal.error=''; return render(); }
  if (action==='cloud-password-toggle') {
    const input=document.getElementById('cloud-password');
    if(!input) return;
    const showing=input.type==='text'; input.type=showing?'password':'text'; el.textContent=showing?'Показать':'Скрыть'; el.setAttribute('aria-label',showing?'Показать пароль':'Скрыть пароль'); return;
  }
  if (action==='cloud-signin' || action==='cloud-signup') {
    e?.preventDefault();
    const form=document.getElementById('cloud-auth-form');
    if(!form?.reportValidity()) return;
    const fd=new FormData(form), email=String(fd.get('email')||'').trim(), password=String(fd.get('password')||'');
    modal.error='';
    try {
      if(action==='cloud-signin') await signInCloud(email,password); else await signUpCloud(email,password);
      modal=null; view='settings'; return render();
    } catch(error) {
      modal.error=authErrorMessage(error);
      return render();
    }
  }
  if (action==='cloud-recover') {
    e?.preventDefault();
    const form=document.getElementById('cloud-auth-form'); if(!form?.reportValidity())return;
    const email=String(new FormData(form).get('email')||'').trim(); modal.error='';
    try { await requestPasswordReset(email); cloud.message='Ссылка для восстановления отправлена на почту'; modal=null; view='settings'; return render(); }
    catch(error) { modal.error=authErrorMessage(error); return render(); }
  }
  if (action==='cloud-password-update') {
    e?.preventDefault();
    const form=document.getElementById('password-update-form'); if(!form?.reportValidity())return;
    const fd=new FormData(form), password=String(fd.get('password')||''), confirm=String(fd.get('confirm')||'');
    if(password!==confirm){modal.error='Пароли не совпадают';return render();}
    try { await cloudRequest('/auth/v1/user',{method:'PUT',body:JSON.stringify({password})}); cloud.message='Пароль изменён'; modal=null; view='settings'; return render(); }
    catch(error){modal.error=authErrorMessage(error);return render();}
  }
  if (action==='sync-conflict-remote') {
    const remote={payload:modal.remoteState,updated_at:new Date(modal.remoteVersion).toISOString(),client_updated_at:new Date(modal.remoteAt||modal.remoteVersion).toISOString()};
    modal=null; applyRemoteState(remote,'Выбрана облачная версия'); return render();
  }
  if (action==='sync-conflict-local' || action==='sync-conflict-merge') {
    const conflict=modal;
    if(action==='sync-conflict-merge') state=mergeStates(conflict.localState,conflict.remoteState);
    else state=normalizeState(clone(conflict.localState));
    localStorage.setItem(STORAGE_KEY,JSON.stringify(state)); localUpdatedAt=Date.now(); localStorage.setItem(SYNC_META_KEY,String(localUpdatedAt));
    storeSyncMeta({lastRemoteVersion:conflict.remoteVersion}); modal=null; cloud.status='pending'; render();
    try { await pushCloudState(); } catch(error) { cloud.status='error'; cloud.message=error.message||'Не удалось сохранить выбранную версию'; scheduleCloudRetry(); }
    return render(true);
  }
  if (action==='cloud-sync') { cloud.message=''; await syncCloudState(); return render(true); }
  if (action==='cloud-logout') { await signOutCloud(); return render(true); }
  if (action==='export-backup') { exportBackup(); cloud.message='Резервная копия скачана'; return; }
  if (action==='import-backup') { document.getElementById('backup-file')?.click(); return; }
  if (action==='confirm-import-backup') { state=normalizeState(clone(modal.importState)); modal=null; save(); cloud.message='Резервная копия восстановлена'; view='today'; return render(); }
  if (action==='toggle-completed') { showCompleted=!showCompleted; return render(true); }
  if (action==='set-add-position') {
    state.settings.addButtonPosition=ADD_BUTTON_POSITIONS.includes(el.dataset.position)?el.dataset.position:'floating';
    save();
    document.querySelectorAll('[data-action="set-add-position"]').forEach(button=>{
      const active=button.dataset.position===state.settings.addButtonPosition;
      button.classList.toggle('active',active); button.setAttribute('aria-pressed',String(active));
    });
    return;
  }
  if (action==='manage-departments') { modal={type:'departments',departments:clone(getDepartments()),ownDepartmentId:ownDepartmentId(),error:''}; return render(true); }
  if (action==='department-remove') {
    const index=Number(el.dataset.index);
    if(modal?.departments?.length>1 && modal.departments[index]) {
      const removed=modal.departments.splice(index,1)[0];
      if(removed.id===modal.ownDepartmentId) modal.ownDepartmentId=modal.departments[0].id;
    }
    return render(true);
  }
  if (action==='department-add') {
    const input=document.getElementById('department-new-name');
    const label=input?.value.trim();
    if(!label) { modal.error='Введи название отделения'; return render(); }
    if(modal.departments.some(item=>item.label.trim().toLocaleLowerCase('ru-RU')===label.toLocaleLowerCase('ru-RU'))) { modal.error='Такое отделение уже есть'; return render(); }
    modal.departments.push({id:`department-${uid()}`,label}); modal.error=''; return render(true);
  }
  if (action==='department-save') {
    const cleaned=[];
    const labels=new Set();
    for(const item of modal.departments) {
      const label=String(item.label||'').trim(), key=label.toLocaleLowerCase('ru-RU');
      if(!label || labels.has(key)) continue;
      labels.add(key); cleaned.push({id:item.id,label});
    }
    if(!cleaned.length) { modal.error='Добавь хотя бы одно отделение'; return render(); }
    const validIds=new Set(cleaned.map(item=>item.id));
    state.departments=cleaned;
    state.settings.ownDepartmentId=validIds.has(modal.ownDepartmentId)?modal.ownDepartmentId:cleaned[0].id;
    state.patients.forEach(patient=>{ if(!validIds.has(patient.departmentId)) patient.departmentId=''; });
    state.archive.forEach(shift=>(shift.patients||[]).forEach(patient=>{ if(!validIds.has(patient.departmentId)) patient.departmentId=''; }));
    state.contacts.forEach(contact=>{ if(!validIds.has(contact.departmentId)) contact.departmentId=''; });
    if(departmentFilter!=='all' && departmentFilter!=='none' && !validIds.has(departmentFilter)) departmentFilter='all';
    modal=null; save(); return render(true);
  }
  if (action==='manage-directions') { modal={type:'directions',directions:clone(getDirections()),error:''}; return render(true); }
  if (action==='direction-remove') {
    const item=modal?.directions?.[Number(el.dataset.index)];
    if(item && !item.locked) modal.directions.splice(Number(el.dataset.index),1);
    return render(true);
  }
  if (action==='direction-add') {
    const input=document.getElementById('direction-new-name');
    const label=input?.value.trim();
    if(!label) { modal.error='Введи название направления'; return render(); }
    if(modal.directions.some(item=>item.label.trim().toLocaleLowerCase('ru-RU')===label.toLocaleLowerCase('ru-RU'))) { modal.error='Такое направление уже есть'; return render(); }
    modal.directions.push({id:`custom-${uid()}`,label,locked:false}); modal.error=''; return render(true);
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
    modal=null; save(); return render(true);
  }
  if (action==='details') { modal={type:'details',patient:el.dataset.patient}; return render(true); }
  if (action==='edit-patient') { modal={type:'edit-patient',patient:el.dataset.patient}; return render(true); }
  if (action==='restore-step') {
    if(el.dataset.source && el.dataset.source!=='current') {
      const patient=restoreArchivedStep(el.dataset.source,el.dataset.patient,el.dataset.step);
      if(!patient) return;
      log(patient,`Возвращено из прошлой смены: ${patient.steps[0].title}`);
    } else {
      const patient=state.patients.find(item=>item.id===el.dataset.patient);
      const result=restoreOrRepeatStep(patient,el.dataset.step);
      if(!result.step) return;
      log(patient,result.mode==='repeat'?`Повторно добавлено: ${result.step.title}`:`Возвращено в очередь: ${result.step.title}`);
    }
    view='today'; modal=null; save(); return render();
  }
  if (action==='save-patient') {
    const form=document.getElementById('edit-patient-form'); if(!form.reportValidity()) return;
    const fd=new FormData(form), p=state.patients.find(p=>p.id===el.dataset.patient), step=currentStep(p);
    p.surname=fd.get('surname').trim(); p.room=fd.get('room').trim(); p.departmentId=String(fd.get('department')||''); p.doctorId=String(fd.get('doctor')||''); p.doctorName=p.doctorId&&p.doctorId!=='external'?(getContacts().find(item=>item.id===p.doctorId)?.name||String(fd.get('doctor-name')||'').trim()):String(fd.get('doctor-name')||'').trim(); p.transport=fd.get('transport'); p.block=fd.get('block'); p.note=fd.get('note').trim();
    const urgent=fd.get('urgent')==='on';
    if(step) { step.urgent=urgent; step.time=fd.get('time') || ''; step.needsClarification=!p.room||!p.transport; }
    syncPatientPriority(p,urgent);
    log(p,'Данные карточки изменены'); modal={type:'details',patient:p.id}; save(); return render(true);
  }
  if (action==='edit-route') {
    const p=state.patients.find(p=>p.id===el.dataset.patient);
    modal={type:'route',patient:p.id,steps:clone(p.steps)};
    return render(true);
  }
  if (action==='route-up' || action==='route-down') {
    const i=Number(el.dataset.index), j=action==='route-up'?i-1:i+1;
    if(j>=0 && j<modal.steps.length && modal.steps[i].state==='waiting' && modal.steps[j].state==='waiting') [modal.steps[i],modal.steps[j]]=[modal.steps[j],modal.steps[i]];
    return render(true);
  }
  if (action==='route-delete') { const i=Number(el.dataset.index); if(modal.steps[i]?.state==='waiting') modal.steps.splice(i,1); return render(true); }
  if (action==='route-add') {
    const type=document.getElementById('route-type').value;
    const custom=document.getElementById('route-custom').value.trim();
    const time=document.getElementById('route-time').value;
    modal.steps.push({id:uid(),type,title:custom||typeLabel(type),time,state:'waiting'});
    return render(true);
  }
  if (action==='route-save') {
    const p=state.patients.find(p=>p.id===el.dataset.patient);
    p.steps=modal.steps;
    if(!p.steps.length) {
      p.steps.push({id:uid(),type:'other',title:'Новый этап',state:'active'});
    }
    const pending=p.steps.filter(s=>!isTerminalStep(s));
    if(pending.length && !pending.some(s=>s.state!=='waiting')) pending[0].state='active';
    syncPatientPriority(p,p.priority==='urgent');
    log(p,'Маршрут изменён'); modal={type:'details',patient:p.id}; save(); return render(true);
  }
  if (action==='more') { modal={type:'more',patient:el.dataset.patient}; return render(true); }
  if (action==='pin') {
    state.patients.forEach(p=>{ if(p.id!==el.dataset.patient) p.pinned=false; });
    const p=state.patients.find(p=>p.id===el.dataset.patient); p.pinned=!p.pinned; log(p,p.pinned?'Назначен следующим':'Ручной приоритет снят'); save(); return render(true);
  }
  if (action==='confirm-documents') {
    const form=document.getElementById('documents-form'); if(!form?.reportValidity()) return;
    const fd=new FormData(form), p=state.patients.find(p=>p.id===modal.patient), s=p&&currentStep(p); if(!p||!s)return;
    const mode=modal.mode, stopAction=modal.stopAction, now=Date.now();
    const startStatus=fd.get('start-documents'), finishStatus=fd.get('finish-documents');
    if (['start','continue'].includes(mode) && !DOCUMENT_STATUSES.includes(startStatus)) return;
    if (['finish','continue','operation-pickup','handoff','stop'].includes(mode) && !DOCUMENT_STATUSES.includes(finishStatus)) return;
    p.pinned=false;
    if (mode==='start') {
      if(isOperationStep(s)) s.preopCheck={at:now,dentures:true,jewelry:true,belongings:true};
      setStepDocument(s,'start',startStatus,now); s.state='in_progress'; s.startedAt ||= now;
      log(p,`Начато сопровождение: ${s.title}`); modal=null;
    } else if (mode==='finish') {
      setStepDocument(s,'finish',finishStatus,now);
      const finished=completeCurrentStep(p,false,now); log(p,`Выполнено: ${finished.step.title}`); modal=null;
    } else if (mode==='continue') {
      const next=nextWaitingStep(p); if(!next)return;
      setStepDocument(s,'finish',finishStatus,now);
      const moved=completeCurrentStep(p,true,now);
      setStepDocument(moved.next,'start',startStatus,now);
      log(p,`Выполнено: ${moved.step.title} → начато сопровождение: ${moved.next.title}`); modal=null;
    } else if (mode==='operation-pickup') {
      setStepDocument(s,'finish',finishStatus,now); s.pickedUpAt ||= now;
      log(p,'Пациент забран из оперблока'); modal={type:'destination',patient:p.id};
    } else if (mode==='handoff') {
      setStepDocument(s,'finish',finishStatus,now); s.state='done'; s.finishedAt=now; s.destination='Передан другому сотруднику';
      log(p,`Передано другому сотруднику: ${s.title}`); activateNext(p); syncPatientPriority(p,Boolean(currentStep(p)?.urgent)); modal=null;
    } else if (mode==='stop') {
      setStepDocument(s,'finish',finishStatus,now);
      const stopped=stopCurrentStep(p,stopAction,now);
      log(p,`${stopped.state==='postponed'?'Перенесено':'Отменено'}: ${stopped.title}`); modal=null;
    }
    save(); return render();
  }
  if (action==='advance') {
    const p=state.patients.find(p=>p.id===el.dataset.patient), s=currentStep(p); if(!s)return;
    p.pinned=false;
    if (isOperationStep(s) && ['active','waiting'].includes(s.state)) { modal={type:'documents',mode:'start',patient:p.id}; return render(); }
    if (isOperationStep(s) && s.state==='in_progress') { s.state='in_or'; s.arrivedAt=Date.now(); log(p,'Доставлен в оперблок, таймер запущен'); }
    else if (s.state==='in_or') { s.state='pickup'; s.readyAt=Date.now(); log(p,'Поступил вызов: пациента нужно забрать'); }
    else if (s.state==='pickup') { modal=s.pickedUpAt?{type:'destination',patient:p.id}:{type:'documents',mode:'operation-pickup',patient:p.id}; return render(); }
    else if (s.state==='in_progress') { modal={type:'documents',mode:'finish',patient:p.id}; return render(); }
    else { modal={type:'documents',mode:'start',patient:p.id}; return render(); }
    save(); return render();
  }
  if (action==='advance-next') {
    const p=state.patients.find(p=>p.id===el.dataset.patient), s=currentStep(p);
    if(!p || !s || s.state!=='in_progress' || !nextWaitingStep(p)) return;
    modal={type:'documents',mode:'continue',patient:p.id}; return render();
  }
  if (action==='finish-operation') {
    const p=state.patients.find(p=>p.id===el.dataset.patient), s=p&&currentStep(p); if(!p||!s)return;
    const continueNow=Boolean(document.getElementById('continue-after-operation')?.checked);
    const now=Date.now(); s.destination=el.dataset.destination;
    const finished=completeCurrentStep(p,false,now);
    log(p,`Доставлен после оперблока: ${el.dataset.destination}`);
    modal=continueNow&&finished.next?{type:'documents',mode:'start',patient:p.id}:null;
    save(); return render();
  }
  if (action==='submit-quick') {
    const form=document.getElementById('quick-form'); if(!form.reportValidity()) return;
    const fd=new FormData(form), type=fd.get('type'), urgent=fd.get('urgent')==='on';
    const title=fd.get('title').trim() || typeLabel(type);
    const doctorId=String(fd.get('doctor')||''), doctorName=doctorId&&doctorId!=='external'?(getContacts().find(item=>item.id===doctorId)?.name||''):String(fd.get('doctor-name')||'').trim();
    const p={id:uid(),surname:fd.get('surname').trim(),room:fd.get('room').trim(),departmentId:String(fd.get('department')||''),doctorId,doctorName,block:'',transport:'',priority:'normal',pinned:false,steps:[{id:uid(),type,title,time:fd.get('time')||'',state:'active',urgent,needsClarification:!fd.get('room')}],note:'',events:[]};
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
    const doctorId=String(fd.get('doctor')||''), doctorName=doctorId&&doctorId!=='external'?(getContacts().find(item=>item.id===doctorId)?.name||''):String(fd.get('doctor-name')||'').trim();
    const p={id:uid(),surname:fd.get('surname'),room:fd.get('room'),departmentId:String(fd.get('department')||''),doctorId,doctorName,block:fd.get('block'),transport:fd.get('transport'),priority:'normal',pinned:false,steps,note:fd.get('note'),events:[]};
    syncPatientPriority(p,urgent);
    log(p,urgent?'Добавлено срочное поручение':'Создан маршрут на сегодня'); state.patients.push(p); modal=null; save(); return render();
  }
  if (action==='handoff') { modal={type:'documents',mode:'handoff',patient:el.dataset.patient}; return render(); }
  if (['cancel-step','postpone-step'].includes(action)) {
    const p=state.patients.find(p=>p.id===el.dataset.patient), s=currentStep(p); if(!s)return;
    if (['in_progress','in_or','pickup'].includes(s.state) && !s.documents?.finish) {
      modal={type:'documents',mode:'stop',stopAction:action,patient:p.id}; return render();
    }
    const stopped=stopCurrentStep(p,action);
    log(p,`${stopped.state==='postponed'?'Перенесено':'Отменено'}: ${stopped.title}`); modal=null; save(); return render();
  }
  if (action==='delete-patient') { modal={type:'confirm-delete',patient:el.dataset.patient}; return render(); }
  if (action==='confirm-delete-patient') { state.patients=state.patients.filter(p=>p.id!==el.dataset.patient); modal=null; save(); return render(); }
  if (action==='new-shift') { modal={type:'confirm-new-shift'}; return render(); }
  if (action==='confirm-new-shift') {
    state.archive ||= [];
    if(state.patients.length) state.archive.push({id:uid(),startedAt:state.shiftStartedAt,closedAt:Date.now(),patients:clone(state.patients)});
    state.patients=[]; state.shiftStartedAt=Date.now(); modal=null; view='today'; save(); return render();
  }
  if (action==='reset') { modal={type:'confirm-reset'}; return render(); }
  if (action==='confirm-reset') { localStorage.removeItem(STORAGE_KEY); state=normalizeState(clone(seed)); state.shiftStartedAt=Date.now(); modal=null; view='today'; save(); return render(); }
}

globalThis.__MEDFLOW_TEST__={
  isStoppedStep,isTerminalStep,isHistoryStep,currentStep,isComplete,score,nextWaitingStep,activateNext,canContinueNow,completeCurrentStep,stopCurrentStep,
  actionLabel,timerClass,shiftProgress,esc,isOperationStep,hasTodayOperation,normalizeState,normalizeStep,typeLabel,
  syncPatientPriority,stepMatchesDirection,canEditRouteStep,changeRouteStepType,parseTime,patientTimeMinutes,comparePatients,sortPatients,validTimestamp,
  fmtClock,durationBetween,operationElapsed,pickupTravelElapsed,operationTimersView,setStepDocument,documentStatusLabel,stepHistoryFacts,addButtonPosition,showFloatingAdd,
  captureViewPosition,restoreViewPosition,historyStepView,historyPatientCard,shiftCardView,inferShiftStart,historyView,settingsView,topbarView,
  resetStepTracking,restoreOrRepeatStep,restoreArchivedStep,mergeStep,mergePatient,mergeStates,backupEnvelope,syncPillView,preopChecklistView,
  getDepartments,ownDepartmentId,departmentLabel,isOwnDepartment,departmentOptions,patientMatchesDepartment,departmentFiltersView,
  normalizeContact,contactRoleLabel,doctorOptions,patientDoctor,phoneHref,contactsView,contactCard
};
setInterval(()=>{ if(document.querySelector('.timer')) render(true); },30000);
window.addEventListener('online',()=>{
  cloud.status=cloud.session?'pending':'local';
  cloud.message=cloud.session?'Сеть появилась, синхронизируем…':'';
  if(cloud.session) syncCloudState(); else if(view==='settings'||view==='today') render(true);
});
window.addEventListener('offline',()=>{
  cloud.status='offline';
  cloud.message=cloud.session?'Изменения сохраняются на устройстве':'';
  if(view==='settings'||view==='today') render(true);
});
render();
handleAuthRedirect().then(()=>{ if(cloud.session && modal?.type!=='password-update') setTimeout(()=>syncCloudState(),0); }).catch(error=>{
  cloud.message=authErrorMessage(error); if(cloud.session) setTimeout(()=>syncCloudState(),0); if(view==='settings')render(true);
});
