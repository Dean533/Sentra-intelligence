import { supabaseServer } from "@/lib/supabase/server";
import { computeVideoSentraScore, safeNumber } from "@/lib/sentraScore";
import TickerMarketSection from "@/app/components/TickerMarketSection";

function hasUsableVideo(video: any, row: any) {
  const publishedAt =
    video?.video_published_at ??
    video?.published_at ??
    row?.video_published_at ??
    null;

  return video && video.view_count !== null && publishedAt !== null;
}

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

function getSentraInterpretation(input: {
  sentraScore: number;
  sentiment: number;
  mentions: number;
  bullishMentions: number;
  bearishMentions: number;
}) {
  const { sentraScore, sentiment, mentions, bullishMentions, bearishMentions } =
    input;

  let outlook = "Watch";
  if (sentiment >= 0.35 && mentions >= 20) outlook = "Strong Buy";
  else if (sentiment >= 0.15 && mentions >= 10) outlook = "Buy";
  else if (sentiment <= -0.35 && bearishMentions >= bullishMentions)
    outlook = "Strong Sell";
  else if (sentiment <= -0.15 && bearishMentions >= bullishMentions)
    outlook = "Sell";

  let confidence = "Low";
  if (mentions >= 20 && Math.abs(sentiment) >= 0.25) confidence = "High";
  else if (mentions >= 10 && Math.abs(sentiment) >= 0.12) confidence = "Medium";

  let horizon = "Medium-term";
  if (mentions >= 20) horizon = "Short-term";
  if (mentions < 8) horizon = "Watchlist";

  let narrativePressure = "Moderate";
  if (sentraScore >= 35000) narrativePressure = "Very High";
  else if (sentraScore >= 18000) narrativePressure = "High";
  else if (sentraScore >= 8000) narrativePressure = "Building";

  let summary =
    "Narrative activity is present, but the signal still needs confirmation from broader trend and price follow-through.";

  if (outlook === "Strong Buy") {
    summary =
      "Narrative momentum is strong, coverage is broad, and bullish conviction is clearly outweighing bearish pressure.";
  } else if (outlook === "Buy") {
    summary =
      "The signal is constructive. Sentiment is positive and attention is strong enough to support a bullish near-term read.";
  } else if (outlook === "Strong Sell") {
    summary =
      "Negative pressure is dominating the conversation and the signal is pointing toward a clear risk-off setup.";
  } else if (outlook === "Sell") {
    summary =
      "Tone is leaning bearish and the signal suggests caution until narrative pressure improves.";
  }

  return {
    outlook,
    confidence,
    horizon,
    narrativePressure,
    summary,
  };
}

function stanceBadgeColor(stance: string) {
  if (stance === "bullish") return "#14532d";
  if (stance === "bearish") return "#7f1d1d";
  return "#1f2937";
}

export default async function Page({ params }: any) {
  const resolvedParams = await Promise.resolve(params);
  const ticker = resolvedParams?.ticker;
  const symbol = String(ticker || "").toUpperCase();

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
    .limit(100);

  if (error) {
    return (
      <div style={{ padding: "40px" }}>
        <h1 style={{ fontSize: "28px", marginBottom: "20px" }}>
          {symbol} Sentra Signal
        </h1>
        <div style={{ color: "#ff6b6b" }}>
          Failed to load ticker data: {error.message}
        </div>
      </div>
    );
  }

  const rows = (data ?? []) as any[];
  const usableRows = rows.filter((row) => hasUsableVideo(row.videos, row));

  let mentions = 0;
  let bullishMentions = 0;
  let bearishMentions = 0;
  let neutralMentions = 0;
  let sentimentSum = 0;
  let sentraScore = 0;

  const drivers = usableRows.map((row) => {
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

    mentions += 1;
    sentimentSum += scoreData.stanceValue * scoreData.confidence;
    sentraScore += scoreData.videoSentraScore;

    if (scoreData.stanceValue > 0) bullishMentions += 1;
    else if (scoreData.stanceValue < 0) bearishMentions += 1;
    else neutralMentions += 1;

    return {
      title: video?.title ?? "Untitled video",
      youtubeVideoId: video?.youtube_video_id ?? "",
      creatorName: video?.creators?.name ?? "Unknown creator",
      viewCount: safeNumber(video?.view_count),
      likeCount: safeNumber(video?.like_count),
      commentCount: safeNumber(video?.comment_count),
      stance: row.stance ?? "neutral",
      confidence: scoreData.confidence,
      publishedAt,
      videoSentraScore: scoreData.videoSentraScore,
    };
  });

  const sentiment = mentions > 0 ? sentimentSum / mentions : 0;

  const sortedDrivers = drivers.sort(
    (a, b) => b.videoSentraScore - a.videoSentraScore
  );

  const interpretation = getSentraInterpretation({
    sentraScore,
    sentiment,
    mentions,
    bullishMentions,
    bearishMentions,
  });

  return (
    <div style={{ padding: "40px" }}>
      <h1 style={{ fontSize: "28px", marginBottom: "20px" }}>
        {symbol} Sentra Signal
      </h1>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(180px, 1fr))",
          gap: "16px",
          marginBottom: "28px",
        }}
      >
        <div
          style={{
            border: "1px solid #222",
            borderRadius: "14px",
            padding: "16px",
            background: "#0b0b0c",
          }}
        >
          <div style={{ fontSize: "12px", opacity: 0.7, marginBottom: "8px" }}>
            SENTRA SCORE
          </div>
          <div style={{ fontSize: "20px", fontWeight: 700 }}>
            {sentraScore.toLocaleString(undefined, {
              maximumFractionDigits: 3,
            })}
          </div>
        </div>

        <div
          style={{
            border: "1px solid #222",
            borderRadius: "14px",
            padding: "16px",
            background: "#0b0b0c",
          }}
        >
          <div style={{ fontSize: "12px", opacity: 0.7, marginBottom: "8px" }}>
            MENTIONS
          </div>
          <div style={{ fontSize: "20px", fontWeight: 700 }}>{mentions}</div>
        </div>

        <div
          style={{
            border: "1px solid #222",
            borderRadius: "14px",
            padding: "16px",
            background: "#0b0b0c",
          }}
        >
          <div style={{ fontSize: "12px", opacity: 0.7, marginBottom: "8px" }}>
            SENTIMENT
          </div>
          <div style={{ fontSize: "20px", fontWeight: 700 }}>
            {sentiment.toFixed(2)}
          </div>
        </div>

        <div
          style={{
            border: "1px solid #222",
            borderRadius: "14px",
            padding: "16px",
            background: "#0b0b0c",
          }}
        >
          <div style={{ fontSize: "12px", opacity: 0.7, marginBottom: "8px" }}>
            BULL / BEAR / NEUTRAL
          </div>
          <div style={{ fontSize: "20px", fontWeight: 700 }}>
            {bullishMentions} / {bearishMentions} / {neutralMentions}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(320px, 1fr)",
          gap: "20px",
          alignItems: "start",
        }}
      >
        <div>
          <TickerMarketSection ticker={symbol} />
        </div>

        <aside
          style={{
            border: "1px solid #1f2937",
            borderRadius: 20,
            background:
              "linear-gradient(180deg, rgba(15,23,42,0.95) 0%, rgba(9,11,15,0.98) 100%)",
            padding: 20,
            position: "sticky",
            top: 24,
          }}
        >
          <div
            style={{
              fontSize: 12,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#9ca3af",
              marginBottom: 8,
            }}
          >
            Sentra Outlook
          </div>

          <div
            style={{
              fontSize: 30,
              fontWeight: 800,
              marginBottom: 18,
            }}
          >
            {interpretation.outlook}
          </div>

          <div style={{ display: "grid", gap: 12, marginBottom: 18 }}>
            <div
              style={{
                border: "1px solid #222833",
                borderRadius: 14,
                padding: "12px 14px",
                background: "#0f1115",
              }}
            >
              <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>
                Confidence
              </div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>
                {interpretation.confidence}
              </div>
            </div>

            <div
              style={{
                border: "1px solid #222833",
                borderRadius: 14,
                padding: "12px 14px",
                background: "#0f1115",
              }}
            >
              <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>
                Horizon
              </div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>
                {interpretation.horizon}
              </div>
            </div>

            <div
              style={{
                border: "1px solid #222833",
                borderRadius: 14,
                padding: "12px 14px",
                background: "#0f1115",
              }}
            >
              <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>
                Narrative Pressure
              </div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>
                {interpretation.narrativePressure}
              </div>
            </div>
          </div>

          <div
            style={{
              borderTop: "1px solid #222833",
              paddingTop: 16,
              color: "#d1d5db",
              lineHeight: 1.6,
              fontSize: 14,
            }}
          >
            {interpretation.summary}
          </div>

          <div
            style={{
              marginTop: 18,
              fontSize: 13,
              color: "#9ca3af",
              lineHeight: 1.6,
            }}
          >
            This is a current Sentra read based on narrative pressure, sentiment,
            mention breadth, and score concentration. Full time-series velocity
            comes next.
          </div>
        </aside>
      </div>

      <div style={{ marginTop: 36 }}>
        <h2 style={{ fontSize: "20px", marginBottom: "16px" }}>
          Top Score Drivers
        </h2>

        {sortedDrivers.length === 0 ? (
          <div style={{ opacity: 0.75 }}>
            No scored videos found for {symbol}.
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: "16px",
            }}
          >
            {sortedDrivers.map((driver, i) => (
              <div
                key={`${driver.youtubeVideoId}-${i}`}
                style={{
                  border: "1px solid #1f2937",
                  borderRadius: 18,
                  background: "#0b0b0c",
                  padding: 18,
                }}
              >
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    lineHeight: 1.4,
                    marginBottom: 12,
                  }}
                >
                  {driver.title}
                </div>

                <div
                  style={{
                    fontSize: 13,
                    color: "#9ca3af",
                    marginBottom: 14,
                  }}
                >
                  {driver.creatorName} · {formatPublishedAt(driver.publishedAt)}
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                    marginBottom: 14,
                  }}
                >
                  <div
                    style={{
                      border: "1px solid #222833",
                      background: "#11141b",
                      borderRadius: 999,
                      padding: "7px 10px",
                      fontSize: 12,
                    }}
                  >
                    {driver.viewCount.toLocaleString()} views
                  </div>

                  <div
                    style={{
                      border: "1px solid #222833",
                      background: "#11141b",
                      borderRadius: 999,
                      padding: "7px 10px",
                      fontSize: 12,
                    }}
                  >
                    {driver.likeCount.toLocaleString()} likes
                  </div>

                  <div
                    style={{
                      border: "1px solid #222833",
                      background: "#11141b",
                      borderRadius: 999,
                      padding: "7px 10px",
                      fontSize: 12,
                    }}
                  >
                    {driver.commentCount.toLocaleString()} comments
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    flexWrap: "wrap",
                    marginBottom: 12,
                  }}
                >
                  <span
                    style={{
                      background: stanceBadgeColor(driver.stance),
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 999,
                      padding: "6px 10px",
                      fontSize: 12,
                      textTransform: "capitalize",
                    }}
                  >
                    {driver.stance}
                  </span>

                  <span style={{ fontSize: 13, color: "#cbd5e1" }}>
                    Confidence {driver.confidence.toFixed(2)}
                  </span>
                </div>

                <div
                  style={{
                    fontSize: 14,
                    color: "#e5e7eb",
                    marginBottom: 14,
                  }}
                >
                  Sentra contribution{" "}
                  <span style={{ fontWeight: 700 }}>
                    {driver.videoSentraScore.toLocaleString(undefined, {
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>

                {driver.youtubeVideoId ? (
                  <a
                    href={`https://www.youtube.com/watch?v=${driver.youtubeVideoId}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: "inline-block",
                      marginTop: 4,
                      color: "#93c5fd",
                      fontSize: 14,
                      textDecoration: "none",
                    }}
                  >
                    Watch video →
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}