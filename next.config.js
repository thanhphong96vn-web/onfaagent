/** @type {import('next').NextConfig} */
const nextConfig = {
  // App Router is enabled by default in Next.js 13.4+
  
  // Exclude Node.js-only packages from server components bundling
  // These packages are not compatible with Next.js build and should only be used in standalone worker scripts
  serverComponentsExternalPackages: [
    'whatsapp-web.js',
    'puppeteer',
    'puppeteer-core',
    'discord.js',
    '@discordjs/rest',
    'discord-api-types',
  ],
  
  webpack: (config, { isServer }) => {
    // Exclude Node.js-only packages from client-side bundling
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        child_process: false,
        'discord.js': false,
        '@discordjs/rest': false,
        'discord-api-types': false,
      };
    }
    
    // Mark Node.js-only packages as external for server-side
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({
        'whatsapp-web.js': 'commonjs whatsapp-web.js',
        'puppeteer': 'commonjs puppeteer',
        'puppeteer-core': 'commonjs puppeteer-core',
        'discord.js': 'commonjs discord.js',
        '@discordjs/rest': 'commonjs @discordjs/rest',
        'discord-api-types': 'commonjs discord-api-types',
      });
    }
    
    return config;
  },
}

module.exports = nextConfig
