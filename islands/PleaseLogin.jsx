import { useEffect } from "preact/hooks";
export default function PleaseLogin() {
  useEffect(() => {
    setTimeout(() => {
      window.location.href = "/";
    }, 5000);
  }, []);
  return (
    <>
      <div>
        <h1>ログインしてください</h1>
        <p>5秒後にトップにリダイレクトされます</p>
      </div>
    </>
  );
}
