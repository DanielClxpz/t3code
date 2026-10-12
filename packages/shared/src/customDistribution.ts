/** Stable fork identity. Changing these values breaks installed app upgrades. */
export const CUSTOM_DISTRIBUTION = {
  appId: "io.github.danielclxpz.t3code.custom",
  name: "T3 Code Custom",
  packageName: "t3code-custom",
  homeDirectory: ".t3-custom",
  repository: "DanielClxpz/t3code",
  protocol: "t3code-custom",
  developmentProtocol: "t3code-custom-dev",
} as const;
