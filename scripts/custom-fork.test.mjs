import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import { backupData, restoreData } from "./custom-data.mjs";
import {
  checkPolicy,
  assertNewRelease,
  releaseVersion,
  verifyArtifacts,
  verifyUpdateFeed,
  workflows,
} from "./custom-release.mjs";
import { integrate } from "./custom-upstream-sync.mjs";

function temporary(t) {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-custom-test-"));
  t.after(() => NodeFS.rmSync(root, { recursive: true, force: true }));
  return root;
}

function repository(t) {
  const root = temporary(t);
  const git = (...args) =>
    NodeChildProcess.execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  NodeFS.mkdirSync(NodePath.join(root, ".github/workflows"), { recursive: true });
  NodeFS.writeFileSync(NodePath.join(root, ".github/workflows/ci.yml"), "original");
  NodeFS.writeFileSync(NodePath.join(root, "feature.txt"), "base\n");
  git("add", ".");
  git("commit", "-m", "base");
  git("branch", "custom");
  return { root, git };
}

NodeTest.test(
  "merges upstream while preserving custom features and suppressing upstream automation",
  (t) => {
    const { root, git } = repository(t);
    NodeFS.writeFileSync(NodePath.join(root, "upstream.txt"), "improvement");
    NodeFS.writeFileSync(NodePath.join(root, ".github/workflows/mobile.yml"), "on: push");
    NodeFS.writeFileSync(NodePath.join(root, ".github/workflows/ci.yml"), "upstream changes");
    git("add", ".");
    git("commit", "-m", "upstream");
    git("switch", "custom");
    NodeFS.writeFileSync(NodePath.join(root, "custom.txt"), "my feature");
    NodeFS.writeFileSync(NodePath.join(root, ".github/workflows/ci.yml"), "custom policy");
    git("add", ".");
    git("commit", "-m", "custom");
    const base = git("rev-parse", "HEAD");
    NodeAssert.deepEqual(integrate(root, base, "main").conflicts, []);
    NodeAssert.equal(NodeFS.readFileSync(NodePath.join(root, "custom.txt"), "utf8"), "my feature");
    NodeAssert.equal(
      NodeFS.readFileSync(NodePath.join(root, "upstream.txt"), "utf8"),
      "improvement",
    );
    NodeAssert.equal(
      NodeFS.readFileSync(NodePath.join(root, ".github/workflows/ci.yml"), "utf8"),
      "custom policy",
    );
    NodeAssert.ok(!NodeFS.existsSync(NodePath.join(root, ".github/workflows/mobile.yml")));
    git("merge-base", "--is-ancestor", "main", "HEAD");
    git("merge-base", "--is-ancestor", base, "HEAD");
    NodeAssert.equal(git("status", "--porcelain"), "");
  },
);

NodeTest.test(
  "aborts uncertain application conflicts without changing custom or upstream branches",
  (t) => {
    const { root, git } = repository(t);
    NodeFS.writeFileSync(NodePath.join(root, "feature.txt"), "upstream\n");
    git("commit", "-am", "upstream");
    const upstream = git("rev-parse", "HEAD");
    git("switch", "custom");
    NodeFS.writeFileSync(NodePath.join(root, "feature.txt"), "custom\n");
    git("commit", "-am", "custom");
    const base = git("rev-parse", "HEAD");
    NodeAssert.deepEqual(integrate(root, base, upstream).conflicts, ["feature.txt"]);
    NodeAssert.equal(git("rev-parse", "HEAD"), base);
    NodeAssert.equal(git("rev-parse", "custom"), base);
    NodeAssert.equal(git("rev-parse", "main"), upstream);
    NodeAssert.equal(NodeFS.readFileSync(NodePath.join(root, "feature.txt"), "utf8"), "custom\n");
    NodeAssert.equal(git("status", "--porcelain"), "");
  },
);

NodeTest.test("refuses reintroduced workflows", (t) => {
  const root = temporary(t);
  NodeFS.mkdirSync(NodePath.join(root, ".github/workflows"), { recursive: true });
  for (const name of workflows)
    NodeFS.writeFileSync(NodePath.join(root, ".github/workflows", name), "name: custom");
  checkPolicy(root);
  NodeFS.writeFileSync(NodePath.join(root, ".github/workflows/upstream-publish.yml"), "on: push");
  NodeAssert.throws(() => checkPolicy(root), /Unexpected workflow/);
});

NodeTest.test("versions increase across test and production runs and fit Windows fields", () => {
  const date = new Date("2026-10-11T00:00:00Z");
  NodeAssert.equal(releaseVersion("test", 12, date), "1.0.12-nightly.20261011.12");
  NodeAssert.equal(releaseVersion("production", 13, date), "1.0.13");
  NodeAssert.throws(() => releaseVersion("production", "1;echo bad"));
  NodeAssert.throws(() => releaseVersion("production", 65536));
  assertNewRelease("1.0.13", ["v0.0.45", "v1.0.12-nightly.20261011.12"]);
  NodeAssert.throws(() => assertNewRelease("1.0.12", ["v1.0.12-nightly.20261011.12"]));
  NodeAssert.throws(() => assertNewRelease("1.0.11", ["v1.0.12"]));
});

NodeTest.test("requires matching installer checksums, blockmaps and fork feed metadata", (t) => {
  const root = temporary(t);
  const version = "1.0.1";
  const name = `T3-Code-Custom-${version}-x64.exe`;
  const installer = Buffer.from("installer fixture");
  NodeFS.writeFileSync(NodePath.join(root, name), installer);
  NodeFS.writeFileSync(NodePath.join(root, `${name}.blockmap`), "blockmap fixture");
  NodeFS.writeFileSync(
    NodePath.join(root, "latest.yml"),
    `version: ${version}\nfiles:\n  - url: ${name}\npath: ${name}\nsha512: ${NodeCrypto.createHash("sha512").update(installer).digest("base64")}\n`,
  );
  NodeFS.mkdirSync(NodePath.join(root, "win-unpacked/resources"), { recursive: true });
  const feed = NodePath.join(root, "win-unpacked/resources/app-update.yml");
  NodeFS.writeFileSync(
    feed,
    "provider: github\nowner: DanielClxpz\nrepo: t3code\nupdaterCacheDirName: t3code-custom-updater\n",
  );
  NodeAssert.equal(verifyArtifacts(root, version, "production").length, 3);
  verifyUpdateFeed(NodeFS.readFileSync(feed, "utf8"));
  NodeFS.writeFileSync(feed, "provider: github\nowner: pingdotgg\nrepo: t3code\n");
  NodeAssert.throws(() => verifyUpdateFeed(NodeFS.readFileSync(feed, "utf8")));
  NodeFS.writeFileSync(NodePath.join(root, name), "changed installer");
  NodeAssert.throws(() => verifyArtifacts(root, version, "production"));
});

NodeTest.test(
  "backs up and restores data and the matching installer without overwriting either home",
  (t) => {
    const root = temporary(t);
    const source = NodePath.join(root, "source");
    NodeFS.mkdirSync(NodePath.join(source, "userdata"), { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(source, "userdata/statev2.sqlite"),
      "offline database fixture",
    );
    NodeFS.writeFileSync(NodePath.join(source, "userdata/settings.json"), '{"theme":"dark"}');
    const installer = NodePath.join(root, "old.exe");
    NodeFS.writeFileSync(installer, "matching installer");
    const backup = NodePath.join(root, "backup");
    backupData(source, backup, installer, "1.0.1");
    NodeAssert.throws(() => backupData(source, backup, installer, "1.0.1"), /must not exist/);
    const restored = restoreData(backup, NodePath.join(root, "restored"));
    NodeAssert.equal(restored.version, "1.0.1");
    NodeAssert.equal(
      NodeFS.readFileSync(NodePath.join(restored.home, "userdata/settings.json"), "utf8"),
      '{"theme":"dark"}',
    );
    NodeAssert.throws(() => restoreData(backup, source), /must not exist/);
    NodeFS.writeFileSync(NodePath.join(backup, "home/userdata/statev2.sqlite"), "corrupted");
    NodeAssert.throws(() => restoreData(backup, NodePath.join(root, "broken")), /Backup changed/);
    NodeAssert.ok(!NodeFS.existsSync(NodePath.join(root, "broken")));
  },
);
