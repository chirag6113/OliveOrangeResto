import "@/index.css";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import { Toaster } from "sonner";
import TableApp from "@/pages/customer/TableApp";
import Login from "@/pages/admin/Login";
import AdminLayout from "@/pages/admin/AdminLayout";
import Dashboard from "@/pages/admin/Dashboard";
import LiveOrders from "@/pages/admin/LiveOrders";
import Tables from "@/pages/admin/Tables";
import MenuManage from "@/pages/admin/MenuManage";
import Billing from "@/pages/admin/Billing";

const Landing = () => (
  <div className="min-h-screen flex flex-col items-center justify-center gap-6 px-6 text-center">
    <h1 className="font-display text-4xl sm:text-5xl font-semibold text-primary">Olive &amp; Orange Café</h1>
    <p className="text-muted-foreground max-w-md">Scan the QR code on your table to order. Staff can manage everything from the admin panel.</p>
    <Link to="/admin/login" data-testid="admin-login-link"
      className="rounded-full bg-accent text-accent-foreground px-8 py-3 font-semibold hover:opacity-90 transition-opacity">
      Staff Login
    </Link>
  </div>
);

export default function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-center" richColors />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/t/:token" element={<TableApp />} />
        <Route path="/admin/login" element={<Login />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="orders" element={<LiveOrders />} />
          <Route path="tables" element={<Tables />} />
          <Route path="menu" element={<MenuManage />} />
          <Route path="billing" element={<Billing />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
