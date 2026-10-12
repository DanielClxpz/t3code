import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { extractFile } from "@electron/asar";
import { verifyUpdateFeed } from "./custom-release.mjs";

// Install only on an ephemeral hosted runner, never on the machine hosting an agent.
// oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone installer smoke must reject non-Windows hosts before installing.
NodeAssert.equal(NodeOS.platform(), "win32");
NodeAssert.equal(process.env.GITHUB_ACTIONS, "true");
NodeAssert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
const [directory, version] = process.argv.slice(2);
NodeAssert.ok(version && /^1\.0\.\d+(?:-nightly\.\d{8}\.\d+)?$/.test(version));
const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-custom-smoke-"));
const destination = NodePath.join(root, "app");
const installer = NodePath.resolve(directory, `T3-Code-Custom-${version}-x64.exe`);
NodeChildProcess.execFileSync(installer, ["/S", `/D=${destination}`], {
  timeout: 180_000,
  windowsHide: true,
});
const executable = NodePath.join(destination, "T3 Code Custom.exe");
NodeAssert.ok(
  NodeFS.existsSync(executable),
  "NSIS did not install the independent custom executable",
);
const resources = NodePath.join(destination, "resources");
const desktop = JSON.parse(
  extractFile(NodePath.join(resources, "app.asar"), "package.json").toString(),
);
const server = JSON.parse(
  extractFile(NodePath.join(resources, "server.asar"), "package.json").toString(),
);
NodeAssert.equal(desktop.name, "t3code-custom");
NodeAssert.equal(desktop.version, version);
NodeAssert.equal(server.version, version);
verifyUpdateFeed(NodeFS.readFileSync(NodePath.join(resources, "app-update.yml"), "utf8"));
const env = {
  ...process.env,
  T3CODE_CUSTOM_HOME: NodePath.join(root, "home"),
  T3CODE_HOME: NodePath.join(root, "home"),
  T3CODE_DISABLE_AUTO_UPDATE: "true",
};
delete env.ELECTRON_RUN_AS_NODE;
NodeAssert.equal(
  NodeChildProcess.execFileSync(executable, ["--version"], {
    env,
    encoding: "utf8",
    timeout: 30_000,
  }).trim(),
  version,
);
const serverVersion = NodeChildProcess.execFileSync(
  executable,
  [NodePath.join(resources, "server.asar/apps/server/dist/bin.mjs"), "--version"],
  {
    env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
    encoding: "utf8",
    timeout: 30_000,
  },
);
NodeAssert.ok(serverVersion.includes(version), "Bundled server reports a different version");
console.log(`NSIS installation and desktop/server version smoke passed for ${version}.`);
