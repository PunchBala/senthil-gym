import { MAX_BYTES, validateData } from './backup-schema.mjs';

const PATH = /^snapshots\/[a-zA-Z0-9-]{8,80}\/[a-zA-Z0-9-]+\.json$/;
const SHA = /^[a-f0-9]{40,64}$/;
const PREFIX = 'Senthil Gym backup\n\n';
export function repositoryName(value) {
  const name = String(value || '').trim().replace(/^https:\/\/github\.com\//i, '').replace(/\/$/, '');
  if (!/^[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+$/.test(name) || ['.', '..'].includes(name.split('/')[1])) throw new Error('Enter a GitHub repository as owner/repository.');
  return name;
}
function error(message, status) { return Object.assign(new Error(message), { status }); }
export function createGitHubBackup(config, fetcher = fetch) {
  const base = `https://api.github.com/repos/${repositoryName(config.repository)}`;
  async function api(path = '', options = {}) {
    const response = await fetcher(base + path, {
      ...options, cache: 'no-store', credentials: 'omit', redirect: 'error',
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${config.token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(options.body ? { 'Content-Type': 'application/json' } : {}) }, signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) {
      if (response.status === 401) throw error('GitHub token expired or was not accepted. Update Connection settings.', 401);
      if (response.status === 404) throw error('Repository or backup not found. Check the repository and token access.', 404);
      if (response.status === 403 || response.status === 429) {
        const limited = response.status === 429 || response.headers.get('Retry-After') || response.headers.get('X-RateLimit-Remaining') === '0';
        const retryAt = Number(response.headers.get('X-RateLimit-Reset')) * 1000;
        const failure = error(limited ? 'GitHub is limiting requests. Backup will retry later.' : 'GitHub denied access. The token needs Contents: read and write for this repository.', limited ? 429 : 403);
        failure.retryMs = Math.max(60000, Number(response.headers.get('Retry-After') || 0) * 1000, Number.isFinite(retryAt) ? retryAt - Date.now() : 0);
        throw failure;
      }
      throw error('GitHub backup request failed. Your local logs are saved.', response.status);
    }
    return response.json();
  }
  async function check(write = false) {
    const repo = await api();
    if (repo.private !== true || repo.visibility && repo.visibility !== 'private') throw error('Backup stopped: choose a private GitHub repository.', 403);
    if (repo.archived || repo.disabled) throw error('This repository is archived or disabled.', 403);
    if (write && repo.permissions?.push === false) throw error('The token needs Contents: read and write for this repository.', 403);
    return repo;
  }
  async function save(snapshot) {
    validateData(snapshot.data);
    if (snapshot.schemaVersion !== 1 || !/^[a-zA-Z0-9-]{8,80}$/.test(snapshot.deviceId)) throw error('Invalid backup format.', 400);
    const repo = await check(true);
    const createdAt = new Date().toISOString();
    const path = `snapshots/${snapshot.deviceId}/${createdAt.replace(/[:.]/g, '-')}-${crypto.randomUUID()}.json`;
    const bytes = new TextEncoder().encode(JSON.stringify({ ...snapshot, createdAt }));
    if (bytes.length > MAX_BYTES) throw error('Backup exceeds 2 MB.', 413);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const details = { path, deviceId: snapshot.deviceId, createdAt, size: bytes.length };
    const result = await api('/contents/' + path, { method: 'PUT', body: JSON.stringify({ message: PREFIX + JSON.stringify(details), content: btoa(binary), branch: repo.default_branch }) });
    return { key: `${result.commit.sha}:${path}`, createdAt: result.commit.committer?.date || createdAt };
  }
  async function list(cursor = null) {
    const repo = await check();
    let ref = repo.default_branch, page = 1;
    if (cursor) {
      const parts = cursor.split(':');
      if (parts.length !== 2 || !SHA.test(parts[0]) || !/^[1-9]\d{0,5}$/.test(parts[1])) throw error('Invalid backup page.', 400);
      [ref, page] = parts;
    }
    let commits;
    try { commits = await api(`/commits?path=snapshots&per_page=50&page=${page}&sha=${encodeURIComponent(ref)}`); }
    catch (failure) { if (failure.status === 409 && repo.size === 0) return { snapshots: [], cursor: null }; throw failure; }
    const snapshots = commits.flatMap(commit => {
      if (!SHA.test(commit.sha) || !commit.commit.message.startsWith(PREFIX)) return [];
      try {
        const info = JSON.parse(commit.commit.message.slice(PREFIX.length));
        if (!PATH.test(info.path) || info.path.split('/')[1] !== info.deviceId || !Number.isFinite(info.size)) return [];
        return [{ key: `${commit.sha}:${info.path}`, deviceId: info.deviceId, size: info.size, createdAt: commit.commit.committer.date }];
      } catch { return []; }
    });
    // Pin subsequent pages to one commit so new uploads cannot shift them.
    return { snapshots, cursor: commits.length === 50 ? `${cursor ? ref : commits[0].sha}:${Number(page) + 1}` : null };
  }
  async function get(key) {
    const split = key.indexOf(':'), ref = key.slice(0, split), path = key.slice(split + 1);
    if (!SHA.test(ref) || !PATH.test(path)) throw error('Invalid backup reference.', 400);
    await check();
    // Raw Contents API handles files above 1 MB without sending tokens to a download host.
    const response = await fetcher(base + '/contents/' + path + '?ref=' + ref, {
      cache: 'no-store', credentials: 'omit', redirect: 'error',
      headers: { Accept: 'application/vnd.github.raw+json', Authorization: `Bearer ${config.token}`, 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw error('Could not download this backup. Check token access and retry.', response.status);
    const text = await response.text();
    if (new TextEncoder().encode(text).length > MAX_BYTES) throw error('Backup exceeds 2 MB.', 413);
    const snapshot = JSON.parse(text);
    if (snapshot.schemaVersion !== 1) throw error('Unsupported backup format.', 400);
    validateData(snapshot.data);
    return snapshot;
  }
  return { check, save, list, get };
}
