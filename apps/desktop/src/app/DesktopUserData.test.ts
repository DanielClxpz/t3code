import * as NodePath from "@effect/platform-node/NodePath";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { resolveUserDataPath } from "./DesktopUserData.ts";

it.effect("isolates profiles without reading or migrating official data", () =>
  Effect.gen(function* () {
    const production = yield* resolveUserDataPath({
      baseDir: "/home/.t3-custom",
      isDevelopment: false,
    });
    const development = yield* resolveUserDataPath({
      baseDir: "/worktree/.t3",
      isDevelopment: true,
    });
    const testCopy = yield* resolveUserDataPath({ baseDir: "/test-copy", isDevelopment: false });
    assert.equal(production, "/home/.t3-custom/electron");
    assert.equal(development, "/worktree/.t3/electron-dev");
    assert.equal(testCopy, "/test-copy/electron");
  }).pipe(Effect.provide(NodePath.layerPosix)),
);
