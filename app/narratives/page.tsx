export default function NarrativesPage() {
  const narratives = [
    {
      name: "AI Infrastructure",
      description: "Companies tied to chips, compute, and AI systems.",
      tickers: "NVDA, AMD, MSFT",
    },
    {
      name: "Electric Vehicles",
      description: "Companies tied to EVs, autonomy, and mobility.",
      tickers: "TSLA",
    },
    {
      name: "Defense Technology",
      description: "Companies benefiting from defense and aerospace trends.",
      tickers: "PLTR",
    },
  ];

  return (
    <main style={{ padding: "40px" }}>
      <h1 style={{ fontSize: "36px", marginBottom: "10px" }}>
        Market Narratives
      </h1>

      <p style={{ color: "#aaa", marginBottom: "30px" }}>
        A simple first view of the themes Sentra is tracking across media.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: "20px",
        }}
      >
        {narratives.map((n) => (
          <div
            key={n.name}
            style={{
              border: "1px solid #222",
              borderRadius: "16px",
              padding: "20px",
              background: "#0b0b0b",
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: "10px", fontSize: "22px" }}>
              {n.name}
            </h2>

            <p style={{ color: "#aaa", marginBottom: "14px" }}>
              {n.description}
            </p>

            <div style={{ fontSize: "14px", color: "#ddd" }}>
              Top tickers: {n.tickers}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}