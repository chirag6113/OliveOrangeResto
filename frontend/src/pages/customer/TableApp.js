import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import { ShoppingBag, Plus, Minus, X } from "lucide-react";
import { API, WS_BASE, fmt, STATUS_COLORS } from "@/api";

const SESSION_KEY = (token) => `cafe_session_${token}`;

export default function TableApp() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [menu, setMenu] = useState([]);
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("menu");
  const [activeCat, setActiveCat] = useState("");
  const [cart, setCart] = useState([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [customizing, setCustomizing] = useState(null);
  const [pickedAddons, setPickedAddons] = useState([]);
  const [name, setName] = useState("");
  const [placing, setPlacing] = useState(false);
  const idemKey = useRef(null);
  const sessionToken = info?.session?.token;

  const loadState = useCallback(() => {
    if (!sessionToken) return;
    axios.get(`${API}/public/session/${sessionToken}`).then(({ data }) => setState(data)).catch(() => {});
  }, [sessionToken]);

  useEffect(() => {
    const saved = localStorage.getItem(SESSION_KEY(token));
    axios.get(`${API}/public/table/${token}`, { params: saved ? { session_token: saved } : {} })
      .then(({ data }) => {
        setInfo(data);
        localStorage.setItem(SESSION_KEY(token), data.session.token);
        if (data.session.customer_name) setName(data.session.customer_name);
        return axios.get(`${API}/public/menu/${token}`);
      })
      .then(({ data }) => setMenu(data.categories))
      .catch((e) => setError(e.response?.data?.detail || "Invalid QR code"));
  }, [token]);

  useEffect(() => { loadState(); }, [loadState]);

  useEffect(() => {
    if (!sessionToken) return;
    let ws, closed = false;
    const connect = () => {
      ws = new WebSocket(`${WS_BASE}/session/${sessionToken}`);
      ws.onmessage = () => loadState();
      ws.onclose = () => { if (!closed) setTimeout(connect, 3000); };
    };
    connect();
    const poll = setInterval(loadState, 25000);
    return () => { closed = true; clearInterval(poll); ws && ws.close(); };
  }, [sessionToken, loadState]);

  const cartTotal = useMemo(() => cart.reduce((a, l) => {
    const addonSum = l.addons.reduce((x, ad) => x + ad.price, 0);
    return a + (l.item.price + addonSum) * l.qty;
  }, 0), [cart]);

  const addToCart = (item, addons = []) => {
    const key = item.id + "|" + addons.map((a) => a.id).sort().join(",");
    setCart((c) => {
      const ex = c.find((l) => l.key === key);
      if (ex) return c.map((l) => l.key === key ? { ...l, qty: l.qty + 1 } : l);
      return [...c, { key, item, addons, qty: 1 }];
    });
    setCustomizing(null); setPickedAddons([]);
    toast.success(`${item.name} added`);
  };

  const changeQty = (key, delta) => {
    setCart((c) => c.map((l) => l.key === key ? { ...l, qty: l.qty + delta } : l).filter((l) => l.qty > 0));
  };

  const placeOrder = async () => {
    if (!idemKey.current) idemKey.current = crypto.randomUUID();
    setPlacing(true);
    try {
      if (name.trim()) axios.post(`${API}/public/session/${sessionToken}/profile`, { name: name.trim() }).catch(() => {});
      await axios.post(`${API}/public/orders`, {
        session_token: sessionToken, idempotency_key: idemKey.current,
        items: cart.map((l) => ({ item_id: l.item.id, qty: l.qty, addon_ids: l.addons.map((a) => a.id) })),
      });
      setCart([]); setCartOpen(false); idemKey.current = null;
      toast.success("Order placed!");
      setTab("orders"); loadState();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not place order");
    } finally { setPlacing(false); }
  };

  const requestBill = async () => {
    try {
      await axios.post(`${API}/public/session/${sessionToken}/request-bill`);
      toast.success("Bill requested — staff will lock it shortly");
      loadState();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const choosePayment = async (method) => {
    await axios.post(`${API}/public/session/${sessionToken}/payment-method`, { method }).catch(() => {});
    toast.success(`Payment method: ${method.toUpperCase()}`);
    loadState();
  };

  if (error) return (
    <div className="min-h-screen flex items-center justify-center px-6 text-center">
      <div><h1 className="font-display text-2xl font-semibold text-primary" data-testid="qr-error">{error}</h1>
      <p className="text-muted-foreground mt-2 text-sm">Please ask the staff for help.</p></div>
    </div>
  );
  if (!info) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Opening your table…</div>;

  const bill = state?.bill;
  const orders = state?.orders || [];
  const canOrder = state?.session?.status === "ACTIVE";

  return (
    <div className="min-h-screen pb-24 max-w-lg mx-auto" data-testid="customer-app">
      <header className="sticky top-0 z-20 bg-[#2e3419] text-[#f2ecd9] px-5 py-4 rounded-b-2xl">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="font-display text-xl font-semibold" data-testid="cafe-name">{info.cafe.name}</h1>
            <div className="text-xs opacity-70">Table <span className="font-semibold" data-testid="table-name">{info.table.name}</span></div>
          </div>
          {state && <span className="text-xs bg-white/15 rounded-full px-3 py-1" data-testid="session-status">{state.session.status.replace(/_/g, " ")}</span>}
        </div>
        <div className="flex gap-2 mt-3">
          {[["menu", "Menu"], ["orders", `Orders${orders.length ? ` (${orders.length})` : ""}`], ["bill", "Bill"]].map(([t, label]) => (
            <button key={t} data-testid={`customer-tab-${t}`} onClick={() => setTab(t)}
              className={`flex-1 rounded-full text-sm py-2 font-medium transition-colors ${tab === t ? "bg-accent text-white" : "bg-white/10"}`}>
              {label}
            </button>
          ))}
        </div>
      </header>

      {tab === "menu" && (
        <div className="px-4 pt-4 space-y-5">
          <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
            {menu.map((c) => (
              <button key={c.id} data-testid={`cat-${c.name}`} onClick={() => setActiveCat(c.id === activeCat ? "" : c.id)}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium border transition-colors ${activeCat === c.id ? "bg-primary text-primary-foreground" : "bg-card"}`}>
                {c.name}
              </button>
            ))}
          </div>
          {menu.filter((c) => !activeCat || c.id === activeCat).map((c) => (
            <div key={c.id} className="space-y-3">
              <h2 className="font-display text-lg font-semibold">{c.name}</h2>
              {c.items.map((i) => (
                <div key={i.id} data-testid={`menu-item-${i.name.replace(/\s/g, "-")}`} className={`bg-card border rounded-2xl p-3 flex gap-3 ${!i.available ? "opacity-50" : ""}`}>
                  {i.image && <img src={i.image} alt={i.name} className="w-20 h-20 rounded-xl object-cover shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{i.name}</div>
                    <div className="text-xs text-muted-foreground line-clamp-2">{i.description}</div>
                    <div className="flex justify-between items-center mt-2">
                      <span className="font-semibold text-primary">{fmt(i.price)}</span>
                      {i.available ? (
                        canOrder ? (
                          i.addons.length > 0 ? (
                            <button data-testid={`add-${i.name.replace(/\s/g, "-")}`} onClick={() => { setCustomizing(i); setPickedAddons([]); }}
                              className="rounded-full bg-accent text-accent-foreground text-sm font-semibold px-4 py-1.5">Add +</button>
                          ) : (
                            <button data-testid={`add-${i.name.replace(/\s/g, "-")}`} onClick={() => addToCart(i)}
                              className="rounded-full bg-accent text-accent-foreground text-sm font-semibold px-4 py-1.5">Add +</button>
                          )
                        ) : <span className="text-xs text-muted-foreground">Bill requested</span>
                      ) : <span className="text-xs font-semibold text-red-600">Sold Out</span>}
                    </div>
                    {customizing?.id === i.id && (
                      <div className="mt-2 border-t pt-2 space-y-1.5" data-testid={`addons-${i.name.replace(/\s/g, "-")}`}>
                        {i.addons.map((a) => (
                          <label key={a.id} className="flex items-center gap-2 text-sm">
                            <input type="checkbox" data-testid={`addon-${a.name.replace(/\s/g, "-")}`}
                              checked={pickedAddons.some((p) => p.id === a.id)}
                              onChange={(e) => setPickedAddons((p) => e.target.checked ? [...p, a] : p.filter((x) => x.id !== a.id))}
                              className="accent-[#d95d0f]" />
                            {a.name} <span className="text-muted-foreground">+{fmt(a.price)}</span>
                          </label>
                        ))}
                        <button data-testid={`confirm-add-${i.name.replace(/\s/g, "-")}`} onClick={() => addToCart(i, pickedAddons)}
                          className="w-full rounded-full bg-primary text-primary-foreground text-sm font-semibold py-2 mt-1">
                          Add to cart · {fmt(i.price + pickedAddons.reduce((s, a) => s + a.price, 0))}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {tab === "orders" && (
        <div className="px-4 pt-4 space-y-3">
          {orders.length === 0 && <p className="text-muted-foreground text-sm" data-testid="no-customer-orders">No orders yet — grab something from the menu.</p>}
          {orders.map((o) => (
            <div key={o.id} data-testid={`customer-order-${o.order_no}`} className="bg-card border rounded-2xl p-4 space-y-2 fade-in">
              <div className="flex justify-between items-center">
                <span className="font-semibold">Order #{o.order_no}</span>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_COLORS[o.status]} ${["PLACED", "PREPARING"].includes(o.status) ? "status-pulse" : ""}`}
                  data-testid={`order-status-${o.order_no}`}>{o.status}</span>
              </div>
              {o.reject_reason && <div className="text-xs text-red-700">Reason: {o.reject_reason}</div>}
              <ul className="text-sm space-y-1">
                {o.items.map((i, idx) => (
                  <li key={idx} className="flex justify-between">
                    <span>{i.qty}× {i.name}{i.addons.length > 0 && <span className="text-muted-foreground"> (+{i.addons.map((a) => a.name).join(", ")})</span>}</span>
                    <span>{fmt(i.line_total)}</span>
                  </li>
                ))}
              </ul>
              <div className="flex justify-between text-sm font-semibold border-t pt-2"><span>Total (incl. tax)</span><span>{fmt(o.total)}</span></div>
            </div>
          ))}
        </div>
      )}

      {tab === "bill" && (
        <div className="px-4 pt-4 space-y-4" data-testid="bill-tab">
          {orders.filter((o) => !["REJECTED", "CANCELLED"].includes(o.status)).length === 0 ? (
            <p className="text-muted-foreground text-sm">Nothing to bill yet.</p>
          ) : (
            <div className="bg-card border rounded-2xl p-5 space-y-3">
              <h2 className="font-display text-lg font-semibold">Session Summary</h2>
              <div className="text-sm space-y-1">
                <div className="flex justify-between"><span>Subtotal</span><span data-testid="customer-subtotal">{fmt(bill ? bill.subtotal : orders.filter((o) => !["REJECTED", "CANCELLED"].includes(o.status)).reduce((a, o) => a + o.subtotal, 0))}</span></div>
                <div className="flex justify-between"><span>GST ({info.cafe.tax_percent}%)</span><span>{fmt(bill ? bill.tax : orders.filter((o) => !["REJECTED", "CANCELLED"].includes(o.status)).reduce((a, o) => a + o.tax, 0))}</span></div>
                {bill?.discount?.amount > 0 && <div className="flex justify-between text-green-700"><span>Discount</span><span>-{fmt(bill.discount.amount)}</span></div>}
                <div className="flex justify-between font-semibold text-base border-t pt-2">
                  <span>Total</span><span data-testid="customer-total">{fmt(bill ? bill.total : orders.filter((o) => !["REJECTED", "CANCELLED"].includes(o.status)).reduce((a, o) => a + o.total, 0))}</span>
                </div>
                {bill && bill.paid_amount > 0 && <div className="flex justify-between text-sm text-muted-foreground"><span>Paid</span><span>{fmt(bill.paid_amount)}</span></div>}
              </div>

              {!bill && (
                <button data-testid="request-bill-button" onClick={requestBill}
                  className="w-full rounded-full bg-accent text-accent-foreground font-semibold py-3 hover:opacity-90">Request Bill</button>
              )}
              {bill && bill.status !== "PAID" && (
                <div className="space-y-2">
                  <div className="text-sm font-medium">How would you like to pay?</div>
                  <div className="grid grid-cols-3 gap-2">
                    {["cash", "upi", "card"].map((m) => (
                      <button key={m} data-testid={`pay-${m}`} onClick={() => choosePayment(m)}
                        className={`rounded-xl border py-2.5 text-sm font-semibold uppercase transition-colors ${state.session.preferred_payment === m ? "bg-primary text-primary-foreground" : "bg-background"}`}>
                        {m}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground text-center" data-testid="bill-status-text">
                    {bill.status === "REQUESTED" ? "Bill requested — waiting for staff to lock it." : "Pay at the counter — staff will confirm your payment."}
                  </p>
                </div>
              )}
              {bill?.status === "PAID" && (
                <div data-testid="customer-paid" className="rounded-xl bg-green-50 border border-green-200 text-green-800 text-center font-semibold py-3">
                  Payment confirmed. Thank you for visiting!
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "menu" && cart.length > 0 && canOrder && (
        <button data-testid="cart-bar" onClick={() => setCartOpen(true)}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-lg bg-primary text-primary-foreground rounded-full px-6 py-4 flex justify-between items-center shadow-lg">
          <span className="flex items-center gap-2 font-semibold"><ShoppingBag size={18} /> {cart.reduce((a, l) => a + l.qty, 0)} items</span>
          <span className="font-semibold">{fmt(cartTotal)} →</span>
        </button>
      )}

      {cartOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 flex items-end" onClick={() => setCartOpen(false)}>
          <div className="bg-background w-full max-w-lg mx-auto rounded-t-3xl p-5 space-y-4 max-h-[80vh] overflow-auto" data-testid="cart-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center">
              <h2 className="font-display text-xl font-semibold">Your Cart</h2>
              <button onClick={() => setCartOpen(false)} data-testid="close-cart"><X size={20} /></button>
            </div>
            {cart.map((l) => (
              <div key={l.key} className="flex justify-between items-center bg-card border rounded-xl p-3">
                <div className="min-w-0">
                  <div className="font-medium text-sm">{l.item.name}</div>
                  {l.addons.length > 0 && <div className="text-xs text-muted-foreground">+{l.addons.map((a) => a.name).join(", ")}</div>}
                  <div className="text-xs text-primary font-semibold mt-0.5">{fmt(l.item.price + l.addons.reduce((s, a) => s + a.price, 0))}</div>
                </div>
                <div className="flex items-center gap-3">
                  <button data-testid={`qty-minus-${l.item.name.replace(/\s/g, "-")}`} onClick={() => changeQty(l.key, -1)} className="w-8 h-8 rounded-full border flex items-center justify-center"><Minus size={14} /></button>
                  <span className="font-semibold w-4 text-center">{l.qty}</span>
                  <button data-testid={`qty-plus-${l.item.name.replace(/\s/g, "-")}`} onClick={() => changeQty(l.key, 1)} className="w-8 h-8 rounded-full border flex items-center justify-center"><Plus size={14} /></button>
                </div>
              </div>
            ))}
            <input data-testid="customer-name-input" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Your name (optional)" className="w-full rounded-xl border bg-card px-4 py-3 text-sm" />
            <div className="flex justify-between text-sm"><span>Subtotal</span><span>{fmt(cartTotal)}</span></div>
            <div className="flex justify-between text-sm"><span>GST ({info.cafe.tax_percent}%)</span><span>{fmt(cartTotal * info.cafe.tax_percent / 100)}</span></div>
            <div className="flex justify-between font-semibold border-t pt-2"><span>Total</span><span data-testid="cart-total">{fmt(cartTotal * (1 + info.cafe.tax_percent / 100))}</span></div>
            <button data-testid="place-order-button" onClick={placeOrder} disabled={placing || cart.length === 0}
              className="w-full rounded-full bg-accent text-accent-foreground font-semibold py-4 hover:opacity-90 disabled:opacity-50">
              {placing ? "Placing…" : "Place Order"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
