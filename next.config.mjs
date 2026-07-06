/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep Prisma OUT of Next's bundling so the OpenNext Cloudflare adapter can
  // patch it for the workerd runtime. Without this, Prisma's engine attempts an
  // unsupported `fs.readdir` on Workers ("[unenv] fs.readdir is not implemented").
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
  // Ensure the Prisma query-engine binaries are bundled into every serverless
  // function on Netlify (otherwise the runtime can't find the engine).
  outputFileTracingIncludes: {
    "/**": ["./node_modules/.prisma/client/**", "./node_modules/@prisma/client/**"],
  },
};

export default nextConfig;
