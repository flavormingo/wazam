import { api, uploadToPresigned } from './api';
import { toast } from '../stores/toast';

const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024;

export function filterAttachable(files: File[]): File[] {
  const tooBig = files.filter((f) => f.size > MAX_ATTACHMENT_SIZE);
  if (tooBig.length) {
    toast.error(tooBig.length === 1 ? `${tooBig[0].name} is over 20MB` : `${tooBig.length} files are over 20MB`);
  }
  return files.filter((f) => f.size > 0 && f.size <= MAX_ATTACHMENT_SIZE);
}

export async function uploadAttachments(files: File[]): Promise<string[]> {
  const ids: string[] = [];
  for (const file of files) {
    const presign = await api.presignUpload({
      filename: file.name,
      content_type: file.type || 'application/octet-stream',
      size: file.size,
    });
    await uploadToPresigned(presign, file);
    ids.push(presign.attachment_id);
  }
  return ids;
}
