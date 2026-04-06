#!/bin/bash

# Secure Access Token
ACCESS_TOKEN="APP_USR-6497687667850405-032321-d83fd37de836cf9d14a91577714a184e-3287488851"

echo "🔍 Fetching latest Mercado Pago transactions..."
echo "--------------------------------------------------------"

curl -s -X GET "https://api.mercadopago.com/v1/payments/search?sort=date_created&criteria=desc&limit=5" \
     -H "Authorization: Bearer $ACCESS_TOKEN" | \
     python3 -c "
import sys, json
data = json.load(sys.stdin)
for payment in data.get('results', []):
    pid = payment.get('id')
    status = payment.get('status')
    collector = payment.get('collector_id', 'N/A')
    amount = payment.get('transaction_amount')
    external = payment.get('external_reference', 'N/A')
    captured = payment.get('captured', 'N/A')
    date = payment.get('date_created')[:10]
    print(f'[{date}] ID: {pid} | Collector: {collector} | Status: {status} | ${amount} | Cap: {captured}')
"

echo "--------------------------------------------------------"
