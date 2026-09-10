import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import CategoryBoundaryEditor from '@/components/admin/category-manager/CategoryBoundaryEditor';
import type { CategoryDef } from '@/components/admin/category-manager/types';

const categories: CategoryDef[] = [
  { name: '1. Division', upper: null, requiresVerification: true, color: '#1d4ed8' },
  { name: '6. Division', upper: 500, requiresVerification: false, color: '#334155' },
];

describe('CategoryBoundaryEditor colors', () => {
  it('lets an admin change a category badge color', () => {
    const onUpdateColor = vi.fn();
    render(
      <CategoryBoundaryEditor
        categories={categories}
        riders={[]}
        onUpdateName={vi.fn()}
        onUpdateUpper={vi.fn()}
        onToggleVerification={vi.fn()}
        onUpdateColor={onUpdateColor}
        onSplit={vi.fn()}
        onMergeUp={vi.fn()}
      />,
    );

    const picker = screen.getByLabelText('Color for 6. Division');
    expect(picker).toHaveValue('#334155');
    fireEvent.change(picker, { target: { value: '#ff0000' } });
    expect(onUpdateColor).toHaveBeenCalledWith(1, '#ff0000');
  });
});
