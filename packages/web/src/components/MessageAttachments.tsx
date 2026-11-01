import type { ApiAttachment } from '@wazam/shared';
import { openLightbox } from '../stores/lightbox';

interface Props {
  attachments?: ApiAttachment[];
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MessageAttachments({ attachments }: Props) {
  if (!attachments || attachments.length === 0) return null;

  return (
    <div className="attachments">
      {attachments.map((att) => (
        <div key={att.id}>
          {att.content_type.startsWith('image/') ? (
            <img
              src={att.url}
              alt={att.filename}
              role="button"
              tabIndex={0}
              onClick={() => openLightbox(att.url, att.filename)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightbox(att.url, att.filename); } }}
            />
          ) : (
            <a href={att.url} target="_blank" rel="noopener noreferrer">
              {att.filename} ({formatSize(att.size)})
            </a>
          )}
        </div>
      ))}
    </div>
  );
}
