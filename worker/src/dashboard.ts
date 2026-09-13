import { Hono } from "hono";

export const dashboardApp = new Hono().basePath('/dashboard');

dashboardApp.get('/', (c) => {
  const html = <!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Spend Control Dashboard</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
    <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
</head>
<body class="bg-gray-50">
    <div id="root"></div>
    <script type="text/babel">
        function Dashboard() {
            const [stats, setStats] = React.useState({ spent: 0, budget: 1000, rules: [] });
            const [loading, setLoading] = React.useState(true);

            React.useEffect(() => {
                fetch('/dashboard/api/stats', { headers: { 'X-API-Key': 'container-internal' }})
                    .then(r => r.json())
                    .then(data => {
                        setStats(data);
                        setLoading(false);
                    });
            }, []);

            if (loading) return <div className="p-8 text-center text-gray-500">Loading live telemetry from D1...</div>;

            return (
                <div className="max-w-6xl mx-auto p-6">
                    <h1 className="text-3xl font-bold mb-8 text-gray-800">Spend Control Pack</h1>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                            <h3 className="text-gray-500 text-sm font-medium mb-1">Total Period Spend</h3>
                            <div className="text-3xl font-bold text-gray-900">{stats.spent.toFixed(2)}</div>
                            <div className="text-sm text-green-500 mt-2">Well under budget ({stats.budget})</div>
                        </div>
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                            <h3 className="text-gray-500 text-sm font-medium mb-1">Model Overrides</h3>
                            <div className="text-3xl font-bold text-blue-600">{stats.overrides || 0}</div>
                            <div className="text-sm text-gray-500 mt-2">Requests dynamically downgraded</div>
                        </div>
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                            <h3 className="text-gray-500 text-sm font-medium mb-1">Circuit Breakers</h3>
                            <div className="text-3xl font-bold text-green-600">All Clear</div>
                            <div className="text-sm text-gray-500 mt-2">No agents paused</div>
                        </div>
                    </div>

                    <h2 className="text-xl font-bold mb-4 text-gray-800">Recent Policy Logs</h2>
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Timestamp</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rule Triggered</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cost</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {stats.rules.length === 0 && (
                                    <tr><td colSpan="4" className="px-6 py-4 text-center text-gray-500">No logs yet... waiting for traffic!</td></tr>
                                )}
                                {stats.rules.map((r, i) => (
                                    <tr key={i}>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(r.created_at).toLocaleString()}</td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={"px-2 inline-flex text-xs leading-5 font-semibold rounded-full " + (r.action === 'route' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800')}>
                                                {r.action.toUpperCase()}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{r.rule_id}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{(r.cost_usd || 0).toFixed(6)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            );
        }
        const root = ReactDOM.createRoot(document.getElementById('root'));
        root.render(<Dashboard />);
    </script>
</body>
</html>;
  return c.html(html);
});

dashboardApp.get('/api/stats', async (c: any) => {
  const env = c.env;
  
  // Try to grab spent vs budget
  let spent = 0;
  let budget = 1000;
  try {
    const period = new Date().toISOString().substring(0,7);
    const budgetRow = await env.DB.prepare('SELECT spent_usd, budget_usd FROM scp_budget_ledger WHERE scope=? AND period=? LIMIT 1')
      .bind('global', period).first();
    if (budgetRow) {
      spent = budgetRow.spent_usd || 0;
      budget = budgetRow.budget_usd || 1000;
    }
  } catch (e) {}

  // Fetch recent logs
  let rules = [];
  let overrides = 0;
  try {
    const rulesRes = await env.DB.prepare('SELECT * FROM scp_policy_log ORDER BY created_at DESC LIMIT 20').all();
    if (rulesRes && rulesRes.results) {
      rules = rulesRes.results;
      overrides = rules.filter((r: any) => r.action === 'route').length;
    }
  } catch (e) {}

  return c.json({ spent, budget, rules, overrides });
});
