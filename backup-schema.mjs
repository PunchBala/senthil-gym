export const MAX_BYTES = 2 * 1024 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function validateData(data) {
  if (!object(data) || !object(data.workouts) || !object(data.food) || !object(data.settings)) throw new Error('Invalid workout backup.');
  // The existing published app predates explicit plan versions.
  if (data.planVersion !== undefined && !['original-8-week-v1', 'adapted-8-week-v2'].includes(data.planVersion)) throw new Error('Unsupported plan version.');
  if (JSON.stringify(data).length > MAX_BYTES) throw new Error('Backup is too large.');
  for (const archive of ['workouts', 'previousPlanWorkouts', 'sourcePlanWorkouts']) {
    if (data[archive] === undefined) continue;
    if (!object(data[archive])) throw new Error('Invalid workout history.');
    for (const [key, workout] of Object.entries(data[archive])) {
      if (!/^w[1-8]d[1-7]$/.test(key) || !object(workout)) throw new Error('Invalid workout record.');
      for (const [name, record] of Object.entries(workout)) {
        if (['startedAt', 'updatedAt', 'completedAt', 'dayNote'].includes(name)) {
          if (typeof record !== 'string') throw new Error('Invalid workout note or date.');
        } else if (!object(record) || (record.sets !== undefined && (!Array.isArray(record.sets) || record.sets.some(s => s !== null && !object(s))))) throw new Error('Invalid exercise record.');
      }
    }
  }
  for (const [date, food] of Object.entries(data.food)) if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !object(food)) throw new Error('Invalid food record.');
  function walk(value, depth = 0) {
    if (depth > 16) throw new Error('Backup nesting is too deep.');
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsafe backup field.');
      walk(child, depth + 1);
    }
  }
  walk(data);
  return data;
}
export function summary(data) {
  const count = key => Object.keys(data[key] || {}).length;
  return `${count('workouts')} workout records, ${count('food')} food days, ${count('previousPlanWorkouts') + count('sourcePlanWorkouts')} archived workouts`;
}
