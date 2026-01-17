export async function uploadMedia(file: File): Promise<{ url: string; r2_key: string; content_type: string }> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch('/api/media/upload', {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error('Failed to upload');
  return res.json();
}
