import { For, Show } from 'solid-js';
import { getSlotComponents, type SlotName } from '../lib/plugin.ts';

interface PluginSlotProps {
  name: SlotName;
}

export function PluginSlot(props: PluginSlotProps) {
  const components = () => getSlotComponents(props.name);
  return (
    <Show when={components().length > 0}>
      <For each={components()}>{(Component) => (
        <Component />
      )}</For>
    </Show>
  );
}
