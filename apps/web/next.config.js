/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    // ESLint runs in dev / CI — it must not block the production build
    // (cosmetic rules like react/no-unescaped-entities would fail `next build`).
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;
