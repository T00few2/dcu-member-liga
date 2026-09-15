'use client';

import { clubKitUnlockLines, type ClubKitPayload } from '@/lib/clubKitCopy';

interface ClubKitCardProps {
    clubKit?: ClubKitPayload | null;
    dropLevel?: number | null;
}

export default function ClubKitCard({ clubKit, dropLevel }: ClubKitCardProps) {
    if (!clubKit?.jerseyName) {
        return null;
    }

    const lines = clubKitUnlockLines(clubKit, dropLevel);
    const imageUrl = clubKit.imageUrl || '';

    return (
        <div className="p-4 rounded-lg border border-border bg-muted/30">
            <h3 className="text-sm font-semibold text-card-foreground mb-3">Klubtrøje</h3>
            <div className="flex gap-4 items-start">
                <div className="w-20 h-20 shrink-0 rounded-md border border-border bg-background overflow-hidden flex items-center justify-center">
                    {imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={imageUrl}
                            alt={clubKit.jerseyName}
                            className="w-full h-full object-contain"
                        />
                    ) : (
                        <span className="text-[10px] text-muted-foreground text-center px-1">Ingen visning</span>
                    )}
                </div>
                <div className="min-w-0 space-y-1">
                    <p className="font-medium text-foreground">{clubKit.jerseyName}</p>
                    {lines.map((line) => (
                        <p key={line} className="text-sm text-muted-foreground">{line}</p>
                    ))}
                </div>
            </div>
        </div>
    );
}
