import { VALENTINO_AVATAR_SVG } from '@wazup/shared';

const SRC = `data:image/svg+xml,${encodeURIComponent(VALENTINO_AVATAR_SVG)}`;

interface Props {
  size?: number;
  className?: string;
}

export function Valentino({ size = 72, className }: Props) {
  return (
    <img
      src={SRC}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={className}
    />
  );
}
