export function toast(message: string, type: "success" | "error" | "info" = "info") {
  if (type === "error") {
    console.error(message);
  } else {
    console.log(message);
  }
  if (typeof window !== "undefined") {
    window.alert(message);
  }
}

export async function confirm(message: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  return window.confirm(message);
}

