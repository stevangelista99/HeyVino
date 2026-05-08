#!/usr/bin/env python3
import sys; sys.stdout.reconfigure(encoding='utf-8')
"""
HeyVino Gmail Parser
Reads HeyVinoPromos@gmail.com, extracts promo codes from winery emails,
and saves them to Supabase.
"""

import os
import json
import base64
import re
from datetime import datetime

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
import anthropic
from supabase import create_client

SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']
CREDENTIALS_FILE = 'credentials.json'
TOKEN_FILE = 'token.json'

SUPABASE_URL = "https://lzeicurexdpludaltetf.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6ZWljdXJleGRwbHVkYWx0ZXRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5NTY2NTMsImV4cCI6MjA5MzUzMjY1M30.94s0cX_FcJkUAJLT75MOo48ShZ0KZBRQUHVmdfSzf_8"

ANTHROPIC_CLIENT = anthropic.Anthropic()

def get_gmail_service():
    creds = None
    if os.path.exists(TOKEN_FILE):
        creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_FILE, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(TOKEN_FILE, 'w') as token:
            token.write(creds.to_json())
    return build('gmail', 'v1', credentials=creds)

def get_recent_emails(service, max_results=50):
    query = 'is:unread (wine OR winery OR vineyard OR promo OR discount OR offer OR code)'
    results = service.users().messages().list(
        userId='me', q=query, maxResults=max_results
    ).execute()
    messages = results.get('messages', [])
    emails = []
    for msg in messages:
        msg_data = service.users().messages().get(
            userId='me', id=msg['id'], format='full'
        ).execute()
        headers = {h['name']: h['value'] for h in msg_data['payload']['headers']}
        body = extract_body(msg_data['payload'])
        emails.append({
            'id': msg['id'],
            'subject': headers.get('Subject', ''),
            'sender': headers.get('From', ''),
            'date': headers.get('Date', ''),
            'body': body[:3000]
        })
    return emails

def extract_body(payload):
    body = ''
    if 'parts' in payload:
        for part in payload['parts']:
            if part['mimeType'] == 'text/plain':
                data = part['body'].get('data', '')
                if data:
                    body += base64.urlsafe_b64decode(data).decode('utf-8', errors='ignore')
            elif part['mimeType'] == 'text/html' and not body:
                data = part['body'].get('data', '')
                if data:
                    html = base64.urlsafe_b64decode(data).decode('utf-8', errors='ignore')
                    body += re.sub('<[^<]+?>', ' ', html)
    else:
        data = payload.get('body', {}).get('data', '')
        if data:
            body = base64.urlsafe_b64decode(data).decode('utf-8', errors='ignore')
    return body

def parse_email_for_promo(email):
    prompt = f"""You are a wine promo code extractor. Analyze this email and extract any promotional offers.

Email Subject: {email['subject']}
From: {email['sender']}
Date: {email['date']}
Body: {email['body']}

Extract the following and respond ONLY with valid JSON. If no promo code exists return {{"has_promo": false}}.

If a promo exists return:
{{
  "has_promo": true,
  "winery_name": "exact winery/retailer name",
  "code": "PROMO CODE IN CAPS",
  "discount_amount": "e.g. 20% or $15 or Free Shipping",
  "discount_type": "percentage or fixed or free_shipping or other",
  "varietal": "wine type if mentioned or null",
  "varietal_type": "red or white or rose or sparkling or null",
  "region": "wine region if mentioned or null",
  "country": "country if mentioned or null",
  "description": "brief one line description",
  "expiry_date": "YYYY-MM-DD if mentioned or null"
}}"""

    message = ANTHROPIC_CLIENT.messages.create(
        model="claude-opus-4-5",
        max_tokens=500,
        messages=[{"role": "user", "content": prompt}]
    )
    try:
        return json.loads(message.content[0].text.strip())
    except json.JSONDecodeError:
        return {"has_promo": False}

def save_promo(supabase_client, promo_data):
    try:
        data = {
            "winery_name": promo_data.get("winery_name", "Unknown"),
            "code": promo_data.get("code", "").upper(),
            "discount_amount": promo_data.get("discount_amount"),
            "discount_type": promo_data.get("discount_type", "other"),
            "varietal": promo_data.get("varietal"),
            "varietal_type": promo_data.get("varietal_type"),
            "region": promo_data.get("region"),
            "country": promo_data.get("country"),
            "description": promo_data.get("description"),
            "expiry_date": promo_data.get("expiry_date"),
            "source_email_date": datetime.now().strftime("%Y-%m-%d"),
            "is_active": True,
            "is_featured": False
        }
        existing = supabase_client.table("promo_codes").select("id").eq("code", data["code"]).execute()
        if existing.data:
            print(f"  ⏭️  Already exists: {data['code']}")
            return False
        supabase_client.table("promo_codes").insert(data).execute()
        print(f"  ✅ Saved: {data['code']} from {data['winery_name']}")
        return True
    except Exception as e:
        print(f"  ❌ Error saving promo: {e}")
        return False

def main():
    print("🍷 HeyVino Gmail Parser starting...")
    supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
    service = get_gmail_service()
    emails = get_recent_emails(service)
    print(f"📬 Found {len(emails)} relevant emails")
    saved = 0
    for email in emails:
        print(f"\n📧 Processing: {email['subject'][:60]}")
        promo = parse_email_for_promo(email)
        if promo.get("has_promo"):
            if save_promo(supabase_client, promo):
                saved += 1
        else:
            print("  ⏭️  No promo found")
    print(f"\n✅ Done. Saved {saved} new promo codes.")

if __name__ == "__main__":
    main()
