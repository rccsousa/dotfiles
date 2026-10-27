---
name: tdd
description: Test-driven development for features and bug fixes. Use when asked to work test-first, follow red-green-refactor, add a regression test, or decide what observable behavior to test.
---

# Test-Driven Development

Work one vertical behavior slice at a time: red -> minimal green -> refactor.

Apply when test-first work is requested or required by repository instructions. Do not impose TDD on every change or add tests for trivial, reversible edits merely because this skill is installed.

## Establish the seam

1. Read the repository instructions and relevant committed domain or decision documentation.
2. Identify the public seam and the behavior observable by a caller or user.
3. If the critical behavior or seam is genuinely ambiguous, stop and ask the owner.
4. Use the repository's existing test stack and local patterns.

## Run the loop

1. Write one failing test for one observable behavior.
2. Run the focused test and confirm it fails for the intended missing behavior.
3. Write only enough production code to make that test pass.
4. Run the focused test until green.
5. Refactor only after green, preserving behavior.
6. Run the scope-appropriate repository checks.
7. Repeat for the next vertical slice.

## Keep tests credible

- Test through public interfaces, not private methods or internal collaborators.
- Derive expected values independently from a requirement, worked example, or known literal. Do not reproduce the implementation in the assertion.
- Name tests for behavior rather than implementation.
- A regression test must reproduce the reported failure before the fix.
- For a load-bearing regression, confirm the test fails when the protected condition is absent or inverted when practical.

## Mock only real boundaries

- Mock external or non-deterministic boundaries such as third-party APIs, time, randomness, or unavailable external services.
- Prefer real repository modules and the project's test database where practical.
- Do not mock repository-owned domain logic merely to make a test easy to write.
- Keep boundary fakes domain-shaped; do not let a mock manufacture the result being asserted.

## Reject

- Bulk test writing followed by bulk implementation.
- Speculative production behavior not required by the failing test.
- Internal call-count or call-order assertions when observable behavior can prove the result.
- Database side-channel assertions when the public seam demonstrates the behavior.
- Smoke tests without a concrete falsifiable outcome.
