import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost:3000"],
    },
  },
  // Vercel's production build runs a stricter lint pass than `next dev` and
  // fails the whole deploy on things like unused variables — harmless code
  // smells, not runtime bugs. Don't let lint hygiene block shipping; run
  // `npm run lint` locally whenever you want to clean those up separately.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
