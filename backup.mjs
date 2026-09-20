import { validateData, summary, MAX_BYTES } from './backup-schema.mjs';
import { createGitHubBackup, repositoryName } from './github-backup.mjs';

const adapter = globalThis.gymBackupAdapter;
const read = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
let config = read('sg-backup-config') || {};
let meta = read('sg-backup-meta') || {};
let timer, busy = false, message = '', retry = 10000, restoring = false;
let selected = null, selectedCurrent = '', snapshots = [], cursor = null;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const configured = () => config.provider === 'github' && !!(config.repository && config.token);
const transport = () => createGitHubBackup(config);
const current = () => JSON.stringify(adapter.getData());
async function hash(text) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join(''); }
function status() {
  if (message) return message;
  if (!configured()) return 'Cloud backup is not connected.';
  if (busy) return 'Backing up…';
  if (meta.pending) return navigator.onLine ? 'Pending backup' : 'Pending backup · offline';
  return meta.lastAt ? `Backed up ${new Date(meta.lastAt).toLocaleString()}` : 'Ready for first backup';
}
function updateStatus() { document.querySelectorAll('[data-backup-status]').forEach(el => el.textContent = status()); }
function persistMeta() { localStorage.setItem('sg-backup-meta', JSON.stringify(meta)); }
function schedule(delay = 3000) { clearTimeout(timer); if (configured() && !restoring) timer = setTimeout(() => upload(), Math.max(delay, (Date.parse(meta.lastAt) || 0) + 60000 - Date.now())); }
function changed() { meta.pending = true; message = ''; persistMeta(); updateStatus(); schedule(); }
async function upload(force = false) {
  if (!configured() || busy || restoring) return;
  clearTimeout(timer);
  if (!navigator.onLine) { meta.pending = true; persistMeta(); updateStatus(); return; }
  busy = true; message = ''; updateStatus();
  try {
    const text = current(), fingerprint = await hash(text);
    if (!force && fingerprint === meta.hash) { meta.pending = false; persistMeta(); return; }
    const data = validateData(JSON.parse(text));
    const deviceId = meta.deviceId || (meta.deviceId = crypto.randomUUID());
    persistMeta();
    const result = await transport().save({ schemaVersion: 1, deviceId, data });
    meta.hash = fingerprint; meta.lastAt = result.createdAt; meta.pending = current() !== text; persistMeta(); retry = 10000;
    if (meta.pending) schedule();
  } catch (error) {
    meta.pending = true; persistMeta();
    message = error.status ? error.message : 'Pending backup · upload failed. Your local logs are saved.';
    if (![400, 401, 403, 404, 413, 422].includes(error.status)) { schedule(error.retryMs || retry); retry = Math.min(retry * 2, 300000); }
  } finally { busy = false; updateStatus(); }
}
function panelHTML() {
  return `<div class="card stack"><h3>GitHub backup</h3><p class="muted" data-backup-status role="status">${escape(status())}</p>
    <div class="actions"><button class="action primary" data-backup-now ${!configured() ? 'disabled' : ''}>Back up now</button><button class="action" data-backup-list ${!configured() ? 'disabled' : ''}>Browse backups</button></div>
    <details><summary>Connection settings</summary><div class="stack" style="margin-top:10px"><label>Private backup repository<input data-backup-repository autocapitalize="none" spellcheck="false" placeholder="PunchBala/senthil-gym-backups" value="${escape(config.repository || '')}"></label><label>GitHub access token<input data-backup-token type="password" autocomplete="off" placeholder="${configured() ? 'Leave blank to keep current token' : 'Enter a fine-grained access token'}"></label><p class="mini">Choose only your private backup repository when creating the token, with Contents: read and write. The token stays on this device, outside logs and exports. Connect in the browser that holds your existing history.</p><div class="actions"><button class="action" data-backup-connect>Save connection</button><button class="action" data-backup-disconnect>Disconnect</button></div></div></details>
    <label class="action">Import JSON backup<input data-backup-file type="file" accept=".json,application/json"></label>
    <p class="mini">Saves locally immediately; backs up changes about once a minute while open. Pending changes retry when you reopen or reconnect. Restoring replaces this device’s history; other devices keep their own snapshots.</p>
    <div data-backup-results class="stack"></div></div>`;
}
function resultsHTML() {
  const el = document.querySelector('[data-backup-results]');
  if (!el) return;
  el.innerHTML = selected ? `<div class="setting-row"><h3>Restore preview</h3><p>${escape(summary(selected.data))}</p><p class="mini">${escape(selected.createdAt || 'Imported file')}</p><p class="muted">This replaces the logs on this device. A recovery copy of your current logs will be saved first.</p><button class="action danger" data-backup-restore>Restore this backup</button><button class="action" data-backup-cancel>Cancel</button></div>` : snapshots.map(s => `<button class="tile" data-backup-preview="${escape(s.key)}"><strong>${escape(new Date(s.createdAt).toLocaleString())}</strong><span>Device ${escape(s.deviceId.slice(0, 8))} · ${Math.ceil(s.size / 1024)} KB</span></button>`).join('') + (cursor ? '<button class="action" data-backup-more>Load older backups</button>' : '');
  el.querySelectorAll('[data-backup-preview]').forEach(b => b.onclick = () => action(async () => preview(await transport().get(b.dataset.backupPreview))));
  el.querySelector('[data-backup-more]')?.addEventListener('click', () => list(true));
  el.querySelector('[data-backup-cancel]')?.addEventListener('click', () => { selected = null; resultsHTML(); });
  el.querySelector('[data-backup-restore]')?.addEventListener('click', () => action(restore));
}
async function action(fn) { try { message = ''; await fn(); } catch (error) { message = error.message || 'Could not complete backup operation.'; } updateStatus(); }
function preview(snapshot) {
  if (snapshot.schemaVersion !== undefined && snapshot.schemaVersion !== 1) throw new Error('Unsupported backup format.');
  if (!adapter.getData().planVersion && snapshot.data?.planVersion) throw new Error('This backup uses a newer workout plan. Open it in the matching app version.');
  validateData(snapshot.data); selected = snapshot; selectedCurrent = current(); resultsHTML();
}
async function restore() {
  if (busy) throw new Error('Wait for the current backup to finish, then restore.');
  if (current() !== selectedCurrent) { selected = null; resultsHTML(); throw new Error('Your logs changed. Preview the backup again before restoring.'); }
  validateData(selected.data); restoring = true; clearTimeout(timer);
  try {
    // Fail closed if the recovery copy cannot be saved (for example, storage is full).
    localStorage.setItem('sg-before-restore', JSON.stringify({ app: 'Senthil Gym', exportedAt: new Date().toISOString(), data: adapter.getData() }));
    localStorage.setItem('sg-data', JSON.stringify(selected.data));
    location.reload();
  } catch (error) { restoring = false; schedule(); throw error; }
}
async function list(more = false) { await action(async () => { const result = await transport().list(more ? cursor : null); selected = null; snapshots = more ? [...snapshots, ...result.snapshots] : result.snapshots; cursor = result.cursor; resultsHTML(); if (!snapshots.length) message = 'No cloud backups yet. Use Back up now.'; }); }
function bind() {
  document.querySelector('[data-backup-now]')?.addEventListener('click', () => upload(true));
  document.querySelector('[data-backup-list]')?.addEventListener('click', () => list());
  document.querySelector('[data-backup-connect]')?.addEventListener('click', () => action(async () => {
    if (busy) throw new Error('Wait for the current backup to finish.');
    const repository = repositoryName(document.querySelector('[data-backup-repository]').value);
    const token = document.querySelector('[data-backup-token]').value.trim() || (configured() && repository === config.repository ? config.token : '');
    if (!/^github_pat_[a-zA-Z0-9_]{20,}$/.test(token || '')) throw new Error('Enter a fine-grained GitHub access token restricted to your backup repository.');
    const candidate = { provider: 'github', repository, token };
    busy = true;
    try { await createGitHubBackup(candidate).check(true); localStorage.setItem('sg-backup-config', JSON.stringify(candidate)); config = candidate; }
    finally { busy = false; }
    selected = null; snapshots = []; cursor = null;
    meta.hash = null; meta.lastAt = null; changed(); adapter.render(); await upload();
  }));
  document.querySelector('[data-backup-disconnect]')?.addEventListener('click', () => action(async () => {
    if (busy) throw new Error('Wait for the current backup to finish.');
    clearTimeout(timer); config = {}; localStorage.removeItem('sg-backup-config'); snapshots = []; selected = null; cursor = null; message = ''; adapter.render();
  }));
  document.querySelector('[data-backup-file]')?.addEventListener('change', event => action(async () => {
    const file = event.target.files[0]; if (!file) return;
    if (file.size > MAX_BYTES) throw new Error('Backup exceeds 2 MB.');
    preview(JSON.parse(await file.text()));
  }));
  resultsHTML();
  if (read('sg-before-restore')) {
    const el = document.querySelector('[data-backup-results]');
    if (el) { const button = document.createElement('button'); button.className = 'action'; button.textContent = 'Recover logs from before last restore'; button.onclick = () => action(async () => preview(read('sg-before-restore'))); el.append(button); }
  }
}
globalThis.GymBackup = { changed, panelHTML, bind };
window.addEventListener('online', () => { message = ''; schedule(0); updateStatus(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(0); });
window.addEventListener('storage', event => { if (['sg-data', 'sg-backup-config'].includes(event.key)) location.reload(); });
adapter.render();
if (configured()) { meta.pending = true; persistMeta(); schedule(0); }
