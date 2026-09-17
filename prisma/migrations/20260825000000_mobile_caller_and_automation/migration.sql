CREATE TYPE "CallStatus" AS ENUM ('QUEUED', 'DELIVERED', 'RINGING', 'CONNECTED', 'ENDED', 'FAILED', 'EXPIRED');
CREATE TYPE "CallDirection" AS ENUM ('OUTBOUND', 'INBOUND');
CREATE TYPE "DeviceStatus" AS ENUM ('ONLINE', 'OFFLINE', 'REVOKED');
CREATE TYPE "DeviceCommandType" AS ENUM ('CALL');
CREATE TYPE "DeviceCommandStatus" AS ENUM ('QUEUED', 'DELIVERED', 'ACKNOWLEDGED', 'EXPIRED', 'FAILED');
CREATE TYPE "RecordingUploadStatus" AS ENUM ('PENDING', 'UPLOADING', 'UPLOADED', 'FAILED', 'DELETED');
CREATE TYPE "CommunicationProvider" AS ENUM ('WHATSAPP', 'EMAIL');
CREATE TYPE "CommunicationStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

CREATE TABLE "devices" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "agentId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "deviceName" TEXT NOT NULL,
  "platform" TEXT NOT NULL DEFAULT 'ANDROID',
  "appVersion" TEXT NOT NULL DEFAULT '1.0.0',
  "status" "DeviceStatus" NOT NULL DEFAULT 'OFFLINE',
  "lastSeenAt" TIMESTAMP(3),
  "selectedSimId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "devices_deviceId_key" ON "devices"("deviceId");
CREATE INDEX "devices_companyId_idx" ON "devices"("companyId");
CREATE INDEX "devices_agentId_idx" ON "devices"("agentId");
CREATE INDEX "devices_status_idx" ON "devices"("status");
ALTER TABLE "devices" ADD CONSTRAINT "devices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "devices" ADD CONSTRAINT "devices_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "crm_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "call_sessions" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "agentId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "phoneNumber" TEXT NOT NULL,
  "direction" "CallDirection" NOT NULL DEFAULT 'OUTBOUND',
  "simSlot" TEXT,
  "status" "CallStatus" NOT NULL DEFAULT 'QUEUED',
  "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredAt" TIMESTAMP(3),
  "ringingAt" TIMESTAMP(3),
  "connectedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "durationSeconds" INTEGER NOT NULL DEFAULT 0,
  "failureReason" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "call_sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "call_sessions_idempotencyKey_key" ON "call_sessions"("idempotencyKey");
CREATE INDEX "call_sessions_companyId_initiatedAt_idx" ON "call_sessions"("companyId", "initiatedAt");
CREATE INDEX "call_sessions_agentId_initiatedAt_idx" ON "call_sessions"("agentId", "initiatedAt");
CREATE INDEX "call_sessions_leadId_initiatedAt_idx" ON "call_sessions"("leadId", "initiatedAt");
CREATE INDEX "call_sessions_status_initiatedAt_idx" ON "call_sessions"("status", "initiatedAt");
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "crm_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "call_events" (
  "id" TEXT NOT NULL,
  "callId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "state" "CallStatus" NOT NULL,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "call_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "call_events_eventId_key" ON "call_events"("eventId");
CREATE INDEX "call_events_callId_createdAt_idx" ON "call_events"("callId", "createdAt");
ALTER TABLE "call_events" ADD CONSTRAINT "call_events_callId_fkey" FOREIGN KEY ("callId") REFERENCES "call_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "call_recordings" (
  "id" TEXT NOT NULL,
  "callId" TEXT NOT NULL,
  "storageKey" TEXT,
  "mimeType" TEXT,
  "sizeBytes" INTEGER,
  "durationSeconds" INTEGER,
  "uploadStatus" "RecordingUploadStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "call_recordings_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "call_recordings_callId_idx" ON "call_recordings"("callId");
CREATE INDEX "call_recordings_uploadStatus_idx" ON "call_recordings"("uploadStatus");
ALTER TABLE "call_recordings" ADD CONSTRAINT "call_recordings_callId_fkey" FOREIGN KEY ("callId") REFERENCES "call_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "device_commands" (
  "id" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "callId" TEXT,
  "commandType" "DeviceCommandType" NOT NULL,
  "status" "DeviceCommandStatus" NOT NULL DEFAULT 'QUEUED',
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredAt" TIMESTAMP(3),
  "acknowledgedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  CONSTRAINT "device_commands_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "device_commands_deviceId_status_createdAt_idx" ON "device_commands"("deviceId", "status", "createdAt");
CREATE INDEX "device_commands_callId_idx" ON "device_commands"("callId");
ALTER TABLE "device_commands" ADD CONSTRAINT "device_commands_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "device_commands" ADD CONSTRAINT "device_commands_callId_fkey" FOREIGN KEY ("callId") REFERENCES "call_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "communication_logs" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "leadId" TEXT,
  "senderId" TEXT,
  "provider" "CommunicationProvider" NOT NULL,
  "status" "CommunicationStatus" NOT NULL DEFAULT 'QUEUED',
  "recipient" TEXT NOT NULL,
  "subject" TEXT,
  "template" TEXT,
  "messageId" TEXT,
  "error" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  CONSTRAINT "communication_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "communication_logs_companyId_createdAt_idx" ON "communication_logs"("companyId", "createdAt");
CREATE INDEX "communication_logs_leadId_createdAt_idx" ON "communication_logs"("leadId", "createdAt");
CREATE INDEX "communication_logs_provider_status_idx" ON "communication_logs"("provider", "status");
ALTER TABLE "communication_logs" ADD CONSTRAINT "communication_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "communication_logs" ADD CONSTRAINT "communication_logs_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "communication_logs" ADD CONSTRAINT "communication_logs_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "crm_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
