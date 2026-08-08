import { useEffect, useState, useCallback } from "react";
import { staffApi, fmt } from "@/api";
import { useCafeWS } from "./AdminLayout";

export default function Dashboard() {
  const [data, setData] = useState(null);
  const load = useCallback(() => staffApi().get("/admin/dashboard").then(({ data }) => setData(data)).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  useCafeWS(load);

  if (!data) return <div className="text-muted-foreground">Loading dashboard…</div>;

  const stats = [
    { label: "Today's Sales", value: fmt(data.today_sales), id: "today-sales" },
    { label: "Bills Paid Today", value: data.orders_today, id: "orders-today" },
    { label: "Avg Order Value", value: fmt(data.aov), id: "aov" },
    { label: "Active Tables", value: data.active_tables, id: "active-tables" },
    { label: "Pending Orders", value: data.pending_orders, id: "pending-orders" },
    { label: "Pending Bills", value: data.pending_bills, id: "pending-bills" },
  ];

  return (
    <div className="space-y-8 fade-in" data-testid="dashboard">
      <h1 className="font-display text-3xl font-semibold text-primary">Dashboard</h1>
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {stats.map((s) => (
          <div key={s.id} data-testid={`stat-${s.id}`} className="bg-card border rounded-xl p-4">
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className="text-2xl font-semibold mt-1">{s.value}</div>
          </div>
        ))}
      </div>
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="bg-card border rounded-xl p-5">
          <h2 className="font-display text-lg font-semibold mb-3">Payment Mix (Today)</h2>
          {Object.keys(data.payment_mix).length === 0 && <p className="text-sm text-muted-foreground">No payments yet today.</p>}
          <div className="space-y-2">
            {Object.entries(data.payment_mix).map(([m, v]) => (
              <div key={m} className="flex justify-between text-sm" data-testid={`paymix-${m}`}>
                <span className="uppercase font-medium">{m}</span><span>{fmt(v)}</span>
              </div>
            ))}
          </div>
          <h2 className="font-display text-lg font-semibold mt-6 mb-3">Best Sellers</h2>
          {data.best_sellers.length === 0 && <p className="text-sm text-muted-foreground">No sales data yet.</p>}
          <div className="space-y-2">
            {data.best_sellers.map((b) => (
              <div key={b.name} className="flex justify-between text-sm"><span>{b.name}</span><span className="text-muted-foreground">×{b.qty}</span></div>
            ))}
          </div>
        </div>
        <div className="bg-card border rounded-xl p-5">
          <h2 className="font-display text-lg font-semibold mb-3">Recent Orders</h2>
          <div className="space-y-2">
            {data.recent_orders.map((o) => (
              <div key={o.id} className="flex justify-between items-center text-sm border-b last:border-0 pb-2">
                <span>#{o.order_no} · {o.items.reduce((a, i) => a + i.qty, 0)} items</span>
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-secondary">{o.status}</span>
              </div>
            ))}
            {data.recent_orders.length === 0 && <p className="text-sm text-muted-foreground">No orders yet.</p>}
          </div>
        </div>
        <div className="bg-card border rounded-xl p-5" data-testid="audit-log">
          <h2 className="font-display text-lg font-semibold mb-3">Audit Log</h2>
          <div className="space-y-2 max-h-72 overflow-auto">
            {data.audit_logs.map((a) => (
              <div key={a.id} className="text-xs border-b last:border-0 pb-2">
                <span className="font-medium">{a.user_name}</span> · {a.action}
                <div className="text-muted-foreground">{new Date(a.at).toLocaleString()}</div>
              </div>
            ))}
            {data.audit_logs.length === 0 && <p className="text-sm text-muted-foreground">No activity yet.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
