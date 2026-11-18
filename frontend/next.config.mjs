/** Local development without nginx: DEV_API_PROXY=http://localhost:8000 sends /api/* to Django. Unset in production. */
const devApiProxy = process.env.DEV_API_PROXY;

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  // Django's routes end with "/"; keep them as sent when proxying.
  skipTrailingSlashRedirect: Boolean(devApiProxy),
  async rewrites() {
    return devApiProxy ? [{ source: "/api/:path*/", destination: `${devApiProxy}/api/:path*/` }] : [];
  },
};
export default nextConfig;
