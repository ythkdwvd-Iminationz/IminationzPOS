// Standalone unit-style test for the categoryReport() proration logic
// found in /app/frontend/src/api/client.ts (lines 491-528).
// Since we can't easily import a .ts file directly in a Node script without
// bundling, we replicate the exact aggregation code below and drive it with
// mocked supabase responses.

function round2(n) { return Math.round(n * 100) / 100; }

// ---- REPLICA of api.categoryReport() core aggregation logic ----
function categoryReportAggregate(bills, inv) {
  const costByItem = {};
  const catByItem = {};
  (inv || []).forEach((i) => {
    costByItem[i.item_id] = Number(i.cost_price) || 0;
    catByItem[i.item_id] = i.category;
  });
  const agg = {};
  (bills || []).forEach((b) => {
    const gross = Number(b.gross_amount) || 0;
    const finalAmt = Number(b.final_amount) || 0;
    const ratio = gross > 0 ? finalAmt / gross : 1;
    (b.items || []).forEach((it) => {
      const cat = catByItem[it.item_id] || "Unknown";
      const row = agg[cat] || (agg[cat] = { qty: 0, revenue: 0, cost: 0 });
      row.qty += Number(it.qty);
      row.revenue += Number(it.line_total) * ratio;
      row.cost += (costByItem[it.item_id] || 0) * Number(it.qty);
    });
  });
  return Object.entries(agg)
    .map(([category, r]) => {
      const revenue = round2(r.revenue);
      const cost = round2(r.cost);
      const profit = round2(revenue - cost);
      const margin = revenue > 0 ? round2((profit / revenue) * 100) : 0;
      return { category, qty_sold: r.qty, revenue, cost, profit, margin_pct: margin };
    })
    .sort((a, b) => b.revenue - a.revenue);
}

let pass = 0, fail = 0;
function assertEq(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { console.log(`PASS: ${name}`); pass++; }
  else    { console.log(`FAIL: ${name}\n   expected: ${JSON.stringify(expected)}\n   actual:   ${JSON.stringify(actual)}`); fail++; }
}

// ---- FIXTURES ----
const inv = [
  { item_id: "PEN001", category: "Pendant", cost_price: 100 },
  { item_id: "RING001", category: "Ring",    cost_price: 200 },
];

// Bill A: 100% discount → gross=1000, final=0 → revenue must be 0
// Bill B:   0% discount → gross=1000, final=1000 → revenue must be 1000
const bills = [
  {
    gross_amount: 1000, discount: 1000, final_amount: 0,
    items: [{ item_id: "PEN001", qty: 1, line_total: 1000 }],
  },
  {
    gross_amount: 1000, discount: 0, final_amount: 1000,
    items: [{ item_id: "RING001", qty: 1, line_total: 1000 }],
  },
];

// ---- TEST 1: proration correctness ----
const rows = categoryReportAggregate(bills, inv);
const pendant = rows.find(r => r.category === "Pendant");
const ring    = rows.find(r => r.category === "Ring");

assertEq("Pendant revenue is 0 for 100% discount bill", pendant.revenue, 0);
assertEq("Ring revenue is 1000 for 0% discount bill",   ring.revenue, 1000);
assertEq("Pendant qty_sold still counted",              pendant.qty_sold, 1);
assertEq("Pendant profit = 0 - 100 = -100",             pendant.profit, -100);
assertEq("Ring profit = 1000 - 200 = 800",              ring.profit, 800);

// ---- TEST 2: partial discount proration ----
const partial = [{
  gross_amount: 1000, discount: 100, final_amount: 900,
  items: [
    { item_id: "PEN001", qty: 1, line_total: 400 }, // → 400 * 0.9 = 360
    { item_id: "RING001", qty: 1, line_total: 600 }, // → 600 * 0.9 = 540
  ],
}];
const rowsP = categoryReportAggregate(partial, inv);
assertEq("Partial: Pendant prorated to 360", rowsP.find(r=>r.category==="Pendant").revenue, 360);
assertEq("Partial: Ring prorated to 540",    rowsP.find(r=>r.category==="Ring").revenue,    540);

// ---- TEST 3: gross=0 safety fallback ----
const zeroGross = [{
  gross_amount: 0, discount: 0, final_amount: 0,
  items: [{ item_id: "PEN001", qty: 1, line_total: 0 }],
}];
const rowsZ = categoryReportAggregate(zeroGross, inv);
assertEq("Gross=0 safety: revenue = raw line_total (0)", rowsZ[0].revenue, 0);

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
