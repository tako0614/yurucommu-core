interface UserAvatarProps {
  avatarUrl: string | null;
  name: string;
  size?: number | 'small' | 'medium' | 'large';
  className?: string;
}

export function UserAvatar({ avatarUrl, name, size = 'medium', className = '' }: UserAvatarProps) {
  const getInitial = (name: string) => name.charAt(0).toUpperCase();

  const namedSizes = {
    small: 32,
    medium: 36,
    large: 40,
  };

  const pixelSize = typeof size === 'number' ? size : namedSizes[size];
  const fontSize = pixelSize < 32 ? 'text-xs' : pixelSize < 40 ? 'text-sm' : pixelSize < 56 ? 'text-base' : 'text-xl';

  return (
    <div
      className={`rounded-full bg-neutral-700 flex items-center justify-center shrink-0 overflow-hidden ${className}`}
      style={{ width: pixelSize, height: pixelSize }}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt={name} className="w-full h-full object-cover" />
      ) : (
        <span className={`text-neutral-300 ${fontSize}`}>{getInitial(name)}</span>
      )}
    </div>
  );
}
