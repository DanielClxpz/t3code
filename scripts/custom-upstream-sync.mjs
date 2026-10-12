import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";

const branch = "automation/upstream";
const git = (cwd, ...args) =>
  NodeChildProcess.execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/** Merge normally, retaining human fixes on the integration branch. Never reset a remote branch. */
export function integrate(cwd, base, upstream, existing) {
  git(cwd, "switch", "-c", branch, existing ?? base);
  const attempt = (ref) => {
    const result = NodeChildProcess.spawnSync("git", ["merge", "--no-ff", "--no-commit", ref], {
      cwd,
      encoding: "utf8",
    });
    // Remove new upstream workflows and restore modified/deleted ones before any push.
    git(cwd, "restore", `--source=${base}`, "--staged", "--worktree", "--", ".github/workflows");
    const conflicts = git(cwd, "diff", "--name-only", "--diff-filter=U");
    if (conflicts) {
      git(cwd, "merge", "--abort");
      return conflicts.split("\n");
    }
    const merging = NodeChildProcess.spawnSync("git", ["rev-parse", "--verify", "MERGE_HEAD"], {
      cwd,
    });
    if (merging.status === 0) {
      git(cwd, "commit", "-m", `chore: integrate ${ref} for T3 Code Custom`);
    } else if (result.status !== 0) {
      throw new Error(
        result.stderr || result.stdout || "Merge failed before creating a merge state",
      );
    } else if (git(cwd, "diff", "--cached", "--name-only")) {
      git(cwd, "commit", "-m", "ci: retain custom workflow policy");
    }
    return [];
  };
  const conflicts = attempt(base);
  if (conflicts.length) return { conflicts, phase: "custom" };
  return { conflicts: attempt(upstream), phase: "upstream" };
}

async function main() {
  const cwd = process.cwd();
  const repository = process.env.GITHUB_REPOSITORY;
  if (repository !== "DanielClxpz/t3code")
    throw new Error("Refusing to synchronize another repository");
  git(cwd, "config", "user.name", "github-actions[bot]");
  git(cwd, "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com");
  git(cwd, "fetch", "origin", "custom");
  git(cwd, "fetch", "https://github.com/pingdotgg/t3code.git", "main");
  const upstream = git(cwd, "rev-parse", "FETCH_HEAD");
  const base = git(cwd, "rev-parse", "origin/custom");
  if (
    NodeChildProcess.spawnSync("git", ["merge-base", "--is-ancestor", upstream, base], { cwd })
      .status === 0
  ) {
    NodeFS.appendFileSync(process.env.GITHUB_OUTPUT, "changed=false\n");
    return;
  }
  const gh = (...args) =>
    NodeChildProcess.execFileSync("gh", args, { cwd, encoding: "utf8" }).trim();
  const prs = JSON.parse(
    gh(
      "pr",
      "list",
      "--repo",
      repository,
      "--base",
      "custom",
      "--head",
      branch,
      "--state",
      "open",
      "--json",
      "number,url,isDraft",
    ),
  );
  const remote = git(cwd, "ls-remote", "--heads", "origin", `refs/heads/${branch}`);
  let existing;
  if (remote) {
    git(cwd, "fetch", "origin", branch);
    existing = git(cwd, "rev-parse", "FETCH_HEAD");
  }
  if (
    existing &&
    prs.length &&
    process.env.GITHUB_EVENT_NAME === "schedule" &&
    [base, upstream].every(
      (ref) =>
        NodeChildProcess.spawnSync("git", ["merge-base", "--is-ancestor", ref, existing], { cwd })
          .status === 0,
    )
  ) {
    NodeFS.appendFileSync(process.env.GITHUB_OUTPUT, "changed=false\n");
    return;
  }
  const result = integrate(cwd, base, upstream, existing);
  // An empty commit lets a conflict-only attempt have a draft PR without inventing resolutions.
  if (git(cwd, "rev-parse", "HEAD") === base) {
    git(
      cwd,
      "commit",
      "--allow-empty",
      "-m",
      `chore: review upstream ${upstream.slice(0, 12)} conflicts`,
    );
  }
  // An ordinary push fails safely if somebody changed the branch concurrently.
  git(cwd, "push", "origin", `HEAD:refs/heads/${branch}`);
  const sha = git(cwd, "rev-parse", "HEAD");
  gh(
    "api",
    `repos/${repository}/statuses/${sha}`,
    "--method",
    "POST",
    "-f",
    "state=pending",
    "-f",
    "context=Custom upstream checks",
    "-f",
    "description=Waiting for integration verification",
    "-f",
    `target_url=${process.env.GITHUB_SERVER_URL}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  );
  const status = result.conflicts.length
    ? `Merge blocked during ${result.phase} integration. No conflict resolution was accepted.\n\nConflicting files:\n${result.conflicts.map((f) => `- \`${f}\``).join("\n")}`
    : "Merge completed. The upstream-sync workflow runs the essential checks on this exact commit. Review the changes and check results before merging.";
  const body = `Upstream: https://github.com/pingdotgg/t3code/commit/${upstream}\nCustom base: ${base}\nIntegration commit: ${sha}\n\n${status}\n\nThe custom workflow directory is preserved. No automatic merge is enabled.\n\nFor conflicts, an AI agent may investigate on this branch and propose a resolution. Review every resolution, rerun upstream sync, and require successful checks before marking this draft ready. Never use a blanket ours/theirs resolution for application code.\n\nGenerated by the T3 Code Custom upstream-sync workflow. No AI model was used for this merge.`;
  const bodyPath = `${process.env.RUNNER_TEMP}/custom-sync-pr.md`;
  NodeFS.writeFileSync(bodyPath, body);
  if (prs.length) {
    gh("pr", "edit", String(prs[0].number), "--repo", repository, "--body-file", bodyPath);
    if (!prs[0].isDraft) gh("pr", "ready", String(prs[0].number), "--repo", repository, "--undo");
  } else {
    gh(
      "pr",
      "create",
      "--repo",
      repository,
      "--base",
      "custom",
      "--head",
      branch,
      "--draft",
      "--title",
      "chore: integrate upstream into custom",
      "--body-file",
      bodyPath,
    );
  }
  NodeFS.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `changed=true\nsha=${sha}\nconflicts=${result.conflicts.length > 0}\n`,
  );
  NodeFS.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${status}\n\nCommit: ${sha}\n`);
}

if (process.argv[1] && import.meta.url === NodeURL.pathToFileURL(process.argv[1]).href)
  await main();
