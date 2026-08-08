import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LayoutDashboard, ReceiptText, Armchair, BookOpenText, IndianRupee, LogOut } from "lucide-react";
import { staffApi, WS_BASE } from "@/api";

const NAV = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/admin/orders", label: "Live Orders", icon: ReceiptText },
  { to: "/admin/tables", label: "Tables", icon: Armchair },
  { to: "/admin/menu", label: "Menu", icon: BookOpenText },
  { to: "/admin/billing", label: "Billing", icon: IndianRupee },
];

export const useCafeWS = (onMessage) => {
  useEffect(() => {
    const user = JSON.parse(localStorage.getItem("staff_user") || "null");
    if (!user) return;
    let ws, closed = false;
    const connect = () => {
      ws = new WebSocket(`${WS_BASE}/cafe/${user.cafe_id}`);
      ws.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch {} };
      ws.onclose = () => { if (!closed) setTimeout(connect, 3000); };
    };
    connect();
    return () => { closed = true; ws && ws.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
};

export default function AdminLayout() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const user = JSON.parse(localStorage.getItem("staff_user") || "null");

  useEffect(() => {
    const token = localStorage.getItem("staff_token");
    if (!token) { navigate("/admin/login", { replace: true }); return; }
    staffApi().get("/auth/me")
      .then(({ data }) => { localStorage.setItem("staff_user", JSON.stringify(data)); setReady(true); })
      .catch(() => { localStorage.removeItem("staff_token"); navigate("/admin/login", { replace: true }); });
  }, [navigate]);

  if (!ready) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;

  const logout = () => {
    localStorage.removeItem("staff_token");
    localStorage.removeItem("staff_user");
    navigate("/admin/login", { replace: true });
  };

  return (
    <div className="min-h-screen flex" data-testid="admin-panel">
      <aside className="w-56 shrink-0 bg-[#2e3419] text-[#f2ecd9] flex flex-col fixed inset-y-0">
        <div className="px-5 py-6">
          <div className="font-display text-xl font-semibold leading-tight">Olive &amp; Orange</div>
          <div className="text-xs opacity-60 mt-1">Café Admin</div>
        </div>
        <nav className="flex-1 px-3 space-y-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} data-testid={`nav-${label.toLowerCase().replace(/\s/g, "-")}`}
              className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${isActive ? "bg-accent text-white" : "hover:bg-white/10"}`}>
              <Icon size={17} /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-5 py-4 border-t border-white/10">
          <div className="text-sm font-medium" data-testid="staff-name">{user?.name}</div>
          <div className="text-xs opacity-60 capitalize" data-testid="staff-role">{user?.role}</div>
          <button onClick={logout} data-testid="logout-button"
            className="mt-3 flex items-center gap-2 text-xs opacity-70 hover:opacity-100 transition-opacity">
            <LogOut size={14} /> Logout
          </button>
        </div>
      </aside>
      <main className="flex-1 ml-56 p-8 min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
