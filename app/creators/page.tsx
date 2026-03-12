import { supabaseServer } from "../../lib/supabase/server";

export default async function CreatorsPage() {
  const supabase = supabaseServer();

  const { data, error } = await supabase
    .from("creators")
    .select("*");

  if (error) {
    return (
      <main style={{ padding: 20 }}>
        <h1>Database Error</h1>
        <p>{error.message}</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 20 }}>
      <h1>Creators Table</h1>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </main>
  );
}