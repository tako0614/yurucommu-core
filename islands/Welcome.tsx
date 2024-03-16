import RegisterForm from "../islands/RegisterForm.tsx"
import { useState,useEffect } from "preact/hooks";
declare global {
  interface Window {
    grecaptcha: {
      ready: (callback: () => void) => void;
      execute: (siteKey: string, options: { action: string }) => Promise<string>;
    };
  }
}
export default function Welcome ({sitekey}: {sitekey: string;}) {
  const [rechapchaToken, setRecaptchaToken] = useState("");
  const [recaptchaLoaded, setRecaptchaLoaded] = useState(false);
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://www.google.com/recaptcha/api.js?render=" + sitekey;
    script.async = true;
    script.onload = () => {
      setRecaptchaLoaded(true);
    };
    document.body.appendChild(script);
  }, [sitekey]);

  useEffect(() => {
    if (recaptchaLoaded) {
      window.grecaptcha.ready(() => {
        window.grecaptcha.execute(sitekey, { action: "homepage" }).then((token) => {
          setRecaptchaToken(token);
        });
      });
    }
  }, [recaptchaLoaded, sitekey]);
  return (
    <>
<div>
<div class="min-h-screen bg-black flex flex-row justify-center items-center text-white">
  <div class="flex flex-col justify-center items-center space-y-6 md:w-1/2 w-0">
    <div>
      <img src="./logo2.webp" alt="logo" class="h-full w-full"/>
    </div>
  </div>
  <div class="flex flex-col justify-start items-center md:items-start space-y-3 md:w-1/2 w-full">
    <div class="text-center md:text-left">
      <h1 class="text-5xl font-bold mb-3">tako's</h1>
      <p class="text-lg mb-8">Next generation decentralized chat service</p>
<p class="text-lg">現在開発中</p>
<p class="text-lg mb-8">開発者募集中です！公式オープンチャットから</p>
    </div>
    <div class="flex flex-col space-y-3 mb-8">
      <RegisterForm sitekey={rechapchaToken} tako="instans" color="hover:bg-primary/90 h-11 px-4 py-2 bg-white text-black w-64 " text="他のインスタンス"></RegisterForm>
      <RegisterForm sitekey={rechapchaToken} tako="register" color="hover:bg-accent hover:text-accent-foreground h-11 px-4 py-2 bg-black border border-white text-white w-64" text="このサーバーに登録"></RegisterForm>
      <RegisterForm sitekey={rechapchaToken} tako="login" color="hover:bg-primary/90 h-11 px-4 py-2 bg-blue-600 text-white w-64 " text="ログイン"></RegisterForm>
    </div>
    <div class="text-center md:text-left text-sm mb-8">
      <p>
        アカウントを登録することにより、利用規約とプライバシーポリシー（Cookieの使用を含む）に同意したことになります。
      </p>
    </div>
  </div>
  </div>
</div>
    </>
  )
}

function setRecaptcha(token: string) {
  throw new Error("Function not implemented.");
}
