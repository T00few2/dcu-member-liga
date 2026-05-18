import { describe, it, expect } from 'vitest';
import { sortCategoriesByRank } from '@/lib/categories';

describe('sortCategoriesByRank', () => {
    it('sorts categories matching rank order', () => {
        const result = sortCategoriesByRank(['C', 'A', 'B'], ['A', 'B', 'C']);
        expect(result).toEqual(['A', 'B', 'C']);
    });

    it('places ranked categories before unranked ones', () => {
        const result = sortCategoriesByRank(['Z', 'A', 'B'], ['A', 'B']);
        expect(result).toEqual(['A', 'B', 'Z']);
    });

    it('sorts multiple unranked categories alphabetically', () => {
        const result = sortCategoriesByRank(['Z', 'M', 'A', 'B'], ['A', 'B']);
        expect(result).toEqual(['A', 'B', 'M', 'Z']);
    });

    it('is case-insensitive when matching rank order', () => {
        const result = sortCategoriesByRank(['c', 'a', 'b'], ['A', 'B', 'C']);
        expect(result).toEqual(['a', 'b', 'c']);
    });

    it('returns empty array for empty input', () => {
        expect(sortCategoriesByRank([], ['A', 'B'])).toEqual([]);
    });

    it('sorts alphabetically when no rank order provided', () => {
        const result = sortCategoriesByRank(['C', 'A', 'B'], []);
        expect(result).toEqual(['A', 'B', 'C']);
    });

    it('does not mutate the original array', () => {
        const categories = ['C', 'A', 'B'];
        sortCategoriesByRank(categories, ['A', 'B', 'C']);
        expect(categories).toEqual(['C', 'A', 'B']);
    });

    it('ignores duplicate entries in rank order', () => {
        const result = sortCategoriesByRank(['B', 'A'], ['A', 'A', 'B']);
        expect(result).toEqual(['A', 'B']);
    });

    it('handles whitespace in rank order keys', () => {
        const result = sortCategoriesByRank(['B', 'A'], [' A ', ' B ']);
        expect(result).toEqual(['A', 'B']);
    });
});
