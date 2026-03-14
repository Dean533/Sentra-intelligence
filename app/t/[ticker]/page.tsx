import { supabaseServer } from "@/lib/supabase/server";

export default async function Page({ params }: any) {
  const { ticker } = await params;
  const symbol = ticker.toUpperCase();

  const supabase = supabaseServer();

  const { data } = await supabase
    .from("video_positions")
    .select(`
      ticker,
      videos (
        title,
        view_count,
        like_count,
        video_published_at,
        youtube_video_id,
        creators (
          name
        )
      )
    `)
    .eq("ticker", symbol)
    .limit(30);

  return (
    <div style={{ padding: "40px" }}>
      <h1 style={{ fontSize: "28px", marginBottom: "20px" }}>
        {symbol} Attention Drivers
      </h1>

      {data?.map((row: any, i: number) => {
        const v = row.videos;

        return (
          <div
            key={i}
            style={{
              marginBottom: "25px",
              borderBottom: "1px solid #eee",
              paddingBottom: "15px",
            }}
          >
            <div style={{ fontWeight: "bold", fontSize: "16px" }}>
              {v?.title}
            </div>

            <div style={{ fontSize: "13px", color: "#555" }}>
              Creator: {v?.creators?.name}
            </div>

            <div style={{ fontSize: "13px", color: "#777" }}>
              Views: {v?.view_count?.toLocaleString()} • Likes: {v?.like_count?.toLocaleString()}
            </div>

            <div style={{ fontSize: "12px", color: "#888" }}>
              {v?.video_published_at}
            </div>

            <a
              href={`https://youtube.com/watch?v=${v?.youtube_video_id}`}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: "12px", color: "blue" }}
            >
              Watch video
            </a>
          </div>
        );
      })}
    </div>
  );
}