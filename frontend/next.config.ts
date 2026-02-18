import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
});

const nextConfig: NextConfig = {
  /* config options here */
  // @ts-ignore - Turbopack config is new in Next.js 16
  turbopack: {},
};

export default withPWA(nextConfig);
