import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
