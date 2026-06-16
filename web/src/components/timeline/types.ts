export type UploadedMedia = {
  url?: string;
  r2_key: string;
  content_type: string;
  preview: string;
  // ActivityPub-standard alt text (`name` on a Document attachment).
  name?: string;
};
