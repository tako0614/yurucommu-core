import { useEffect } from "preact/hooks";
export default function PleaseLogin() {
    useEffect(() => {
        const timeout = setTimeout(() => {
            navigate("/");
        }, 5000);

        return () => clearTimeout(timeout);
    }, []);
  return (
    <>
    <div>
        <h1>ログインしてください</h1>
        <p>5秒後にトップにリダイレクトされます</p>
    </div>
    </>
  )
}
