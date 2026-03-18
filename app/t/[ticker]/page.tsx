import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { computeVideoSentraScore, safeNumber } from "@/lib/sentraScore";
import TickerMarketSection from "@/app/components/TickerMarketSection";
import { getMarketProfile } from "@/lib/marketProfile";

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

function formatCompactNumber(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatFullNumber(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US").format(value);
}

function shortenDescription(text: string | null | undefined, maxLength = 420) {
  if (!text) return "No company description available.";

  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;

  const shortened = clean.slice(0, maxLength);
  const lastPeriod = shortened.lastIndexOf(".");
  if (lastPeriod > 180) {
    return shortened.slice(0, lastPeriod + 1);
  }

  const lastSpace = shortened.lastIndexOf(" ");
  return `${shortened.slice(0, lastSpace)}...`;
}

function countTrackedTickers(title: string) {
  const tracked = [
    "NVDA",
    "AMD",
    "PLTR",
    "TSLA",
    "AAPL",
    "AMZN",
    "META",
    "MSFT",
    "GOOGL",
    "NFLX",
    "AVGO",
    "TSM",
    "INTC",
    "COIN",
  ];

  const upper = title.toUpperCase();
  let count = 0;

  for (const ticker of tracked) {
    const re = new RegExp(`\\b${ticker}\\b`, "i");
    if (re.test(upper)) count += 1;
  }

  return count;
}

function isBroadMarketVideo(title: string) {
  const lower = title.toLowerCase();

  const broadPhrases = [
    "market crash",
    "stock recap",
    "market recap",
    "faang",
    "magnificent 7",
    "big tech",
    "top ai stocks",
    "best ai stocks",
    "stock market today",
    "the big 3",
    "top stocks",
    "stocks to buy",
    "daily recap",
  ];

  const broadPhraseHit = broadPhrases.some((phrase) => lower.includes(phrase));
  const trackedTickerCount = countTrackedTickers(title);

  return broadPhraseHit || trackedTickerCount >= 3;
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

  let outlook = "Neutral Watch";
  if (sentiment >= 0.35 && mentions >= 20) outlook = "Strong Bullish";
  else if (sentiment >= 0.18 && mentions >= 12) outlook = "Bullish Setup";
  else if (sentiment >= 0.08 && mentions >= 10) outlook = "Constructive Watch";
  else if (sentiment <= -0.35 && bearishMentions >= bullishMentions)
    outlook = "Strong Bearish";
  else if (sentiment <= -0.18 && bearishMentions >= bullishMentions)
    outlook = "Risk-Off";
  else if (sentiment <= -0.08) outlook = "Weakening Tone";

  let confidence = "Low";
  if (mentions >= 20 && Math.abs(sentiment) >= 0.22) confidence = "High";
  else if (mentions >= 10 && Math.abs(sentiment) >= 0.1) confidence = "Medium";

  let horizon = "Medium-term";
  if (mentions >= 18) horizon = "Short-term";
  if (mentions < 8) horizon = "Watchlist";

  let narrativePressure = "Moderate";
  if (sentraScore >= 35000) narrativePressure = "Very High";
  else if (sentraScore >= 18000) narrativePressure = "High";
  else if (sentraScore >= 8000) narrativePressure = "Building";

  let summary =
    "Narrative activity is present, but the signal still needs confirmation from broader trend and price follow-through.";

  if (outlook === "Strong Bullish") {
    summary =
      "Coverage is broad, sentiment is strong, and bullish pressure is leading the conversation in a meaningful way.";
  } else if (outlook === "Bullish Setup") {
    summary =
      "The signal is leaning positive. Attention is strong enough to support upside, but conviction is not yet fully one-sided.";
  } else if (outlook === "Constructive Watch") {
    summary =
      "Momentum is improving and tone is slightly positive, but this still looks more like an emerging setup than a full breakout signal.";
  } else if (outlook === "Strong Bearish") {
    summary =
      "Negative pressure is dominating attention and the current setup looks decisively risk-off.";
  } else if (outlook === "Risk-Off") {
    summary =
      "Tone is leaning bearish and the signal suggests caution until narrative pressure improves.";
  } else if (outlook === "Weakening Tone") {
    summary =
      "Coverage is still active, but the quality of sentiment is softening and the setup looks less convincing.";
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

  const [profile, tickerResult] = await Promise.all([
    getMarketProfile(symbol),
    supabase
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
      .limit(100),
  ]);

  const { data, error } = tickerResult;

  if (error) {
    return (
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "40px 24px" }}>
        <h1 style={{ fontSize: "34px", marginBottom: "12px" }}>{symbol}</h1>
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
      isBroad: isBroadMarketVideo(video?.title ?? ""),
    };
  });

  const sentiment = mentions > 0 ? sentimentSum / mentions : 0;

  const sortedDrivers = drivers.sort(
    (a, b) => b.videoSentraScore - a.videoSentraScore
  );

  const focusedDrivers = sortedDrivers.filter((driver) => !driver.isBroad);
  const topDrivers =
    focusedDrivers.length >= 4
      ? focusedDrivers.slice(0, 6)
      : sortedDrivers.slice(0, 6);

  const interpretation = getSentraInterpretation({
    sentraScore,
    sentiment,
    mentions,
    bullishMentions,
    bearishMentions,
  });

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", padding: "40px 24px" }}>
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 13,
            color: "#9ca3af",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: 8,
          }}
        >
          {profile?.exchange || "Market"} · {symbol}
        </div>

        <h1
          style={{
            fontSize: "40px",
            lineHeight: 1.1,
            marginBottom: 8,
          }}
        >
          {symbol}
        </h1>

        <div style={{ fontSize: 18, color: "#d1d5db" }}>
          {profile?.longName || `${symbol} Sentra Signal`}
        </div>
      </div>

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
          <div style={{ fontSize: "22px", fontWeight: 700 }}>
            {formatCompactNumber(sentraScore)}
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
          <div style={{ fontSize: "22px", fontWeight: 700 }}>{mentions}</div>
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
          <div style={{ fontSize: "22px", fontWeight: 700 }}>
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
          <div style={{ fontSize: "22px", fontWeight: 700 }}>
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
            alignSelf: "start",
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
            mention breadth, and score concentration.
          </div>
        </aside>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.2fr) minmax(320px, 0.8fr)",
          gap: 20,
          marginTop: 28,
        }}
      >
        <section
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
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#9ca3af",
              marginBottom: 10,
            }}
          >
            Company Overview
          </div>

          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              marginBottom: 10,
            }}
          >
            {profile?.longName || symbol}
          </div>

          <div
            style={{
              color: "#d1d5db",
              lineHeight: 1.75,
              fontSize: 15,
            }}
          >
            {shortenDescription(profile?.description)}
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              marginTop: 16,
            }}
          >
            <div
              style={{
                border: "1px solid #222833",
                background: "#11141b",
                borderRadius: 999,
                padding: "8px 12px",
                fontSize: 12,
              }}
            >
              Sector: {profile?.sector || "—"}
            </div>

            <div
              style={{
                border: "1px solid #222833",
                background: "#11141b",
                borderRadius: 999,
                padding: "8px 12px",
                fontSize: 12,
              }}
            >
              Industry: {profile?.industry || "—"}
            </div>

            <div
              style={{
                border: "1px solid #222833",
                background: "#11141b",
                borderRadius: 999,
                padding: "8px 12px",
                fontSize: 12,
              }}
            >
              Exchange: {profile?.exchange || "—"}
            </div>

            {profile?.website ? (
              <a
                href={profile.website}
                target="_blank"
                rel="noreferrer"
                style={{
                  border: "1px solid #222833",
                  background: "#11141b",
                  borderRadius: 999,
                  padding: "8px 12px",
                  fontSize: 12,
                  color: "#93c5fd",
                  textDecoration: "none",
                }}
              >
                Website →
              </a>
            ) : null}
          </div>
        </section>

        <section
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
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#9ca3af",
              marginBottom: 14,
            }}
          >
            Key Facts
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 16,
            }}
          >
            <div>
              <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>
                Market Cap
              </div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>
                {formatCompactNumber(profile?.marketCap)}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>
                Avg Volume
              </div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>
                {formatCompactNumber(profile?.avgVolume)}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>
                52W High
              </div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>
                {formatFullNumber(profile?.fiftyTwoWeekHigh)}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>
                52W Low
              </div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>
                {formatFullNumber(profile?.fiftyTwoWeekLow)}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>
                Employees
              </div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>
                {formatFullNumber(profile?.employees)}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>
                EPS
              </div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>
                {profile?.eps ?? "—"}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>
                Sector
              </div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>
                {profile?.sector || "—"}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>
                Industry
              </div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>
                {profile?.industry || "—"}
              </div>
            </div>
          </div>
        </section>
      </div>

      <div style={{ marginTop: 36 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "center",
            marginBottom: 16,
            flexWrap: "wrap",
          }}
        >
          <h2 style={{ fontSize: "20px", margin: 0 }}>Top Score Drivers</h2>

          <div style={{ fontSize: 13, color: "#9ca3af" }}>
            Showing top {topDrivers.length} focused videos by Sentra contribution
          </div>
        </div>

        {topDrivers.length === 0 ? (
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
            {topDrivers.map((driver, i) => (
              <Link
                key={`${driver.youtubeVideoId}-${i}`}
                href={`/t/${symbol}/drivers/${driver.youtubeVideoId}`}
                style={{
                  border: "1px solid #1f2937",
                  borderRadius: 18,
                  background: "#0b0b0c",
                  padding: 18,
                  textDecoration: "none",
                  color: "inherit",
                  display: "block",
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
                    {formatCompactNumber(driver.viewCount)} views
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
                    {formatCompactNumber(driver.likeCount)} likes
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
                    {formatCompactNumber(driver.commentCount)} comments
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
                    marginBottom: 12,
                  }}
                >
                  Sentra contribution{" "}
                  <span style={{ fontWeight: 700 }}>
                    {driver.videoSentraScore.toLocaleString(undefined, {
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>

                <div
                  style={{
                    color: "#93c5fd",
                    fontSize: 14,
                  }}
                >
                  Open evidence page →
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}