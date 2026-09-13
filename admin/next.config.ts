import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The agent lives in the parent directory and has its own package-lock.json,
  // so Next infers the workspace root as the parent and then cannot find this
  // app's build output. Pin it.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
