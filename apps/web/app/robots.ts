import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env["NEXT_PUBLIC_APP_URL"] ?? "https://freecall.app";
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/rules", "/privacy"],
      disallow: ["/api/", "/admin/"],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
