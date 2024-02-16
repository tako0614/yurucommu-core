import { AppProps } from "$fresh/server.ts";

export default function App({ Component }: AppProps) {
  return (
    <>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>takoserver project</title>
        <link rel="stylesheet" href="/style.css"></link>
      </head>
      <body class="bg-[#0D1117] overflow-hidden">
        <Component />
      </body>
      </>
  );
}
