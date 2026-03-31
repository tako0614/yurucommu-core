import { useAtomValue } from 'jotai';
import { actorAtom } from '../atoms/auth.ts';

export function useRequiredActor() {
  const actor = useAtomValue(actorAtom);
  if (!actor) throw new Error('Actor is required but not available');
  return actor;
}
