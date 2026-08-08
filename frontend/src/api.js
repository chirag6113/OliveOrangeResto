import axios from "axios";

export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
export const WS_BASE = `${process.env.REACT_APP_BACKEND_URL.replace(/^http/, "ws")}/api/ws`;

export const staffApi = () => {
  const token = localStorage.getItem("staff_token");
  return axios.create({ baseURL: API, headers: token ? { Authorization: `Bearer ${token}` } : {} });
};

export const fmt = (n) => `₹${Number(n || 0).toFixed(2)}`;

export const STATUS_COLORS = {
  PLACED: "bg-orange-100 text-orange-800",
  ACCEPTED: "bg-blue-100 text-blue-800",
  PREPARING: "bg-amber-100 text-amber-800",
  READY: "bg-lime-100 text-lime-800",
  SERVED: "bg-green-100 text-green-800",
  COMPLETED: "bg-stone-200 text-stone-700",
  REJECTED: "bg-red-100 text-red-800",
};

export const TABLE_COLORS = {
  AVAILABLE: "border-lime-500 bg-lime-50",
  SESSION_ACTIVE: "border-orange-500 bg-orange-50",
  BILL_REQUESTED: "border-amber-500 bg-amber-50",
  PAYMENT_PENDING: "border-red-400 bg-red-50",
  CLOSED: "border-stone-400 bg-stone-100",
  MAINTENANCE: "border-stone-500 bg-stone-200",
};
