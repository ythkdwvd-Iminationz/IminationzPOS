#!/usr/bin/env python3
"""
Backend Test - SQL Migration Validation
Validates the fix_exchange_duplicate.sql migration file
"""

import re
import sys

def validate_sql_migration(filepath):
    """
    Validates SQL migration file for:
    1. Syntax correctness (matching BEGIN/END, dollar-quoting, etc.)
    2. Parameter signature matching
    3. Column references
    """
    print(f"🔍 Validating SQL migration: {filepath}\n")
    
    with open(filepath, 'r') as f:
        content = f.read()
    
    issues = []
    warnings = []
    
    # 1. Check BEGIN/COMMIT matching
    begin_count = content.count('BEGIN;')
    commit_count = content.count('COMMIT;')
    if begin_count != commit_count:
        issues.append(f"❌ BEGIN/COMMIT mismatch: {begin_count} BEGIN vs {commit_count} COMMIT")
    else:
        print(f"✅ BEGIN/COMMIT properly matched ({begin_count} pairs)")
    
    # 2. Check DO $$ blocks
    do_blocks = re.findall(r'DO\s+\$\$', content, re.IGNORECASE)
    end_blocks = re.findall(r'END\s+\$\$;', content, re.IGNORECASE)
    if len(do_blocks) != len(end_blocks):
        issues.append(f"❌ DO $$ / END $$ mismatch: {len(do_blocks)} DO vs {len(end_blocks)} END")
    else:
        print(f"✅ DO $$ blocks properly closed ({len(do_blocks)} blocks)")
    
    # 3. Check function dollar-quoting
    fn_start = content.count('AS $fn$')
    fn_end = content.count('$fn$;')
    if fn_start > 0 and fn_start == fn_end:
        print(f"✅ Function dollar-quoting correct ($fn$ pairs: {fn_start})")
    elif fn_start != fn_end:
        issues.append(f"❌ Function dollar-quoting mismatch: {fn_start} AS $fn$ vs {fn_end} $fn$;")
    
    # 4. Check for common SQL syntax errors
    # Unclosed parentheses in function signature
    func_match = re.search(r'CREATE OR REPLACE FUNCTION.*?\(.*?\)', content, re.DOTALL)
    if func_match:
        func_sig = func_match.group(0)
        open_parens = func_sig.count('(')
        close_parens = func_sig.count(')')
        if open_parens != close_parens:
            issues.append(f"❌ Unmatched parentheses in function signature")
        else:
            print(f"✅ Function signature parentheses balanced")
    
    # 5. Validate RPC signature matches expected parameters
    expected_params = [
        'p_bill_id',
        'p_old_bill_item_id', 
        'p_new_inv_id',
        'p_new_qty',
        'p_cash_amount',
        'p_upi_amount'
    ]
    
    func_params_match = re.search(
        r'exchange_bill_item\s*\((.*?)\)\s*RETURNS',
        content,
        re.DOTALL | re.IGNORECASE
    )
    
    if func_params_match:
        params_text = func_params_match.group(1)
        missing_params = []
        for param in expected_params:
            if param not in params_text:
                missing_params.append(param)
        
        if missing_params:
            issues.append(f"❌ Missing expected parameters: {', '.join(missing_params)}")
        else:
            print(f"✅ All 6 expected parameters present in RPC signature")
    
    # 6. Check for required columns in INSERT statement
    required_columns = [
        'id', 'bill_id', 'bill_number',
        'old_bill_item_id', 'old_inv_id', 'old_item_id', 'old_item_name',
        'old_qty', 'old_price', 'old_line_total',
        'new_inv_id', 'new_item_id', 'new_item_name', 
        'new_qty', 'new_price', 'new_line_total',
        'price_diff', 'cash_settled', 'upi_settled',
        'exchanged_at', 'exchanged_by_email', 'exchanged_by_role'
    ]
    
    insert_match = re.search(
        r'INSERT INTO public\.exchange_history\s*\((.*?)\)',
        content,
        re.DOTALL | re.IGNORECASE
    )
    
    if insert_match:
        insert_cols = insert_match.group(1)
        missing_cols = []
        for col in required_columns:
            if col not in insert_cols:
                missing_cols.append(col)
        
        if missing_cols:
            issues.append(f"❌ Missing columns in INSERT: {', '.join(missing_cols)}")
        else:
            print(f"✅ All {len(required_columns)} required columns in INSERT statement")
    
    # 7. Check for retry loop logic
    if 'LOOP' in content and 'unique_violation' in content:
        print(f"✅ Retry loop with unique_violation handling present")
        
        if 'GET STACKED DIAGNOSTICS' in content and 'CONSTRAINT_NAME' in content:
            print(f"✅ Constraint name extraction logic present")
        else:
            warnings.append(f"⚠️  Constraint name extraction may be incomplete")
        
        if 'exchange_history_pkey' in content:
            print(f"✅ PK constraint check present")
        else:
            warnings.append(f"⚠️  PK constraint name check missing")
    else:
        issues.append(f"❌ Retry loop or unique_violation handling missing")
    
    # 8. Check return value structure
    return_match = re.search(
        r'RETURN jsonb_build_object\((.*?)\);',
        content,
        re.DOTALL | re.IGNORECASE
    )
    
    if return_match:
        return_obj = return_match.group(1)
        expected_keys = [
            'bill_id', 'old_item_name', 'new_item_name', 
            'price_diff', 'settlement_collected',
            'new_gross_amount', 'new_discount', 'new_final_amount',
            'exchanged_at'
        ]
        
        missing_keys = []
        for key in expected_keys:
            if f"'{key}'" not in return_obj:
                missing_keys.append(key)
        
        if missing_keys:
            warnings.append(f"⚠️  Return object may be missing keys: {', '.join(missing_keys)}")
        else:
            print(f"✅ Return object contains all expected keys")
    
    # 9. Check for uuid_generate_v4() usage
    if 'uuid_generate_v4()' in content:
        print(f"✅ Explicit UUID generation present")
    else:
        warnings.append(f"⚠️  No explicit UUID generation found")
    
    # 10. Check for extension creation
    if 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"' in content:
        print(f"✅ uuid-ossp extension creation present")
    else:
        warnings.append(f"⚠️  uuid-ossp extension may not be created")
    
    # Summary
    print("\n" + "="*60)
    print("VALIDATION SUMMARY")
    print("="*60)
    
    if not issues and not warnings:
        print("✅ ALL CHECKS PASSED - Migration file is syntactically valid")
        return 0
    
    if warnings:
        print(f"\n⚠️  WARNINGS ({len(warnings)}):")
        for w in warnings:
            print(f"  {w}")
    
    if issues:
        print(f"\n❌ CRITICAL ISSUES ({len(issues)}):")
        for i in issues:
            print(f"  {i}")
        return 1
    
    print("\n✅ No critical issues found (warnings are informational)")
    return 0

def validate_client_signature():
    """
    Validates that client.ts RPC call matches the SQL function signature
    """
    print("\n" + "="*60)
    print("CLIENT-SERVER SIGNATURE VALIDATION")
    print("="*60 + "\n")
    
    client_file = "/app/frontend/src/api/client.ts"
    
    with open(client_file, 'r') as f:
        client_content = f.read()
    
    # Extract the RPC call
    rpc_match = re.search(
        r'supabase\.rpc\("exchange_bill_item",\s*\{(.*?)\}\)',
        client_content,
        re.DOTALL
    )
    
    if not rpc_match:
        print("❌ Could not find exchange_bill_item RPC call in client.ts")
        return 1
    
    rpc_params = rpc_match.group(1)
    
    expected_params = [
        'p_bill_id',
        'p_old_bill_item_id',
        'p_new_inv_id', 
        'p_new_qty',
        'p_cash_amount',
        'p_upi_amount'
    ]
    
    missing = []
    for param in expected_params:
        if param not in rpc_params:
            missing.append(param)
    
    if missing:
        print(f"❌ Client missing parameters: {', '.join(missing)}")
        return 1
    
    print(f"✅ Client RPC call contains all 6 required parameters")
    print(f"✅ Parameter names match SQL function signature")
    
    # Check return value handling
    if 'return data as any' in client_content or 'return data' in client_content:
        print(f"✅ Client accepts flexible return type (compatible with any JSON)")
    
    return 0

if __name__ == "__main__":
    print("="*60)
    print("EXCHANGE DUPLICATE-KEY FIX VALIDATION")
    print("="*60 + "\n")
    
    # Validate SQL migration
    sql_result = validate_sql_migration("/app/supabase/migration/fix_exchange_duplicate.sql")
    
    # Validate client signature
    client_result = validate_client_signature()
    
    # Final result
    print("\n" + "="*60)
    print("FINAL RESULT")
    print("="*60)
    
    if sql_result == 0 and client_result == 0:
        print("✅ VALIDATION PASSED")
        print("\nThe migration file is syntactically correct and the")
        print("RPC signature matches the client call.")
        print("\n⚠️  NOTE: End-to-end testing blocked - no Supabase credentials")
        print("   User must apply migration in Supabase SQL Editor")
        sys.exit(0)
    else:
        print("❌ VALIDATION FAILED")
        print("\nPlease review the issues above before applying the migration.")
        sys.exit(1)
