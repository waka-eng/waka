import assert from "node:assert/strict";
import {
  createHash,
  createHmac,
  pbkdf2Sync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { once } from "node:events";
import { connect as connectNet, type Socket } from "node:net";
import { connect as connectTls, type TLSSocket } from "node:tls";

import type {
  GoogleAccountUpsertArgs,
  GoogleUserPersistenceClient,
  GoogleUserUpsertArgs,
} from "../../apps/web/src/auth/google-user-persistence.ts";
import type { GoogleUserModelPayload } from "../../apps/web/src/auth/providers/google.ts";

const POSTGRES_PROTOCOL_VERSION = 196608;
const POSTGRES_SSL_REQUEST_CODE = 80877103;
const POSTGRES_AUTH_OK = 0;
const POSTGRES_AUTH_CLEAR_TEXT = 3;
const POSTGRES_AUTH_SASL = 10;
const POSTGRES_AUTH_SASL_CONTINUE = 11;
const POSTGRES_AUTH_SASL_FINAL = 12;
const POSTGRES_SCRAM_SHA_256 = "SCRAM-SHA-256";

type PostgresSocket = Socket | TLSSocket;

type PostgresConnectionOptions = {
  database: string;
  host: string;
  password: string;
  port: number;
  sslMode: string;
  user: string;
};

type PostgresMessage = {
  type: string;
  payload: Buffer;
};

type PostgresQueryRow = Record<string, string | null>;

type PostgresQueryResult = {
  commandTag: string | null;
  rows: PostgresQueryRow[];
};

export interface PersistedGoogleUserRecord extends GoogleUserModelPayload {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersistedGoogleAccountRecord {
  accessToken: string | null;
  createdAt: string;
  expiresAt: number | null;
  id: string;
  idToken: string | null;
  provider: string;
  providerAccountId: string;
  refreshToken: string | null;
  scope: string | null;
  sessionState: string | null;
  tokenType: string | null;
  type: string;
  updatedAt: string;
  userId: string;
}

export interface NeonGoogleAuthFixture {
  countGoogleAccountsByProviderAccountId(
    providerAccountId: string,
  ): Promise<number>;
  countUsersByGoogleSubject(
    googleSubject: string,
  ): Promise<number>;
  databaseUrl: string;
  userPersistenceClient: GoogleUserPersistenceClient<PersistedGoogleUserRecord>;
  dispose(): Promise<void>;
  readGoogleAccountByProviderAccountId(
    providerAccountId: string,
  ): Promise<PersistedGoogleAccountRecord | null>;
  readUserByGoogleSubject(
    googleSubject: string,
  ): Promise<PersistedGoogleUserRecord | null>;
}

class PostgresBufferReader {
  private readonly socket: PostgresSocket;
  private readonly buffers: Buffer[] = [];
  private readonly waiters: Array<{
    reject: (error: Error) => void;
    resolve: () => void;
  }> = [];
  private bufferedLength = 0;
  private ended = false;
  private socketError: Error | null = null;

  constructor(socket: PostgresSocket) {
    this.socket = socket;
    socket.on("data", (chunk: Buffer) => {
      this.buffers.push(chunk);
      this.bufferedLength += chunk.length;
      this.flushWaiters();
    });

    socket.on("end", () => {
      this.ended = true;
      this.flushWaiters();
    });

    socket.on("close", () => {
      this.ended = true;
      this.flushWaiters();
    });

    socket.on("error", (error) => {
      this.socketError = error instanceof Error ? error : new Error(String(error));
      this.flushWaiters(this.socketError);
    });
  }

  async readExactly(byteLength: number): Promise<Buffer> {
    while (this.bufferedLength < byteLength) {
      if (this.socketError) {
        throw this.socketError;
      }

      if (this.ended) {
        throw new Error(
          `Postgres connection closed before ${byteLength} bytes were available`,
        );
      }

      await new Promise<void>((resolve, reject) => {
        this.waiters.push({ resolve, reject });
      });
    }

    return this.consume(byteLength);
  }

  private consume(byteLength: number): Buffer {
    const chunks: Buffer[] = [];
    let remaining = byteLength;

    while (remaining > 0) {
      const chunk = this.buffers[0];

      assert.ok(chunk, "Expected buffered postgres data while consuming bytes");

      if (chunk.length <= remaining) {
        chunks.push(chunk);
        this.buffers.shift();
        this.bufferedLength -= chunk.length;
        remaining -= chunk.length;
        continue;
      }

      chunks.push(chunk.subarray(0, remaining));
      this.buffers[0] = chunk.subarray(remaining);
      this.bufferedLength -= remaining;
      remaining = 0;
    }

    return Buffer.concat(chunks, byteLength);
  }

  private flushWaiters(error?: Error) {
    const waiters = this.waiters.splice(0);

    for (const waiter of waiters) {
      if (error) {
        waiter.reject(error);
      } else {
        waiter.resolve();
      }
    }
  }
}

class PostgresTestConnection {
  private readonly socket: PostgresSocket;
  private readonly reader: PostgresBufferReader;

  private constructor(
    socket: PostgresSocket,
    reader: PostgresBufferReader,
  ) {
    this.socket = socket;
    this.reader = reader;
  }

  static async connect(databaseUrl: string): Promise<PostgresTestConnection> {
    const options = parsePostgresConnectionOptions(databaseUrl);
    const rawSocket = connectNet({
      host: options.host,
      port: options.port,
    });

    await waitForSocketConnect(rawSocket);

    let socket: PostgresSocket = rawSocket;

    if (options.sslMode !== "disable") {
      socket = await upgradeSocketToTls(rawSocket, options.host);
    }

    const reader = new PostgresBufferReader(socket);
    const connection = new PostgresTestConnection(socket, reader);

    await connection.startup(options);

    return connection;
  }

  async query(sql: string): Promise<PostgresQueryResult> {
    this.writeFramedMessage("Q", encodeCString(sql));

    let commandTag: string | null = null;
    let fieldNames: string[] = [];
    const rows: PostgresQueryRow[] = [];

    while (true) {
      const message = await this.readMessage();

      switch (message.type) {
        case "C":
          commandTag = readCString(message.payload, 0).value;
          break;
        case "D":
          rows.push(parseDataRow(message.payload, fieldNames));
          break;
        case "E":
          throw new Error(readErrorResponse(message.payload));
        case "N":
          break;
        case "S":
          break;
        case "T":
          fieldNames = parseRowDescription(message.payload);
          break;
        case "Z":
          return { commandTag, rows };
        default:
          throw new Error(`Unsupported PostgreSQL query message: ${message.type}`);
      }
    }
  }

  async close(): Promise<void> {
    this.socket.end();

    if (!this.socket.destroyed) {
      await once(this.socket, "close");
    }
  }

  private async startup(options: PostgresConnectionOptions) {
    const parameters = Buffer.concat([
      encodeCString("user"),
      encodeCString(options.user),
      encodeCString("database"),
      encodeCString(options.database),
      encodeCString("application_name"),
      encodeCString("waka-google-auth-test"),
      encodeCString("client_encoding"),
      encodeCString("UTF8"),
      Buffer.from([0]),
    ]);

    const startupMessage = Buffer.alloc(8);
    startupMessage.writeInt32BE(parameters.length + 8, 0);
    startupMessage.writeInt32BE(POSTGRES_PROTOCOL_VERSION, 4);
    this.socket.write(Buffer.concat([startupMessage, parameters]));

    let scramSession:
      | {
          clientFirstBare: string;
          expectedServerSignature: string;
        }
      | null = null;

    while (true) {
      const message = await this.readMessage();

      switch (message.type) {
        case "K":
          break;
        case "R": {
          const authCode = message.payload.readInt32BE(0);

          if (authCode === POSTGRES_AUTH_OK) {
            break;
          }

          if (authCode === POSTGRES_AUTH_CLEAR_TEXT) {
            this.writePasswordMessage(options.password);
            break;
          }

          if (authCode === POSTGRES_AUTH_SASL) {
            scramSession = this.beginScramAuthentication(
              options.user,
              message.payload.subarray(4),
            );
            break;
          }

          if (authCode === POSTGRES_AUTH_SASL_CONTINUE) {
            assert.ok(
              scramSession,
              "SCRAM authentication continued without an initialized session",
            );
            scramSession = this.continueScramAuthentication(
              scramSession,
              options.password,
              message.payload.subarray(4),
            );
            break;
          }

          if (authCode === POSTGRES_AUTH_SASL_FINAL) {
            assert.ok(
              scramSession,
              "SCRAM authentication finished without an initialized session",
            );
            verifyScramServerSignature(
              scramSession.expectedServerSignature,
              message.payload.subarray(4).toString("utf8"),
            );
            break;
          }

          throw new Error(`Unsupported PostgreSQL authentication method: ${authCode}`);
        }
        case "S":
          break;
        case "Z":
          return;
        case "E":
          throw new Error(readErrorResponse(message.payload));
        default:
          throw new Error(`Unsupported PostgreSQL startup message: ${message.type}`);
      }
    }
  }

  private beginScramAuthentication(
    user: string,
    payload: Buffer,
  ) {
    const mechanisms = readNullTerminatedList(payload);

    if (!mechanisms.includes(POSTGRES_SCRAM_SHA_256)) {
      throw new Error(
        `PostgreSQL server does not offer ${POSTGRES_SCRAM_SHA_256} authentication`,
      );
    }

    const clientNonce = randomBytes(18).toString("base64url");
    const clientFirstBare = `n=${escapeScramValue(user)},r=${clientNonce}`;
    const clientFirstMessage = `n,,${clientFirstBare}`;
    const mechanism = Buffer.from(POSTGRES_SCRAM_SHA_256, "utf8");
    const initialResponse = Buffer.from(clientFirstMessage, "utf8");
    const message = Buffer.alloc(mechanism.length + 1 + 4 + initialResponse.length);

    mechanism.copy(message, 0);
    message[mechanism.length] = 0;
    message.writeInt32BE(initialResponse.length, mechanism.length + 1);
    initialResponse.copy(message, mechanism.length + 5);

    this.writeFramedMessage("p", message);

    return {
      clientFirstBare,
      expectedServerSignature: "",
    };
  }

  private continueScramAuthentication(
    currentSession: {
      clientFirstBare: string;
      expectedServerSignature: string;
    },
    password: string,
    payload: Buffer,
  ) {
    const serverFirstMessage = payload.toString("utf8");
    const attributes = parseScramAttributes(serverFirstMessage);
    const combinedNonce = attributes.get("r");
    const salt = attributes.get("s");
    const iterationCount = attributes.get("i");

    assert.ok(combinedNonce, "SCRAM challenge is missing the combined nonce");
    assert.ok(salt, "SCRAM challenge is missing the salt");
    assert.ok(iterationCount, "SCRAM challenge is missing the iteration count");
    assert.ok(
      combinedNonce.startsWith(readScramClientNonce(currentSession.clientFirstBare)),
      "SCRAM challenge nonce does not extend the client nonce",
    );

    const clientFinalWithoutProof = `c=biws,r=${combinedNonce}`;
    const authMessage = [
      currentSession.clientFirstBare,
      serverFirstMessage,
      clientFinalWithoutProof,
    ].join(",");
    const saltedPassword = pbkdf2Sync(
      Buffer.from(password.normalize("NFKC"), "utf8"),
      Buffer.from(salt, "base64"),
      Number.parseInt(iterationCount, 10),
      32,
      "sha256",
    );
    const clientKey = createHmac("sha256", saltedPassword)
      .update("Client Key")
      .digest();
    const storedKey = createHash("sha256").update(clientKey).digest();
    const clientSignature = createHmac("sha256", storedKey)
      .update(authMessage)
      .digest();
    const clientProof = xorBuffers(clientKey, clientSignature).toString("base64");
    const serverKey = createHmac("sha256", saltedPassword)
      .update("Server Key")
      .digest();
    const expectedServerSignature = createHmac("sha256", serverKey)
      .update(authMessage)
      .digest("base64");
    const clientFinalMessage = `${clientFinalWithoutProof},p=${clientProof}`;

    this.writeFramedMessage("p", Buffer.from(clientFinalMessage, "utf8"));

    return {
      clientFirstBare: currentSession.clientFirstBare,
      expectedServerSignature,
    };
  }

  private writePasswordMessage(password: string) {
    this.writeFramedMessage("p", encodeCString(password));
  }

  private writeFramedMessage(type: string, payload: Buffer) {
    const header = Buffer.alloc(5);

    header.write(type, 0, "utf8");
    header.writeInt32BE(payload.length + 4, 1);
    this.socket.write(Buffer.concat([header, payload]));
  }

  private async readMessage(): Promise<PostgresMessage> {
    const type = (await this.reader.readExactly(1)).toString("utf8");
    const length = (await this.reader.readExactly(4)).readInt32BE(0);
    const payload = await this.reader.readExactly(length - 4);

    return { type, payload };
  }
}

function parsePostgresConnectionOptions(databaseUrl: string): PostgresConnectionOptions {
  assert.ok(
    databaseUrl,
    "DATABASE_URL is required for the Neon Google auth test fixture",
  );

  const parsedUrl = new URL(databaseUrl);

  assert.ok(
    parsedUrl.protocol === "postgres:" || parsedUrl.protocol === "postgresql:",
    `DATABASE_URL must use a postgres protocol, received ${parsedUrl.protocol}`,
  );

  const database = parsedUrl.pathname.replace(/^\/+/, "");

  assert.ok(database.length > 0, "DATABASE_URL must include a database name");

  return {
    database,
    host: parsedUrl.hostname,
    password: decodeURIComponent(parsedUrl.password),
    port: parsedUrl.port.length > 0 ? Number.parseInt(parsedUrl.port, 10) : 5432,
    sslMode: parsedUrl.searchParams.get("sslmode") ?? "require",
    user: decodeURIComponent(parsedUrl.username),
  };
}

async function upgradeSocketToTls(
  socket: Socket,
  serverName: string,
): Promise<TLSSocket> {
  const sslRequest = Buffer.alloc(8);

  sslRequest.writeInt32BE(8, 0);
  sslRequest.writeInt32BE(POSTGRES_SSL_REQUEST_CODE, 4);
  socket.write(sslRequest);

  const sslResponse = await readTlsNegotiationResponse(socket);

  if (sslResponse !== "S") {
    throw new Error("PostgreSQL server refused TLS during test fixture setup");
  }

  const tlsSocket = connectTls({
    rejectUnauthorized: true,
    servername: serverName,
    socket,
  });

  await once(tlsSocket, "secureConnect");

  return tlsSocket;
}

async function waitForSocketConnect(socket: Socket): Promise<void> {
  if (socket.readyState === "open") {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off("connect", onConnect);
      socket.off("error", onError);
    };

    socket.on("connect", onConnect);
    socket.on("error", onError);
  });
}

async function readTlsNegotiationResponse(socket: Socket): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      cleanup();
      resolve(chunk.subarray(0, 1).toString("utf8"));
    };
    const onEnd = () => {
      cleanup();
      reject(
        new Error("PostgreSQL server closed the connection during TLS negotiation"),
      );
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("end", onEnd);
      socket.off("error", onError);
    };

    socket.on("data", onData);
    socket.on("end", onEnd);
    socket.on("error", onError);
  });
}

function encodeCString(value: string): Buffer {
  return Buffer.concat([Buffer.from(value, "utf8"), Buffer.from([0])]);
}

function readCString(
  buffer: Buffer,
  offset: number,
): {
  nextOffset: number;
  value: string;
} {
  const terminatorIndex = buffer.indexOf(0, offset);

  assert.notEqual(
    terminatorIndex,
    -1,
    "Expected a null terminator while parsing a postgres string field",
  );

  return {
    nextOffset: terminatorIndex + 1,
    value: buffer.subarray(offset, terminatorIndex).toString("utf8"),
  };
}

function readNullTerminatedList(buffer: Buffer): string[] {
  const values: string[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    const entry = readCString(buffer, offset);

    if (entry.value.length === 0) {
      break;
    }

    values.push(entry.value);
    offset = entry.nextOffset;
  }

  return values;
}

function parseRowDescription(payload: Buffer): string[] {
  const fieldCount = payload.readInt16BE(0);
  const fieldNames: string[] = [];
  let offset = 2;

  for (let index = 0; index < fieldCount; index += 1) {
    const field = readCString(payload, offset);

    fieldNames.push(field.value);
    offset = field.nextOffset + 18;
  }

  return fieldNames;
}

function parseDataRow(payload: Buffer, fieldNames: string[]): PostgresQueryRow {
  const fieldCount = payload.readInt16BE(0);
  const row: PostgresQueryRow = {};
  let offset = 2;

  for (let index = 0; index < fieldCount; index += 1) {
    const fieldName = fieldNames[index];

    assert.ok(fieldName, `Missing field name for postgres column index ${index}`);

    const columnLength = payload.readInt32BE(offset);

    offset += 4;

    if (columnLength === -1) {
      row[fieldName] = null;
      continue;
    }

    row[fieldName] = payload
      .subarray(offset, offset + columnLength)
      .toString("utf8");
    offset += columnLength;
  }

  return row;
}

function readErrorResponse(payload: Buffer): string {
  const fields = new Map<string, string>();
  let offset = 0;

  while (offset < payload.length) {
    const fieldType = payload.toString("utf8", offset, offset + 1);

    offset += 1;

    if (fieldType === "\u0000") {
      break;
    }

    const fieldValue = readCString(payload, offset);

    fields.set(fieldType, fieldValue.value);
    offset = fieldValue.nextOffset;
  }

  const message = fields.get("M") ?? "Unknown postgres error";
  const detail = fields.get("D");
  const hint = fields.get("H");

  return [message, detail, hint].filter(Boolean).join("\n");
}

function escapeScramValue(value: string): string {
  return value.replaceAll("=", "=3D").replaceAll(",", "=2C");
}

function readScramClientNonce(clientFirstBare: string): string {
  const attributes = parseScramAttributes(clientFirstBare);
  const nonce = attributes.get("r");

  assert.ok(nonce, "SCRAM client-first message is missing the nonce");

  return nonce;
}

function parseScramAttributes(message: string): Map<string, string> {
  const attributes = new Map<string, string>();

  for (const part of message.split(",")) {
    const separatorIndex = part.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    attributes.set(part.slice(0, separatorIndex), part.slice(separatorIndex + 1));
  }

  return attributes;
}

function verifyScramServerSignature(
  expectedSignature: string,
  serverFinalMessage: string,
) {
  const attributes = parseScramAttributes(serverFinalMessage);
  const serverSignature = attributes.get("v");

  assert.ok(serverSignature, "SCRAM final message is missing the server signature");
  assert.equal(serverSignature, expectedSignature, "SCRAM server signature mismatch");
}

function xorBuffers(left: Buffer, right: Buffer): Buffer {
  assert.equal(left.length, right.length, "SCRAM buffers must be the same length");

  const result = Buffer.alloc(left.length);

  for (let index = 0; index < left.length; index += 1) {
    result[index] = left[index] ^ right[index];
  }

  return result;
}

function quotePostgresString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function quoteNullablePostgresString(value: string | null): string {
  return value === null ? "NULL" : quotePostgresString(value);
}

function createTestGoogleUserPayload(
  overrides: Partial<GoogleUserModelPayload> = {},
): GoogleUserModelPayload {
  const identity = randomUUID().replaceAll("-", "");

  return {
    googleSubject: `google-subject-${identity}`,
    email: `${identity}@waka.test`,
    image: `https://example.com/avatar/${identity}.png`,
    name: `Waka Test ${identity.slice(0, 8)}`,
    ...overrides,
  };
}

async function readUserByGoogleSubject(
  connection: PostgresTestConnection,
  googleSubject: string,
): Promise<PersistedGoogleUserRecord | null> {
  const result = await connection.query(`
    SELECT
      "id",
      "google_subject" AS "googleSubject",
      "email",
      "name",
      "image",
      "createdAt"::TEXT AS "createdAt",
      "updatedAt"::TEXT AS "updatedAt"
    FROM "User"
    WHERE "google_subject" = ${quotePostgresString(googleSubject)}
    LIMIT 1
  `);

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  assert.ok(row.id, "Persisted Google user row is missing its id");
  assert.ok(
    row.googleSubject,
    "Persisted Google user row is missing its Google subject",
  );
  assert.ok(row.email, "Persisted Google user row is missing its email");
  assert.ok(
    row.createdAt,
    "Persisted Google user row is missing its creation timestamp",
  );
  assert.ok(
    row.updatedAt,
    "Persisted Google user row is missing its update timestamp",
  );

  return {
    id: row.id,
    googleSubject: row.googleSubject,
    email: row.email,
    name: row.name,
    image: row.image,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function countUsersByGoogleSubject(
  connection: PostgresTestConnection,
  googleSubject: string,
): Promise<number> {
  const result = await connection.query(`
    SELECT COUNT(*)::TEXT AS "count"
    FROM "User"
    WHERE "google_subject" = ${quotePostgresString(googleSubject)}
  `);

  const count = result.rows[0]?.count;

  assert.ok(count, "Expected the Google user count query to return a count");

  return Number.parseInt(count, 10);
}

async function upsertGoogleUser(
  connection: PostgresTestConnection,
  args: GoogleUserUpsertArgs,
): Promise<PersistedGoogleUserRecord> {
  const userId = `user_${randomUUID().replaceAll("-", "")}`;
  const result = await connection.query(`
    INSERT INTO "User" (
      "id",
      "google_subject",
      "email",
      "name",
      "image",
      "updatedAt"
    )
    VALUES (
      ${quotePostgresString(userId)},
      ${quotePostgresString(args.create.googleSubject)},
      ${quotePostgresString(args.create.email)},
      ${quoteNullablePostgresString(args.create.name)},
      ${quoteNullablePostgresString(args.create.image)},
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("google_subject")
    DO UPDATE SET
      "email" = EXCLUDED."email",
      "name" = EXCLUDED."name",
      "image" = EXCLUDED."image",
      "updatedAt" = CURRENT_TIMESTAMP
    RETURNING
      "id",
      "google_subject" AS "googleSubject",
      "email",
      "name",
      "image",
      "createdAt"::TEXT AS "createdAt",
      "updatedAt"::TEXT AS "updatedAt"
  `);

  const row = result.rows[0];

  assert.ok(row, "Expected the Google user upsert to return a row");
  assert.ok(row.id, "Persisted Google user is missing its id");
  assert.ok(row.googleSubject, "Persisted Google user is missing its subject");
  assert.ok(row.email, "Persisted Google user is missing its email");
  assert.ok(row.createdAt, "Persisted Google user is missing createdAt");
  assert.ok(row.updatedAt, "Persisted Google user is missing updatedAt");

  return {
    id: row.id,
    googleSubject: row.googleSubject,
    email: row.email,
    name: row.name,
    image: row.image,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function countGoogleAccountsByProviderAccountId(
  connection: PostgresTestConnection,
  providerAccountId: string,
): Promise<number> {
  const result = await connection.query(`
    SELECT COUNT(*)::TEXT AS "count"
    FROM "Account"
    WHERE "provider" = 'google'
      AND "providerAccountId" = ${quotePostgresString(providerAccountId)}
  `);

  const count = result.rows[0]?.count;

  assert.ok(
    count,
    "Expected the Google account count query to return a count",
  );

  return Number.parseInt(count, 10);
}

async function readGoogleAccountByProviderAccountId(
  connection: PostgresTestConnection,
  providerAccountId: string,
): Promise<PersistedGoogleAccountRecord | null> {
  const result = await connection.query(`
    SELECT
      "id",
      "userId",
      "type",
      "provider",
      "providerAccountId",
      "refresh_token" AS "refreshToken",
      "access_token" AS "accessToken",
      "expires_at"::TEXT AS "expiresAt",
      "token_type" AS "tokenType",
      "scope",
      "id_token" AS "idToken",
      "session_state" AS "sessionState",
      "createdAt"::TEXT AS "createdAt",
      "updatedAt"::TEXT AS "updatedAt"
    FROM "Account"
    WHERE "provider" = 'google'
      AND "providerAccountId" = ${quotePostgresString(providerAccountId)}
    LIMIT 1
  `);

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  assert.ok(row.id, "Persisted Google account row is missing its id");
  assert.ok(row.userId, "Persisted Google account row is missing its userId");
  assert.ok(row.type, "Persisted Google account row is missing its type");
  assert.ok(
    row.provider,
    "Persisted Google account row is missing its provider",
  );
  assert.ok(
    row.providerAccountId,
    "Persisted Google account row is missing its provider account id",
  );
  assert.ok(
    row.createdAt,
    "Persisted Google account row is missing its creation timestamp",
  );
  assert.ok(
    row.updatedAt,
    "Persisted Google account row is missing its update timestamp",
  );

  return {
    accessToken: row.accessToken,
    createdAt: row.createdAt,
    expiresAt:
      row.expiresAt === null ? null : Number.parseInt(row.expiresAt, 10),
    id: row.id,
    idToken: row.idToken,
    provider: row.provider,
    providerAccountId: row.providerAccountId,
    refreshToken: row.refreshToken,
    scope: row.scope,
    sessionState: row.sessionState,
    tokenType: row.tokenType,
    type: row.type,
    updatedAt: row.updatedAt,
    userId: row.userId,
  };
}

async function upsertGoogleAccount(
  connection: PostgresTestConnection,
  args: GoogleAccountUpsertArgs,
): Promise<PersistedGoogleAccountRecord> {
  const accountId = `account_${randomUUID().replaceAll("-", "")}`;
  const result = await connection.query(`
    INSERT INTO "Account" (
      "id",
      "userId",
      "type",
      "provider",
      "providerAccountId",
      "refresh_token",
      "access_token",
      "expires_at",
      "token_type",
      "scope",
      "id_token",
      "session_state",
      "updatedAt"
    )
    VALUES (
      ${quotePostgresString(accountId)},
      ${quotePostgresString(args.create.userId)},
      ${quotePostgresString(args.create.type)},
      ${quotePostgresString(args.create.provider)},
      ${quotePostgresString(args.create.providerAccountId)},
      ${quoteNullablePostgresString(args.create.refreshToken)},
      ${quotePostgresString(args.create.accessToken)},
      ${args.create.expiresAt},
      ${quotePostgresString(args.create.tokenType)},
      ${quoteNullablePostgresString(args.create.scope)},
      ${quotePostgresString(args.create.idToken)},
      ${quoteNullablePostgresString(args.create.sessionState)},
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("provider", "providerAccountId")
    DO UPDATE SET
      "userId" = EXCLUDED."userId",
      "type" = EXCLUDED."type",
      "refresh_token" = EXCLUDED."refresh_token",
      "access_token" = EXCLUDED."access_token",
      "expires_at" = EXCLUDED."expires_at",
      "token_type" = EXCLUDED."token_type",
      "scope" = EXCLUDED."scope",
      "id_token" = EXCLUDED."id_token",
      "session_state" = EXCLUDED."session_state",
      "updatedAt" = CURRENT_TIMESTAMP
    RETURNING
      "id",
      "userId",
      "type",
      "provider",
      "providerAccountId",
      "refresh_token" AS "refreshToken",
      "access_token" AS "accessToken",
      "expires_at"::TEXT AS "expiresAt",
      "token_type" AS "tokenType",
      "scope",
      "id_token" AS "idToken",
      "session_state" AS "sessionState",
      "createdAt"::TEXT AS "createdAt",
      "updatedAt"::TEXT AS "updatedAt"
  `);

  const row = result.rows[0];

  assert.ok(row, "Expected the Google account upsert to return a row");
  assert.ok(row.id, "Persisted Google account is missing its id");
  assert.ok(row.userId, "Persisted Google account is missing its userId");
  assert.ok(row.type, "Persisted Google account is missing its type");
  assert.ok(row.provider, "Persisted Google account is missing its provider");
  assert.ok(
    row.providerAccountId,
    "Persisted Google account is missing its provider account id",
  );
  assert.ok(
    row.createdAt,
    "Persisted Google account is missing createdAt",
  );
  assert.ok(
    row.updatedAt,
    "Persisted Google account is missing updatedAt",
  );

  return {
    accessToken: row.accessToken,
    createdAt: row.createdAt,
    expiresAt:
      row.expiresAt === null ? null : Number.parseInt(row.expiresAt, 10),
    id: row.id,
    idToken: row.idToken,
    provider: row.provider,
    providerAccountId: row.providerAccountId,
    refreshToken: row.refreshToken,
    scope: row.scope,
    sessionState: row.sessionState,
    tokenType: row.tokenType,
    type: row.type,
    updatedAt: row.updatedAt,
    userId: row.userId,
  };
}

export function getNeonGoogleAuthFixtureSkipReason(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const databaseUrl = env.DATABASE_URL;

  if (typeof databaseUrl !== "string" || databaseUrl.trim().length === 0) {
    return "DATABASE_URL is not configured";
  }

  return null;
}

export async function createNeonGoogleAuthFixture(
  env: NodeJS.ProcessEnv = process.env,
): Promise<NeonGoogleAuthFixture> {
  const skipReason = getNeonGoogleAuthFixtureSkipReason(env);

  assert.equal(skipReason, null, skipReason ?? "DATABASE_URL is required");

  const databaseUrl = env.DATABASE_URL!.trim();
  const connection = await PostgresTestConnection.connect(databaseUrl);

  const userTableCheck = await connection.query(
    `SELECT to_regclass('public."User"') AS "tableName"`,
  );

  assert.equal(
    userTableCheck.rows[0]?.tableName,
    "User",
    'The Neon auth fixture requires a migrated database with the "User" table',
  );

  await connection.query("BEGIN");

  let disposed = false;

  return {
    async countGoogleAccountsByProviderAccountId(providerAccountId) {
      return countGoogleAccountsByProviderAccountId(connection, providerAccountId);
    },
    async countUsersByGoogleSubject(googleSubject) {
      return countUsersByGoogleSubject(connection, googleSubject);
    },
    databaseUrl,
    userPersistenceClient: {
      account: {
        async upsert(args) {
          return upsertGoogleAccount(connection, args);
        },
      },
      user: {
        async upsert(args) {
          return upsertGoogleUser(connection, args);
        },
      },
    },
    async dispose() {
      if (disposed) {
        return;
      }

      disposed = true;

      try {
        await connection.query("ROLLBACK");
      } finally {
        await connection.close();
      }
    },
    async readUserByGoogleSubject(googleSubject) {
      return readUserByGoogleSubject(connection, googleSubject);
    },
    async readGoogleAccountByProviderAccountId(providerAccountId) {
      return readGoogleAccountByProviderAccountId(connection, providerAccountId);
    },
  };
}

export function createNeonGoogleUserPayload(
  overrides: Partial<GoogleUserModelPayload> = {},
): GoogleUserModelPayload {
  return createTestGoogleUserPayload(overrides);
}
