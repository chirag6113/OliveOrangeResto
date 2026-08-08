from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import uuid
import secrets
import logging
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from typing import Optional, List

from fastapi import FastAPI, APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALG = "HS256"

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def uid() -> str:
    return str(uuid.uuid4())


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------- Auth ----------
def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    return bcrypt.checkpw(pw.encode(), hashed.encode())


def make_token(user: dict) -> str:
    payload = {"sub": user["id"], "email": user["email"], "role": user["role"],
               "exp": datetime.now(timezone.utc) + timedelta(hours=12), "type": "access"}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


bearer = HTTPBearer(auto_error=False)


async def current_user(creds: HTTPAuthorizationCredentials = Depends(bearer)):
    if not creds:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(401, "User not found")
    return user


def require(*roles):
    async def dep(user=Depends(current_user)):
        if roles and user["role"] not in roles:
            raise HTTPException(403, "Insufficient role")
        return user
    return dep


# ---------- WebSockets ----------
class WSManager:
    def __init__(self):
        self.channels = {}

    async def connect(self, channel: str, ws: WebSocket):
        await ws.accept()
        self.channels.setdefault(channel, []).append(ws)

    def disconnect(self, channel: str, ws: WebSocket):
        if channel in self.channels and ws in self.channels[channel]:
            self.channels[channel].remove(ws)

    async def broadcast(self, channel: str, message: dict):
        for ws in list(self.channels.get(channel, [])):
            try:
                await ws.send_json(message)
            except Exception:
                self.disconnect(channel, ws)


ws_manager = WSManager()


async def emit(cafe_id: str, session_token: Optional[str], event: str, data: dict):
    msg = {"type": event, "data": data, "at": now()}
    await ws_manager.broadcast(f"cafe:{cafe_id}", msg)
    if session_token:
        await ws_manager.broadcast(f"session:{session_token}", msg)


@api_router.websocket("/ws/cafe/{cafe_id}")
async def ws_cafe(websocket: WebSocket, cafe_id: str):
    ch = f"cafe:{cafe_id}"
    await ws_manager.connect(ch, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(ch, websocket)


@api_router.websocket("/ws/session/{token}")
async def ws_session(websocket: WebSocket, token: str):
    ch = f"session:{token}"
    await ws_manager.connect(ch, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(ch, websocket)


# ---------- Helpers ----------
ACTIVE_SESSION_STATUSES = ["ACTIVE", "BILL_REQUESTED", "BILL_LOCKED", "PAYMENT_PENDING"]
OPEN_ORDER_STATUSES = ["PLACED", "ACCEPTED", "PREPARING", "READY"]
ORDER_FLOW = {"accept": "ACCEPTED", "preparing": "PREPARING", "ready": "READY", "served": "SERVED", "reject": "REJECTED"}

DISCOUNT_LIMITS = {
    "waiter": {"type": "flat", "max": 50},
    "cashier": {"type": "flat", "max": 100},
    "manager": {"type": "percent", "max": 15},
    "owner": None,
    "admin": None,
}


async def get_cafe() -> dict:
    return await db.cafes.find_one({}, {"_id": 0})


async def audit(user: dict, action: str, entity: str, entity_id: str, before=None, after=None, cafe_id: str = ""):
    await db.audit_logs.insert_one({
        "id": uid(), "cafe_id": cafe_id or (user or {}).get("cafe_id", ""),
        "user_id": (user or {}).get("id", "system"), "user_name": (user or {}).get("name", "System"),
        "action": action, "entity": entity, "entity_id": entity_id,
        "before": before, "after": after, "at": now(),
    })


async def notify(cafe_id: str, kind: str, to: str, message: str):
    # MOCKED WhatsApp (Twilio) — logged to DB only
    await db.notifications.insert_one({"id": uid(), "cafe_id": cafe_id, "kind": kind, "to": to,
                                       "message": message, "channel": "whatsapp_mock", "at": now()})
    logger.info(f"[MOCK WhatsApp] {kind} -> {to}: {message}")


async def bill_totals(session_id: str) -> dict:
    orders = await db.orders.find({"session_id": session_id, "status": {"$nin": ["REJECTED", "CANCELLED"]}}, {"_id": 0}).to_list(500)
    subtotal = round(sum(o["subtotal"] for o in orders), 2)
    tax = round(sum(o["tax"] for o in orders), 2)
    return {"subtotal": subtotal, "tax": tax, "orders": orders}


async def sync_table_status(table_id: str, cafe_id: str):
    session = await db.sessions.find_one({"table_id": table_id, "status": {"$in": ACTIVE_SESSION_STATUSES}}, {"_id": 0})
    table = await db.tables.find_one({"id": table_id}, {"_id": 0})
    if not table or table.get("status") == "MAINTENANCE":
        return
    if not session:
        status = "AVAILABLE"
    else:
        status = {"ACTIVE": "SESSION_ACTIVE", "BILL_REQUESTED": "BILL_REQUESTED",
                  "BILL_LOCKED": "PAYMENT_PENDING", "PAYMENT_PENDING": "PAYMENT_PENDING"}[session["status"]]
    await db.tables.update_one({"id": table_id}, {"$set": {"status": status}})
    await emit(cafe_id, None, "table_update", {"table_id": table_id, "status": status})


# ---------- Auth routes ----------
class LoginIn(BaseModel):
    email: str
    password: str


@api_router.post("/auth/login")
async def login(body: LoginIn):
    user = await db.users.find_one({"email": body.email.lower()}, {"_id": 0})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(401, "Invalid email or password")
    token = make_token(user)
    return {"token": token, "user": {k: user[k] for k in ("id", "name", "email", "role", "cafe_id")}}


@api_router.get("/auth/me")
async def me(user=Depends(current_user)):
    return user


# ---------- Public (customer) ----------
@api_router.get("/public/table/{qr_token}")
async def open_table(qr_token: str, session_token: Optional[str] = None):
    table = await db.tables.find_one({"qr_token": qr_token}, {"_id": 0})
    if not table:
        raise HTTPException(404, "Invalid QR code")
    if table.get("status") == "MAINTENANCE":
        raise HTTPException(423, "This table is temporarily unavailable")
    cafe = await get_cafe()
    session = None
    if session_token:
        session = await db.sessions.find_one({"token": session_token, "table_id": table["id"],
                                              "status": {"$in": ACTIVE_SESSION_STATUSES}}, {"_id": 0})
    if not session:
        session = await db.sessions.find_one({"table_id": table["id"], "status": {"$in": ACTIVE_SESSION_STATUSES}}, {"_id": 0})
    if not session:
        session = {"id": uid(), "cafe_id": table["cafe_id"], "table_id": table["id"], "token": secrets.token_urlsafe(16),
                   "status": "ACTIVE", "customer_name": None, "mobile": None, "preferred_payment": None, "created_at": now()}
        await db.sessions.insert_one(session)
        await sync_table_status(table["id"], table["cafe_id"])
    session.pop("_id", None)
    return {
        "cafe": {"name": cafe["name"], "currency": cafe.get("currency", "INR"),
                 "tax_percent": cafe.get("tax_percent", 5), "service_charge_percent": cafe.get("service_charge_percent", 0)},
        "table": {"id": table["id"], "name": table["name"]},
        "session": {"token": session["token"], "status": session["status"], "customer_name": session.get("customer_name")},
    }


class SessionUpdate(BaseModel):
    name: Optional[str] = None
    mobile: Optional[str] = None


@api_router.post("/public/session/{session_token}/profile")
async def set_profile(session_token: str, body: SessionUpdate):
    await db.sessions.update_one({"token": session_token}, {"$set": {"customer_name": body.name, "mobile": body.mobile}})
    return {"ok": True}


@api_router.get("/public/menu/{qr_token}")
async def public_menu(qr_token: str):
    table = await db.tables.find_one({"qr_token": qr_token}, {"_id": 0})
    if not table:
        raise HTTPException(404, "Invalid QR code")
    cats = await db.categories.find({"cafe_id": table["cafe_id"]}, {"_id": 0}).sort("name", 1).to_list(100)
    items = await db.menu_items.find({"cafe_id": table["cafe_id"]}, {"_id": 0}).to_list(500)
    for c in cats:
        c["items"] = [i for i in items if i["category_id"] == c["id"]]
    return {"categories": cats}


class OrderLineIn(BaseModel):
    item_id: str
    qty: int = 1
    addon_ids: List[str] = []


class PlaceOrderIn(BaseModel):
    session_token: str
    idempotency_key: str
    items: List[OrderLineIn]
    note: Optional[str] = None


@api_router.post("/public/orders")
async def place_order(body: PlaceOrderIn):
    session = await db.sessions.find_one({"token": body.session_token}, {"_id": 0})
    if not session or session["status"] not in ("ACTIVE",):
        raise HTTPException(400, "Session not accepting orders")
    existing = await db.orders.find_one({"session_id": session["id"], "idempotency_key": body.idempotency_key}, {"_id": 0})
    if existing:
        return existing
    if not body.items:
        raise HTTPException(400, "Cart is empty")
    cafe = await get_cafe()
    lines, subtotal = [], 0.0
    for line in body.items:
        item = await db.menu_items.find_one({"id": line.item_id, "cafe_id": session["cafe_id"]}, {"_id": 0})
        if not item or not item.get("available", True):
            raise HTTPException(400, f"Item unavailable: {line.item_id}")
        qty = max(1, min(line.qty, 20))
        addons = [a for a in item.get("addons", []) if a["id"] in line.addon_ids]
        unit = round(item["price"] + sum(a["price"] for a in addons), 2)
        lines.append({"item_id": item["id"], "name": item["name"], "qty": qty, "unit_price": unit,
                      "addons": addons, "line_total": round(unit * qty, 2)})
        subtotal += unit * qty
    subtotal = round(subtotal, 2)
    tax = round(subtotal * cafe.get("tax_percent", 5) / 100, 2)
    sc = round(subtotal * cafe.get("service_charge_percent", 0) / 100, 2)
    seq = await db.orders.count_documents({"cafe_id": session["cafe_id"]})
    order = {"id": uid(), "cafe_id": session["cafe_id"], "session_id": session["id"], "session_token": session["token"],
             "table_id": session["table_id"], "order_no": seq + 1, "items": lines, "note": body.note,
             "subtotal": subtotal, "tax": tax, "service_charge": sc, "total": round(subtotal + tax + sc, 2),
             "status": "PLACED", "reject_reason": None, "idempotency_key": body.idempotency_key,
             "created_at": now(), "updated_at": now()}
    await db.orders.insert_one(order)
    order.pop("_id", None)
    table = await db.tables.find_one({"id": session["table_id"]}, {"_id": 0})
    await notify(session["cafe_id"], "staff_new_order", "staff", f"New order #{order['order_no']} at {table['name']}")
    await emit(session["cafe_id"], session["token"], "order_new", order)
    return order


@api_router.get("/public/session/{session_token}")
async def session_state(session_token: str):
    session = await db.sessions.find_one({"token": session_token}, {"_id": 0})
    if not session:
        raise HTTPException(404, "Session not found")
    table = await db.tables.find_one({"id": session["table_id"]}, {"_id": 0})
    orders = await db.orders.find({"session_id": session["id"]}, {"_id": 0}).sort("created_at", 1).to_list(200)
    bill = await db.bills.find_one({"session_id": session["id"], "status": {"$ne": "CANCELLED"}}, {"_id": 0})
    return {"session": session, "table": {"name": table["name"] if table else "?"}, "orders": orders, "bill": bill}


@api_router.post("/public/session/{session_token}/request-bill")
async def request_bill(session_token: str):
    session = await db.sessions.find_one({"token": session_token}, {"_id": 0})
    if not session:
        raise HTTPException(404, "Session not found")
    if session["status"] != "ACTIVE":
        bill = await db.bills.find_one({"session_id": session["id"], "status": {"$ne": "CANCELLED"}}, {"_id": 0})
        if bill:
            return bill
        raise HTTPException(400, "Cannot request bill in current state")
    totals = await bill_totals(session["id"])
    if not totals["orders"]:
        raise HTTPException(400, "No orders to bill")
    count = await db.bills.count_documents({"cafe_id": session["cafe_id"]})
    bill = {"id": uid(), "cafe_id": session["cafe_id"], "session_id": session["id"], "session_token": session["token"],
            "table_id": session["table_id"], "bill_no": f"INV-{count + 1:04d}",
            "subtotal": totals["subtotal"], "tax": totals["tax"], "service_charge": round(sum(o.get("service_charge", 0) for o in totals["orders"]), 2),
            "discount": {"type": None, "value": 0, "amount": 0, "reason": None, "by": None},
            "total": round(totals["subtotal"] + totals["tax"], 2), "payments": [], "paid_amount": 0,
            "status": "REQUESTED", "created_at": now(), "updated_at": now()}
    await db.bills.insert_one(bill)
    bill.pop("_id", None)
    await db.sessions.update_one({"id": session["id"]}, {"$set": {"status": "BILL_REQUESTED"}})
    await sync_table_status(session["table_id"], session["cafe_id"])
    await notify(session["cafe_id"], "staff_bill_request", "staff", f"Bill requested for session {session['token'][:6]}")
    await emit(session["cafe_id"], session["token"], "bill_update", bill)
    return bill


class PayMethodIn(BaseModel):
    method: str


@api_router.post("/public/session/{session_token}/payment-method")
async def choose_payment(session_token: str, body: PayMethodIn):
    if body.method not in ("cash", "upi", "card", "online"):
        raise HTTPException(400, "Invalid method")
    await db.sessions.update_one({"token": session_token}, {"$set": {"preferred_payment": body.method}})
    session = await db.sessions.find_one({"token": session_token}, {"_id": 0})
    await emit(session["cafe_id"], session_token, "session_update", {"preferred_payment": body.method})
    return {"ok": True}


# ---------- Admin: dashboard ----------
@api_router.get("/admin/dashboard")
async def dashboard(user=Depends(current_user)):
    cafe_id = user["cafe_id"]
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    paid_today = await db.bills.find({"cafe_id": cafe_id, "status": "PAID", "updated_at": {"$gte": today_start}}, {"_id": 0}).to_list(1000)
    sales = round(sum(b["total"] for b in paid_today), 2)
    payment_mix = {}
    for b in paid_today:
        for p in b.get("payments", []):
            payment_mix[p["method"]] = round(payment_mix.get(p["method"], 0) + p["amount"], 2)
    active_tables = await db.tables.count_documents({"cafe_id": cafe_id, "status": {"$in": ["SESSION_ACTIVE", "BILL_REQUESTED", "PAYMENT_PENDING"]}})
    pending_orders = await db.orders.count_documents({"cafe_id": cafe_id, "status": {"$in": OPEN_ORDER_STATUSES}})
    pending_bills = await db.bills.count_documents({"cafe_id": cafe_id, "status": {"$in": ["REQUESTED", "LOCKED", "PAYMENT_PENDING"]}})
    recent_orders = await db.orders.find({"cafe_id": cafe_id}, {"_id": 0}).sort("created_at", -1).to_list(8)
    audit_logs = await db.audit_logs.find({"cafe_id": cafe_id}, {"_id": 0}).sort("at", -1).to_list(20)
    pipeline = [{"$match": {"cafe_id": cafe_id, "status": {"$nin": ["REJECTED", "CANCELLED"]}}},
                {"$unwind": "$items"}, {"$group": {"_id": "$items.name", "qty": {"$sum": "$items.qty"}}},
                {"$sort": {"qty": -1}}, {"$limit": 5}]
    best_sellers = await db.orders.aggregate(pipeline).to_list(5)
    return {"today_sales": sales, "orders_today": len(paid_today),
            "aov": round(sales / len(paid_today), 2) if paid_today else 0,
            "active_tables": active_tables, "pending_orders": pending_orders, "pending_bills": pending_bills,
            "payment_mix": payment_mix, "recent_orders": recent_orders, "audit_logs": audit_logs,
            "best_sellers": [{"name": b["_id"], "qty": b["qty"]} for b in best_sellers]}


# ---------- Admin: orders ----------
@api_router.get("/admin/orders")
async def list_orders(status: Optional[str] = None, user=Depends(current_user)):
    q = {"cafe_id": user["cafe_id"]}
    if status:
        q["status"] = status
    orders = await db.orders.find(q, {"_id": 0}).sort("created_at", -1).to_list(300)
    tables = {t["id"]: t["name"] for t in await db.tables.find({"cafe_id": user["cafe_id"]}, {"_id": 0}).to_list(200)}
    for o in orders:
        o["table_name"] = tables.get(o["table_id"], "?")
    return orders


class OrderAction(BaseModel):
    action: str
    reason: Optional[str] = None


@api_router.patch("/admin/orders/{order_id}")
async def order_action(order_id: str, body: OrderAction, user=Depends(current_user)):
    order = await db.orders.find_one({"id": order_id, "cafe_id": user["cafe_id"]}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    if body.action == "cancel":
        if user["role"] not in ("manager", "owner", "admin"):
            raise HTTPException(403, "Only manager/owner can cancel orders")
        if not body.reason:
            raise HTTPException(400, "Reason required")
        new_status = "CANCELLED"
    else:
        if body.action not in ORDER_FLOW:
            raise HTTPException(400, "Invalid action")
        new_status = ORDER_FLOW[body.action]
        valid = {"ACCEPTED": ["PLACED"], "REJECTED": ["PLACED"], "PREPARING": ["ACCEPTED"],
                 "READY": ["PREPARING"], "SERVED": ["READY"]}
        if order["status"] not in valid[new_status]:
            raise HTTPException(400, f"Cannot move {order['status']} -> {new_status}")
        if new_status == "REJECTED" and not body.reason:
            raise HTTPException(400, "Reject reason required")
    before = {"status": order["status"]}
    await db.orders.update_one({"id": order_id}, {"$set": {"status": new_status, "reject_reason": body.reason, "updated_at": now()}})
    order["status"] = new_status
    await audit(user, f"order_{body.action}", "order", order_id, before, {"status": new_status, "reason": body.reason})
    if new_status in ("ACCEPTED", "READY"):
        name = order.get("customer_name") or "customer"
        await notify(order["cafe_id"], f"order_{new_status.lower()}", name,
                     f"Order #{order['order_no']} is {new_status}")
    await emit(order["cafe_id"], order["session_token"], "order_status", order)
    return order


# ---------- Admin: tables ----------
@api_router.get("/admin/tables")
async def list_tables(user=Depends(current_user)):
    tables = await db.tables.find({"cafe_id": user["cafe_id"]}, {"_id": 0}).sort("name", 1).to_list(200)
    for t in tables:
        session = await db.sessions.find_one({"table_id": t["id"], "status": {"$in": ACTIVE_SESSION_STATUSES}}, {"_id": 0})
        t["session"] = session
        if session:
            totals = await bill_totals(session["id"])
            t["running_total"] = round(totals["subtotal"] + totals["tax"], 2)
    return tables


class TableIn(BaseModel):
    name: str


@api_router.post("/admin/tables")
async def create_table(body: TableIn, user=Depends(require("manager", "owner", "admin"))):
    table = {"id": uid(), "cafe_id": user["cafe_id"], "name": body.name, "qr_token": secrets.token_urlsafe(10),
             "status": "AVAILABLE", "created_at": now()}
    await db.tables.insert_one(table)
    table.pop("_id", None)
    await audit(user, "table_create", "table", table["id"], None, {"name": body.name})
    return table


class TablePatch(BaseModel):
    status: Optional[str] = None
    name: Optional[str] = None


@api_router.patch("/admin/tables/{table_id}")
async def patch_table(table_id: str, body: TablePatch, user=Depends(require("manager", "owner", "admin"))):
    table = await db.tables.find_one({"id": table_id, "cafe_id": user["cafe_id"]}, {"_id": 0})
    if not table:
        raise HTTPException(404, "Table not found")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if updates.get("status") and updates["status"] not in ("AVAILABLE", "MAINTENANCE"):
        raise HTTPException(400, "Only AVAILABLE/MAINTENANCE can be set manually")
    await db.tables.update_one({"id": table_id}, {"$set": updates})
    await audit(user, "table_update", "table", table_id, {"status": table["status"]}, updates)
    await emit(user["cafe_id"], None, "table_update", {"table_id": table_id, **updates})
    return {"ok": True}


@api_router.post("/admin/sessions/{session_id}/close")
async def close_session(session_id: str, user=Depends(require("cashier", "manager", "owner", "admin"))):
    session = await db.sessions.find_one({"id": session_id, "cafe_id": user["cafe_id"]}, {"_id": 0})
    if not session:
        raise HTTPException(404, "Session not found")
    bill = await db.bills.find_one({"session_id": session_id, "status": {"$ne": "CANCELLED"}}, {"_id": 0})
    if bill and bill["status"] != "PAID":
        raise HTTPException(400, "Bill not paid yet")
    await db.sessions.update_one({"id": session_id}, {"$set": {"status": "CLOSED"}})
    await db.orders.update_many({"session_id": session_id, "status": "SERVED"}, {"$set": {"status": "COMPLETED"}})
    await sync_table_status(session["table_id"], session["cafe_id"])
    await audit(user, "session_close", "session", session_id, {"status": session["status"]}, {"status": "CLOSED"})
    await emit(session["cafe_id"], session["token"], "session_update", {"status": "CLOSED"})
    return {"ok": True}


# ---------- Admin: menu ----------
@api_router.get("/admin/menu")
async def admin_menu(user=Depends(current_user)):
    cats = await db.categories.find({"cafe_id": user["cafe_id"]}, {"_id": 0}).sort("name", 1).to_list(100)
    items = await db.menu_items.find({"cafe_id": user["cafe_id"]}, {"_id": 0}).to_list(500)
    for c in cats:
        c["items"] = [i for i in items if i["category_id"] == c["id"]]
    return {"categories": cats}


class CategoryIn(BaseModel):
    name: str


@api_router.post("/admin/categories")
async def add_category(body: CategoryIn, user=Depends(require("manager", "owner", "admin"))):
    cat = {"id": uid(), "cafe_id": user["cafe_id"], "name": body.name}
    await db.categories.insert_one(cat)
    cat.pop("_id", None)
    return cat


class AddonIn(BaseModel):
    name: str
    price: float


class ItemIn(BaseModel):
    category_id: str
    name: str
    price: float
    description: Optional[str] = ""
    image: Optional[str] = ""
    addons: List[AddonIn] = []


@api_router.post("/admin/items")
async def add_item(body: ItemIn, user=Depends(require("manager", "owner", "admin"))):
    item = {"id": uid(), "cafe_id": user["cafe_id"], "category_id": body.category_id, "name": body.name,
            "price": round(body.price, 2), "description": body.description, "image": body.image,
            "addons": [{"id": uid(), "name": a.name, "price": a.price} for a in body.addons],
            "available": True, "created_at": now()}
    await db.menu_items.insert_one(item)
    item.pop("_id", None)
    await audit(user, "item_create", "menu_item", item["id"], None, {"name": item["name"], "price": item["price"]})
    await emit(user["cafe_id"], None, "menu_update", {})
    return item


class ItemPatch(BaseModel):
    name: Optional[str] = None
    price: Optional[float] = None
    available: Optional[bool] = None
    image: Optional[str] = None
    description: Optional[str] = None


@api_router.patch("/admin/items/{item_id}")
async def patch_item(item_id: str, body: ItemPatch, user=Depends(require("manager", "owner", "admin"))):
    item = await db.menu_items.find_one({"id": item_id, "cafe_id": user["cafe_id"]}, {"_id": 0})
    if not item:
        raise HTTPException(404, "Item not found")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    await db.menu_items.update_one({"id": item_id}, {"$set": updates})
    await audit(user, "item_update", "menu_item", item_id, {k: item.get(k) for k in updates}, updates)
    await emit(user["cafe_id"], None, "menu_update", {})
    return {"ok": True}


# ---------- Admin: billing ----------
@api_router.get("/admin/bills")
async def list_bills(status: Optional[str] = None, user=Depends(current_user)):
    q = {"cafe_id": user["cafe_id"], "status": {"$ne": "CANCELLED"}}
    if status:
        q["status"] = status
    bills = await db.bills.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    tables = {t["id"]: t["name"] for t in await db.tables.find({"cafe_id": user["cafe_id"]}, {"_id": 0}).to_list(200)}
    for b in bills:
        b["table_name"] = tables.get(b["table_id"], "?")
        session = await db.sessions.find_one({"id": b["session_id"]}, {"_id": 0})
        b["session_status"] = session["status"] if session else "?"
        b["customer_name"] = (session or {}).get("customer_name")
        b["preferred_payment"] = (session or {}).get("preferred_payment")
    return bills


@api_router.get("/admin/bills/{bill_id}")
async def bill_detail(bill_id: str, user=Depends(current_user)):
    bill = await db.bills.find_one({"id": bill_id, "cafe_id": user["cafe_id"]}, {"_id": 0})
    if not bill:
        raise HTTPException(404, "Bill not found")
    totals = await bill_totals(bill["session_id"])
    bill["orders"] = totals["orders"]
    session = await db.sessions.find_one({"id": bill["session_id"]}, {"_id": 0})
    bill["session_status"] = session["status"] if session else "?"
    bill["preferred_payment"] = (session or {}).get("preferred_payment")
    table = await db.tables.find_one({"id": bill["table_id"]}, {"_id": 0})
    bill["table_name"] = table["name"] if table else "?"
    return bill


async def recompute_bill(bill_id: str) -> dict:
    bill = await db.bills.find_one({"id": bill_id}, {"_id": 0})
    totals = await bill_totals(bill["session_id"])
    disc = bill.get("discount", {})
    if disc.get("type") == "percent":
        amount = round(totals["subtotal"] * disc["value"] / 100, 2)
    elif disc.get("type") == "flat":
        amount = min(round(disc["value"], 2), totals["subtotal"])
    else:
        amount = 0
    sc = round(sum(o.get("service_charge", 0) for o in totals["orders"]), 2)
    total = round(totals["subtotal"] + totals["tax"] + sc - amount, 2)
    paid = round(sum(p["amount"] for p in bill.get("payments", [])), 2)
    await db.bills.update_one({"id": bill_id}, {"$set": {
        "subtotal": totals["subtotal"], "tax": totals["tax"], "service_charge": sc,
        "discount.amount": amount, "total": total, "paid_amount": paid, "updated_at": now()}})
    return await db.bills.find_one({"id": bill_id}, {"_id": 0})


@api_router.post("/admin/bills/{bill_id}/lock")
async def lock_bill(bill_id: str, user=Depends(require("cashier", "manager", "owner", "admin"))):
    bill = await db.bills.find_one({"id": bill_id, "cafe_id": user["cafe_id"]}, {"_id": 0})
    if not bill or bill["status"] != "REQUESTED":
        raise HTTPException(400, "Bill cannot be locked now")
    bill = await recompute_bill(bill_id)
    await db.bills.update_one({"id": bill_id}, {"$set": {"status": "LOCKED", "updated_at": now()}})
    await db.sessions.update_one({"id": bill["session_id"]}, {"$set": {"status": "BILL_LOCKED"}})
    await sync_table_status(bill["table_id"], bill["cafe_id"])
    await audit(user, "bill_lock", "bill", bill_id, {"status": "REQUESTED"}, {"status": "LOCKED"})
    await emit(bill["cafe_id"], bill["session_token"], "bill_update", {"id": bill_id, "status": "LOCKED"})
    return {"ok": True}


class DiscountIn(BaseModel):
    type: str  # flat | percent
    value: float
    reason: Optional[str] = None


@api_router.post("/admin/bills/{bill_id}/discount")
async def apply_discount(bill_id: str, body: DiscountIn, user=Depends(current_user)):
    bill = await db.bills.find_one({"id": bill_id, "cafe_id": user["cafe_id"]}, {"_id": 0})
    if not bill or bill["status"] not in ("REQUESTED", "LOCKED", "PAYMENT_PENDING"):
        raise HTTPException(400, "Discount not allowed now")
    if body.type not in ("flat", "percent") or body.value <= 0:
        raise HTTPException(400, "Invalid discount")
    limit = DISCOUNT_LIMITS.get(user["role"])
    if limit:
        if limit["type"] != body.type or body.value > limit["max"]:
            raise HTTPException(403, f"Your role allows only {limit['type']} discount up to {limit['max']}")
    before = bill.get("discount")
    await db.bills.update_one({"id": bill_id}, {"$set": {"discount": {"type": body.type, "value": body.value, "amount": 0, "reason": body.reason, "by": user["name"]}}})
    bill = await recompute_bill(bill_id)
    await audit(user, "bill_discount", "bill", bill_id, before, bill["discount"])
    await emit(bill["cafe_id"], bill["session_token"], "bill_update", {"id": bill_id, "discount": bill["discount"], "total": bill["total"]})
    return bill


class PaymentIn(BaseModel):
    method: str  # cash | upi | card
    amount: float
    payer: Optional[str] = None


@api_router.post("/admin/bills/{bill_id}/payments")
async def record_payment(bill_id: str, body: PaymentIn, user=Depends(require("cashier", "manager", "owner", "admin"))):
    bill = await db.bills.find_one({"id": bill_id, "cafe_id": user["cafe_id"]}, {"_id": 0})
    if not bill or bill["status"] not in ("LOCKED", "PAYMENT_PENDING", "REQUESTED"):
        raise HTTPException(400, "Bill not open for payment")
    if body.method not in ("cash", "upi", "card") or body.amount <= 0:
        raise HTTPException(400, "Invalid payment")
    remaining = round(bill["total"] - bill["paid_amount"], 2)
    if body.amount > remaining + 0.01:
        raise HTTPException(400, f"Amount exceeds remaining {remaining}")
    payment = {"id": uid(), "method": body.method, "amount": round(body.amount, 2),
               "payer": body.payer or "Guest", "by": user["name"], "at": now()}
    await db.bills.update_one({"id": bill_id}, {"$push": {"payments": payment}})
    bill = await recompute_bill(bill_id)
    paid = bill["paid_amount"] >= bill["total"] - 0.01
    new_status = "PAID" if paid else "PAYMENT_PENDING"
    await db.bills.update_one({"id": bill_id}, {"$set": {"status": new_status}})
    await audit(user, "payment_record", "bill", bill_id, None, payment)
    if paid:
        await db.sessions.update_one({"id": bill["session_id"]}, {"$set": {"status": "CLOSED"}})
        await db.orders.update_many({"session_id": bill["session_id"], "status": {"$in": OPEN_ORDER_STATUSES + ["SERVED"]}},
                                    {"$set": {"status": "COMPLETED"}})
        await sync_table_status(bill["table_id"], bill["cafe_id"])
        await notify(bill["cafe_id"], "payment_receipt", "customer", f"Payment of ₹{bill['total']} received. Bill {bill['bill_no']}")
    else:
        await db.sessions.update_one({"id": bill["session_id"]}, {"$set": {"status": "PAYMENT_PENDING"}})
        await sync_table_status(bill["table_id"], bill["cafe_id"])
    await emit(bill["cafe_id"], bill["session_token"], "bill_update", {"id": bill_id, "status": new_status, "paid_amount": bill["paid_amount"]})
    bill["status"] = new_status
    return bill


# ---------- Admin: audit ----------
@api_router.get("/admin/audit")
async def audit_list(user=Depends(require("manager", "owner", "admin"))):
    return await db.audit_logs.find({"cafe_id": user["cafe_id"]}, {"_id": 0}).sort("at", -1).to_list(100)


@api_router.get("/")
async def root():
    return {"message": "Cafe Smart Ordering API"}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- Seed ----------
CAFE_IMG = "https://images.unsplash.com/photo-1564327368633-151ef1d45021?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMzJ8MHwxfHNlYXJjaHw0fHxjYWZlJTIwY29mZmVlJTIwZm9vZHxlbnwwfHx8fDE3ODYxODcxMjh8MA&ixlib=rb-4.1.0&q=85"
COFFEE_IMG = "https://images.unsplash.com/photo-1564327367919-cb377ea6a88f?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMzJ8MHwxfHNlYXJjaHwzfHxjYWZlJTIwY29mZmVlJTIwZm9vZHxlbnwwfHx8fDE3ODYxODcxMjh8MA&ixlib=rb-4.1.0&q=85"


async def seed():
    cafe = await db.cafes.find_one({}, {"_id": 0})
    if not cafe:
        cafe = {"id": uid(), "name": "Olive & Orange Café", "currency": "INR", "tax_percent": 5,
                "service_charge_percent": 0, "created_at": now()}
        await db.cafes.insert_one(cafe)
    cafe_id = cafe["id"]

    staff = [
        (os.environ.get("ADMIN_EMAIL", "admin@cafe.com").lower(), os.environ.get("ADMIN_PASSWORD", "Admin@123"), "Owner", "owner"),
        ("manager@cafe.com", "Manager@123", "Manager", "manager"),
        ("cashier@cafe.com", "Cashier@123", "Cashier", "cashier"),
    ]
    for email, pw, name, role in staff:
        existing = await db.users.find_one({"email": email}, {"_id": 0})
        if not existing:
            await db.users.insert_one({"id": uid(), "cafe_id": cafe_id, "email": email, "password_hash": hash_password(pw),
                                       "name": name, "role": role, "created_at": now()})
        elif not verify_password(pw, existing["password_hash"]):
            await db.users.update_one({"email": email}, {"$set": {"password_hash": hash_password(pw)}})

    if await db.tables.count_documents({"cafe_id": cafe_id}) == 0:
        for i in range(1, 7):
            await db.tables.insert_one({"id": uid(), "cafe_id": cafe_id, "name": f"T{i}",
                                        "qr_token": secrets.token_urlsafe(10), "status": "AVAILABLE", "created_at": now()})

    if await db.categories.count_documents({"cafe_id": cafe_id}) == 0:
        menu = {
            "Beverages": [
                ("Cappuccino", 120, COFFEE_IMG, "Rich espresso with steamed milk foam", [("Extra shot", 30), ("Oat milk", 20)]),
                ("Cold Coffee", 150, CAFE_IMG, "Chilled coffee blended with ice cream", [("Whipped cream", 25)]),
                ("Masala Chai", 60, COFFEE_IMG, "Spiced Indian tea", []),
                ("Fresh Orange Juice", 110, CAFE_IMG, "Freshly squeezed oranges", []),
            ],
            "Starters": [
                ("Garlic Bread", 140, CAFE_IMG, "Toasted bread with garlic butter", [("Cheese", 40)]),
                ("Peri Peri Fries", 130, CAFE_IMG, "Crispy fries with peri peri spice", [("Extra dip", 20)]),
                ("Veg Sandwich", 160, CAFE_IMG, "Grilled sandwich with veggies", [("Cheese", 40)]),
            ],
            "Mains": [
                ("Margherita Pizza", 280, CAFE_IMG, "Classic tomato & mozzarella", [("Extra cheese", 60), ("Olives", 40)]),
                ("Pasta Alfredo", 260, CAFE_IMG, "Creamy white sauce pasta", [("Garlic bread", 50)]),
                ("Paneer Wrap", 190, CAFE_IMG, "Spiced paneer in a soft wrap", []),
            ],
            "Desserts": [
                ("Chocolate Brownie", 150, CAFE_IMG, "Warm fudge brownie", [("Vanilla scoop", 50)]),
                ("Cheesecake", 210, CAFE_IMG, "Baked classic cheesecake", []),
            ],
        }
        for cat_name, items in menu.items():
            cat_id = uid()
            await db.categories.insert_one({"id": cat_id, "cafe_id": cafe_id, "name": cat_name})
            for name, price, img, desc, addons in items:
                await db.menu_items.insert_one({"id": uid(), "cafe_id": cafe_id, "category_id": cat_id, "name": name,
                                                "price": float(price), "description": desc, "image": img,
                                                "addons": [{"id": uid(), "name": an, "price": float(ap)} for an, ap in addons],
                                                "available": True, "created_at": now()})

    await db.users.create_index("email", unique=True)
    await db.tables.create_index("qr_token", unique=True)
    await db.sessions.create_index("token", unique=True)
    await db.orders.create_index([("session_id", 1), ("idempotency_key", 1)], unique=True)
    logger.info("Seed complete")


@app.on_event("startup")
async def startup():
    await seed()


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
