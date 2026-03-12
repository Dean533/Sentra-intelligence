import { NextResponse } from "next/server";
import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

function scoreSentiment(text: string) {
  const t = text.toLowerCase();

  const positive = [
    "love","loved","amazing","awesome","great","good","best","insane","legend",
    "funny","hilarious","cool","fire","perfect","beautiful","goat","wow",
    "👏","🔥","❤️","😍","😂","🤣"
  ];

  const negative = [
    "hate","hated","bad","worst","terrible","awful","cringe","stupid","trash",
    "boring","fake","scam","annoying","sucks","wtf","🤮","😡","👎"
  ];

  let score = 0;
  for (const w of positive) if (t.includes(w)) score += 1;
  for (const w of negative) if (t.includes(w)) score -= 1;

  if (score > 5) score = 5;
  if (score < -5) score = -5;

  const normalized = score / 5;

  let label: "positive" | "neutral" | "negative" = "neutral";
  if (normalized >= 0.2) label = "positive";
  else if (normalized <= -0.2) label = "negative";

  return { sentiment_score: normalized, sentiment_label: label };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const videoId = searchParams.get("videoId") || "";
    const maxResults = Number(searchParams.get("maxResults") || "20");

    // ---- env checks
    if (!process.env.YOUTUBE_API_KEY) {
      return NextResponse.json({ error: "Missing YOUTUBE_API_KEY" }, { status: 500 });
    }
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      return NextResponse.json({ error: "Missing NEXT_PUBLIC_SUPABASE_URL" }, { status: 500 });
    }
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: "Missing SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });
    }

    if (!videoId.trim()) {
      return NextResponse.json({ error: "Provide ?videoId=YOUTUBE_VIDEO_ID" }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // ---- find internal video row
    const { data: videoRow, error: videoLookupError } = await supabase
      .from("videos")
      .select("id, creator_id")
      .eq("youtube_video_id", videoId)
      .maybeSingle();

    if (videoLookupError) {
      return NextResponse.json(
        { error: `Video lookup failed: ${videoLookupError.message}` },
        { status: 500 }
      );
    }

    if (!videoRow) {
      return NextResponse.json(
        {
          error: "Video not found in DB. Run /api/youtube/search first so videos table has it.",
          videoId,
        },
        { status: 404 }
      );
    }

    const internalVideoId = videoRow.id as number;
    const creatorId = videoRow.creator_id as number;

    // ---- fetch comments from youtube
    const youtube = google.youtube({ version: "v3", auth: process.env.YOUTUBE_API_KEY });

    const ytRes = await youtube.commentThreads.list({
      part: ["snippet"],
      videoId,
      maxResults,
      textFormat: "plainText",
      order: "relevance",
    });

    const threads = ytRes.data.items || [];

    // ---- map -> mentions rows
    const mentionsToUpsert = threads
      .map((t) => {
        const top = t.snippet?.topLevelComment;
        const c = top?.snippet;

        const youtube_comment_id = top?.id ?? null;
        const author_name = c?.authorDisplayName ?? null;
        const context_text = c?.textDisplay ?? null;

        // ✅ REAL comment time from YouTube (this fixes dashboard “all same time” issue)
        const youtube_published_at: string | null = c?.publishedAt ?? null;

        if (!youtube_comment_id || !context_text) return null;

        const { sentiment_score, sentiment_label } = scoreSentiment(context_text);

        return {
          youtube_comment_id,
          video_id: internalVideoId,
          creator_id: creatorId,
          source: "youtube",
          context_text,
          author_name,
          youtube_published_at, // ✅ store real time
          ticker: null,
          mention_time_seconds: null,
          sentiment_score,
          sentiment_label,
        };
      })
      .filter((x): x is any => x !== null);

    // ---- upsert
    if (mentionsToUpsert.length > 0) {
      const { error: upsertError } = await supabase
        .from("mentions")
        .upsert(mentionsToUpsert, { onConflict: "youtube_comment_id" });

      if (upsertError) {
        return NextResponse.json(
          { error: `Mentions upsert failed: ${upsertError.message}` },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      videoId,
      internalVideoId,
      creatorId,
      mentionsUpserted: mentionsToUpsert.length,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Unknown server error" },
      { status: 500 }
    );
  }
}
