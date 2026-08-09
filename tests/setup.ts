import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll } from "vitest";

const testDataDir = path.join(os.tmpdir(), `chris-assistant-tests-${process.pid}-${process.env.VITEST_POOL_ID ?? "0"}`);
process.env.CHRIS_ASSISTANT_DATA_DIR = testDataDir;

afterAll(() => {
  fs.rmSync(testDataDir, { recursive: true, force: true });
});
