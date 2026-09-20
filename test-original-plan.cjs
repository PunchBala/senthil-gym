const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('index.html', 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function app(data) {
  let saved;
  const context = vm.createContext({
    localStorage: {getItem: () => JSON.stringify(data), setItem: (_, value) => saved = JSON.parse(value)},
    document: {getElementById: () => ({}), querySelectorAll: () => [], querySelector: () => null},
    navigator: {}, structuredClone, console
  });
  vm.runInContext(source, context);
  return {run: code => vm.runInContext(code, context), saved: () => saved};
}
const old = {workouts: {w1d1: {'barbell-squat': {sets:[{weight:'40',done:true}]}, dayNote:'Keep this', updatedAt:'2026-09-19'}}, food:{'2026-09-19':{breakfast:true}},settings:{unit:'kg'}};
const a = app(old);
assert.deepEqual(a.saved().previousPlanWorkouts, old.workouts);
assert.deepEqual(a.saved().food, old.food);
assert.equal(a.run('Object.keys(state.data.workouts).length'), 0);
assert.equal(a.run('findLatest()'), null);
assert.ok(a.run('homeHTML().includes("8-week Workout Plan")'));
assert.ok(a.run('homeHTML().includes("Earlier workout logs preserved")'));
assert.ok(a.run('homeHTML().includes("1 records")'));
assert.equal(a.run('exportRows().filter(r => r.type === "previous-plan")[0].weight'), '40');
assert.equal(a.run('originalDay(1,1).items[0].name'), 'Cable crunches');
assert.equal(a.run('originalDay(1,2).items.find(x=>x.name==="Bench press").sets'), 5);
assert.equal(a.run('originalDay(1,2).items.find(x=>x.name==="Bench press").rest'), '20sec');
assert.equal(a.run('originalDay(5,2).items.find(x=>x.name==="Bench press").target'), '11');
assert.equal(a.run('originalDay(5,4).items[0].target'), '45sec');
assert.equal(a.run('originalDay(5,5).items.find(x=>x.name==="D rod cable pull downs").video'), null);
assert.equal(a.run('originalDay(1,6).items[0].target'), '300 kcal (source target)');
assert.equal(a.run('originalDay(8,6).items[0].target'), '350 kcal (source target)');
assert.equal(a.run('originalDay(8,7).items.length'), 0);
assert.throws(()=>a.run('originalDay(9,1)'), /No source workout/);
assert.equal(a.run('exportRows().some(r=>r.week===8)'), true);
assert.equal(a.run('dietBlocks.every(b=>Math.abs(b.c*4+b.p*4+b.f*9-b.calories)<0.1)'), true);
assert.equal(a.run('foodHTML().includes("1672")'), false);
for (let week=1;week<=8;week++) for (let day=1;day<=7;day++) {
  a.run(`state.week=${week}; state.day=${day}; workoutHTML()`);
}
a.run('state.data.workouts.w8d5={startedAt:"2026-09-19",updatedAt:"2026-09-19"}; save()');
const b = app(a.saved());
assert.equal(b.run('findLatest().week'), 8);
assert.equal(b.run('state.data.previousPlanWorkouts.w1d1["barbell-squat"].sets[0].weight'), '40');
// Adaptations do not silently reintroduce known triggers in the second block.
for (let week=1;week<=8;week++) for (let day=1;day<=5;day++) {
  const items = a.run(`planDay(${week},${day}).items`);
  assert.ok(items.every(item => !/arnold|fly|dip|pushdown|clean press|plank|mountain climber|dumbbell|lateral raise|front raise|bench press|push.up/i.test(item.name)));
  assert.equal(new Set(items.map(item=>item.name)).size, items.length);
  if (week <= 2 || week === 5) assert.ok(items.every(item=>item.sets<=2));
  for (const item of items.filter(item=>/press/i.test(item.name) && !/leg press/i.test(item.name))) {
    assert.equal(item.optional, true);
    assert.equal(day, 3);
    assert.equal(item.sets, 2);
  }
}
assert.equal(a.run('planDay(1,1).items.filter(x=>x.recovery).length'), 3);
assert.equal(a.run('planDay(5,5).items.some(x=>x.name==="Chest-Supported Machine Row")'), true);
assert.equal(a.run('foodHTML().includes("two-week trial")'), true);
assert.equal(a.run('workoutHTML().includes("shoulder review pending")'), false);
a.run(`
  const progressDay = planDay(3,3);
  const completed = state.data.workouts[workoutKey(3,3)] = {};
  progressDay.items.filter(item=>!item.optional).forEach(item=> {
    completed[itemKey(item)] = item.kind === "cardio" ? {done:true} : {sets:[{done:true},{done:true}]};
  });
`);
assert.equal(a.run('completedStats(3,3).pct'), 100, 'optional pressing, prehab and third sets must not penalize completion');
const sourceUser = {...old,planVersion:'original-8-week-v1',previousPlanWorkouts:{w2d1:{'old-exercise':{sets:[{weight:'10'}]}}}};
const migrated = app(sourceUser);
assert.deepEqual(migrated.saved().sourcePlanWorkouts, old.workouts);
assert.deepEqual(migrated.saved().previousPlanWorkouts, sourceUser.previousPlanWorkouts);
assert.equal(migrated.run('exportRows().find(r=>r.type==="source-plan").weight'), '40');
assert.equal(migrated.run('exportRows().find(r=>r.type==="previous-plan").weight'), '10');
assert.equal(app(migrated.saved()).run('state.data.sourcePlanWorkouts.w1d1["barbell-squat"].sets[0].weight'), '40');
console.log('Passed: source fidelity, 56 adapted days render, trigger exclusions, optional completion, diet totals, exports, and both history migrations.');

