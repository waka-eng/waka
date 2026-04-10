-- CreateEnum
CREATE TYPE "SourceType" AS ENUM (
  'CLI_CONVERSATION',
  'VOICE_NOTE',
  'TEXT_NOTE',
  'URL_IMPORT',
  'PHOTO',
  'AI_CONVERSATION'
);

-- CreateEnum
CREATE TYPE "ReflectionStatus" AS ENUM (
  'PENDING',
  'PROMPTED',
  'ANSWERED',
  'SKIPPED',
  'NOT_NEEDED'
);

-- CreateTable
CREATE TABLE "Tenant" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "google_subject" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT,
  "image" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
  "tenantId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Membership_pkey" PRIMARY KEY ("workspaceId", "userId")
);

-- CreateTable
CREATE TABLE "Account" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  "refresh_token" TEXT,
  "access_token" TEXT,
  "expires_at" INTEGER,
  "token_type" TEXT,
  "scope" TEXT,
  "id_token" TEXT,
  "session_state" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
  "id" TEXT NOT NULL,
  "sessionToken" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "expires" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
  "identifier" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "expires" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("identifier", "token")
);

-- CreateTable
CREATE TABLE "Cluster" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Cluster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inspiration" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT,
  "rawContent" TEXT NOT NULL,
  "summary" TEXT,
  "sourceType" "SourceType" NOT NULL,
  "sourceUrl" TEXT,
  "sourceMeta" JSONB,
  "mediaUrl" TEXT,
  "transcript" TEXT,
  "embedding" vector(1536),
  "tags" TEXT[] NOT NULL,
  "domain" TEXT,
  "mood" TEXT,
  "actionability" TEXT,
  "reflectionPrompt" TEXT,
  "reflectionAnswer" TEXT,
  "reflectionStatus" "ReflectionStatus" NOT NULL DEFAULT 'PENDING',
  "parentId" TEXT,
  "clusterId" TEXT,
  "isPublic" BOOLEAN NOT NULL DEFAULT false,
  "shareSlug" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Inspiration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Connection" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "similarityScore" DOUBLE PRECISION NOT NULL,
  "explanation" TEXT NOT NULL,
  "surfacedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dismissed" BOOLEAN NOT NULL DEFAULT false,

  CONSTRAINT "Connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "hashedKey" TEXT NOT NULL,
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_google_subject_key" ON "User"("google_subject");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_tenantId_slug_key" ON "Workspace"("tenantId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_tenantId_id_key" ON "Workspace"("tenantId", "id");

-- CreateIndex
CREATE INDEX "Workspace_tenantId_createdAt_idx" ON "Workspace"("tenantId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Membership_tenantId_workspaceId_idx" ON "Membership"("tenantId", "workspaceId");

-- CreateIndex
CREATE INDEX "Membership_tenantId_userId_idx" ON "Membership"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "Membership_userId_createdAt_idx" ON "Membership"("userId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Inspiration_userId_id_key" ON "Inspiration"("userId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Inspiration_userId_sourceType_sourceUrl_key" ON "Inspiration"("userId", "sourceType", "sourceUrl");

-- CreateIndex
CREATE UNIQUE INDEX "Inspiration_userId_sourceType_mediaUrl_key" ON "Inspiration"("userId", "sourceType", "mediaUrl");

-- CreateIndex
CREATE UNIQUE INDEX "Inspiration_shareSlug_key" ON "Inspiration"("shareSlug");

-- CreateIndex
CREATE INDEX "Inspiration_userId_createdAt_idx" ON "Inspiration"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Inspiration_userId_deletedAt_idx" ON "Inspiration"("userId", "deletedAt");

-- CreateIndex
CREATE INDEX "Inspiration_userId_deletedAt_createdAt_idx" ON "Inspiration"("userId", "deletedAt", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Inspiration_userId_sourceType_createdAt_idx" ON "Inspiration"("userId", "sourceType", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Inspiration_userId_sourceUrl_idx" ON "Inspiration"("userId", "sourceUrl");

-- CreateIndex
CREATE INDEX "Inspiration_userId_mediaUrl_idx" ON "Inspiration"("userId", "mediaUrl");

-- CreateIndex
CREATE INDEX "Inspiration_userId_isPublic_deletedAt_createdAt_idx" ON "Inspiration"("userId", "isPublic", "deletedAt", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Inspiration_userId_clusterId_createdAt_idx" ON "Inspiration"("userId", "clusterId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Inspiration_clusterId_createdAt_idx" ON "Inspiration"("clusterId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Inspiration_clusterId_isPublic_deletedAt_createdAt_idx" ON "Inspiration"("clusterId", "isPublic", "deletedAt", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Cluster_userId_id_key" ON "Cluster"("userId", "id");

-- CreateIndex
CREATE INDEX "Cluster_userId_idx" ON "Cluster"("userId");

-- CreateIndex
CREATE INDEX "Cluster_userId_updatedAt_idx" ON "Cluster"("userId", "updatedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Connection_sourceId_targetId_key" ON "Connection"("sourceId", "targetId");

-- CreateIndex
CREATE INDEX "Connection_userId_surfacedAt_idx" ON "Connection"("userId", "surfacedAt" DESC);

-- CreateIndex
CREATE INDEX "Connection_userId_dismissed_surfacedAt_idx" ON "Connection"("userId", "dismissed", "surfacedAt" DESC);

-- CreateIndex
CREATE INDEX "Connection_userId_sourceId_surfacedAt_idx" ON "Connection"("userId", "sourceId", "surfacedAt" DESC);

-- CreateIndex
CREATE INDEX "Connection_userId_targetId_surfacedAt_idx" ON "Connection"("userId", "targetId", "surfacedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_hashedKey_key" ON "ApiKey"("hashedKey");

-- CreateIndex
CREATE INDEX "ApiKey_userId_idx" ON "ApiKey"("userId");

-- CreateIndex
CREATE INDEX "ApiKey_userId_createdAt_idx" ON "ApiKey"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ApiKey_userId_revokedAt_createdAt_idx" ON "ApiKey"("userId", "revokedAt", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "Workspace"
ADD CONSTRAINT "Workspace_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership"
ADD CONSTRAINT "Membership_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership"
ADD CONSTRAINT "Membership_tenantId_workspaceId_fkey"
FOREIGN KEY ("tenantId", "workspaceId") REFERENCES "Workspace"("tenantId", "id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership"
ADD CONSTRAINT "Membership_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account"
ADD CONSTRAINT "Account_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session"
ADD CONSTRAINT "Session_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cluster"
ADD CONSTRAINT "Cluster_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspiration"
ADD CONSTRAINT "Inspiration_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspiration"
ADD CONSTRAINT "Inspiration_parentId_fkey"
FOREIGN KEY ("parentId") REFERENCES "Inspiration"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspiration"
ADD CONSTRAINT "Inspiration_userId_clusterId_fkey"
FOREIGN KEY ("userId", "clusterId") REFERENCES "Cluster"("userId", "id")
ON DELETE SET NULL
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Connection"
ADD CONSTRAINT "Connection_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Connection"
ADD CONSTRAINT "Connection_sourceId_fkey"
FOREIGN KEY ("sourceId") REFERENCES "Inspiration"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Connection"
ADD CONSTRAINT "Connection_targetId_fkey"
FOREIGN KEY ("targetId") REFERENCES "Inspiration"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey"
ADD CONSTRAINT "ApiKey_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
