"""Backend tests focusing on role-limited discount, place-order validation, sold-out, maintenance."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://table-order-hub-52.preview.emergentagent.com").rstrip("/")


def _login(email, pw):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw}, timeout=10)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def owner_token():
    return _login("oliveorangetechnologies@gmail.com", "Admin@123")


@pytest.fixture(scope="module")
def cashier_token():
    return _login("cashier@cafe.com", "Cashier@123")


@pytest.fixture(scope="module")
def manager_token():
    return _login("manager@cafe.com", "Manager@123")


@pytest.fixture(scope="module")
def h_owner(owner_token):
    return {"Authorization": f"Bearer {owner_token}"}


# ---- Auth ----
def test_login_owner():
    tok = _login("oliveorangetechnologies@gmail.com", "Admin@123")
    assert isinstance(tok, str) and len(tok) > 20


def test_login_bad_password():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": "oliveorangetechnologies@gmail.com", "password": "wrong"})
    assert r.status_code in (401, 400)


def test_auth_me(h_owner):
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=h_owner)
    assert r.status_code == 200
    assert r.json()["role"] == "owner"


# ---- Dashboard ----
def test_dashboard(h_owner):
    r = requests.get(f"{BASE_URL}/api/admin/dashboard", headers=h_owner)
    assert r.status_code == 200
    d = r.json()
    for k in ("today_sales", "active_tables", "pending_orders", "pending_bills", "aov", "payment_mix", "audit_logs"):
        assert k in d


# ---- Tables ----
def _get_available_table(h_owner):
    tables = requests.get(f"{BASE_URL}/api/admin/tables", headers=h_owner).json()
    for t in tables:
        if t["status"] == "AVAILABLE":
            return t
    return None


def test_tables_list(h_owner):
    r = requests.get(f"{BASE_URL}/api/admin/tables", headers=h_owner)
    assert r.status_code == 200
    assert isinstance(r.json(), list) and len(r.json()) > 0


# ---- Full order → bill → discount → payment flow (as cashier for role check) ----
def test_cashier_discount_role_limits(h_owner, cashier_token):
    """Cashier: percent discount 403; flat >100 -> 403; flat <=100 OK"""
    t = _get_available_table(h_owner)
    if not t:
        pytest.skip("No AVAILABLE table")
    qr = t["qr_token"]

    # Open session
    r = requests.get(f"{BASE_URL}/api/public/table/{qr}")
    assert r.status_code == 200
    st = r.json()["session"]["token"]

    # Menu
    menu = requests.get(f"{BASE_URL}/api/public/menu/{qr}").json()
    item = menu["categories"][0]["items"][0]

    # Place order (subtotal >200 so we can test flat 150 rejection reasonably)
    order = requests.post(f"{BASE_URL}/api/public/orders", json={
        "session_token": st, "idempotency_key": str(uuid.uuid4()),
        "items": [{"item_id": item["id"], "qty": 2, "addon_ids": []}]
    })
    assert order.status_code == 200, order.text
    o = order.json()

    # Accept order
    ra = requests.patch(f"{BASE_URL}/api/admin/orders/{o['id']}", headers=h_owner, json={"action": "accept"})
    assert ra.status_code == 200

    # Request bill
    rb = requests.post(f"{BASE_URL}/api/public/session/{st}/request-bill")
    assert rb.status_code == 200, rb.text
    bill = rb.json()

    # Lock bill (need staff)
    rl = requests.post(f"{BASE_URL}/api/admin/bills/{bill['id']}/lock", headers=h_owner)
    assert rl.status_code == 200

    H_cash = {"Authorization": f"Bearer {cashier_token}"}

    # Cashier percent discount -> 403
    r1 = requests.post(f"{BASE_URL}/api/admin/bills/{bill['id']}/discount", headers=H_cash,
                       json={"type": "percent", "value": 10, "reason": "test"})
    assert r1.status_code == 403, f"expected 403 got {r1.status_code} {r1.text}"

    # Cashier flat 150 -> 403
    r2 = requests.post(f"{BASE_URL}/api/admin/bills/{bill['id']}/discount", headers=H_cash,
                       json={"type": "flat", "value": 150, "reason": "test"})
    assert r2.status_code == 403

    # Cashier flat 50 -> OK
    r3 = requests.post(f"{BASE_URL}/api/admin/bills/{bill['id']}/discount", headers=H_cash,
                       json={"type": "flat", "value": 50, "reason": "test"})
    assert r3.status_code == 200, f"cashier flat 50 failed: {r3.status_code} {r3.text}"

    # Cleanup: pay off
    bill_full = requests.get(f"{BASE_URL}/api/admin/bills/{bill['id']}", headers=h_owner).json()
    balance = bill_full["total"] - bill_full["paid_amount"]
    rp = requests.post(f"{BASE_URL}/api/admin/bills/{bill['id']}/payments", headers=h_owner,
                       json={"method": "cash", "amount": balance})
    assert rp.status_code == 200
    final = requests.get(f"{BASE_URL}/api/admin/bills/{bill['id']}", headers=h_owner).json()
    assert final["status"] == "PAID"


# ---- Sold out / unavailable item cannot be ordered ----
def test_sold_out_item_rejected(h_owner):
    t = _get_available_table(h_owner)
    if not t:
        pytest.skip("No AVAILABLE table")
    qr = t["qr_token"]
    st = requests.get(f"{BASE_URL}/api/public/table/{qr}").json()["session"]["token"]
    menu = requests.get(f"{BASE_URL}/api/public/menu/{qr}").json()
    item = menu["categories"][0]["items"][0]
    # Mark unavailable
    p = requests.patch(f"{BASE_URL}/api/admin/items/{item['id']}", headers=h_owner, json={"available": False})
    assert p.status_code == 200
    try:
        r = requests.post(f"{BASE_URL}/api/public/orders", json={
            "session_token": st, "idempotency_key": str(uuid.uuid4()),
            "items": [{"item_id": item["id"], "qty": 1, "addon_ids": []}]
        })
        assert r.status_code == 400 and "unavailable" in r.text.lower()
    finally:
        requests.patch(f"{BASE_URL}/api/admin/items/{item['id']}", headers=h_owner, json={"available": True})


# ---- Maintenance blocks customer opening ----
def test_maintenance_blocks_customer(h_owner):
    t = _get_available_table(h_owner)
    if not t:
        pytest.skip("No AVAILABLE table")
    tid = t["id"]
    # Set maintenance
    r = requests.patch(f"{BASE_URL}/api/admin/tables/{tid}", headers=h_owner, json={"status": "MAINTENANCE"})
    assert r.status_code == 200, r.text
    try:
        r2 = requests.get(f"{BASE_URL}/api/public/table/{t['qr_token']}")
        assert r2.status_code == 423, f"expected 423 got {r2.status_code}"
    finally:
        requests.patch(f"{BASE_URL}/api/admin/tables/{tid}", headers=h_owner, json={"status": "AVAILABLE"})


# ---- Idempotency dedupe ----
def test_idempotency_dedupe(h_owner):
    t = _get_available_table(h_owner)
    if not t:
        pytest.skip("No AVAILABLE table")
    qr = t["qr_token"]
    st = requests.get(f"{BASE_URL}/api/public/table/{qr}").json()["session"]["token"]
    menu = requests.get(f"{BASE_URL}/api/public/menu/{qr}").json()
    item = menu["categories"][0]["items"][0]
    key = str(uuid.uuid4())
    payload = {"session_token": st, "idempotency_key": key,
               "items": [{"item_id": item["id"], "qty": 1, "addon_ids": []}]}
    r1 = requests.post(f"{BASE_URL}/api/public/orders", json=payload)
    r2 = requests.post(f"{BASE_URL}/api/public/orders", json=payload)
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["id"] == r2.json()["id"]
    # cleanup: reject the order
    requests.patch(f"{BASE_URL}/api/admin/orders/{r1.json()['id']}", headers=h_owner,
                   json={"action": "reject", "reason": "test cleanup"})
