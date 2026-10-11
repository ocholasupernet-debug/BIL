import { useMemo } from "react";

export type UsageSample = {
  router_id: number;
  sampled_at: string;
  upload_bytes: number;
  download_bytes: number;
};

type Bucket = { label: string; upload: number; download: number };
const DAY = 24 * 60 * 60 * 1000;

function observedDeltas(samples: UsageSample[]) {
  const sorted = [...samples].sort((a, b) =>
    a.router_id - b.router_id || Date.parse(a.sampled_at) - Date.parse(b.sampled_at),
  );
  const previous = new Map<number, UsageSample>();
  return sorted.flatMap((sample) => {
    const at = Date.parse(sample.sampled_at);
    if (!Number.isFinite(at)) return [];
    const prior = previous.get(sample.router_id);
    previous.set(sample.router_id, sample);
    if (!prior) return [];
    const up = Math.max(0, Number(sample.upload_bytes) || 0);
    const down = Math.max(0, Number(sample.download_bytes) || 0);
    const priorUp = Math.max(0, Number(prior.upload_bytes) || 0);
    const priorDown = Math.max(0, Number(prior.download_bytes) || 0);
    // Session counters can fall when sessions end or RouterOS resets a counter.
    // Count only positive observed increases; this intentionally avoids inventing
    // negative usage, but means sessions that end between samples can be missed.
    return [{
      at,
      upload: up >= priorUp ? up - priorUp : 0,
      download: down >= priorDown ? down - priorDown : 0,
    }];
  });
}

function formatBytes(bytes: number) {
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

function makeBuckets(deltas: ReturnType<typeof observedDeltas>, period: "day" | "week" | "month"): Bucket[] {
  const now = new Date();
  if (period === "day") {
    return Array.from({ length: 24 }, (_, index) => {
      const end = new Date(now);
      end.setMinutes(0, 0, 0);
      end.setHours(end.getHours() - (23 - index));
      const start = end.getTime();
      const finish = start + 60 * 60 * 1000;
      const values = deltas.filter((delta) => delta.at >= start && delta.at < finish);
      return { label: end.toLocaleTimeString([], { hour: "numeric" }), upload: values.reduce((s, v) => s + v.upload, 0), download: values.reduce((s, v) => s + v.download, 0) };
    });
  }
  const days = period === "week" ? 7 : 30;
  const bucketCount = period === "week" ? 7 : 10;
  return Array.from({ length: bucketCount }, (_, index) => {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (days - (index + 1) * (period === "week" ? 1 : 3)));
    const start = date.getTime();
    const finish = start + DAY * (period === "week" ? 1 : 3);
    const values = deltas.filter((delta) => delta.at >= start && delta.at < finish);
    return {
      label: period === "week" ? date.toLocaleDateString([], { weekday: "short" }) : date.toLocaleDateString([], { day: "numeric", month: "short" }),
      upload: values.reduce((s, v) => s + v.upload, 0),
      download: values.reduce((s, v) => s + v.download, 0),
    };
  });
}

function UsageCard({ title, period, samples }: { title: string; period: "day" | "week" | "month"; samples: UsageSample[] }) {
  const deltas = useMemo(() => observedDeltas(samples), [samples]);
  const buckets = useMemo(() => makeBuckets(deltas, period), [deltas, period]);
  const upload = buckets.reduce((sum, item) => sum + item.upload, 0);
  const download = buckets.reduce((sum, item) => sum + item.download, 0);
  const max = Math.max(1, ...buckets.map((item) => Math.max(item.upload, item.download)));
  const hasInterval = deltas.some((item) => item.upload > 0 || item.download > 0);

  return (
    <article className="usage-insight-card">
      <header>
        <div><h3>{title}</h3><p>Observed active-session traffic</p></div>
        <span className="usage-insight-total">{formatBytes(upload + download)}</span>
      </header>
      <div className="usage-insight-legend"><span><i className="usage-insight-swatch usage-insight-swatch--up" />Upload {formatBytes(upload)}</span><span><i className="usage-insight-swatch usage-insight-swatch--down" />Download {formatBytes(download)}</span></div>
      {hasInterval ? (
        <div className={`usage-insight-bars usage-insight-bars--${period}`} role="img" aria-label={`${title}: upload ${formatBytes(upload)}, download ${formatBytes(download)}`}>
          {buckets.map((bucket, index) => (
            <div className="usage-insight-bar-group" key={`${bucket.label}-${index}`} title={`${bucket.label}: upload ${formatBytes(bucket.upload)}, download ${formatBytes(bucket.download)}`}>
              <div className="usage-insight-bar-pair">
                <i className="usage-insight-bar usage-insight-bar--up" style={{ height: `${Math.max(bucket.upload ? 4 : 0, bucket.upload / max * 72)}px` }} />
                <i className="usage-insight-bar usage-insight-bar--down" style={{ height: `${Math.max(bucket.download ? 4 : 0, bucket.download / max * 72)}px` }} />
              </div>
              {(period === "week" || period === "month" || index % 6 === 0) && <span>{bucket.label}</span>}
            </div>
          ))}
        </div>
      ) : (
        <div className="usage-insight-empty">Usage history is starting. The chart fills as existing live-session checks collect samples.</div>
      )}
    </article>
  );
}

export function DataUsageInsights({ samples = [] }: { samples?: UsageSample[] }) {
  return (
    <section className="usage-insights" aria-label="Network data usage">
      <div className="usage-insights-heading">
        <div><span>NETWORK USAGE</span><h2>Data usage</h2></div>
        <p>Upload and download changes observed during existing router checks. Collection starts now; this is not a full interface counter.</p>
      </div>
      <div className="usage-insights-grid">
        <UsageCard title="Last 24 hours" period="day" samples={samples} />
        <UsageCard title="Last 7 days" period="week" samples={samples} />
        <UsageCard title="Last 30 days" period="month" samples={samples} />
      </div>
      <p className="usage-insights-note">Only positive changes between hourly samples are counted. Traffic from sessions that end between checks may be missed.</p>
    </section>
  );
}
