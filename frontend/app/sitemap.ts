import type { MetadataRoute } from "next";
import { loadPublishedPosts } from "@/lib/postsServer";

// Built per request so new news posts are listed straight away.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://www.dansk-ecykling.dk";
  // Without Firestore the sitemap still lists the fixed pages.
  const posts = (await loadPublishedPosts()) ?? [];
  return [
    {
      url: `${siteUrl}/`,
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${siteUrl}/info`,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${siteUrl}/historik`,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/register`,
      changeFrequency: "monthly",
      priority: 0.6,
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
    {
      url: `${siteUrl}/nyheder`,
      changeFrequency: "weekly",
      priority: 0.7,
      ...(posts[0]?.publishedAt ? { lastModified: posts[0].publishedAt } : {}),
    },
    ...posts.map((post) => ({
      url: `${siteUrl}/nyheder/${encodeURIComponent(post.slug)}`,
      changeFrequency: "monthly" as const,
      priority: 0.6,
      lastModified: post.updatedAt,
    })),
  ];
}
