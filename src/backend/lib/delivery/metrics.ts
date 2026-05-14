import { logger } from "../logger.ts";

type MetricPayload = {
  metric: string;
  value: number;
  at: string;
  tags?: Record<string, string | number | boolean | null | undefined>;
};

const log = logger.child({ component: "delivery.metrics" });

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
  log.info("metric", {
    event: "delivery.metric",
    type: "metric",
    ...payload,
  });
}
