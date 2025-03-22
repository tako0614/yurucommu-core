// Import the MinIO client from npm and dotenv for environment variables
import * as Minio from "npm:minio";
import { load } from "@std/dotenv";
import { Buffer } from "node:buffer";

// Load environment variables from .env file
const env = await load();

console.log(
    env["MINIO_ENDPOINT"],
    env["AWS_ACCESS_KEY_ID"],
    env["AWS_SECRET_ACCESS_KEY"],
    env["BUCKET_NAME"],
);

// Initialize the MinIO client with your configuration
const minioClient = new Minio.Client({
    endPoint: env["MINIO_ENDPOINT"], // e.g., "localhost" or your MinIO server address
    port: 9000, // Default MinIO port; adjust if different
    useSSL: false, // Set to true if using HTTPS
    accessKey: env["AWS_ACCESS_KEY_ID"],
    secretKey: env["AWS_SECRET_ACCESS_KEY"],
});

/**
 * Uploads a file to MinIO
 * @param key - The object key (file name) in the bucket
 * @param fileContent - The content to upload as a string
 */
async function uploadFile(key: string, fileContent: string) {
    try {
        await minioClient.putObject(env["BUCKET_NAME"], key, fileContent);
    } catch (err) {
        console.error(`アップロードエラー: ${err}`);
    }
}

/**
 * Downloads a file from MinIO and returns its content as a string
 * @param key - The object key (file name) in the bucket
 * @returns The file content as a string
 */
async function downloadFile(key: string): Promise<string> {
    return new Promise((resolve, reject) => {
        minioClient.getObject(
            env["BUCKET_NAME"] as string,
            key,
            (err: Error | null, dataStream: any) => {
                if (err) {
                    reject(err);
                    return;
                }
                let data = "";
                dataStream.on("data", (chunk: Buffer) => {
                    data += chunk.toString();
                });
                dataStream.on("end", () => {
                    resolve(data);
                });
                dataStream.on("error", (streamErr: Error) => {
                    reject(streamErr);
                });
            },
        );
    });
}

// Export the functions for use in other modules
export { downloadFile, uploadFile };
