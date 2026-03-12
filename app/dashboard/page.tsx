import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";

function fmt(n: any) {
  if (n === null || n === undefined) return "—";
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  return num.toLocaleString();
}

function fmt2(n: any) {
  if (n === null || n === undefined) return "—";
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  return num.toFixed(2);
}

export default async function DashboardPage() {
  const supabase = supabaseServer();

  const { data: rows, error } = await supabase
    .from("ticker_leaderboard")
    .select("*")
    .order("accel_24h_vs_7d", { ascending: false })
    .limit(25);

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Attention Engine</h1>
            <p className="text-sm text-white/60">
              Market attention & sentiment from YouTube discussion.
            </p>
          </div>

          <form
            action="/t"
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2"
          >
            <input
              name="q"
              placeholder="Search ticker (TSLA, NVDA...)"
              className="w-56 bg-transparent text-sm outline-none placeholder:text-white/40"
            />
            <button className="rounded-lg bg-white/10 px-3 py-1 text-sm hover:bg-white/15">
              Search
            </button>
          </form>
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">Top tickers</h2>
            <span className="text-xs text-white/50">
              Sorted by acceleration (24h vs 7d baseline)
            </span>
          </div>

          {error ? (
            <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm">
              Error loading leaderboard: {error.message}
            </div>
          ) : rows && rows.length > 0 ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-white/60">
                  <tr className="border-b border-white/10">
                    <th className="py-2 text-left">Ticker</th>
                    <th className="py-2 text-right">Accel</th>
                    <th className="py-2 text-right">Comments 24h</th>
                    <th className="py-2 text-right">Comments 7d</th>
                    <th className="py-2 text-right">Comments 6h</th>
                    <th className="py-2 text-right">Videos 7d</th>
                    <th className="py-2 text-right">Sentiment 7d</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: any) => (
                    <tr key={r.ticker} className="border-b border-white/5">
                      <td className="py-2">
                        <Link
                          href={`/t/${encodeURIComponent(r.ticker)}`}
                          className="font-medium hover:underline"
                        >
                          {r.ticker}
                        </Link>
                      </td>
                      <td className="py-2 text-right">{fmt2(r.accel_24h_vs_7d)}</td>
                      <td className="py-2 text-right">{fmt(r.comments_24h)}</td>
                      <td className="py-2 text-right">{fmt(r.comments_7d)}</td>
                      <td className="py-2 text-right">{fmt(r.comments_6h)}</td>
                      <td className="py-2 text-right">{fmt(r.videos_7d)}</td>
                      <td className="py-2 text-right">{fmt2(r.avg_sentiment_7d)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-4 text-sm text-white/60">
              No data yet. Ingest more videos + comments and refresh.
            </p>
          )}
        </div>

        <div className="mt-6 text-xs text-white/40">
          Tip: If a ticker is missing, it usually means we haven’t ingested comments for videos that mention it yet.
        </div>
      </div>
    </main>
  );
}