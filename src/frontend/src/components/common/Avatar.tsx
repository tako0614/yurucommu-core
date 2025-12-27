import React from 'react';

interface AvatarProps {
  src?: string | null;
  alt?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

export function Avatar({
  src,
  alt = 'Avatar',
  size = 'md',
  className = '',
}: AvatarProps) {
  const sizes = {
    sm: 'w-8 h-8 text-sm',
    md: 'w-10 h-10 text-base',
    lg: 'w-14 h-14 text-lg',
    xl: 'w-20 h-20 text-2xl',
  };

  const initials = alt
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        className={`
          ${sizes[size]}
          rounded-full object-cover
          bg-gray-200
          ${className}
        `.trim()}
      />
    );
  }

  return (
    <div
      className={`
        ${sizes[size]}
        rounded-full
        bg-gradient-to-br from-blue-500 to-purple-600
        flex items-center justify-center
        text-white font-medium
        ${className}
      `.trim()}
    >
      {initials || '?'}
    </div>
  );
}
