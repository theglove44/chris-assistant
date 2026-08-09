import { describe, expect, it } from "vitest";
import { parseGrokModelsOutput } from "../src/grok.js";

describe("parseGrokModelsOutput", () => {
  it("extracts authentication and only advertised Grok models", () => {
    const parsed = parseGrokModelsOutput(`You are logged in with grok.com.\n\nDefault model: grok-4.5\n\nAvailable models:\n  * grok-4.5 (default)\n`);
    expect(parsed).toEqual({ authenticated: true, models: ["grok-4.5"], defaultModel: "grok-4.5" });
  });
});
