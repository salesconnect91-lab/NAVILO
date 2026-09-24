# NAVILO Phase 3 local business UAT evidence

Windows PowerShell output supplied by the user, captured 2026-09-23 20:39 UTC. It reports synthetic, local-only data and explicitly refuses production ref. The command output did not include a Git SHA; do not attribute this result to the later UI/language head. The last database migration commit in the branch before the output was 2026-09-23 20:37 UTC. This record reproduces the submitted result; it was not rerun here.

```json
{
  "environment": "local-only",
  "production_ref_refused": "ijdaosaqpbgnqojudjbj",
  "synthetic_data_only": true,
  "tested_date": "2026-09-23",
  "scope": [
    "sales",
    "purchase",
    "inventory",
    "AR",
    "AP",
    "journals",
    "returns",
    "reversals",
    "immutability",
    "period-control",
    "role-and-tenant-denials"
  ],
  "summary": {
    "total": 48,
    "passed": 48,
    "failed": 0
  },
  "evidence": [
    {
      "area": "purchase",
      "test": "valid purchase invoice posts",
      "expected": "success=true",
      "actual": "OK:{\"success\":true,\"status\":\"posted\",\"grand_total\":500}",
      "pass": true
    },
    {
      "area": "purchase",
      "test": "posted totals and AP outstanding",
      "expected": "posted,total=500,outstanding=500",
      "actual": "posted,500,500",
      "pass": true
    },
    {
      "area": "purchase",
      "test": "posted purchase preserves line names",
      "expected": "description and item/unit/godown snapshots populated",
      "actual": "Synthetic purchase line,PHASE3 Item 1790195929739-ec2474,pcs,PHASE3 Godown 1790195929739-ec2474",
      "pass": true
    },
    {
      "area": "inventory",
      "test": "purchase increases branch stock",
      "expected": "quantity=10",
      "actual": "quantity=10",
      "pass": true
    },
    {
      "area": "accounting",
      "test": "purchase journal balances",
      "expected": "debit=credit=500",
      "actual": "rows=2,debit=500,credit=500",
      "pass": true
    },
    {
      "area": "purchase",
      "test": "duplicate purchase posting is atomic",
      "expected": "denied,one journal,stock unchanged",
      "actual": "DENIED:HTTP_400:P0001:Purchase invoice P3-PO-MAIN-1790195929739-ec2474 is already posted.,journals=1,stock=10",
      "pass": true
    },
    {
      "area": "immutability",
      "test": "posted purchase cannot be edited",
      "expected": "denied or zero rows,total=500",
      "actual": "DENIED:HTTP_400:P0001:Posted purchase orders cannot be modified or deleted.,total=500",
      "pass": true
    },
    {
      "area": "immutability",
      "test": "posted purchase cannot be deleted",
      "expected": "denied or zero rows,row remains",
      "actual": "DENIED:HTTP_400:P0001:Posted purchase orders cannot be modified or deleted.,remaining=1",
      "pass": true
    },
    {
      "area": "accounts-payable",
      "test": "partial supplier payment posts",
      "expected": "success=true,payment=200",
      "actual": "OK:{\"success\":true,\"entry_no\":\"SP-0001\",\"payment_amount\":200}",
      "pass": true
    },
    {
      "area": "accounts-payable",
      "test": "supplier payment updates AP status",
      "expected": "paid=200,outstanding=300,partial",
      "actual": "200,300,partial",
      "pass": true
    },
    {
      "area": "accounts-payable",
      "test": "supplier overpayment is rejected",
      "expected": "denied for outstanding-limit violation",
      "actual": "DENIED:HTTP_400:P0001:Payment exceeds Purchase Invoice outstanding balance. Outstanding: 300.00, Payment: 400.00.",
      "pass": true
    },
    {
      "area": "accounts-payable",
      "test": "supplier payment reversal posts",
      "expected": "success=true",
      "actual": "OK:{\"success\":true}",
      "pass": true
    },
    {
      "area": "accounts-payable",
      "test": "supplier reversal restores AP outstanding",
      "expected": "paid=0,outstanding=500,unpaid,no allocation",
      "actual": "0,500,unpaid,allocations=0",
      "pass": true
    },
    {
      "area": "accounting",
      "test": "duplicate supplier-payment reversal rejected",
      "expected": "denied as already reversed",
      "actual": "DENIED:HTTP_400:P0001:This payment voucher has already been reversed.",
      "pass": true
    },
    {
      "area": "sales",
      "test": "valid credit sales invoice posts",
      "expected": "success=true",
      "actual": "OK:{\"success\":true}",
      "pass": true
    },
    {
      "area": "sales",
      "test": "sales total and AR outstanding",
      "expected": "posted,total=400,outstanding=400",
      "actual": "posted,400,400",
      "pass": true
    },
    {
      "area": "sales",
      "test": "posted sale preserves line names",
      "expected": "description and item/unit/godown snapshots populated",
      "actual": "Synthetic sales line,PHASE3 Item 1790195929739-ec2474,pcs,PHASE3 Godown 1790195929739-ec2474",
      "pass": true
    },
    {
      "area": "inventory",
      "test": "sales posting decreases branch stock",
      "expected": "quantity=6",
      "actual": "quantity=6",
      "pass": true
    },
    {
      "area": "accounting",
      "test": "sales revenue and COGS journal balances",
      "expected": "balanced debit=credit",
      "actual": "rows=4,debit=600,credit=600",
      "pass": true
    },
    {
      "area": "sales",
      "test": "duplicate sales posting is atomic",
      "expected": "denied,one journal,stock unchanged",
      "actual": "DENIED:HTTP_400:P0001:Invoice P3-SI-MAIN-1790195929739-ec2474 is already posted.,journals=1,stock=6",
      "pass": true
    },
    {
      "area": "immutability",
      "test": "posted sales invoice cannot be edited",
      "expected": "denied or zero rows,total=400",
      "actual": "DENIED:HTTP_400:P0001:Posted sales invoices are immutable; only payment status fields may change.,total=400",
      "pass": true
    },
    {
      "area": "immutability",
      "test": "posted sales invoice cannot be deleted",
      "expected": "denied or zero rows,row remains",
      "actual": "ROWS:0,remaining=1",
      "pass": true
    },
    {
      "area": "accounts-receivable",
      "test": "partial customer receipt posts",
      "expected": "success=true,payment=150",
      "actual": "OK:{\"success\":true,\"entry_no\":\"CR-0001\",\"payment_amount\":150,\"allocated_amount\":150}",
      "pass": true
    },
    {
      "area": "accounts-receivable",
      "test": "receipt updates AR status",
      "expected": "paid=150,outstanding=250,partial",
      "actual": "150,250,partial",
      "pass": true
    },
    {
      "area": "accounts-receivable",
      "test": "customer over-allocation is rejected",
      "expected": "denied for outstanding-limit violation",
      "actual": "DENIED:HTTP_400:P0001:Allocation for invoice P3-SI-MAIN-1790195929739-ec2474 exceeds outstanding balance. Outstanding: 250.00, Allocation: 300.00.",
      "pass": true
    },
    {
      "area": "accounts-receivable",
      "test": "customer receipt reversal posts",
      "expected": "success=true",
      "actual": "OK:{\"success\":true}",
      "pass": true
    },
    {
      "area": "accounts-receivable",
      "test": "receipt reversal restores AR outstanding",
      "expected": "paid=0,outstanding=400,unpaid,no allocation",
      "actual": "0,400,unpaid,allocations=0",
      "pass": true
    },
    {
      "area": "isolation",
      "test": "tenant B cannot post company A invoice",
      "expected": "denied,draft unchanged",
      "actual": "DENIED:HTTP_400:P0001:Sales invoice not found in active business unit.,status=draft",
      "pass": true
    },
    {
      "area": "permissions",
      "test": "viewer cannot post sales invoice",
      "expected": "denied,draft unchanged",
      "actual": "DENIED:HTTP_400:P0001:Permission denied for sales post.,status=draft",
      "pass": true
    },
    {
      "area": "permissions",
      "test": "accounts role cannot post sales invoice",
      "expected": "denied,draft unchanged",
      "actual": "DENIED:HTTP_400:P0001:Permission denied for sales post.,status=draft",
      "pass": true
    },
    {
      "area": "permissions",
      "test": "sales role cannot post purchase invoice",
      "expected": "denied,draft unchanged",
      "actual": "DENIED:HTTP_400:P0001:Permission denied for purchase post.,status=draft",
      "pass": true
    },
    {
      "area": "permissions",
      "test": "revoked role cannot create receipt",
      "expected": "denied",
      "actual": "DENIED:HTTP_400:P0001:No active company selected.",
      "pass": true
    },
    {
      "area": "security",
      "test": "anonymous posting RPC is denied",
      "expected": "HTTP 401/403/404",
      "actual": "DENIED:HTTP_401:42501:permission denied for function post_sales_invoice",
      "pass": true
    },
    {
      "area": "returns",
      "test": "sales credit note posts atomically",
      "expected": "success=true,total=100",
      "actual": "OK:{\"success\":true,\"note_no\":\"CN-2026-0001\",\"total\":100}",
      "pass": true
    },
    {
      "area": "returns",
      "test": "sales return restores stock and reduces AR",
      "expected": "stock=7,outstanding=300",
      "actual": "stock=7,outstanding=300",
      "pass": true
    },
    {
      "area": "returns",
      "test": "sales over-return is rejected atomically",
      "expected": "denied,stock=7",
      "actual": "DENIED:HTTP_400:P0001:Return quantity exceeds remaining quantity for an invoice line.,stock=7",
      "pass": true
    },
    {
      "area": "returns",
      "test": "purchase debit note posts atomically",
      "expected": "success=true,total=50",
      "actual": "OK:{\"success\":true,\"note_no\":\"DN-2026-0001\",\"total\":50}",
      "pass": true
    },
    {
      "area": "returns",
      "test": "purchase return removes stock and reduces AP",
      "expected": "stock=6,outstanding=450",
      "actual": "stock=6,outstanding=450",
      "pass": true
    },
    {
      "area": "accounting",
      "test": "unbalanced journal is rejected atomically",
      "expected": "denied,draft,no ledger",
      "actual": "DENIED:HTTP_400:P0001:Journal is not balanced. Debit: 25.00, Credit: 20.00.,status=draft,ledgers=0",
      "pass": true
    },
    {
      "area": "accounting",
      "test": "balanced manual journal posts",
      "expected": "success=true,posted,debit=credit=25",
      "actual": "OK:{\"success\":true,\"status\":\"posted\"},status=posted,debit=25,credit=25",
      "pass": true
    },
    {
      "area": "immutability",
      "test": "posted journal cannot be edited",
      "expected": "denied or zero rows,description unchanged",
      "actual": "DENIED:HTTP_400:P0001:Posted journal entries cannot be modified.,description=Synthetic Phase 3 journal",
      "pass": true
    },
    {
      "area": "accounting",
      "test": "manual journal reversal posts",
      "expected": "success=true",
      "actual": "OK:{\"success\":true}",
      "pass": true
    },
    {
      "area": "accounting",
      "test": "manual reversal is balanced",
      "expected": "debit=credit=25",
      "actual": "rows=2,debit=25,credit=25",
      "pass": true
    },
    {
      "area": "accounting",
      "test": "duplicate manual reversal rejected",
      "expected": "denied",
      "actual": "DENIED:HTTP_400:P0001:This journal entry has already beenreversed.",
      "pass": true
    },
    {
      "area": "period-control",
      "test": "accounting year initializes",
      "expected": "success=true",
      "actual": "OK:{\"success\":true}",
      "pass": true
    },
    {
      "area": "period-control",
      "test": "current accounting period closes",
      "expected": "success=true,status=closed",
      "actual": "OK:{\"success\":true,\"status\":\"closed\"}",
      "pass": true
    },
    {
      "area": "period-control",
      "test": "posting into closed period is rejected",
      "expected": "denied,draft",
      "actual": "DENIED:HTTP_400:P0001:Accounting period for 2026-09-23 isclosed. Reopen the period before posting.,status=draft",
      "pass": true
    },
    {
      "area": "period-control",
      "test": "synthetic period is reopened after test",
      "expected": "success=true,status=open",
      "actual": "OK:{\"success\":true,\"status\":\"open\"}",
      "pass": true
    }
  ]
}
```

