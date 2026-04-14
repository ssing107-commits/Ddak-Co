const requiredEnvVars = [
  "GITHUB_TOKEN",
  "GITHUB_ORG",
  "VERCEL_TOKEN",
  "VERCEL_TEAM_ID",
];

const missingEnvVars = requiredEnvVars.filter(
  (name) => !process.env[name] || process.env[name]?.trim() === ""
);

if (missingEnvVars.length > 0) {
  throw new Error(
    `[env] Missing required environment variables: ${missingEnvVars.join(", ")}`
  );
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {},
};

export default nextConfig;

