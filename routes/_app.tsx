import { AppProps } from "$fresh/server.ts";
import { GoogleReCaptchaProvider } from 'react-google-recaptcha-v3';
import { load } from "https://deno.land/std@0.204.0/dotenv/mod.ts";
const env = load();
const sitkey = env["RECAPTCHA_SITE_KEY"];
import react from "preact/compat";
export default function App({ Component }: AppProps) {
  return (
    <>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </head>
      <body>
      <GoogleReCaptchaProvider
        reCaptchaKey={sitkey}
        language="ja"
        >
        <Component />
        </GoogleReCaptchaProvider>
      </body>
    </>
  );
}
