export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <h1 className="text-4xl font-bold text-slate-900 mb-4">Welcome to DCU Member League</h1>
      <p className="text-xl text-slate-600 mb-8 max-w-2xl">
        The official e-cycling league for DCU members. Sign up, track your stats, and compete in races on Zwift.
      </p>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-4xl">
        <div className="p-6 border rounded-lg shadow-sm hover:shadow-md transition bg-white">
          <h2 className="text-2xl font-semibold mb-2">Sign Up</h2>
          <p className="text-slate-600 mb-4">Verify your e-license and join the league.</p>
          <a href="/signup" className="text-blue-600 hover:underline">Get Started &rarr;</a>
        </div>
        
        <div className="p-6 border rounded-lg shadow-sm hover:shadow-md transition bg-white">
          <h2 className="text-2xl font-semibold mb-2">Track Stats</h2>
          <p className="text-slate-600 mb-4">View your performance across Zwift, ZwiftPower, and Strava.</p>
          <a href="/stats" className="text-blue-600 hover:underline">View Stats &rarr;</a>
        </div>
        
        <div className="p-6 border rounded-lg shadow-sm hover:shadow-md transition bg-white">
          <h2 className="text-2xl font-semibold mb-2">Race Results</h2>
          <p className="text-slate-600 mb-4">Check the latest league standings and race outcomes.</p>
          <a href="/results" className="text-blue-600 hover:underline">See Results &rarr;</a>
        </div>
      </div>
    </div>
  );
}
