const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync('index.html', 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const nodes = new Map();
const context = vm.createContext({
  localStorage: { getItem: () => null, setItem() {} },
  document: { getElementById: id => { if (!nodes.has(id)) nodes.set(id, {}); return nodes.get(id); }, querySelectorAll: () => [], querySelector: () => null },
  navigator: {}, structuredClone, console
});
vm.runInContext(source, context);
vm.runInContext(`
  const squat = baseDays[0].items.find(item => item.name === 'Barbell Squat');
  const assisted = baseDays[2].items.find(item => item.name === 'Assisted Pull-Up Machine');
  function record(week, item, weights, day = 1) {
    state.data.workouts[workoutKey(week, day)] ||= {};
    state.data.workouts[workoutKey(week, day)][itemKey(item)] = { sets: weights.map(weight => ({ weight })) };
  }
`, context);
function run(code) { return vm.runInContext(code, context); }
assert.equal(run('exerciseBests(squat, 1).allTime'), null);
run('record(1, squat, ["20", "25.5", "", "abc", "-5", "Infinity", "30kg"]); record(2, squat, ["27.5", "22"]); record(3, squat, ["40"]);');
assert.equal(run('exerciseBests(squat, 2).previous'), 25.5);
assert.equal(run('exerciseBests(squat, 2).current'), 27.5);
assert.equal(run('exerciseBests(squat, 2).allTime'), 40);
assert.ok(run('weightBestsHTML(squat, 2).includes("+2 kg")'));
assert.ok(!run('weightBestsHTML(squat, 2).includes("New all-time")'));
assert.ok(run('weightBestsHTML(squat, 3).includes("New all-time")'));
run('record(2, squat, ["32.5"], 4);');
assert.equal(run('exerciseBests(squat, 2).current'), 32.5);
run('record(1, assisted, ["50", "45"]); record(2, assisted, ["40", "42.5"]);');
assert.equal(run('exerciseBests(assisted, 2).allTime'), 40);
assert.ok(run('weightBestsHTML(assisted, 2).includes("Improving")'));
run('record(3, assisted, ["0"]);');
assert.equal(run('exerciseBests(assisted, 3).allTime'), 0);
assert.equal(run('exerciseBests(squat, 5).previous'), null);
run('updateWeight("w3d1|barbell-squat|0", "");');
assert.equal(run('exerciseBests(squat, 3).allTime'), 32.5);
assert.ok(run('itemHTML(planDay(2, 1), squat, {}).includes("data-bests")'));
assert.ok(!run('itemHTML(planDay(2, 2), baseDays[1].items[0], {}).includes("data-bests")'));
console.log('Passed: existing weights, decimals, invalid entries, week boundaries, all-time best, multiple days, assisted weights, zero, edits, and rendering.');
