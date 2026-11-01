import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Security headers are applied to every response from the edge, not only to HTML.
 * A full nonce-based CSP lands with the call surface in Phase 1; the directives below
 * are the ones that are safe before any third-party script exists.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: [
    "@freecall/auth",
    "@freecall/config",
    "@freecall/db",
    "@freecall/i18n",
    "@freecall/moderation",
    "@freecall/protocol",
  ],
  serverExternalPackages: [
    "@freecall/observability",
    "@sentry/node",
    "@opentelemetry/sdk-node",
    "@opentelemetry/exporter-trace-otlp-grpc",
    "@opentelemetry/otlp-grpc-exporter-base",
    "@grpc/grpc-js",
    "@grpc/proto-loader",
    "ioredis",
    "postgres",
  ],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean)),
        "@grpc/grpc-js",
        "@grpc/proto-loader",
        "@opentelemetry/sdk-node",
        "@opentelemetry/otlp-grpc-exporter-base",
        "@sentry/node",
      ];
    }
    config.resolve.alias = {
      ...config.resolve.alias,
      "@freecall/auth": path.resolve(__dirname, "../../packages/auth/src/index.ts"),
      "@freecall/i18n": path.resolve(__dirname, "../../packages/i18n/src/index.ts"),
    };
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
