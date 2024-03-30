import { Handlers, PageProps } from "$fresh/server.ts";
import { getCookies } from "https://deno.land/std@0.220.1/http/cookie.ts";
import users from "../models/users.js";
import sessionID from "../models/sessionid.js";
export const handler = {
  GET(req: any, ctx: any) {
    if(ctx.state.data.loggedIn){
      return ctx.render({ loggedIn: true, userName: ctx.state.data.userName });
    } else {
      return ctx.render({ loggedIn: false });
    }
  },
};
export default function talk(props: PageProps) {
  const friendName = props.params.userName;
  const userName = props.data.userName;
  return (
    <>
      <div>{userName}</div>
      <div>{friendName}</div>
    </>
  );
}
