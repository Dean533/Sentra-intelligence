import "./globals.css";
import { Newsreader, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";

const newsreader = Newsreader({
  subsets: ["latin"],
  // Variable font: weights 400/500 used, plus the optical-size axis.
  axes: ["opsz"],
  variable: "--font-newsreader",
  display: "swap",
});

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata = {
  title: "Sentra Signals",
  description: "Market narrative intelligence platform",
  verification: {
    google: "jb73OKoIAWoS6bnD6y7M_sZctp_HEUhL8_upTCddjkI",
  },
  icons: {
    icon: [
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon.ico",       sizes: "any" },
    ],
    apple: { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
  },
  manifest: "/site.webmanifest",
};

export const viewport = {
  width: "device-width",
  initialScale: 0.6,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${newsreader.variable} ${plexSans.variable} ${plexMono.variable}`}
    >
      <body
        className="font-sans"
        style={{
          margin: 0,
          backgroundColor: "#0B0E11",
          color: "#E8EAED",
        }}
      >
        <Navbar />
        {children}
        <Footer />
      </body>
    </html>
  );
}
