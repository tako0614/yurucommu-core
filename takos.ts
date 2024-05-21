import { parse } from "$std/dotenv/parse.ts"
import { isWindows } from "https://deno.land/std@0.216.0/path/_os.ts"
import $ from "https://deno.land/x/dax@0.38.0/mod.ts";
const parsedArgs = Deno.args
const os = Deno.build.os

if(parsedArgs[0] == "install") {
  if(os == "windows") {
    
  }
}