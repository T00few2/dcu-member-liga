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
          "/results",
          "/schedule",
          "/participants",
          "/historik",
          "/stats",
          "/register",
          "/datapolitik",
          "/offentliggoerelse",
        ],
        disallow: ["/admin", "/live", "/api", "/consent"],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
