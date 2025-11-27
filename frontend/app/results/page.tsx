export default function ResultsPage() {
  // Mock data for results
  const races = [
    { id: 1, name: 'League Opener - Watopia Flat', date: '2023-10-01', winner: 'J. Doe' },
    { id: 2, name: 'Mountain Challenge - Alpe du Zwift', date: '2023-10-08', winner: 'A. Smith' },
    { id: 3, name: 'Sprint Series - Crit City ', date: '2023-10-15', winner: 'B. Johnson' },
  ];

  return (
    <div className="max-w-4xl mx-auto mt-8">
      <h1 className="text-3xl font-bold mb-8 text-slate-800">Race Results</h1>
      
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Date</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Race Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Winner</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {races.map((race) => (
              <tr key={race.id} className="hover:bg-slate-50">
                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900">{race.date}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">{race.name}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">{race.winner}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-blue-600 hover:underline cursor-pointer">
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

