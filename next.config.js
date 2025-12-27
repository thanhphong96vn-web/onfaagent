/** @type {import('next').NextConfig} */
const nextConfig = {
  // App Router is enabled by default in Next.js 13.4+
  webpack: (config, { isServer }) => {
    // Exclude whatsapp-web.js from webpack bundling (it's not compatible with Next.js build)
    // This package should only be used in standalone worker scripts
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        child_process: false,
      };
    }
    
    // Exclude whatsapp-web.js and its dependencies from client-side bundle
    config.externals = config.externals || [];
    if (isServer) {
      config.externals.push({
        'whatsapp-web.js': 'commonjs whatsapp-web.js',
        'puppeteer': 'commonjs puppeteer',
      });
    }
    
    return config;
  },
}

module.exports = nextConfig
