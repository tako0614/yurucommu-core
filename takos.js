import { parse } from "https://deno.land/std@0.215.0/flags/mod.ts";
import { makeDB } from "./util/makedb.js";
//import { denoPlugins } from "$fresh/src/build/deps.ts";
const commands = Deno.args;
const ComanndsObj = parse(Deno.args);
const command = [];
commands.forEach((commands) => {
  const result = commands.indexOf("--");
  if (result == -1) {
    command.push(commands);
  } else {
    //
  }
});
switch (command[0]) {
  case "make":
    switch (command[1]) {
      case "dataabse":
        makeDB();
        break;

      default:
        break;
    }
    break;

  default:
    console.log("error");
    break;
}
