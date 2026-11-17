/** Explicit mandatory LOCAL PG17 proof entry. CI16 retains actual refusal tests;
 * no success semantics are conditionally skipped or claimed by that CI image.
 * No dotenv/global setup: only an explicitly attested disposable URL is used. */
import {defineConfig} from 'vitest/config';
export default defineConfig({test:{environment:'node',globals:false,include:['test/pg17/embedding-index-cutover.pg17.ts'],testTimeout:15000,hookTimeout:45000}});
