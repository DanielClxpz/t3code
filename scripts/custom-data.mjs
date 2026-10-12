import * as NodeAssert from "node:assert/strict";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeURL from "node:url";

function independent(source, destination) {
  const from = NodeFS.realpathSync(source);
  // Resolve the destination's existing parent too, so a junction cannot redirect the copy.
  const to = NodePath.join(
    NodeFS.realpathSync(NodePath.dirname(NodePath.resolve(destination))),
    NodePath.basename(destination),
  );
  const rel = NodePath.relative(from, to);
  NodeAssert.ok(
    rel === ".." || rel.startsWith(`..${NodePath.sep}`) || NodePath.isAbsolute(rel),
    "Destination must be outside the source",
  );
  NodeAssert.ok(
    !NodeFS.existsSync(to),
    "Destination must not exist. This tool never overwrites data.",
  );
  return { from, to };
}

function files(directory, prefix = "") {
  return NodeFS.readdirSync(directory).flatMap((name) => {
    const path = NodePath.join(directory, name);
    const stat = NodeFS.lstatSync(path);
    NodeAssert.ok(!stat.isSymbolicLink(), `Refusing linked data: ${path}`);
    const key = prefix ? `${prefix}/${name}` : name;
    return stat.isDirectory() ? files(path, key) : [key];
  });
}

const digest = (path) =>
  NodeCrypto.createHash("sha256").update(NodeFS.readFileSync(path)).digest("hex");

/** Offline copy of a complete home plus the exact installer needed to restore its database. */
export function backupData(source, destination, installer, version) {
  const { from, to } = independent(source, destination);
  NodeAssert.ok(
    /^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version),
    "Supply the installed application version",
  );
  NodeAssert.ok(
    NodeFS.existsSync(NodePath.join(from, "userdata/statev2.sqlite")),
    "Missing V2 database",
  );
  files(from);
  NodeAssert.ok(NodeFS.lstatSync(installer).isFile(), "Matching installer required");
  NodeFS.mkdirSync(to);
  NodeFS.cpSync(from, NodePath.join(to, "home"), {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  NodeFS.cpSync(installer, NodePath.join(to, "installer.exe"), {
    errorOnExist: true,
    force: false,
  });
  const hashes = Object.fromEntries(
    files(to).map((name) => [name, digest(NodePath.join(to, name))]),
  );
  NodeFS.writeFileSync(
    NodePath.join(to, "backup.json"),
    JSON.stringify({ version, createdAt: new Date().toISOString(), hashes }, null, 2),
  );
  return to;
}

export function restoreData(backup, destination) {
  const { from, to } = independent(backup, destination);
  const manifest = JSON.parse(NodeFS.readFileSync(NodePath.join(from, "backup.json"), "utf8"));
  const actual = files(from)
    .filter((name) => name !== "backup.json")
    .sort();
  NodeAssert.deepEqual(
    actual,
    Object.keys(manifest.hashes).sort(),
    "Backup file inventory changed",
  );
  for (const name of actual)
    NodeAssert.equal(
      digest(NodePath.join(from, name)),
      manifest.hashes[name],
      `Backup changed: ${name}`,
    );
  const official = NodePath.resolve(NodeOS.homedir(), ".t3");
  const rel = NodePath.relative(official, to);
  NodeAssert.ok(
    rel === ".." || rel.startsWith(`..${NodePath.sep}`) || NodePath.isAbsolute(rel),
    "Never restore into the official home",
  );
  NodeFS.cpSync(NodePath.join(from, "home"), to, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  return { home: to, version: manifest.version, installer: NodePath.join(from, "installer.exe") };
}

if (process.argv[1] && import.meta.url === NodeURL.pathToFileURL(process.argv[1]).href) {
  const [command, ...args] = process.argv.slice(2);
  NodeAssert.ok(
    args.pop() === "--stopped",
    "Close only the app owning this data first, then pass --stopped. Never stop the instance hosting your agent.",
  );
  if (command === "backup") {
    NodeAssert.equal(
      args.length,
      4,
      "backup <home> <new-backup-directory> <matching-installer> <installed-version> --stopped",
    );
    console.log(backupData(...args));
  } else if (command === "restore") {
    NodeAssert.equal(args.length, 2, "restore <backup-directory> <new-home-directory> --stopped");
    console.log(restoreData(...args));
  } else {
    throw new Error("Choose backup or restore. No in-place migration is supported.");
  }
}
