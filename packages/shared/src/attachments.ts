import type { ApiAttachment } from './types.js';

export function describeAttachments(attachments: Pick<ApiAttachment, 'content_type'>[]): string {
  const n = attachments.length;
  if (attachments.every((a) => a.content_type.startsWith('image/'))) {
    return n > 1 ? `sent ${n} photos` : 'sent a photo';
  }
  return n > 1 ? `sent ${n} files` : 'sent a file';
}
