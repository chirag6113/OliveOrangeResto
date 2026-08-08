import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { staffApi, fmt } from "@/api";
import { useCafeWS } from "./AdminLayout";

export default function MenuManage() {
  const [categories, setCategories] = useState([]);
  const [newCat, setNewCat] = useState("");
  const [form, setForm] = useState({ category_id: "", name: "", price: "", image: "", description: "", addons: "" });

  const load = useCallback(() => staffApi().get("/admin/menu").then(({ data }) => setCategories(data.categories)).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  useCafeWS((msg) => { if (msg.type === "menu_update") load(); });

  const addCategory = async (e) => {
    e.preventDefault();
    if (!newCat.trim()) return;
    await staffApi().post("/admin/categories", { name: newCat.trim() });
    setNewCat(""); toast.success("Category added"); load();
  };

  const addItem = async (e) => {
    e.preventDefault();
    try {
      const addons = form.addons.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
        const [name, price] = s.split(":").map((x) => x.trim());
        return { name, price: parseFloat(price) || 0 };
      });
      await staffApi().post("/admin/items", {
        category_id: form.category_id, name: form.name, price: parseFloat(form.price),
        image: form.image, description: form.description, addons,
      });
      setForm({ ...form, name: "", price: "", image: "", description: "", addons: "" });
      toast.success("Item added"); load();
    } catch (err) { toast.error(err.response?.data?.detail || "Failed"); }
  };

  const toggleAvailable = async (item) => {
    await staffApi().patch(`/admin/items/${item.id}`, { available: !item.available });
    load();
  };

  return (
    <div className="space-y-8 fade-in" data-testid="menu-page">
      <h1 className="font-display text-3xl font-semibold text-primary">Menu Management</h1>

      <div className="grid lg:grid-cols-2 gap-6">
        <form onSubmit={addCategory} className="bg-card border rounded-xl p-5 flex gap-2 h-fit">
          <input data-testid="new-category-name" value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="New category name"
            className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm" />
          <button data-testid="add-category-button" className="rounded-full bg-primary text-primary-foreground text-sm font-semibold px-5">Add Category</button>
        </form>

        <form onSubmit={addItem} className="bg-card border rounded-xl p-5 space-y-2" data-testid="add-item-form">
          <div className="font-medium text-sm">Add Item</div>
          <div className="grid grid-cols-2 gap-2">
            <select data-testid="item-category" required value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}
              className="rounded-lg border bg-background px-3 py-2 text-sm">
              <option value="">Category…</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input data-testid="item-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Item name" className="rounded-lg border bg-background px-3 py-2 text-sm" />
            <input data-testid="item-price" required type="number" min="1" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })}
              placeholder="Price ₹" className="rounded-lg border bg-background px-3 py-2 text-sm" />
            <input data-testid="item-image" value={form.image} onChange={(e) => setForm({ ...form, image: e.target.value })}
              placeholder="Image URL (optional)" className="rounded-lg border bg-background px-3 py-2 text-sm" />
            <input data-testid="item-addons" value={form.addons} onChange={(e) => setForm({ ...form, addons: e.target.value })}
              placeholder="Addons: Cheese:40, Dip:20" className="rounded-lg border bg-background px-3 py-2 text-sm col-span-2" />
          </div>
          <button data-testid="add-item-button" className="rounded-full bg-accent text-accent-foreground text-sm font-semibold px-6 py-2">Add Item</button>
        </form>
      </div>

      {categories.map((c) => (
        <div key={c.id} className="space-y-3">
          <h2 className="font-display text-xl font-semibold">{c.name}</h2>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            {c.items.map((i) => (
              <div key={i.id} data-testid={`menu-item-${i.name.replace(/\s/g, "-")}`} className="bg-card border rounded-xl p-3 flex gap-3 items-center">
                {i.image && <img src={i.image} alt={i.name} className="w-14 h-14 rounded-lg object-cover" />}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{i.name}</div>
                  <div className="text-xs text-muted-foreground">{fmt(i.price)}{i.addons.length > 0 && ` · ${i.addons.length} add-ons`}</div>
                </div>
                <button data-testid={`toggle-${i.name.replace(/\s/g, "-")}`} onClick={() => toggleAvailable(i)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full ${i.available ? "bg-lime-100 text-lime-800" : "bg-red-100 text-red-700"}`}>
                  {i.available ? "Available" : "Sold Out"}
                </button>
              </div>
            ))}
            {c.items.length === 0 && <p className="text-sm text-muted-foreground">No items yet.</p>}
          </div>
        </div>
      ))}
    </div>
  );
}
