import { supabaseServer } from "../../lib/supabase/server";

export default async function VideosPage() {
  const supabase = supabaseServer();

  const { data: videos, error } = await supabase
    .from("videos")
    .select("id, youtube_video_id, creator_id, title, processed_status, fetched_at")
    .order("id", { ascending: true });

  if (error) {
    return (
      <main style={{ padding: 20 }}>
        <h1>Database Error</h1>
        <pre>{error.message}</pre>
      </main>
    );
  }

  return (
    <main style={{ padding: 20, fontFamily: "ui-sans-serif, system-ui" }}>
      <h1 style={{ fontSize: 24, marginBottom: 12 }}>Videos</h1>

      {(!videos || videos.length === 0) ? (
        <p>No videos yet.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                {["id", "youtube_video_id", "creator_id", "title", "status", "fetched_at"].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      borderBottom: "1px solid #333",
                      padding: "8px 10px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {videos.map((v) => (
                <tr key={v.id}>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid #222" }}>{v.id}</td>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid #222" }}>
                    {String(v.youtube_video_id || "").trim()}
                  </td>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid #222" }}>
                    {v.creator_id ?? ""}
                  </td>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid #222" }}>
                    {v.title ?? ""}
                  </td>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid #222" }}>
                    {v.processed_status ?? ""}
                  </td>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid #222" }}>
                    {v.fetched_at ? new Date(v.fetched_at).toLocaleString() : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
