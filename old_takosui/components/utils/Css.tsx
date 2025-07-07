import { loginState } from "../../utils/state";
import { useAtom } from "solid-jotai";
import { Link } from "@solidjs/meta";
import { MetaProvider } from "@solidjs/meta";
export function Css() {
  const [login] = useAtom(loginState);
  return (
    <>
      <MetaProvider>
        {login()
          ? <Link href="/App.css" rel="stylesheet" />
          : <Link href="/stylesheet.css" rel="stylesheet" />}
      </MetaProvider>
    </>
  );
}
