import { useCallback, useState } from 'react';

export function useInlineError() {
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return { error, setError, clearError };
}
