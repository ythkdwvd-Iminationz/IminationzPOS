import { supabase } from "./supabase";

export const OWNER_WHATSAPP_NUMBERS = ["9044625875", "8188996721"];
export const STORE_NAME = "Iminationz";

// ---------- Types ----------
export interface InventoryItem {
  id: string;
  item_id: string;
  category: string;
  item_name: string;
  price: number;
  cost_price: number;
  opening_qty: number;
  current_qty: number;
  sold_qty: number;
  exchange_count: number; // NEW — how many times this item has been exchanged
  created_date: string;
  last_updated: string;
}

export interface BillItem {
  id: string; // NEW — bill_items.id, needed to target a specific line for exchange
  inv_id: string;
  item_id: string;
  item_name: string;
  price: number;
  qty: number;
  line_total: number;
}

export interface Bill {
  id: string;
  bill_number: string;
  customer_mobile: string | null;
  customer_name?: string | null;
  date: string;
  day: string;
  time: string;
  iso: string;
  items: BillItem[];
  gross_amount: number;
  discount: number;
  final_amount: number;
  cash_amount: number;
  upi_amount: number;
  payment_status: string;
  // who created this bill, captured server-side in create_bill().
  // Older bills predating this feature will have these as null.
  created_by_email?: string | null;
  created_by_role?: "owner" | "employee" | null;
  // NEW — exchange tracking (most-recent-exchange summary on the bill
  // itself; full history lives in ExchangeHistoryEntry rows)
  exchanged_at?: string | null;
  exchange_count?: number;
  last_exchanged_by_email?: string | null;
  last_exchanged_by_role?: "owner" | "employee" | null;
}

export interface ExchangeHistoryEntry {
  id: string;
  bill_id: string;
  bill_number: string;
  old_item_id: string;
  old_item_name: string;
  old_qty: number;
  old_line_total: number;
  new_item_id: string;
  new_item_name: string;
  new_qty: number;
  new_line_total: number;
  price_diff: number;
  cash_settled: number;
  upi_settled: number;
  exchanged_at: string; // ISO timestamp — the returned/exchanged date
  exchanged_by_email: string | null;
  exchanged_by_role: "owner" | "employee" | null;
}

export interface DashboardData {
  date: string;
  total_sales: number;
  total_cash: number;
  total_upi: number;
  total_bills: number;
  items_sold: number;
  discount_given: number;
  average_bill_value: number;
  total_inventory_qty: number;
  low_stock_count: number;
  store_name: string;
}

export interface DailyReport {
  date: string;
  total_bills: number;
  total_sales: number;
  total_cash: number;
  total_upi: number;
  discount_given: number;
  items_sold: number;
  average_bill_value: number;
}

export interface InventoryReport {
  items: InventoryItem[];
  summary: { total_opening: number; total_current: number; total_sold: number; low_stock_count: number };
  low_stock: InventoryItem[];
}

export interface CustomerInfo {
  mobile: string;
  is_returning: boolean;
  visits: number;
  total_spent: number;
  last_visit: string | null;
  last_name: string | null;
}

export interface CategoryRow {
  category: string;
  qty_sold: number;
  revenue: number;
  cost: number;
  profit: number;
  margin_pct: number;
}

export interface WhatsAppClosing {
  date: string;
  message: string;
  owner_numbers: string[];
  links: { number: string; url: string }[];
}

export interface Expense {
  id: string;
  expense_date: string;
  amount: number;
  source: "personal" | "business" | "both";
  personal_amount: number;
  business_amount: number;
  note: string | null;
  receipt_base64: string | null;
  receipt_mime: string | null;
  created_at: string;
}

export interface ExpenseOverview {
  personal_fund_total: number;
  business_fund_total: number; // = lifetime sales
  personal_spent: number;
  business_spent: number;
  personal_balance: number;
  business_balance: number;
  total_expenses: number;
  entries: number;
}


// ---------- helpers ----------
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const todayIST = () => new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
const yesterdayIST = () =>
  new Date(Date.now() + IST_OFFSET_MS - 86400000).toISOString().slice(0, 10);
const monthStartIST = () => {
  const d = new Date(Date.now() + IST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
};

function dateRangeForFilter(filter: string, start?: string, end?: string) {
  const t = todayIST();
  if (filter === "today") return { from: t, to: t };
  if (filter === "yesterday") return { from: yesterdayIST(), to: yesterdayIST() };
  if (filter === "month") return { from: monthStartIST(), to: t };
  if (filter === "custom" && start && end) return { from: start, to: end };
  return null;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// ---------- Auth ----------
export type Role = "owner" | "employee";

export async function fetchMyRole(): Promise<Role> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const email = session?.user?.email?.toLowerCase().trim();
  if (!email) return "owner";

  // Read the roles table (permissive policy in roles.sql v3 lets any
  // authenticated user do this).
  const probe = await supabase.from("user_roles").select("email,role").limit(50);

  if (probe.error) {
    // Any read error — table missing, RLS recursion, network, etc. —
    // means we cannot reliably determine the role. Default to OWNER
    // so the app owner never accidentally locks themselves out.
    // (Employee restriction only activates when we can prove the
    // user is listed as an employee.)
    return "owner";
  }

  // Table read succeeded. Find this user's row.
  const myRow = (probe.data || []).find(
    (r: any) => String(r.email).toLowerCase().trim() === email
  );
  if (!myRow) {
    // Table exists and readable, but this user isn't listed — restrict.
    return "employee";
  }
  return (myRow.role as Role) || "employee";
}

export async function login(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return { store_name: STORE_NAME };
}

export async function logout() {
  await supabase.auth.signOut();
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

// ---------- OTP Auth ----------

/**
 * Step 1: send a 6-digit OTP code to the given email.
 * `shouldCreateUser: false` means only emails that already exist as
 * Supabase Auth users (i.e. owner/employee accounts you created) can
 * request an OTP — random emails can't self-signup this way.
 */
export async function requestLoginOtp(email: string) {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: {
      shouldCreateUser: false,
    },
  });
  if (error) throw new Error(error.message);
  return { sent: true };
}

/**
 * Step 2: verify the 6-digit code the user received by email.
 * On success, Supabase sets up the session exactly like a normal login —
 * everything downstream (fetchMyRole, RLS, etc.) works unchanged.
 */
export async function verifyLoginOtp(email: string, token: string) {
  const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: token.trim(),
    type: "email",
  });
  if (error) throw new Error(error.message);
  return { session: data.session, store_name: STORE_NAME };
}

// ---------- API surface (kept identical to old `api.*` for minimal screen churn) ----------
export const api = {
  login: async (email: string, password: string) => login(email, password),

  // Inventory
  listInventory: async (): Promise<InventoryItem[]> => {
    const { data, error } = await supabase
      .from("inventory")
      .select("*")
      .order("category")
      .order("item_name");
    if (error) throw new Error(error.message);
    return (data || []) as InventoryItem[];
  },

  createInventory: async (body: Partial<InventoryItem>): Promise<InventoryItem> => {
    const payload = {
      item_id: (body.item_id || "").trim().toUpperCase(),
      category: body.category,
      item_name: body.item_name,
      price: body.price,
      cost_price: body.cost_price || 0,
      opening_qty: body.opening_qty,
      current_qty: body.current_qty ?? body.opening_qty,
      sold_qty: 0,
    };
    const { data, error } = await supabase.from("inventory").insert(payload).select().single();
    if (error)
      throw new Error(error.code === "23505" ? "Item ID already exists" : error.message);
    return data as InventoryItem;
  },

  updateInventory: async (id: string, body: Partial<InventoryItem>): Promise<InventoryItem> => {
    const upd: any = { ...body, last_updated: new Date().toISOString() };
    delete upd.id;
    delete upd.item_id;
    const { data, error } = await supabase
      .from("inventory")
      .update(upd)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as InventoryItem;
  },

  deleteInventory: async (id: string) => {
    const { error } = await supabase.from("inventory").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return { deleted: true };
  },

  // Bills
  createBill: async (body: {
    customer_mobile?: string | null;
    customer_name?: string | null;
    cash_amount: number;
    upi_amount: number;
    items: { inv_id: string; qty: number }[];
  }): Promise<Bill> => {
    const { data, error } = await supabase.rpc("create_bill", {
      p_customer_mobile: body.customer_mobile || null,
      p_customer_name: body.customer_name || null,
      p_items: body.items.map((i) => ({ inv_id: i.inv_id, qty: i.qty })),
      p_cash_amount: body.cash_amount,
      p_upi_amount: body.upi_amount,
    });
    if (error) throw new Error(error.message);
    const { data: full, error: e2 } = await supabase
      .from("v_bills_full")
      .select("*")
      .eq("id", (data as any).id)
      .single();
    if (e2) throw new Error(e2.message);
    return full as Bill;
  },

  listBills: async (params: {
    filter?: string;
    start_date?: string;
    end_date?: string;
    search?: string;
  }): Promise<Bill[]> => {
    let q = supabase.from("v_bills_full").select("*").order("iso", { ascending: false });
    const range = dateRangeForFilter(params.filter || "today", params.start_date, params.end_date);
    if (range) q = q.gte("date", range.from).lte("date", range.to);
    if (params.search && params.search.trim()) {
      const s = params.search.trim();
      q = q.or(`bill_number.ilike.%${s}%,customer_mobile.ilike.%${s}%`);
    }
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || []) as Bill[];
  },

  getBill: async (id: string): Promise<Bill> => {
    const { data, error } = await supabase.from("v_bills_full").select("*").eq("id", id).single();
    if (error) throw new Error(error.message);
    return data as Bill;
  },

  // ---- Exchange feature (owner only — enforced via RLS on bills UPDATE) ----
  exchangeBillItem: async (body: {
    bill_id: string;
    old_bill_item_id: string;
    new_inv_id: string;
    new_qty: number;
    cash_amount: number;
    upi_amount: number;
  }): Promise<{
    bill_id: string;
    old_item_name: string;
    new_item_name: string;
    price_diff: number;
    settlement_collected: number;
    new_gross_amount: number;
    new_discount: number;
    new_final_amount: number;
    exchanged_at: string;
  }> => {
    const { data, error } = await supabase.rpc("exchange_bill_item", {
      p_bill_id: body.bill_id,
      p_old_bill_item_id: body.old_bill_item_id,
      p_new_inv_id: body.new_inv_id,
      p_new_qty: body.new_qty,
      p_cash_amount: body.cash_amount,
      p_upi_amount: body.upi_amount,
    });
    if (error) throw new Error(error.message);
    return data as any;
  },

  getExchangeHistory: async (billId: string): Promise<ExchangeHistoryEntry[]> => {
    const { data, error } = await supabase
      .from("exchange_history")
      .select("*")
      .eq("bill_id", billId)
      .order("exchanged_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []) as ExchangeHistoryEntry[];
  },

  // Dashboard
  dashboard: async (): Promise<DashboardData> => {
    const today = todayIST();
    const [{ data: bills }, { data: inv }] = await Promise.all([
      supabase.from("v_bills_full").select("*").eq("date", today),
      supabase.from("inventory").select("current_qty"),
    ]);
    const list = bills || [];
    const total_sales = round2(sum(list, (b) => Number(b.final_amount)));
    const total_cash = round2(sum(list, (b) => Number(b.cash_amount)));
    const total_upi = round2(sum(list, (b) => Number(b.upi_amount)));
    const total_bills = list.length;
    const items_sold = list.reduce(
      (s, b) => s + ((b.items as any[]) || []).reduce((a, i) => a + Number(i.qty), 0),
      0
    );
    const discount_given = round2(sum(list, (b) => Number(b.discount)));
    const total_inventory_qty = (inv || []).reduce((a, i) => a + Number(i.current_qty), 0);
    const low_stock_count = (inv || []).filter((i) => Number(i.current_qty) <= 5).length;
    return {
      date: today,
      total_sales,
      total_cash,
      total_upi,
      total_bills,
      items_sold,
      discount_given,
      average_bill_value: total_bills ? round2(total_sales / total_bills) : 0,
      total_inventory_qty,
      low_stock_count,
      store_name: STORE_NAME,
    };
  },

  // Daily Report
  dailyReport: async (date?: string): Promise<DailyReport> => {
    const target = date || todayIST();
    const { data, error } = await supabase.from("v_bills_full").select("*").eq("date", target);
    if (error) throw new Error(error.message);
    const list = data || [];
    const total_sales = round2(sum(list, (b) => Number(b.final_amount)));
    return {
      date: target,
      total_bills: list.length,
      total_sales,
      total_cash: round2(sum(list, (b) => Number(b.cash_amount))),
      total_upi: round2(sum(list, (b) => Number(b.upi_amount))),
      discount_given: round2(sum(list, (b) => Number(b.discount))),
      items_sold: list.reduce(
        (s, b) => s + ((b.items as any[]) || []).reduce((a, i) => a + Number(i.qty), 0),
        0
      ),
      average_bill_value: list.length ? round2(total_sales / list.length) : 0,
    };
  },

  // Inventory Report
  inventoryReport: async (): Promise<InventoryReport> => {
    const { data, error } = await supabase
      .from("inventory")
      .select("*")
      .order("category")
      .order("item_name");
    if (error) throw new Error(error.message);
    const items = (data || []) as InventoryItem[];
    const total_opening = items.reduce((s, i) => s + i.opening_qty, 0);
    const total_current = items.reduce((s, i) => s + i.current_qty, 0);
    const total_sold = items.reduce((s, i) => s + i.sold_qty, 0);
    const low_stock = items.filter((i) => i.current_qty <= 5);
    return {
      items,
      summary: {
        total_opening,
        total_current,
        total_sold,
        low_stock_count: low_stock.length,
      },
      low_stock,
    };
  },

  // Category Report
  categoryReport: async (): Promise<{ rows: CategoryRow[] }> => {
    const [{ data: bills }, { data: inv }] = await Promise.all([
      supabase.from("v_bills_full").select("items"),
      supabase.from("inventory").select("item_id,category,cost_price"),
    ]);
    const costByItem: Record<string, number> = {};
    const catByItem: Record<string, string> = {};
    (inv || []).forEach((i: any) => {
      costByItem[i.item_id] = Number(i.cost_price) || 0;
      catByItem[i.item_id] = i.category;
    });
    const agg: Record<string, { qty: number; revenue: number; cost: number }> = {};
    (bills || []).forEach((b: any) => {
      (b.items || []).forEach((it: any) => {
        const cat = catByItem[it.item_id] || "Unknown";
        const row = agg[cat] || (agg[cat] = { qty: 0, revenue: 0, cost: 0 });
        row.qty += Number(it.qty);
        row.revenue += Number(it.line_total);
        row.cost += (costByItem[it.item_id] || 0) * Number(it.qty);
      });
    });
    const rows: CategoryRow[] = Object.entries(agg)
      .map(([category, r]) => {
        const revenue = round2(r.revenue);
        const cost = round2(r.cost);
        const profit = round2(revenue - cost);
        const margin = revenue > 0 ? round2((profit / revenue) * 100) : 0;
        return { category, qty_sold: r.qty, revenue, cost, profit, margin_pct: margin };
      })
      .sort((a, b) => b.revenue - a.revenue);
    return { rows };
  },

  // Customer lookup
  lookupCustomer: async (mobile: string): Promise<CustomerInfo> => {
    const { data, error } = await supabase
      .from("bills")
      .select("final_amount,customer_name,date")
      .eq("customer_mobile", mobile)
      .order("iso", { ascending: false });
    if (error) throw new Error(error.message);
    const list = data || [];
    if (list.length === 0) {
      return { mobile, is_returning: false, visits: 0, total_spent: 0, last_visit: null, last_name: null };
    }
    const total_spent = round2(list.reduce((s: number, b: any) => s + Number(b.final_amount), 0));
    const last_name = (list.find((b: any) => b.customer_name)?.customer_name) || null;
    return {
      mobile,
      is_returning: true,
      visits: list.length,
      total_spent,
      last_visit: list[0].date,
      last_name,
    };
  },

  // WhatsApp closing
  whatsappClosing: async (date?: string): Promise<WhatsAppClosing> => {
    const r = await api.dailyReport(date);
    const lines = [
      `*${STORE_NAME} — Daily Closing*`,
      `Date: ${r.date}`,
      "",
      `Bills: ${r.total_bills}`,
      `Total Sales: ₹${r.total_sales.toLocaleString("en-IN")}`,
      `Cash: ₹${r.total_cash.toLocaleString("en-IN")}`,
      `UPI: ₹${r.total_upi.toLocaleString("en-IN")}`,
      `Discount Given: ₹${r.discount_given.toLocaleString("en-IN")}`,
      `Items Sold: ${r.items_sold}`,
    ];
    const message = lines.join("\n");
    const encoded = encodeURIComponent(message);
    return {
      date: r.date,
      message,
      owner_numbers: OWNER_WHATSAPP_NUMBERS,
      links: OWNER_WHATSAPP_NUMBERS.map((n) => ({
        number: n,
        url: `https://wa.me/91${n}?text=${encoded}`,
      })),
    };
  },

  // Seed sample inventory (idempotent)
  seed: async () => {
    const { count } = await supabase
      .from("inventory")
      .select("*", { count: "exact", head: true });
    if ((count || 0) > 0) return { seeded: false };
    const samples = [
      ["PENDANT250", "Pendant", "Pendant 250", 250, 80, 100],
      ["PENDANT500", "Pendant", "Pendant 500", 500, 180, 50],
      ["EARRING200", "Earring", "Earring 200", 200, 60, 50],
      ["EARRING400", "Earring", "Earring 400", 400, 150, 30],
      ["RING300", "Ring", "Ring 300", 300, 100, 40],
      ["RING600", "Ring", "Ring 600", 600, 220, 20],
      ["BANGLE800", "Bangle", "Bangle 800", 800, 320, 15],
      ["NECKLACE1200", "Necklace", "Necklace 1200", 1200, 500, 10],
      ["BRACELET450", "Bracelet", "Bracelet 450", 450, 170, 25],
      ["ANKLET350", "Anklet", "Anklet 350", 350, 130, 5],
    ];
    const payload = samples.map(([item_id, category, name, price, cost, qty]) => ({
      item_id, category, item_name: name, price, cost_price: cost,
      opening_qty: qty, current_qty: qty, sold_qty: 0,
    }));
    const { error } = await supabase.from("inventory").insert(payload);
    if (error) throw new Error(error.message);
    return { seeded: true };
  },
};

// ---------- Expenses ----------
// ---------- Expenses Types ----------
export interface ExpenseItem {
  id?: string;
  expense_id?: string;
  amount: number;
  source: "personal" | "business" | "both";
  personal_amount: number;
  business_amount: number;
  note: string | null;
}

export interface Expense {
  id: string;
  expense_date: string; // YYYY-MM-DD
  parent_name: string;  // The overall description/title of the batch
  total_amount: number;
  amount: number;        // Alias for compatibility with old components
  source: "personal" | "business" | "both";
  personal_amount: number;
  business_amount: number;
  note: string | null;   // Concatenated or structural overview summary
  receipt_base64: string | null;
  receipt_mime: string | null;
  created_at: string;
  items?: ExpenseItem[]; // Nested child records
}

export interface ExpenseOverview {
  personal_fund_total: number;
  business_fund_total: number;
  personal_spent: number;
  business_spent: number;
  personal_balance: number;
  business_balance: number;
  total_expenses: number;
  entries: number;
}

// ---------- Enhanced Date Formatter ----------
export function formatDisplayDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const cleanDate = dateStr.split("T")[0]; // handle timestamp strings gracefully
  const [year, month, day] = cleanDate.split("-");
  if (!year || !month || !day) return dateStr;

  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  
  const monthName = months[parseInt(month, 10) - 1] || month;
  return `${parseInt(day, 10)} ${monthName} ${year}`;
}

// ---------- Updated Expenses API Surface ----------
export const expensesApi = {
  overview: async (): Promise<ExpenseOverview> => {
    const [salesRes, expRes, setRes] = await Promise.all([
      supabase.from("bills").select("final_amount"),
      supabase
        .from("expenses")
        .select("amount,personal_amount,business_amount"),
      supabase
        .from("app_settings")
        .select("value_num")
        .eq("key", "personal_fund_total")
        .maybeSingle(),
    ]);
    if (salesRes.error) throw new Error(salesRes.error.message);
    if (expRes.error) throw new Error(expRes.error.message);
    if (setRes.error && !setRes.error.message.includes("row"))
      throw new Error(setRes.error.message);

    const business_fund_total = round2(sum(salesRes.data || [], (b: any) => Number(b.final_amount)));
    const personal_spent = round2(sum(expRes.data || [], (e: any) => Number(e.personal_amount)));
    const business_spent = round2(sum(expRes.data || [], (e: any) => Number(e.business_amount)));
    const total_expenses = round2(sum(expRes.data || [], (e: any) => Number(e.amount)));
    const personal_fund_total = Number(setRes.data?.value_num ?? 200000);

    return {
      personal_fund_total,
      business_fund_total,
      personal_spent,
      business_spent,
      personal_balance: round2(personal_fund_total - personal_spent),
      business_balance: round2(business_fund_total - business_spent),
      total_expenses,
      entries: (expRes.data || []).length,
    };
  },

  list: async (): Promise<Expense[]> => {
    // Fetches parent records along with their child line items
    const { data, error } = await supabase
      .from("expenses")
      .select(`
        *,
        items:expense_items(*)
      `)
      .order("expense_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    
    return (data || []).map((e: any) => ({
      ...e,
      parent_name: e.parent_name || e.note || "Unnamed Batch",
      total_amount: e.amount
    })) as Expense[];
  },

  create: async (body: {
    expense_date: string;
    parent_name: string;
    amount: number;
    source: "personal" | "business" | "both";
    personal_amount: number;
    business_amount: number;
    note: string | null;
    receipt_base64?: string | null;
    receipt_mime?: string | null;
    items: ExpenseItem[];
  }): Promise<Expense> => {
    // 1. Insert Parent
    const { data: parent, error: pErr } = await supabase
      .from("expenses")
      .insert({
        expense_date: body.expense_date,
        parent_name: body.parent_name,
        amount: body.amount,
        source: body.source,
        personal_amount: body.personal_amount,
        business_amount: body.business_amount,
        note: body.note,
        receipt_base64: body.receipt_base64,
        receipt_mime: body.receipt_mime
      })
      .select()
      .single();

    if (pErr) throw new Error(pErr.message);

    // 2. Insert Children Linked to Parent
    if (body.items && body.items.length > 0) {
      const childrenPayload = body.items.map(item => ({
        expense_id: parent.id,
        amount: item.amount,
        source: item.source,
        personal_amount: item.personal_amount,
        business_amount: item.business_amount,
        note: item.note
      }));

      const { error: cErr } = await supabase.from("expense_items").insert(childrenPayload);
      if (cErr) throw new Error("Parent saved, but child line items failed: " + cErr.message);
    }

    return parent as Expense;
  },

  update: async (id: string, body: {
    expense_date: string;
    parent_name: string;
    amount: number;
    source: "personal" | "business" | "both";
    personal_amount: number;
    business_amount: number;
    note: string | null;
    items: ExpenseItem[];
  }): Promise<void> => {
    // 1. Update parent row
    const { error: pErr } = await supabase
      .from("expenses")
      .update({
        expense_date: body.expense_date,
        parent_name: body.parent_name,
        amount: body.amount,
        source: body.source,
        personal_amount: body.personal_amount,
        business_amount: body.business_amount,
        note: body.note
      })
      .eq("id", id);
    if (pErr) throw new Error(pErr.message);

    // 2. Drop historical child items and rewrite current stack state
    const { error: dErr } = await supabase.from("expense_items").delete().eq("expense_id", id);
    if (dErr) throw new Error(dErr.message);

    if (body.items && body.items.length > 0) {
      const childrenPayload = body.items.map(item => ({
        expense_id: id,
        amount: item.amount,
        source: item.source,
        personal_amount: item.personal_amount,
        business_amount: item.business_amount,
        note: item.note
      }));
      const { error: cErr } = await supabase.from("expense_items").insert(childrenPayload);
      if (cErr) throw new Error(cErr.message);
    }
  },

  setPersonalFund: async (value: number) => {
    const { error } = await supabase
      .from("app_settings")
      .upsert(
        { key: "personal_fund_total", value_num: value, updated_at: new Date().toISOString() },
        { onConflict: "key" }
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  },

  diagnose: async (): Promise<{ table: string; ok: boolean; message: string }[]> => {
    const tables = ["bills", "inventory", "expenses", "expense_items", "app_settings"];
    const out: { table: string; ok: boolean; message: string }[] = [];
    for (const t of tables) {
      const { error } = await supabase.from(t).select("*").limit(1);
      if (error) {
        out.push({ table: t, ok: false, message: error.message });
      } else {
        out.push({ table: t, ok: true, message: "reachable" });
      }
    }
    return out;
  },
};

// ---------- token helpers (kept for backward compatibility with screens) ----------
export async function getToken(): Promise<string | null> {
  const s = await getSession();
  return s?.access_token || null;
}
export async function clearToken() {
  await logout();
}
export async function setToken(_t: string) {
  // no-op — Supabase manages session in storage
}

// ---------- utils ----------
function sum<T>(arr: T[], f: (t: T) => number) {
  return arr.reduce((s, x) => s + (f(x) || 0), 0);
}
