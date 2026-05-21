# Local WOW detail QA path

Safe local/dev-only harness for inspecting the populated WOW reflection detail without production auth bypass.

Command:

```sh
pnpm --filter @waka/web qa:wow-detail
```

What it exercises:

1. Renders a populated WOW grid from in-test fixture data.
2. Opens a selected in-grid WOW reflection detail.
3. Selects a resonance response.
4. Verifies `Save this as a future memory?` appears as local-only copy.
5. Verifies the Add Signal callout appears.
6. Verifies removed clutter (`Show me examples`) is absent.

This is a component-level local QA harness. It does not create accounts, bypass production auth, call network APIs, or print secrets. For full live browser QA, use the normal local app sign-in path with a seeded/dev account, then inspect the same UI sequence: WOW grid -> selected detail -> resonance -> future-memory ending -> Add Signal callout.
