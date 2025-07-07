import { pageState } from "../../utils/state";
import { useAtom } from "solid-jotai";
export default function HeaderButton(
  props: { page: any; children: any },
) {
  const [page, setPage] = useAtom(pageState);
  return (
    <li
      class="l-header__ul-item"
      onClick={() => {
        console.log(props.page);
        setPage(props.page);
      }}
    >
      {props.children}
    </li>
  );
}
