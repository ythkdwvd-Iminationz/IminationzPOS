"""Iminationz POS Backend Tests"""
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://gem-counter-6.preview.emergentagent.com').rstrip('/')
IST = timezone(timedelta(hours=5, minutes=30))


# ----------------- Auth -----------------
class TestAuth:
    def test_login_success(self, base_url):
        r = requests.post(f"{base_url}/api/auth/login", json={"username": "admin", "password": "admin123"})
        assert r.status_code == 200
        data = r.json()
        assert "token" in data and data["token"]
        assert data.get("store_name") == "Iminationz"

    def test_login_wrong_password(self, base_url):
        r = requests.post(f"{base_url}/api/auth/login", json={"username": "admin", "password": "wrong"})
        assert r.status_code == 401

    def test_inventory_requires_auth(self, base_url):
        r = requests.get(f"{base_url}/api/inventory")
        assert r.status_code == 401

    def test_invalid_token_rejected(self, base_url):
        r = requests.get(f"{base_url}/api/inventory", headers={"Authorization": "Bearer wrong"})
        assert r.status_code == 401


# ----------------- Seed -----------------
class TestSeed:
    def test_seed_idempotent(self, api_client, base_url):
        r = api_client.post(f"{base_url}/api/seed")
        assert r.status_code == 200
        data = r.json()
        assert "seeded" in data
        # Now verify inventory has data
        r2 = api_client.get(f"{base_url}/api/inventory")
        assert r2.status_code == 200
        items = r2.json()
        assert len(items) >= 10

    def test_seed_repeat_returns_false(self, api_client, base_url):
        r = api_client.post(f"{base_url}/api/seed")
        assert r.status_code == 200
        # Will be false since inventory already populated
        assert r.json()["seeded"] is False


# ----------------- Inventory CRUD -----------------
class TestInventoryCRUD:
    created_ids = []

    def test_create_inventory(self, api_client, base_url):
        suffix = uuid.uuid4().hex[:6].upper()
        payload = {
            "item_id": f"test_{suffix}",
            "category": "TestCat",
            "item_name": f"TEST_Item_{suffix}",
            "price": 100.0,
            "opening_qty": 20,
        }
        r = api_client.post(f"{base_url}/api/inventory", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        # item_id uppercased
        assert d["item_id"] == f"TEST_{suffix}"
        # current_qty defaults to opening_qty
        assert d["current_qty"] == 20
        assert d["opening_qty"] == 20
        assert d["sold_qty"] == 0
        TestInventoryCRUD.created_ids.append(d["id"])

    def test_duplicate_item_id_rejected(self, api_client, base_url):
        suffix = uuid.uuid4().hex[:6].upper()
        payload = {"item_id": f"dup_{suffix}", "category": "TestCat", "item_name": "TEST_Dup", "price": 10, "opening_qty": 5}
        r1 = api_client.post(f"{base_url}/api/inventory", json=payload)
        assert r1.status_code == 200
        TestInventoryCRUD.created_ids.append(r1.json()["id"])
        r2 = api_client.post(f"{base_url}/api/inventory", json=payload)
        assert r2.status_code == 400

    def test_list_sorted(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/inventory")
        assert r.status_code == 200
        items = r.json()
        sorted_items = sorted(items, key=lambda x: (x["category"], x["item_name"]))
        assert items == sorted_items

    def test_update_inventory(self, api_client, base_url):
        # create then update
        suffix = uuid.uuid4().hex[:6].upper()
        payload = {"item_id": f"upd_{suffix}", "category": "TestCat", "item_name": "TEST_Update", "price": 50, "opening_qty": 10}
        r = api_client.post(f"{base_url}/api/inventory", json=payload)
        item = r.json()
        TestInventoryCRUD.created_ids.append(item["id"])
        r2 = api_client.put(f"{base_url}/api/inventory/{item['id']}", json={"price": 75, "current_qty": 8})
        assert r2.status_code == 200
        updated = r2.json()
        assert updated["price"] == 75
        assert updated["current_qty"] == 8

    def test_delete_inventory(self, api_client, base_url):
        suffix = uuid.uuid4().hex[:6].upper()
        payload = {"item_id": f"del_{suffix}", "category": "TestCat", "item_name": "TEST_Del", "price": 10, "opening_qty": 5}
        r = api_client.post(f"{base_url}/api/inventory", json=payload)
        iid = r.json()["id"]
        rd = api_client.delete(f"{base_url}/api/inventory/{iid}")
        assert rd.status_code == 200
        # confirm gone
        r2 = api_client.put(f"{base_url}/api/inventory/{iid}", json={"price": 99})
        assert r2.status_code == 404

    @classmethod
    def teardown_class(cls):
        headers = {"Authorization": "Bearer iminationz-admin-token-2026"}
        for iid in cls.created_ids:
            try:
                requests.delete(f"{BASE_URL}/api/inventory/{iid}", headers=headers)
            except Exception:
                pass


# ----------------- Billing -----------------
class TestBilling:
    test_item_id = None
    bill_id = None
    bill_inv_before = None

    def test_setup_inventory(self, api_client, base_url):
        # ensure seeded
        api_client.post(f"{base_url}/api/seed")
        # pick an existing inventory item to bill against (use seeded PENDANT500 - price 500)
        r = api_client.get(f"{base_url}/api/inventory")
        items = r.json()
        pendant = next((i for i in items if i["item_id"] == "PENDANT500"), None)
        assert pendant is not None, "PENDANT500 not seeded"
        TestBilling.test_item_id = pendant["id"]
        TestBilling.bill_inv_before = pendant

    def test_empty_items_rejected(self, api_client, base_url):
        r = api_client.post(f"{base_url}/api/bills", json={"customer_mobile": "9999900001", "items": [], "cash_amount": 0, "upi_amount": 0})
        assert r.status_code == 400

    def test_insufficient_stock(self, api_client, base_url):
        item = TestBilling.bill_inv_before
        payload = {
            "customer_mobile": "9999900002",
            "items": [{"inv_id": item["id"], "item_id": item["item_id"], "item_name": item["item_name"], "price": item["price"], "qty": 99999, "line_total": 0}],
            "cash_amount": 0,
            "upi_amount": 0,
        }
        r = api_client.post(f"{base_url}/api/bills", json=payload)
        assert r.status_code == 400
        assert "Insufficient stock" in r.json()["detail"]

    def test_payment_mismatch_rejected(self, api_client, base_url):
        item = TestBilling.bill_inv_before
        # qty 1, price 500, gross=500 (<=699 so no discount), final=500
        payload = {
            "customer_mobile": "9999900003",
            "items": [{"inv_id": item["id"], "item_id": item["item_id"], "item_name": item["item_name"], "price": item["price"], "qty": 1, "line_total": 500}],
            "cash_amount": 100,
            "upi_amount": 100,
        }
        r = api_client.post(f"{base_url}/api/bills", json=payload)
        assert r.status_code == 400
        assert "must equal" in r.json()["detail"].lower() or "final" in r.json()["detail"].lower()

    def test_create_bill_no_discount(self, api_client, base_url):
        # gross=500 <= 699, no discount, final=500
        item = TestBilling.bill_inv_before
        payload = {
            "customer_mobile": "9999900004",
            "items": [{"inv_id": item["id"], "item_id": item["item_id"], "item_name": item["item_name"], "price": item["price"], "qty": 1, "line_total": 500}],
            "cash_amount": 300,
            "upi_amount": 200,
        }
        r = api_client.post(f"{base_url}/api/bills", json=payload)
        assert r.status_code == 200, r.text
        bill = r.json()
        assert bill["gross_amount"] == 500
        assert bill["discount"] == 0
        assert bill["final_amount"] == 500
        assert bill["payment_status"] == "PAID"
        # bill_number format BILL-YYYYMMDD-NNN
        assert bill["bill_number"].startswith("BILL-")
        parts = bill["bill_number"].split("-")
        assert len(parts) == 3 and len(parts[1]) == 8 and len(parts[2]) == 3

    def test_create_bill_with_discount_and_inventory_deduction(self, api_client, base_url):
        # qty 2 of PENDANT500 = 1000 > 699, discount=100, final=900
        item = TestBilling.bill_inv_before
        # Get current inventory state
        r0 = api_client.get(f"{base_url}/api/inventory")
        before = next(i for i in r0.json() if i["id"] == item["id"])
        before_current = before["current_qty"]
        before_sold = before["sold_qty"]

        payload = {
            "customer_mobile": "9999900005",
            "items": [{"inv_id": item["id"], "item_id": item["item_id"], "item_name": item["item_name"], "price": item["price"], "qty": 2, "line_total": 1000}],
            "cash_amount": 600,
            "upi_amount": 300,
        }
        r = api_client.post(f"{base_url}/api/bills", json=payload)
        assert r.status_code == 200, r.text
        bill = r.json()
        assert bill["gross_amount"] == 1000
        assert bill["discount"] == 100
        assert bill["final_amount"] == 900
        TestBilling.bill_id = bill["id"]

        # Verify inventory deduction
        r2 = api_client.get(f"{base_url}/api/inventory")
        after = next(i for i in r2.json() if i["id"] == item["id"])
        assert after["current_qty"] == before_current - 2
        assert after["sold_qty"] == before_sold + 2

    def test_negative_upi_for_change(self, api_client, base_url):
        # cash=500, upi=-100, final=400 -- gross=400 (qty1*400)
        # Use EARRING400
        r0 = api_client.get(f"{base_url}/api/inventory")
        items = r0.json()
        earring = next((i for i in items if i["item_id"] == "EARRING400"), None)
        assert earring is not None
        payload = {
            "customer_mobile": "9999900006",
            "items": [{"inv_id": earring["id"], "item_id": earring["item_id"], "item_name": earring["item_name"], "price": earring["price"], "qty": 1, "line_total": 400}],
            "cash_amount": 500,
            "upi_amount": -100,
        }
        r = api_client.post(f"{base_url}/api/bills", json=payload)
        assert r.status_code == 200, r.text
        bill = r.json()
        assert bill["final_amount"] == 400
        assert bill["cash_amount"] == 500
        assert bill["upi_amount"] == -100
        assert bill["payment_status"] == "PAID"

    def test_get_bill_by_id(self, api_client, base_url):
        assert TestBilling.bill_id
        r = api_client.get(f"{base_url}/api/bills/{TestBilling.bill_id}")
        assert r.status_code == 200
        b = r.json()
        assert b["id"] == TestBilling.bill_id

    def test_list_bills_today_filter(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/bills?filter=today")
        assert r.status_code == 200
        bills = r.json()
        assert len(bills) >= 3
        today = datetime.now(IST).strftime("%Y-%m-%d")
        for b in bills:
            assert b["date"] == today

    def test_list_bills_all_and_search(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/bills?filter=all&search=9999900005")
        assert r.status_code == 200
        bills = r.json()
        assert any(b["customer_mobile"] == "9999900005" for b in bills)

    def test_list_bills_month(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/bills?filter=month")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_list_bills_yesterday(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/bills?filter=yesterday")
        assert r.status_code == 200


# ----------------- Dashboard & Reports -----------------
class TestDashboardReports:
    def test_dashboard_today(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/dashboard/today")
        assert r.status_code == 200
        d = r.json()
        for k in ["total_sales", "total_cash", "total_upi", "total_bills", "items_sold", "discount_given", "average_bill_value", "total_inventory_qty", "low_stock_count", "store_name"]:
            assert k in d, f"Missing key {k}"
        assert d["store_name"] == "Iminationz"
        # After billing tests, totals should reflect activity
        assert d["total_bills"] >= 3
        assert d["total_sales"] > 0

    def test_daily_report(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/reports/daily")
        assert r.status_code == 200
        d = r.json()
        for k in ["date", "total_bills", "total_sales", "total_cash", "total_upi", "discount_given", "items_sold", "average_bill_value"]:
            assert k in d

    def test_inventory_report(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/reports/inventory")
        assert r.status_code == 200
        d = r.json()
        assert "items" in d and "summary" in d and "low_stock" in d
        # ANKLET350 was seeded with qty=5, should be in low_stock (<=5)
        anklet = next((i for i in d["low_stock"] if i["item_id"] == "ANKLET350"), None)
        assert anklet is not None, "ANKLET350 (qty=5) should be in low_stock"
        assert all(i["current_qty"] <= 5 for i in d["low_stock"])
