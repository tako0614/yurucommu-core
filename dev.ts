import { TextLineStream } from "@std/streams/text-line-stream";

const targetDirectories = [
    "app/api",
    "app/client",
];

async function runDevCommandInDir(dir: string): Promise<Deno.CommandStatus> {
    console.log(`[INFO] Starting 'deno task dev' in ./${dir}`);
    try {
        const command = new Deno.Command("deno", {
            args: ["task", "dev"],
            cwd: `./${dir}`, // Ensure it's treated as a relative path from current script's CWD
            stdout: "piped",
            stderr: "piped",
        });

        const process = command.spawn();

        // Pipe stdout
        process.stdout
            .pipeThrough(new TextDecoderStream())
            .pipeThrough(new TextLineStream())
            .pipeTo(
                new WritableStream({
                    write(line: string) {
                        console.log(`[${dir}] ${line}`);
                    },
                })
            ).catch(error => {
                console.error(`[${dir} STDOUT_PIPE_ERROR] ${error.message}`);
            });

        // Pipe stderr
        process.stderr
            .pipeThrough(new TextDecoderStream())
            .pipeThrough(new TextLineStream())
            .pipeTo(
                new WritableStream({
                    write(line: string) {
                        console.error(`[${dir} ERROR] ${line}`);
                    },
                })
            ).catch(error => {
                console.error(`[${dir} STDERR_PIPE_ERROR] ${error.message}`);
            });

        const status = await process.status;
        if (status.success) {
            console.log(`[INFO] 'deno task dev' in ./${dir} finished successfully.`);
        } else {
            console.error(`[INFO] 'deno task dev' in ./${dir} exited with code ${status.code}.`);
        }
        return status;

    } catch (error) {
        if (error instanceof Error) {
            console.error(`[INFO] Failed to start 'deno task dev' in ./${dir}: ${error.message}`);
        } else {
            console.error(`[INFO] Failed to start 'deno task dev' in ./${dir}: ${String(error)}`);
        }
        // Re-throw or return a custom error status if needed for Promise.all handling
        throw error; 
    }
}

async function main() {
    const processPromises: Promise<Deno.CommandStatus>[] = [];

    for (const dir of targetDirectories) {
        processPromises.push(runDevCommandInDir(dir));
    }

    try {
        const results = await Promise.all(processPromises);
        console.log("[INFO] All 'deno task dev' processes have completed.");
        results.forEach((status, index) => {
            if (!status.success) {
                console.warn(`[INFO] Process for ./${targetDirectories[index]} exited with error code: ${status.code}`);
            }
        });
    } catch (error) {
        if (error instanceof Error) {
            console.error("[INFO] An error occurred while managing dev tasks:", error.message);
        } else {
            console.error("[INFO] An error occurred while managing dev tasks:", String(error));
        }
        // This block is reached if any `runDevCommandInDir` throws an unhandled error (e.g., command not found, cwd invalid before spawn)
        // Child processes that were successfully spawned might still be running.
        // Deno's default behavior on script termination (e.g. due to unhandled rejection)
        // should typically terminate spawned child processes.
    }
}

if (import.meta.main) {
    main();
}