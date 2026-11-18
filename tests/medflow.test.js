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
  FormData: class {}
};
sandbox.globalThis = sandbox;
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
  assert.equal(migrated.schemaVersion, 2);
  assert.ok(migrated.shiftStartedAt > 0);
  for (const label of ['Операция','Рентген','ЭКГ','УЗИ','КТ','МРТ','Эхо','Барокамера']) {
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
  assert.equal(api.parseTime('08:30'), 510);
  assert.equal(api.parseTime('23:59'), 1439);
  assert.equal(api.parseTime('24:00'), null);
  assert.equal(api.parseTime(''), null);
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
  const operation = {...step('Операция','done','operation'),startedAt:1000,arrivedAt:11000,readyAt:131000,pickedUpAt:141000,finishedAt:201000,destination:'Палата'};
  const facts = api.stepHistoryFacts(operation);
  assert.equal(facts.operation, true);
  assert.equal(facts.duration, 130000);
  assert.equal(facts.destination, 'Палата');
  const html = api.historyStepView(operation);
  assert.ok(html.includes('доставлен'));
  assert.ok(html.includes('в оперблоке 2 мин'));
  assert.ok(html.includes('Палата'));
}

{
  const liveInOr = {...step('Операция','in_or','operation'),arrivedAt:1000};
  const livePickup = {...step('Операция','pickup','operation'),arrivedAt:1000,readyAt:31000};
  assert.equal(api.stepHistoryFacts(liveInOr,61000).duration, 60000);
  assert.equal(api.stepHistoryFacts(livePickup,61000).duration, 60000);
  livePickup.pickedUpAt = 41000;
  assert.equal(api.operationElapsed(livePickup,91000), 40000);
  assert.equal(api.stepHistoryFacts(livePickup,91000).duration, 40000);
}

{
  const migrated = api.normalizeState({
    patients:[{id:'p',steps:[{id:'op',type:'operation',title:'Операция',state:'in_or',startedAt:1000}],events:[]}],
    archive:[], directions:[{id:'operation',label:'Операция'}]
  });
  const operation = migrated.patients[0].steps[0];
  assert.equal(operation.arrivedAt, 1000);
  assert.equal(operation.startedAt, undefined);
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
  const oldQuerySelector = sandbox.document.querySelector;
  const oldScrollTo = sandbox.scrollTo;
  let restoredTop = null;
  sandbox.scrollY = 240;
  sandbox.document.querySelector = selector => selector === '.filters' ? filterNode : null;
  sandbox.scrollTo = (_x,y) => { restoredTop = y; };
  const position = api.captureViewPosition();
  filterNode.scrollLeft = 0;
  sandbox.scrollY = 0;
  api.restoreViewPosition(position);
  assert.equal(filterNode.scrollLeft, 73);
  assert.equal(restoredTop, 240);
  sandbox.document.querySelector = oldQuerySelector;
  sandbox.scrollTo = oldScrollTo;
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
  assert.ok(appRoot.innerHTML.includes('class="shift-progress"'));
  assert.ok(appRoot.innerHTML.includes('progress-segment done'));
  assert.ok(appRoot.innerHTML.includes('progress-segment running'));
  assert.ok(appRoot.innerHTML.includes('progress-segment stopped'));
  assert.ok(appRoot.innerHTML.includes('Удалённые ошибки не учитываются'));
  assert.ok(appRoot.innerHTML.includes('class="compact-body"'));
  assert.ok(appRoot.innerHTML.includes('class="fab"'));
  assert.ok(!appRoot.innerHTML.includes('class="brand"'));
  assert.ok(appRoot.innerHTML.indexOf('queue-head') < appRoot.innerHTML.indexOf('shift-summary'));
}

console.log('MedFlow: все сценарии пройдены');
