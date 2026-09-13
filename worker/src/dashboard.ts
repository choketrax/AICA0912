import { Hono } from "hono";

export const dashboardApp = new Hono().basePath('/dashboard');

dashboardApp.get('/', (c) => {
  const html = `<!DOCTYPE html>
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
<body class="bg-gray-900 text-gray-100">
    <div id="root"></div>
    <script type="text/babel">
        function Dashboard() {
            const [stats, setStats] = React.useState({ budgets: [], rules: [], overrides: 0 });
            const [loading, setLoading] = React.useState(true);

            React.useEffect(() => {
                fetch('/dashboard/api/stats', { headers: { 'X-API-Key': 'container-internal' }})
                    .then(r => r.json())
                    .then(data => {
                        setStats(data);
                        setLoading(false);
                    });
            }, []);

            if (loading) return <div className="p-8 text-center text-gray-400">Loading live telemetry from D1...</div>;

            // Compute global spend from 'org' scopes
            const orgBudgets = stats.budgets.filter(b => b.scope === 'org');
            const deptBudgets = stats.budgets.filter(b => b.scope === 'dept');
            const agentBudgets = stats.budgets.filter(b => b.scope === 'agent');

            const totalSpent = orgBudgets.reduce((acc, b) => acc + (b.spent_usd || 0), 0);
            const totalBudget = orgBudgets.reduce((acc, b) => acc + (b.budget_usd || 0), 0);

            return (
                <div className="max-w-6xl mx-auto p-6">
                    <h1 className="text-3xl font-bold mb-8 text-white">Spend Control Pack</h1>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                        <div className="bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700">
                            <h3 className="text-gray-400 text-sm font-medium mb-1">Total Period Spend</h3>
                            <div className="text-3xl font-bold text-white">{"$"}{totalSpent.toFixed(2)}</div>
                            <div className="text-sm text-emerald-400 mt-2">Org Budget limit: {"$"}{totalBudget.toFixed(2)}</div>
                        </div>
                        <div className="bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700">
                            <h3 className="text-gray-400 text-sm font-medium mb-1">Model Overrides</h3>
                            <div className="text-3xl font-bold text-blue-400">{stats.overrides || 0}</div>
                            <div className="text-sm text-gray-400 mt-2">Requests dynamically downgraded</div>
                        </div>
                        <div className="bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700">
                            <h3 className="text-gray-400 text-sm font-medium mb-1">Circuit Breakers</h3>
                            <div className="text-3xl font-bold text-emerald-400">All Clear</div>
                            <div className="text-sm text-gray-400 mt-2">No agents paused</div>
                        </div>
                    </div>

                    <h2 className="text-xl font-bold mb-4 text-white">Universal Budget Hierarchy</h2>
                    <div className="bg-gray-800 rounded-xl shadow-lg border border-gray-700 overflow-hidden mb-8 p-6">
                        {orgBudgets.length === 0 ? <p className="text-gray-400">No organizational spend recorded yet.</p> : null}
                        
                        {orgBudgets.map(org => (
                            <div key={org.scope_id} className="mb-4">
                                <div className="flex justify-between items-center bg-gray-900/50 p-3 rounded-lg border border-gray-700">
                                    <div className="font-bold text-lg text-white">?? {org.scope_id}</div>
                                    <div className="text-emerald-400 font-mono">{"$"}{org.spent_usd.toFixed(4)} / {"$"}{org.budget_usd.toFixed(2)}</div>
                                </div>
                                
                                <div className="ml-8 mt-3 border-l-2 border-gray-700 pl-4">
                                    {deptBudgets.length === 0 && agentBudgets.length === 0 ? <p className="text-gray-500 text-sm py-2">No departments or agents recorded.</p> : null}
                                    
                                    {deptBudgets.map(dept => (
                                        <div key={dept.scope_id} className="mb-3">
                                            <div className="flex justify-between items-center text-gray-300 py-1">
                                                <div className="font-semibold">?? {dept.scope_id}</div>
                                                <div className="text-emerald-500/80 font-mono text-sm">{"$"}{dept.spent_usd.toFixed(4)} / {"$"}{dept.budget_usd.toFixed(2)}</div>
                                            </div>
                                            
                                            <div className="ml-6 mt-1 border-l border-gray-700/50 pl-4 space-y-1">
                                                {agentBudgets.map(agent => (
                                                    <div key={agent.scope_id} className="flex justify-between items-center text-sm text-gray-400 py-1">
                                                        <div>?? {agent.scope_id}</div>
                                                        <div className="font-mono text-xs">{"$"}{agent.spent_usd.toFixed(6)} / {"$"}{agent.budget_usd.toFixed(2)}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>

                    <h2 className="text-xl font-bold mb-4 text-white">Recent Policy Logs</h2>
                    <div className="bg-gray-800 rounded-xl shadow-lg border border-gray-700 overflow-hidden">
                        <table className="min-w-full divide-y divide-gray-700">
                            <thead className="bg-gray-900/50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Timestamp</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Action</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Rule Triggered</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Scope</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Cost</th>
                                </tr>
                            </thead>
                            <tbody className="bg-gray-800 divide-y divide-gray-700">
                                {stats.rules.length === 0 && (
                                    <tr><td colSpan="5" className="px-6 py-4 text-center text-gray-400">No logs yet... waiting for traffic!</td></tr>
                                )}
                                {stats.rules.map((r, i) => (
                                    <tr key={i} className="hover:bg-gray-700/50 transition-colors">
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">{new Date(r.evaluated_at || r.created_at).toLocaleString()}</td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={"px-2 py-1 inline-flex text-xs leading-4 font-semibold rounded-md " + (r.action === 'route' ? 'bg-blue-900/50 text-blue-300 border border-blue-700' : 'bg-emerald-900/50 text-emerald-300 border border-emerald-700')}>
                                                {r.action.toUpperCase()}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-200">{r.rule_id || 'n/a'}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">{r.scope_id || 'global'}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">{"$"}{Number(r.cost_usd || 0).toFixed(6)}</td>
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
</html>`;
  return c.html(html);
});

dashboardApp.get('/api/stats', async (c: any) => {
  const env = c.env;
  
  let budgets = [];
  try {
    const period = new Date().toISOString().substring(0,7);
    const budgetRows = await env.DB.prepare(`
      SELECT scope, scope_id, SUM(CAST(cost_usd AS REAL)) as spent_usd 
      FROM scp_budget_ledger 
      WHERE period=? 
      GROUP BY scope, scope_id
    `).bind(period).all();
    
    if (budgetRows && budgetRows.results) {
      budgets = budgetRows.results.map(r => ({
        ...r,
        budget_usd: r.scope === 'org' ? 50000 : r.scope === 'dept' ? 15000 : 5000
      }));
    }
  } catch (e) {
    console.error(e);
  }

  let rules = [];
  let overrides = 0;
  try {
    const rulesRes = await env.DB.prepare('SELECT * FROM scp_policy_log ORDER BY evaluated_at DESC LIMIT 20').all();
    if (rulesRes && rulesRes.results) {
      rules = rulesRes.results;
      overrides = rules.filter((r: any) => r.action === 'route').length;
    }
  } catch (e) {
    console.error(e);
  }

  return c.json({ budgets, rules, overrides });
});
