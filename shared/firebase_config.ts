export function parseFirebaseClientConfig(
  env: Record<string, string>,
): Record<string, string> | null {
  if (env["FIREBASE_CLIENT_CONFIG"]) {
    try {
      return JSON.parse(env["FIREBASE_CLIENT_CONFIG"]);
    } catch {
      return null;
    }
  }
  const keys = [
    "FIREBASE_API_KEY",
    "FIREBASE_AUTH_DOMAIN",
    "FIREBASE_PROJECT_ID",
    "FIREBASE_STORAGE_BUCKET",
    "FIREBASE_MESSAGING_SENDER_ID",
    "FIREBASE_APP_ID",
  ];
  if (keys.every((k) => env[k])) {
    return {
      apiKey: env["FIREBASE_API_KEY"],
      authDomain: env["FIREBASE_AUTH_DOMAIN"],
      projectId: env["FIREBASE_PROJECT_ID"],
      storageBucket: env["FIREBASE_STORAGE_BUCKET"],
      messagingSenderId: env["FIREBASE_MESSAGING_SENDER_ID"],
      appId: env["FIREBASE_APP_ID"],
    };
  }
  return null;
}
