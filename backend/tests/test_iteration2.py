"""Iminationz POS — Iteration 2 backend tests.

Covers:
- customer_name persistence on bills
- /api/customers/{mobile} returning-customer aggregation
- inventory cost_price field on create/update/list
- discount rule unchanged (10% only above 699 — no loyalty extra)
- /api/reports/category math (profit, margin)
- /api/whatsapp/closing message + owner numbers + wa.me links
- /api/exports/{sales,inventory}.{xlsx,csv} with `_t` query auth
- query-param `_t` auth works; invalid `_t` rejected
"""
import os
import uuid
import urllib.parse
import pytest
import requests

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://gem-counter-6.preview.emergentagent.com').rstrip('/')
OWNER_NUMBERS = ["9044625875", "8188996721"]


# ----------------- Auth via _t query param -----------------
class TestQueryTokenAuth:
    def test_query_token_works(self, api_client, base_url, admin_token):
        # use a NEW session without Authorization header
        r = requests.get(f"{base_url}/api/inventory", params={"_t": admin_token})
        assert r.status_code == 200, r.text

    def test_invalid_query_token_rejected(self, base_url):
        r = requests.get(f"{base_url}/api/inventory", params={"_t": "bogus"})
        assert r.status_code == 401

    def test_no_token_rejected(self, base_url):
        r = requests.get(f"{base_url}/api/exports/sales.csv")
        assert r.status_code == 401


# ----------------- Customer name + lookup -----------------
class TestCustomerNameAndLookup:
    created_inv_ids = []
    mobile = None

    def _ensure_item(self, api_client, base_url, name_suffix, price, cost):
        suffix = uuid.uuid4().hex[:6].upper()
        payload = {
            "item_id": f"it2_{suffix}_{name_suffix}",
            "category": "TEST_It2",
            "item_name": f"TEST_It2_{name_suffix}_{suffix}",
            "price": price,
            "cost_price": cost,
            "opening_qty": 50,
        }
        r = api_client.post(f"{base_url}/api/inventory", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        TestCustomerNameAndLookup.created_inv_ids.append(d["id"])
        return d

    def test_unknown_mobile_returns_not_returning(self, api_client, base_url):
        mob = f"9{uuid.uuid4().int % 1000000000:09d}"
        TestCustomerNameAndLookup.mobile = mob
        r = api_client.get(f"{base_url}/api/customers/{mob}")
        assert r.status_code == 200
        d = r.json()
        assert d["is_returning"] is False
        assert d["visits"] == 0
        assert d["total_spent"] == 0
        assert d["last_name"] in (None, "")

    def test_create_bill_with_customer_name_and_lookup_aggregates(self, api_client, base_url):
        mob = TestCustomerNameAndLookup.mobile
        # Create a fresh item to bill against deterministically.
        # gross 250 (<=699 → no discount) on first bill, then gross 800 (>699 → 10% discount) on second.
        item_a = self._ensure_item(api_client, base_url, "A", price=250, cost=100)
        item_b = self._ensure_item(api_client, base_url, "B", price=800, cost=300)

        # Bill 1: customer_name = "Riya", final=250
        payload1 = {
            "customer_mobile": mob,
            "customer_name": "Riya Sharma",
            "items": [{"inv_id": item_a["id"], "item_id": item_a["item_id"], "item_name": item_a["item_name"],
                       "price": 250, "qty": 1, "line_total": 250}],
            "cash_amount": 250,
            "upi_amount": 0,
        }
        r1 = api_client.post(f"{base_url}/api/bills", json=payload1)
        assert r1.status_code == 200, r1.text
        b1 = r1.json()
        assert b1["customer_name"] == "Riya Sharma"
        assert b1["customer_mobile"] == mob
        assert b1["discount"] == 0
        assert b1["final_amount"] == 250

        # Bill 2: customer_name overridden to "Riya S", gross 800 → 10% discount → final 720
        payload2 = {
            "customer_mobile": mob,
            "customer_name": "Riya S",
            "items": [{"inv_id": item_b["id"], "item_id": item_b["item_id"], "item_name": item_b["item_name"],
                       "price": 800, "qty": 1, "line_total": 800}],
            "cash_amount": 720,
            "upi_amount": 0,
        }
        r2 = api_client.post(f"{base_url}/api/bills", json=payload2)
        assert r2.status_code == 200, r2.text
        b2 = r2.json()
        assert b2["customer_name"] == "Riya S"
        assert b2["gross_amount"] == 800
        assert b2["discount"] == 80
        assert b2["final_amount"] == 720

        # Lookup should now show is_returning=true, visits=2, total_spent=250+720=970
        r3 = api_client.get(f"{base_url}/api/customers/{mob}")
        assert r3.status_code == 200
        d = r3.json()
        assert d["is_returning"] is True
        assert d["visits"] == 2
        assert d["total_spent"] == 970
        # last_name is from the latest bill that has a name → "Riya S"
        assert d["last_name"] == "Riya S"
        assert d["last_visit"] is not None

    def test_discount_rule_unchanged_at_700(self, api_client, base_url):
        # gross=700 should trigger 10% discount (rule: > 699)
        item = self._ensure_item(api_client, base_url, "C", price=700, cost=200)
        payload = {
            "customer_mobile": "9999988888",
            "customer_name": "TEST_Discount",
            "items": [{"inv_id": item["id"], "item_id": item["item_id"], "item_name": item["item_name"],
                       "price": 700, "qty": 1, "line_total": 700}],
            "cash_amount": 630,
            "upi_amount": 0,
        }
        r = api_client.post(f"{base_url}/api/bills", json=payload)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["gross_amount"] == 700
        assert b["discount"] == 70
        assert b["final_amount"] == 630

    def test_discount_rule_unchanged_at_699(self, api_client, base_url):
        # gross=699 → NO discount (rule: > 699, strictly greater)
        item = self._ensure_item(api_client, base_url, "D", price=699, cost=200)
        payload = {
            "customer_mobile": "9999988889",
            "customer_name": "TEST_NoDisc",
            "items": [{"inv_id": item["id"], "item_id": item["item_id"], "item_name": item["item_name"],
                       "price": 699, "qty": 1, "line_total": 699}],
            "cash_amount": 699,
            "upi_amount": 0,
        }
        r = api_client.post(f"{base_url}/api/bills", json=payload)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["discount"] == 0
        assert b["final_amount"] == 699

    def test_loyalty_no_extra_discount_for_returning_customer(self, api_client, base_url):
        # Same returning mobile but small bill ≤699 must still get 0 discount
        mob = TestCustomerNameAndLookup.mobile
        item = self._ensure_item(api_client, base_url, "E", price=300, cost=120)
        payload = {
            "customer_mobile": mob,
            "customer_name": "Riya S",
            "items": [{"inv_id": item["id"], "item_id": item["item_id"], "item_name": item["item_name"],
                       "price": 300, "qty": 1, "line_total": 300}],
            "cash_amount": 300,
            "upi_amount": 0,
        }
        r = api_client.post(f"{base_url}/api/bills", json=payload)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["discount"] == 0
        assert b["final_amount"] == 300

    @classmethod
    def teardown_class(cls):
        headers = {"Authorization": "Bearer iminationz-admin-token-2026"}
        for iid in cls.created_inv_ids:
            try:
                requests.delete(f"{BASE_URL}/api/inventory/{iid}", headers=headers)
            except Exception:
                pass


# ----------------- Inventory cost_price -----------------
class TestInventoryCostPrice:
    created_ids = []

    def test_create_with_cost_price(self, api_client, base_url):
        suffix = uuid.uuid4().hex[:6].upper()
        payload = {
            "item_id": f"cp_{suffix}",
            "category": "TEST_CP",
            "item_name": f"TEST_CP_{suffix}",
            "price": 500,
            "cost_price": 220,
            "opening_qty": 10,
        }
        r = api_client.post(f"{base_url}/api/inventory", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["cost_price"] == 220
        TestInventoryCostPrice.created_ids.append(d["id"])

        # verify via GET list
        rl = api_client.get(f"{base_url}/api/inventory")
        match = next((i for i in rl.json() if i["id"] == d["id"]), None)
        assert match is not None
        assert match["cost_price"] == 220

    def test_create_without_cost_price_defaults_zero(self, api_client, base_url):
        suffix = uuid.uuid4().hex[:6].upper()
        payload = {
            "item_id": f"cp0_{suffix}",
            "category": "TEST_CP",
            "item_name": f"TEST_CP0_{suffix}",
            "price": 100,
            "opening_qty": 5,
        }
        r = api_client.post(f"{base_url}/api/inventory", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["cost_price"] == 0
        TestInventoryCostPrice.created_ids.append(d["id"])

    def test_update_cost_price(self, api_client, base_url):
        iid = TestInventoryCostPrice.created_ids[0]
        r = api_client.put(f"{base_url}/api/inventory/{iid}", json={"cost_price": 333})
        assert r.status_code == 200
        assert r.json()["cost_price"] == 333

    @classmethod
    def teardown_class(cls):
        headers = {"Authorization": "Bearer iminationz-admin-token-2026"}
        for iid in cls.created_ids:
            try:
                requests.delete(f"{BASE_URL}/api/inventory/{iid}", headers=headers)
            except Exception:
                pass


# ----------------- Category report -----------------
class TestCategoryReport:
    created_inv_ids = []

    def test_category_report_math(self, api_client, base_url):
        # Create a unique-category item with known cost and sell it to verify math
        suffix = uuid.uuid4().hex[:6].upper()
        cat = f"TEST_CatRpt_{suffix}"
        payload = {
            "item_id": f"catrpt_{suffix}",
            "category": cat,
            "item_name": f"TEST_CatItem_{suffix}",
            "price": 1000,
            "cost_price": 400,
            "opening_qty": 10,
        }
        r = api_client.post(f"{base_url}/api/inventory", json=payload)
        assert r.status_code == 200
        item = r.json()
        TestCategoryReport.created_inv_ids.append(item["id"])

        # Bill: qty 2 → revenue=2000, cost=800, profit=1200, margin=60%, discount 10% applies → final 1800
        bill_payload = {
            "customer_mobile": "9999911111",
            "items": [{"inv_id": item["id"], "item_id": item["item_id"], "item_name": item["item_name"],
                       "price": 1000, "qty": 2, "line_total": 2000}],
            "cash_amount": 1800,
            "upi_amount": 0,
        }
        rb = api_client.post(f"{base_url}/api/bills", json=bill_payload)
        assert rb.status_code == 200, rb.text

        rc = api_client.get(f"{base_url}/api/reports/category")
        assert rc.status_code == 200
        data = rc.json()
        assert "rows" in data
        row = next((x for x in data["rows"] if x["category"] == cat), None)
        assert row is not None, f"Category {cat} missing in report rows"
        # Required fields
        for k in ["category", "qty_sold", "revenue", "cost", "profit", "margin_pct"]:
            assert k in row
        assert row["qty_sold"] == 2
        # Note: category report uses line_total (pre-discount) as revenue
        assert row["revenue"] == 2000.0
        assert row["cost"] == 800.0
        assert row["profit"] == row["revenue"] - row["cost"] == 1200.0
        assert abs(row["margin_pct"] - 60.0) < 0.01

    @classmethod
    def teardown_class(cls):
        headers = {"Authorization": "Bearer iminationz-admin-token-2026"}
        for iid in cls.created_inv_ids:
            try:
                requests.delete(f"{BASE_URL}/api/inventory/{iid}", headers=headers)
            except Exception:
                pass


# ----------------- WhatsApp closing -----------------
class TestWhatsAppClosing:
    def test_whatsapp_closing(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/whatsapp/closing")
        assert r.status_code == 200
        d = r.json()
        assert "message" in d
        assert "owner_numbers" in d and d["owner_numbers"] == OWNER_NUMBERS
        assert "links" in d and len(d["links"]) == 2
        # Message should contain rupee + store name
        assert "₹" in d["message"]
        assert "Iminationz" in d["message"]
        # Links should be wa.me deep-links with 91 country code and url-encoded message
        encoded = urllib.parse.quote(d["message"])
        for link, num in zip(d["links"], OWNER_NUMBERS):
            assert link["number"] == num
            assert link["url"] == f"https://wa.me/91{num}?text={encoded}"


# ----------------- Exports -----------------
class TestExports:
    def test_sales_xlsx_with_query_token(self, base_url, admin_token):
        r = requests.get(f"{base_url}/api/exports/sales.xlsx",
                         params={"filter": "all", "_t": admin_token}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        ct = r.headers.get("content-type", "").lower()
        assert "openxmlformats-officedocument.spreadsheetml.sheet" in ct
        assert len(r.content) > 200
        # xlsx files are zip → start with PK
        assert r.content[:2] == b"PK"

    def test_sales_csv_with_query_token(self, base_url, admin_token):
        r = requests.get(f"{base_url}/api/exports/sales.csv",
                         params={"filter": "all", "_t": admin_token}, timeout=30)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("text/csv")
        body = r.text
        # header row present
        first_line = body.split("\n", 1)[0]
        assert "Bill No" in first_line
        assert "Customer Name" in first_line
        assert "Mobile" in first_line

    def test_inventory_xlsx_with_query_token(self, base_url, admin_token):
        r = requests.get(f"{base_url}/api/exports/inventory.xlsx",
                         params={"_t": admin_token}, timeout=30)
        assert r.status_code == 200
        assert "spreadsheetml.sheet" in r.headers.get("content-type", "").lower()
        assert r.content[:2] == b"PK"
        assert len(r.content) > 200

    def test_inventory_csv_with_query_token(self, base_url, admin_token):
        r = requests.get(f"{base_url}/api/exports/inventory.csv",
                         params={"_t": admin_token}, timeout=30)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("text/csv")
        body = r.text
        first_line = body.split("\n", 1)[0]
        assert "Item ID" in first_line
        assert "Cost Price" in first_line

    def test_export_invalid_token(self, base_url):
        r = requests.get(f"{base_url}/api/exports/sales.csv", params={"_t": "wrong"})
        assert r.status_code == 401
