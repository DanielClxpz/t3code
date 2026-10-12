import * as NodeAssert from "node:assert/strict";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeChildProcess from "node:child_process";

export const workflows = ["ci.yml", "release.yml", "upstream-sync.yml"];

export function checkPolicy(root = ".") {
  const actual = NodeFS.readdirSync(NodePath.join(root, ".github/workflows")).sort();
  NodeAssert.deepEqual(
    actual,
    [...workflows].sort(),
    "Unexpected workflow. Review upstream automation before enabling it.",
  );
  for (const file of actual) {
    const text = NodeFS.readFileSync(NodePath.join(root, ".github/workflows", file), "utf8");
    NodeAssert.ok(
      !/pull_request_target:|blacksmith-|secrets\.(?!GITHUB_TOKEN)|npm publish|--platform (mac|linux)|--arch arm64/.test(
        text,
      ),
      `Disallowed automation in ${file}`,
    );
  }
}

export function releaseVersion(channel, runNumber, date = new Date()) {
  NodeAssert.ok(["test", "production"].includes(channel), "Select test or production");
  NodeAssert.ok(
    /^[1-9]\d{0,4}$/.test(String(runNumber)) && Number(runNumber) < 65536,
    "Run number must fit Windows version fields",
  );
  const base = `1.0.${runNumber}`;
  return channel === "production"
    ? base
    : `${base}-nightly.${date.toISOString().slice(0, 10).replaceAll("-", "")}.${runNumber}`;
}

export function assertNewRelease(version, tags) {
  const next = version.split("-")[0].split(".").map(Number);
  for (const tag of tags) {
    const match = /^v(\d+)\.(\d+)\.(\d+)(?:-|$)/.exec(tag);
    if (!match) continue;
    const previous = match.slice(1).map(Number);
    const difference = next.map((part, index) => part - previous[index]).find((part) => part !== 0);
    NodeAssert.ok(difference > 0, `Version must exceed published release ${tag}`);
  }
}

export function verifyArtifacts(directory, version, channel) {
  const installer = `T3-Code-Custom-${version}-x64.exe`;
  const manifest = channel === "production" ? "latest.yml" : "nightly.yml";
  const names = [installer, `${installer}.blockmap`, manifest];
  for (const name of names)
    NodeAssert.ok(NodeFS.statSync(NodePath.join(directory, name)).size > 0, `Empty asset: ${name}`);
  const yaml = NodeFS.readFileSync(NodePath.join(directory, manifest), "utf8");
  const value = (key) =>
    yaml.match(new RegExp(`^${key}:\\s*['"]?([^'"\\r\\n]+)`, "m"))?.[1]?.trim();
  NodeAssert.equal(value("version"), version);
  NodeAssert.equal(value("path"), installer);
  NodeAssert.ok(yaml.includes(`url: ${installer}`), "Manifest must list the x64 installer");
  const bytes = NodeFS.readFileSync(NodePath.join(directory, installer));
  NodeAssert.equal(value("sha512"), NodeCrypto.createHash("sha512").update(bytes).digest("base64"));
  return names;
}

export function verifyUpdateFeed(feed) {
  NodeAssert.match(feed, /^provider: github\s*$/m);
  NodeAssert.match(feed, /^owner: DanielClxpz\s*$/m);
  NodeAssert.match(feed, /^repo: t3code\s*$/m);
  NodeAssert.match(feed, /updaterCacheDirName: t3code-custom-updater/);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "policy") {
    checkPolicy();
    console.log("Only the three custom workflows are enabled.");
  } else if (command === "version") {
    const [channel, run] = args;
    const version = releaseVersion(channel, run);
    const pages = JSON.parse(
      NodeChildProcess.execFileSync(
        "gh",
        [
          "api",
          `repos/${process.env.GITHUB_REPOSITORY}/releases?per_page=100`,
          "--paginate",
          "--slurp",
        ],
        { encoding: "utf8" },
      ),
    );
    assertNewRelease(
      version,
      pages.flat().map((release) => release.tag_name),
    );
    NodeFS.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\ntag=v${version}\n`);
    console.log(version);
  } else if (command === "verify") {
    const [directory, version, channel] = args;
    const names = verifyArtifacts(directory, version, channel);
    const hashes = names
      .map(
        (name) =>
          `${NodeCrypto.createHash("sha256")
            .update(NodeFS.readFileSync(NodePath.join(directory, name)))
            .digest("hex")}  ${NodePath.basename(name)}`,
      )
      .join("\n");
    NodeFS.writeFileSync(NodePath.join(directory, "SHA256SUMS"), `${hashes}\n`);
    console.log(`Verified ${names.join(", ")}`);
  } else {
    throw new Error(
      "Usage: custom-release.mjs policy | version <test|production> <run> | verify <directory> <version> <channel>",
    );
  }
}

if (process.argv[1] && import.meta.url === NodeURL.pathToFileURL(process.argv[1]).href)
  await main();
