'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getLatestPublishedPost } from '@/lib/posts';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';
import { useNotificationStateQuery } from './queries/useNotificationStateQuery';

const ANONYMOUS_NEWS_KEY = ['unread-news-anonymous'] as const;

export function useUnreadNews() {
    const { user } = useAuth();
    const queryClient = useQueryClient();
    const { data: ns } = useNotificationStateQuery();

    const anonymousQuery = useQuery({
        queryKey: ANONYMOUS_NEWS_KEY,
        queryFn: async () => {
            const latest = await getLatestPublishedPost();
            const lastReadId =
                typeof localStorage !== 'undefined'
                    ? localStorage.getItem('news_last_read')
                    : null;
            return {
                hasUnread: !!latest && latest.id !== lastReadId,
            };
        },
        enabled: !user,
        staleTime: 60_000,
    });

    const hasUnreadNews = user
        ? !!(
              ns?.latestPublishedPostId &&
              ns.latestPublishedPostId !== (ns.lastReadNewsPostId ?? null)
          )
        : (anonymousQuery.data?.hasUnread ?? false);

    const markNewsAsRead = useCallback(
        async (postId: string) => {
            if (user) {
                const token = await user.getIdToken();
                const res = await fetch(`${API_URL}/profile/news-read`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ postId }),
                });
                if (!res.ok) {
                    console.error('Failed to mark news as read:', await res.text());
                    return;
                }
                await queryClient.invalidateQueries({
                    queryKey: ['notification-state', user.uid],
                });
            } else if (typeof localStorage !== 'undefined') {
                localStorage.setItem('news_last_read', postId);
                await queryClient.invalidateQueries({ queryKey: ANONYMOUS_NEWS_KEY });
            }
        },
        [user, queryClient],
    );

    return { hasUnreadNews, markNewsAsRead };
}
