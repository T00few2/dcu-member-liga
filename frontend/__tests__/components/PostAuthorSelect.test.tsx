import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PostAuthorSelect from '@/components/admin/PostAuthorSelect';
import { useParticipantsQuery } from '@/hooks/queries';

vi.mock('@/hooks/queries', () => ({
    useParticipantsQuery: vi.fn(),
}));

const poster = { authorName: 'Anna Hansen', authorZwiftId: '111' };

describe('PostAuthorSelect', () => {
    beforeEach(() => {
        vi.mocked(useParticipantsQuery).mockReturnValue({
            data: [
                { name: 'Anna Hansen', zwiftId: '111', club: 'Club A' },
                { name: 'Bo Nielsen', zwiftId: '222', club: 'Club B' },
            ],
            isLoading: false,
        } as ReturnType<typeof useParticipantsQuery>);
    });

    it('defaults the closed label to the signed-in poster', () => {
        render(
            <PostAuthorSelect
                poster={poster}
                value={poster}
                onChange={vi.fn()}
            />,
        );
        expect(screen.getByRole('button', { name: 'Forfatter: Anna Hansen' })).toBeInTheDocument();
        expect(screen.queryByText('Mig')).not.toBeInTheDocument();
    });

    it('lets the poster pick another deltager as byline', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(
            <PostAuthorSelect
                poster={poster}
                value={poster}
                onChange={onChange}
            />,
        );

        await user.click(screen.getByRole('button', { name: 'Forfatter: Anna Hansen' }));
        expect(screen.getByText('Aktuel bruger')).toBeInTheDocument();
        await user.click(screen.getByRole('option', { name: /Bo Nielsen/ }));
        expect(onChange).toHaveBeenCalledWith({ authorName: 'Bo Nielsen', authorZwiftId: '222' });
    });
});
