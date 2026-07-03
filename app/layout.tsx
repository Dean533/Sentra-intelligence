import "./globals.css";
import Navbar from "./components/Navbar";

export const metadata = {
  title: "Sentra Intelligence",
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
    <html lang="en">
      <body
        style={{
          margin: 0,
          backgroundColor: "black",
          color: "white",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <Navbar />
        {children}
      </body>
    </html>
  );
}
