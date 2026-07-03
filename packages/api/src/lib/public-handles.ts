const HANDLE_PATTERN = /^[A-Za-z0-9_-]{3,24}$/;

const RESERVED_HANDLES = new Set([
  "admin",
  "api",
  "auth",
  "health",
  "login",
  "logout",
  "me",
  "onboarding",
  "profile",
  "public",
  "settings",
  "signin",
  "signup",
  "top-of-mind",
  "u",
  "user",
  "waka",
]);

export function normalizePublicHandle(input: string): string {
  return input.trim().replace(/^@+/, "").toLowerCase();
}

export function validatePublicHandle(input: string): string | null {
  const handle = normalizePublicHandle(input);
  if (!HANDLE_PATTERN.test(handle)) {
    return "Handle must be 3-24 letters, numbers, hyphens, or underscores with no spaces";
  }
  if (RESERVED_HANDLES.has(handle)) {
    return "That handle is reserved";
  }
  return null;
}
