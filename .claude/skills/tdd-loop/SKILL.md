---
name: tdd-loop
description: Test-driven autonomous iteration — write tests first, loop until green, mutation-test quality, then commit
---

# /tdd-loop

Red → Green → Mutate → Commit. Up to 5 implementation attempts before escalating.

**Usage**: `/tdd-loop <bug or feature description>`

---

## Phase 0 — Understand

1. Read `$ARGUMENTS` to extract: the target behaviour, which source files are involved, and the acceptance criteria.
2. Grep / Read the relevant source files. Identify the exact function(s) or module(s) being changed.
3. Read any existing tests for those files to understand conventions and current coverage gaps.
4. State clearly: "I am testing `src/X.ts` function `Y`. The spec is: …"

---

## Phase 1 — Write Tests (Red)

Write a new test file `tests/<name>.test.ts` (or extend the existing one) **before touching any implementation**.

Requirements for the test suite:
- **Happy-path tests**: at least 2 concrete examples of correct behaviour.
- **Edge-case tests**: empty input, boundary values, `null`/`undefined`, very large inputs, Unicode, concurrent calls — whatever is plausible for this function.
- **Property-based tests** using `fast-check` (already installed): formulate at least one invariant that should hold for all inputs. Pattern:
  ```ts
  import fc from "fast-check";
  it("property: …", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        // invariant here
      })
    );
  });
  ```
- **Error/rejection tests**: verify that bad inputs throw the right errors or return the right shape.
- DO NOT import the implementation yet if it doesn't exist — use a stub import path so the file fails to compile predictably.

After writing the tests, run them:

```bash
npm test -- --reporter=verbose 2>&1 | head -80
```

**Required outcome**: tests must FAIL. If any pass unexpectedly, the test is trivially wrong — strengthen it before continuing. State the failure reason for each test to confirm the spec is correctly encoded.

---

## Phase 2 — Implement (Green Loop)

Attempt counter starts at 1. Maximum 5 attempts.

### Each attempt:
1. **Implement** (or fix) the code in the source file identified in Phase 0.
2. Run typecheck first:
   ```bash
   npm run typecheck 2>&1 | head -40
   ```
   Fix any type errors before running tests.
3. Run the full test suite:
   ```bash
   npm test 2>&1 | tail -60
   ```
4. **If all tests pass** → proceed to Phase 3.
5. **If any tests fail**:
   - Print the exact failure messages.
   - Self-critique: "My attempt N failed because…" — identify the root cause, not just the symptom.
   - Do NOT make a superficial fix (e.g. changing a `===` to `==` without understanding why). Diagnose first.
   - Increment attempt counter and try again.

### After 5 failed attempts:
Stop. Report:
- Which tests are still failing and why.
- What approaches were tried.
- What you believe is blocking progress (e.g. missing context, unclear spec, deeper architectural issue).
- Ask the user for guidance before continuing.

---

## Phase 3 — Mutation Testing

Once all tests are green, verify the tests actually *catch bugs* — not just pass.

Identify the source file being tested (e.g. `src/foo/bar.ts`) and run Stryker scoped to it:

```bash
npx stryker run --mutate "src/path/to/file.ts" 2>&1 | tail -40
```

Wait for the run to complete. Read the output.

**Interpret the score**:
- **≥ 80% killed** → tests are strong. Proceed to Phase 4.
- **60–79% killed** → acceptable but improvable. Note surviving mutants and add targeted tests to kill them. Re-run the full test suite to confirm still green.
- **< 60% killed** → tests are weak. Add tests for each surviving mutant category reported. Re-run Stryker to confirm improvement. Repeat until ≥ 60%.

When reporting surviving mutants, explain in plain English what each surviving mutant means (e.g. "a `>` was changed to `>=` and no test caught it — the boundary condition is undertested").

If Stryker times out or errors, note it, skip mutation testing, and proceed with a warning in the commit message.

---

## Phase 4 — Commit

1. Run the final test suite one more time to confirm green.
2. Run typecheck one more time.
3. Stage the changed files (implementation + test file + any supporting changes).
4. Commit with a message following this format:
   ```
   test(scope): add TDD suite for <feature/bug>

   - Covers: <list of what the tests verify>
   - Mutation score: <N>% killed (<M> mutants)
   - Property tests: <yes/no — describe invariant if yes>
   ```
5. If the user has asked to push, do so. Otherwise just commit locally.

---

## Notes

- `fast-check` is installed as a devDependency. Import as `import fc from "fast-check"`.
- Stryker config lives at `stryker.config.mjs`. Run via `npx stryker run`.
- Scope Stryker to a specific file with `--mutate "src/path/to/file.ts"` to keep runtime under 2 minutes.
- Never commit a failing test suite.
- Never skip Phase 1 — the red phase is the spec. If you write tests after the implementation, you are not doing TDD.
