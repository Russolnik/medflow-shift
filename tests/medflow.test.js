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

console.log('MedFlow: 6 сценариев пройдены');
