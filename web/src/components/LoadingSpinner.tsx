import { useI18n } from '../lib/i18n';

interface LoadingSpinnerProps {
  /** Optional message to display below the spinner */
  message?: string;
  /** Size variant of the spinner */
  size?: 'sm' | 'md' | 'lg';
  /** Whether to center the spinner in the full viewport */
  fullScreen?: boolean;
}

export function LoadingSpinner({
  message,
  size = 'md',
  fullScreen = true,
}: LoadingSpinnerProps) {
  const { t } = useI18n();
  const displayMessage = message ?? t('common.loading');

  const sizeClasses = {
    sm: 'w-6 h-6 border-2',
    md: 'w-10 h-10 border-3',
    lg: 'w-14 h-14 border-4',
  };

  const containerClasses = fullScreen
    ? 'flex flex-col items-center justify-center h-screen bg-neutral-950'
    : 'flex flex-col items-center justify-center py-8';

  return (
    <div className={containerClasses}>
      <div
        className={`${sizeClasses[size]} border-neutral-700 border-t-neutral-400 rounded-full animate-spin`}
        role="status"
        aria-label={displayMessage}
      />
      {displayMessage && (
        <p className="mt-4 text-neutral-500 text-sm">{displayMessage}</p>
      )}
    </div>
  );
}

export default LoadingSpinner;
