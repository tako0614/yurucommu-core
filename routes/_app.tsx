import { AppProps } from "$fresh/server.ts";
import react from "preact/compat"
export default function App({ Component }: AppProps) {
  return (
    <>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>takoserver project</title>
        <link rel="stylesheet" href="/style.css"></link>
      </head>
      <body  class="bg-[#0D1117]">
        <Component />
      </body>
      </>
  );
}
