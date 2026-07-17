# Exchange Duplicate-Key Fix - Detailed Analysis

## Overview
This document provides a comprehensive analysis of the `fix_exchange_duplicate.sql` migration that addresses the duplicate-key error in the exchange flow.

## Problem Statement
User reported: "Exchange is not working — getting duplicate key error" when performing item exchanges via the Sales screen ExchangeModal.

## Root Cause Analysis
The original `exchange_bill_item()` RPC (from `exchange.sql` and later `whole_numbers.sql`) had no defensive handling for `unique_violation` exceptions. While UUID collisions are astronomically rare, they can occur due to:
1. UUID generation collision (extremely rare but possible)
2. Legacy data with duplicate IDs
3. Other unique constraints being violated (e.g., if additional unique indexes were added)

## Solution Implemented

### Key Changes in `fix_exchange_duplicate.sql`

#### 1. **Explicit UUID Generation with Retry Loop** (Lines 199-240)
```sql
LOOP
  v_history_id := uuid_generate_v4();
  BEGIN
    INSERT INTO public.exchange_history(...) VALUES (...);
    EXIT;  -- Success
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint = 'exchange_history_pkey' THEN
      v_retries := v_retries + 1;
      IF v_retries > 5 THEN
        RAISE EXCEPTION 'Could not allocate a unique exchange_history id after % retries', v_retries;
      END IF;
      CONTINUE;  -- Retry with fresh UUID
    ELSE
      RAISE EXCEPTION 'Exchange blocked by unique constraint "%": please share this text with support', v_constraint;
    END IF;
  END;
END LOOP;
```

**Benefits:**
- Handles UUID collision by retrying up to 5 times
- Explicitly generates UUID instead of relying on table default
- Catches and identifies the specific constraint causing the violation
- Provides clear error messages for debugging

#### 2. **Enhanced Error Reporting**
- Uses `GET STACKED DIAGNOSTICS` to extract constraint name
- Re-raises violations with constraint name included
- Helps identify root cause if the issue is NOT the PK

#### 3. **Improved User Role Lookup** (Line 177)
```sql
SELECT role INTO v_role FROM public.user_roles
 WHERE lower(trim(email)) = lower(trim(v_email));
```

**Improvement over original:**
- Case-insensitive email matching
- Trims whitespace
- More robust against data inconsistencies

#### 4. **Configurable Discount Logic** (Lines 148-156)
```sql
IF to_regclass('public.app_settings') IS NOT NULL THEN
  SELECT COALESCE(value_text,'percent') INTO v_disc_type
    FROM public.app_settings WHERE key = 'discount_type';
  SELECT COALESCE(value_num, 10) INTO v_disc_value
    FROM public.app_settings WHERE key = 'discount_value';
  SELECT COALESCE(value_num, 699) INTO v_disc_min
    FROM public.app_settings WHERE key = 'discount_min_order';
END IF;
```

**Benefits:**
- Reads discount config from `app_settings` table
- Consistent with `custom_pricing.sql` and `billing_config_damaged.sql`
- Allows owner to configure discount rules

## Validation Results

### ✅ SQL Syntax Validation
- BEGIN/COMMIT properly matched (1 pair)
- DO $$ blocks properly closed (1 block)
- Function dollar-quoting correct ($fn$ pairs: 1)
- Function signature parentheses balanced
- All 6 expected parameters present
- All 22 required columns in INSERT statement
- Retry loop with unique_violation handling present
- Constraint name extraction logic present
- PK constraint check present
- Return object contains all expected keys
- Explicit UUID generation present
- uuid-ossp extension creation present

### ✅ Client-Server Signature Match
**SQL Function Signature:**
```sql
exchange_bill_item(
  p_bill_id uuid,
  p_old_bill_item_id uuid,
  p_new_inv_id uuid,
  p_new_qty integer,
  p_cash_amount numeric,
  p_upi_amount numeric
) RETURNS jsonb
```

**Client RPC Call (client.ts:372-379):**
```typescript
supabase.rpc("exchange_bill_item", {
  p_bill_id: body.bill_id,
  p_old_bill_item_id: body.old_bill_item_id,
  p_new_inv_id: body.new_inv_id,
  p_new_qty: body.new_qty,
  p_cash_amount: toWholeNumber(body.cash_amount),
  p_upi_amount: toWholeNumber(body.upi_amount),
})
```

**Result:** ✅ Perfect match - all 6 parameters match in name and type

### ✅ Return Value Compatibility
**SQL Returns:**
```json
{
  "bill_id": uuid,
  "old_item_name": text,
  "new_item_name": text,
  "price_diff": numeric,
  "settlement_collected": numeric,
  "new_gross_amount": numeric,
  "new_discount": numeric,
  "new_final_amount": numeric,
  "exchanged_at": timestamptz
}
```

**Client Expects:** `return data as any;` (flexible, accepts any JSON)

**Result:** ✅ Compatible - client accepts any JSON structure

## Schema Consistency

### exchange_history Table Columns
All columns referenced in the INSERT statement match the schema defined in `exchange.sql`:

| Column | Type | Present in Schema | Present in Migration |
|--------|------|-------------------|---------------------|
| id | uuid | ✅ | ✅ |
| bill_id | uuid | ✅ | ✅ |
| bill_number | text | ✅ | ✅ |
| old_bill_item_id | uuid | ✅ | ✅ |
| old_inv_id | uuid | ✅ | ✅ |
| old_item_id | text | ✅ | ✅ |
| old_item_name | text | ✅ | ✅ |
| old_qty | integer | ✅ | ✅ |
| old_price | numeric(12,2) | ✅ | ✅ |
| old_line_total | numeric(12,2) | ✅ | ✅ |
| new_inv_id | uuid | ✅ | ✅ |
| new_item_id | text | ✅ | ✅ |
| new_item_name | text | ✅ | ✅ |
| new_qty | integer | ✅ | ✅ |
| new_price | numeric(12,2) | ✅ | ✅ |
| new_line_total | numeric(12,2) | ✅ | ✅ |
| price_diff | numeric(12,2) | ✅ | ✅ |
| cash_settled | numeric(12,2) | ✅ | ✅ |
| upi_settled | numeric(12,2) | ✅ | ✅ |
| exchanged_at | timestamptz | ✅ | ✅ |
| exchanged_by_email | text | ✅ | ✅ |
| exchanged_by_role | text | ✅ | ✅ |

## Whole Numbers Consistency

The migration correctly uses `numeric(12,0)` (whole numbers) throughout, consistent with the `whole_numbers.sql` migration that was previously applied. All amounts are rounded to 0 decimal places using `round(..., 0)`.

## Testing Limitations

### ⚠️ Environmental Blocker
End-to-end testing via the UI cannot be executed in this workspace because:
- `/app/frontend/.env` is empty (no Supabase credentials)
- No `SUPABASE_URL` or `SUPABASE_ANON_KEY` available
- Cannot connect to a live Supabase instance

### What Was Tested
✅ SQL syntax validation (parse-only)
✅ Function signature matching
✅ Column reference validation
✅ Return value structure
✅ Client-server contract verification

### What Cannot Be Tested
❌ Actual execution against a Supabase database
❌ Runtime behavior of the retry loop
❌ Constraint violation handling
❌ End-to-end exchange flow via UI

## Recommendations

### For User
1. **Apply the migration** in Supabase SQL Editor:
   - Copy entire contents of `/app/supabase/migration/fix_exchange_duplicate.sql`
   - Paste into Supabase → SQL Editor
   - Click "Run"

2. **Test the exchange flow**:
   - Go to Sales tab
   - Find an existing bill
   - Click "Exchange" on a line item
   - Select a new item and quantity
   - Complete the exchange
   - Verify no duplicate-key error occurs

3. **If the error persists**:
   - The error message will now include the constraint name
   - Share the full error text with support
   - This will reveal if a different unique constraint is being violated

### For Future Enhancements
1. Consider adding a unique index on `(bill_id, old_bill_item_id, exchanged_at)` if multiple exchanges of the same item should be prevented
2. Add monitoring/logging for UUID collision retries (currently silent)
3. Consider using `gen_random_uuid()` (PostgreSQL 13+) instead of `uuid_generate_v4()` for better performance

## Conclusion

The migration file is **syntactically correct** and **logically sound**. The defensive retry loop properly handles UUID collisions, and the enhanced error reporting will help diagnose any other unique constraint violations. The fix is ready for user application in their Supabase SQL Editor.

**Status:** ✅ READY FOR DEPLOYMENT (user-applied via SQL Editor)
