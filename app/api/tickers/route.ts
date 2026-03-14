import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

function computeSentraAttention(video: any, creator: any) {
  const V = video.view_count || 0;
  const L = video.like_count || 0;
  const C = video.comment_count || 0;

  if (V === 0) return 0;

  const likeRate = L / V;
  const commentRate = C / V;

  const base = V + 8 * L + 20 * C;

  const engagementMultiplier =
    1 + 4 * likeRate + 10 * commentRate;

  const published = new Date(video.video_published_at).getTime();
  const now = Date.now();

  const ageHours = (now - published) / (1000 * 60 * 60);

  const recency = Math.exp(-ageHours / 72);

  const subs = creator?.subscriber_count || 0;

  const creatorWeight = Math.log10(subs + 10);

  return base * engagementMultiplier * recency * creatorWeight;
}

export async function GET() {
  const supabase = supabaseServer();

  const { data } = await supabase
    .from("video_positions")
    .select(`
      ticker,
      videos (
        id,
        title,
        view_count,
        like_count,
        comment_count,
        video_published_at,
        creators (
          name,
          subscriber_count
        )
      )
    `);

  const tickerStats: any = {};

  data?.forEach((row: any) => {
    const ticker = row.ticker;
    const video = row.videos;
    const creator = video?.creators;

    if (!video) return;

    const score = computeSentraAttention(video, creator);

    if (!tickerStats[ticker]) {
      tickerStats[ticker] = {
        ticker,
        mentions: 0,
        sentiment: 0,
        attention: 0,
      };
    }

    tickerStats[ticker].mentions += 1;
    tickerStats[ticker].attention += score;
  });

  const tickers = Object.values(tickerStats)
    .sort((a: any, b: any) => b.attention - a.attention);

  return NextResponse.json({
    success: true,
    version: "sentra-attention-v2",
    tickers
  });
}