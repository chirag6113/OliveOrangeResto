import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { staffApi, fmt, STATUS_COLORS } from "@/api";
import { useCafeWS } from "./AdminLayout";

const TABS = ["PLACED", "ACCEPTED", "PREPARING", "READY", "SERVED", "COMPLETED", "REJECTED"];
const NEXT = { PLACED: [["accept", "Accept"]], ACCEPTED: [["preparing", "Start Preparing"]], PREPARING: [["ready", "Mark Ready"]], READY: [["served", "Mark Served"]] };

export default function LiveOrders() {
  const [tab, setTab] = useState("PLACED");
  const [orders, setOrders] = useState([]);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState("");

  const load = useCallback(() => {
    staffApi().get(`/admin/orders?status=${tab}`).then(({ data }) => setOrders(data)).catch(() => {});
  }, [tab]);
  useEffect(() => { load(); }, [load]);
  useCafeWS(load);

  const act = async (orderId, action, rsn) => {
    try {
      await staffApi().patch(`/admin/orders/${orderId}`, { action, reason: rsn });
      toast.success(`Order ${action}ed`);
      setRejecting(null); setReason("");
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Action failed");
    }
  };

  return (
    <div className="space-y-6 fade-in" data-testid="live-orders">
      <h1 className="font-display text-3xl font-semibold text-primary">Live Orders</h1>
      <div className="flex gap-2 flex-wrap">
        {TABS.map((t) => (
          <button key={t} data-testid={`tab-${t.toLowerCase()}`} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${tab === t ? "bg-primary text-primary-foreground" : "bg-card border hover:bg-secondary"}`}>
            {t}
          </button>
        ))}
      </div>
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {orders.map((o) => (
          <div key={o.id} data-testid={`order-card-${o.order_no}`} className="bg-card border rounded-xl p-4 space-y-3">
            <div className="flex justify-between items-start">
              <div>
                <div className="font-semibold">Order #{o.order_no} <span className="text-muted-foreground font-normal">· {o.table_name}</span></div>
                <div className="text-xs text-muted-foreground">{new Date(o.created_at).toLocaleTimeString()}</div>
              </div>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_COLORS[o.status]}`}>{o.status}</span>
            </div>
            <ul className="text-sm space-y-1">
              {o.items.map((i, idx) => (
                <li key={idx} className="flex justify-between">
                  <span>{i.qty}× {i.name}{i.addons.length > 0 && <span className="text-muted-foreground"> (+{i.addons.map((a) => a.name).join(", ")})</span>}</span>
                  <span>{fmt(i.line_total)}</span>
                </li>
              ))}
            </ul>
            {o.note && <div className="text-xs bg-secondary rounded-lg px-2 py-1">Note: {o.note}</div>}
            {o.reject_reason && <div className="text-xs text-red-700">Reason: {o.reject_reason}</div>}
            <div className="flex justify-between font-semibold text-sm border-t pt-2"><span>Total</span><span>{fmt(o.total)}</span></div>
            <div className="flex gap-2 flex-wrap">
              {(NEXT[o.status] || []).map(([action, label]) => (
                <button key={action} data-testid={`order-${o.order_no}-${action}`} onClick={() => act(o.id, action)}
                  className="flex-1 rounded-full bg-accent text-accent-foreground text-sm font-semibold py-2 hover:opacity-90 transition-opacity">
                  {label}
                </button>
              ))}
              {o.status === "PLACED" && (
                rejecting === o.id ? (
                  <div className="w-full flex gap-2">
                    <input data-testid={`order-${o.order_no}-reject-reason`} value={reason} onChange={(e) => setReason(e.target.value)}
                      placeholder="Reject reason" className="flex-1 rounded-lg border px-3 py-1.5 text-sm bg-background" />
                    <button data-testid={`order-${o.order_no}-reject-confirm`} onClick={() => act(o.id, "reject", reason)}
                      className="rounded-full bg-red-600 text-white text-sm px-4 py-1.5">Confirm</button>
                  </div>
                ) : (
                  <button data-testid={`order-${o.order_no}-reject`} onClick={() => setRejecting(o.id)}
                    className="rounded-full border border-red-300 text-red-700 text-sm font-medium px-4 py-2 hover:bg-red-50">
                    Reject
                  </button>
                )
              )}
            </div>
          </div>
        ))}
        {orders.length === 0 && <p className="text-muted-foreground col-span-full" data-testid="no-orders">No {tab.toLowerCase()} orders.</p>}
      </div>
    </div>
  );
}
