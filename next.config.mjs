/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep production browser-test output away from a concurrently running
  // development server's .next directory.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // @huggingface/transformers pulls in onnxruntime-node's native .node
  // bindings (src/lib/citizen-reaction/embedding-probe-score.ts); webpack
  // can't parse binary files, so this keeps it a real runtime require
  // instead of bundling it. Next 14's stable config key is still under
  // `experimental` (promoted to top-level `serverExternalPackages` in Next 15).
  experimental: {
    serverComponentsExternalPackages: ["onnxruntime-node", "@huggingface/transformers"],
  },
};

export default nextConfig;
