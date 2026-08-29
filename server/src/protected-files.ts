import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { fileTypeFromBuffer } from 'file-type';

export const MAX_FEEDBACK_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_FEEDBACK_ATTACHMENTS_PER_UPLOAD = 3;

const allowedTypes = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

export class ProtectedFileError extends Error {
  constructor(readonly code: 'INVALID_FILE_NAME' | 'FILE_TOO_LARGE' | 'UNSUPPORTED_FILE_TYPE' | 'FILE_TYPE_MISMATCH') {
    super(code);
    this.name = 'ProtectedFileError';
  }
}

export interface ValidatedFeedbackAttachment {
  buffer: Buffer;
  storageKey: string;
  originalName: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
}

function normalizedExtension(originalName: string) {
  const extension = path.extname(originalName).slice(1).toLowerCase();
  return extension === 'jpeg' ? 'jpg' : extension;
}

export async function validateFeedbackAttachment(input: {
  buffer: Buffer;
  originalName: string;
  declaredMime: string;
}): Promise<ValidatedFeedbackAttachment> {
  const originalName = input.originalName.trim();
  if (!originalName || path.basename(originalName) !== originalName || /[\\/\u0000-\u001f\u007f]/.test(originalName)) {
    throw new ProtectedFileError('INVALID_FILE_NAME');
  }
  if (input.buffer.length > MAX_FEEDBACK_ATTACHMENT_BYTES) throw new ProtectedFileError('FILE_TOO_LARGE');

  const detected = await fileTypeFromBuffer(input.buffer);
  const extension = detected ? allowedTypes.get(detected.mime) : undefined;
  if (!detected || !extension || normalizedExtension(originalName) !== extension) {
    throw new ProtectedFileError('UNSUPPORTED_FILE_TYPE');
  }
  if (input.declaredMime.toLowerCase() !== detected.mime) throw new ProtectedFileError('FILE_TYPE_MISMATCH');

  return {
    buffer: input.buffer,
    storageKey: `${crypto.randomUUID()}.${extension}`,
    originalName,
    mimeType: detected.mime,
    extension,
    sizeBytes: input.buffer.length,
  };
}

export function protectedFilePath(root: string, storageKey: string) {
  if (!/^[a-f0-9-]+\.(?:jpg|png|webp)$/.test(storageKey)) throw new ProtectedFileError('INVALID_FILE_NAME');
  const resolvedRoot = path.resolve(root);
  const resolvedFile = path.resolve(resolvedRoot, storageKey);
  if (path.dirname(resolvedFile) !== resolvedRoot) throw new ProtectedFileError('INVALID_FILE_NAME');
  return resolvedFile;
}

export async function persistProtectedFile(root: string, attachment: ValidatedFeedbackAttachment) {
  await mkdir(root, { recursive: true });
  const filePath = protectedFilePath(root, attachment.storageKey);
  await writeFile(filePath, attachment.buffer, { flag: 'wx', mode: 0o600 });
  return filePath;
}

export async function readProtectedFile(root: string, storageKey: string) {
  return readFile(protectedFilePath(root, storageKey));
}

export async function removeProtectedFile(root: string, storageKey: string) {
  await unlink(protectedFilePath(root, storageKey)).catch(() => undefined);
}
