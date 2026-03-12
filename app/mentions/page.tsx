// app/dashboard/page.tsx
import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server"; // <- if this path is wrong, copy the import you used in /mentions

type CreatorRow = {
  creator_id: number;
  name: string | null;
  youtube_channel_id: string | null;
  comment_count: number;
  avg_sentiment: number | null;
  last_comment_at: string | null;
};

type RecentMention = {
  id: number;
  created_at: string;
  sentiment_score: number | null;
  sentiment_label: string | null;
  author_name: string | null;
  context_text: string | null;
  creators?: { id: number; name: string | null } | null;
  videos?: { id: number; title: string | null; youtube_video_id: string | null } | null;
};

type Creator24hAgg = {
  creator_id: number;
  name: string;
  comment_count_24h: number;
  avg_sentiment_24h: number | null;
  velocity_per_hour: number;
};

export default async function DashboardPage() {
  const supabase = supabaseServer();

  // =========
  // 24h metrics
  // =========
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: mentions24h, error: mentions24hErr } = await supabase
    .from("mentions")
    .select(
      `
      creator_id,
      sentiment_score,
      created_at,
      creators:creator_id ( id, name )
    `
    )
    .gte("youtube_published_at", since24h)


  const byCreator24h = new Map<number, Creator24hAgg>();

  if (!mentions24hErr && mentions24h) {
    for (const r of mentions24h as any[]) {
      const cid = r.creator_id as number;
      const name = r.creators?.name ?? `creator_id=${cid}`;
      const s = r.sentiment_score as number | null;

      if (!byCreator24h.has(cid)) {
        byCreator24h.set(cid, {
          creator_id: cid,
          name,
          comment_count_24h: 0,
          avg_sentiment_24h: null,
          velocity_per_hour: 0,
        });
      }

      const row = byCreator24h.get(cid)!;
      row.comment_count_24h += 1;

      if (typeof s === "number") {
        const prevCount = (row as any)._scoredCount ?? 0;
        const prevAvg = row.avg_sentiment_24h ?? 0;
        const newCount = prevCount + 1;
        row.avg_sentiment_24h = (prevAvg * prevCount + s) / newCount;
        (row as any)._scoredCount = newCount;
      }
    }
  }

  const creators24h = Array.from(byCreator24h.values()).map((r) => {
    r.velocity_per_hour = r.comment_count_24h / 24;
    delete (r as any)._scoredCount;
    return r;
  });

  // =========
  // Total creator leaderboard (all-time)
  // =========
  const { data: creatorRows, error: creatorErr } = await supabase
    .from("mentions")
    .select(
      `
      creator_id,
      creators:creator_id ( id, name, youtube_channel_id ),
      sentiment_score,
      created_at
    `
    );

  const byCreator = new Map<number, CreatorRow>();

  if (!creatorErr && creatorRows) {
    for (const r of creatorRows as any[]) {
      const cid = r.creator_id as number;
      const creator = r.creators ?? null;

      if (!byCreator.has(cid)) {
        byCreator.set(cid, {
          creator_id: cid,
          name: creator?.name ?? null,
          youtube_channel_id: creator?.youtube_channel_id ?? null,
          comment_count: 0,
          avg_sentiment: null,
          last_comment_at: null,
        });
      }

      const row = byCreator.get(cid)!;
      row.comment_count += 1;

      const s = r.sentiment_score as number | null;
      if (typeof s === "number") {
        const prevCount = row.avg_sentiment === null ? 0 : (row as any)._scoredCount ?? 0;
        const prevAvg = row.avg_sentiment ?? 0;
        const newCount = prevCount + 1;
        const newAvg = (prevAvg * prevCount + s) / newCount;
        row.avg_sentiment = newAvg;
        (row as any)._scoredCount = newCount;
      }

      const createdAt = r.created_at as string | null;
      if (createdAt) {
        if (!row.last_comment_at || new Date(createdAt) > new Date(row.last_comment_at)) {
          row.last_comment_at = createdAt;
        }
      }
    }
  }

  const creators = Array.from(byCreator.values())
    .map((r) => {
      delete (r as any)._scoredCount;
      return r;
    })
    .sort((a, b) => b.comment_count - a.comment_count)
    .slice(0, 10);

  // =========
  // Recent mentions
  // =========
  const { data: recentMentions, error: recentErr } = await supabase
    .from("mentions")
    .select(
      `
      id,
      created_at,
      sentiment_score,
      sentiment_label,
      author_name,
      context_text,
      creators:creator_id ( id, name ),
      videos:video_id ( id, title, youtube_video_id )
    `
    )
    .order("id", { ascending: false })
    .limit(25);

  return (
    <div style={{ padding: 16, fontFamily: "system-ui" }}>
      <h1>Dashboard</h1>

      <div style={{ margin: "12px 0" }}>
        <Link href="/creators">Creators</Link> {" | "}
        <Link href="/videos">Videos</Link> {" | "}
        <Link href="/mentions">Mentions</Link>
      </div>

      <h2 style={{ marginTop: 20 }}>Top creators (by comment volume)</h2>

      {creatorErr ? (
        <pre>{JSON.stringify(creatorErr, null, 2)}</pre>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", borderBottom: "1px solid #333", padding: 8 }}>
                Creator
              </th>
              <th style={{ textAlign: "right", borderBottom: "1px solid #333", padding: 8 }}>
                Comments
              </th>
              <th style={{ textAlign: "right", borderBottom: "1px solid #333", padding: 8 }}>
                Avg sentiment
              </th>
              <th style={{ textAlign: "right", borderBottom: "1px solid #333", padding: 8 }}>
                Comments (24h)
              </th>
              <th style={{ textAlign: "right", borderBottom: "1px solid #333", padding: 8 }}>
                Avg sentiment (24h)
              </th>
              <th style={{ textAlign: "right", borderBottom: "1px solid #333", padding: 8 }}>
                Velocity / hr
              </th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #333", padding: 8 }}>
                Last comment
              </th>
            </tr>
          </thead>
          <tbody>
            {creators.map((c) => {
              const m24 = creators24h.find((x) => x.creator_id === c.creator_id);

              return (
                <tr key={c.creator_id}>
                  <td style={{ borderBottom: "1px solid #222", padding: 8 }}>
                    {c.name ?? `creator_id=${c.creator_id}`}
                  </td>

                  <td style={{ borderBottom: "1px solid #222", padding: 8, textAlign: "right" }}>
                    {c.comment_count}
                  </td>

                  <td style={{ borderBottom: "1px solid #222", padding: 8, textAlign: "right" }}>
                    {c.avg_sentiment === null ? "—" : c.avg_sentiment.toFixed(3)}
                  </td>

                  <td style={{ borderBottom: "1px solid #222", padding: 8, textAlign: "right" }}>
                    {m24 ? m24.comment_count_24h : 0}
                  </td>

                  <td style={{ borderBottom: "1px solid #222", padding: 8, textAlign: "right" }}>
                    {m24 && m24.avg_sentiment_24h !== null ? m24.avg_sentiment_24h.toFixed(3) : "—"}
                  </td>

                  <td style={{ borderBottom: "1px solid #222", padding: 8, textAlign: "right" }}>
                    {m24 ? m24.velocity_per_hour.toFixed(2) : "0.00"}
                  </td>

                  <td style={{ borderBottom: "1px solid #222", padding: 8 }}>
                    {c.last_comment_at ? new Date(c.last_comment_at).toLocaleString() : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {mentions24hErr ? (
        <pre style={{ marginTop: 10 }}>{JSON.stringify(mentions24hErr, null, 2)}</pre>
      ) : null}

      <h2 style={{ marginTop: 28 }}>Recent mentions</h2>

      {recentErr ? (
        <pre>{JSON.stringify(recentErr, null, 2)}</pre>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", borderBottom: "1px solid #333", padding: 8 }}>
                Creator / Video
              </th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #333", padding: 8 }}>
                Author
              </th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #333", padding: 8 }}>
                Sentiment
              </th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #333", padding: 8 }}>
                Comment
              </th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #333", padding: 8 }}>
                Time
              </th>
            </tr>
          </thead>
          <tbody>
            {(recentMentions as unknown as RecentMention[] | null)?.map((m) => (
              <tr key={m.id}>
                <td style={{ borderBottom: "1px solid #222", padding: 8, minWidth: 260 }}>
                  <div>{m.creators?.name ?? "—"}</div>
                  <div style={{ opacity: 0.75, fontSize: 12 }}>
                    {m.videos?.title ?? "—"}
                  </div>
                </td>

                <td style={{ borderBottom: "1px solid #222", padding: 8 }}>
                  {m.author_name ?? "—"}
                </td>

                <td style={{ borderBottom: "1px solid #222", padding: 8 }}>
                  <div>{m.sentiment_label ?? "—"}</div>
                  <div style={{ opacity: 0.75, fontSize: 12 }}>
                    {typeof m.sentiment_score === "number" ? m.sentiment_score.toFixed(2) : "—"}
                  </div>
                </td>

                <td style={{ borderBottom: "1px solid #222", padding: 8, maxWidth: 700 }}>
                  <div style={{ whiteSpace: "pre-wrap" }}>{m.context_text ?? "—"}</div>
                </td>

                <td style={{ borderBottom: "1px solid #222", padding: 8 }}>
                  {m.created_at ? new Date(m.created_at).toLocaleString() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
