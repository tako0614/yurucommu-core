import { Handlers, PageProps } from "$fresh/server.ts";
import { useState } from "preact/hooks";
import tempUsers from "../models/tempUsers.js";
import { MainAuthForm } from "../islands/mainAuthForm.jsx";
import { load } from "https://deno.land/std@0.204.0/dotenv/mod.ts";
const env = await load();
const key = env["rechapcha_site_key"];
export const handler = {
  async GET(req, ctx) {
    const url = new URL(req.url);
    const key = url.searchParams.get("key") || "";
    const user = await tempUsers.findOne({ key });
    let status;
    if ( user === null) {
      status = false
    } else {
      status = true
    }
    return ctx.render({ key, status: status });
  },
};
const url = `https://www.google.com/recaptcha/api.js?render=${key}`
export default function PostReceptionPage({ data }) {
  if (data.status) {
    return (<>
    <head>
    <script src={url}></script>
        <script src="./rechapcha.js"></script>
    </head>
    <div class="text-white">
      <MainAuthForm key={data.key} />
    </div>
      </>);
  }else {
    return <div class="text-white">error</div>
  }
}
