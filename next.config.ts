import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Old screener URL. Exact path only: /events/[id] detail pages are untouched.
      // Query strings (e.g. ?classification=) carry over automatically.
      { source: '/events', destination: '/screener', permanent: true },
    ];
  },
};

export default nextConfig;
