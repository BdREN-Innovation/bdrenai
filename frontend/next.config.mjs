/** Local development without nginx: DEV_API_PROXY=http://localhost:8000 sends /api/* to Django. Unset in production. */
const devApiProxy = process.env.DEV_API_PROXY;

/** The admin app (platform and institution consoles); nginx serves it at /admin/, local dev on the Vite server. */
const adminUrl = (process.env.NEXT_PUBLIC_ADMIN_URL || "/admin/").replace(/\/?$/, "/");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  // Django's routes end with "/" except file downloads such as usage/export.csv; keep paths as sent.
  skipTrailingSlashRedirect: Boolean(devApiProxy),
  // The institution admin console moved from the website (/portal/…) into the admin app; keep old links working.
  async redirects() {
    return [{ source: "/portal/:path*", destination: `${adminUrl}portal/:path*`, permanent: false }];
  },
  async rewrites() {
    if (!devApiProxy) return [];
    return [
      { source: "/api/:path*/", destination: `${devApiProxy}/api/:path*/` },
      { source: "/api/:path*", destination: `${devApiProxy}/api/:path*` },
    ];
  },
};
export default nextConfig;
