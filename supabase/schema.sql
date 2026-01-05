-- PlayoffPredictor Supabase Schema
-- Run this in the Supabase SQL Editor to set up your database
-- Last updated: Includes buy-in tracking, bracket viewing functions, and scoring

-- ============================================
-- Config table (must be created first - referenced by picks policies)
-- ============================================
CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE config ENABLE ROW LEVEL SECURITY;

-- Everyone can read config
CREATE POLICY "Anyone can read config" ON config
  FOR SELECT USING (true);

-- Insert default config
INSERT INTO config (key, value) VALUES ('playoffs_locked', 'false');

-- ============================================
-- Profiles table (extends Supabase Auth)
-- ============================================
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Policies for profiles
CREATE POLICY "Users can view all profiles" ON profiles
  FOR SELECT USING (true);

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Function to handle new user signup
-- NOTE: Must use public.profiles since trigger runs in auth schema context
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', SPLIT_PART(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-create profile on signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================
-- Picks table
-- ============================================
CREATE TABLE picks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  conference TEXT NOT NULL CHECK (conference IN ('AFC', 'NFC', 'SB')),
  round INTEGER NOT NULL CHECK (round BETWEEN 1 AND 4),
  game INTEGER NOT NULL CHECK (game BETWEEN 1 AND 3),
  team_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, conference, round, game)
);

-- Enable RLS
ALTER TABLE picks ENABLE ROW LEVEL SECURITY;

-- Policies for picks
CREATE POLICY "Users can view own picks" ON picks
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can view others picks when locked" ON picks
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM config WHERE key = 'playoffs_locked' AND value = 'true')
  );

CREATE POLICY "Users can insert own picks" ON picks
  FOR INSERT WITH CHECK (
    auth.uid() = user_id AND
    NOT EXISTS (SELECT 1 FROM config WHERE key = 'playoffs_locked' AND value = 'true')
  );

CREATE POLICY "Users can update own picks" ON picks
  FOR UPDATE USING (
    auth.uid() = user_id AND
    NOT EXISTS (SELECT 1 FROM config WHERE key = 'playoffs_locked' AND value = 'true')
  );

CREATE POLICY "Users can delete own picks" ON picks
  FOR DELETE USING (
    auth.uid() = user_id AND
    NOT EXISTS (SELECT 1 FROM config WHERE key = 'playoffs_locked' AND value = 'true')
  );

-- ============================================
-- Groups table (create table first, policies later)
-- ============================================
CREATE TABLE groups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  is_public BOOLEAN DEFAULT false,
  buyin_type TEXT DEFAULT 'none' CHECK (buyin_type IN ('none', 'optional', 'required')),
  buyin_price DECIMAL(10,2) DEFAULT 0,
  payment_link TEXT,
  creator_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  points_r1 INTEGER DEFAULT 2,
  points_r2 INTEGER DEFAULT 4,
  points_r3 INTEGER DEFAULT 6,
  points_sb INTEGER DEFAULT 8,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;

-- ============================================
-- Group Members table
-- ============================================
CREATE TABLE group_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id UUID REFERENCES groups(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  paid_buyin BOOLEAN DEFAULT false,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(group_id, user_id)
);

-- Enable RLS
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;

-- Policies for group_members
CREATE POLICY "Anyone can view group members" ON group_members
  FOR SELECT USING (true);

CREATE POLICY "Authenticated users can join groups" ON group_members
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own membership" ON group_members
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can leave groups" ON group_members
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- Groups policies (after group_members exists)
-- ============================================
-- Allow anyone with the group ID to view it (for invite links)
-- The UUID acts as the "secret" - only people with the link can find private groups
CREATE POLICY "Anyone can view groups by ID" ON groups
  FOR SELECT USING (true);

CREATE POLICY "Authenticated users can create groups" ON groups
  FOR INSERT WITH CHECK (auth.uid() = creator_id);

CREATE POLICY "Creators can update their groups" ON groups
  FOR UPDATE USING (auth.uid() = creator_id);

CREATE POLICY "Creators can delete their groups" ON groups
  FOR DELETE USING (auth.uid() = creator_id);

-- ============================================
-- Actual Results table (for scoring)
-- ============================================
CREATE TABLE actual_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conference TEXT NOT NULL CHECK (conference IN ('AFC', 'NFC', 'SB')),
  round INTEGER NOT NULL CHECK (round BETWEEN 1 AND 4),
  game INTEGER NOT NULL CHECK (game BETWEEN 1 AND 3),
  team_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(conference, round, game)
);

-- Enable RLS
ALTER TABLE actual_results ENABLE ROW LEVEL SECURITY;

-- Everyone can read results
CREATE POLICY "Anyone can read results" ON actual_results
  FOR SELECT USING (true);

-- ============================================
-- Views for convenience
-- ============================================

-- View: User picks with profile info
CREATE OR REPLACE VIEW picks_with_profiles AS
SELECT
  p.*,
  pr.display_name,
  pr.email
FROM picks p
JOIN profiles pr ON p.user_id = pr.id;

-- View: Group leaderboard with buy-in status
CREATE OR REPLACE VIEW group_leaderboards AS
SELECT
  gm.group_id,
  gm.user_id,
  gm.paid_buyin,
  pr.display_name,
  pr.email,
  COALESCE(
    (SELECT COUNT(*) FROM picks WHERE user_id = gm.user_id), 0
  ) as pick_count
FROM group_members gm
JOIN profiles pr ON gm.user_id = pr.id;

-- ============================================
-- Functions
-- ============================================

-- Function to get aggregate stats (SECURITY DEFINER to bypass RLS and see all picks)
CREATE OR REPLACE FUNCTION get_aggregate_stats()
RETURNS TABLE (
  conference TEXT,
  round INTEGER,
  team_id TEXT,
  pick_count BIGINT,
  percentage NUMERIC,
  total_users BIGINT
)
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_count BIGINT;
BEGIN
  SELECT COUNT(DISTINCT user_id) INTO user_count FROM public.picks;

  RETURN QUERY
  SELECT
    p.conference,
    p.round,
    p.team_id,
    COUNT(*) as pick_count,
    CASE WHEN user_count > 0
      THEN ROUND((COUNT(*)::NUMERIC / user_count) * 100)
      ELSE 0
    END as percentage,
    user_count as total_users
  FROM public.picks p
  GROUP BY p.conference, p.round, p.team_id
  ORDER BY p.conference, p.round, pick_count DESC;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate user score
CREATE OR REPLACE FUNCTION calculate_user_score(
  p_user_id UUID,
  p_points_r1 INTEGER DEFAULT 2,
  p_points_r2 INTEGER DEFAULT 4,
  p_points_r3 INTEGER DEFAULT 6,
  p_points_sb INTEGER DEFAULT 8
)
RETURNS INTEGER AS $$
DECLARE
  score INTEGER := 0;
BEGIN
  SELECT COALESCE(SUM(
    CASE
      WHEN ar.round = 1 THEN p_points_r1
      WHEN ar.round = 2 THEN p_points_r2
      WHEN ar.round = 3 THEN p_points_r3
      WHEN ar.round = 4 THEN p_points_sb
      ELSE 0
    END
  ), 0) INTO score
  FROM picks p
  JOIN actual_results ar ON
    p.conference = ar.conference AND
    p.round = ar.round AND
    p.team_id = ar.team_id
  WHERE p.user_id = p_user_id;

  RETURN score;
END;
$$ LANGUAGE plpgsql;

-- Function to check if a user has submitted a bracket (bypasses RLS)
-- This allows showing bracket completion status without exposing actual picks
CREATE OR REPLACE FUNCTION get_user_bracket_status(check_user_id UUID)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_picks BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.picks WHERE user_id = check_user_id) INTO has_picks;
  RETURN has_picks;
END;
$$ LANGUAGE plpgsql;

-- Function to get a user's picks (bypasses RLS for viewing others' brackets when locked)
-- Used for displaying other users' bracket choices in group leaderboards
CREATE OR REPLACE FUNCTION get_user_picks(target_user_id UUID)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  conference TEXT,
  round INTEGER,
  game INTEGER,
  team_id TEXT
)
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, p.user_id, p.conference, p.round, p.game, p.team_id
  FROM public.picks p
  WHERE p.user_id = target_user_id;
END;
$$ LANGUAGE plpgsql;
