import { Head } from "$fresh/runtime.ts"
import Header from "../components/Header.tsx"
export default function Error404() {
    return (
        <>
            <head>
                <title>404 Not Found</title>
                <link rel="stylesheet" href="/style.css"></link>
            </head>
            <Header></Header>
            <section class="pt-16 pb-10 bg-[#0D1117] h-screen">
                <h1 class="text-5xl text-center text-white pt-16">
                    404 Not Found
                </h1>
                <p class="text-xl text-center text-white">
                    このページはないんやで
                </p>
            </section>
            <footer>
                <p class="text-white text-center">
                    Copyright © 2021-2023 Takoserver All Rights Reserved.
                </p>
            </footer>
        </>
    )
}
