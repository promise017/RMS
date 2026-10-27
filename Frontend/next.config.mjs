// Django runs on port 8000. Requests to /backend/* are forwarded there by the
// Next.js server, so the browser never makes a cross-origin call and the
// Django CORS settings don't need to change.
const DJANGO_URL = process.env.DJANGO_URL || "http://127.0.0.1:8000";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // `next dev` blocks its scripts for pages opened from a network address, which
  // leaves every button dead. Allow this PC's LAN address (and phones on the Wi-Fi).
  allowedDevOrigins: ["127.0.0.1", "192.168.1.84", "192.168.1.*"],
  // Django URLs end with a slash; keep Next.js from stripping it.
  skipTrailingSlashRedirect: true,
  // The dev-mode badge would sit on top of the sidebar's Account link
  devIndicators: { position: "bottom-right" },
  async rewrites() {
    return [
      // :path* drops a trailing slash, and Django can't redirect a POST to add it
      // back (500 RuntimeError), so slashed URLs get their own rule.
      { source: "/backend/:path*/", destination: `${DJANGO_URL}/:path*/` },
      { source: "/backend/:path*", destination: `${DJANGO_URL}/:path*` },
    ];
  },
};

export default nextConfig;
