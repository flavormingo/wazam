import { XIcon } from './icons';

interface Props {
  files: File[];
  onRemove: (index: number) => void;
}

export function PendingFiles({ files, onRemove }: Props) {
  if (files.length === 0) return null;

  return (
    <div className="pending-files">
      {files.map((f, i) => (
        <div key={`${f.name}-${f.size}-${f.lastModified}`} className="file">
          <span>{f.name}</span>
          <button aria-label="remove file" onClick={() => onRemove(i)}><XIcon size={10} /></button>
        </div>
      ))}
    </div>
  );
}
