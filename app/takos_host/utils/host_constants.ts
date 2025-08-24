// Centralized constants & helpers for takos host
export const FCM_KEYS = [
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "FIREBASE_API_KEY",
  "FIREBASE_AUTH_DOMAIN",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_STORAGE_BUCKET",
  "FIREBASE_MESSAGING_SENDER_ID",
  "FIREBASE_APP_ID",
  "FIREBASE_VAPID_KEY",
] as const;

export const FASP_PROVIDER_INFO_PATHS = [
  "/fasp/provider_info",
];

export const isTruthyFlag = (v: string | undefined) =>
  (v ?? "").toLowerCase() in {
    "1": true,
    "true": true,
    "yes": true,
  };
