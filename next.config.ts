import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The SMTP client (lib/email/smtp.ts) is plain Node: sockets, TLS, DNS.
  // Loaded from node_modules at run time rather than bundled.
  serverExternalPackages: ["nodemailer"],
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
