import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://www.dansk-ecykling.dk";
  return {
    rules: [
      {
        userAgent: "*",
        allow: [
          "/",
          "/info",
          "/historik",
          "/register",
          "/datapolitik",
          "/offentliggoerelse",
        ],
        disallow: ["/admin", "/live", "/api", "/consent", "/results", "/schedule", "/participants", "/stats"],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
