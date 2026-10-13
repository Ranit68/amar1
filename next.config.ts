import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["tesseract.js", "@electric-sql/pglite"],
};

export default nextConfig;
