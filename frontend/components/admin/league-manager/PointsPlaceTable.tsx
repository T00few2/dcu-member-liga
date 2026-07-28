'use client';

export type PointsPlaceColumn = {
    key: string;
    label: string;
    values: number[];
};

type Props = {
    columns: PointsPlaceColumn[];
    onChange?: (columnKey: string, placeIndex: number, value: number | null) => void;
    onAddPlace?: () => void;
    placeLabel?: string;
    readOnly?: boolean;
};

function cellDisplay(values: number[], placeIndex: number): string {
    if (placeIndex >= values.length) return '';
    const v = values[placeIndex];
    return v == null || Number.isNaN(v) ? '' : String(v);
}

export default function PointsPlaceTable({
    columns,
    onChange,
    onAddPlace,
    placeLabel = 'Placering',
    readOnly = false,
}: Props) {
    const rowCount = Math.max(0, ...columns.map((c) => c.values.length));

    return (
        <div className="space-y-3">
            <div className="overflow-x-auto border border-border rounded-lg">
                <table className="w-full text-sm whitespace-nowrap">
                    <thead className="bg-muted/40 border-b border-border">
                        <tr>
                            <th className="px-3 py-2 text-left font-medium text-muted-foreground w-24 sticky left-0 bg-muted/40">
                                {placeLabel}
                            </th>
                            {columns.map((col) => (
                                <th
                                    key={col.key}
                                    className="px-2 py-2 text-center font-medium text-card-foreground min-w-[6.5rem]"
                                >
                                    {col.label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {rowCount === 0 ? (
                            <tr>
                                <td
                                    colSpan={columns.length + 1}
                                    className="px-3 py-6 text-center text-muted-foreground"
                                >
                                    {readOnly ? 'Ingen pointskalaer endnu.' : 'No places yet — add a place or use the Points Generator.'}
                                </td>
                            </tr>
                        ) : (
                            Array.from({ length: rowCount }, (_, i) => (
                                <tr key={i} className="odd:bg-transparent even:bg-muted/10">
                                    <td className="px-3 py-1.5 font-medium text-muted-foreground sticky left-0 bg-card">
                                        {i + 1}
                                    </td>
                                    {columns.map((col) => (
                                        <td key={col.key} className="px-1.5 py-1">
                                            {readOnly ? (
                                                <div className="w-full min-w-[4.5rem] px-2 py-1 text-center font-mono text-sm text-foreground">
                                                    {cellDisplay(col.values, i) || '—'}
                                                </div>
                                            ) : (
                                                <input
                                                    type="number"
                                                    value={cellDisplay(col.values, i)}
                                                    onChange={(e) => {
                                                        const raw = e.target.value.trim();
                                                        if (raw === '') {
                                                            onChange?.(col.key, i, null);
                                                            return;
                                                        }
                                                        const n = parseInt(raw, 10);
                                                        onChange?.(col.key, i, Number.isNaN(n) ? null : n);
                                                    }}
                                                    className="w-full min-w-[4.5rem] px-2 py-1 border border-input rounded bg-background text-foreground text-center font-mono text-sm"
                                                />
                                            )}
                                        </td>
                                    ))}
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
            {!readOnly && onAddPlace && (
                <button
                    type="button"
                    onClick={onAddPlace}
                    className="text-sm px-3 py-1.5 border border-input rounded hover:bg-muted"
                >
                    Add place
                </button>
            )}
        </div>
    );
}
