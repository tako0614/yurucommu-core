import { createContext, useContext, type PropsWithChildren } from "react";

export type ShellContextValue = {
  onOpenComposer?: () => void;
  onOpenNotifications?: () => void;
};

const ShellContext = createContext<ShellContextValue | undefined>(undefined);

export function ShellContextProvider(
  props: PropsWithChildren<{ value: ShellContextValue }>,
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
