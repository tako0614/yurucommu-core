import { AppProps } from "$fresh/server.ts"
import { load } from "$std/dotenv/mod.ts"
const env = await load()
import { createContext } from "preact/compat"
export const Context = createContext(env)
export default function App({ Component }: AppProps) {
    return (
        <>
            <head>
                <meta charset="utf-8" />
                <meta
                    name="viewport"
                    content="width=device-width, initial-scale=1.0"
                />
            </head>
            <body>
                <Component />
            </body>
        </>
    )
}
