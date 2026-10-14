import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.31.66"],
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
