import { useSetAtom } from "solid-jotai";
import { selectedAppState } from "../../states/app.ts";
import { selectedExtensionState } from "../../states/extensions.ts";
import type { JSX } from "solid-js";

interface HeaderButtonProps {
  page: string;
  children: JSX.Element;
}

export default function HeaderButton(
  props: HeaderButtonProps,
) {
  const setSelectedApp = useSetAtom(selectedAppState);
  const setSelectedExt = useSetAtom(selectedExtensionState);
  return (
    <li
      class="l-header__ul-item"
      onClick={() => {
        setSelectedExt(null);
        setSelectedApp(props.page);
      }}
    >
      {props.children}
    </li>
  );
}
