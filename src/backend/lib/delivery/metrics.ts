type MetricPayload = {
  metric: string;
  value: number;
  at: string;
  tags?: Record<string, string | number | boolean | null | undefined>;
};

export function emitMetric(
  metric: string,
  value: number,
  tags?: MetricPayload["tags"],
): void {
  const payload: MetricPayload = {
    metric,
    value,
    at: new Date().toISOString(),
    tags,
  };
  // Logs are the portable, zero-dependency metrics channel across Workers + local runtimes.
  // Downstream (Cloudflare / log shipper) can derive p50/p95/p99 and rates from these points.
  console.log(JSON.stringify({ type: "metric", ...payload }));
}
