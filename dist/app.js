const STORAGE_KEY = 'medflow-prototype-v1';
const AUTH_STORAGE_KEY = 'medflow-supabase-session-v1';
const SYNC_META_KEY = 'medflow-sync-meta-v1';
const SYNC_STATE_KEY = 'medflow-sync-state-v2';
const TEAM_STORAGE_KEY = 'medflow-team-session-v1';
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
const DEFAULT_WAIT_THRESHOLDS = { warningMinutes:60, criticalMinutes:120 };
const UNDO_TIMEOUT = 8000;
const CARE_FLAGS = [
  {id:'patient_attention',icon:'⚠',label:'Внимание к пациенту',hint:'Нужна повышенная внимательность или помощь второго сотрудника'},
  {id:'extra_protection',icon:'☣',label:'Доп. меры защиты',hint:'Только по указанию медработника, без записи диагноза'}
];

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
  schemaVersion: 11,
  shiftStartedAt: Date.now(),
  incoming: [],
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
  settings: { sortMode: 'priority', addButtonPosition: 'floating', ownDepartmentId: 'department-own', workMode:'solo', travelMode:false, waitThresholds:clone(DEFAULT_WAIT_THRESHOLDS) }
};

let state = load();
let view = 'today';
let direction = 'all';
let departmentFilter = ownDepartmentId();
let contactDepartmentFilter = 'all';
let contactRoleFilter = 'all';
let patientSearch = '';
let contactSearch = '';
let searchOpen = false;
let modal = null;
let renderedModalKey = '';
let showCompleted = false;
let undoEntry = null;
let undoTimer = null;
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
let team = loadTeamSession();

function loadTeamSession() {
  try {
    const value=JSON.parse(localStorage.getItem(TEAM_STORAGE_KEY))||{};
    return {shiftId:String(value.shiftId||''),title:String(value.title||''),role:String(value.role||''),displayName:String(value.displayName||''),remoteVersion:String(value.remoteVersion||''),lastLocalAt:Number(value.lastLocalAt)||0,members:Array.isArray(value.members)?value.members:[],pendingReleases:Array.isArray(value.pendingReleases)?value.pendingReleases:[],invite:null,loading:false,error:''};
  } catch { return {shiftId:'',title:'',role:'',displayName:'',remoteVersion:'',lastLocalAt:0,members:[],pendingReleases:[],invite:null,loading:false,error:''}; }
}
function storeTeamSession(next={}) {
  team={...team,...next};
  const persisted={shiftId:team.shiftId,title:team.title,role:team.role,displayName:team.displayName,remoteVersion:team.remoteVersion,lastLocalAt:team.lastLocalAt,members:team.members,pendingReleases:team.pendingReleases};
  if(team.shiftId) localStorage.setItem(TEAM_STORAGE_KEY,JSON.stringify(persisted)); else localStorage.removeItem(TEAM_STORAGE_KEY);
}
function activeTeamShift() { return Boolean(team.shiftId&&cloud.session?.user?.id); }
function teamRole() { return activeTeamShift()?team.role:''; }
function canManageTeam() { return teamRole()==='owner'; }
function canOperateTeam() { return !activeTeamShift()||['owner','orderly'].includes(teamRole()); }
function canEditTeam() { return !activeTeamShift()||['owner','orderly','nurse'].includes(teamRole()); }
function currentActor() {
  const userId=cloud.session?.user?.id||'';
  const member=team.members.find(item=>item.user_id===userId);
  return {id:userId,name:member?.display_name||team.displayName||sessionEmail()||'Сотрудник',role:member?.role||team.role||''};
}
function memberById(id) { return team.members.find(item=>item.user_id===id)||null; }
function actorName(id,fallback='') { return memberById(id)?.display_name||fallback||''; }
function roleLabel(role) { return ({owner:'Владелец смены',orderly:'Санитар',nurse:'Медсестра',viewer:'Только просмотр'})[role]||'Участник'; }
function queueTeamRelease(patientId) {
  if(!activeTeamShift()||!patientId)return;
  storeTeamSession({pendingReleases:[...new Set([...(team.pendingReleases||[]),patientId])]});
}
async function flushTeamReleases() {
  if(!activeTeamShift()||!navigator.onLine||!team.pendingReleases?.length)return;
  const remaining=[];
  for(const patientId of team.pendingReleases) {
    try { await teamRpc('medflow_release_patient',{target_shift:team.shiftId,target_patient:patientId}); }
    catch { remaining.push(patientId); }
  }
  storeTeamSession({pendingReleases:remaining});
}

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
async function teamRpc(name,args={}) {
  return cloudRequest(`/rest/v1/rpc/${name}`,{method:'POST',body:JSON.stringify(args)});
}
async function fetchTeamMembers() {
  if(!activeTeamShift()) return [];
  const rows=await cloudRequest(`/rest/v1/medflow_shift_members?select=user_id,display_name,role,joined_at,last_seen_at&shift_id=eq.${encodeURIComponent(team.shiftId)}&order=joined_at.asc`);
  if(!rows?.length) throw new Error('Участие в общей смене не найдено');
  const own=rows.find(item=>item.user_id===cloud.session?.user?.id);
  storeTeamSession({members:rows,role:own?.role||team.role,displayName:own?.display_name||team.displayName});
  return rows;
}
async function discoverTeamShift() {
  if(!cloud.session?.user?.id) return false;
  if(team.shiftId) {
    try { await fetchTeamMembers(); return true; }
    catch { storeTeamSession({shiftId:'',title:'',role:'',displayName:'',remoteVersion:'',lastLocalAt:0,members:[]}); }
  }
  const rows=await cloudRequest(`/rest/v1/medflow_shift_members?select=shift_id,user_id,display_name,role,joined_at,last_seen_at&user_id=eq.${encodeURIComponent(cloud.session.user.id)}&order=joined_at.desc&limit=1`);
  if(!rows?.length) return false;
  const member=rows[0];
  storeTeamSession({shiftId:member.shift_id,role:member.role,displayName:member.display_name,remoteVersion:'',lastLocalAt:0,members:[member]});
  await fetchTeamMembers();
  return true;
}
async function createTeamShift(title,displayName) {
  const shiftId=await teamRpc('medflow_create_shift',{shift_title:title,member_name:displayName,initial_payload:state});
  storeTeamSession({shiftId:String(shiftId||'').replaceAll('"',''),title:title||'Рабочая смена',role:'owner',displayName,remoteVersion:'',lastLocalAt:localUpdatedAt,members:[]});
  state.settings.workMode='team'; localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
  await fetchTeamMembers(); await syncSharedShift({preferRemote:true});
}
async function joinTeamShift(code,displayName) {
  const shiftId=await teamRpc('medflow_join_shift',{invite_code:code,member_name:displayName});
  storeTeamSession({shiftId:String(shiftId||'').replaceAll('"',''),title:'',role:'',displayName,remoteVersion:'',lastLocalAt:0,members:[]});
  state.settings.workMode='team'; localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
  await fetchTeamMembers(); await syncSharedShift({preferRemote:true});
}
async function createTeamInvite(role) {
  const code=await teamRpc('medflow_create_shift_invite',{target_shift:team.shiftId,member_role:role});
  team.invite={code:String(code||'').replaceAll('"',''),role};
  return team.invite;
}
async function leaveTeamShift() {
  if(!activeTeamShift()) return;
  if(teamRole()==='owner') await cloudRequest(`/rest/v1/medflow_shifts?id=eq.${encodeURIComponent(team.shiftId)}`,{method:'DELETE'});
  else await cloudRequest(`/rest/v1/medflow_shift_members?shift_id=eq.${encodeURIComponent(team.shiftId)}&user_id=eq.${encodeURIComponent(cloud.session.user.id)}`,{method:'DELETE'});
  storeTeamSession({shiftId:'',title:'',role:'',displayName:'',remoteVersion:'',lastLocalAt:0,members:[],pendingReleases:[],invite:null});
  state.settings.workMode='solo'; save();
}
async function pushSharedShift(expectedVersion=team.remoteVersion) {
  if(!activeTeamShift()||!navigator.onLine||!canEditTeam()) return false;
  const result=await teamRpc('medflow_update_shift',{target_shift:team.shiftId,expected_updated_at:expectedVersion||null,next_payload:state});
  if(!result?.ok) return result||{ok:false};
  const syncedAt=Date.now();
  storeTeamSession({remoteVersion:result.updated_at||expectedVersion,lastLocalAt:localUpdatedAt,title:result.title||team.title});
  cloud.lastSyncedAt=syncedAt; cloud.status='synced'; cloud.message='Общая смена сохранена'; clearCloudRetry();
  return result;
}
async function syncSharedShift({preferRemote=false}={}) {
  if(cloud.syncing||!activeTeamShift()) return;
  if(!navigator.onLine){cloud.status='offline';cloud.message='Общая смена сохранена на устройстве';return;}
  if(deferSyncForOpenForm()) return;
  cloud.syncing=true; cloud.status='syncing';
  try {
    const ready=await ensureCloudSession(); if(!ready)return;
    await flushTeamReleases();
    const rows=await cloudRequest(`/rest/v1/medflow_shifts?select=id,title,payload,updated_at,closed_at&id=eq.${encodeURIComponent(team.shiftId)}&limit=1`);
    const remote=rows?.[0]; if(!remote) throw new Error('Общая смена не найдена или доступ отозван');
    const remoteChanged=Boolean(team.remoteVersion&&remote.updated_at!==team.remoteVersion);
    const localDirty=localUpdatedAt>(team.lastLocalAt||0);
    if(preferRemote||(!localDirty&&(remoteChanged||!team.remoteVersion))) {
      state=normalizeState(clone(remote.payload)); state.settings.workMode='team';
      localStorage.setItem(STORAGE_KEY,JSON.stringify(state)); localUpdatedAt=Date.now(); localStorage.setItem(SYNC_META_KEY,String(localUpdatedAt));
      storeTeamSession({remoteVersion:remote.updated_at,lastLocalAt:localUpdatedAt,title:remote.title||team.title});
      cloud.lastSyncedAt=Date.now(); cloud.status='synced'; cloud.message='Общая смена обновлена';
    } else if(localDirty) {
      let expected=remote.updated_at;
      if(remoteChanged||!team.remoteVersion) state=mergeStates(state,remote.payload);
      for(let attempt=0;attempt<3;attempt+=1) {
        const result=await pushSharedShift(expected);
        if(result?.ok) break;
        if(!result?.payload) throw new Error('Не удалось объединить общую смену');
        state=mergeStates(state,result.payload); expected=result.updated_at;
        localStorage.setItem(STORAGE_KEY,JSON.stringify(state)); localUpdatedAt=Date.now(); localStorage.setItem(SYNC_META_KEY,String(localUpdatedAt));
        if(attempt===2) throw new Error('Смена быстро меняется на другом устройстве. Повторим автоматически');
      }
    } else {
      storeTeamSession({remoteVersion:remote.updated_at,lastLocalAt:localUpdatedAt,title:remote.title||team.title});
      cloud.lastSyncedAt=Date.now();cloud.status='synced';cloud.message='';
    }
    await fetchTeamMembers(); clearCloudRetry();
  } catch(error) { cloud.status='error';cloud.message=error.message||'Не удалось синхронизировать общую смену';scheduleCloudRetry(); }
  finally {cloud.syncing=false;if(!modal&&(view==='settings'||view==='today'||view==='inbox'))render(true);}
}
async function pushCloudState() {
  if(activeTeamShift()) return pushSharedShift();
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
function hasOpenWorkForm() {
  return Boolean(modal && !['sync-conflict','password-update','import-backup-confirm','confirm-delete','confirm-new-shift','confirm-reset','confirm-transition'].includes(modal.type));
}
function deferSyncForOpenForm() {
  if (!hasOpenWorkForm()) return false;
  cloud.status='pending';
  cloud.message='Синхронизация продолжится после закрытия формы';
  return true;
}
async function syncCloudState({preferRemote=false}={}) {
  if(activeTeamShift()) return syncSharedShift({preferRemote});
  if (cloud.syncing || !cloud.session?.user?.id) return;
  if (!navigator.onLine) { cloud.status='offline'; cloud.message='Изменения сохранены на устройстве'; return; }
  if (deferSyncForOpenForm()) return;
  cloud.syncing = true;
  cloud.status = 'syncing';
  if (!modal && (view === 'settings' || view === 'today')) render(true);
  try {
    const ready = await ensureCloudSession();
    if (!ready) return;
    if (deferSyncForOpenForm()) return;
    const rows = await cloudRequest(`/rest/v1/medflow_states?select=payload,client_updated_at,updated_at&user_id=eq.${encodeURIComponent(cloud.session.user.id)}&limit=1`);
    if (deferSyncForOpenForm()) return;
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
    if (!modal && (view === 'settings' || view === 'today')) render(true);
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
  await discoverTeamShift();
  await syncCloudState();
}
async function signUpCloud(email,password) {
  const result = await cloudRequest('/auth/v1/signup', { method:'POST', body:JSON.stringify({email,password}) }, false);
  if (result?.access_token) {
    storeCloudSession(result);
    cloud.message = 'Аккаунт создан';
    await discoverTeamShift();
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
  const events=[...(localPatient.events||[]),...(remotePatient.events||[])].filter((event,index,all)=>index===all.findIndex(item=>event.id&&item.id?item.id===event.id:item.at===event.at&&item.text===event.text)).sort((a,b)=>(a.at||0)-(b.at||0));
  const patientTime=patient=>Math.max(0,Number(patient.updatedAt)||0,Number(patient.inboxCreatedAt)||0,Number(patient.inboxResolvedAt)||0,...(patient.steps||[]).map(stepTouchedAt),...(patient.events||[]).map(event=>Number(event.at)||0));
  const preferred=patientTime(remotePatient)>patientTime(localPatient)?remotePatient:localPatient;
  return {...clone(localPatient),...clone(remotePatient),...clone(preferred),steps:stepIds.map(id=>mergeStep(localSteps.get(id),remoteSteps.get(id))),events};
}
function mergeStates(localState,remoteState) {
  const local=normalizeState(clone(localState)), remote=normalizeState(clone(remoteState));
  const localPatients=new Map(local.patients.map(patient=>[patient.id,patient]));
  const remotePatients=new Map(remote.patients.map(patient=>[patient.id,patient]));
  const patientIds=[...new Set([...localPatients.keys(),...remotePatients.keys()])];
  const localIncoming=new Map(local.incoming.map(patient=>[patient.id,patient]));
  const remoteIncoming=new Map(remote.incoming.map(patient=>[patient.id,patient]));
  const incomingIds=[...new Set([...localIncoming.keys(),...remoteIncoming.keys()])];
  const archives=[...(remote.archive||[]),...(local.archive||[])].filter((shift,index,all)=>index===all.findIndex(item=>item.id===shift.id));
  const directions=[...(local.directions||[]),...(remote.directions||[])].filter((item,index,all)=>index===all.findIndex(entry=>entry.id===item.id));
  const departments=[...(local.departments||[]),...(remote.departments||[])].filter((item,index,all)=>index===all.findIndex(entry=>entry.id===item.id));
  const contacts=[...(local.contacts||[]),...(remote.contacts||[])].filter((item,index,all)=>index===all.findIndex(entry=>entry.id===item.id));
  return normalizeState({...remote,...local,patients:patientIds.map(id=>mergePatient(localPatients.get(id),remotePatients.get(id))),incoming:incomingIds.map(id=>mergePatient(localIncoming.get(id),remoteIncoming.get(id))),archive:archives,directions,departments,contacts});
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
  step.time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(step.time||'')) ? String(step.time) : '';
  step.timeFlexible = Boolean(step.timeFlexible && !step.time);
  return step;
}
function normalizePatient(patient) {
  if (!patient || typeof patient !== 'object') return null;
  patient.steps = Array.isArray(patient.steps) ? patient.steps.map(normalizeStep).filter(Boolean) : [];
  patient.events = Array.isArray(patient.events) ? patient.events : [];
  patient.departmentId = String(patient.departmentId || '');
  patient.doctorId = String(patient.doctorId || '');
  patient.doctorName = String(patient.doctorName || '');
  patient.createdBy = String(patient.createdBy || '');
  patient.createdByName = String(patient.createdByName || '');
  patient.acceptedBy = String(patient.acceptedBy || '');
  patient.acceptedByName = String(patient.acceptedByName || '');
  patient.assignedTo = String(patient.assignedTo || '');
  patient.assignedToName = String(patient.assignedToName || '');
  patient.updatedAt = validTimestamp(patient.updatedAt) || 0;
  patient.updatedBy = String(patient.updatedBy || '');
  patient.block = ['gxo','xo','op'].includes(patient.block) ? 'op' : patient.block === 'angio' ? 'angio' : '';
  const allowedFlags=new Set(CARE_FLAGS.map(item=>item.id));
  patient.careFlags=Array.isArray(patient.careFlags)?[...new Set(patient.careFlags.map(flag=>['hygiene_caution','assisted_contact'].includes(flag)?'patient_attention':flag).filter(flag=>allowedFlags.has(flag)))]:[];
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
  next.schemaVersion = 11;
  next.patients = Array.isArray(next.patients) ? next.patients.map(normalizePatient).filter(Boolean) : [];
  next.incoming = Array.isArray(next.incoming) ? next.incoming.map(normalizePatient).filter(Boolean) : [];
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
  if (!['solo','team'].includes(next.settings.workMode)) next.settings.workMode = 'solo';
  next.settings.travelMode = Boolean(next.settings.travelMode);
  const thresholds=next.settings.waitThresholds&&typeof next.settings.waitThresholds==='object'?next.settings.waitThresholds:{};
  const warningMinutes=Math.max(1,Math.round(Number(thresholds.warningMinutes)||DEFAULT_WAIT_THRESHOLDS.warningMinutes));
  const criticalMinutes=Math.max(warningMinutes+1,Math.round(Number(thresholds.criticalMinutes)||DEFAULT_WAIT_THRESHOLDS.criticalMinutes));
  next.settings.waitThresholds={warningMinutes,criticalMinutes};
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
  next.incoming.forEach(patient => { if (!validDepartmentIds.has(patient.departmentId)) patient.departmentId = ''; });
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
  if(contact) return {id:contact.id,name:contact.name,departmentId:contact.departmentId,phone:contact.phone,role:contact.role};
  if(patient?.doctorId==='external' || patient?.doctorName) return {name:patient.doctorName||'Врач другого отделения',departmentId:patient.departmentId||'',phone:'',role:'doctor'};
  return null;
}
function phoneHref(phone='') {
  const cleaned=String(phone).trim().replace(/[^\d+*#,;]/g,'');
  return cleaned ? `tel:${cleaned}` : '';
}
function normalizedSearch(value='') { return String(value).trim().toLocaleLowerCase('ru-RU'); }
function patientMatchesSearch(patient, query=patientSearch) {
  const needle=normalizedSearch(query); if(!needle)return true;
  const doctor=patientDoctor(patient);
  return [patient?.surname,patient?.room,patient?.transport,patient?.note,departmentLabel(patient?.departmentId),doctor?.name,...(patient?.steps||[]).map(step=>step.title)]
    .some(value=>normalizedSearch(value).includes(needle));
}
function contactMatchesSearch(contact, query=contactSearch) {
  const needle=normalizedSearch(query); if(!needle)return true;
  return [contact?.name,contact?.phone,contact?.note,contactRoleLabel(contact?.role),departmentLabel(contact?.departmentId)]
    .some(value=>normalizedSearch(value).includes(needle));
}
function patientMissingFields(patient) {
  const missing=[];
  if(!String(patient?.room||'').trim())missing.push('палата');
  if(!String(patient?.transport||'').trim())missing.push('способ передвижения');
  if(hasTodayOperation(patient)&&!patient?.block)missing.push('оперблок');
  const step=currentStep(patient);
  if(step&&!String(step.time||'').trim()&&!step.timeFlexible)missing.push('время');
  return missing;
}
function stepTimeLabel(step) { return step?.time || (step?.timeFlexible ? 'Без времени' : ''); }
function normalizeTimeInput(value='') {
  const compact=String(value).trim().replace(/[.\-\s]/g,':');
  const match=/^(\d{1,2}):(\d{2})$/.exec(compact);
  if(!match)return '';
  const hour=Number(match[1]),minute=Number(match[2]);
  return hour<24&&minute<60?`${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`:'';
}
function readTimeChoice(fd,name='time') {
  if(fd.get(`${name}-none`)==='on')return {time:'',timeFlexible:true};
  const raw=String(fd.get(name)||'').trim();
  return {time:normalizeTimeInput(raw),timeFlexible:false,invalid:Boolean(raw&&!normalizeTimeInput(raw))};
}
function timeChoice(name='time',step={},label='Время') {
  const flexible=Boolean(step?.timeFlexible&&!step?.time);
  return `<div class="field time-choice"><label>${esc(label)}</label><div class="time-choice-row"><input type="time" step="300" name="${esc(name)}" value="${esc(step?.time||'')}" ${flexible?'disabled':''} data-time-input="${esc(name)}" /><div class="time-choice-actions"><button type="button" class="time-now" data-time-now="${esc(name)}">Сейчас</button><label class="no-time"><input type="checkbox" name="${esc(name)}-none" data-time-none="${esc(name)}" ${flexible?'checked':''}/><span>Без времени</span></label></div></div></div>`;
}
function entryTargetChoice(selected='queue', mode=workMode()) {
  if(mode==='team') return `<div class="entry-target team-entry-target full"><input type="hidden" name="entry-target" value="inbox" /><span><b>Добавится в «Новое»</b><small>В командной смене поручение сначала подтверждается, чтобы два сотрудника не взяли его одновременно.</small></span></div>`;
  return `<fieldset class="entry-target full"><legend>Куда добавить</legend><div><label><input type="radio" name="entry-target" value="queue" ${selected!=='inbox'?'checked':''}/><span><b>В очередь</b><small>Сразу появится на главной</small></span></label><label><input type="radio" name="entry-target" value="inbox" ${selected==='inbox'?'checked':''}/><span><b>В Новое</b><small>Сначала потребуется принять</small></span></label></div></fieldset>`;
}
function careFlagsView(selected=[]) {
  const active=new Set(selected||[]);
  return `<fieldset class="care-flags"><legend>Рабочие предупреждения</legend><p>Без диагноза. Отмечай только то, что влияет на безопасное сопровождение.</p>${CARE_FLAGS.map(item=>`<label><input type="checkbox" name="care-flag" value="${item.id}" ${active.has(item.id)?'checked':''}/><span><b>${item.icon} ${esc(item.label)}</b><small>${esc(item.hint)}</small></span></label>`).join('')}</fieldset>`;
}
function patientCareFlags(patient) {
  const active=new Set(patient?.careFlags||[]);
  return CARE_FLAGS.filter(item=>active.has(item.id));
}
function hasOperationSelection(form) {
  if(!form)return false;
  const primary=form.querySelector('[name="type"]')?.value;
  return primary==='operation'||[...form.querySelectorAll('[name="extra-direction"]:checked')].some(input=>input.value==='operation');
}
function searchBox(id,value,placeholder) {
  return `<label class="search-box" for="${esc(id)}"><span aria-hidden="true">⌕</span><input id="${esc(id)}" value="${esc(value)}" placeholder="${esc(placeholder)}" aria-label="Поиск" autocomplete="off" enterkeyhint="search" /><button type="button" data-action="search-close" aria-label="Закрыть поиск">×</button></label>`;
}
function searchKindForView() { return ['today','directions'].includes(view)?'patient':view==='contacts'?'contact':''; }
function searchToggleView() {
  const kind=searchKindForView();if(!kind)return '';
  const value=kind==='contact'?contactSearch:patientSearch;
  return `<button class="icon-btn search-toggle ${searchOpen||value?'active':''}" data-action="search-toggle" aria-label="${searchOpen?'Скрыть поиск':'Открыть поиск'}">⌕</button>`;
}
function activeSearchView() {
  const kind=searchKindForView();if(!kind||(!searchOpen&&!(kind==='contact'?contactSearch:patientSearch)))return '';
  return searchBox(kind==='contact'?'contact-search':'patient-search',kind==='contact'?contactSearch:patientSearch,kind==='contact'?'Имя, номер, отделение или роль':'Фамилия, палата, врач или направление');
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
function waitThresholds() { return state.settings?.waitThresholds || DEFAULT_WAIT_THRESHOLDS; }
function timerClass(ms, thresholds=waitThresholds()) {
  const m=ms/60000;
  return m < thresholds.warningMinutes ? 'green' : m < thresholds.criticalMinutes ? 'yellow' : 'red';
}
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
function workMode(settings=state.settings) { return settings?.workMode === 'team' ? 'team' : 'solo'; }
function workModeSelectorView(compact=false) {
  const mode=workMode();
  return `<div class="work-mode-selector ${compact?'compact':''}" role="group" aria-label="Режим смены">
    <button class="${mode==='solo'?'active':''}" data-action="set-work-mode" data-mode="solo" aria-pressed="${mode==='solo'}"><b>Соло</b>${compact?'':'<span>Только личная очередь</span>'}</button>
    <button class="${mode==='team'?'active':''}" data-action="set-work-mode" data-mode="team" aria-pressed="${mode==='team'}"><b>Команда</b>${compact?'':'<span>Напарник и сотрудники поста</span>'}</button>
  </div>`;
}
function showFloatingAdd(currentView=view, settings=state.settings) {
  return canEditTeam() && ['today','inbox','directions'].includes(currentView) && addButtonPosition(settings) === 'floating';
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

function modalDraftKey(value=modal) {
  if (!value) return '';
  return [value.type||'',value.patient||'',value.contact||'',value.mode||'',value.stopAction||''].join(':');
}
function captureModalDraft() {
  const key=modalDraftKey();
  if(!key || key!==renderedModalKey || !hasOpenWorkForm()) return;
  const form=document.querySelector?.('.modal form');
  if(!form)return;
  const controls=[...form.querySelectorAll('input[name],select[name],textarea[name]')];
  const focused=document.activeElement;
  modal.formDraft={
    key,
    values:controls.map(control=>({value:control.value,checked:Boolean(control.checked)})),
    focusIndex:controls.indexOf(focused),
    selectionStart:Number.isFinite(focused?.selectionStart)?focused.selectionStart:null,
    selectionEnd:Number.isFinite(focused?.selectionEnd)?focused.selectionEnd:null
  };
}
function restoreModalDraft() {
  const draft=modal?.formDraft, key=modalDraftKey();
  if(!draft || draft.key!==key)return;
  const form=document.querySelector?.('.modal form');
  if(!form)return;
  const controls=[...form.querySelectorAll('input[name],select[name],textarea[name]')];
  controls.forEach((control,index)=>{
    const saved=draft.values[index]; if(!saved)return;
    if(['checkbox','radio'].includes(control.type))control.checked=saved.checked;
    else control.value=saved.value;
  });
  const focus=controls[draft.focusIndex];
  if(focus)requestAnimationFrame(()=>{focus.focus();if(draft.selectionStart!==null)focus.setSelectionRange?.(draft.selectionStart,draft.selectionEnd);});
}

function render(preservePosition=false) {
  captureModalDraft();
  const position = preservePosition ? captureViewPosition() : null;
  const active = sortPatients(state.patients.filter(p => !isComplete(p)));
  const completed = sortPatients(state.patients.filter(isComplete));
  document.getElementById('app').innerHTML = `
    <main class="shell ${state.settings.travelMode?'travel-mode':''} ${workMode()}-mode">
      ${topbarView()}
      ${view === 'directions' ? sortControl() : ''}
      ${view === 'today' ? todayView(active, completed) : view === 'inbox' ? inboxView() : view === 'directions' ? directionsView() : view === 'contacts' ? contactsView() : view === 'history' ? historyView() : settingsView()}
    </main>
    ${showFloatingAdd() ? '<button class="fab" data-action="add" aria-label="Записать пациента">＋</button>' : ''}
    <nav class="nav">
      ${navButton('today','⌂','Сегодня')}
      ${navButton('inbox','＋','Новое',pendingIncoming().length)}
      ${navButton('directions','⌘','Направления')}
      ${moreNavButton()}
    </nav>
    <input id="backup-file" class="visually-hidden" type="file" accept="application/json,.json" />
    ${undoView()}
    ${modal ? modalView() : ''}
  `;
  restoreModalDraft();
  bind();
  renderedModalKey=modalDraftKey();
  restoreViewPosition(position);
}

function undoView() {
  return undoEntry ? `<div class="undo-toast" role="status"><span>${esc(undoEntry.label)}</span><button data-action="undo-last">Отменить</button></div>` : '';
}

function navButton(id, icon, text, count=0) { return `<button class="nav-btn ${view===id?'active':''}" data-view="${id}"><b>${icon}</b>${text}${count?`<i class="nav-count">${count>99?'99+':count}</i>`:''}</button>`; }
function moreNavButton() {
  const active=['contacts','history','settings'].includes(view);
  return `<button class="nav-btn ${active?'active':''}" data-action="open-more"><b>•••</b>Ещё</button>`;
}
function topbarView() {
  const inlineAdd = canEditTeam() && addButtonPosition() === 'inline';
  if (view !== 'today') {
    const title = view === 'inbox' ? 'Новое' : view === 'directions' ? 'Направления' : view === 'contacts' ? 'Контакты' : view === 'history' ? 'История' : 'Настройки';
    return `<header class="topbar section-topbar"><h1>${title}</h1><div class="topbar-actions">${searchToggleView()}${['inbox','directions'].includes(view)&&inlineAdd?'<button class="icon-btn quick-add-btn" data-action="add" aria-label="Записать пациента">＋</button>':''}</div></header>`;
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
    <div class="topbar-actions">${syncPillView()}${searchToggleView()}${inlineAdd?'<button class="icon-btn quick-add-btn" data-action="add" aria-label="Записать пациента">＋</button>':''}</div>
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
  const filters = [...getDepartments(), {id:'all',label:'Все отделения'}, {id:'none',label:'Не указано'}];
  return `<label class="department-filter-wrap"><span>Отделение</span><span class="department-select"><select data-department-filter aria-label="Фильтр по отделению">${filters.map(item=>`<option value="${esc(item.id)}" ${departmentFilter===item.id?'selected':''}>${esc(item.label)}${item.id===ownDepartmentId()?' · наше':''}</option>`).join('')}</select><i aria-hidden="true"></i></span></label>`;
}
function todayView(active, completed) {
  const visibleActive = active.filter(patient => patientMatchesDepartment(patient) && patientMatchesSearch(patient));
  const visibleCompleted = completed.filter(patient => patientMatchesDepartment(patient) && patientMatchesSearch(patient));
  const ops = [...visibleActive, ...visibleCompleted].filter(hasTodayOperation).length;
  const inOr = visibleActive.filter(p => p.steps.some(s => ['in_or','pickup'].includes(s.state))).length;
  const engagedPatients = visibleActive.filter(p => p.steps.some(s => ['in_progress','in_or','pickup'].includes(s.state)));
  const queuedPatients = visibleActive.filter(p => !engagedPatients.includes(p));
  const engaged = engagedPatients.length;
  return `
    ${pendingIncoming().length?`<button class="inbox-banner" data-view="inbox"><span><b>${pendingIncoming().length}</b><i>Новые поручения</i></span><strong>Посмотреть →</strong></button>`:''}
    ${activeSearchView()}
    ${departmentFiltersView()}
    ${engagedPatients.length ? `
      <div class="section-head workstream-head status-section working"><h2>В работе</h2><span>${engaged} вне палаты</span></div>
      <div class="patient-list">${engagedPatients.map(compactPatientCard).join('')}</div>
    ` : ''}
    <div class="section-head workstream-head queue-head status-section waiting"><h2>Ожидают</h2>${sortControl(true)}</div>
    <div class="patient-list">${queuedPatients.length ? queuedPatients.map(compactPatientCard).join('') : '<div class="empty compact-empty">Очередь свободна</div>'}</div>
    <section class="shift-summary" aria-label="Сводка смены">
      <div class="stat"><strong>${engaged}</strong><span>активных сейчас</span></div>
      <div class="stat"><strong>${ops}</strong><span>операции сегодня</span></div>
      <div class="stat"><strong>${inOr}</strong><span>в оперблоке</span></div>
    </section>
    <button class="completed-toggle" data-action="toggle-completed" aria-expanded="${showCompleted}">
      <span>Обработано сегодня</span>
      <strong><span>${visibleCompleted.length}</span><i class="toggle-chevron ${showCompleted ? 'open' : ''}" aria-hidden="true"></i></strong>
    </button>
    ${showCompleted ? `<div class="patient-list" style="margin-top:10px">${visibleCompleted.map(compactPatientCard).join('') || '<div class="empty">Пока ничего</div>'}</div>` : ''}
  `;
}

function pendingIncoming() {
  return (state.incoming||[]).filter(patient=>(patient.inboxStatus||'pending')==='pending').sort((a,b)=>{
    const urgentA=Boolean(currentStep(a)?.urgent), urgentB=Boolean(currentStep(b)?.urgent);
    return Number(urgentB)-Number(urgentA)||(Number(a.inboxCreatedAt)||0)-(Number(b.inboxCreatedAt)||0);
  });
}
function incomingCard(patient) {
  const step=currentStep(patient), urgent=Boolean(step?.urgent);
  return `<article class="incoming-card ${urgent?'urgent':''}">
    <div class="incoming-head"><div><div class="patient-name">${esc(patient.surname)} <span class="patient-room">· п.${esc(patient.room||'?')}</span></div><small>${esc(departmentLabel(patient.departmentId))}${patient.inboxCreatedAt?` · ${fmtClock(patient.inboxCreatedAt)}`:''}</small></div>${urgent?'<span class="badge urgent">СРОЧНО</span>':''}</div>
    <div class="incoming-task"><span>Поручение</span><b>${esc(step?.title||'Уточнить')}</b>${stepTimeLabel(step)?`<small>${esc(stepTimeLabel(step))}</small>`:''}</div>
    ${teamPatientMetaView(patient)}
    ${patientCareFlags(patient).length?`<div class="care-flag-badges">${patientCareFlags(patient).map(item=>`<span>${item.icon} ${esc(item.label)}</span>`).join('')}</div>`:''}
    ${canOperateTeam()?`<div class="incoming-actions"><button class="primary-btn" data-action="accept-incoming" data-patient="${patient.id}">Принять в очередь</button><button class="secondary-btn" data-action="reject-incoming" data-patient="${patient.id}">Отклонить</button></div>`:'<p class="inbox-role-note">Ожидает решения санитара</p>'}
  </article>`;
}
function inboxView() {
  const incoming=pendingIncoming();
  return `<section class="inbox-intro"><p>Сюда можно отправить запись с поста или оставить её себе на подтверждение.</p></section>
    <div class="section-head"><h2>Ожидают решения</h2><span>${incoming.length}</span></div>
    <div class="patient-list">${incoming.length?incoming.map(incomingCard).join(''):'<div class="empty">Новых поручений нет</div>'}</div>`;
}

function directionsView() {
  const dirs = [...getDirections(), {id:'other',label:'Другое'}];
  const quickIndex=dirs.map(item=>{
    const count=state.patients.filter(patient=>patientMatchesDepartment(patient)&&patientMatchesSearch(patient)&&directionPatientStatus(patient,item.id)).length;
    return `<button data-scroll-direction="${esc(item.id)}"><span>${esc(item.label)}</span><b>${count}</b></button>`;
  }).join('');
  return `
    ${activeSearchView()}
    <div class="section-head directions-head"><div><h2>Реестр направлений</h2><span>раскрой нужную группу</span></div><button class="secondary-btn manage-directions-btn" data-action="manage-directions">Настроить</button></div>
    ${departmentFiltersView()}
    <div id="directions-index" class="directions-quick-index" aria-label="Быстрый переход по направлениям"><button class="directions-home" data-action="directions-home">Начало</button>${quickIndex}</div>
    <div class="direction-registry">${dirs.map(directionRegistryGroup).join('')}</div>
  `;
}

function directionPatientStatus(patient, directionId) {
  const steps=(patient.steps||[]).filter(step=>stepMatchesDirection(step,directionId));
  if(steps.some(step=>['in_progress','in_or','pickup'].includes(step.state))) return 'working';
  if(steps.some(step=>!isTerminalStep(step))) return 'waiting';
  return steps.some(isTerminalStep) ? 'handled' : '';
}
function directionRegistryGroup(item) {
  const patients=sortPatients(state.patients.filter(patient=>patientMatchesDepartment(patient)&&patientMatchesSearch(patient)&&directionPatientStatus(patient,item.id)));
  const working=patients.filter(patient=>directionPatientStatus(patient,item.id)==='working');
  const waiting=patients.filter(patient=>directionPatientStatus(patient,item.id)==='waiting');
  const handled=patients.filter(patient=>directionPatientStatus(patient,item.id)==='handled');
  const content=(title,list,kind)=>`<section class="registry-section ${kind}"><div class="registry-section-head"><b>${title}</b><span>${list.length}</span></div>${list.length?`<div class="patient-list">${list.map(compactPatientCard).join('')}</div>`:'<div class="registry-empty">Нет</div>'}</section>`;
  return `<details id="direction-${esc(item.id)}" class="direction-group ${patients.length?'has-items':''}" data-direction-group="${esc(item.id)}" ${item.id==='operation'&&patients.length?'open':''}>
    <summary><div><span class="direction-mark ${esc(item.id)}" aria-hidden="true"></span><b>${esc(item.label)}</b></div><span class="direction-total">${patients.length}</span><i class="toggle-chevron" aria-hidden="true"></i></summary>
    <div class="direction-group-body">${content('В работе',working,'working')}${content('Ожидают',waiting,'waiting')}${content('Обработано',handled,'handled')}</div>
  </details>`;
}

function contactsView() {
  const departments=[{id:'all',label:'Все отделения'},...getDepartments(),{id:'none',label:'Без отделения'}];
  const roles=[{id:'all',label:'Все роли'},...CONTACT_ROLES];
  const contacts=getContacts()
    .filter(contact=>contactDepartmentFilter==='all'||(contactDepartmentFilter==='none'?!contact.departmentId:contact.departmentId===contactDepartmentFilter))
    .filter(contact=>contactRoleFilter==='all'||contact.role===contactRoleFilter)
    .filter(contact=>contactMatchesSearch(contact))
    .sort((a,b)=>a.name.localeCompare(b.name,'ru'));
  return `<div class="contacts-toolbar"><div><h2>Контакты отделений</h2><span>${getContacts().length} сохранено</span></div><button class="primary-btn contact-add-btn" data-action="contact-add">＋ Добавить</button></div>
    ${activeSearchView()}
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

function teamSettingsView() {
  if(!cloud.session) return `<section class="settings-card team-settings-card"><div class="settings-card-head"><h2>Общая смена</h2><span>нужен аккаунт</span></div><p>Войди в облако выше, чтобы создать смену или подключиться по одноразовому коду.</p></section>`;
  if(!activeTeamShift()) return `<section class="settings-card team-settings-card"><div class="settings-card-head"><h2>Общая смена</h2><span>не подключена</span></div><p>Создай смену для своего отделения или введи код от владельца. Личные данные останутся отдельной копией.</p><div class="settings-actions"><button class="primary-btn" data-action="team-create-open">Создать смену</button><button class="secondary-btn" data-action="team-join-open">Ввести код</button></div></section>`;
  const actor=currentActor();
  const members=team.members.map(member=>`<div class="team-member"><div><b>${esc(member.display_name)}</b><span>${esc(roleLabel(member.role))}${member.user_id===actor.id?' · это вы':''}</span></div>${canManageTeam()&&member.user_id!==actor.id?`<button class="secondary-btn" data-action="team-member-open" data-member="${esc(member.user_id)}">Права</button>`:''}</div>`).join('');
  return `<section class="settings-card team-settings-card active"><div class="settings-card-head"><h2>${esc(team.title||'Общая смена')}</h2><span>${esc(roleLabel(teamRole()))}</span></div><p>Очередь синхронизируется между участниками. Открытая форма не перезаписывается входящими изменениями.</p><div class="team-members">${members||'<div class="team-member"><span>Загружаем участников…</span></div>'}</div>${team.invite?`<div class="invite-code"><span>Одноразовый код · ${esc(roleLabel(team.invite.role))}</span><b>${esc(team.invite.code)}</b><button class="secondary-btn" data-action="team-copy-code" data-code="${esc(team.invite.code)}">Копировать</button></div>`:''}<div class="settings-actions">${canManageTeam()?'<button class="primary-btn" data-action="team-invite-open">Пригласить</button>':''}<button class="secondary-btn" data-action="team-refresh">Обновить</button><button class="danger-btn" data-action="team-leave-open">${canManageTeam()?'Закрыть смену':'Покинуть'}</button></div>${team.error?`<p class="cloud-message">${esc(team.error)}</p>`:''}</section>`;
}

function settingsView() {
  const buttonPosition = addButtonPosition();
  const thresholds = waitThresholds();
  return `
    ${cloudSettingsView()}
    ${teamSettingsView()}
    <section class="settings-card">
      <div class="settings-card-head"><h2>Режим смены</h2><span>${workMode()==='solo'?'личная работа':'совместная работа'}</span></div>
      <p>В «Соло» скрываются участники, назначения и командные действия. Переключение не удаляет пациентов и историю.</p>
      ${workModeSelectorView()}
    </section>
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
      <div class="settings-card-head"><h2>Ожидание в оперблоке</h2><span>цвет таймера</span></div>
      <p>Это только напоминание по прошедшему времени, а не оценка состояния пациента или срочности.</p>
      <form id="threshold-form" class="threshold-form">
        <label><span>Жёлтый после, мин</span><input name="warning" type="number" inputmode="numeric" min="1" max="720" value="${thresholds.warningMinutes}" required /></label>
        <label><span>Красный после, мин</span><input name="critical" type="number" inputmode="numeric" min="2" max="1440" value="${thresholds.criticalMinutes}" required /></label>
        <button type="submit" class="secondary-btn" data-action="save-thresholds">Сохранить пороги</button>
      </form>
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
  const missing = patientMissingFields(p);
  return `<article class="patient-card compact-card ${hasTodayOperation(p)?'operation-today':''} ${urgent?'urgent':''}">
    <div class="compact-head">
      <div class="patient-name">${esc(p.surname)} <span class="patient-room">· п.${esc(p.room || '?')}</span></div>
      <div class="badges">${p.departmentId?`<span class="badge department ${isOwnDepartment(p)?'own':''}" title="${esc(departmentLabel(p.departmentId))}">${esc(departmentLabel(p.departmentId))}${isOwnDepartment(p)?' · НАШЕ':''}</span>`:''}${urgent?'<span class="badge urgent">СРОЧНО</span>':''}${p.block?`<span class="badge ${p.block}">${blockLabel(p.block)}</span>`:hasTodayOperation(p)?'<span class="badge operation">ОПЕРАЦИЯ</span>':''}${p.pinned?'<span class="badge warn">СЛЕДУЮЩИЙ</span>':''}</div>
    </div>
    ${teamPatientMetaView(p)}
    <div class="compact-body">
      <div class="compact-copy">
        <div class="current-label">Сейчас</div>
        <div class="compact-title">${esc(compactTitle)}</div>
        ${step ? `<div class="compact-meta"><span>↗ ${esc(p.transport || 'способ уточнить')}</span>${stepTimeLabel(step)?`<span>◷ ${esc(stepTimeLabel(step))}</span>`:''}</div>${patientCareFlags(p).length?`<div class="care-flag-badges compact-care-flags">${patientCareFlags(p).map(item=>`<span title="${esc(item.hint)}">${item.icon} ${esc(item.label)}</span>`).join('')}</div>`:''}${missing.length?`<button class="missing-data" data-action="edit-patient" data-patient="${esc(p.id)}">⚠ Уточнить: ${esc(missing.join(', '))}</button>`:''}` : ''}
        ${doctor?`<div class="compact-doctor"><span>Врач: ${esc(doctor.name)}${doctor.departmentId?` · ${esc(departmentLabel(doctor.departmentId))}`:''}</span>${phoneHref(doctor.phone)?`<a href="${esc(phoneHref(doctor.phone))}" aria-label="Позвонить врачу ${esc(doctor.name)}">☎</a>`:''}</div>`:''}
        ${upcoming.length ? `<div class="compact-next">Далее: ${upcoming.map(s=>`${esc(s.title)}${stepTimeLabel(s)?` · ${esc(stepTimeLabel(s))}`:''}`).join(' → ')}</div>` : ''}
      </div>
      <div class="compact-controls">
        ${operationTimersView(orStep)}
        ${step && canOperateTeam() ? `<button class="primary-btn" data-action="advance" data-patient="${p.id}">${actionLabel(step)}</button>${canContinueNow(p)?`<button class="secondary-btn continue-btn" data-action="advance-next" data-patient="${p.id}">Дальше: ${esc(next.title)}</button>`:''}` : !step && lastTerminal && canOperateTeam() ? `<button class="secondary-btn restore-btn" data-action="restore-step" data-patient="${p.id}" data-step="${lastTerminal.id}" data-source="current">Вернуть в очередь</button>` : ''}
        <div class="compact-tools"><button class="secondary-btn details-btn" data-action="edit-patient" data-patient="${p.id}" aria-label="Редактировать">✎</button><button class="secondary-btn details-btn" data-action="details" data-patient="${p.id}" aria-label="Подробности">•••</button></div>
      </div>
    </div>
  </article>`;
}

function teamPatientMetaView(patient) {
  if(workMode()!=='team') return '';
  const bits=[];
  if(patient.createdBy||patient.createdByName) bits.push(`Добавил: ${actorName(patient.createdBy,patient.createdByName)||'сотрудник'}`);
  if(patient.acceptedBy||patient.acceptedByName) bits.push(`Принял: ${actorName(patient.acceptedBy,patient.acceptedByName)||'сотрудник'}`);
  if(patient.assignedTo||patient.assignedToName) bits.push(`В работе у: ${actorName(patient.assignedTo,patient.assignedToName)||'сотрудник'}`);
  return bits.length?`<div class="team-patient-meta">${bits.map((text,index)=>`<span class="${index===bits.length-1&&patient.assignedTo?'assigned':''}">${esc(text)}</span>`).join('')}</div>`:'';
}

function patientCard(p) {
  const step = currentStep(p);
  const urgent = step?.urgent || p.priority==='urgent';
  const orStep = p.steps.find(s=>['in_or','pickup'].includes(s.state));
  const missing = patientMissingFields(p);
  return `<article class="patient-card ${hasTodayOperation(p)?'operation-today':''} ${urgent?'urgent':''}">
    <div class="patient-top">
      <div class="row between"><div><div class="patient-name">${esc(p.surname)} <span class="patient-room">· п.${esc(p.room||'?')}</span></div></div>
      <div class="badges">${urgent?'<span class="badge urgent">СРОЧНО</span>':''}${p.block?`<span class="badge ${p.block}">${blockLabel(p.block)}</span>`:hasTodayOperation(p)?'<span class="badge operation">ОПЕРАЦИЯ</span>':''}${p.pinned?'<span class="badge warn">СЛЕДУЮЩИЙ</span>':''}</div></div>
    </div>
    <div class="route">${p.steps.map((s,i)=>`<span class="step ${s.state==='done'?'done':s===step?'active':''}"><i>${s.state==='done'?'✓':i+1}</i>${esc(s.title)}</span>`).join('')}</div>
    <div class="current">
      <div class="row between"><div><div class="current-label">${step?'Текущий этап':'Маршрут завершён'}</div><div class="current-title">${step?esc(stepTitle(step)):'Всё выполнено'}</div></div>${operationTimersView(orStep)}</div>
      <div class="meta"><span>↗ ${esc(p.transport||'Способ уточнить')}</span>${stepTimeLabel(step)?`<span>◷ ${esc(stepTimeLabel(step))}</span>`:''}</div>
      ${patientCareFlags(p).length?`<div class="care-flag-badges">${patientCareFlags(p).map(item=>`<span>${item.icon} ${esc(item.label)}</span>`).join('')}</div>`:''}
      ${missing.length?`<button class="missing-data" data-action="edit-patient" data-patient="${esc(p.id)}">⚠ Уточнить: ${esc(missing.join(', '))}</button>`:''}
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
  if(modal.type==='team-create'||modal.type==='team-join') {
    const joining=modal.type==='team-join';
    return `<div class="modal-backdrop" data-action="close"><section class="modal team-modal" onclick="event.stopPropagation()"><h2>${joining?'Подключиться к смене':'Создать общую смену'}</h2><p class="modal-sub">${joining?'Код одноразовый. После подключения очередь появится на этом устройстве.':'Ты станешь владельцем и сможешь приглашать сотрудников по ролям.'}</p><form id="team-shift-form" class="form-grid">${joining?'<div class="field full"><label>Код приглашения</label><input name="code" required maxlength="12" autocomplete="one-time-code" autocapitalize="characters" placeholder="Например, A1B2C3D4"></div>':'<div class="field full"><label>Название смены</label><input name="title" required value="Смена ГХО" placeholder="Смена ГХО"></div>'}<div class="field full"><label>Как тебя показывать коллегам</label><input name="display-name" required value="${esc(team.displayName||'')}" placeholder="Например, Михаил"></div>${modal.error?`<p class="form-error full">${esc(modal.error)}</p>`:''}</form><div class="modal-actions"><button class="secondary-btn" data-action="close">Отмена</button><button class="primary-btn" data-action="${joining?'team-join-submit':'team-create-submit'}">${joining?'Подключиться':'Создать'}</button></div></section></div>`;
  }
  if(modal.type==='team-invite') {
    return `<div class="modal-backdrop" data-action="close"><section class="modal team-modal" onclick="event.stopPropagation()"><h2>Пригласить сотрудника</h2><p class="modal-sub">Код действует 24 часа и срабатывает один раз.</p><div class="role-options"><button data-action="team-invite-create" data-role="orderly"><b>Санитар</b><span>Принимает, выполняет и передаёт пациентов</span></button><button data-action="team-invite-create" data-role="nurse"><b>Медсестра</b><span>Добавляет и уточняет поручения</span></button><button data-action="team-invite-create" data-role="viewer"><b>Просмотр</b><span>Только видит очередь и статусы</span></button></div>${modal.error?`<p class="form-error">${esc(modal.error)}</p>`:''}<div class="modal-actions"><button class="secondary-btn" data-action="close">Закрыть</button></div></section></div>`;
  }
  if(modal.type==='team-member') {
    const member=memberById(modal.member);if(!member)return '';
    return `<div class="modal-backdrop" data-action="close"><section class="modal team-modal" onclick="event.stopPropagation()"><h2>${esc(member.display_name)}</h2><p class="modal-sub">Изменить права или отключить от общей смены.</p><div class="role-options"><button class="${member.role==='orderly'?'active':''}" data-action="team-member-save" data-member="${esc(member.user_id)}" data-role="orderly"><b>Санитар</b><span>Полная работа с очередью</span></button><button class="${member.role==='nurse'?'active':''}" data-action="team-member-save" data-member="${esc(member.user_id)}" data-role="nurse"><b>Медсестра</b><span>Добавление и уточнение</span></button><button class="${member.role==='viewer'?'active':''}" data-action="team-member-save" data-member="${esc(member.user_id)}" data-role="viewer"><b>Просмотр</b><span>Без изменений</span></button></div><button class="danger-btn full-btn" data-action="team-member-remove" data-member="${esc(member.user_id)}">Отключить от смены</button><div class="modal-actions"><button class="secondary-btn" data-action="close">Закрыть</button></div></section></div>`;
  }
  if(modal.type==='team-leave') {
    const closing=teamRole()==='owner';
    return `<div class="modal-backdrop" data-action="close"><section class="modal confirm-modal" onclick="event.stopPropagation()"><h2>${closing?'Закрыть общую смену?':'Покинуть общую смену?'}</h2><p class="modal-sub">${closing?'Доступ закроется у всех участников. Локальная копия останется на этом устройстве.':'Локальная копия останется на устройстве. Для повторного входа понадобится новый код.'}</p><div class="modal-actions"><button class="secondary-btn" data-action="close">Остаться</button><button class="danger-btn" data-action="team-leave-confirm">${closing?'Закрыть':'Покинуть'}</button></div></section></div>`;
  }
  if(modal.type==='team-handoff') {
    const patient=state.patients.find(item=>item.id===modal.patient);
    const workers=team.members.filter(member=>['owner','orderly'].includes(member.role)&&member.user_id!==cloud.session?.user?.id);
    if(!patient)return '';
    return `<div class="modal-backdrop" data-action="close"><section class="modal team-modal" onclick="event.stopPropagation()"><h2>Передать пациента</h2><p class="modal-sub">${esc(patient.surname)} · текущий этап продолжится, но ответственным станет выбранный сотрудник.</p><div class="role-options">${workers.map(member=>`<button data-action="team-handoff-confirm" data-patient="${esc(patient.id)}" data-member="${esc(member.user_id)}"><b>${esc(member.display_name)}</b><span>${esc(roleLabel(member.role))}</span></button>`).join('')||'<p class="empty compact-empty">Других санитаров в смене пока нет</p>'}</div><div class="modal-actions"><button class="secondary-btn" data-action="close">Отмена</button></div></section></div>`;
  }
  if (modal.type === 'more-menu') {
    const activeMode=Boolean(state.settings.travelMode);
    return `<div class="modal-backdrop" data-action="close"><section class="modal more-menu" onclick="event.stopPropagation()">
      <div class="more-menu-head"><div><h2>Ещё</h2><p class="modal-sub">Разделы и режим отображения</p></div><button class="secondary-btn more-close" data-action="close" aria-label="Закрыть">×</button></div>
      <div class="more-mode-block"><span>Смена</span>${workModeSelectorView(true)}</div>
      <button class="travel-mode-toggle ${activeMode?'active':''}" data-action="toggle-travel-mode"><span><b>${activeMode?'Режим в пути включён':'Режим в пути'}</b><small>${activeMode?'Крупные действия и минимум второстепенного':'Увеличить главные кнопки и убрать визуальный шум'}</small></span><i>${activeMode?'Вкл':'Выкл'}</i></button>
      <div class="more-links">
        <button data-view="contacts"><b>☎</b><span><strong>Контакты</strong><small>Врачи, посты и отделения</small></span></button>
        <button data-view="history"><b>↶</b><span><strong>История</strong><small>Завершённые смены и маршруты</small></span></button>
        <button data-view="settings"><b>⚙</b><span><strong>Настройки</strong><small>Данные, синхронизация и справочники</small></span></button>
      </div>
    </section></div>`;
  }
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
      <div class="detail-block"><div class="current-label">Маршрут на сегодня</div><div class="route-detail">${p.steps.map((s,i)=>`<div class="route-detail-item ${s.state==='done'?'done':s===currentStep(p)?'active':''}"><span>${s.state==='done'?'✓':i+1}</span><b>${esc(s.title)}${stepTimeLabel(s)?` <small>· ${esc(stepTimeLabel(s))}</small>`:''}</b></div>`).join('')}</div></div>
      <div class="detail-grid"><div><span>Отделение</span><b>${esc(departmentLabel(p.departmentId))}${isOwnDepartment(p)?' · наше':''}</b></div><div><span>Врач</span><b>${esc(patientDoctor(p)?.name||'Не указан')}</b></div><div><span>Передвижение</span><b>${esc(p.transport || 'Не указано')}</b></div><div><span>Приоритет</span><b>${p.priority==='urgent'?'Срочный':hasTodayOperation(p)?'Операция сегодня':'Обычный'}</b></div></div>
      ${patientCareFlags(p).length?`<div class="care-flag-badges">${patientCareFlags(p).map(item=>`<span>${item.icon} ${esc(item.label)}</span>`).join('')}</div>`:''}
      ${p.note?`<div class="note">${esc(p.note)}</div>`:''}
      <div class="patient-list detail-actions">
        <button class="secondary-btn" data-action="edit-patient" data-patient="${p.id}">Редактировать данные</button>
        <button class="primary-btn" data-action="edit-route" data-patient="${p.id}">Изменить цепочку</button>
        ${['in_progress','in_or','pickup'].includes(currentStep(p)?.state)?`<button class="secondary-btn" data-action="rollback-status" data-patient="${p.id}">↶ Вернуть предыдущий статус</button>`:''}
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
        ${hasTodayOperation(p)?`<div class="field operation-field"><label>Оперблок</label><select name="block">
          <option value="" ${!p.block?'selected':''}>Не указан</option><option value="op" ${p.block==='op'?'selected':''}>Оперблок (ОПРБЛК)</option><option value="angio" ${p.block==='angio'?'selected':''}>Ангиоблок (АНГБЛК)</option>
        </select></div>`:''}
        ${timeChoice('time',editedStep,'Время текущего этапа')}
        <label class="urgent-toggle full"><input type="checkbox" name="urgent" ${urgent?'checked':''} /><span><b>Срочно</b><small>Поднять пациента наверх очереди</small></span></label>
        <div class="field full">${careFlagsView(p.careFlags)}</div>
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
      <div class="route-editor">${modal.steps.map((s,i)=>{const editable=canEditRouteStep(s);const movable=s.state==='waiting';const canUp=movable&&i>0&&modal.steps[i-1].state==='waiting';const canDown=movable&&i<modal.steps.length-1&&modal.steps[i+1].state==='waiting';const hint=!editable?'Выполняемый или завершённый этап защищён':!movable?'Текущий этап можно изменить, но нельзя переставить':'Можно изменить, переставить или удалить';return `<div class="route-editor-item ${editable?'':'locked'}"><span class="route-index">${i+1}</span><div class="route-item-copy"><select class="route-type-select" data-route-type="${i}" aria-label="Направление этапа ${i+1}" ${editable?'':'disabled'}>${directionOptions(s.type,true)}</select><input class="route-title-input" data-route-title="${i}" value="${esc(s.title)}" aria-label="Название этапа ${i+1}" ${editable?'':'disabled'} /><div class="route-time-control"><input class="route-time-input" type="time" step="300" data-route-time="${i}" value="${esc(s.time || '')}" aria-label="Время этапа ${i+1}" ${!editable||s.timeFlexible?'disabled':''} /><label><input type="checkbox" data-route-time-none="${i}" ${s.timeFlexible?'checked':''} ${editable?'':'disabled'} />без времени</label></div><small>${hint}</small></div><div class="route-tools"><button data-action="route-up" data-index="${i}" ${canUp?'':'disabled'}>↑</button><button data-action="route-down" data-index="${i}" ${canDown?'':'disabled'}>↓</button><button data-action="route-delete" data-index="${i}" ${movable?'':'disabled'}>×</button></div></div>`;}).join('')}</div>
      <div class="route-add"><select id="route-type">${directionOptions('', true)}</select><input id="route-custom" placeholder="Своё название" /><div class="route-time-control"><input id="route-time" type="time" step="300" aria-label="Время нового этапа" /><label><input id="route-time-none" type="checkbox" />без времени</label></div><button class="secondary-btn" data-action="route-add">＋ Добавить</button></div>
      <div class="modal-actions"><button class="secondary-btn" data-action="details" data-patient="${modal.patient}">Назад</button><button class="primary-btn" data-action="route-save" data-patient="${modal.patient}">Сохранить цепочку</button></div>
    </section></div>`;
  }
  if (modal.type === 'quick') {
    return `<div class="modal-backdrop" data-action="close"><section class="modal quick-modal" onclick="event.stopPropagation()">
      <h2>Быстрая запись</h2><p class="modal-sub">Сейчас — только главное. Маршрут можно дополнить позже.</p>
      <form id="quick-form" class="quick-form">
        ${entryTargetChoice(modal.target)}
        <div class="field"><label>Фамилия</label><input required name="surname" placeholder="Иванов" autofocus /></div>
        <div class="field"><label>Палата</label><input name="room" placeholder="Можно позже" /></div>
        <div class="field"><label>Отделение</label><select name="department">${departmentOptions(ownDepartmentId())}</select></div>
        <div class="field"><label>Врач</label><select name="doctor">${doctorOptions()}</select></div>
        <div class="field"><label>Что сейчас</label><select name="type">${directionOptions('', true)}</select></div>
        <div class="field"><label>Уточнение</label><input name="title" placeholder="Например, ХО или срочное КТ" /></div>
        ${timeChoice('time',{},'Время')}
        <div class="field operation-field" data-operation-field hidden><label>Оперблок</label><select name="block"><option value="">Не указан</option><option value="op">Оперблок (ОПРБЛК)</option><option value="angio">Ангиоблок (АНГБЛК)</option></select></div>
        <label class="urgent-toggle"><input type="checkbox" name="urgent" /><span><b>Срочно</b><small>Поднять поручение наверх</small></span></label>
        <div class="field full">${careFlagsView()}</div>
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
        ${entryTargetChoice(modal.target)}
        <div class="field"><label>Фамилия / условное имя</label><input required name="surname" placeholder="Например, Иванов" autofocus /></div>
        <div class="field"><label>Палата</label><input name="room" placeholder="Можно уточнить позже" /></div>
        <div class="field"><label>Отделение</label><select name="department">${departmentOptions(ownDepartmentId())}</select></div>
        <div class="field"><label>Врач</label><select name="doctor">${doctorOptions()}</select></div>
        <div class="field"><label>Врач вручную</label><input name="doctor-name" placeholder="Если врача нет в контактах" /></div>
        <div class="field"><label>Ближайшее действие</label><select name="type">${directionOptions('', true)}</select></div>
        <div class="field"><label>Куда везти</label><input required name="destination" placeholder="ХО, КТ, кабинет…" /></div>
        ${timeChoice('time',{},'Время ближайшего действия')}
        <div class="field"><label>Способ передвижения</label><select name="transport"><option value="">Уточнить позже</option><option>Пешком с сопровождением</option><option>Кресло</option><option>Каталка</option></select></div>
        <div class="field operation-field" data-operation-field hidden><label>Оперблок</label><select name="block"><option value="">Не указан</option><option value="op">Оперблок (ОПРБЛК)</option><option value="angio">Ангиоблок (АНГБЛК)</option></select></div>
        <div class="field full"><label>Что ещё предстоит сегодня</label><div class="direction-checks">${getDirections().map(item=>`<label><input type="checkbox" name="extra-direction" value="${esc(item.id)}" /> ${esc(item.label)}</label>`).join('')}</div></div>
        <div class="field full">${careFlagsView()}</div>
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
  if (modal.type === 'confirm-transition') {
    const p=state.patients.find(x=>x.id===modal.patient), s=p&&currentStep(p);
    if(!p||!s)return '';
    const arrived=modal.transition==='arrived';
    return `<div class="modal-backdrop" data-action="close"><section class="modal confirm-modal" onclick="event.stopPropagation()">
      <h2>${arrived?'Пациент доставлен?':'Поступил вызов забирать?'}</h2>
      <p class="modal-sub">${esc(p.surname)} · п.${esc(p.room||'?')}. ${arrived?'После подтверждения запустится таймер пребывания в оперблоке.':'Статус изменится на «Забирать из оперблока».'}</p>
      <div class="modal-actions"><button class="secondary-btn" data-action="close">Нет, назад</button><button class="primary-btn" data-action="confirm-transition">Да, подтвердить</button></div>
    </section></div>`;
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
  document.querySelectorAll('[data-view]').forEach(el=>el.onclick=()=>{view=el.dataset.view;modal=null;searchOpen=false;render();});
  document.querySelectorAll('[data-direction]').forEach(el=>el.onclick=()=>{direction=el.dataset.direction; render(true);});
  document.querySelectorAll('[data-scroll-direction]').forEach(el=>el.onclick=()=>{
    const group=document.querySelector(`[data-direction-group="${CSS.escape(el.dataset.scrollDirection)}"]`);
    if(!group)return;
    group.open=true;
    group.scrollIntoView({behavior:'smooth',block:'start'});
  });
  document.querySelectorAll('select[data-department-filter]').forEach(el=>el.onchange=()=>{departmentFilter=el.value; render(true);});
  document.querySelectorAll('[data-contact-department]').forEach(el=>el.onclick=()=>{contactDepartmentFilter=el.dataset.contactDepartment; render(true);});
  document.querySelectorAll('[data-contact-role]').forEach(el=>el.onclick=()=>{contactRoleFilter=el.dataset.contactRole; render(true);});
  const patientSearchInput=document.getElementById('patient-search');
  if(patientSearchInput) bindSearchInput(patientSearchInput,'patient');
  const contactSearchInput=document.getElementById('contact-search');
  if(contactSearchInput) bindSearchInput(contactSearchInput,'contact');
  document.querySelectorAll('[data-sort-mode]').forEach(el=>el.onchange=()=>{ state.settings.sortMode=SORT_MODES.includes(el.value)?el.value:'priority'; save(); render(true); });
  document.querySelectorAll('[data-route-title]').forEach(el=>el.oninput=()=>{ if(modal?.type==='route' && modal.steps[Number(el.dataset.routeTitle)]) modal.steps[Number(el.dataset.routeTitle)].title=el.value; });
  document.querySelectorAll('[data-route-time]').forEach(el=>el.oninput=()=>{ if(modal?.type==='route' && modal.steps[Number(el.dataset.routeTime)]) modal.steps[Number(el.dataset.routeTime)].time=el.value; });
  document.querySelectorAll('[data-route-time-none]').forEach(el=>el.onchange=()=>{const index=Number(el.dataset.routeTimeNone),step=modal?.type==='route'?modal.steps[index]:null,input=document.querySelector(`[data-route-time="${index}"]`);if(step){step.timeFlexible=el.checked;if(el.checked)step.time='';}if(input){input.disabled=el.checked;input.value=el.checked?'':step?.time||'';}});
  document.querySelectorAll('[data-route-type]').forEach(el=>el.onchange=()=>{ const index=Number(el.dataset.routeType),step=modal?.type==='route'?modal.steps[index]:null;if(changeRouteStepType(step,el.value)){const title=document.querySelector(`[data-route-title="${index}"]`);if(title)title.value=step.title;} });
  document.querySelectorAll('[data-time-none]').forEach(el=>{const update=()=>{const input=document.querySelector(`[data-time-input="${el.dataset.timeNone}"]`);if(input){input.disabled=el.checked;if(el.checked)input.value='';}};el.onchange=update;update();});
  document.querySelectorAll('[data-time-now]').forEach(el=>el.onclick=()=>{const name=el.dataset.timeNow,input=document.querySelector(`[data-time-input="${name}"]`),none=document.querySelector(`[data-time-none="${name}"]`);if(!input)return;if(none)none.checked=false;input.disabled=false;const now=new Date();input.value=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;});
  document.querySelectorAll('#quick-form,#patient-form').forEach(form=>{const update=()=>refreshOperationField(form);form.querySelectorAll('[name="type"],[name="extra-direction"]').forEach(el=>el.onchange=update);update();});
  const routeTimeNone=document.getElementById('route-time-none');
  if(routeTimeNone)routeTimeNone.onchange=()=>{const input=document.getElementById('route-time');if(input){input.disabled=routeTimeNone.checked;if(routeTimeNone.checked)input.value='';}};
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
  const thresholdForm=document.getElementById('threshold-form');
  if(thresholdForm) thresholdForm.onsubmit=(e)=>{e.preventDefault();handleAction('save-thresholds',thresholdForm.querySelector('[data-action="save-thresholds"]'),e);};
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
function refreshOperationField(form) {
  const field=form?.querySelector('[data-operation-field]');if(!field)return;
  const operation=hasOperationSelection(form);field.hidden=!operation;
  if(!operation){const select=field.querySelector('[name="block"]');if(select)select.value='';}
}
function bindSearchInput(input, kind) {
  input.oninput=()=>liveFilterSearch(input,kind);
  input.onchange=()=>setTimeout(()=>{if(document.getElementById(input.id))render(true);},0);
  input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();input.blur();}};
  requestAnimationFrame(()=>{if(searchOpen&&document.activeElement!==input){input.focus();const end=input.value.length;input.setSelectionRange?.(end,end);}});
}
function liveFilterSearch(input, kind) {
  const value=input.value;
  if(kind==='contact')contactSearch=value; else patientSearch=value;
  const query=value.trim().toLocaleLowerCase('ru');
  const selector=kind==='contact'?'.contact-card':'.patient-card';
  document.querySelectorAll(selector).forEach(card=>{card.hidden=Boolean(query)&&!card.textContent.toLocaleLowerCase('ru').includes(query);});
}
function armUndo(label) {
  undoEntry={state:clone(state),label};
  if(undoTimer)clearTimeout(undoTimer);
  undoTimer=setTimeout(()=>{undoEntry=null;undoTimer=null;if(document.getElementById('app')&&!modal)render(true);},UNDO_TIMEOUT);
}
function clearUndo() { if(undoTimer)clearTimeout(undoTimer);undoTimer=null;undoEntry=null; }
function log(p,text) {
  const actor=currentActor(), at=Date.now();
  p.events ||= []; p.events.push({id:uid(),at,text,by:actor.id,byName:actor.name});
  p.updatedAt=at; p.updatedBy=actor.id;
}
function markPatientCreated(patient) {
  const actor=currentActor();
  patient.createdBy=actor.id; patient.createdByName=actor.name; patient.updatedBy=actor.id; patient.updatedAt=Date.now();
  return patient;
}
function assignPatient(patient,userId=cloud.session?.user?.id) {
  const member=memberById(userId), actor=currentActor();
  patient.assignedTo=userId||actor.id; patient.assignedToName=member?.display_name||(userId===actor.id?actor.name:'Сотрудник');
  patient.updatedAt=Date.now();patient.updatedBy=actor.id;
  return patient;
}
function nextWaitingStep(p) { return p.steps.find(s=>s.state==='waiting'); }
function activateNext(p) { const next=nextWaitingStep(p); if(next) next.state='active'; return next; }
function canContinueNow(p) { const step=currentStep(p); return step?.state==='in_progress' && !isOperationStep(step) && Boolean(nextWaitingStep(p)); }
function completeCurrentStep(p, startNext=false, at=Date.now()) {
  const step=currentStep(p);
  if(!step) return {step:null,next:null};
  step.state='done'; step.finishedAt=at;
  const next=activateNext(p);
  if(startNext && next) { next.state='in_progress'; next.startedAt ||= at; }
  if(!startNext) { p.assignedTo=''; p.assignedToName=''; queueTeamRelease(p.id); }
  return {step,next};
}
function stopCurrentStep(p, action, at=Date.now()) {
  const step=currentStep(p);
  if(!step || !['cancel-step','postpone-step'].includes(action)) return null;
  step.state=action==='postpone-step'?'postponed':'cancelled';
  step.finishedAt=at;
  p.assignedTo=''; p.assignedToName=''; queueTeamRelease(p.id);
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
  const writeActions=new Set(['submit-quick','submit-patient','contact-save','contact-delete','department-save','direction-save','route-save','save-patient','confirm-import-backup','confirm-reset','confirm-new-shift']);
  const operateActions=new Set(['accept-incoming','reject-incoming','advance','advance-next','confirm-documents','confirm-transition','finish-operation','cancel-step','postpone-step','restore-step','restore-history-step','pin','confirm-delete-patient','team-handoff-confirm']);
  if(activeTeamShift()&&writeActions.has(action)&&!canEditTeam()) { cloud.message='У этой роли нет права изменять смену'; return render(true); }
  if(activeTeamShift()&&operateActions.has(action)&&!canOperateTeam()) { cloud.message='Только санитар или владелец может менять ход выполнения'; return render(true); }
  if (action==='undo-last') {
    if(!undoEntry)return;
    const snapshot=undoEntry.state; clearUndo(); state=normalizeState(clone(snapshot)); modal=null; save(); return render(true);
  }
  if (action==='add') { modal={type:'quick',target:workMode()==='team'||view==='inbox'?'inbox':'queue'}; return render(true); }
  if (action==='open-more') { modal={type:'more-menu'}; return render(true); }
  if (action==='search-toggle') { searchOpen=!searchOpen; return render(true); }
  if (action==='search-close') {
    searchOpen=false;
    if(searchKindForView()==='contact')contactSearch='';else patientSearch='';
    return render(true);
  }
  if (action==='directions-home') { document.querySelector('.section-topbar')?.scrollIntoView({behavior:'smooth',block:'start'}); return; }
  if (action==='set-work-mode') {
    if(activeTeamShift()&&el.dataset.mode!=='team') { cloud.message='Сначала покинь общую смену в настройках'; view='settings'; modal=null; return render(true); }
    state.settings.workMode=el.dataset.mode==='team'?'team':'solo';
    save();
    if(modal?.type==='more-menu') modal={type:'more-menu'};
    return render(true);
  }
  if(action==='team-create-open'){modal={type:'team-create',error:''};return render(true);}
  if(action==='team-join-open'){modal={type:'team-join',error:''};return render(true);}
  if(action==='team-create-submit'||action==='team-join-submit'){
    const form=document.getElementById('team-shift-form');if(!form?.reportValidity())return;
    const fd=new FormData(form), displayName=String(fd.get('display-name')||'').trim();modal.error='';team.loading=true;
    try {
      if(action==='team-create-submit') await createTeamShift(String(fd.get('title')||'').trim(),displayName);
      else await joinTeamShift(String(fd.get('code')||'').trim(),displayName);
      modal=null;view='today';cloud.message='Общая смена подключена';return render();
    } catch(error){modal.error=error.message||'Не удалось подключить общую смену';team.loading=false;return render();}
  }
  if(action==='team-invite-open'){modal={type:'team-invite',error:''};return render(true);}
  if(action==='team-invite-create'){
    try{await createTeamInvite(el.dataset.role);modal=null;view='settings';return render(true);}
    catch(error){modal.error=error.message||'Не удалось создать код';return render();}
  }
  if(action==='team-copy-code'){
    try{await navigator.clipboard.writeText(el.dataset.code||'');cloud.message='Код скопирован';}catch{cloud.message=`Код: ${el.dataset.code||''}`;}
    return render(true);
  }
  if(action==='team-refresh'){await fetchTeamMembers();await syncSharedShift();return render(true);}
  if(action==='team-leave-open'){modal={type:'team-leave'};return render(true);}
  if(action==='team-leave-confirm'){
    try{await leaveTeamShift();modal=null;view='settings';cloud.message='Ты вышел из общей смены';return render();}
    catch(error){modal=null;team.error=error.message||'Не удалось выйти';view='settings';return render();}
  }
  if(action==='team-member-open'){modal={type:'team-member',member:el.dataset.member};return render(true);}
  if(action==='team-member-save'){
    try{await cloudRequest(`/rest/v1/medflow_shift_members?shift_id=eq.${encodeURIComponent(team.shiftId)}&user_id=eq.${encodeURIComponent(el.dataset.member)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({role:el.dataset.role})});await fetchTeamMembers();modal=null;return render(true);}
    catch(error){team.error=error.message||'Не удалось изменить права';modal=null;return render(true);}
  }
  if(action==='team-member-remove'){
    try{await cloudRequest(`/rest/v1/medflow_shift_members?shift_id=eq.${encodeURIComponent(team.shiftId)}&user_id=eq.${encodeURIComponent(el.dataset.member)}`,{method:'DELETE'});await fetchTeamMembers();modal=null;return render(true);}
    catch(error){team.error=error.message||'Не удалось отключить участника';modal=null;return render(true);}
  }
  if(action==='team-handoff-confirm'){
    const patient=state.patients.find(item=>item.id===el.dataset.patient),member=memberById(el.dataset.member);if(!patient||!member)return;
    try {
      const result=await teamRpc('medflow_transfer_patient',{target_shift:team.shiftId,target_patient:patient.id,next_user:member.user_id});
      if(!result?.ok) throw new Error('Передача не подтверждена');
      assignPatient(patient,member.user_id);log(patient,`Передано сотруднику: ${member.display_name}`);modal=null;save();return render(true);
    } catch(error){cloud.message=error.message||'Не удалось передать пациента';modal=null;return render(true);}
  }
  if (action==='toggle-travel-mode') { state.settings.travelMode=!state.settings.travelMode; save(); modal={type:'more-menu'}; return render(true); }
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
    armUndo(`Контакт «${contact.name}» удалён`);
    const preserve=patient=>{ if(patient.doctorId===contact.id){ patient.doctorId='external'; patient.doctorName=patient.doctorName||contact.name; } };
    state.patients.forEach(preserve); state.archive.forEach(shift=>(shift.patients||[]).forEach(preserve));
    state.contacts=state.contacts.filter(item=>item.id!==contact.id); modal=null; save(); return render(true);
  }
  if (action==='close') {
    modal=null; render(true);
    if(cloud.session) setTimeout(()=>syncCloudState(),0);
    return;
  }
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
  if (action==='save-thresholds') {
    e?.preventDefault();
    const form=document.getElementById('threshold-form'); if(!form?.reportValidity())return;
    const fd=new FormData(form), warning=Math.round(Number(fd.get('warning'))), critical=Math.round(Number(fd.get('critical')));
    if(!Number.isFinite(warning)||!Number.isFinite(critical)||warning<1||critical<=warning){cloud.message='Красный порог должен быть больше жёлтого';return render(true);}
    state.settings.waitThresholds={warningMinutes:warning,criticalMinutes:critical};cloud.message='Пороги ожидания сохранены';save();return render(true);
  }
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
    if(departmentFilter!=='all' && departmentFilter!=='none' && !validIds.has(departmentFilter)) departmentFilter=ownDepartmentId();
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
  if (action==='rollback-status') {
    const p=state.patients.find(item=>item.id===el.dataset.patient), s=p&&currentStep(p); if(!p||!s)return;
    armUndo('Статус возвращён назад');
    if(s.state==='pickup') { s.state='in_or'; delete s.readyAt; delete s.pickedUpAt; log(p,'Отменена отметка «Позвонили — забирать»'); }
    else if(s.state==='in_or') { s.state='in_progress'; delete s.arrivedAt; log(p,'Отменена отметка доставки в оперблок'); }
    else if(s.state==='in_progress') { s.state='active'; delete s.startedAt; delete s.preopCheck; if(s.documents) delete s.documents.start; log(p,'Отменено начало сопровождения'); }
    modal={type:'details',patient:p.id}; save(); return render(true);
  }
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
    const fd=new FormData(form), p=state.patients.find(p=>p.id===el.dataset.patient), step=currentStep(p), timeChoiceValue=readTimeChoice(fd);
    p.surname=fd.get('surname').trim(); p.room=fd.get('room').trim(); p.departmentId=String(fd.get('department')||''); p.doctorId=String(fd.get('doctor')||''); p.doctorName=p.doctorId&&p.doctorId!=='external'?(getContacts().find(item=>item.id===p.doctorId)?.name||String(fd.get('doctor-name')||'').trim()):String(fd.get('doctor-name')||'').trim(); p.transport=fd.get('transport'); p.block=hasTodayOperation(p)?String(fd.get('block')||''):''; p.note=fd.get('note').trim(); p.careFlags=fd.getAll('care-flag').map(String);
    const urgent=fd.get('urgent')==='on';
    if(step) { step.urgent=urgent; step.time=timeChoiceValue.time; step.timeFlexible=timeChoiceValue.timeFlexible; step.needsClarification=!p.room||!p.transport; }
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
    const timeFlexible=Boolean(document.getElementById('route-time-none')?.checked);
    const time=timeFlexible?'':normalizeTimeInput(document.getElementById('route-time').value);
    modal.steps.push({id:uid(),type,title:custom||typeLabel(type),time,timeFlexible,state:'waiting'});
    return render(true);
  }
  if (action==='route-save') {
    const p=state.patients.find(p=>p.id===el.dataset.patient);
    p.steps=modal.steps.map(step=>({...step,time:step.timeFlexible?'':normalizeTimeInput(step.time),timeFlexible:Boolean(step.timeFlexible)}));
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
    if(['finish','continue','handoff','stop'].includes(mode)) armUndo(mode==='stop'?(stopAction==='postpone-step'?'Этап перенесён':'Этап отменён'):mode==='handoff'?'Этап передан другому сотруднику':'Этап завершён');
    p.pinned=false;
    if (mode==='start') {
      if(isOperationStep(s)) s.preopCheck={at:now,dentures:true,jewelry:true,belongings:true};
      setStepDocument(s,'start',startStatus,now); s.state='in_progress'; s.startedAt ||= now;
      assignPatient(p);
      log(p,`Начато сопровождение: ${s.title}`); modal=null;
    } else if (mode==='finish') {
      setStepDocument(s,'finish',finishStatus,now);
      const finished=completeCurrentStep(p,false,now); log(p,`Выполнено: ${finished.step.title}`); modal=null;
    } else if (mode==='continue') {
      const next=nextWaitingStep(p); if(!next)return;
      setStepDocument(s,'finish',finishStatus,now);
      const moved=completeCurrentStep(p,true,now);
      setStepDocument(moved.next,'start',startStatus,now);
      assignPatient(p);
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
    if(activeTeamShift()&&!p.assignedTo) {
      try {
        const claim=await teamRpc('medflow_claim_patient',{target_shift:team.shiftId,target_patient:p.id});
        if(!claim?.ok){cloud.message=`Пациент уже в работе у: ${claim?.display_name||'другого сотрудника'}`;await syncSharedShift({preferRemote:true});return render(true);}
        assignPatient(p); log(p,'Взят в работу'); save();
      } catch(error){cloud.message=error.message||'Не удалось взять пациента в работу';return render(true);}
    } else if(activeTeamShift()&&p.assignedTo&&p.assignedTo!==cloud.session?.user?.id) {
      cloud.message=`Пациент в работе у: ${actorName(p.assignedTo,p.assignedToName)||'другого сотрудника'}`;return render(true);
    }
    p.pinned=false;
    if (isOperationStep(s) && ['active','waiting'].includes(s.state)) { modal={type:'documents',mode:'start',patient:p.id}; return render(); }
    if (isOperationStep(s) && s.state==='in_progress') { modal={type:'confirm-transition',transition:'arrived',patient:p.id}; return render(); }
    else if (s.state==='in_or') { modal={type:'confirm-transition',transition:'called',patient:p.id}; return render(); }
    else if (s.state==='pickup') { modal=s.pickedUpAt?{type:'destination',patient:p.id}:{type:'documents',mode:'operation-pickup',patient:p.id}; return render(); }
    else if (s.state==='in_progress') { modal={type:'documents',mode:'finish',patient:p.id}; return render(); }
    else { modal={type:'documents',mode:'start',patient:p.id}; return render(); }
    save(); return render();
  }
  if (action==='confirm-transition') {
    const p=state.patients.find(item=>item.id===modal?.patient), s=p&&currentStep(p); if(!p||!s)return;
    const transition=modal.transition;
    if(transition==='arrived'&&s.state==='in_progress') {
      armUndo('Пациент отмечен в оперблоке'); s.state='in_or'; s.arrivedAt=Date.now(); log(p,'Доставлен в оперблок, таймер запущен');
    } else if(transition==='called'&&s.state==='in_or') {
      armUndo('Отмечен вызов забирать'); s.state='pickup'; s.readyAt=Date.now(); log(p,'Поступил вызов: пациента нужно забрать');
    } else { modal=null; return render(true); }
    modal=null; save(); return render(true);
  }
  if (action==='advance-next') {
    const p=state.patients.find(p=>p.id===el.dataset.patient), s=currentStep(p);
    if(!p || !s || s.state!=='in_progress' || !nextWaitingStep(p)) return;
    modal={type:'documents',mode:'continue',patient:p.id}; return render();
  }
  if (action==='finish-operation') {
    const p=state.patients.find(p=>p.id===el.dataset.patient), s=p&&currentStep(p); if(!p||!s)return;
    const continueNow=Boolean(document.getElementById('continue-after-operation')?.checked);
    armUndo('Перевозка после операции завершена');
    const now=Date.now(); s.destination=el.dataset.destination;
    const finished=completeCurrentStep(p,false,now);
    log(p,`Доставлен после оперблока: ${el.dataset.destination}`);
    modal=continueNow&&finished.next?{type:'documents',mode:'start',patient:p.id}:null;
    save(); return render();
  }
  if (action==='submit-quick') {
    const form=document.getElementById('quick-form'); if(!form.reportValidity()) return;
    const fd=new FormData(form), type=fd.get('type'), urgent=fd.get('urgent')==='on', chosenTime=readTimeChoice(fd);
    const title=fd.get('title').trim() || typeLabel(type);
    const doctorId=String(fd.get('doctor')||''), doctorName=doctorId&&doctorId!=='external'?(getContacts().find(item=>item.id===doctorId)?.name||''):String(fd.get('doctor-name')||'').trim();
    const p={id:uid(),surname:fd.get('surname').trim(),room:fd.get('room').trim(),departmentId:String(fd.get('department')||''),doctorId,doctorName,block:type==='operation'?String(fd.get('block')||''):'',transport:'',priority:'normal',pinned:false,careFlags:fd.getAll('care-flag').map(String),steps:[{id:uid(),type,title,time:chosenTime.time,timeFlexible:chosenTime.timeFlexible,state:'active',urgent,needsClarification:!fd.get('room')}],note:'',events:[]};
    markPatientCreated(p); syncPatientPriority(p,urgent);
    const target=workMode()==='team'||fd.get('entry-target')==='inbox'?'inbox':'queue';
    log(p,urgent?'Добавлено срочное поручение':'Создана быстрая запись');
    if(target==='inbox') { p.inboxStatus='pending'; p.inboxCreatedAt=Date.now(); state.incoming.push(p); view='inbox'; }
    else state.patients.push(p);
    modal=null; save(); return render();
  }
  if (action==='submit-patient') {
    const form=document.getElementById('patient-form'); if(!form.reportValidity()) return;
    const fd=new FormData(form), type=fd.get('type'), urgent=fd.get('urgent')==='1', chosenTime=readTimeChoice(fd);
    let types=fd.getAll('extra-direction').map(String); if(!types.includes(type))types.unshift(type);
    types=[...new Set(types)];
    const steps=types.map((t,i)=>({id:uid(),type:t,title:t===type?fd.get('destination'):typeLabel(t),time:i===0?chosenTime.time:'',timeFlexible:i===0?chosenTime.timeFlexible:false,state:i===0?'active':'waiting',urgent:urgent&&i===0,needsClarification:!fd.get('room')||!fd.get('transport')}));
    const doctorId=String(fd.get('doctor')||''), doctorName=doctorId&&doctorId!=='external'?(getContacts().find(item=>item.id===doctorId)?.name||''):String(fd.get('doctor-name')||'').trim();
    const p={id:uid(),surname:fd.get('surname'),room:fd.get('room'),departmentId:String(fd.get('department')||''),doctorId,doctorName,block:types.includes('operation')?String(fd.get('block')||''):'',transport:fd.get('transport'),priority:'normal',pinned:false,careFlags:fd.getAll('care-flag').map(String),steps,note:fd.get('note'),events:[]};
    markPatientCreated(p); syncPatientPriority(p,urgent);
    const target=workMode()==='team'||fd.get('entry-target')==='inbox'?'inbox':'queue';
    log(p,urgent?'Добавлено срочное поручение':'Создан маршрут на сегодня');
    if(target==='inbox') { p.inboxStatus='pending'; p.inboxCreatedAt=Date.now(); state.incoming.push(p); view='inbox'; }
    else state.patients.push(p);
    modal=null; save(); return render();
  }
  if (action==='accept-incoming' || action==='reject-incoming') {
    const patient=state.incoming.find(item=>item.id===el.dataset.patient); if(!patient)return;
    if(action==='accept-incoming'&&activeTeamShift()) {
      try {
        const claim=await teamRpc('medflow_claim_patient',{target_shift:team.shiftId,target_patient:patient.id});
        if(!claim?.ok) { cloud.message=`Уже принял: ${claim?.display_name||'другой сотрудник'}`; await syncSharedShift({preferRemote:true}); return render(true); }
      } catch(error) { cloud.message=error.message||'Не удалось принять поручение'; return render(true); }
    }
    armUndo(action==='accept-incoming'?'Поручение принято в очередь':'Поручение отклонено');
    const now=Date.now();
    if(action==='accept-incoming') {
      patient.inboxStatus='accepted'; patient.inboxResolvedAt=now;
      const accepted=clone(patient); delete accepted.inboxStatus; delete accepted.inboxCreatedAt; delete accepted.inboxResolvedAt;
      const actor=currentActor(); accepted.acceptedBy=actor.id; accepted.acceptedByName=actor.name; accepted.updatedAt=now; accepted.updatedBy=actor.id;
      log(accepted,'Принято из раздела «Новое»'); state.patients.push(accepted);
    } else { patient.inboxStatus='rejected'; patient.inboxResolvedAt=now; log(patient,'Отклонено во входящих'); }
    save(); return render(true);
  }
  if (action==='handoff') {
    if(activeTeamShift()) { modal={type:'team-handoff',patient:el.dataset.patient}; return render(); }
    modal={type:'documents',mode:'handoff',patient:el.dataset.patient}; return render();
  }
  if (['cancel-step','postpone-step'].includes(action)) {
    const p=state.patients.find(p=>p.id===el.dataset.patient), s=currentStep(p); if(!s)return;
    if (['in_progress','in_or','pickup'].includes(s.state) && !s.documents?.finish) {
      modal={type:'documents',mode:'stop',stopAction:action,patient:p.id}; return render();
    }
    armUndo(action==='postpone-step'?'Этап перенесён':'Этап отменён');
    const stopped=stopCurrentStep(p,action);
    log(p,`${stopped.state==='postponed'?'Перенесено':'Отменено'}: ${stopped.title}`); modal=null; save(); return render();
  }
  if (action==='delete-patient') { modal={type:'confirm-delete',patient:el.dataset.patient}; return render(); }
  if (action==='confirm-delete-patient') { const p=state.patients.find(item=>item.id===el.dataset.patient);armUndo(`Карточка ${p?.surname||'пациента'} удалена`);state.patients=state.patients.filter(p=>p.id!==el.dataset.patient); modal=null; save(); return render(); }
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
  normalizeContact,contactRoleLabel,doctorOptions,patientDoctor,phoneHref,contactsView,contactCard,
  patientMatchesSearch,contactMatchesSearch,patientMissingFields,waitThresholds,undoView,
  normalizeTimeInput,stepTimeLabel,patientCareFlags,directionPatientStatus,directionRegistryGroup,moreNavButton,workMode,workModeSelectorView,entryTargetChoice
};
setInterval(()=>{ if(!modal && document.querySelector('.timer')) render(true); },30000);
setInterval(()=>{ if(!modal && cloud.session && navigator.onLine && !cloud.syncing) syncCloudState(); },20000);
window.addEventListener('online',()=>{
  cloud.status=cloud.session?'pending':'local';
  cloud.message=cloud.session?'Сеть появилась, синхронизируем…':'';
  if(cloud.session) syncCloudState(); else if(!modal&&(view==='settings'||view==='today')) render(true);
});
window.addEventListener('offline',()=>{
  cloud.status='offline';
  cloud.message=cloud.session?'Изменения сохраняются на устройстве':'';
  if(!modal&&(view==='settings'||view==='today')) render(true);
});
render();
handleAuthRedirect().then(async()=>{ if(cloud.session && modal?.type!=='password-update') { await discoverTeamShift(); setTimeout(()=>syncCloudState(),0); } }).catch(error=>{
  cloud.message=authErrorMessage(error); if(cloud.session) setTimeout(()=>syncCloudState(),0); if(view==='settings')render(true);
});
