export const INSPIRATION_ROUTE_NOT_FOUND_STATUS = 404;
export const INSPIRATION_ROUTE_NOT_FOUND_ERROR = "Not Found";

export interface InspirationRouteErrorResponse {
  error: string;
}

export class InspirationRouteNotFoundError extends Error {
  constructor() {
    super(INSPIRATION_ROUTE_NOT_FOUND_ERROR);
    this.name = "InspirationRouteNotFoundError";
  }
}

export function createInspirationRouteNotFoundResponse(): Response {
  return Response.json(
    {
      error: INSPIRATION_ROUTE_NOT_FOUND_ERROR,
    },
    {
      status: INSPIRATION_ROUTE_NOT_FOUND_STATUS,
    },
  );
}

export function isInspirationRouteNotFoundError(error: unknown): boolean {
  if (error instanceof InspirationRouteNotFoundError) {
    return true;
  }

  if (typeof error !== "object" || error === null) {
    return false;
  }

  return "code" in error && error.code === "P2025";
}
