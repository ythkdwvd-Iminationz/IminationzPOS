import AsyncStorage from "@react-native-async-storage/async-storage";

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const TOKEN_KEY = "iminationz_token";

export async function setToken(token: string) {
  await AsyncStorage.setItem(TOKEN_KEY, token);
}

export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function clearToken() {
  await AsyncStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}/api${path}`, { ...options, headers });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const detail = data?.detail || data || `Request failed (${res.status})`;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return data as T;
}

export const api = {
  login: (username: string, password: string) =>
    request<{ token: string; store_name: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  // Inventory
  listInventory: () => request<InventoryItem[]>("/inventory"),
  createInventory: (body: Partial<InventoryItem>) =>
    request<InventoryItem>("/inventory", { method: "POST", body: JSON.stringify(body) }),
  updateInventory: (id: string, body: Partial<InventoryItem>) =>
    request<InventoryItem>(`/inventory/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteInventory: (id: string) =>
    request<{ deleted: boolean }>(`/inventory/${id}`, { method: "DELETE" }),

  // Bills
  createBill: (body: any) => request<Bill>("/bills", { method: "POST", body: JSON.stringify(body) }),
  listBills: (params: { filter?: string; start_date?: string; end_date?: string; search?: string }) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v && qs.append(k, v));
    return request<Bill[]>(`/bills?${qs.toString()}`);
  },
  getBill: (id: string) => request<Bill>(`/bills/${id}`),

  // Dashboard & reports
  dashboard: () => request<DashboardData>("/dashboard/today"),
  dailyReport: (date?: string) =>
    request<DailyReport>(`/reports/daily${date ? `?date=${date}` : ""}`),
  inventoryReport: () => request<InventoryReport>("/reports/inventory"),
  categoryReport: () => request<{ rows: CategoryRow[] }>("/reports/category"),

  // Customer
  lookupCustomer: (mobile: string) =>
    request<CustomerInfo>(`/customers/${encodeURIComponent(mobile)}`),

  // WhatsApp
  whatsappClosing: (date?: string) =>
    request<WhatsAppClosing>(`/whatsapp/closing${date ? `?date=${date}` : ""}`),

  // Exports (return absolute URL with token in query for direct download via Linking)
  exportUrl: async (path: string, params: Record<string, string> = {}) => {
    const token = await getToken();
    const qs = new URLSearchParams({ ...params }).toString();
    return `${BASE_URL}/api${path}${qs ? `?${qs}` : ""}${qs ? "&" : "?"}_t=${encodeURIComponent(token || "")}`;
  },

  seed: () => request<{ seeded: boolean }>("/seed", { method: "POST" }),
};

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
  created_date: string;
  last_updated: string;
}

export interface BillItem {
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
  summary: {
    total_opening: number;
    total_current: number;
    total_sold: number;
    low_stock_count: number;
  };
  low_stock: InventoryItem[];
}
