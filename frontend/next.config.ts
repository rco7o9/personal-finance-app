import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Tell Next.js not to bundle these packages through webpack.
  // They should be loaded as regular Node.js modules at runtime.
  // Without this, deploying to serverless environments (Vercel, etc.)
  // can fail because these packages have native code or rely on the
  // Node.js file system in ways that don't work inside a webpack bundle.
  serverExternalPackages: ["pg"],
}

export default nextConfig
