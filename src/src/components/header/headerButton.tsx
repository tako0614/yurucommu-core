import { useAtom, useSetAtom } from "solid-jotai";
import { selectedAppState } from "../../states/app.ts";
export default function HeaderButton(
  props: { page: any; children: any },
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
