const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'dist', 'app.js'), 'utf8');
const storage = new Map();
const appRoot = { innerHTML: '' };
const sandbox = {
  console,
  Date,
  Math,
  JSON,
  scrollY: 0,
  scrollTo: () => {},
  requestAnimationFrame: callback => callback(),
  crypto: { randomUUID: (() => { let id = 0; return () => `test-${++id}`; })() },
  localStorage: {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key)
  },
  document: {
    getElementById: id => id === 'app' ? appRoot : null,
    querySelectorAll: () => [],
    querySelector: () => null
  },
  setInterval: () => 0,
  setTimeout: () => 0,
  clearTimeout: () => {},
  navigator: { onLine: true },
  FormData: class {}
};
sandbox.globalThis = sandbox;
sandbox.window = { addEventListener: () => {} };
vm.runInNewContext(source, sandbox, { filename: 'app.js' });

const api = sandbox.__MEDFLOW_TEST__;
const step = (title, state='waiting', type='other') => ({ id:title, title, state, type });

{
  const patient = { steps:[step('КТ','in_progress','ct'),step('Рентген')] };
  const result = api.completeCurrentStep(patient, false, 123456);
  assert.equal(result.step.state, 'done');
  assert.equal(result.step.finishedAt, 123456);
  assert.equal(result.next.state, 'active');
  assert.equal(api.canContinueNow(patient), false);
}

{
  const active={...step('ФГС','active','fgs')};
  assert.equal(api.canEditRouteStep(active),true);
  assert.equal(api.changeRouteStepType(active,'ultrasound'),true);
  assert.equal(active.type,'ultrasound');
  assert.equal(active.title,'УЗИ');

  const running={...step('ФГС','in_progress','fgs')};
  assert.equal(api.canEditRouteStep(running),false);
  assert.equal(api.changeRouteStepType(running,'ultrasound'),false);
  assert.equal(running.type,'fgs');

  const changedFromOperation={priority:'operation',block:'xo',steps:[{...step('Операция','active','operation')}]};
  api.changeRouteStepType(changedFromOperation.steps[0],'ultrasound');
  api.syncPatientPriority(changedFromOperation,false);
  assert.equal(changedFromOperation.priority,'normal');
  assert.equal(changedFromOperation.block,'');
}

{
  const patient = { steps:[step('КТ','in_progress','ct'),step('Рентген')] };
  assert.equal(api.canContinueNow(patient), true);
  const result = api.completeCurrentStep(patient, true);
  assert.equal(result.step.state, 'done');
  assert.equal(result.next.state, 'in_progress');
  assert.equal(api.currentStep(patient).title, 'Рентген');
}

{
  const operation = step('Операция','in_progress','operation');
  assert.equal(api.actionLabel(operation), 'Доставлен в оперблок');
  assert.equal(api.canContinueNow({steps:[operation,step('Рентген')]}), false);
}

{
  const urgent = { pinned:false, priority:'urgent', steps:[step('КТ','active','ct')] };
  const operation = { pinned:false, priority:'operation', steps:[step('Операция','active','operation')] };
  const normal = { pinned:false, priority:'normal', steps:[step('УЗИ','active','ultrasound')] };
  assert.ok(api.score(urgent) > api.score(operation));
  assert.ok(api.score(operation) > api.score(normal));
}

{
  const patient = { steps:[step('КТ','done','ct'),step('Рентген','cancelled','xray')] };
  assert.equal(api.isComplete(patient), true);
}

{
  assert.equal(api.timerClass(59 * 60000), 'green');
  assert.equal(api.timerClass(60 * 60000), 'yellow');
  assert.equal(api.timerClass(120 * 60000), 'red');
  assert.equal(api.timerClass(89 * 60000,{warningMinutes:90,criticalMinutes:180}), 'green');
  assert.equal(api.timerClass(90 * 60000,{warningMinutes:90,criticalMinutes:180}), 'yellow');
  assert.equal(api.timerClass(180 * 60000,{warningMinutes:90,criticalMinutes:180}), 'red');
  assert.equal(api.esc('<script>'), '&lt;script&gt;');
}

{
  const operationLater = {
    pinned:false, priority:'normal',
    steps:[step('КТ','active','ct'),step('Операция','waiting','operation')]
  };
  const ordinary = { pinned:false, priority:'normal', steps:[step('КТ','active','ct')] };
  assert.equal(api.hasTodayOperation(operationLater), true);
  assert.ok(api.score(operationLater) > api.score(ordinary));
}

{
  const afterOperation = {
    pinned:false, priority:'normal',
    steps:[step('Операция','done','operation'),step('Рентген','active','xray')]
  };
  const ordinary = { pinned:false, priority:'normal', steps:[step('Рентген','active','xray')] };
  assert.equal(api.hasTodayOperation(afterOperation), true);
  assert.ok(api.score(afterOperation) > api.score(ordinary));
}

{
  const cancelledOperation = {
    pinned:false, priority:'operation',
    steps:[step('Операция','cancelled','operation'),step('ЭКГ','active','ecg')]
  };
  const ordinary = { pinned:false, priority:'normal', steps:[step('ЭКГ','active','ecg')] };
  assert.equal(api.hasTodayOperation(cancelledOperation), false);
  assert.equal(api.score(cancelledOperation), api.score(ordinary));
}

{
  const mentionedOperation = {
    pinned:false, priority:'normal',
    steps:[step('На операцию в ХО','waiting','other'),step('Палата','active','ward')]
  };
  assert.equal(api.hasTodayOperation(mentionedOperation), true);
  assert.equal(api.stepMatchesDirection(mentionedOperation.steps[0], 'operation'), true);
  assert.equal(api.actionLabel(mentionedOperation.steps[0]), 'Начать');
  mentionedOperation.steps[0].state = 'in_progress';
  assert.equal(api.actionLabel(mentionedOperation.steps[0]), 'Доставлен в оперблок');
}

{
  const oldPatients = [{ id:'legacy', steps:[] }];
  const oldArchive = [{ id:'shift' }];
  const migrated = api.normalizeState({ patients:oldPatients, archive:oldArchive });
  assert.equal(migrated.patients.length, 1);
  assert.equal(migrated.patients[0].id, 'legacy');
  assert.equal(migrated.archive.length, 1);
  assert.equal(migrated.archive[0].id, 'shift');
  assert.equal(migrated.schemaVersion, 9);
  assert.ok(Array.isArray(migrated.incoming));
  assert.ok(migrated.departments.length >= 1);
  assert.ok(Array.isArray(migrated.contacts));
  assert.equal(migrated.settings.ownDepartmentId, migrated.departments[0].id);
  assert.ok(migrated.shiftStartedAt > 0);
  assert.deepEqual({...migrated.settings.waitThresholds},{warningMinutes:60,criticalMinutes:120});
  for (const label of ['Операция','Рентген','ЭКГ','УЗИ','КТ','МРТ','Эхо','Барокамера','ФГС']) {
    assert.ok(migrated.directions.some(item => item.label === label));
  }
}

{
  const custom = api.normalizeState({
    patients:[], archive:[],
    directions:[{id:'operation',label:'Операция'},{id:'custom-fgds',label:'ФГДС'}]
  });
  assert.ok(custom.directions.some(item => item.id === 'custom-fgds' && item.label === 'ФГДС'));
  assert.equal(custom.directions.find(item => item.id === 'operation').locked, true);
}

{
  const migrated = api.normalizeState({
    patients:[{id:'legacy-department',surname:'Старый',steps:[],events:[]}],
    archive:[], settings:{}
  });
  assert.equal(migrated.patients[0].departmentId, '');
  assert.equal(api.patientMatchesDepartment({departmentId:''}, 'none'), true);
  assert.equal(api.patientMatchesDepartment({departmentId:'department-own'}, 'department-own'), true);
  assert.ok(api.departmentOptions('department-own').includes('наше'));
  assert.ok(api.departmentFiltersView().includes('data-department-filter'));
}

{
  const contact=api.normalizeContact({id:'c1',name:' Иванов И.И. ',role:'doctor',departmentId:'department-own',phone:'+7 (900) 123-45-67'});
  assert.equal(contact.name,'Иванов И.И.');
  assert.equal(contact.role,'doctor');
  assert.equal(api.contactRoleLabel('orderly'),'Санитар / санитарка');
  assert.equal(api.phoneHref(contact.phone),'tel:+79001234567');
  assert.equal(api.normalizeContact({name:'   '}),null);
  assert.ok(api.contactsView().includes('Контакты отделений'));
}

{
  const patient={surname:'Смирнов',room:'7',transport:'Кресло',departmentId:'department-own',doctorName:'Петров',steps:[step('Рентген','active','xray')]};
  assert.equal(api.patientMatchesSearch(patient,'смир'),true);
  assert.equal(api.patientMatchesSearch(patient,'рент'),true);
  assert.equal(api.patientMatchesSearch(patient,'999'),false);
  assert.equal(api.contactMatchesSearch({name:'Ординатор',phone:'123',role:'doctor',departmentId:'department-own'},'123'),true);
  assert.deepEqual([...api.patientMissingFields(patient)],['время']);
  const operationPatient={...patient,room:'',transport:'',block:'',steps:[step('Операция','active','operation')]};
  assert.deepEqual([...api.patientMissingFields(operationPatient)],['палата','способ передвижения','оперблок','время']);
}

{
  assert.equal(api.parseTime('08:30'), 510);
  assert.equal(api.parseTime('23:59'), 1439);
  assert.equal(api.parseTime('24:00'), null);
  assert.equal(api.parseTime(''), null);
}

{
  assert.equal(api.normalizeTimeInput('8:30'), '08:30');
  assert.equal(api.normalizeTimeInput('18.05'), '18:05');
  assert.equal(api.normalizeTimeInput('24:00'), '');
  assert.equal(api.normalizeTimeInput('примерно утром'), '');
  assert.equal(api.stepTimeLabel({time:'09:10'}), '09:10');
  assert.equal(api.stepTimeLabel({time:'',timeFlexible:true}), 'Без времени');
  const flexible={surname:'Иванов',room:'1',transport:'Кресло',steps:[{...step('УЗИ','active','ultrasound'),timeFlexible:true}]};
  assert.deepEqual([...api.patientMissingFields(flexible)],[]);
}

{
  const normalized=api.normalizeState({
    patients:[{id:'flags',surname:'Иванов',careFlags:['extra_protection','diagnosis-hiv','assisted_contact'],steps:[],events:[]}],
    archive:[],directions:[{id:'operation',label:'Операция'}]
  });
  assert.deepEqual([...normalized.patients[0].careFlags],['extra_protection','patient_attention']);
  assert.deepEqual([...api.patientCareFlags(normalized.patients[0]).map(item=>item.id)],['patient_attention','extra_protection']);
}

{
  const normalized=api.normalizeState({
    patients:[], incoming:[{id:'new-one',surname:'Новый',room:'2',inboxStatus:'pending',steps:[step('КТ','active','ct')],events:[]}], archive:[]
  });
  assert.equal(normalized.incoming.length,1);
  assert.equal(normalized.incoming[0].surname,'Новый');
}

{
  const early = { pinned:false, priority:'normal', steps:[{...step('ЭКГ','active','ecg'),time:'08:30'}] };
  const late = { pinned:false, priority:'normal', steps:[{...step('УЗИ','active','ultrasound'),time:'12:10'}] };
  assert.ok(api.comparePatients(early, late, 'time-asc') < 0);
  assert.ok(api.comparePatients(early, late, 'time-desc') > 0);
}

{
  const timed = { pinned:false, priority:'normal', steps:[{...step('ЭКГ','active','ecg'),time:'09:00'}] };
  const withoutTime = { pinned:false, priority:'normal', steps:[step('УЗИ','active','ultrasound')] };
  assert.ok(api.comparePatients(timed, withoutTime, 'time-asc') < 0);
  assert.ok(api.comparePatients(timed, withoutTime, 'time-desc') < 0);
}

{
  const patient = {
    pinned:false, priority:'normal',
    steps:[{...step('ЭКГ','done','ecg'),time:'07:00'},{...step('Рентген','active','xray'),time:'11:20'}]
  };
  assert.equal(api.patientTimeMinutes(patient), 680);
}

{
  const operation = { pinned:false, priority:'normal', steps:[step('Операция','active','operation')] };
  const earlyProcedure = { pinned:false, priority:'normal', steps:[{...step('ЭКГ','active','ecg'),time:'07:00'}] };
  assert.ok(api.comparePatients(operation, earlyProcedure, 'time-asc') < 0);
  assert.equal(api.stepMatchesDirection(step('УВЧ','active','other'), 'other'), true);
}

{
  const migrated = api.normalizeState({ patients:[], archive:[], directions:[{id:'operation',label:'Операция'}] });
  assert.equal(migrated.settings.sortMode, 'priority');
  assert.equal(migrated.settings.addButtonPosition, 'floating');
  const preserved = api.normalizeState({ patients:[], archive:[], directions:[{id:'operation',label:'Операция'}], settings:{sortMode:'time-desc'} });
  assert.equal(preserved.settings.sortMode, 'time-desc');
  const inline = api.normalizeState({ patients:[], archive:[], directions:[{id:'operation',label:'Операция'}], settings:{sortMode:'priority',addButtonPosition:'inline'} });
  assert.equal(inline.settings.addButtonPosition, 'inline');
  const invalid = api.normalizeState({ patients:[], archive:[], directions:[{id:'operation',label:'Операция'}], settings:{addButtonPosition:'corner'} });
  assert.equal(invalid.settings.addButtonPosition, 'floating');
}

{
  const s = step('ЭКГ','in_progress','ecg');
  assert.equal(api.setStepDocument(s,'start','taken',1000), true);
  assert.equal(api.setStepDocument(s,'finish','not_required',5000), true);
  assert.equal(s.documents.start.status, 'taken');
  assert.equal(s.documents.start.at, 1000);
  assert.equal(api.documentStatusLabel(s.documents.start,'start'), 'документы взяты');
  assert.equal(api.documentStatusLabel(s.documents.finish,'finish'), 'документы не требовались');
  assert.equal(api.setStepDocument(s,'middle','taken',6000), false);
}

{
  const procedure = {...step('Рентген','done','xray'),startedAt:1000,finishedAt:61000,documents:{start:{status:'taken',at:1000},finish:{status:'not_required',at:61000}}};
  const facts = api.stepHistoryFacts(procedure);
  assert.equal(facts.duration, 60000);
  assert.equal(facts.startDocuments, 'документы взяты');
  assert.equal(facts.finishDocuments, 'документы не требовались');
  assert.equal(api.durationBetween(61000,1000), null);
}

{
  const operation = {...step('Операция','done','operation'),preopCheck:{at:900,dentures:true,jewelry:true,belongings:true},startedAt:1000,arrivedAt:11000,readyAt:131000,pickedUpAt:141000,finishedAt:201000,destination:'Палата'};
  const facts = api.stepHistoryFacts(operation);
  assert.equal(facts.operation, true);
  assert.equal(facts.preopCheckedAt, 900);
  assert.equal(facts.duration, 130000);
  assert.equal(facts.travelDuration, 60000);
  assert.equal(facts.destination, 'Палата');
  const html = api.historyStepView(operation);
  assert.ok(html.includes('доставлен'));
  assert.ok(html.includes('проверка перед операцией'));
  assert.ok(html.includes('в оперблоке 2 мин'));
  assert.ok(html.includes('в пути 1 мин'));
  assert.ok(html.includes('Палата'));
}

{
  const html=api.preopChecklistView();
  assert.ok(html.includes('Съёмные зубные протезы'));
  assert.ok(html.includes('Украшения и часы'));
  assert.ok(html.includes('Другие съёмные вещи'));
  assert.equal((html.match(/required type="checkbox"/g)||[]).length,3);
}

{
  const liveInOr = {...step('Операция','in_or','operation'),arrivedAt:1000};
  const livePickup = {...step('Операция','pickup','operation'),arrivedAt:1000,readyAt:31000};
  assert.equal(api.stepHistoryFacts(liveInOr,61000).duration, 60000);
  assert.equal(api.stepHistoryFacts(livePickup,61000).duration, 60000);
  livePickup.pickedUpAt = 41000;
  assert.equal(api.operationElapsed(livePickup,91000), 40000);
  assert.equal(api.pickupTravelElapsed(livePickup,91000), 50000);
  assert.equal(api.stepHistoryFacts(livePickup,91000).duration, 40000);
  assert.equal(api.stepHistoryFacts(livePickup,91000).travelDuration, 50000);
  assert.ok(api.operationTimersView(livePickup).includes('В пути'));
}

{
  const migrated = api.normalizeState({
    patients:[{id:'p',steps:[{id:'op',type:'operation',title:'Операция',state:'in_or',startedAt:1000}],events:[]}],
    archive:[], directions:[{id:'operation',label:'Операция'}]
  });
  const operation = migrated.patients[0].steps[0];
  assert.equal(operation.arrivedAt, 1000);
  assert.equal(operation.startedAt, undefined);
  assert.ok(migrated.directions.some(item=>item.id==='fgs'&&item.label==='ФГС'));
}

{
  const normalized = api.normalizeState({
    patients:[{id:'kept',steps:[{...step('ЭКГ','done','ecg'),startedAt:5000,finishedAt:9000}],events:[]}],
    archive:[null,{id:'old',patients:[{id:'archived',steps:[{...step('КТ','done','ct'),startedAt:1000,finishedAt:4000}],events:[]}]}],
    directions:[{id:'operation',label:'Операция'}]
  });
  assert.equal(normalized.patients[0].id, 'kept');
  assert.equal(normalized.shiftStartedAt, 5000);
  assert.equal(normalized.archive.length, 1);
  assert.equal(normalized.archive[0].startedAt, 1000);
}

{
  const patient = {priority:'operation',steps:[
    {...step('Операция','in_or','operation'),startedAt:1000,arrivedAt:11000,documents:{start:{status:'taken',at:1000}}},
    step('Палата','waiting','ward')
  ]};
  api.setStepDocument(patient.steps[0],'finish','not_required',71000);
  const stopped = api.stopCurrentStep(patient,'cancel-step',71000);
  assert.equal(stopped.state, 'cancelled');
  assert.equal(stopped.finishedAt, 71000);
  assert.equal(api.currentStep(patient).title, 'Палата');
  const html = api.historyStepView(stopped);
  assert.ok(html.includes('доставлен'));
  assert.ok(html.includes('Отменено'));
  assert.ok(html.includes('документы не требовались'));
}

{
  assert.equal(api.addButtonPosition({}), 'floating');
  assert.equal(api.addButtonPosition({addButtonPosition:'inline'}), 'inline');
  assert.equal(api.showFloatingAdd('today',{addButtonPosition:'floating'}), true);
  assert.equal(api.showFloatingAdd('directions',{addButtonPosition:'floating'}), true);
  assert.equal(api.showFloatingAdd('history',{addButtonPosition:'floating'}), false);
  assert.equal(api.showFloatingAdd('today',{addButtonPosition:'inline'}), false);
}

{
  const filterNode = {scrollLeft:73};
  const secondFilterNode = {scrollLeft:141};
  const oldQuerySelector = sandbox.document.querySelector;
  const oldQuerySelectorAll = sandbox.document.querySelectorAll;
  const oldScrollTo = sandbox.scrollTo;
  let restoredTop = null;
  sandbox.scrollY = 240;
  sandbox.document.querySelector = selector => selector === '.filters' ? filterNode : null;
  sandbox.document.querySelectorAll = selector => selector === '.filters' ? [filterNode,secondFilterNode] : [];
  sandbox.scrollTo = (_x,y) => { restoredTop = y; };
  const position = api.captureViewPosition();
  filterNode.scrollLeft = 0;
  secondFilterNode.scrollLeft = 0;
  sandbox.scrollY = 0;
  api.restoreViewPosition(position);
  assert.equal(filterNode.scrollLeft, 73);
  assert.equal(secondFilterNode.scrollLeft, 141);
  assert.equal(restoredTop, 240);
  sandbox.document.querySelector = oldQuerySelector;
  sandbox.document.querySelectorAll = oldQuerySelectorAll;
  sandbox.scrollTo = oldScrollTo;
}

{
  const migrated=api.normalizeState({patients:[{id:'old-xo',block:'xo',steps:[],events:[]},{id:'old-gxo',block:'gxo',steps:[],events:[]},{id:'old-angio',block:'angio',steps:[],events:[]}],archive:[],settings:{}});
  assert.equal(migrated.patients[0].block,'op');
  assert.equal(migrated.patients[1].block,'op');
  assert.equal(migrated.patients[2].block,'angio');
}

{
  const shiftHtml = api.shiftCardView({startedAt:1000,closedAt:61000,patients:[{surname:'Иванов',room:'4',transport:'Кресло',steps:[{...step('КТ','done','ct'),startedAt:1000,finishedAt:61000}],events:[]}]});
  assert.ok(shiftHtml.includes('class="shift-card'));
  assert.ok(shiftHtml.includes('Иванов'));
  assert.ok(shiftHtml.includes('КТ'));
  assert.ok(shiftHtml.includes('1 пациентов'));
}

{
  const progress = api.shiftProgress([{ steps:[
    step('ЭКГ','done','ecg'),
    step('КТ','in_progress','ct'),
    step('Операция','in_or','operation'),
    step('Забрать','pickup','operation'),
    step('Рентген','cancelled','xray'),
    step('УЗИ','postponed','ultrasound'),
    step('Эхо','active','echo'),
    step('МРТ','waiting','mri')
  ] }]);
  assert.equal(progress.patients.done, 0);
  assert.equal(progress.patients.total, 1);
  assert.equal(progress.tasks.done, 1);
  assert.equal(progress.tasks.total, 8);
  assert.equal(progress.tasks.active, 3);
  assert.equal(progress.tasks.cancelled, 2);
  assert.equal(progress.tasks.waiting, 2);
  assert.equal(progress.tasks.handled, 3);
  assert.equal(progress.tasks.remaining, 5);

  const cancelledOnly = api.shiftProgress([{ steps:[step('КТ','cancelled','ct')] }]);
  assert.equal(cancelledOnly.patients.done, 1);
  assert.equal(cancelledOnly.patients.total, 1);
  assert.equal(cancelledOnly.tasks.total, 1);
  assert.equal(cancelledOnly.tasks.cancelled, 1);

  const postponedOnly = api.shiftProgress([{ steps:[step('Операция','postponed','operation')] }]);
  assert.equal(postponedOnly.patients.done, 1);
  assert.equal(postponedOnly.patients.total, 1);
  assert.equal(postponedOnly.tasks.cancelled, 1);

  const removed = api.shiftProgress([{ steps:[] }]);
  assert.equal(removed.patients.total, 0);
  assert.equal(removed.tasks.total, 0);
}

{
  const patient = { steps:[
    step('Операция','postponed','operation'),
    step('ЭКГ','active','ecg')
  ] };
  assert.equal(api.isStoppedStep(patient.steps[0]), true);
  assert.equal(api.isTerminalStep(patient.steps[0]), true);
  assert.equal(api.currentStep(patient).title, 'ЭКГ');
  assert.equal(api.hasTodayOperation(patient), false);
  assert.equal(api.isComplete({steps:[step('КТ','done','ct'),step('УЗИ','postponed','ultrasound')]}), true);
}

{
  const historyHtml = api.historyView();
  const settingsHtml = api.settingsView();
  assert.ok(historyHtml.includes('Прошлые смены'));
  assert.ok(!historyHtml.includes('Настройки интерфейса'));
  assert.ok(!historyHtml.includes('Управление сменой'));
  assert.ok(!historyHtml.includes('О MedFlow'));
  assert.ok(settingsHtml.includes('Быстрая запись'));
  assert.ok(settingsHtml.includes('Смена и данные'));
  assert.ok(settingsHtml.includes('Ожидание в оперблоке'));
  assert.ok(settingsHtml.includes('data-action="save-thresholds"'));
  assert.ok(settingsHtml.includes('О MedFlow'));
}

{
  const patient = {id:'history-filter',surname:'FILTER',room:'1',transport:'walk',steps:[
    step('DONE-ONLY','done','ct'),
    step('ACTIVE-HIDDEN','active','ecg'),
    step('WAITING-HIDDEN','waiting','xray')
  ]};
  const html = api.historyPatientCard(patient);
  assert.ok(html.includes('DONE-ONLY'));
  assert.ok(!html.includes('ACTIVE-HIDDEN'));
  assert.ok(!html.includes('WAITING-HIDDEN'));
  assert.equal(api.isHistoryStep(patient.steps[0]), true);
  assert.equal(api.isHistoryStep(patient.steps[1]), false);
}

{
  const patient = {id:'restore-one',priority:'normal',block:'',pinned:true,steps:[{
    ...step('RETURN-ME','done','ct'),startedAt:100,finishedAt:200,documents:{start:'taken'},preopCheck:{at:90}
  }]};
  const result = api.restoreOrRepeatStep(patient,'RETURN-ME');
  assert.equal(result.mode,'restore');
  assert.equal(patient.steps[0].state,'active');
  assert.equal(patient.steps[0].startedAt,undefined);
  assert.equal(patient.steps[0].finishedAt,undefined);
  assert.equal(patient.steps[0].documents,undefined);
  assert.equal(patient.steps[0].preopCheck,undefined);
  assert.equal(patient.pinned,false);
}

{
  const patient = {id:'repeat-one',priority:'normal',block:'',pinned:false,steps:[
    step('OLD-DONE','done','ct'),step('CURRENT','active','ecg')
  ]};
  const result = api.restoreOrRepeatStep(patient,'OLD-DONE');
  assert.equal(result.mode,'repeat');
  assert.equal(patient.steps.length,3);
  assert.equal(patient.steps[0].state,'done');
  assert.equal(api.currentStep(patient).title,'CURRENT');
  assert.equal(patient.steps[2].title,'OLD-DONE');
  assert.equal(patient.steps[2].state,'waiting');
  assert.notEqual(patient.steps[2].id,'OLD-DONE');
}

{
  const sw = fs.readFileSync(path.join(__dirname,'..','dist','sw.js'),'utf8');
  assert.ok(sw.includes("medflow-shell-v36"));
  assert.ok(sw.includes("'./index.html', './styles.css', './app.js'"));
  assert.ok(sw.includes('ignoreSearch: true'));
  assert.ok(sw.includes("caches.match('./index.html')"));
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname,'..','dist','manifest.webmanifest'),'utf8'));
  assert.equal(manifest.start_url,'./?pwa=36');
  assert.equal(manifest.scope,'./');
  assert.equal(manifest.display,'standalone');
}

{
  assert.ok(appRoot.innerHTML.includes('class="shift-progress"'));
  assert.ok(appRoot.innerHTML.includes('progress-segment done'));
  assert.ok(appRoot.innerHTML.includes('progress-segment running'));
  assert.ok(appRoot.innerHTML.includes('progress-segment stopped'));
  assert.ok(appRoot.innerHTML.includes('Удалённые ошибки не учитываются'));
  assert.ok(appRoot.innerHTML.includes('class="compact-body"'));
  assert.ok(appRoot.innerHTML.includes('class="fab"'));
  assert.ok(appRoot.innerHTML.includes('data-view="settings"'));
  assert.equal((appRoot.innerHTML.match(/class="nav-btn/g) || []).length, 6);
  assert.ok(appRoot.innerHTML.includes('data-view="inbox"'));
  assert.ok(!appRoot.innerHTML.includes('class="brand"'));
  assert.ok(appRoot.innerHTML.indexOf('queue-head') < appRoot.innerHTML.indexOf('shift-summary'));
}

{
  assert.ok(source.includes('sb_publishable_'));
  assert.ok(!source.includes('sb_secret_'));
  assert.ok(!source.includes('service_role'));
  assert.ok(source.includes('/auth/v1/token?grant_type=password'));
  assert.ok(source.includes('/rest/v1/medflow_states?on_conflict=user_id'));
  assert.ok(source.includes('class="auth-switch"'));
  assert.ok(source.includes('data-action="cloud-password-toggle"'));
  assert.ok(source.includes('authErrorMessage(error)'));
  assert.ok(source.includes('RETRY_DELAYS = [5000, 15000, 30000]'));
  assert.ok(source.includes("modal={type:'sync-conflict'"));
  assert.ok(source.includes('data-action="sync-conflict-merge"'));
  assert.ok(source.includes('data-action="export-backup"'));
  assert.ok(source.includes('data-action="import-backup"'));
  assert.ok(source.includes('/auth/v1/recover'));
  assert.ok(source.includes("cloudRequest('/auth/v1/user'"));
  assert.ok(source.includes('data-route-type'));
  assert.ok(source.includes('Направление текущего этапа можно менять до начала выполнения'));
  assert.ok(source.includes('data-action="manage-departments"'));
  assert.ok(source.includes('data-department-filter'));
  assert.ok(source.includes('name="department"'));
  assert.ok(source.includes("mode === 'department'"));
  assert.ok(source.includes("navButton('contacts'"));
  assert.ok(source.includes('data-action="contact-save"'));
  assert.ok(source.includes('href="${esc(href)}"'));
  assert.ok(source.includes('name="doctor"'));
  assert.ok(source.includes("op:'ОПРБЛК'"));
  assert.ok(source.includes("angio:'АНГБЛК'"));
  assert.ok(source.includes("hasTodayOperation(p)?'operation-today'"));
  assert.ok(source.includes('data-action="undo-last"'));
  assert.ok(source.includes('data-action="rollback-status"'));
  assert.ok(source.includes("modal.type === 'confirm-transition'"));
  assert.ok(source.includes('Без времени'));
  assert.ok(source.includes('data-operation-field'));
  assert.ok(source.includes('Доп. меры защиты'));
  assert.ok(source.includes('Внимание к пациенту'));
  assert.ok(!source.includes('Гигиеническая осторожность'));
  assert.ok(source.includes('data-action="accept-incoming"'));
  assert.ok(source.includes('name="entry-target"'));
  assert.ok(source.includes('},20000);'));
  assert.ok(source.includes('hasOpenWorkForm()'));
  assert.ok(source.includes('type="time"'));
  assert.ok(source.includes('data-time-now'));
  assert.ok(source.includes('deferSyncForOpenForm()'));
  assert.ok(source.includes('captureModalDraft()'));
  assert.ok(source.includes('restoreModalDraft()'));
  assert.ok(source.includes("searchBox('patient-search'"));
  assert.ok(fs.readFileSync(path.join(__dirname,'..','dist','styles.css'),'utf8').includes('.patient-card.operation-today:not(.urgent)'));
  assert.ok(!source.includes('<option value="gxo"'));
  assert.ok(!source.includes('<option value="xo"'));
}

{
  const local={schemaVersion:2,shiftStartedAt:1,patients:[{id:'same',surname:'Локальный',room:'1',steps:[{id:'step-a',title:'КТ',type:'ct',state:'in_progress',startedAt:100}],events:[]}],archive:[],directions:[],settings:{}};
  const remote={schemaVersion:2,shiftStartedAt:1,patients:[{id:'same',surname:'Облачный',room:'2',steps:[{id:'step-a',title:'КТ',type:'ct',state:'done',startedAt:100,finishedAt:200},{id:'step-b',title:'ЭКГ',type:'ecg',state:'waiting'}],events:[]},{id:'remote-only',surname:'Новый',room:'3',steps:[step('УЗИ','active','ultrasound')],events:[]}],archive:[],directions:[],settings:{}};
  const merged=api.mergeStates(local,remote);
  assert.equal(merged.patients.length,2);
  const same=merged.patients.find(patient=>patient.id==='same');
  assert.equal(same.steps.length,2);
  assert.equal(same.steps.find(item=>item.id==='step-a').state,'done');
}

{
  const backup=api.backupEnvelope();
  assert.equal(backup.format,'medflow-backup');
  assert.equal(backup.version,1);
  assert.ok(Array.isArray(backup.state.patients));
  assert.ok(api.syncPillView().includes('sync-pill'));
}

console.log('MedFlow: все сценарии пройдены');
