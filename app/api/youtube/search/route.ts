import { NextResponse } from "next/server";
import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";
import { ALLOWED_CHANNEL_IDS } from "@/lib/allowedChannels";
import { dedupeByKey } from "@/lib/youtubeIngestion/shared";
import {
  isFinanceRelevant,
  isClearlyIrrelevant,
} from "@/lib/youtubeIngestion/financeFilters";
import { classifyStance, type Stance } from "@/lib/youtubeIngestion/stance";
import { extractTickersFromText } from "@/lib/youtubeIngestion/tickerRules";

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();
    const maxResults = Number(searchParams.get("maxResults") || "10");
    const targetTicker = q.toUpperCase().trim();

    if (!q) {
      return NextResponse.json({ error: "Missing q" }, { status: 400 });
    }

    const youtube = google.youtube({
      version: "v3",
      auth: process.env.YOUTUBE_API_KEY,
    });

    const supabase = supabaseAdmin();

    const financeQuery = `${q} stock OR investing OR earnings OR analysis OR market`;

    const searchRes = await youtube.search.list({
      part: ["snippet"],
      q: financeQuery,
      maxResults,
      type: ["video"],
    });

    const rawItems = searchRes.data.items ?? [];

    const filterDebug = {
      missingSnippet: 0,
      clearlyIrrelevant: 0,
      notFinanceRelevant: 0,
      trustedCandidates: 0,
      untrustedCandidates: 0,
      passed: 0,
    };

    const items = rawItems.filter((it) => {
      const sn = it.snippet;
      if (!sn) {
        filterDebug.missingSnippet += 1;
        return false;
      }

      const combined = `${sn.title ?? ""} ${sn.description ?? ""}`;

      if (isClearlyIrrelevant(combined)) {
        filterDebug.clearlyIrrelevant += 1;
        return false;
      }

      if (!isFinanceRelevant(combined)) {
        filterDebug.notFinanceRelevant += 1;
        return false;
      }

      const isTrustedSource = ALLOWED_CHANNEL_IDS.includes(sn.channelId || "");
      if (isTrustedSource) {
        filterDebug.trustedCandidates += 1;
      } else {
        filterDebug.untrustedCandidates += 1;
      }

      filterDebug.passed += 1;
      return true;
    });

    if (items.length === 0) {
      return NextResponse.json({
        success: true,
        q,
        creatorsUpserted: 0,
        videosUpserted: 0,
        positionsUpserted: 0,
        debug: {
          rawSearchItems: rawItems.length,
          filteredItems: 0,
          filterDebug,
        },
      });
    }

    const youtubeVideoIds = items
      .map((it) => it.id?.videoId)
      .filter(Boolean) as string[];

    if (youtubeVideoIds.length === 0) {
      return NextResponse.json({
        success: true,
        q,
        creatorsUpserted: 0,
        videosUpserted: 0,
        positionsUpserted: 0,
        debug: {
          rawSearchItems: rawItems.length,
          filteredItems: items.length,
          videoIdsFound: 0,
          filterDebug,
        },
      });
    }

    const detailsRes = await youtube.videos.list({
      part: ["snippet", "statistics"],
      id: youtubeVideoIds,
    });

    const detailsItems = detailsRes.data.items ?? [];

    const detailsMap = new Map<
      string,
      {
        title: string | null;
        description: string | null;
        publishedAt: string | null;
        view_count: number;
        like_count: number;
        comment_count: number;
      }
    >();

    for (const v of detailsItems) {
      if (!v.id) continue;

      detailsMap.set(v.id, {
        title: v.snippet?.title ?? null,
        description: v.snippet?.description ?? null,
        publishedAt: v.snippet?.publishedAt ?? null,
        view_count: Number(v.statistics?.viewCount ?? 0),
        like_count: Number(v.statistics?.likeCount ?? 0),
        comment_count: Number(v.statistics?.commentCount ?? 0),
      });
    }

    const creatorsRaw = items.map((it) => ({
      youtube_channel_id: it.snippet?.channelId || "",
      name: it.snippet?.channelTitle || null,
    }));

    const creators = dedupeByKey(
      creatorsRaw.filter((c) => c.youtube_channel_id),
      (c) => c.youtube_channel_id
    );

    const { error: creatorsUpsertError } = await supabase
      .from("creators")
      .upsert(creators, { onConflict: "youtube_channel_id" });

    if (creatorsUpsertError) {
      return NextResponse.json(
        { error: `Creators upsert failed: ${creatorsUpsertError.message}` },
        { status: 500 }
      );
    }

    const { data: creatorRows, error: creatorFetchError } = await supabase
      .from("creators")
      .select("id,youtube_channel_id")
      .in("youtube_channel_id", creators.map((c) => c.youtube_channel_id));

    if (creatorFetchError) {
      return NextResponse.json(
        { error: `Creators fetch failed: ${creatorFetchError.message}` },
        { status: 500 }
      );
    }

    const channelToCreator = new Map<string, number>();
    for (const row of creatorRows ?? []) {
      channelToCreator.set(row.youtube_channel_id, row.id);
    }

    const videosRaw = items.map((it) => {
      const youtubeVideoId = it.id?.videoId || "";
      const detail = detailsMap.get(youtubeVideoId);
      const publishedAt = detail?.publishedAt ?? it.snippet?.publishedAt ?? null;

      return {
        youtube_video_id: youtubeVideoId,
        creator_id: channelToCreator.get(it.snippet?.channelId || "") ?? null,
        title: detail?.title ?? it.snippet?.title ?? null,
        description: detail?.description ?? it.snippet?.description ?? null,
        published_at: publishedAt,
        video_published_at: publishedAt,
        view_count: detail?.view_count ?? 0,
        like_count: detail?.like_count ?? 0,
        comment_count: detail?.comment_count ?? 0,
        fetched_at: new Date().toISOString(),
        processed_status: "new",
      };
    });

    const videos = dedupeByKey(
      videosRaw.filter((v) => v.youtube_video_id),
      (v) => v.youtube_video_id
    );

    const { error: videosUpsertError } = await supabase.from("videos").upsert(videos, {
      onConflict: "youtube_video_id",
      ignoreDuplicates: false,
    });

    if (videosUpsertError) {
      return NextResponse.json(
        { error: `Videos upsert failed: ${videosUpsertError.message}` },
        { status: 500 }
      );
    }

    const { data: videoRows, error: videoFetchError } = await supabase
      .from("videos")
      .select("id,youtube_video_id,creator_id")
      .in("youtube_video_id", videos.map((v) => v.youtube_video_id));

    if (videoFetchError) {
      return NextResponse.json(
        { error: `Videos fetch failed: ${videoFetchError.message}` },
        { status: 500 }
      );
    }

    const videoMap = new Map<
      string,
      { id: number; youtube_video_id: string; creator_id: number | null }
    >();

    for (const row of videoRows ?? []) {
      videoMap.set(row.youtube_video_id, row);
    }

    const positions: Array<{
      video_id: number;
      creator_id: number | null;
      ticker: string;
      stance: Stance;
      confidence: number;
      source: string;
      video_published_at: string | null;
    }> = [];

    for (const it of items) {
      const youtubeVideoId = it.id?.videoId || "";
      const internal = videoMap.get(youtubeVideoId);
      if (!internal) continue;

      const detail = detailsMap.get(youtubeVideoId);
      const title = detail?.title ?? it.snippet?.title ?? "";
      const description = detail?.description ?? it.snippet?.description ?? "";
      const text = `${title} ${description}`;

      const tickers = extractTickersFromText(title, description);

      if (tickers.length === 0) continue;
      if (!isFinanceRelevant(text)) continue;
      if (isClearlyIrrelevant(text)) continue;
      if (!tickers.includes(targetTicker)) continue;

      const { stance, confidence } = classifyStance(text);
      const isTrustedSource = ALLOWED_CHANNEL_IDS.includes(
        it.snippet?.channelId || ""
      );

      positions.push({
        video_id: internal.id,
        creator_id: internal.creator_id,
        ticker: targetTicker,
        stance,
        confidence,
        source: isTrustedSource
          ? "youtube_search_trusted"
          : "youtube_search_untrusted",
        video_published_at: detail?.publishedAt ?? it.snippet?.publishedAt ?? null,
      });
    }

    const cleanPositions = dedupeByKey(
      positions,
      (p) => `${p.video_id}:${p.ticker}`
    );

    if (cleanPositions.length > 0) {
      const { error: positionsUpsertError } = await supabase
        .from("video_positions")
        .upsert(cleanPositions, { onConflict: "video_id,ticker" });

      if (positionsUpsertError) {
        return NextResponse.json(
          {
            error: `Video positions upsert failed: ${positionsUpsertError.message}`,
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      q,
      creatorsUpserted: creators.length,
      videosUpserted: videos.length,
      positionsUpserted: cleanPositions.length,
      debug: {
        rawSearchItems: rawItems.length,
        filteredItems: items.length,
        videoIdsFound: youtubeVideoIds.length,
        detailsItemsFound: detailsItems.length,
        sampleVideo: videos[0] ?? null,
        filterDebug,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}