import { useAtomValue } from "solid-jotai";
import { actorAtom } from "../atoms/auth.ts";

export function useRequiredActor() {
  const actor = useAtomValue(actorAtom);
  const value = actor();
  if (!value) throw new Error("Actor is required but not available");
  return value;
}
