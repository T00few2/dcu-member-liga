export const DR_FAILURE_LABELS: Record<string, string> = {
    w1200: '20 min diff above 5%',
    w300: '5 min diff above 5.5%',
    w60: '1 min diff above 6%',
    w15: '15 sec diff above 6.5%',
    similarity_mean_abs: 'Similarity check: mean |diff| too low',
    similarity_std_diff: 'Similarity check: std(diff) too low',
    similarity_std_delta: 'Similarity check: std(Δdiff) too low',
};

export function explainDrFailureMetrics(metrics: string[] | undefined): string[] {
    if (!metrics || metrics.length === 0) return [];
    return metrics.map((m) => DR_FAILURE_LABELS[m] || m);
}
