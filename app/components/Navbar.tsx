"use client";

import Link from "next/link";

export default function Navbar() {
  return (
    <nav
      style={{
        display: "flex",
        gap: "24px",
        padding: "20px 40px",
        borderBottom: "1px solid #222",
        alignItems: "center",
      }}
    >
      <Link
        href="/"
        style={{
          color: "white",
          textDecoration: "none",
          fontWeight: 700,
          fontSize: "18px",
        }}
      >
        Sentra
      </Link>

      <Link href="/narratives" style={linkStyle}>
        Narratives
      </Link>

      <Link href="/t" style={linkStyle}>
        Tickers
      </Link>
    </nav>
  );
}

const linkStyle: React.CSSProperties = {
  color: "#ccc",
  textDecoration: "none",
  fontSize: "14px",
};