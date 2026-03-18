import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { computeVideoSentraScore, safeNumber } from "@/lib/sentraScore";

function formatPublishedAt(value: string | null) {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function stanceBadgeColor(stance: string) {
  if (stance === "bullish") return "#14532d";
  if (stance === "bearish") return "#7f1d1d";
  return "#1f2937";
}

export default async function DriverPage({ params }: any) {
  const resolvedParams = await Promise.resolve(params);
  const symbol = String(resolvedParams?.ticker || "").toUpperCase();
  const videoId = String(resolvedParams?.videoId || "");

  const supabase = supabaseServer();

  const { data, error } = await supabase
    .from("video_positions")
    .select(`
      ticker,
      stance,
      confidence,
      video_published_at,
      videos (
        title,
        youtube_video_id,
        view_count,
        like_count,
        comment_count,
        published_at,
        video_published_at,
        creators (
          name
        )
      )
    `)
    .eq("ticker", symbol)
    .limit(200);

  if (error) {
    return (
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 24px" }}>
        <div style={{ color: "#ff6b6b" }}>
          Failed to load driver: {error.message}
        </div>
      </div>
    );
  }

  const rows = ((data ?? []) as any[]).filter(
    (row) => row?.videos?.youtube_video_id === videoId
  );

  const row = rows[0];

  if (!row) {
    return (
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 24px" }}>
        <Link
          href={`/t/${symbol}`}
          style={{ color: "#93c5fd", textDecoration: "none" }}
        >
          ← Back to {symbol}
        </Link>
        <div style={{ marginTop: 20 }}>Video not found for this ticker.</div>
      </div>
    );
  }

  const video = row.videos;
  const publishedAt =
    video?.video_published_at ??
    video?.published_at ??
    row?.video_published_at ??
    null;

  const scoreData = computeVideoSentraScore({
    view_count: video?.view_count,
    like_count: video?.like_count,
    comment_count: video?.comment_count,
    video_published_at: publishedAt,
    stance: row.stance,
    confidence: row.confidence,
  });

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 24px" }}>
      <Link
        href={`/t/${symbol}`}
        style={{ color: "#93c5fd", textDecoration: "none", fontSize: 14 }}
      >
        ← Back to {symbol}
      </Link>

      <div style={{ marginTop: 20, marginBottom: 24 }}>
        <div
          style={{
            fontSize: 12,
            color: "#9ca3af",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: 8,
          }}
        >
          Evidence Driver
        </div>

        <h1 style={{ fontSize: 34, lineHeight: 1.25, marginBottom: 12 }}>
          {video?.title ?? "Untitled video"}
        </h1>

        <div style={{ color: "#9ca3af", fontSize: 15 }}>
          {video?.creators?.name ?? "Unknown creator"} ·{" "}
          {formatPublishedAt(publishedAt)}
        </div>
      </div>

      <div
        style={{
          border: "1px solid #1f2937",
          borderRadius: 20,
          overflow: "hidden",
          marginBottom: 24,
          background: "#0b0b0c",
        }}
      >
        <iframe
          width="100%"
          height="520"
          src={`https://www.youtube.com/embed/${videoId}`}
          title={video?.title ?? "YouTube video"}
          style={{ border: 0 }}
          allowFullScreen
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(180px, 1fr))",
          gap: 16,
          marginBottom: 28,
        }}
      >
        <div
          style={{
            border: "1px solid #1f2937",
            borderRadius: 16,
            padding: 16,
            background: "#0b0b0c",
          }}
        >
          <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 6 }}>
            Sentra Contribution
          </div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>
            {scoreData.videoSentraScore.toLocaleString(undefined, {
              maximumFractionDigits: 2,
            })}
          </div>
        </div>

        <div
          style={{
            border: "1px solid #1f2937",
            borderRadius: 16,
            padding: 16,
            background: "#0b0b0c",
          }}
        >
          <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 6 }}>
            Views
          </div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>
            {safeNumber(video?.view_count).toLocaleString()}
          </div>
        </div>

        <div
          style={{
            border: "1px solid #1f2937",
            borderRadius: 16,
            padding: 16,
            background: "#0b0b0c",
          }}
        >
          <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 6 }}>
            Likes / Comments
          </div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>
            {safeNumber(video?.like_count).toLocaleString()} /{" "}
            {safeNumber(video?.comment_count).toLocaleString()}
          </div>
        </div>

        <div
          style={{
            border: "1px solid #1f2937",
            borderRadius: 16,
            padding: 16,
            background: "#0b0b0c",
          }}
        >
          <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 6 }}>
            Stance / Confidence
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                background: stanceBadgeColor(row?.stance ?? "neutral"),
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 999,
                padding: "6px 10px",
                fontSize: 12,
                textTransform: "capitalize",
              }}
            >
              {row?.stance ?? "neutral"}
            </span>
            <span style={{ fontSize: 16, fontWeight: 700 }}>
              {scoreData.confidence.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.2fr) minmax(320px, 0.8fr)",
          gap: 20,
          marginBottom: 24,
        }}
      >
        <div
          style={{
            border: "1px solid #1f2937",
            borderRadius: 20,
            background: "#0b0b0c",
            padding: 20,
          }}
        >
          <div
            style={{
              fontSize: 12,
              color: "#9ca3af",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 10,
            }}
          >
            Why it mattered
          </div>

          <div style={{ color: "#d1d5db", lineHeight: 1.7, fontSize: 15 }}>
            This video contributed to {symbol}'s Sentra Score because it passed
            the ticker-specific evidence rules, generated measurable engagement,
            and carried a {row?.stance ?? "neutral"} stance with{" "}
            {scoreData.confidence.toFixed(2)} confidence. Its final contribution
            came from the combination of reach, engagement quality, recency, and
            tone.
          </div>
        </div>

        <div
          style={{
            border: "1px solid #1f2937",
            borderRadius: 20,
            background: "#0b0b0c",
            padding: 20,
          }}
        >
          <div
            style={{
              fontSize: 12,
              color: "#9ca3af",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 12,
            }}
          >
            Signal Breakdown
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>
                Base Reach
              </div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>
                {scoreData.baseReach.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>
                Engagement Multiplier
              </div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>
                {scoreData.engagementMultiplier.toFixed(2)}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>
                Recency Weight
              </div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>
                {scoreData.recencyWeight.toFixed(2)}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>
                Tone Multiplier
              </div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>
                {scoreData.toneMultiplier.toFixed(2)}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <a
          href={`https://www.youtube.com/watch?v=${videoId}`}
          target="_blank"
          rel="noreferrer"
          style={{
            display: "inline-block",
            border: "1px solid #1f2937",
            borderRadius: 12,
            padding: "12px 16px",
            background: "#11141b",
            color: "#93c5fd",
            textDecoration: "none",
          }}
        >
          Watch on YouTube →
        </a>

        <Link
          href={`/t/${symbol}`}
          style={{
            display: "inline-block",
            border: "1px solid #1f2937",
            borderRadius: 12,
            padding: "12px 16px",
            background: "#11141b",
            color: "#e5e7eb",
            textDecoration: "none",
          }}
        >
          Back to ticker →
        </Link>
      </div>
    </div>
  );
}