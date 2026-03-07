import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://www.dansk-ecykling.dk";
  return [
    {
      url: `${siteUrl}/info`,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${siteUrl}/datapolitik`,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${siteUrl}/offentliggoerelse`,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
