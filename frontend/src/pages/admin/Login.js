import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { staffApi } from "@/api";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (localStorage.getItem("staff_token")) navigate("/admin", { replace: true });
  }, [navigate]);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await staffApi().post("/auth/login", { email, password });
      localStorage.setItem("staff_token", data.token);
      localStorage.setItem("staff_user", JSON.stringify(data.user));
      toast.success(`Welcome, ${data.user.name}`);
      navigate("/admin", { replace: true });
    } catch (err) {
      const d = err.response?.data?.detail;
      setError(typeof d === "string" ? d : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={submit} data-testid="login-form"
        className="w-full max-w-sm bg-card rounded-2xl border p-8 shadow-sm space-y-5 fade-in">
        <div>
          <h1 className="font-display text-3xl font-semibold text-primary">Staff Login</h1>
          <p className="text-sm text-muted-foreground mt-1">Olive &amp; Orange Café — Admin Panel</p>
        </div>
        {error && <div data-testid="login-error" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
        <div className="space-y-1">
          <label className="text-sm font-medium">Email</label>
          <input data-testid="login-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border bg-background px-3 py-2.5 outline-none focus:ring-2 focus:ring-accent" placeholder="you@cafe.com" />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Password</label>
          <input data-testid="login-password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border bg-background px-3 py-2.5 outline-none focus:ring-2 focus:ring-accent" placeholder="••••••••" />
        </div>
        <button data-testid="login-submit" disabled={loading}
          className="w-full rounded-full bg-primary text-primary-foreground py-3 font-semibold hover:opacity-90 transition-opacity disabled:opacity-50">
          {loading ? "Signing in…" : "Sign In"}
        </button>
      </form>
    </div>
  );
}
