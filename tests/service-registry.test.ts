import { describe, expect, it } from "vitest";
import { createService, ServiceRegistry } from "../src/app/services.js";

describe("ServiceRegistry", () => {
  it("starts services in registration order", async () => {
    const events: string[] = [];
    const registry = new ServiceRegistry([
      createService("one", () => { events.push("start:one"); }, () => {}),
      createService("two", () => { events.push("start:two"); }, () => {}),
      createService("three", () => { events.push("start:three"); }, () => {}),
    ]);

    await registry.startAll();
    expect(events).toEqual(["start:one", "start:two", "start:three"]);
  });

  it("stops services in reverse order", async () => {
    const events: string[] = [];
    const registry = new ServiceRegistry([
      createService("one", () => {}, () => { events.push("stop:one"); }),
      createService("two", () => {}, () => { events.push("stop:two"); }),
      createService("three", () => {}, () => { events.push("stop:three"); }),
    ]);

    await registry.stopAll();
    expect(events).toEqual(["stop:three", "stop:two", "stop:one"]);
  });

  it("stops remaining services even if one stop throws", async () => {
    const events: string[] = [];
    const registry = new ServiceRegistry([
      createService("one", () => {}, () => { events.push("stop:one"); }),
      createService("two", () => {}, () => { throw new Error("boom"); }),
      createService("three", () => {}, () => { events.push("stop:three"); }),
    ]);

    await registry.stopAll();
    expect(events).toEqual(["stop:three", "stop:one"]);
  });
});
