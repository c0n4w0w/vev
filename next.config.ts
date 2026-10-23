import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The SMTP client (lib/email/smtp.ts) is plain Node: sockets, TLS, DNS.
  // Loaded from node_modules at run time rather than bundled.
  serverExternalPackages: ["nodemailer"],
  // The platform dashboard is never indexed and never sends its address on.
  // Pages say the same in their metadata; a header also covers the 404 that
  // everyone who is not an operator gets there.
  async headers() {
    return [
      {
        // `:path*` matches zero or more segments, so /platform-admin itself too.
        source: "/platform-admin/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
  experimental: {
    serverActions: {
      // The default is 1 MB. A community profile image may be up to 5 MB
      // (see lib/community-avatar-image.ts), and the limit counts multipart
      // overhead. Every action still validates and authorises for itself;
      // this only decides how large a request Next will read.
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
