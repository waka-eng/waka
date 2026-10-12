/**
 * The reading — "How WAKA reads you."
 *
 * One GET of the loop's rules, served as markdown by `/api/reading.md` and
 * rendered from the API's drift-pinned registry, so the words this client
 * receives are the same words every kind of mind receives — and the same
 * words the code enforces. The client parses the markdown's list items into
 * sentences; it adds nothing and rewords nothing, because a second phrasing
 * anywhere would be the drift the whole surface exists to make impossible.
 */
import { apiPath, ApiError } from "./http";
import { apiFetch } from './transport';

export interface ApiReading {
  /** the loop's rules, one sentence each, in the served order */
  sentences: string[];
  /** the closing line — what the person's own gestures teach */
  coda: string | null;
}

export async function fetchTheReading(): Promise<ApiReading> {
  let res: Response;
  try {
    /* apiPath prepends the /api prefix itself — the served route is
       /api/reading.md, so the argument is the bare path */
    res = await apiFetch(apiPath("/reading.md"), {
      method: "GET",
      credentials: "include",
      headers: { Accept: "text/markdown" },
    });
  } catch {
    throw new ApiError({ status: 0, message: "Could not load the reading: network unreachable" });
  }
  if (!res.ok) {
    throw new ApiError({ status: res.status, message: "Could not load the reading" });
  }
  const markdown = await res.text();
  const lines = markdown.split("\n");
  const sentences = lines
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim());
  const coda =
    lines
      .map((line) => line.trim())
      .filter(
        (line) =>
          line.length > 0 &&
          !line.startsWith("#") &&
          !line.startsWith(">") &&
          !line.startsWith("- "),
      )
      .at(-1) ?? null;
  return { sentences, coda };
}
