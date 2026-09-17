-- Ensure databases created from an older Mobile Caller migration have
-- the UPLOADED recording status expected by Prisma and the CRM UI.
ALTER TYPE "RecordingUploadStatus" ADD VALUE IF NOT EXISTS 'UPLOADED';
