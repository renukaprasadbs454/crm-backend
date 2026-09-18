import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../config/env.js';

const r2Enabled = env.storageProvider === 'r2';
const r2Client = r2Enabled
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${env.r2AccountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: env.r2AccessKeyId, secretAccessKey: env.r2SecretAccessKey },
    })
  : null;

export async function putRecording(key, file) {
  if (r2Client) {
    await r2Client.send(new PutObjectCommand({
      Bucket: env.r2Bucket,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype || 'application/octet-stream',
    }));
    return { key, url: env.r2PublicUrl ? `${env.r2PublicUrl}/${key}` : null };
  }

  const absolutePath = path.resolve(env.recordingsDir, key);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, file.buffer);
  return { key, url: null };
}

export async function deleteRecording(key) {
  if (r2Client) {
    await r2Client.send(new DeleteObjectCommand({ Bucket: env.r2Bucket, Key: key }));
    return;
  }

  await fs.rm(path.resolve(env.recordingsDir, key), { force: true });
}

export function createRecordingKey(callId, originalName = '') {
  const extension = path.extname(originalName).replace(/[^a-zA-Z0-9.]/g, '') || '.audio';
  return `recordings/${callId}-${crypto.randomUUID()}${extension}`;
}