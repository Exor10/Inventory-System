# Stage 1 Deployment Steps

## 1. Create the Google Spreadsheet

1. Go to sheets.google.com → New blank spreadsheet
2. Name it **Inventory System**
3. Copy the URL — the Sheet ID is the long string between `/d/` and `/edit`
   Example: `https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit`

## 2. Open Apps Script

1. In the spreadsheet: **Extensions → Apps Script**
2. Delete any existing code in `Code.gs`
3. Paste the entire contents of `gas/Code.gs` into the editor
4. At the top of the file, fill in your Sheet ID:
   ```js
   var SPREADSHEET_ID = 'YOUR_SHEET_ID_HERE';
   ```

## 3. Run `setupSheets` once

1. In the Apps Script editor, select the function `setupSheets` from the dropdown
2. Click **Run** (you'll be asked to authorize — approve all permissions)
3. Check the **Execution log** — you should see:
   ```
   Admin user created. PIN: 1234 — change this immediately.
   setupSheets complete.
   ```
4. Go back to your spreadsheet — you should now see 5 tabs:
   Items, Movements, Users, Sessions, Locations

## 4. Deploy as Web App

1. Click **Deploy → New deployment**
2. Click the gear icon next to "Select type" → choose **Web app**
3. Settings:
   - Description: `Inventory System v1`
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Click **Deploy** → copy the Web App URL (looks like `https://script.google.com/macros/s/AKfy.../exec`)

> **Every time you change Code.gs:**
> Deploy → Manage deployments → Edit (pencil) → Version: **New version** → Deploy

## 5. Test with curl (Stage 1 verification)

Replace `YOUR_URL` with your deployment URL.

### Test login (correct PIN)
```bash
curl -X POST "YOUR_URL" \
  -H "Content-Type: application/json" \
  -d '{"action":"login","username":"admin","pin":"1234"}'
```
Expected response:
```json
{"ok":true,"data":{"token":"...","username":"admin","role":"admin","expires_at":"..."}}
```

### Test login (wrong PIN)
```bash
curl -X POST "YOUR_URL" \
  -H "Content-Type: application/json" \
  -d '{"action":"login","username":"admin","pin":"wrong"}'
```
Expected: `{"ok":false,"error":"Invalid credentials"}`

### Test validate_token (use token from login above)
```bash
curl "YOUR_URL?action=validate_token&token=TOKEN_FROM_LOGIN"
```
Expected: `{"ok":true,"data":{"username":"admin","role":"admin"}}`

### Test lookup (should fail — no items yet)
```bash
curl "YOUR_URL?action=lookup&barcode=TEST123&token=TOKEN_FROM_LOGIN"
```
Expected: `{"ok":false,"error":"Item not found"}`

## 6. Add a test item manually

In the **Items** sheet, add a row manually:
```
id:          test-001
barcode:     TEST123
name:        Test Widget
item_type:   stock
quantity:    10
location:    Shelf A
assigned_to: (blank)
active:      TRUE
created_at:  2024-01-01T00:00:00.000Z
updated_at:  2024-01-01T00:00:00.000Z
```
Then retry the lookup curl above — you should get the item back.

## 7. Change the admin PIN

To set a secure PIN, calculate the SHA-256 hash of your new PIN and paste it into cell B2 of the Users sheet. You can get the hash with:
```bash
echo -n "YOUR_NEW_PIN" | sha256sum
```
Or use an online SHA-256 tool. The PIN is 4-6 digits.

---

Once all curl tests pass, confirm and we'll move to Stage 2 (login page).
