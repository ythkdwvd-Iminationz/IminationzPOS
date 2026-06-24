from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

# ----------------- Constants -----------------
ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "admin123"
ADMIN_TOKEN = "iminationz-admin-token-2026"
STORE_NAME = "Iminationz"

IST = timezone(timedelta(hours=5, minutes=30))


def now_ist() -> datetime:
    return datetime.now(IST)


def to_dt_parts(dt: datetime):
    return {
        "date": dt.strftime("%Y-%m-%d"),
        "day": dt.strftime("%A"),
        "time": dt.strftime("%H:%M:%S"),
        "iso": dt.isoformat(),
    }


# ----------------- Auth -----------------
class LoginPayload(BaseModel):
    username: str
    password: str


def require_auth(authorization: Optional[str] = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing token")
    token = authorization.replace("Bearer ", "").strip()
    if token != ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid token")
    return True


@api_router.post("/auth/login")
async def login(payload: LoginPayload):
    if payload.username == ADMIN_USERNAME and payload.password == ADMIN_PASSWORD:
        return {"token": ADMIN_TOKEN, "store_name": STORE_NAME}
    raise HTTPException(status_code=401, detail="Invalid credentials")


# ----------------- Inventory -----------------
class InventoryCreate(BaseModel):
    item_id: str
    category: str
    item_name: str
    price: float
    opening_qty: int
    current_qty: Optional[int] = None


class InventoryUpdate(BaseModel):
    category: Optional[str] = None
    item_name: Optional[str] = None
    price: Optional[float] = None
    opening_qty: Optional[int] = None
    current_qty: Optional[int] = None


class InventoryItem(BaseModel):
    id: str
    item_id: str
    category: str
    item_name: str
    price: float
    opening_qty: int
    current_qty: int
    sold_qty: int
    created_date: str
    last_updated: str


def inv_doc_to_model(doc: dict) -> dict:
    return {
        "id": doc["id"],
        "item_id": doc["item_id"],
        "category": doc["category"],
        "item_name": doc["item_name"],
        "price": doc["price"],
        "opening_qty": doc["opening_qty"],
        "current_qty": doc["current_qty"],
        "sold_qty": doc["sold_qty"],
        "created_date": doc["created_date"],
        "last_updated": doc["last_updated"],
    }


@api_router.get("/inventory", response_model=List[InventoryItem])
async def list_inventory(_: bool = Depends(require_auth)):
    docs = await db.inventory.find({}, {"_id": 0}).to_list(2000)
    docs.sort(key=lambda d: (d.get("category", ""), d.get("item_name", "")))
    return [inv_doc_to_model(d) for d in docs]


@api_router.post("/inventory", response_model=InventoryItem)
async def create_inventory(payload: InventoryCreate, _: bool = Depends(require_auth)):
    normalized_item_id = payload.item_id.strip().upper()
    existing = await db.inventory.find_one({"item_id": normalized_item_id}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Item ID already exists")
    now = now_ist()
    current_qty = payload.current_qty if payload.current_qty is not None else payload.opening_qty
    doc = {
        "id": str(uuid.uuid4()),
        "item_id": normalized_item_id,
        "category": payload.category.strip(),
        "item_name": payload.item_name.strip(),
        "price": float(payload.price),
        "opening_qty": int(payload.opening_qty),
        "current_qty": int(current_qty),
        "sold_qty": 0,
        "created_date": now.isoformat(),
        "last_updated": now.isoformat(),
    }
    await db.inventory.insert_one(dict(doc))
    return inv_doc_to_model(doc)


@api_router.put("/inventory/{item_id}", response_model=InventoryItem)
async def update_inventory(item_id: str, payload: InventoryUpdate, _: bool = Depends(require_auth)):
    existing = await db.inventory.find_one({"id": item_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Item not found")
    update = {k: v for k, v in payload.dict(exclude_unset=True).items() if v is not None}
    if "opening_qty" in update:
        update["opening_qty"] = int(update["opening_qty"])
    if "current_qty" in update:
        update["current_qty"] = int(update["current_qty"])
    if "price" in update:
        update["price"] = float(update["price"])
    update["last_updated"] = now_ist().isoformat()
    await db.inventory.update_one({"id": item_id}, {"$set": update})
    doc = await db.inventory.find_one({"id": item_id}, {"_id": 0})
    return inv_doc_to_model(doc)


@api_router.delete("/inventory/{item_id}")
async def delete_inventory(item_id: str, _: bool = Depends(require_auth)):
    res = await db.inventory.delete_one({"id": item_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Item not found")
    return {"deleted": True}


# ----------------- Billing -----------------
class BillItem(BaseModel):
    inv_id: str
    item_id: str
    item_name: str
    price: float
    qty: int
    line_total: float


class BillCreate(BaseModel):
    customer_mobile: Optional[str] = None
    items: List[BillItem]
    cash_amount: float
    upi_amount: float


class Bill(BaseModel):
    id: str
    bill_number: str
    customer_mobile: Optional[str]
    date: str
    day: str
    time: str
    iso: str
    items: List[BillItem]
    gross_amount: float
    discount: float
    final_amount: float
    cash_amount: float
    upi_amount: float
    payment_status: str


def calc_amounts(items: List[BillItem]):
    gross = round(sum(i.price * i.qty for i in items), 2)
    discount = round(gross * 0.10, 2) if gross > 699 else 0.0
    final_amount = round(gross - discount, 2)
    return gross, discount, final_amount


async def next_bill_number(date_str: str) -> str:
    compact = date_str.replace("-", "")
    prefix = f"BILL-{compact}-"
    count = await db.bills.count_documents({"bill_number": {"$regex": f"^{prefix}"}})
    return f"{prefix}{str(count + 1).zfill(3)}"


@api_router.post("/bills", response_model=Bill)
async def create_bill(payload: BillCreate, _: bool = Depends(require_auth)):
    if not payload.items or len(payload.items) == 0:
        raise HTTPException(status_code=400, detail="Bill must have at least one item")

    # Validate stock & compute line totals
    normalized: List[BillItem] = []
    for it in payload.items:
        if it.qty <= 0:
            raise HTTPException(status_code=400, detail=f"Invalid qty for {it.item_name}")
        inv = await db.inventory.find_one({"id": it.inv_id}, {"_id": 0})
        if not inv:
            raise HTTPException(status_code=400, detail=f"Item {it.item_name} not found in inventory")
        if inv["current_qty"] < it.qty:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient stock for {inv['item_name']} (available {inv['current_qty']})",
            )
        line_total = round(inv["price"] * it.qty, 2)
        normalized.append(BillItem(
            inv_id=inv["id"],
            item_id=inv["item_id"],
            item_name=inv["item_name"],
            price=float(inv["price"]),
            qty=int(it.qty),
            line_total=line_total,
        ))

    gross, discount, final_amount = calc_amounts(normalized)
    paid_total = round(payload.cash_amount + payload.upi_amount, 2)
    if abs(paid_total - final_amount) > 0.01:
        raise HTTPException(
            status_code=400,
            detail=f"Cash + UPI ({paid_total}) must equal Final Amount ({final_amount})",
        )

    now = now_ist()
    parts = to_dt_parts(now)
    bill_number = await next_bill_number(parts["date"])

    # Atomically deduct inventory (sequential per item using $inc with conditional check)
    deducted = []
    for it in normalized:
        res = await db.inventory.update_one(
            {"id": it.inv_id, "current_qty": {"$gte": it.qty}},
            {
                "$inc": {"current_qty": -it.qty, "sold_qty": it.qty},
                "$set": {"last_updated": now.isoformat()},
            },
        )
        if res.modified_count == 0:
            # Rollback previously deducted items
            for d in deducted:
                await db.inventory.update_one(
                    {"id": d["inv_id"]},
                    {"$inc": {"current_qty": d["qty"], "sold_qty": -d["qty"]}},
                )
            raise HTTPException(status_code=400, detail=f"Stock changed for {it.item_name}, please retry")
        deducted.append({"inv_id": it.inv_id, "qty": it.qty})

    bill_doc = {
        "id": str(uuid.uuid4()),
        "bill_number": bill_number,
        "customer_mobile": payload.customer_mobile,
        "date": parts["date"],
        "day": parts["day"],
        "time": parts["time"],
        "iso": parts["iso"],
        "items": [i.dict() for i in normalized],
        "gross_amount": gross,
        "discount": discount,
        "final_amount": final_amount,
        "cash_amount": round(payload.cash_amount, 2),
        "upi_amount": round(payload.upi_amount, 2),
        "payment_status": "PAID",
    }
    await db.bills.insert_one(dict(bill_doc))
    bill_doc.pop("_id", None)
    return Bill(**bill_doc)


@api_router.get("/bills", response_model=List[Bill])
async def list_bills(
    filter: Optional[str] = "today",
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    search: Optional[str] = None,
    _: bool = Depends(require_auth),
):
    today = now_ist().strftime("%Y-%m-%d")
    yesterday = (now_ist() - timedelta(days=1)).strftime("%Y-%m-%d")
    month_start = now_ist().strftime("%Y-%m-01")

    query: dict = {}
    if filter == "today":
        query["date"] = today
    elif filter == "yesterday":
        query["date"] = yesterday
    elif filter == "month":
        query["date"] = {"$gte": month_start, "$lte": today}
    elif filter == "custom" and start_date and end_date:
        query["date"] = {"$gte": start_date, "$lte": end_date}
    elif filter == "all":
        pass

    if search:
        s = search.strip()
        query["$or"] = [
            {"bill_number": {"$regex": s, "$options": "i"}},
            {"customer_mobile": {"$regex": s, "$options": "i"}},
        ]

    docs = await db.bills.find(query, {"_id": 0}).sort("iso", -1).to_list(2000)
    return [Bill(**d) for d in docs]


@api_router.get("/bills/{bill_id}", response_model=Bill)
async def get_bill(bill_id: str, _: bool = Depends(require_auth)):
    doc = await db.bills.find_one({"id": bill_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Bill not found")
    return Bill(**doc)


# ----------------- Dashboard -----------------
@api_router.get("/dashboard/today")
async def dashboard_today(_: bool = Depends(require_auth)):
    today = now_ist().strftime("%Y-%m-%d")
    bills = await db.bills.find({"date": today}, {"_id": 0}).to_list(5000)
    total_sales = round(sum(b["final_amount"] for b in bills), 2)
    total_cash = round(sum(b["cash_amount"] for b in bills), 2)
    total_upi = round(sum(b["upi_amount"] for b in bills), 2)
    total_bills = len(bills)
    items_sold = sum(sum(i["qty"] for i in b["items"]) for b in bills)
    discount_given = round(sum(b["discount"] for b in bills), 2)
    avg_bill = round(total_sales / total_bills, 2) if total_bills else 0

    inv = await db.inventory.find({}, {"_id": 0}).to_list(5000)
    total_inventory_qty = sum(i["current_qty"] for i in inv)
    low_stock_count = sum(1 for i in inv if i["current_qty"] <= 5)

    return {
        "date": today,
        "total_sales": total_sales,
        "total_cash": total_cash,
        "total_upi": total_upi,
        "total_bills": total_bills,
        "items_sold": items_sold,
        "discount_given": discount_given,
        "average_bill_value": avg_bill,
        "total_inventory_qty": total_inventory_qty,
        "low_stock_count": low_stock_count,
        "store_name": STORE_NAME,
    }


# ----------------- Reports -----------------
@api_router.get("/reports/daily")
async def daily_report(date: Optional[str] = None, _: bool = Depends(require_auth)):
    target = date or now_ist().strftime("%Y-%m-%d")
    bills = await db.bills.find({"date": target}, {"_id": 0}).to_list(5000)
    total_sales = round(sum(b["final_amount"] for b in bills), 2)
    total_cash = round(sum(b["cash_amount"] for b in bills), 2)
    total_upi = round(sum(b["upi_amount"] for b in bills), 2)
    total_bills = len(bills)
    items_sold = sum(sum(i["qty"] for i in b["items"]) for b in bills)
    discount_given = round(sum(b["discount"] for b in bills), 2)
    avg_bill = round(total_sales / total_bills, 2) if total_bills else 0
    return {
        "date": target,
        "total_bills": total_bills,
        "total_sales": total_sales,
        "total_cash": total_cash,
        "total_upi": total_upi,
        "discount_given": discount_given,
        "items_sold": items_sold,
        "average_bill_value": avg_bill,
    }


@api_router.get("/reports/inventory")
async def inventory_report(_: bool = Depends(require_auth)):
    docs = await db.inventory.find({}, {"_id": 0}).to_list(5000)
    docs.sort(key=lambda d: (d.get("category", ""), d.get("item_name", "")))
    total_opening = sum(d["opening_qty"] for d in docs)
    total_current = sum(d["current_qty"] for d in docs)
    total_sold = sum(d["sold_qty"] for d in docs)
    low_stock = [inv_doc_to_model(d) for d in docs if d["current_qty"] <= 5]
    items = [inv_doc_to_model(d) for d in docs]
    return {
        "items": items,
        "summary": {
            "total_opening": total_opening,
            "total_current": total_current,
            "total_sold": total_sold,
            "low_stock_count": len(low_stock),
        },
        "low_stock": low_stock,
    }


# ----------------- Seed (optional dev helper) -----------------
@api_router.post("/seed")
async def seed_inventory(_: bool = Depends(require_auth)):
    """Seed sample inventory if empty."""
    count = await db.inventory.count_documents({})
    if count > 0:
        return {"seeded": False, "message": "Inventory already has data"}
    samples = [
        ("PENDANT250", "Pendant", "Pendant 250", 250, 100),
        ("PENDANT500", "Pendant", "Pendant 500", 500, 50),
        ("EARRING200", "Earring", "Earring 200", 200, 50),
        ("EARRING400", "Earring", "Earring 400", 400, 30),
        ("RING300", "Ring", "Ring 300", 300, 40),
        ("RING600", "Ring", "Ring 600", 600, 20),
        ("BANGLE800", "Bangle", "Bangle 800", 800, 15),
        ("NECKLACE1200", "Necklace", "Necklace 1200", 1200, 10),
        ("BRACELET450", "Bracelet", "Bracelet 450", 450, 25),
        ("ANKLET350", "Anklet", "Anklet 350", 350, 5),
    ]
    now = now_ist().isoformat()
    for item_id, category, name, price, qty in samples:
        await db.inventory.insert_one({
            "id": str(uuid.uuid4()),
            "item_id": item_id,
            "category": category,
            "item_name": name,
            "price": float(price),
            "opening_qty": qty,
            "current_qty": qty,
            "sold_qty": 0,
            "created_date": now,
            "last_updated": now,
        })
    return {"seeded": True, "count": len(samples)}


@api_router.get("/")
async def root():
    return {"message": "Iminationz POS API", "store": STORE_NAME}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
