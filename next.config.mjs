/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Ensure the Prisma query-engine binaries are bundled into every serverless
  // function on Netlify (otherwise the runtime can't find the engine).
  outputFileTracingIncludes: {
    "/**": ["./node_modules/.prisma/client/**", "./node_modules/@prisma/client/**"],
  },
};

export default nextConfig;
