import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createGitHubBackup, repositoryName } from './github-backup.mjs';
import { validateData, summary, MAX_BYTES } from './backup-schema.mjs';
const data = () => ({ planVersion: 'adapted-8-week-v2', workouts: { w1d1: { squat: { sets: [{ weight: '30', done: true }] }, dayNote: 'தமிழ் 🏋️ <script>literal note</script>' } }, food: { '2026-09-19': { breakfast: true } }, settings: { unit: 'kg' }, previousPlanWorkouts: { w1d2: { row: { sets: [{ weight: '10' }] } } } });
const config = { provider: 'github', repository: 'PunchBala/senthil-gym-backups', token: 'github_pat_' + 'a'.repeat(48) };
const files = new Map(), commits = [], requests = [];
let isPrivate = true, rejected = 0, fail = false, duringUpload, pageResponse, holdCheck;
async function fakeFetch(raw, options = {}) {
  const url = new URL(raw); requests.push({ url, options });
  if (holdCheck && url.pathname === '/repos/' + config.repository) await holdCheck;
  assert.equal(url.origin, 'https://api.github.com');
  assert.equal(options.headers.Authorization, `Bearer ${config.token}`);
  assert.equal(options.redirect, 'error');
  if (fail) throw new Error('Offline');
  if (rejected) return Response.json({}, { status: rejected, headers: rejected === 429 ? { 'Retry-After': '120' } : {} });
  if (url.pathname === '/repos/' + config.repository) return Response.json({ private: isPrivate, visibility: isPrivate ? 'private' : 'public', default_branch: 'main', permissions: { push: true } });
  if (options.method === 'PUT') {
    const body = JSON.parse(options.body);
    assert.equal(body.sha, undefined, 'Never update an older snapshot');
    assert.equal(body.branch, 'main');
    const sha = (commits.length + 1).toString(16).padStart(40, '0'), date = new Date().toISOString();
    const snapshot = Buffer.from(body.content, 'base64').toString('utf8');
    const path = url.pathname.split('/contents/')[1];
    files.set(`${sha}:${path}`, snapshot);
    commits.unshift({ sha, commit: { message: body.message, committer: { date } } });
    if (duringUpload) { duringUpload(); duringUpload = null; }
    return Response.json({ commit: { sha, committer: { date } } }, { status: 201 });
  }
  if (url.pathname.endsWith('/commits')) return Response.json(pageResponse || commits);
  const path = url.pathname.split('/contents/')[1];
  assert.equal(options.headers.Accept, 'application/vnd.github.raw+json');
  return new Response(files.get(`${url.searchParams.get('ref')}:${path}`));
}
const github = createGitHubBackup(config, fakeFetch);
const legacy = data(); delete legacy.planVersion;
assert.equal(validateData(legacy), legacy, 'Existing published logs need no migration to back up');
assert.equal(repositoryName('https://github.com/PunchBala/senthil-gym-backups/'), config.repository);
for (const value of ['https://evil.example/repo', '../repo', 'owner/repo?token=secret', 'owner/..']) assert.throws(() => repositoryName(value));
assert.throws(() => validateData(JSON.parse('{"workouts":{},"food":{},"settings":{},"planVersion":"adapted-8-week-v2","__proto__":{}}')), /Unsafe/);
assert.throws(() => validateData({ ...data(), planVersion: 'future-plan' }), /Unsupported/);
isPrivate = false;
await assert.rejects(github.save({ schemaVersion: 1, deviceId: 'device-one', data: data() }), /private/);
assert.equal(files.size, 0, 'Public repository rejected before sending logs');
isPrivate = true;
const first = await github.save({ schemaVersion: 1, deviceId: 'device-one', data: data() });
const empty = data(); empty.workouts = {};
await github.save({ schemaVersion: 1, deviceId: 'device-two', data: empty });
assert.equal(files.size, 2);
assert.deepEqual((await github.get(first.key)).data, data(), 'Historical Unicode snapshot round-trips');
assert.equal((await github.list()).snapshots.length, 2);
await assert.rejects(github.get('https://evil.example'), /Invalid/);
const large = data(); large.shoulderRecovery = 'a'.repeat(MAX_BYTES);
await assert.rejects(github.save({ schemaVersion: 1, deviceId: 'device-one', data: large }), /large|2 MB/);
pageResponse = Array.from({ length: 50 }, (_, i) => ({ ...commits[0], sha: (100 + i).toString(16).padStart(40, '0') }));
const page = await github.list(); assert.ok(page.cursor.endsWith(':2'));
await github.list(page.cursor);
assert.equal(requests.at(-1).url.searchParams.get('sha'), pageResponse[0].sha);
assert.equal(requests.at(-1).url.searchParams.get('page'), '2');
pageResponse = null;
rejected = 401; await assert.rejects(github.check(), /expired/);
rejected = 429; await assert.rejects(github.check(), e => e.status === 429 && e.retryMs >= 120000);
rejected = 0;

const storage = new Map([['sg-backup-config', JSON.stringify(config)]]);
let live = data(), reloaded = false, denyRecovery = false;
const timers = new Map(); let nextTimer = 0;
const listeners = {};
const context = vm.createContext({
  crypto, TextEncoder, URL, AbortSignal, console,
  navigator: { onLine: true },
  localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => { if (denyRecovery && k === 'sg-before-restore') throw new Error('Quota exceeded'); storage.set(k, v); }, removeItem: k => storage.delete(k) },
  gymBackupAdapter: { getData: () => live, render() {} },
  document: { querySelectorAll: () => [], querySelector: () => null, addEventListener() {} },
  window: { addEventListener: (event, fn) => listeners[event] = fn },
  location: { reload: () => reloaded = true },
  setTimeout: (fn, ms) => { timers.set(++nextTimer, { fn, ms }); return nextTimer; }, clearTimeout: id => timers.delete(id)
});
const source = new vm.SourceTextModule(readFileSync('backup.mjs', 'utf8') + '\nexport { upload, preview, restore };', { context });
const schema = new vm.SyntheticModule(['validateData', 'summary', 'MAX_BYTES'], function () { this.setExport('validateData', validateData); this.setExport('summary', summary); this.setExport('MAX_BYTES', MAX_BYTES); }, { context });
const provider = new vm.SyntheticModule(['createGitHubBackup', 'repositoryName'], function () { this.setExport('createGitHubBackup', cfg => createGitHubBackup(cfg, fakeFetch)); this.setExport('repositoryName', repositoryName); }, { context });
await source.link(path => path.includes('github-backup') ? provider : schema); await source.evaluate();
await source.namespace.upload(); assert.equal(files.size, 3, 'Existing logs uploaded at first connection');
await source.namespace.upload(); assert.equal(files.size, 3, 'Unchanged data skipped');
context.navigator.onLine = false; live.shoulderRecovery = 'offline edit'; context.GymBackup.changed(); await source.namespace.upload();
assert.equal(files.size, 3); assert.equal(JSON.parse(storage.get('sg-backup-meta')).pending, true);
context.navigator.onLine = true; fail = true; await source.namespace.upload();
assert.ok([...timers.values()].some(t => t.ms >= 10000));
fail = false; duringUpload = () => live.shoulderRecovery = 'new edit during request'; await source.namespace.upload();
assert.equal(JSON.parse(storage.get('sg-backup-meta')).pending, true);
assert.ok([...timers.values()].some(t => t.ms > 50000), 'Automatic uploads spaced by one minute');
await source.namespace.upload(); assert.equal(JSON.parse(storage.get('sg-backup-meta')).pending, false);
// Exercise the actual connection button handler, including feedback while awaiting GitHub.
const elements = new Map();
for (const key of ['repository','token','connect','connect-status','status']) elements.set(`[data-backup-${key}]`, {value:'',textContent:'',addEventListener(event,fn){this[event]=fn;}});
context.document.querySelector = selector => elements.get(selector) || null;
context.document.querySelectorAll = selector => elements.has(selector) ? [elements.get(selector)] : [];
context.GymBackup.bind();
const connectButton=elements.get('[data-backup-connect]');
await connectButton.click();
assert.match(elements.get('[data-backup-connect-status]').textContent,/owner\/repository/);
elements.get('[data-backup-repository]').value=config.repository;
elements.get('[data-backup-token]').value=config.token;
let releaseCheck;
holdCheck=new Promise(resolve=>releaseCheck=resolve);
const connecting=connectButton.click();
assert.equal(connectButton.textContent,'Connecting…');
assert.equal(connectButton.disabled,true);
assert.match(elements.get('[data-backup-connect-status]').textContent,/Checking GitHub/);
releaseCheck(); holdCheck=null; await connecting;
assert.equal(connectButton.disabled,false);
assert.match(elements.get('[data-backup-status]').textContent,/Backed up/);
rejected=401; await connectButton.click(); rejected=0;
assert.match(elements.get('[data-backup-connect-status]').textContent,/expired/);
assert.equal(connectButton.disabled,false);
context.document.querySelector=()=>null;
context.document.querySelectorAll=()=>[];
source.namespace.preview({ data: data() }); live.shoulderRecovery = 'edit after preview';
await assert.rejects(source.namespace.restore(), /logs changed/); assert.equal(reloaded, false);
source.namespace.preview({ data: data() }); denyRecovery = true;
await assert.rejects(source.namespace.restore(), /Quota/); assert.equal(storage.has('sg-data'), false);
denyRecovery = false; await source.namespace.restore();
assert.equal(JSON.parse(storage.get('sg-before-restore')).data.shoulderRecovery, 'edit after preview');
assert.deepEqual(JSON.parse(storage.get('sg-data')), data()); assert.equal(reloaded, true);
assert.ok(![...files.values()].join('').includes(config.token));
console.log('Passed: private repository enforcement, token failures, Unicode snapshots, historical restore, stable pagination, rate limits, initial upload, deduplication, offline retries, upload throttling, concurrent edits, restore recovery and quota protection.');
