/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  testRunner: "vitest",
  coverageAnalysis: "perTest",
  vitest: {
    configFile: "vitest.config.ts",
  },
  mutate: [
    // Default: mutate only files explicitly passed via --mutate CLI arg
    // so the skill can scope to a specific file: npx stryker run --mutate "src/foo.ts"
  ],
  reporters: ["clear-text", "progress"],
  timeoutMS: 30000,
  concurrency: 4,
  thresholds: {
    high: 80,
    low: 60,
    break: 0, // never hard-fail — skill checks score itself
  },
};
