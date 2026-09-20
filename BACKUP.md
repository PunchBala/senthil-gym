# GitHub backups

The app now backs up directly to a separate **private GitHub repository**. No Cloudflare, Netlify, server or hosting subscription is required. The app itself stays at its existing URL so the browser can still read existing logs.

## Connect once per device

1. Create `senthil-gym-backups` under your GitHub account. Select **Private**, and initialise it with a README. Keep the repository private.
2. In GitHub **Settings → Developer settings → Personal access tokens → Fine-grained tokens**, create a token. Select **Only select repositories → senthil-gym-backups** and grant **Contents: Read and write**. Leave other permissions unset. Set an expiry you can manage; reconnect with a new token when it expires.
3. Open the updated gym app in the browser holding your existing logs. In **More → GitHub backup → Connection settings**, enter `PunchBala/senthil-gym-backups` and the token. The app checks that the repository is private before saving the connection and uploading.
4. Wait for **Backed up**, then use **Browse backups** to preview the initial snapshot. Do not clear existing local logs until the backup is verified.

Enter the token directly in the app. Do not put it in chat, source code, exports or the backup repository. It is stored separately from logs in this browser. **Disconnect** removes the local token; revoke it in GitHub to remove its access entirely. A private repository alone does not encrypt files against the account owner, authorised collaborators or GitHub.

## Behaviour

- Local saves are immediate. After a short pause, changed data is uploaded, with automatic uploads spaced at least a minute apart. **Back up now** bypasses this spacing.
- Every upload includes current and archived workout logs, food records, settings and notes. Tokens are excluded.
- Each snapshot has its own file under `snapshots/<device-id>/`. Restore downloads the file at its original Git commit, preserving history even if a file is edited later.
- There is no app endpoint to delete cloud backups. Empty local history creates a new snapshot and does not replace earlier files.
- The app verifies repository privacy before every cloud operation and refuses a public destination.
- Offline edits remain local. Failed requests retry while the app is open, on reconnect, or on reopening. Delivery while the app is closed is not guaranteed.
- GitHub rate limits are respected; expired tokens and permission errors are shown in the status area.
- Backups are listed 50 at a time. Older pages use a fixed commit to avoid shifting when another backup arrives.
- Restore validates the snapshot, displays record counts and saves a local recovery copy before replacement. If the recovery save fails, restore stops. The recovery button restores the logs from before the last restore.
- Existing JSON exports can also be imported through the same preview flow.
- Each backup is capped at 2 MB. Each upload adds a Git commit and file; this is intended for a small personal log, not large media or high-frequency telemetry.

## Publish and test

Publish these app files together: `index.html`, `service-worker.js`, `backup.mjs`, `backup-schema.mjs`, `github-backup.mjs`, `manifest.json`, `icon.svg`.

```
node test-exercise-bests.cjs
node test-original-plan.cjs
node --experimental-vm-modules test-backup.mjs
```

The tests simulate the GitHub API. Live verification still requires the private repository, restricted token and app browser that contains the real logs.

The app includes the adapted eight-week plan. Existing workouts from earlier plan versions are preserved in archives and included in JSON/CSV exports and GitHub backups. Food records remain in place. The earlier local `cloud/` prototype is unused and need not be installed or deployed.
