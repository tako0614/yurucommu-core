import { apiFetch, assertOk } from "./fetch.ts";
import { UPLOAD_REQUEST_TIMEOUT_MS } from "../fetch-with-timeout.ts";

// Allowed MIME types for media uploads
export const allowedMimeTypes = [
  // Images
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  // Videos
  "video/mp4",
  "video/webm",
] as const;

export type AllowedMimeType = (typeof allowedMimeTypes)[number];

// Maximum file sizes match the backend media route.
export const maxImageFileSize = 20 * 1024 * 1024;
export const maxVideoFileSize = 100 * 1024 * 1024;

// Filename validation regex: alphanumeric, dots, hyphens, underscores
const filenameRegex = /^[\w\-. ]+$/;

export class FileValidationError extends Error {
  constructor(
    message: string,
    public code: "INVALID_TYPE" | "FILE_TOO_LARGE" | "INVALID_FILENAME",
  ) {
    super(message);
    this.name = "FileValidationError";
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
      `Invalid file type: ${file.type}. Allowed types: ${
        allowedMimeTypes.join(", ")
      }`,
      "INVALID_TYPE",
    );
  }

  // Check file size
  const maxFileSize = file.type.startsWith("video/")
    ? maxVideoFileSize
    : maxImageFileSize;
  if (file.size > maxFileSize) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
    const maxMB = maxFileSize / (1024 * 1024);
    throw new FileValidationError(
      `File too large: ${sizeMB}MB. Maximum size: ${maxMB}MB`,
      "FILE_TOO_LARGE",
    );
  }

  // Check filename
  if (!filenameRegex.test(file.name)) {
    throw new FileValidationError(
      `Invalid filename: ${file.name}. Filename can only contain letters, numbers, dots, hyphens, underscores, and spaces.`,
      "INVALID_FILENAME",
    );
  }
}

/**
 * Check if a file type is allowed
 */
export function isAllowedMimeType(
  mimeType: string,
): mimeType is AllowedMimeType {
  return allowedMimeTypes.includes(mimeType as AllowedMimeType);
}

/**
 * Upload a media file
 * @throws FileValidationError if validation fails
 * @throws Error if upload fails
 */
export async function uploadMedia(
  file: File,
): Promise<{ url: string; r2_key: string; content_type: string }> {
  // Validate file before upload
  validateFile(file);

  const formData = new FormData();
  formData.append("file", file);

  const res = await apiFetch("/api/media/upload", {
    method: "POST",
    body: formData,
    timeoutMs: UPLOAD_REQUEST_TIMEOUT_MS,
  });

  await assertOk(res, "Failed to upload");

  return res.json();
}
