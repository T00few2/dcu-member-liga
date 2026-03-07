import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://liga.dcucykling.dk";
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/info", "/datapolitik", "/offentliggoerelse"],
        disallow: "/",
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
