/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Prevent webpack from bundling these — they need to be required at runtime
      config.externals = [
        ...(config.externals || []),
        "puppeteer-core",
        "@sparticuz/chromium",
      ];
    }
    return config;
  },
};

module.exports = nextConfig;
