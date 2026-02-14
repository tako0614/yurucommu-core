import { getSlotComponents, type SlotName } from '../lib/plugin';

interface PluginSlotProps {
  name: SlotName;
}

export function PluginSlot({ name }: PluginSlotProps) {
  const components = getSlotComponents(name);
  if (components.length === 0) return null;
  return (
    <>
      {components.map((Component, i) => (
        <Component key={i} />
      ))}
    </>
  );
}
