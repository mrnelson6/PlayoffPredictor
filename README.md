# PlayoffPredictor

NFL Playoff bracket prediction website. Users create accounts, make bracket picks, and compete with friends in groups.

## Features

- **Bracket Predictions**: Pick winners for each playoff round
- **Email Magic Link Auth**: Passwordless authentication via Supabase
- **Groups**: Create public/private groups with custom scoring
- **Leaderboards**: Track scores against friends
- **Aggregate Stats**: See who everyone is picking

## Tech Stack

- **Frontend**: HTML, CSS, JavaScript (hosted on GitHub Pages)
- **Backend**: Supabase (PostgreSQL + Auth + Row Level Security)
- **NFL Data**: ESPN Public API

---

## Setup Instructions

### Step 1: Create Supabase Project

1. Go to [Supabase](https://supabase.com) and sign in/create an account
2. Click **New Project**
3. Fill in:
   - Name: `PlayoffPredictor`
   - Database Password: (generate a strong password and save it)
   - Region: Choose closest to your users
4. Click **Create new project** and wait for it to be ready

### Step 2: Run Database Schema

1. In your Supabase project, go to **SQL Editor** (left sidebar)
2. Click **New query**
3. Copy and paste the entire contents of `supabase/schema.sql`
4. Click **Run** (or press Ctrl+Enter)
5. You should see "Success. No rows returned" - this means all tables were created

### Step 3: Configure Authentication

1. Go to **Authentication** > **Providers**
2. Make sure **Email** is enabled
3. Go to **Authentication** > **URL Configuration**
4. Set **Site URL** to your GitHub Pages URL (e.g., `https://yourusername.github.io/PlayoffPredictor`)
5. Add your GitHub Pages URL to **Redirect URLs**

#### Email Templates (Optional but recommended)

1. Go to **Authentication** > **Email Templates**
2. Select **Magic Link**
3. Customize the email template to match your branding

### Step 4: Get API Keys

1. Go to **Project Settings** (gear icon) > **API**
2. Copy these values:
   - **Project URL** (looks like `https://xxxxx.supabase.co`)
   - **anon public** key (under Project API keys)

### Step 5: Configure Frontend

1. Open `app.js`
2. Find the `CONFIG` object at the top
3. Replace the placeholder values:

```javascript
const CONFIG = {
  SUPABASE_URL: 'https://your-project-id.supabase.co',
  SUPABASE_ANON_KEY: 'your-anon-key-here',
  // ... rest of config
};
```

### Step 6: Deploy to GitHub Pages

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

5. **Important**: Go back to Supabase and update your **Site URL** and **Redirect URLs** with the actual GitHub Pages URL

---

## File Structure

```
PlayoffPredictor/
├── index.html          # Main page
├── styles.css          # Styling
├── app.js              # Frontend logic (Supabase client)
├── supabase/
│   └── schema.sql      # Database schema (run in SQL Editor)
├── designdoc.md        # Original design document
└── README.md           # This file
```

---

## Database Schema

### Tables

| Table | Purpose |
|-------|---------|
| `profiles` | User display names (extends Supabase Auth) |
| `picks` | User bracket predictions |
| `groups` | Competition groups |
| `group_members` | Group membership |
| `config` | App configuration (playoffs_locked) |
| `actual_results` | Real game outcomes for scoring |

### Row Level Security

All tables have RLS enabled:
- Users can only modify their own picks
- Users can only see others' picks after playoffs are locked
- Group creators can manage their groups
- Anyone can view public groups

---

## Admin Functions

### Lock Brackets (when playoffs start)

In Supabase SQL Editor:

```sql
UPDATE config SET value = 'true' WHERE key = 'playoffs_locked';
```

### Unlock Brackets

```sql
UPDATE config SET value = 'false' WHERE key = 'playoffs_locked';
```

### Add Game Results

After each game, add the winner:

```sql
-- Example: Kansas City wins AFC Wild Card Game 1
INSERT INTO actual_results (conference, round, game, team_id)
VALUES ('AFC', 1, 1, '12')
ON CONFLICT (conference, round, game) DO UPDATE SET team_id = EXCLUDED.team_id;
```

### Calculate Scores

The `calculate_user_score` function is built into the schema:

```sql
-- Get a user's score with default points
SELECT calculate_user_score('user-uuid-here');

-- Get a user's score with custom points
SELECT calculate_user_score('user-uuid-here', 2, 4, 6, 8);
```

### View Aggregate Stats

```sql
SELECT * FROM get_aggregate_stats();
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

### Magic link emails not arriving
- Check spam/junk folder
- Verify email is spelled correctly
- In Supabase, check **Authentication** > **Users** to see if signup was attempted
- Check rate limits in Supabase (free tier: 4 emails/hour)

### "Invalid API key" errors
- Verify `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `app.js`
- Make sure you copied the **anon public** key (not the service role key)

### Picks not saving
- Check browser console for errors
- Verify user is logged in
- Check if playoffs are locked: `SELECT * FROM config WHERE key = 'playoffs_locked';`

### "Permission denied" errors
- RLS policies may be blocking the request
- Check that the user is authenticated
- Verify the RLS policies are correctly set up

### Teams not loading
- ESPN API may be temporarily unavailable
- Fallback data will be used automatically

### Auth redirects not working
- Verify **Site URL** and **Redirect URLs** in Supabase match your actual domain
- Include both `http://localhost` (for local dev) and your production URL

---

## Local Development

1. Clone the repository
2. Update `app.js` with your Supabase credentials
3. Serve the files locally:

```bash
# Using Python
python -m http.server 8000

# Using Node.js
npx serve
```

4. Open `http://localhost:8000`

5. Add `http://localhost:8000` to your Supabase Redirect URLs for local testing

---

## Customization

### Change default point values
Edit in `supabase/schema.sql` or let group creators customize:
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

## Debug / Testing Mode

The app includes debug functions accessible from the browser console (F12 → Console). To use them, you must first enable write access in Supabase.

### Enable Debug Mode

Run this SQL in Supabase SQL Editor to allow updating config and results:

```sql
-- Enable debug write access (run to enable)
CREATE POLICY "Debug: update config" ON config
  FOR UPDATE USING (auth.uid() IS NOT NULL);

CREATE POLICY "Debug: insert results" ON actual_results
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Debug: update results" ON actual_results
  FOR UPDATE USING (auth.uid() IS NOT NULL);

CREATE POLICY "Debug: delete results" ON actual_results
  FOR DELETE USING (auth.uid() IS NOT NULL);
```

### Disable Debug Mode

Run this SQL to remove debug access for production:

```sql
-- Disable debug write access (run for production)
DROP POLICY IF EXISTS "Debug: update config" ON config;
DROP POLICY IF EXISTS "Debug: insert results" ON actual_results;
DROP POLICY IF EXISTS "Debug: update results" ON actual_results;
DROP POLICY IF EXISTS "Debug: delete results" ON actual_results;
```

### Debug Console Commands

Once debug mode is enabled, use these commands in the browser console:

```javascript
// Lock/unlock brackets
debugLockBrackets()      // Lock brackets (simulate playoffs started)
debugUnlockBrackets()    // Unlock brackets

// Check current state
debugStatus()

// List all teams with their IDs
debugListTeams()

// Set game winners (conference, round, game, teamId)
debugSetWinner('AFC', 1, 1, '12')  // AFC Wild Card Game 1
debugSetWinner('NFC', 2, 1, '19')  // NFC Divisional Game 1
debugSetWinner('SB', 4, 1, '12')   // Super Bowl

// View all set results
debugShowResults()

// Clear a single result
debugClearWinner('AFC', 1, 1)

// Clear ALL results
debugClearAllWinners()
```

### Round Reference

| Round | Name | Games per Conference |
|-------|------|---------------------|
| 1 | Wild Card | 3 |
| 2 | Divisional | 2 |
| 3 | Conference Championship | 1 |
| 4 | Super Bowl | 1 (use 'SB' for conference) |

---

## License

MIT
