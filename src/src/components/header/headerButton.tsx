import { useSetAtom } from "solid-jotai";
import { selectedAppState } from "../../states/app.ts";
import type { JSX } from "solid-js";

interface HeaderButtonProps {
  page: string;
  children: JSX.Element;
}

export default function HeaderButton(
  props: HeaderButtonProps,
) {
  const setSelectedApp = useSetAtom(selectedAppState);
  return (
    <li
      class="l-header__ul-item"
      onClick={() => {
        setSelectedApp(props.page);
      }}
    >
      {props.children}
    </li>
  );
}
