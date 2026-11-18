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
  const result = api.completeCurrentStep(patient, false);
  assert.equal(result.step.state, 'done');
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
  assert.equal(api.actionLabel(mentionedOperation.steps[0]), 'Доставлен в оперблок');
}

{
  const oldPatients = [{ id:'legacy', steps:[] }];
  const oldArchive = [{ id:'shift' }];
  const migrated = api.normalizeState({ patients:oldPatients, archive:oldArchive });
  assert.equal(migrated.patients, oldPatients);
  assert.equal(migrated.archive, oldArchive);
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
  const preserved = api.normalizeState({ patients:[], archive:[], directions:[{id:'operation',label:'Операция'}], settings:{sortMode:'time-desc'} });
  assert.equal(preserved.settings.sortMode, 'time-desc');
}

{
  const progress = api.shiftProgress([{ steps:[
    step('ЭКГ','done','ecg'),
    step('Операция','in_or','operation'),
    step('Рентген','cancelled','xray')
  ] }]);
  assert.equal(progress.patients.done, 0);
  assert.equal(progress.patients.total, 1);
  assert.equal(progress.tasks.done, 1);
  assert.equal(progress.tasks.total, 2);
  assert.equal(progress.tasks.active, 1);
  assert.equal(progress.tasks.remaining, 1);
  const cancelledOnly = api.shiftProgress([{ steps:[step('КТ','cancelled','ct')] }]);
  assert.equal(cancelledOnly.patients.total, 0);
  assert.equal(cancelledOnly.tasks.total, 0);
}

{
  assert.ok(appRoot.innerHTML.includes('class="shift-progress"'));
  assert.ok(appRoot.innerHTML.includes('class="compact-body"'));
  assert.ok(!appRoot.innerHTML.includes('class="brand"'));
  assert.ok(appRoot.innerHTML.indexOf('queue-head') < appRoot.innerHTML.indexOf('shift-summary'));
}

console.log('MedFlow: 20 сценариев пройдены');
