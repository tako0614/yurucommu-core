import { TextLineStream } from "jsr:@std/streams/text-line-stream";

export interface SpawnOptions {
  cwd: string;
  env?: Record<string, string>;
  prefix?: string;
}

export function spawnDeno(
  args: string[],
  { cwd, env = {}, prefix }: SpawnOptions,
): Deno.ChildProcess {
  const command = new Deno.Command("deno", {
    args,
    cwd,
    env,
    stdout: "piped",
    stderr: "piped",
  });
  const proc = command.spawn();
  const tag = prefix ?? (cwd.split("/").pop() || cwd);
  proc.stdout
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new TextLineStream())
    .pipeTo(new WritableStream({ write: (l) => console.log(`[${tag}] ${l}`) }))
    .catch(() => {});
  proc.stderr
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new TextLineStream())
    .pipeTo(
      new WritableStream({ write: (l) => console.error(`[${tag} ERROR] ${l}`) }),
    )
    .catch(() => {});
  return proc;
}

export async function waitAll(...procs: Deno.ChildProcess[]) {
  const results = await Promise.all(procs.map((p) => p.status));
  return results.every((r) => r.success);
}

