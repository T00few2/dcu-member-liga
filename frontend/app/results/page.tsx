export default function ResultsPage() {
  // Mock data for results
  const races = [
    { id: 1, name: 'League Opener - Watopia Flat', date: '2023-10-01', winner: 'J. Doe' },
    { id: 2, name: 'Mountain Challenge - Alpe du Zwift', date: '2023-10-08', winner: 'A. Smith' },
    { id: 3, name: 'Sprint Series - Crit City', date: '2023-10-15', winner: 'B. Johnson' },
  ];

  return (
    <div className="max-w-4xl mx-auto mt-8 px-4">
      <h1 className="text-3xl font-bold mb-8 text-foreground">Race Results</h1>
      
      <div className="bg-card rounded-lg shadow overflow-hidden border border-border">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Date</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Race Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Winner</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-card divide-y divide-border">
            {races.map((race) => (
              <tr key={race.id} className="hover:bg-muted/50 transition">
                <td className="px-6 py-4 whitespace-nowrap text-sm text-card-foreground">{race.date}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-card-foreground">{race.name}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">{race.winner}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-primary hover:underline cursor-pointer">
                  View Details
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

