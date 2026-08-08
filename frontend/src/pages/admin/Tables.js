import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { staffApi, fmt, TABLE_COLORS } from "@/api";
import { useCafeWS } from "./AdminLayout";

export default function Tables() {
  const [tables, setTables] = useState([]);
  const [newName, setNewName] = useState("");

  const load = useCallback(() => staffApi().get("/admin/tables").then(({ data }) => setTables(data)).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  useCafeWS(load);

  const addTable = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      await staffApi().post("/admin/tables", { name: newName.trim() });
      setNewName(""); toast.success("Table added"); load();
    } catch (err) { toast.error(err.response?.data?.detail || "Failed"); }
  };

  const toggleMaintenance = async (t) => {
    const status = t.status === "MAINTENANCE" ? "AVAILABLE" : "MAINTENANCE";
    try { await staffApi().patch(`/admin/tables/${t.id}`, { status }); load(); }
    catch (err) { toast.error(err.response?.data?.detail || "Failed"); }
  };

  const closeSession = async (t) => {
    try { await staffApi().post(`/admin/sessions/${t.session.id}/close`); toast.success("Session closed"); load(); }
    catch (err) { toast.error(err.response?.data?.detail || "Failed"); }
  };

  const copyLink = (t) => {
    navigator.clipboard.writeText(`${window.location.origin}/t/${t.qr_token}`);
    toast.success("QR link copied");
  };

  return (
    <div className="space-y-6 fade-in" data-testid="tables-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <h1 className="font-display text-3xl font-semibold text-primary">Table Map</h1>
        <form onSubmit={addTable} className="flex gap-2">
          <input data-testid="new-table-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Table name (e.g. T7)"
            className="rounded-lg border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent" />
          <button data-testid="add-table-button" className="rounded-full bg-primary text-primary-foreground text-sm font-semibold px-5 py-2">Add Table</button>
        </form>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {tables.map((t) => (
          <div key={t.id} data-testid={`table-card-${t.name}`} className={`border-l-4 rounded-xl border p-4 space-y-3 bg-card ${TABLE_COLORS[t.status] || ""}`}>
            <div className="flex justify-between items-center">
              <span className="font-display text-xl font-semibold">{t.name}</span>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-white/70 border" data-testid={`table-status-${t.name}`}>
                {t.status.replace(/_/g, " ")}
              </span>
            </div>
            {t.status === "MAINTENANCE" ? (
              <div className="text-sm text-muted-foreground">Under maintenance — QR blocked for customers</div>
            ) : t.session ? (
              <div className="text-sm space-y-1">
                <div>Session: <span className="font-medium">{t.session.status.replace(/_/g, " ")}</span></div>
                <div>Running total: <span className="font-semibold">{fmt(t.running_total || 0)}</span></div>
                {t.session.status === "ACTIVE" && (
                  <button data-testid={`close-session-${t.name}`} onClick={() => closeSession(t)}
                    className="text-xs text-red-700 underline">Close session (no bill)</button>
                )}
              </div>
            ) : <div className="text-sm text-muted-foreground">No active session</div>}
            <div className="flex gap-2">
              <button data-testid={`copy-qr-${t.name}`} onClick={() => copyLink(t)}
                className="flex-1 rounded-full bg-accent text-accent-foreground text-xs font-semibold py-2 hover:opacity-90">Copy QR Link</button>
              <button data-testid={`maintenance-${t.name}`} onClick={() => toggleMaintenance(t)}
                className="flex-1 rounded-full border text-xs font-medium py-2 hover:bg-secondary">
                {t.status === "MAINTENANCE" ? "Reopen" : "Maintenance"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
