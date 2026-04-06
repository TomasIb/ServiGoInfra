import requests
import sys
import json

# Your secure configuration
ACCESS_TOKEN = "APP_USR-6497687667850405-032321-d83fd37de836cf9d14a91577714a184e-3287488851"

def check_latest_payments():
    url = f"https://api.mercadopago.com/v1/payments/search?sort=date_created&criteria=desc&limit=5"
    headers = {
        "Authorization": f"Bearer {ACCESS_TOKEN}"
    }
    
    try:
        response = requests.get(url, headers=headers)
        if response.status_code == 200:
            data = response.json()
            print("\n🔍 --- RECENT MERCADO PAGO TRANSACTIONS ---")
            for payment in data.get('results', []):
                payment_id = payment.get('id')
                status = payment.get('status')
                amount = payment.get('transaction_amount')
                external_ref = payment.get('external_reference', 'N/A')
                captured = payment.get('captured', 'N/A')
                
                print(f"ID: {payment_id} | Ref: {external_ref} | Status: {status} | Amt: ${amount} | Captured: {captured}")
            print("-------------------------------------------\n")
        else:
            print(f"Error: {response.text}")
    except Exception as e:
        print(f"Exception: {e}")

if __name__ == "__main__":
    check_latest_payments()
