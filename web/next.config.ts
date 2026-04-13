import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@anthropic-ai/sdk",
    "@e2b/code-interpreter",
    "e2b",
  ],
};

export default nextConfig;
