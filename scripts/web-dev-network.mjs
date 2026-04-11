const DEFAULT_APP_URL = "http://localhost:3000";
const DEFAULT_BIND_HOST = "0.0.0.0";
const DEFAULT_HTTP_PORT = 3000;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function readTrimmedString(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmedValue = value.trim();

  return trimmedValue.length > 0 ? trimmedValue : undefined;
}

function parsePort(value, field) {
  const trimmedValue = readTrimmedString(value);

  if (trimmedValue === undefined) {
    return undefined;
  }

  if (!/^\d+$/u.test(trimmedValue)) {
    throw new Error(`${field} must be an integer between 1 and 65535`);
  }

  const port = Number.parseInt(trimmedValue, 10);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${field} must be an integer between 1 and 65535`);
  }

  return port;
}

function formatOrigin(protocol, hostname, port) {
  const defaultPort = protocol === "https:" ? 443 : 80;
  const normalizedPort = port === defaultPort ? "" : `:${port}`;

  return `${protocol}//${hostname}${normalizedPort}`;
}

function resolveAppUrl(env) {
  const configuredUrl = readTrimmedString(env.APP_URL) ?? DEFAULT_APP_URL;
  const parsedUrl = new URL(configuredUrl);

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(`APP_URL "${configuredUrl}" must use http or https`);
  }

  return parsedUrl;
}

export function resolveDevServerNetwork(env = process.env) {
  const parsedUrl = resolveAppUrl(env);
  const port =
    parsePort(env.PORT, "PORT") ??
    parsePort(parsedUrl.port, "APP_URL port") ??
    (parsedUrl.protocol === "https:" ? 443 : DEFAULT_HTTP_PORT);
  const bindHost =
    readTrimmedString(env.HOST) ??
    (LOOPBACK_HOSTS.has(parsedUrl.hostname) ? DEFAULT_BIND_HOST : parsedUrl.hostname);
  const publicUrl = formatOrigin(parsedUrl.protocol, parsedUrl.hostname, port);

  return {
    bindHost,
    port,
    publicUrl,
  };
}

export function applyDevServerNetwork(env = process.env) {
  const network = resolveDevServerNetwork(env);

  return {
    ...env,
    APP_URL: network.publicUrl,
    NEXTAUTH_URL: network.publicUrl,
    HOST: network.bindHost,
    HOSTNAME: network.bindHost,
    PORT: String(network.port),
  };
}
