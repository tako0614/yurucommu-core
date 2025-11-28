import { createContext, useContext, type ParentProps } from "solid-js";

export type ShellContextValue = {
  onOpenComposer?: () => void;
  onOpenNotifications?: () => void;
};

const ShellContext = createContext<ShellContextValue | undefined>(undefined);

export function ShellContextProvider(
  props: ParentProps<{ value: ShellContextValue }>,
) {
  return (
    <ShellContext.Provider value={props.value}>
      {props.children}
    </ShellContext.Provider>
  );
}

export function useShellContext(): ShellContextValue | undefined {
  return useContext(ShellContext);
}