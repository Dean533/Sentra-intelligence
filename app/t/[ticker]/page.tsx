import { supabaseServer } from "@/lib/supabase/server";
import { computeVideoSentraScore, safeNumber } from "@/lib/sentraScore";

export default async function Page({ params }: any) {
  const { ticker } = await params;
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
        view_count,
        like_count,
        comment_count,
        video_published_at,
        youtube_video_id,
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

  let sentraScore = 0;
  let mentions = 0;
  let sentimentSum = 0;
  let bullishMentions = 0;
  let bearishMentions = 0;
  let neutralMentions = 0;

  const drivers = rows
    .map((row) => {
      const v = row.videos as any;
      if (!v) return null;

      const publishedAt = v?.video_published_at ?? row.video_published_at ?? null;

      const { videoSentraScore, stanceValue, confidence } =
        computeVideoSentraScore({
          view_count: v?.view_count,
          like_count: v?.like_count,
          comment_count: v?.comment_count,
          video_published_at: publishedAt,
          stance: row.stance,
          confidence: row.confidence,
        });

      mentions += 1;
      sentraScore += videoSentraScore;
      sentimentSum += stanceValue * confidence;

      if (stanceValue > 0) bullishMentions += 1;
      else if (stanceValue < 0) bearishMentions += 1;
      else neutralMentions += 1;

      return {
        title: v?.title ?? "Untitled video",
        creatorName: v?.creators?.name ?? "Unknown creator",
        viewCount: safeNumber(v?.view_count),
        likeCount: safeNumber(v?.like_count),
        commentCount: safeNumber(v?.comment_count),
        publishedAt,
        youtubeVideoId: v?.youtube_video_id ?? "",
        stance: row.stance ?? "neutral",
        confidence,
        videoSentraScore,
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => b.videoSentraScore - a.videoSentraScore);

  const sentiment = mentions > 0 ? sentimentSum / mentions : 0;

  return (
    <div style={{ padding: "40px" }}>
      <h1 style={{ fontSize: "28px", marginBottom: "20px" }}>
        {symbol} Sentra Signal
      </h1>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: "16px",
          marginBottom: "32px",
        }}
      >
        <div style={card}>
          <div style={cardLabel}>Sentra Score</div>
          <div style={cardValue}>{sentraScore.toLocaleString()}</div>
        </div>

        <div style={card}>
          <div style={cardLabel}>Mentions</div>
          <div style={cardValue}>{mentions}</div>
        </div>

        <div style={card}>
          <div style={cardLabel}>Sentiment</div>
          <div style={cardValue}>{sentiment.toFixed(2)}</div>
        </div>

        <div style={card}>
          <div style={cardLabel}>Bull / Bear / Neutral</div>
          <div style={cardValueSmall}>
            {bullishMentions} / {bearishMentions} / {neutralMentions}
          </div>
        </div>
      </div>

      <h2 style={{ fontSize: "20px", marginBottom: "18px" }}>
        Top Score Drivers
      </h2>

      {drivers.length === 0 ? (
        <div>No videos found for {symbol}.</div>
      ) : (
        drivers.map((driver: any, i: number) => (
          <div
            key={i}
            style={{
              marginBottom: "25px",
              borderBottom: "1px solid #eee",
              paddingBottom: "15px",
            }}
          >
            <div style={{ fontWeight: "bold", fontSize: "16px", marginBottom: "6px" }}>
              {driver.title}
            </div>

            <div style={{ fontSize: "13px", color: "#555", marginBottom: "4px" }}>
              Creator: {driver.creatorName}
            </div>

            <div style={{ fontSize: "13px", color: "#777", marginBottom: "4px" }}>
              Views: {driver.viewCount.toLocaleString()} • Likes:{" "}
              {driver.likeCount.toLocaleString()} • Comments:{" "}
              {driver.commentCount.toLocaleString()}
            </div>

            <div style={{ fontSize: "13px", color: "#777", marginBottom: "4px" }}>
              Stance: {driver.stance} • Confidence: {driver.confidence.toFixed(2)}
            </div>

            <div style={{ fontSize: "13px", color: "#777", marginBottom: "4px" }}>
              Video Sentra Score: {driver.videoSentraScore.toLocaleString()}
            </div>

            <div style={{ fontSize: "12px", color: "#888", marginBottom: "8px" }}>
              {driver.publishedAt || "Unknown publish date"}
            </div>

            <a
              href={`https://youtube.com/watch?v=${driver.youtubeVideoId}`}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: "12px", color: "blue" }}
            >
              Watch video
            </a>
          </div>
        ))
      )}
    </div>
  );
}

const card = {
  border: "1px solid #333",
  borderRadius: "10px",
  padding: "16px",
  background: "#111",
};

const cardLabel = {
  fontSize: "12px",
  color: "#999",
  marginBottom: "8px",
  textTransform: "uppercase" as const,
  letterSpacing: "0.04em",
};

const cardValue = {
  fontSize: "24px",
  fontWeight: "bold" as const,
};

const cardValueSmall = {
  fontSize: "18px",
  fontWeight: "bold" as const,
};