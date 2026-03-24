import { apiFetch } from './fetch';

// Allowed MIME types for media uploads
export const allowedMimeTypes = [
  // Images
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  // Videos
  'video/mp4',
  'video/webm',
  'video/quicktime',
  // Audio
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
] as const;

export type AllowedMimeType = (typeof allowedMimeTypes)[number];

// Maximum file size: 50MB
export const maxFileSize = 50 * 1024 * 1024;

// Filename validation regex: alphanumeric, dots, hyphens, underscores
const filenameRegex = /^[\w\-. ]+$/;

export class FileValidationError extends Error {
  constructor(
    message: string,
    public code: 'INVALID_TYPE' | 'FILE_TOO_LARGE' | 'INVALID_FILENAME'
  ) {
    super(message);
    this.name = 'FileValidationError';
  }
}

/**
 * Validate a file before upload
 * @throws FileValidationError if validation fails
 */
export function validateFile(file: File): void {
  // Check file type
  if (!allowedMimeTypes.includes(file.type as AllowedMimeType)) {
    throw new FileValidationError(
      `Invalid file type: ${file.type}. Allowed types: ${allowedMimeTypes.join(', ')}`,
      'INVALID_TYPE'
    );
  }

  // Check file size
  if (file.size > maxFileSize) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
    throw new FileValidationError(
      `File too large: ${sizeMB}MB. Maximum size: 50MB`,
      'FILE_TOO_LARGE'
    );
  }

  // Check filename
  if (!filenameRegex.test(file.name)) {
    throw new FileValidationError(
      `Invalid filename: ${file.name}. Filename can only contain letters, numbers, dots, hyphens, underscores, and spaces.`,
      'INVALID_FILENAME'
    );
  }
}

/**
 * Check if a file type is allowed
 */
export function isAllowedMimeType(mimeType: string): mimeType is AllowedMimeType {
  return allowedMimeTypes.includes(mimeType as AllowedMimeType);
}

/**
 * Upload a media file
 * @throws FileValidationError if validation fails
 * @throws Error if upload fails
 */
export async function uploadMedia(file: File): Promise<{ url: string; r2_key: string; content_type: string }> {
  // Validate file before upload
  validateFile(file);

  const formData = new FormData();
  formData.append('file', file);

  const res = await apiFetch('/api/media/upload', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Failed to upload' }));
    throw new Error((error as { error?: string }).error || 'Failed to upload');
  }

  return res.json();
}
