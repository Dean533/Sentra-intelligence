import { supabaseServer } from "@/lib/supabase/server";

export default async function Page({ params }: any) {

  const { ticker } = await params;
  const symbol = ticker.toUpperCase();

  const supabase = supabaseServer();

  const { data } = await supabase
    .from("mentions")
    .select("context_text, author_name, sentiment_label, youtube_published_at")
    .eq("ticker", symbol)
    .limit(50);

  return (
    <div style={{ padding: "40px" }}>
      <h1 style={{ fontSize: "28px", marginBottom: "20px" }}>
        {symbol} Discussion
      </h1>

      {data?.map((m: any, i: number) => (
        <div
          key={i}
          style={{
            marginBottom: "20px",
            borderBottom: "1px solid #eee",
            paddingBottom: "10px",
          }}
        >
          <div style={{ fontWeight: "bold" }}>{m.author_name}</div>

          <div>{m.context_text}</div>

          <div style={{ fontSize: "12px", color: "#666" }}>
            Sentiment: {m.sentiment_label} • {m.youtube_published_at}
          </div>
        </div>
      ))}
    </div>
  );
}