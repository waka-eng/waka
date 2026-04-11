import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __wakaPrismaClient: PrismaClient | undefined;
}

export function getPrismaClient(): PrismaClient {
  if (globalThis.__wakaPrismaClient !== undefined) {
    return globalThis.__wakaPrismaClient;
  }

  const prismaClient = new PrismaClient();

  if (process.env.NODE_ENV !== "production") {
    globalThis.__wakaPrismaClient = prismaClient;
  }

  return prismaClient;
}
