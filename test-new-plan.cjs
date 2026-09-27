const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('index.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const plan=JSON.parse(fs.readFileSync('plans/weeks-2-4.json'));
function app(data={planVersion:'adapted-8-week-v2',workouts:{},food:{},settings:{unit:'kg'}}){
 let stored=structuredClone(data);
 const ctx=vm.createContext({localStorage:{getItem:k=>k==='sg-data'?JSON.stringify(stored):null,setItem:(k,v)=>{if(k==='sg-data')stored=JSON.parse(v)}},document:{getElementById:()=>({}),querySelectorAll:()=>[],querySelector:()=>null},navigator:{},structuredClone,console,setInterval:()=>1,clearInterval(){}});
 vm.runInContext(source,ctx);
 return {run:c=>vm.runInContext(c,ctx),data:()=>stored};
}
const a=app();
assert.deepEqual(JSON.parse(a.run('JSON.stringify(suppliedPlan)')),plan);
for(const week of plan.weeks) for(const session of week.sessions){
 const w=week.week+1,d=Number(session.sessionId.split('-')[1]);
 const day=JSON.parse(a.run(`JSON.stringify(planDay(${w},${d}))`));
 assert.equal(day.focus,session.title);
 assert.deepEqual(day.items.map(i=>i.prescription),session.exercises);
 a.run(`state.week=${w};state.day=${d}`);
 const html=a.run('workoutHTML()');
 assert.ok(html.includes('Actual reps')&&html.includes('Actual RIR')&&html.includes('Shoulder sensation'));
 assert.ok(!html.includes('If three sets are shown'));
 assert.ok(!html.includes('Original workbook reference'));
 assert.ok(!html.includes('(optional) weight'));
 const total=session.exercises.filter(e=>!e.optional).reduce((sum,e)=>sum+(e.kind==='cardio'?1:e.sets),0);
 assert.equal(a.run(`completedStats(${w},${d}).total`),total);
}
for(const w of [1,5,6,7,8]) for(let d=1;d<=7;d++)assert.equal(a.run(`JSON.stringify(planDay(${w},${d}))===JSON.stringify(adaptedPlanDay(${w},${d}))`),true);
assert.equal(a.run('nextSession(2,1).day'),2);
assert.equal(a.run('planDay(2,6).items.length'),0);
a.run('updateMetric("w3d1|seated-cable-row|2","reps","11"); updateMetric("w3d1|seated-cable-row|2","rir","2"); updateMetric("w3d1|seated-cable-row|2","shoulderSensation0to10","1");updateMetric("w3d1|seated-cable-row|2","note","Controlled"); updateWeight("w3d1|seated-cable-row|2","32.5");toggleSet("w3d1|seated-cable-row|2");updateMetric("w3d1|treadmill-walk|cardio","durationMinutes","8")');
const b=app(a.data());
const row=JSON.parse(b.run('JSON.stringify(exportRows().find(r=>r.week===3&&r.gymDay===1&&r.exercise==="Seated Cable Row"&&r.set===3))'));
assert.equal(row.reps,'11');assert.equal(row.rir,'2');assert.equal(row.shoulderSensation0to10,'1');assert.equal(row.setNote,'Controlled');assert.equal(row.weight,'32.5');assert.equal(row.completed,true);
assert.equal(b.run('exportRows().find(r=>r.week===3&&r.gymDay===1&&r.exercise==="Treadmill Walk").durationMinutes'),'8');
const old={planVersion:'adapted-8-week-v2',workouts:{w1d1:{'seated-cable-row':{sets:[{weight:'30',done:true}]}},w2d1:{'leg-press':{sets:[{weight:'80',done:true}]},dayNote:'keep'}},food:{},settings:{unit:'kg'}};
const c=app(old);
assert.deepEqual(c.data().workouts.w1d1,old.workouts.w1d1);
assert.deepEqual(c.data().workouts.w2d1['leg-press'],old.workouts.w2d1['leg-press']);
assert.equal(c.run('planDay(2,1).focus'),'Core + legs + pulling');
assert.equal(c.run('exportRows().find(r=>r.week===2&&r.gymDay===1&&r.exercise==="Leg Press").weight'),'80');
assert.equal(app(c.data()).run('planDay(2,1).focus'),'Core + legs + pulling');
(async()=>{const {validateData}=await import('./backup-schema.mjs');validateData(a.data());validateData(c.data());console.log('Passed: all 15 source sessions, week mapping, exact prescriptions, required sets, historical snapshots, new metrics, exports, reload and backup validation.');})();
