"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Navbar() {
  const [query, setQuery] = useState("");
  const router = useRouter();

function handleSearch(e: React.FormEvent) {
  e.preventDefault();

  const ticker = query.trim().toUpperCase();

  if (!ticker) return;

  router.push(`/t/${ticker}`);
  setQuery("");
}

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

      <form onSubmit={handleSearch} style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search ticker..."
          style={{
            background: "#111",
            border: "1px solid #333",
            color: "white",
            padding: "6px 10px",
            borderRadius: "6px",
          }}
        />
        <button
          type="submit"
          style={{
            background: "white",
            color: "black",
            border: "none",
            padding: "6px 12px",
            borderRadius: "6px",
            cursor: "pointer",
          }}
        >
          Go
        </button>
      </form>
    </nav>
  );
}

const linkStyle: React.CSSProperties = {
  color: "#ccc",
  textDecoration: "none",
  fontSize: "14px",
};