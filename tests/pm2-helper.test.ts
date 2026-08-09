import type pm2 from "pm2";
import { describe, expect, it, vi } from "vitest";
import { restartProcessWithFreshEnv } from "../src/cli/pm2-helper.js";

describe("PM2 restart helper", () => {
  it("refreshes the stored process environment on restart", async () => {
    const restart = vi.fn((_name, _options, callback) => callback(null));
    const pm2Instance = { restart } as unknown as typeof pm2;

    await restartProcessWithFreshEnv(pm2Instance, "chris-assistant");

    expect(restart).toHaveBeenCalledWith(
      "chris-assistant",
      { updateEnv: true },
      expect.any(Function),
    );
  });
});
