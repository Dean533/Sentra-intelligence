import Link from "next/link";

export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "80vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "60px 40px",
      }}
    >
      <h1
        style={{
          fontSize: "64px",
          marginBottom: "20px",
          lineHeight: 1.05,
          maxWidth: "900px",
        }}
      >
        Sentra Intelligence
      </h1>

      <p
        style={{
          fontSize: "20px",
          color: "#aaa",
          maxWidth: "800px",
          marginBottom: "30px",
        }}
      >
        Track how financial narratives spread across media and identify which
        companies are receiving abnormal attention.
      </p>

      <div style={{ display: "flex", gap: "16px" }}>
        <Link href="/t" style={buttonStyle}>
          Explore Tickers
        </Link>

        <Link href="/narratives" style={secondaryButtonStyle}>
          View Narratives
        </Link>
      </div>
    </main>
  );
}

const buttonStyle: React.CSSProperties = {
  background: "white",
  color: "black",
  padding: "12px 20px",
  borderRadius: "999px",
  textDecoration: "none",
  fontWeight: 600,
};

const secondaryButtonStyle: React.CSSProperties = {
  border: "1px solid #444",
  color: "white",
  padding: "12px 20px",
  borderRadius: "999px",
  textDecoration: "none",
  fontWeight: 600,
};