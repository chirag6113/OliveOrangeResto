import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { staffApi, fmt } from "@/api";
import { useCafeWS } from "./AdminLayout";

const BILL_STATUS_COLORS = {
  REQUESTED: "bg-amber-100 text-amber-800",
  LOCKED: "bg-orange-100 text-orange-800",
  PAYMENT_PENDING: "bg-red-100 text-red-800",
  PAID: "bg-green-100 text-green-800",
};

export default function Billing() {
  const [bills, setBills] = useState([]);
  const [selected, setSelected] = useState(null);
  const [discount, setDiscount] = useState({ type: "flat", value: "", reason: "" });
  const [payment, setPayment] = useState({ method: "cash", amount: "", payer: "" });

  const load = useCallback(() => staffApi().get("/admin/bills").then(({ data }) => setBills(data)).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  useCafeWS(() => { load(); if (selected) openBill(selected.id); });

  const openBill = async (id) => {
    const { data } = await staffApi().get(`/admin/bills/${id}`);
    setSelected(data);
    setPayment((p) => ({ ...p, amount: (data.total - data.paid_amount).toFixed(2) }));
  };

  const lock = async () => {
    try { await staffApi().post(`/admin/bills/${selected.id}/lock`); toast.success("Bill locked"); openBill(selected.id); load(); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const applyDiscount = async (e) => {
    e.preventDefault();
    try {
      await staffApi().post(`/admin/bills/${selected.id}/discount`, { type: discount.type, value: parseFloat(discount.value), reason: discount.reason });
      toast.success("Discount applied"); setDiscount({ type: "flat", value: "", reason: "" }); openBill(selected.id); load();
    } catch (err) { toast.error(err.response?.data?.detail || "Failed"); }
  };

  const recordPayment = async (e) => {
    e.preventDefault();
    try {
      await staffApi().post(`/admin/bills/${selected.id}/payments`, { method: payment.method, amount: parseFloat(payment.amount), payer: payment.payer || undefined });
      toast.success("Payment recorded"); setPayment({ method: "cash", amount: "", payer: "" }); openBill(selected.id); load();
    } catch (err) { toast.error(err.response?.data?.detail || "Failed"); }
  };

  const printBill = () => window.print();

  return (
    <div className="space-y-6 fade-in" data-testid="billing-page">
      <h1 className="font-display text-3xl font-semibold text-primary">Billing</h1>
      <div className="grid lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2 space-y-3">
          {bills.map((b) => (
            <button key={b.id} data-testid={`bill-${b.bill_no}`} onClick={() => openBill(b.id)}
              className={`w-full text-left bg-card border rounded-xl p-4 hover:shadow-sm transition-shadow ${selected?.id === b.id ? "ring-2 ring-accent" : ""}`}>
              <div className="flex justify-between items-center">
                <span className="font-semibold">{b.bill_no} <span className="text-muted-foreground font-normal">· {b.table_name}</span></span>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${BILL_STATUS_COLORS[b.status]}`}>{b.status.replace(/_/g, " ")}</span>
              </div>
              <div className="text-sm mt-1 flex justify-between">
                <span className="text-muted-foreground">{b.customer_name || "Guest"}{b.preferred_payment ? ` · prefers ${b.preferred_payment.toUpperCase()}` : ""}</span>
                <span className="font-semibold">{fmt(b.total)} {b.paid_amount > 0 && b.status !== "PAID" && <span className="text-xs text-muted-foreground">(paid {fmt(b.paid_amount)})</span>}</span>
              </div>
            </button>
          ))}
          {bills.length === 0 && <p className="text-muted-foreground" data-testid="no-bills">No bills yet.</p>}
        </div>

        {selected && (
          <div className="lg:col-span-3 bg-card border rounded-xl p-6 space-y-5 h-fit" data-testid="bill-detail">
            <div className="flex justify-between items-start">
              <div>
                <h2 className="font-display text-2xl font-semibold">{selected.bill_no}</h2>
                <div className="text-sm text-muted-foreground">{selected.table_name} · {new Date(selected.created_at).toLocaleString()}</div>
              </div>
              <button data-testid="print-bill-button" onClick={printBill} className="rounded-full border text-sm px-4 py-2 hover:bg-secondary">Print</button>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {(selected.orders || []).flatMap((o) => o.items.map((i, idx) => (
                  <tr key={`${o.id}-${idx}`} className="border-b last:border-0">
                    <td className="py-1.5">{i.qty}× {i.name}{i.addons.length > 0 && <span className="text-muted-foreground text-xs"> (+{i.addons.map((a) => a.name).join(", ")})</span>}</td>
                    <td className="py-1.5 text-right">{fmt(i.line_total)}</td>
                  </tr>
                )))}
              </tbody>
            </table>
            <div className="text-sm space-y-1 border-t pt-3">
              <div className="flex justify-between"><span>Subtotal</span><span>{fmt(selected.subtotal)}</span></div>
              <div className="flex justify-between"><span>Tax (GST)</span><span>{fmt(selected.tax)}</span></div>
              {selected.service_charge > 0 && <div className="flex justify-between"><span>Service Charge</span><span>{fmt(selected.service_charge)}</span></div>}
              {selected.discount?.amount > 0 && (
                <div className="flex justify-between text-green-700" data-testid="discount-row">
                  <span>Discount ({selected.discount.type === "percent" ? `${selected.discount.value}%` : "flat"} by {selected.discount.by})</span>
                  <span>-{fmt(selected.discount.amount)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold text-base pt-1"><span>Total</span><span data-testid="bill-total">{fmt(selected.total)}</span></div>
              <div className="flex justify-between text-muted-foreground"><span>Paid</span><span>{fmt(selected.paid_amount)}</span></div>
              <div className="flex justify-between font-medium"><span>Balance</span><span data-testid="bill-balance">{fmt(selected.total - selected.paid_amount)}</span></div>
            </div>

            {selected.payments?.length > 0 && (
              <div className="text-sm space-y-1" data-testid="payments-list">
                <div className="font-medium">Payments</div>
                {selected.payments.map((p) => (
                  <div key={p.id} className="flex justify-between text-xs bg-secondary rounded-lg px-3 py-1.5">
                    <span className="uppercase">{p.method} · {p.payer} · by {p.by}</span><span>{fmt(p.amount)}</span>
                  </div>
                ))}
              </div>
            )}

            {selected.status === "REQUESTED" && (
              <button data-testid="lock-bill-button" onClick={lock}
                className="w-full rounded-full bg-primary text-primary-foreground font-semibold py-3 hover:opacity-90">Lock Bill</button>
            )}

            {["REQUESTED", "LOCKED", "PAYMENT_PENDING"].includes(selected.status) && (
              <div className="grid sm:grid-cols-2 gap-4">
                <form onSubmit={applyDiscount} className="border rounded-xl p-4 space-y-2" data-testid="discount-form">
                  <div className="font-medium text-sm">Discount (role-limited)</div>
                  <div className="flex gap-2">
                    <select data-testid="discount-type" value={discount.type} onChange={(e) => setDiscount({ ...discount, type: e.target.value })}
                      className="rounded-lg border bg-background px-2 py-2 text-sm">
                      <option value="flat">Flat ₹</option><option value="percent">% Percent</option>
                    </select>
                    <input data-testid="discount-value" required type="number" min="1" step="0.01" value={discount.value}
                      onChange={(e) => setDiscount({ ...discount, value: e.target.value })} placeholder="Value"
                      className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm" />
                  </div>
                  <input data-testid="discount-reason" value={discount.reason} onChange={(e) => setDiscount({ ...discount, reason: e.target.value })}
                    placeholder="Reason" className="w-full rounded-lg border bg-background px-3 py-2 text-sm" />
                  <button data-testid="apply-discount-button" className="w-full rounded-full bg-secondary text-sm font-semibold py-2 hover:opacity-80">Apply</button>
                </form>

                <form onSubmit={recordPayment} className="border rounded-xl p-4 space-y-2" data-testid="payment-form">
                  <div className="font-medium text-sm">Record Payment (split allowed)</div>
                  <div className="flex gap-2">
                    <select data-testid="payment-method" value={payment.method} onChange={(e) => setPayment({ ...payment, method: e.target.value })}
                      className="rounded-lg border bg-background px-2 py-2 text-sm">
                      <option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option>
                    </select>
                    <input data-testid="payment-amount" required type="number" min="1" step="0.01" value={payment.amount}
                      onChange={(e) => setPayment({ ...payment, amount: e.target.value })} placeholder="Amount"
                      className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm" />
                  </div>
                  <input data-testid="payment-payer" value={payment.payer} onChange={(e) => setPayment({ ...payment, payer: e.target.value })}
                    placeholder="Payer name (for split)" className="w-full rounded-lg border bg-background px-3 py-2 text-sm" />
                  <button data-testid="record-payment-button" className="w-full rounded-full bg-accent text-accent-foreground text-sm font-semibold py-2 hover:opacity-90">Confirm Payment</button>
                </form>
              </div>
            )}

            {selected.status === "PAID" && (
              <div data-testid="bill-paid-badge" className="rounded-xl bg-green-50 border border-green-200 text-green-800 text-center font-semibold py-3">
                PAID — Session closed, table available
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
