/**
 * WHAT `globalSetup` HANDS THE WORKERS.
 *
 * `test/global-database-provision.ts` creates the two real databases that
 * `src/lib/fresh-migrate.db.test.ts` needs and passes their names through
 * vitest's `provide` / `inject`.
 *
 * WHY THE AUGMENTATION LIVES HERE and not beside the `provide` calls: a
 * `declare module` inside a file `tsconfig` does not include is invisible to
 * the compiler, and this package includes `src/**` only. Put it next to the
 * provider, or at the package root, and `inject("freshMigrateDb")` fails
 * with "not assignable to parameter of type 'never'" — which reads like a
 * vitest bug and is not one.
 */
declare module "vitest" {
  interface ProvidedContext {
    freshMigrateDb: string;
    stuckMigrateDb: string;
  }
}

export {};
