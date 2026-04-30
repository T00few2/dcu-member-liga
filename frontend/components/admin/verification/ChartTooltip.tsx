const VISIBLE_KEYS = new Set([
    'maxPower', 'highlightedPower', 'watts', 'cadence',
    'power', 'hr', 'weight', 'height', 'altitude',
    'racePower', 'stravaPower',
]);

export default function ChartTooltip({ active, payload, label }: any) {
    if (!active || !payload?.length) return null;
    const visible = payload.filter((p: any) => VISIBLE_KEYS.has(p.dataKey));
    if (visible.length === 0) return null;
    return (
        <div className="bg-card p-2 border border-border rounded shadow text-sm z-50">
            <p className="font-bold mb-1">{label}</p>
            {visible.map((p: any) => (
                <p key={p.name} style={{ color: p.color }}>
                    {p.name}: {p.value} {p.unit}
                </p>
            ))}
            {visible[0]?.payload?.title && (
                <p className="text-xs text-muted-foreground mt-1 max-w-[200px] truncate">
                    {visible[0].payload.title}
                </p>
            )}
        </div>
    );
}
