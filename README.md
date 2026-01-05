# PlayoffPredictor

NFL Playoff bracket prediction website. Users create accounts, make bracket picks, and compete with friends in groups.

## Features

- **Bracket Predictions**: Pick winners for each playoff round
- **Email Magic Link Auth**: Passwordless authentication
- **Groups**: Create public/private groups with custom scoring
- **Leaderboards**: Track scores against friends
- **Aggregate Stats**: See who everyone is picking

## Tech Stack

- **Frontend**: HTML, CSS, JavaScript (hosted on GitHub Pages)
- **Backend**: Google Apps Script
- **Database**: Google Sheets
- **NFL Data**: ESPN Public API

---

## Setup Instructions

### Step 1: Create Google Sheet

1. Go to [Google Sheets](https://sheets.google.com) and create a new spreadsheet
2. Name it "PlayoffPredictor"
3. The sheets will be auto-created when you run the initialization function

### Step 2: Deploy Google Apps Script

1. In your Google Sheet, go to **Extensions > Apps Script**
2. Delete any existing code in `Code.gs`
3. Copy the contents of each file from the `backend/` folder:
   - `Code.gs`
   - `Auth.gs`
   - `Picks.gs`
   - `Groups.gs`

4. In Apps Script, create these files (click + next to Files):
   - Click **+** > **Script** > name it `Auth`
   - Click **+** > **Script** > name it `Picks`
   - Click **+** > **Script** > name it `Groups`

5. Paste the corresponding code into each file

6. **Initialize the sheets**:
   - In `Code.gs`, find the `initializeAllSheets()` function
   - Click the dropdown next to "Run" and select `initializeAllSheets`
   - Click **Run**
   - Authorize the app when prompted

7. **Deploy as Web App**:
   - Click **Deploy** > **New deployment**
   - Click the gear icon next to "Type" and select **Web app**
   - Set:
     - Description: "PlayoffPredictor API"
     - Execute as: **Me**
     - Who has access: **Anyone**
   - Click **Deploy**
   - **Copy the Web App URL** (you'll need this!)

### Step 3: Configure Frontend

1. Open `app.js`
2. Find the `CONFIG` object at the top
3. Replace `'YOUR_APPS_SCRIPT_WEB_APP_URL'` with your Web App URL from Step 2

```javascript
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec',
  // ... rest of config
};
```

### Step 4: Update Backend Config

1. In Apps Script, open `Code.gs`
2. Update the `CONFIG.FRONTEND_URL` to your GitHub Pages URL:

```javascript
const CONFIG = {
  FRONTEND_URL: 'https://yourusername.github.io/PlayoffPredictor',
  // ...
};
```

3. Click **Deploy** > **Manage deployments** > **Edit** (pencil icon)
4. Select "New version" and click **Deploy**

### Step 5: Deploy to GitHub Pages

1. Create a new repository on GitHub named `PlayoffPredictor`
2. Push your code:

```bash
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/yourusername/PlayoffPredictor.git
git push -u origin main
```

3. Enable GitHub Pages:
   - Go to repository **Settings** > **Pages**
   - Source: **Deploy from a branch**
   - Branch: **main** / **(root)**
   - Click **Save**

4. Your site will be live at `https://yourusername.github.io/PlayoffPredictor`

---

## File Structure

```
PlayoffPredictor/
├── index.html          # Main page
├── styles.css          # Styling
├── app.js              # Frontend logic
├── backend/
│   ├── Code.gs         # Main Apps Script entry point
│   ├── Auth.gs         # Authentication (magic links)
│   ├── Picks.gs        # Bracket picks CRUD
│   └── Groups.gs       # Groups management
├── designdoc.md        # Original design document
└── README.md           # This file
```

---

## Admin Functions

### Lock Brackets (when playoffs start)

In Apps Script, run this in the console or create an admin endpoint:

```javascript
function lockBrackets() {
  lockPlayoffs('YOUR_ADMIN_KEY');
}
```

Replace `YOUR_ADMIN_KEY` in `Code.gs` with a secure key.

### Update Actual Results

To update scores after games:

```javascript
function updateResults() {
  const results = [
    { conference: 'AFC', round: 1, teamId: '12' }, // KC won wild card
    { conference: 'AFC', round: 1, teamId: '4' },  // BUF won wild card
    // ... add all winners
  ];
  setActualResults('YOUR_ADMIN_KEY', results);
}
```

---

## ESPN API Reference

The app uses ESPN's public (unofficial) API:

- **Scoreboard**: `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard`
- **Teams**: `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams`
- **Logo URL**: `https://a.espncdn.com/i/teamlogos/nfl/500/{abbrev}.png`

Note: This is an unofficial API and may change without notice.

---

## Troubleshooting

### Magic link emails going to spam
- Ask users to check spam/junk folder
- Add instructions in the login modal

### CORS errors
- Make sure your Apps Script is deployed with "Anyone" access
- Redeploy after any changes

### Picks not saving
- Check browser console for errors
- Verify Apps Script URL is correct
- Make sure playoffs aren't locked

### Teams not loading
- ESPN API may be temporarily unavailable
- Fallback data will be used automatically

---

## Customization

### Change point values (default)
Edit in `Groups.gs` or let group creators customize:
- Wild Card: 2 points
- Divisional: 4 points
- Conference: 6 points
- Super Bowl: 8 points

### Styling
Edit `styles.css` - uses CSS custom properties for easy theming:
- `--primary`: Main accent color
- `--afc-color`: AFC team color
- `--nfc-color`: NFC team color
- `--bg-primary`: Background color

---

## License

MIT
