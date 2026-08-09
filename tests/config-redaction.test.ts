import { describe, expect, it } from "vitest";
import { redactConfigValue } from "../src/cli/commands/config.js";

describe("configuration redaction", () => {
  it("redacts DeepSeek credentials while leaving non-secret settings visible", () => {
    expect(redactConfigValue("DEEPSEEK_API_KEY", "mock-secret-value")).toBe("mock...alue");
    expect(redactConfigValue("FIRECRAWL_API_KEY", "firecrawl-secret-value")).toBe("fire...alue");
    expect(redactConfigValue("DEEPSEEK_THINKING", "enabled")).toBe("enabled");
  });
});
