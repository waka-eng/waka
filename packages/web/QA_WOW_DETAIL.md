# Local WOW detail QA path

Safe local/dev-only harnesses for inspecting the populated signed-in top-of-mind/WOW evidence path without production auth bypass.

## Signed-in seeded browser QA

```sh
pnpm qa:wow-detail:signed-in
# or boot the no-AWS monolithic local dev server first:
pnpm qa:wow-detail:signed-in:boot
```

`pnpm qa:wow-detail:signed-in:boot` starts `pnpm dev:local` and probes the
same local preview origin for both web and API readiness:
`http://localhost:3010` and `http://localhost:3010/api/health`. It does not
start `pnpm sst dev` and does not require AWS credentials.

Required/supported environment:

- `DB_CONNECTION_URL` or `DATABASE_URL`: required. Must point at local/loopback Postgres (`localhost`, `127.0.0.1`, `::1`, `0.0.0.0`, or `*.local`). The harness stops on remote DB hosts.
- `WAKA_WOW_DETAIL_WEB_URL`: optional app URL. Defaults to `http://localhost:3010` for the monolithic local app.
- `WAKA_WOW_DETAIL_API_URL`: optional API origin. Defaults to the web URL, so `/api/*` is tested through the monolithic local app.
- `WAKA_WOW_DETAIL_EMAIL` + `WAKA_WOW_DETAIL_PASSWORD`: optional existing QA credentials. Provide both or neither. If omitted, the harness generates a local `example.test` QA account and password without printing the password.
- `WAKA_WOW_DETAIL_ARTIFACT_DIR`: optional evidence directory. Defaults to `.hermes/qa-artifacts/wow-detail-signed-in`.
- `WAKA_WOW_DETAIL_HEADFUL=1`: optional headed browser mode for debugging.

Safety/contract:

- Uses only local/loopback databases by default; there is no remote override in this signed-in QA harness.
- Non-destructive by default. It creates or reuses one QA user and only appends curated demo WOW rows if that user has no demo WOW data yet. It does not delete user/demo data.
- Signs in through the real browser login form; it does not inject tokens or bypass auth.
- Does not print passwords, tokens, or database URLs; the signed-in QA harness does not print passwords, tokens, or database URLs.
- Writes safe screenshot/JSON evidence under local `.hermes/qa-artifacts/`; keep these artifacts local/excluded from commits.

Browser assertions:

1. Login succeeds as the QA user, including generated local users with onboarding already complete.
2. A populated top-of-mind/WOW note is visible in the actual UI.
3. The note's "inspirations led here" affordance opens the signed-in evidence drawer.
4. The scoped top-of-mind source trail is visible, with 3-5 full source inspirations for the seeded note.
5. The drawer exposes the top-of-mind/all-saved/recent filters and the back-home exit path.
6. Back home closes the source drawer cleanly.
