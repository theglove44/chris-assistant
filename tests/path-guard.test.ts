// Must set env vars before importing modules that depend on config.ts
process.env.TELEGRAM_BOT_TOKEN = "test-token";
process.env.TELEGRAM_ALLOWED_USER_ID = "12345";
process.env.GITHUB_TOKEN = "test-github-token";
process.env.GITHUB_MEMORY_REPO = "test/repo";

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  resolveSafePath,
  setWorkspaceRoot,
} from "../src/tools/files.js";

// macOS: os.tmpdir() returns /var/folders/... which is a symlink to
// /private/var/folders/... — we must use the real canonical path so our
// expected values match what resolveSafePath (which calls realpathSync) returns.
const TMPDIR = fs.realpathSync(os.tmpdir());
const TEST_WORKSPACE = path.join(TMPDIR, "chris-assistant-test-workspace");

beforeAll(() => {
  // Ensure the test workspace and a real subdirectory inside it exist
  fs.mkdirSync(path.join(TEST_WORKSPACE, "subdir"), { recursive: true });
  fs.writeFileSync(path.join(TEST_WORKSPACE, "file.txt"), "hello");
});

beforeEach(() => {
  // Reset to the test workspace before each test so tests are independent
  setWorkspaceRoot(TEST_WORKSPACE);
});

describe("resolveSafePath", () => {
  it("resolves a simple relative file path inside the workspace", () => {
    const result = resolveSafePath("file.txt");
    expect(result).toBe(path.join(TEST_WORKSPACE, "file.txt"));
  });

  it("resolves a relative subdirectory path inside the workspace", () => {
    const result = resolveSafePath("subdir");
    expect(result).toBe(path.join(TEST_WORKSPACE, "subdir"));
  });

  it("resolves the workspace root itself (dot path)", () => {
    const result = resolveSafePath(".");
    expect(result).toBe(TEST_WORKSPACE);
  });

  it("returns null for path traversal with ../", () => {
    const result = resolveSafePath("../../../etc/passwd");
    expect(result).toBeNull();
  });

  it("returns null for traversal that escapes via multiple levels", () => {
    const result = resolveSafePath("subdir/../../..");
    expect(result).toBeNull();
  });

  it("returns null for an absolute path outside the workspace", () => {
    const result = resolveSafePath("/etc/passwd");
    expect(result).toBeNull();
  });

  it("returns null for an absolute path to /tmp that is not inside the workspace", () => {
    // TMPDIR itself is the parent of TEST_WORKSPACE, so it must be rejected
    const result = resolveSafePath(TMPDIR);
    expect(result).toBeNull();
  });

  it("rejects a sibling path that shares the workspace name prefix (no false positives from string prefix check)", () => {
    // If workspace is /tmp/.../foo, then /tmp/.../foo-sibling should be rejected.
    // This verifies the boundary check uses path.sep rather than a bare string startsWith.
    const sibling = TEST_WORKSPACE + "-sibling";
    const result = resolveSafePath(sibling);
    expect(result).toBeNull();
  });

  it("resolves a non-existent file inside the workspace (write target)", () => {
    // write_file needs resolveSafePath to work for files that don't exist yet.
    // The canonicalize() helper resolves the deepest existing ancestor.
    const result = resolveSafePath("newfile.txt");
    expect(result).toBe(path.join(TEST_WORKSPACE, "newfile.txt"));
  });

  it("resolves a deeply nested non-existent path inside the workspace", () => {
    const result = resolveSafePath("a/b/c/new.txt");
    expect(result).toBe(path.join(TEST_WORKSPACE, "a/b/c/new.txt"));
  });
});
