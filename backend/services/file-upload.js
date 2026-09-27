import crypto from 'node:crypto';
import { mkdirSync, unlink } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';

export const uploadDirectory = path.join(process.cwd(), 'data', 'uploads');
mkdirSync(uploadDirectory, { recursive: true });

const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4']);
const allowedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.mp4']);

const storage = multer.diskStorage({
  destination: (_request, _file, callback) => callback(null, uploadDirectory),
  filename: (_request, file, callback) => callback(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
});

export const issueAttachmentUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (!allowedMimeTypes.has(file.mimetype) || !allowedExtensions.has(extension)) {
      callback(new Error('Only JPG, PNG, WEBP, and MP4 attachments are allowed.'));
      return;
    }
    callback(null, true);
  },
});

export function uploadIssueAttachment(request, response, next) {
  issueAttachmentUpload.single('attachment')(request, response, (error) => {
    if (error) {
      response.status(400).json({ ok: false, message: error instanceof Error ? error.message : 'Attachment upload failed.' });
      return;
    }
    next();
  });
}

export function removeUploadedFile(file) {
  if (!file?.path) return;
  unlink(file.path, () => {});
}

export async function hasValidFileSignature(file) {
  if (!file?.path) return true;
  const bytes = await readFile(file.path);
  const extension = path.extname(file.originalname).toLowerCase();
  if (extension === '.png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (extension === '.jpg' || extension === '.jpeg') return bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (extension === '.webp') return bytes.length >= 12 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (extension === '.mp4') return bytes.length >= 12 && bytes.subarray(4, 8).toString() === 'ftyp';
  return false;
}
