'use client';

import { useQuery } from '@tanstack/react-query';
import { getAllPosts } from '@/lib/posts';
import type { Post } from '@/types/posts';

export function usePostsQuery() {
    return useQuery<Post[]>({
        queryKey: ['posts'],
        queryFn: () => getAllPosts(),
        staleTime: 60_000,
    });
}
