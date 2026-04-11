import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function normalizeNodeEnv(nodeEnv) {
  if (typeof nodeEnv !== "string") {
    return "development";
  }

  const normalizedNodeEnv = nodeEnv.trim();

  return normalizedNodeEnv.length > 0 ? normalizedNodeEnv : "development";
}

export function getEnvFileOrder(nodeEnv) {
  const normalizedNodeEnv = normalizeNodeEnv(nodeEnv);

  return [
    ".env",
    `.env.${normalizedNodeEnv}`,
    ".env.local",
    `.env.${normalizedNodeEnv}.local`,
  ];
}

export function parseDotEnvFileContents(rawContents) {
  const parsed = {};

  for (const rawLine of rawContents.replace(/^\ufeff/, "").split(/\r?\n/u)) {
    const trimmedLine = rawLine.trim();

    if (trimmedLine.length === 0 || trimmedLine.startsWith("#")) {
      continue;
    }

    const normalizedLine = trimmedLine.startsWith("export ")
      ? trimmedLine.slice("export ".length).trim()
      : trimmedLine;
    const equalsIndex = normalizedLine.indexOf("=");

    if (equalsIndex <= 0) {
      continue;
    }

    const key = normalizedLine.slice(0, equalsIndex).trim();

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) {
      continue;
    }

    let value = normalizedLine.slice(equalsIndex + 1).trim();

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      const quote = value[0];

      value = value.slice(1, -1);

      if (quote === "\"") {
        value = value
          .replace(/\\n/g, "\n")
          .replace(/\\r/g, "\r")
          .replace(/\\t/g, "\t");
      }
    } else {
      const inlineCommentIndex = value.search(/\s+#/u);

      if (inlineCommentIndex >= 0) {
        value = value.slice(0, inlineCommentIndex).trimEnd();
      }
    }

    parsed[key] = value;
  }

  return parsed;
}

function readEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  return parseDotEnvFileContents(readFileSync(filePath, "utf8"));
}

export function loadWorkspaceEnv({
  workspaceRoot,
  appRoot,
  env = process.env,
  nodeEnv = env.NODE_ENV,
}) {
  const fileEnv = {};
  const directories = [workspaceRoot, appRoot].filter(
    (directory) => typeof directory === "string" && directory.length > 0,
  );

  for (const directory of directories) {
    for (const envFile of getEnvFileOrder(nodeEnv)) {
      Object.assign(fileEnv, readEnvFile(path.join(directory, envFile)));
    }
  }

  return {
    ...fileEnv,
    ...env,
  };
}
