import "./globals.css";
import Navbar from "./components/Navbar";

export const metadata = {
  title: "Sentra Intelligence",
  description: "Market narrative intelligence platform",
  verification: {
    google: "jb73OKoIAWoS6bnD6y7M_sZctp_HEUhL8_upTCddjkI",
  },
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
