// Parse ISO 8601 duration (e.g., "PT5S", "PT1M30S", "PT1H2M30S" -> ms)
export function parseStoryDuration(duration: string): number {
  let totalMs = 0;

  const hoursMatch = duration.match(/(\d+)H/);
  const minutesMatch = duration.match(/(\d+)M/);
  const secondsMatch = duration.match(/(\d+)S/);

  if (hoursMatch) totalMs += parseInt(hoursMatch[1]) * 3600000;
  if (minutesMatch) totalMs += parseInt(minutesMatch[1]) * 60000;
  if (secondsMatch) totalMs += parseInt(secondsMatch[1]) * 1000;

  // Default 5 seconds, max 60 seconds
  return totalMs > 0 ? Math.min(totalMs, 60000) : 5000;
}
