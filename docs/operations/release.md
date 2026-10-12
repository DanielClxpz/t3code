# T3 Code Custom releases

This fork ships **Windows x64 only** from [DanielClxpz/t3code](https://github.com/DanielClxpz/t3code).
The desktop, web assets, contracts, and bundled server are built from the same commit and assigned
the same version. There is no npm publication or separate server upgrade for the desktop.

## One-time GitHub setup

1. Merge these changes into `custom`, then make `custom` the repository's default branch.
   Scheduled workflows run from the default branch. Until that switch, old workflows on `main`
   can still run. Do not merge upstream directly into the default branch.
2. Enable Actions. Under Settings > Actions > General, allow GitHub Actions to create pull requests.
   Keep the default token permission read-only; individual sync and publish jobs request write access.
3. Create an environment named `custom-production`. Add yourself as a required reviewer.
   Leave “Prevent self-review” off for a single-maintainer repository. Restrict deployment branches
   to `custom`. Production preflight refuses to proceed without a required reviewer.
4. Keep releases public so installed apps can download updates without embedding a GitHub token.
   No npm, Apple, Azure, Expo, Vercel, Cloudflare, or bot credentials are required.

The installer is unsigned. Windows may display an unknown-publisher prompt. Review the downloaded
file's SHA256SUMS before accepting it. Signing can be added later without changing the app ID.

## Publish a release

1. Open Actions > Release T3 Code Custom > Run workflow. Select the `custom` branch.
2. Choose `test` first. It publishes a GitHub prerelease for the app's existing **Nightly** channel.
   A production app on **Stable** does not receive it.
3. For production, back up the custom application's data with its currently installed installer,
   run the workflow with `production`, and approve the `custom-production` deployment after checks
   and the Windows build pass.

Versions are assigned automatically: production `1.0.<workflow-run-number>`, test
`1.0.<workflow-run-number>-nightly.<YYYYMMDD>.<workflow-run-number>`.
The next workflow run increases the version independently of upstream's package version.
The build updates package manifests in its temporary checkout only. Do not commit release version bumps.
Use a new workflow run after a publication failure rather than replacing an existing tag or release.
Keep this workflow's identity and version series stable.

The workflow builds once using `scripts/build-desktop-artifact.ts --platform win --target nsis --arch x64`.
It retains the native resource monitor and Windows native dependencies, verifies the bundled feed,
checks installer hashes, and installs the NSIS package on an ephemeral Windows runner to check
desktop and server versions. It uploads the installer, its blockmap, `latest.yml` (production)
or `nightly.yml` (test), and `SHA256SUMS`. It finishes uploading to a draft before publishing.
No standalone CLI archive is required by the local Windows backend.

## Application identity and update behavior

The installed app is **T3 Code Custom**, with package name `t3code-custom` and app ID
`io.github.danielclxpz.t3code.custom`. NSIS derives its own installer GUID from this ID.
Its default per-user installation directory is `%LOCALAPPDATA%\Programs\t3code-custom`,
and its shortcuts and executable use the custom name. Never change this identity after installing.

The app uses `%USERPROFILE%\.t3-custom\userdata` for server state and
`%USERPROFILE%\.t3-custom\electron` for its Chromium profile. Development profiles are separate.
Packaged startup ignores an inherited `T3CODE_HOME`. For an isolated test copy, set
`T3CODE_CUSTOM_HOME` before launching. Never set it to the official home or a junction to that home.
OAuth uses `t3code-custom://`, leaving official `t3code://` registration alone.

The upstream `DesktopUpdates` service and `electron-updater` still handle checks, notification,
download progress, backend shutdown, installation, and restart. The app checks at startup and
periodically; downloading and installing retain the normal in-app controls. Production builds embed
only the fork's GitHub feed. A runtime guard disables an unexpected repository feed.
The bundled server runs in desktop-managed mode, which delegates updates back to the desktop.
CLI archive lookups also target this fork, so they cannot silently download an official runtime.

This release pipeline does not publish SSH-managed CLI archives or a Linux WSL runtime.
Connecting to an already-running remote environment remains available subject to the existing wire
compatibility checks. Automatic SSH runtime installation has no matching archive in this fork.
The optional WSL backend is not part of the validated Windows-only release path; leave it disabled.
No mobile, macOS, or Linux source or dependency was removed.

## Daily upstream integration

`upstream-sync.yml` checks `pingdotgg/t3code:main` daily at 13:23 UTC and can be run manually.
It uses one `automation/upstream` branch and one draft PR targeting `custom`.
Existing commits and human fixes on that integration branch are retained through ordinary merges.
A concurrent push causes a safe push failure instead of a force push.

Before pushing, the helper restores the entire workflow directory from `custom`.
New upstream workflows are removed from the integration result, and upstream edits to retained
workflows are discarded. The same merge still records upstream ancestry, keeping future merges
incremental. A workflow allowlist check rejects any unexpected workflow file.

The sync workflow calls the essential checks explicitly on the integration SHA, without relying on
a token-created PR to trigger another workflow. It never merges the PR. Review custom behavior and
test results, mark the PR ready, and merge using a **merge commit**. Avoid squash/rebase for upstream
integration PRs because losing ancestry causes repeated integration work.

On conflicts, the helper aborts the merge and lists unresolved files in the draft PR.
It accepts no automatic code resolutions. An AI agent may fetch the PR branch, merge the documented
upstream SHA, and propose fixes. Review the diff, rerun the sync workflow and checks, and test affected
custom features before merging. Do not use blanket `ours` or `theirs` for application changes.
No paid agent token or autonomous conflict resolver is configured.

## Retained and removed workflows

Only three workflows remain:

- `ci.yml`: essential updater, identity, server-update, packaging, protocol, and compatibility checks.
  It runs on PRs into `custom`, explicit dispatch, and reusable calls. There is no push build.
  The Ubuntu runner is for shared-code tests, not Linux packaging.
- `release.yml`: manually requested Windows x64 NSIS build and gated GitHub publication.
- `upstream-sync.yml`: daily upstream check, integration draft PR, and explicit checks.

The following workflows were removed from the fork. Their originals remain in Git history:

- `release-desktop.yml`, `windows-tests.yml`: necessary Windows build steps moved into the single
  release workflow; duplicate/manual upstream lanes are unnecessary.
- `desktop-macos-preview.yml`, `desktop-macos-preview-publish.yml`, `publish-aur.yml`: other platforms.
- `mobile-android-apk.yml`, `mobile-eas-preview.yml`, `mobile-eas-production.yml`,
  `mobile-fingerprint-check.yml`, `mobile-showcase-screenshots.yml`: mobile builds and publishing.
- `deploy-relay.yml`, `web-preview.yml`: hosted infrastructure and preview deployment.
- `cursor-hygiene-webhook.yml`, `issue-labels.yml`, `pr-size.yml`, `pr-vouch.yml`,
  `thread-transfer-report.yml`: upstream-specific bots, moderation, and reporting.

The previous `release.yml` npm, CLI archive, macOS, Linux, ARM64, web, marketing, AUR, and Discord
jobs were removed. No standalone documentation publishing workflow existed in this checkout.
The local updater, compatible server bundle, Windows native dependency staging, NSIS blockmaps,
and shared compatibility tests must remain. Removing those would break the Windows app or updates.

## Copy data safely for testing

Never stop or alter the T3 Code instance hosting an agent. Do not uninstall the official app.
Never run a server against the live official `.t3\userdata` directory.

Use the existing read-only snapshot tool from this checkout, with a new isolated destination:

```powershell
node apps/server/scripts/migrate-dev-db.ts --base-dir "$env:TEMP\t3-custom-update-test" --projects 5 --threads-per-project 10
$env:T3CODE_CUSTOM_HOME = "$env:TEMP\t3-custom-update-test"
& "$env:LOCALAPPDATA\Programs\t3code-custom\T3 Code Custom.exe"
```

The snapshot keeps recent stopped threads and projects and removes active/pending work, scheduled
tasks, and auth sessions. It migrates the copy only. It is test data, not a full production backup.
For settings tests, copy only needed settings files into the new home. Do not copy saved remote
environments, startup work, or secrets unnecessarily. Copied projects still refer to real working
directories, so do not run agents or project scripts in those projects during verification.
Use a new fixture project for any write tests.

## Backup, migration, and rollback

The backup helper requires a stopped source and a new destination. It never deletes or overwrites
an existing directory and does not stop processes. When the official app hosts your agent, leave it
running and use the snapshot procedure above. A full offline backup or migration must wait for a
separate, explicitly approved maintenance session.

Before a major custom update or approved migration:

```powershell
# Close only T3 Code Custom first. Supply its currently installed version and matching installer.
node scripts/custom-data.mjs backup "$env:USERPROFILE\.t3-custom" "D:\T3Backups\before-1.0.12" "D:\Downloads\T3-Code-Custom-1.0.11-x64.exe" 1.0.11 --stopped
```

Choose an existing parent directory for the new backup. The helper copies the complete home,
including settings, sessions, profiles, and database sidecars, plus the matching installer. It records
file hashes and the application version. Store backups privately because they can contain credentials.
Keep provider-owned credentials and project working directories backed up separately.

For rollback, close the custom app, preserve its failed-update home, and restore into a **new** home:

```powershell
node scripts/custom-data.mjs restore "D:\T3Backups\before-1.0.12" "$env:USERPROFILE\.t3-custom-restored" --stopped
$env:T3CODE_CUSTOM_HOME = "$env:USERPROFILE\.t3-custom-restored"
$env:T3CODE_DISABLE_AUTO_UPDATE = "true"
```

After separately approving replacement of the installed custom application, install the backup's
`installer.exe` and launch it with those environment variables. Restore application and database
together. Never run an older executable against the database already migrated by a newer version.
The restore helper validates every stored file hash and refuses existing destinations.
No script performs an in-place production migration.

A full migration from official T3 Code requires your approval and an offline backup made while its
own server is stopped. Restore into a new custom home, bring over only required profile/credential
material, and validate it before making it your regular home. Windows credentials may require
sign-in again because the custom application has a separate Chromium identity.
Do not run both applications against one database.

## Complete update acceptance test

Use two consecutive `test` workflow runs and copied data before publishing production.

1. Download and install the older test build independently. Launch with the isolated
   `T3CODE_CUSTOM_HOME`. Confirm the custom shortcut, installation path, app name, and copied
   conversations, projects, and chosen settings. Record the installed version.
2. Publish the next test run. In the custom app, select Nightly and check for updates.
   Confirm the offered version and that release assets come from `DanielClxpz/t3code`.
3. Download and install through the normal UI. Confirm restart, the newer version, preserved copied
   data, and that the official app and its data have not changed.
4. Exercise backup/restore with the same copied data and matching older installer.
   Only then approve a production release or production migration.

The CI installer smoke proves installation and packaged version alignment. It does not by itself
prove an interactive update, successful app startup with real copied data, or data survival.
Record those acceptance results in the release review, not as an assumed consequence of unit tests.
