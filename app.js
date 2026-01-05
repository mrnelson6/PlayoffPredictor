/**
 * PlayoffPredictor - Main Application (Supabase Version)
 */

// ============================================
// Configuration
// ============================================

const CONFIG = {
  // UPDATE THESE with your Supabase project details
  SUPABASE_URL: 'https://mvdgiqspcywbmrvlphtp.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_cUgE-KLyMycCPxAOXa8FeA_CkH6Unai',

  // ESPN API endpoints
  ESPN_SCOREBOARD: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
  ESPN_TEAMS: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams',

  // Logo URL pattern
  LOGO_URL: (abbrev) => `https://a.espncdn.com/i/teamlogos/nfl/500/${abbrev}.png`,

  // Frontend URL (for magic link redirects)
  SITE_URL: window.location.origin
};

// Initialize Supabase client
const supabaseClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

// ============================================
// State Management
// ============================================

const state = {
  user: null,
  profile: null,
  teams: {},
  playoffTeams: {
    AFC: {},
    NFC: {}
  },
  picks: [],
  savedPicks: [],
  groups: [],
  publicGroups: [],
  playoffsLocked: false,
  currentGroupTab: 'my-groups',
  actualResults: {} // Maps "conference-round-game" to winning team_id
};

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  // Check for auth callback (magic link)
  await handleAuthCallback();

  // Get current session
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    state.user = session.user;
    await loadProfile();
  }

  // Listen for auth changes
  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      state.user = session.user;
      await loadProfile();
      await loadUserPicks();
      await loadUserGroups();
      updateAuthUI();
      renderBracket();
      showToast('Welcome back, ' + (state.profile?.display_name || state.user.email) + '!', 'success');
    } else if (event === 'SIGNED_OUT') {
      state.user = null;
      state.profile = null;
      state.picks = [];
      state.savedPicks = [];
      state.groups = [];
      updateAuthUI();
      renderBracket();
    }
  });

  // Check for group join link
  const urlParams = new URLSearchParams(window.location.search);
  const joinGroupId = urlParams.get('join');

  // Load NFL data
  await loadNFLData();

  // Check if playoffs are locked
  await checkPlayoffsLocked();

  // Initialize UI
  initializeUI();

  // Handle group join link
  if (joinGroupId) {
    await handleJoinLink(joinGroupId);
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  // Render bracket
  renderBracket();

  // Load actual results for scoring display
  await loadActualResults();

  // Load user data if logged in
  if (state.user) {
    await loadUserPicks();
    await loadUserGroups();
  }

  // Load public groups
  await loadPublicGroups();

  updateAuthUI();
});

// Handle magic link callback
async function handleAuthCallback() {
  // Check if there are auth tokens in the URL hash
  const hashParams = new URLSearchParams(window.location.hash.substring(1));
  const accessToken = hashParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token');

  if (accessToken && refreshToken) {
    // Set the session from the URL tokens
    const { data, error } = await supabaseClient.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken
    });

    if (error) {
      console.error('Auth callback error:', error);
      showToast('Sign in failed: ' + error.message, 'error');
    }

    // Clear the hash from URL after processing
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

// ============================================
// Authentication
// ============================================

async function sendMagicLink(email) {
  const { error } = await supabaseClient.auth.signInWithOtp({
    email: email,
    options: {
      emailRedirectTo: CONFIG.SITE_URL
    }
  });

  if (error) {
    return { error: error.message };
  }

  return { success: true, message: 'Check your email for the login link!' };
}

async function logout() {
  await supabaseClient.auth.signOut();
  state.user = null;
  state.profile = null;
  state.picks = [];
  state.savedPicks = [];
  state.groups = [];
  updateAuthUI();
  renderBracket();
  showToast('Signed out successfully', 'success');
}

async function loadProfile() {
  if (!state.user) return;

  const { data, error } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', state.user.id)
    .single();

  if (data) {
    state.profile = data;
  }
}

async function updateDisplayName(displayName) {
  if (!state.user) return { error: 'Not logged in' };

  const { data, error } = await supabaseClient
    .from('profiles')
    .update({ display_name: displayName, updated_at: new Date().toISOString() })
    .eq('id', state.user.id)
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  state.profile = data;
  return { success: true, profile: data };
}

// ============================================
// NFL Data
// ============================================

async function loadNFLData() {
  try {
    const teamsResponse = await fetch(CONFIG.ESPN_TEAMS);
    const teamsData = await teamsResponse.json();

    teamsData.sports[0].leagues[0].teams.forEach(({ team }) => {
      state.teams[team.id] = {
        id: team.id,
        name: team.displayName,
        abbreviation: team.abbreviation,
        shortName: team.shortDisplayName,
        logo: team.logos?.[0]?.href || CONFIG.LOGO_URL(team.abbreviation.toLowerCase()),
        color: team.color
      };
    });

    await loadPlayoffTeams();
  } catch (error) {
    console.error('Error loading NFL data:', error);
    loadFallbackData();
  }
}

async function loadPlayoffTeams() {
  try {
    const standingsUrl = 'https://site.api.espn.com/apis/v2/sports/football/nfl/standings';
    const response = await fetch(standingsUrl);
    const data = await response.json();

    data.children?.forEach(conference => {
      const confName = conference.abbreviation;
      const teams = [];

      conference.standings?.entries?.forEach(entry => {
        const team = entry.team;
        const playoffSeed = entry.stats?.find(s => s.name === 'playoffSeed')?.value;

        if (playoffSeed && playoffSeed <= 7) {
          teams.push({
            seed: playoffSeed,
            teamId: team.id,
            ...state.teams[team.id]
          });
        }
      });

      teams.sort((a, b) => a.seed - b.seed);
      teams.forEach(team => {
        state.playoffTeams[confName][team.seed] = team;
      });
    });
  } catch (error) {
    console.error('Error loading playoff teams:', error);
    loadFallbackData();
  }
}

function loadFallbackData() {
  const fallbackTeams = {
    AFC: {
      1: { id: '12', name: 'Kansas City Chiefs', abbreviation: 'KC' },
      2: { id: '4', name: 'Buffalo Bills', abbreviation: 'BUF' },
      3: { id: '33', name: 'Baltimore Ravens', abbreviation: 'BAL' },
      4: { id: '34', name: 'Houston Texans', abbreviation: 'HOU' },
      5: { id: '7', name: 'Los Angeles Chargers', abbreviation: 'LAC' },
      6: { id: '23', name: 'Pittsburgh Steelers', abbreviation: 'PIT' },
      7: { id: '10', name: 'Denver Broncos', abbreviation: 'DEN' }
    },
    NFC: {
      1: { id: '8', name: 'Detroit Lions', abbreviation: 'DET' },
      2: { id: '21', name: 'Philadelphia Eagles', abbreviation: 'PHI' },
      3: { id: '29', name: 'Tampa Bay Buccaneers', abbreviation: 'TB' },
      4: { id: '14', name: 'Los Angeles Rams', abbreviation: 'LAR' },
      5: { id: '16', name: 'Minnesota Vikings', abbreviation: 'MIN' },
      6: { id: '28', name: 'Washington Commanders', abbreviation: 'WSH' },
      7: { id: '9', name: 'Green Bay Packers', abbreviation: 'GB' }
    }
  };

  Object.entries(fallbackTeams).forEach(([conf, seeds]) => {
    Object.entries(seeds).forEach(([seed, team]) => {
      state.playoffTeams[conf][seed] = {
        ...team,
        seed: parseInt(seed),
        teamId: team.id,
        logo: CONFIG.LOGO_URL(team.abbreviation.toLowerCase())
      };
    });
  });
}

async function checkPlayoffsLocked() {
  const { data } = await supabaseClient
    .from('config')
    .select('value')
    .eq('key', 'playoffs_locked')
    .single();

  state.playoffsLocked = data?.value === 'true';
  updateLockStatus();
}

// ============================================
// Picks
// ============================================

async function loadUserPicks() {
  if (!state.user) return;

  const { data, error } = await supabaseClient
    .from('picks')
    .select('*')
    .eq('user_id', state.user.id);

  if (data) {
    state.savedPicks = data.map(p => ({
      conference: p.conference,
      round: p.round,
      game: p.game,
      teamId: p.team_id
    }));
    state.picks = [...state.savedPicks];
    renderBracket();
    updateBracketStatus();
  }
}

async function loadActualResults() {
  const { data, error } = await supabaseClient
    .from('actual_results')
    .select('*');

  if (data) {
    state.actualResults = {};
    data.forEach(r => {
      state.actualResults[`${r.conference}-${r.round}-${r.game}`] = r.team_id;
    });
    renderBracket();
  }
}

function getPickResult(conference, round, game, teamId) {
  // For Wild Card (round 1), matchups are fixed, so check specific game
  if (round === 1) {
    const key = `${conference}-${round}-${game}`;
    const actualWinner = state.actualResults[key];
    if (!actualWinner) return null; // No result yet
    return actualWinner === teamId ? 'correct' : 'incorrect';
  }

  // For Divisional+ (rounds 2-4):
  // - CORRECT: team won a game in this round
  // - INCORRECT: team is eliminated (lost in this round or earlier)
  // - PENDING: neither (game hasn't happened yet)

  const roundWinners = getRoundWinners(conference, round);

  // If team won this round, correct
  if (roundWinners.includes(teamId)) {
    return 'correct';
  }

  // Check if team is eliminated
  if (isTeamEliminated(teamId, conference, round)) {
    return 'incorrect';
  }

  // Game hasn't happened yet
  return null;
}

function getRoundWinners(conference, round) {
  return Object.entries(state.actualResults)
    .filter(([key]) => key.startsWith(`${conference}-${round}-`))
    .map(([, winnerId]) => winnerId);
}

function isTeamEliminated(teamId, conference, upToRound) {
  // For Super Bowl picks, find which conference the team is actually in
  let teamConference = conference;
  if (conference === 'SB') {
    teamConference = getTeamConference(teamId);
    if (!teamConference) return false;
  }

  // Check if eliminated in Wild Card (round 1)
  if (wasEliminatedInWildCard(teamConference, teamId)) {
    return true;
  }

  // Check if eliminated in Divisional (round 2)
  // Only relevant if checking for round 3+ or Super Bowl
  if (upToRound >= 3 || conference === 'SB') {
    if (wasEliminatedInRound(teamConference, 2, teamId, 2)) {
      return true;
    }
  }

  // Check if eliminated in current round (for rounds 2+)
  // We can only determine this if we have ALL results for the round
  if (upToRound >= 2) {
    const gamesInRound = upToRound === 2 ? 2 : 1; // Divisional has 2 games, others have 1
    if (wasEliminatedInRound(conference, upToRound, teamId, gamesInRound)) {
      return true;
    }
  }

  // Check if eliminated in Conference Championship (round 3)
  // Only relevant for Super Bowl picks
  if (conference === 'SB') {
    if (wasEliminatedInRound(teamConference, 3, teamId, 1)) {
      return true;
    }
  }

  return false;
}

function getTeamConference(teamId) {
  for (const conf of ['AFC', 'NFC']) {
    const teams = state.playoffTeams[conf];
    if (teams) {
      for (const seed in teams) {
        if (teams[seed]?.teamId === teamId) {
          return conf;
        }
      }
    }
  }
  return null;
}

function wasEliminatedInWildCard(conference, teamId) {
  // Wild Card matchups are fixed by seed
  const wcMatchups = [
    { game: 1, seeds: [2, 7] },
    { game: 2, seeds: [3, 6] },
    { game: 3, seeds: [4, 5] }
  ];

  for (const matchup of wcMatchups) {
    const winner = state.actualResults[`${conference}-1-${matchup.game}`];
    if (winner) {
      // Get team IDs for this matchup
      const team1 = state.playoffTeams[conference]?.[matchup.seeds[0]]?.teamId;
      const team2 = state.playoffTeams[conference]?.[matchup.seeds[1]]?.teamId;

      // If our team was in this matchup and lost
      if ((teamId === team1 || teamId === team2) && teamId !== winner) {
        return true;
      }
    }
  }

  return false;
}

function wasEliminatedInRound(conference, round, teamId, expectedGames) {
  const winners = getRoundWinners(conference, round);

  // Can only determine elimination if we have ALL results for the round
  if (winners.length < expectedGames) {
    return false;
  }

  // If we have all results and team isn't a winner, they're eliminated
  return !winners.includes(teamId);
}

async function savePicks() {
  if (!state.user) {
    openModal('loginModal');
    return;
  }

  if (state.playoffsLocked) {
    showToast('Brackets are locked!', 'error');
    return;
  }

  showLoading(true);

  // Delete existing picks
  await supabaseClient
    .from('picks')
    .delete()
    .eq('user_id', state.user.id);

  // Insert new picks
  const picksToInsert = state.picks.map(pick => ({
    user_id: state.user.id,
    conference: pick.conference,
    round: pick.round,
    game: pick.game,
    team_id: pick.teamId
  }));

  const { error } = await supabaseClient
    .from('picks')
    .insert(picksToInsert);

  showLoading(false);

  if (error) {
    showToast('Failed to save: ' + error.message, 'error');
    return;
  }

  state.savedPicks = [...state.picks];
  showToast('Bracket saved!', 'success');
  updateBracketStatus();
}

function resetPicks() {
  state.picks = [];
  renderBracket();
  updateBracketStatus();
}

function getPick(conference, round, game) {
  return state.picks.find(p =>
    p.conference === conference &&
    p.round === round &&
    p.game === game
  );
}

function setPick(conference, round, game, teamId) {
  state.picks = state.picks.filter(p =>
    !(p.conference === conference && p.round === round && p.game === game)
  );

  if (teamId) {
    state.picks.push({ conference, round, game, teamId });
  }

  clearDownstreamPicks(conference, round, teamId);
  renderBracket();
  updateBracketStatus();
}

function clearDownstreamPicks(conference, round, newTeamId) {
  if (round === 1) {
    state.picks = state.picks.filter(p =>
      !(p.conference === conference && p.round >= 2)
    );
    state.picks = state.picks.filter(p => !(p.conference === 'SB'));
  } else if (round === 2) {
    state.picks = state.picks.filter(p =>
      !(p.conference === conference && p.round >= 3)
    );
    state.picks = state.picks.filter(p => !(p.conference === 'SB'));
  } else if (round === 3) {
    state.picks = state.picks.filter(p => !(p.conference === 'SB'));
  }
}

// ============================================
// Bracket Rendering
// ============================================

function renderBracket() {
  renderConference('AFC');
  renderConference('NFC');
  renderSuperBowl();
  updateBracketInteractivity();
}

function renderConference(conference) {
  const teams = state.playoffTeams[conference];

  renderMatchup(conference, 1, 1, [teams[2], teams[7]]);
  renderMatchup(conference, 1, 2, [teams[3], teams[6]]);
  renderMatchup(conference, 1, 3, [teams[4], teams[5]]);

  const wcWinners = getWildCardWinners(conference);
  const divMatchups = buildDivisionalMatchups(conference, teams[1], wcWinners);
  renderMatchup(conference, 2, 1, divMatchups[0]);
  renderMatchup(conference, 2, 2, divMatchups[1]);

  const divWinners = getDivisionalWinners(conference);
  renderMatchup(conference, 3, 1, divWinners);
}

function getWildCardWinners(conference) {
  const winners = [];
  for (let game = 1; game <= 3; game++) {
    const pick = getPick(conference, 1, game);
    if (pick) {
      const team = findTeamById(conference, pick.teamId);
      if (team) winners.push(team);
    }
  }
  return winners;
}

function buildDivisionalMatchups(conference, topSeed, wcWinners) {
  if (wcWinners.length < 3) {
    return [[topSeed, null], [null, null]];
  }

  const sorted = [...wcWinners].sort((a, b) => b.seed - a.seed);
  const lowestSeed = sorted[0];
  const others = sorted.slice(1).sort((a, b) => a.seed - b.seed);

  return [
    [topSeed, lowestSeed],
    [others[0], others[1]]
  ];
}

function getDivisionalWinners(conference) {
  const winners = [];
  for (let game = 1; game <= 2; game++) {
    const pick = getPick(conference, 2, game);
    if (pick) {
      const team = findTeamById(conference, pick.teamId);
      if (team) winners.push(team);
    }
  }
  return winners;
}

function findTeamById(conference, teamId) {
  const teams = state.playoffTeams[conference];
  if (teams) {
    for (const seed in teams) {
      if (teams[seed]?.teamId === teamId) {
        return teams[seed];
      }
    }
  }

  if (conference === 'SB') {
    for (const conf of ['AFC', 'NFC']) {
      const confTeams = state.playoffTeams[conf];
      for (const seed in confTeams) {
        if (confTeams[seed]?.teamId === teamId) {
          return confTeams[seed];
        }
      }
    }
  }

  return null;
}

function renderSuperBowl() {
  const afcChampPick = getPick('AFC', 3, 1);
  const nfcChampPick = getPick('NFC', 3, 1);

  const afcChamp = afcChampPick ? findTeamById('AFC', afcChampPick.teamId) : null;
  const nfcChamp = nfcChampPick ? findTeamById('NFC', nfcChampPick.teamId) : null;

  const sbMatchup = document.querySelector('.super-bowl-matchup');
  if (sbMatchup) {
    const slots = sbMatchup.querySelectorAll('.team-slot');
    renderTeamSlot(slots[0], nfcChamp, 'SB', 4, 1, true);
    renderTeamSlot(slots[1], afcChamp, 'SB', 4, 1, true);
  }

  const sbWinnerPick = getPick('SB', 4, 1);
  const championSlot = document.querySelector('.champion-slot .team-slot');

  if (championSlot) {
    if (sbWinnerPick) {
      const team = findTeamById('SB', sbWinnerPick.teamId);
      renderChampionSlot(championSlot, team);
    } else {
      renderChampionSlot(championSlot, null);
    }
  }
}

function renderChampionSlot(slot, team) {
  slot.innerHTML = '';
  slot.className = 'team-slot champion';

  if (!team) {
    slot.classList.add('empty');
    slot.innerHTML = '<span class="team-name">?</span>';
    return;
  }

  // Check if Super Bowl pick is correct/incorrect
  const pickResult = getPickResult('SB', 4, 1, team.teamId);
  if (pickResult === 'correct') {
    slot.classList.add('correct');
  } else if (pickResult === 'incorrect') {
    slot.classList.add('incorrect');
  }

  const resultIcon = pickResult === 'correct' ? '<span class="result-icon">✓</span>' :
                     pickResult === 'incorrect' ? '<span class="result-icon">✗</span>' : '';

  slot.innerHTML = `
    <img src="${team.logo}" alt="${team.abbreviation}" class="team-logo" onerror="this.style.display='none'">
    <div class="team-info">
      <div class="team-name">${team.shortName || team.name}</div>
    </div>
    ${resultIcon}
  `;
}

function renderMatchup(conference, round, game, teams) {
  const matchup = document.querySelector(
    `.matchup[data-conference="${conference}"][data-round="${round}"][data-game="${game}"]`
  );

  if (!matchup) return;

  const slots = matchup.querySelectorAll('.team-slot');
  const currentPick = getPick(conference, round, game);

  slots.forEach((slot, index) => {
    const team = teams[index];
    const isSelected = currentPick && team && currentPick.teamId === team.teamId;
    renderTeamSlot(slot, team, conference, round, game, true, isSelected);
  });
}

function renderTeamSlot(slot, team, conference, round, game, clickable = true, isSelected = false) {
  const newSlot = slot.cloneNode(false);
  slot.parentNode.replaceChild(newSlot, slot);
  slot = newSlot;

  slot.innerHTML = '';
  slot.className = 'team-slot';

  if (!team) {
    slot.classList.add('empty');
    slot.innerHTML = '<span class="team-name">TBD</span>';
    return;
  }

  // Check if this pick has a result (correct/incorrect)
  let pickResult = null;
  if (isSelected) {
    pickResult = getPickResult(conference, round, game, team.teamId);
    if (pickResult === 'correct') {
      slot.classList.add('correct');
    } else if (pickResult === 'incorrect') {
      slot.classList.add('incorrect');
    } else {
      slot.classList.add('selected'); // No result yet, show as selected (blue)
    }
  }

  if (state.playoffsLocked || !state.user) {
    slot.classList.add('locked');
  }

  // Add result indicator for selected picks
  const resultIcon = pickResult === 'correct' ? '<span class="result-icon">✓</span>' :
                     pickResult === 'incorrect' ? '<span class="result-icon">✗</span>' : '';

  slot.innerHTML = `
    <img src="${team.logo}" alt="${team.abbreviation}" class="team-logo" onerror="this.style.display='none'">
    <div class="team-info">
      <div class="team-name">${team.shortName || team.name}</div>
      <div class="team-seed">#${team.seed} seed</div>
    </div>
    ${resultIcon}
  `;

  if (clickable && state.user && !state.playoffsLocked) {
    slot.addEventListener('click', () => handleTeamClick(team, conference, round, game));
  }
}

function handleTeamClick(team, conference, round, game) {
  if (!state.user) {
    openModal('loginModal');
    return;
  }

  if (state.playoffsLocked) {
    showToast('Brackets are locked!', 'error');
    return;
  }

  const currentPick = getPick(conference, round, game);

  if (currentPick?.teamId === team.teamId) {
    setPick(conference, round, game, null);
  } else {
    setPick(conference, round, game, team.teamId);
  }
}

function updateBracketInteractivity() {
  const actions = document.getElementById('bracketActions');
  if (state.user && !state.playoffsLocked) {
    actions.style.display = 'flex';
  } else {
    actions.style.display = 'none';
  }
}

function updateBracketStatus() {
  const banner = document.getElementById('statusBanner');

  if (!state.user) {
    banner.className = 'status-banner visible warning';
    banner.innerHTML = 'Sign in to make your picks and compete with friends!';
    return;
  }

  if (state.playoffsLocked) {
    banner.className = 'status-banner visible warning';
    banner.innerHTML = 'Playoffs have started. Brackets are locked.';
    return;
  }

  const totalPicks = state.picks.length;
  const expectedPicks = 13;

  if (totalPicks === 0) {
    banner.className = 'status-banner visible warning';
    banner.innerHTML = 'Click on teams to make your picks, then submit your bracket!';
  } else if (totalPicks < expectedPicks) {
    banner.className = 'status-banner visible warning';
    banner.innerHTML = `You have ${totalPicks}/${expectedPicks} picks. Complete your bracket and submit!`;
  } else {
    const hasUnsaved = JSON.stringify(state.picks.sort((a,b) => a.conference.localeCompare(b.conference) || a.round - b.round || a.game - b.game)) !==
                       JSON.stringify(state.savedPicks.sort((a,b) => a.conference.localeCompare(b.conference) || a.round - b.round || a.game - b.game));
    if (hasUnsaved) {
      banner.className = 'status-banner visible warning';
      banner.innerHTML = 'You have unsaved changes. Click Submit to save your bracket!';
    } else {
      banner.className = 'status-banner visible success';
      banner.innerHTML = 'Your bracket is submitted! You can still make changes until playoffs start.';
    }
  }
}

function updateLockStatus() {
  if (state.playoffsLocked) {
    document.querySelectorAll('.team-slot').forEach(slot => {
      slot.classList.add('locked');
    });
  }
}

// ============================================
// Groups
// ============================================

async function loadUserGroups() {
  if (!state.user) return;

  const { data } = await supabaseClient
    .from('group_members')
    .select(`
      group_id,
      groups (
        id,
        name,
        is_public,
        buyin_type,
        buyin_price,
        payment_link,
        creator_id,
        points_r1,
        points_r2,
        points_r3,
        points_sb,
        created_at
      )
    `)
    .eq('user_id', state.user.id);

  if (data) {
    // Get member counts for all user's groups
    const groupIds = data.map(d => d.groups.id);
    const { data: memberCounts } = await supabaseClient
      .from('group_members')
      .select('group_id')
      .in('group_id', groupIds);

    const countMap = {};
    memberCounts?.forEach(m => {
      countMap[m.group_id] = (countMap[m.group_id] || 0) + 1;
    });

    state.groups = data.map(d => ({
      ...d.groups,
      groupId: d.groups.id,
      isPublic: d.groups.is_public,
      buyinType: d.groups.buyin_type,
      buyinPrice: d.groups.buyin_price,
      paymentLink: d.groups.payment_link,
      creatorId: d.groups.creator_id,
      pointsR1: d.groups.points_r1,
      pointsR2: d.groups.points_r2,
      pointsR3: d.groups.points_r3,
      pointsSB: d.groups.points_sb,
      isCreator: d.groups.creator_id === state.user.id,
      memberCount: countMap[d.groups.id] || 0
    }));
    renderGroups();
  }
}

async function loadPublicGroups() {
  const { data } = await supabaseClient
    .from('groups')
    .select('*')
    .eq('is_public', true);

  if (data) {
    // Get member counts
    const groupIds = data.map(g => g.id);
    const { data: memberCounts } = await supabaseClient
      .from('group_members')
      .select('group_id')
      .in('group_id', groupIds);

    const countMap = {};
    memberCounts?.forEach(m => {
      countMap[m.group_id] = (countMap[m.group_id] || 0) + 1;
    });

    state.publicGroups = data.map(g => ({
      ...g,
      groupId: g.id,
      isPublic: g.is_public,
      buyinType: g.buyin_type,
      buyinPrice: g.buyin_price,
      pointsR1: g.points_r1,
      pointsR2: g.points_r2,
      pointsR3: g.points_r3,
      pointsSB: g.points_sb,
      memberCount: countMap[g.id] || 0
    }));

    if (state.currentGroupTab === 'public-groups') {
      renderGroups();
    }
  }
}

async function createGroup(groupData) {
  if (!state.user) {
    openModal('loginModal');
    return { error: 'Please sign in first' };
  }

  const { data: group, error } = await supabaseClient
    .from('groups')
    .insert({
      name: groupData.name,
      is_public: groupData.isPublic,
      buyin_type: groupData.buyinType,
      buyin_price: groupData.buyinPrice || 0,
      payment_link: groupData.paymentLink || '',
      creator_id: state.user.id,
      points_r1: groupData.pointsR1 || 2,
      points_r2: groupData.pointsR2 || 4,
      points_r3: groupData.pointsR3 || 6,
      points_sb: groupData.pointsSB || 8
    })
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  // Auto-join creator
  await supabaseClient
    .from('group_members')
    .insert({
      group_id: group.id,
      user_id: state.user.id
    });

  await loadUserGroups();

  const inviteLink = `${CONFIG.SITE_URL}?join=${group.id}`;
  showToast('Group created! Share the invite link with friends.', 'success');
  prompt('Share this link to invite friends:', inviteLink);

  return { success: true, group, inviteLink };
}

async function joinGroup(groupId, paidBuyin = false) {
  if (!state.user) {
    openModal('loginModal');
    return { error: 'Please sign in first' };
  }

  const { error } = await supabaseClient
    .from('group_members')
    .insert({
      group_id: groupId,
      user_id: state.user.id,
      paid_buyin: paidBuyin
    });

  if (error) {
    if (error.code === '23505') {
      return { error: 'Already a member of this group' };
    }
    return { error: error.message };
  }

  await loadUserGroups();
  showToast('Successfully joined the group!', 'success');
  return { success: true };
}

async function handleJoinLink(groupId) {
  const { data: group } = await supabaseClient
    .from('groups')
    .select('*')
    .eq('id', groupId)
    .single();

  if (group) {
    showJoinGroupModal({
      ...group,
      groupId: group.id,
      isPublic: group.is_public,
      buyinType: group.buyin_type,
      buyinPrice: group.buyin_price,
      pointsR1: group.points_r1,
      pointsR2: group.points_r2,
      pointsR3: group.points_r3,
      pointsSB: group.points_sb
    });
  } else {
    showToast('Group not found', 'error');
  }
}

function showJoinGroupModal(group) {
  const details = document.getElementById('joinGroupDetails');
  details.innerHTML = `
    <h3>${group.name}</h3>
    <p><strong>Visibility:</strong> ${group.isPublic ? 'Public' : 'Private'}</p>
    ${group.buyinType !== 'none' ? `
      <p><strong>Buy-in:</strong> $${group.buyinPrice} (${group.buyinType})</p>
      ${group.paymentLink ? `<p><a href="${group.paymentLink}" target="_blank">Payment Link</a></p>` : ''}
    ` : ''}
    <p><strong>Scoring:</strong> WC: ${group.pointsR1} | Div: ${group.pointsR2} | Conf: ${group.pointsR3} | SB: ${group.pointsSB}</p>
  `;

  const actionsDiv = document.querySelector('#joinGroupModal .modal-actions');

  // Different buttons based on buy-in type
  if (group.buyinType === 'optional') {
    actionsDiv.innerHTML = `
      <button class="btn btn-secondary" data-close>Cancel</button>
      <button class="btn btn-secondary" id="joinNoBuyinBtn">Join (No Buy-in)</button>
      <button class="btn btn-primary" id="joinWithBuyinBtn">Join with $${group.buyinPrice} Buy-in</button>
    `;

    document.getElementById('joinNoBuyinBtn').onclick = async () => {
      const result = await joinGroup(group.groupId, false);
      if (result.success) closeModal('joinGroupModal');
      else showFormMessage('joinGroupMessage', result.error, 'error');
    };

    document.getElementById('joinWithBuyinBtn').onclick = async () => {
      const result = await joinGroup(group.groupId, true);
      if (result.success) closeModal('joinGroupModal');
      else showFormMessage('joinGroupMessage', result.error, 'error');
    };
  } else {
    actionsDiv.innerHTML = `
      <button class="btn btn-secondary" data-close>Cancel</button>
      <button class="btn btn-primary" id="confirmJoinBtn">Join Group</button>
    `;

    document.getElementById('confirmJoinBtn').onclick = async () => {
      // For required buy-in, automatically mark as paid; for none, mark as false
      const paidBuyin = group.buyinType === 'required';
      const result = await joinGroup(group.groupId, paidBuyin);
      if (result.success) closeModal('joinGroupModal');
      else showFormMessage('joinGroupMessage', result.error, 'error');
    };
  }

  openModal('joinGroupModal');
}

async function openGroupDetail(groupId) {
  const { data: group } = await supabaseClient
    .from('groups')
    .select('*')
    .eq('id', groupId)
    .single();

  if (!group) {
    showToast('Group not found', 'error');
    return;
  }

  // Get group members with paid_buyin status
  const { data: memberData } = await supabaseClient
    .from('group_members')
    .select('user_id, paid_buyin')
    .eq('group_id', groupId);

  // Get profiles for all members
  const memberIds = memberData?.map(m => m.user_id) || [];
  const { data: profiles } = await supabaseClient
    .from('profiles')
    .select('id, display_name, email')
    .in('id', memberIds);

  // Combine members with their profiles
  const members = memberData?.map(m => {
    const profile = profiles?.find(p => p.id === m.user_id);
    return {
      user_id: m.user_id,
      display_name: profile?.display_name || profile?.email?.split('@')[0] || 'Unknown',
      email: profile?.email,
      paid_buyin: m.paid_buyin
    };
  }) || [];

  // Get actual results for scoring
  const { data: results } = await supabaseClient
    .from('actual_results')
    .select('*');

  // Calculate scores for leaderboard
  const leaderboard = [];
  for (const member of members || []) {
    let score = 0;
    let hasBracket = false;

    // Check bracket status using SECURITY DEFINER function (bypasses RLS)
    const { data: hasPicksResult } = await supabaseClient
      .rpc('get_user_bracket_status', { check_user_id: member.user_id });

    hasBracket = hasPicksResult === true;

    // For scoring, fetch picks if playoffs are locked OR if it's the current user
    if (state.playoffsLocked || (state.user && member.user_id === state.user.id)) {
      const { data: picks } = await supabaseClient
        .from('picks')
        .select('*')
        .eq('user_id', member.user_id);

      if (results && picks) {
        picks.forEach(pick => {
          const match = results.find(r =>
            r.conference === pick.conference &&
            r.round === pick.round &&
            r.team_id === pick.team_id
          );
          if (match) {
            switch (pick.round) {
              case 1: score += group.points_r1; break;
              case 2: score += group.points_r2; break;
              case 3: score += group.points_r3; break;
              case 4: score += group.points_sb; break;
            }
          }
        });
      }
    }

    leaderboard.push({
      userId: member.user_id,
      displayName: member.display_name,
      hasBracket,
      score,
      paidBuyin: member.paid_buyin
    });
  }

  leaderboard.sort((a, b) => b.score - a.score);
  leaderboard.forEach((entry, i) => entry.rank = i + 1);

  // Find leader among buy-in participants
  const buyinLeaderboard = leaderboard.filter(e => e.paidBuyin);
  buyinLeaderboard.forEach((entry, i) => entry.buyinRank = i + 1);

  // Check if current user is a member
  const isMember = state.user && members.some(m => m.user_id === state.user.id);
  const currentUserMember = members.find(m => m.user_id === state.user?.id);

  // Determine buy-in leader
  const buyinLeader = buyinLeaderboard.length > 0 ? buyinLeaderboard[0] : null;

  const content = document.getElementById('groupDetailContent');
  content.innerHTML = `
    <h2>${group.name}</h2>
    <div class="group-meta" style="margin-bottom: 1rem;">
      <span>${members?.length || 0} members</span>
      <span>${group.is_public ? 'Public' : 'Private'}</span>
      ${group.buyin_type !== 'none' ? `<span>$${group.buyin_price} buy-in (${group.buyin_type})</span>` : ''}
    </div>

    ${!isMember ? `
      <div style="margin-bottom: 1rem;">
        ${state.user ? (
          group.buyin_type === 'optional' ? `
            <button class="btn btn-secondary" onclick="joinGroupFromDetail('${group.id}', false)">Join (No Buy-in)</button>
            <button class="btn btn-primary" onclick="joinGroupFromDetail('${group.id}', true)">Join with $${group.buyin_price} Buy-in</button>
          ` : `
            <button class="btn btn-primary" onclick="joinGroupFromDetail('${group.id}', ${group.buyin_type === 'required'})">Join Group</button>
          `
        ) : `
          <button class="btn btn-primary" onclick="closeModal('groupDetailModal'); openModal('loginModal');">Sign in to Join</button>
        `}
      </div>
    ` : ''}

    ${isMember && group.buyin_type === 'optional' && !state.playoffsLocked ? `
      <div style="margin-bottom: 1rem; padding: 0.75rem; background: var(--bg-secondary); border-radius: 8px;">
        <strong>Your Buy-in Status:</strong> ${currentUserMember?.paid_buyin ? 'Participating' : 'Not participating'}
        <button class="btn btn-secondary" style="margin-left: 1rem; padding: 0.25rem 0.75rem;"
                onclick="toggleBuyinStatus('${group.id}', ${!currentUserMember?.paid_buyin})">
          ${currentUserMember?.paid_buyin ? 'Opt Out' : 'Opt In ($' + group.buyin_price + ')'}
        </button>
        ${group.payment_link ? `<a href="${group.payment_link}" target="_blank" style="margin-left: 0.5rem;">Payment Link</a>` : ''}
      </div>
    ` : ''}

    <div style="margin-bottom: 1rem;">
      <strong>Scoring:</strong> Wild Card: ${group.points_r1} | Divisional: ${group.points_r2} | Conference: ${group.points_r3} | Super Bowl: ${group.points_sb}
    </div>

    ${!state.playoffsLocked && isMember ? `
      <div style="margin-bottom: 1rem;">
        <strong>Invite Link:</strong>
        <input type="text" value="${CONFIG.SITE_URL}?join=${group.id}" readonly style="width: 100%;" onclick="this.select()">
      </div>
    ` : ''}

    ${group.buyin_type !== 'none' && buyinLeader ? `
      <div style="margin-bottom: 1rem; padding: 0.75rem; background: linear-gradient(135deg, #ffd700 0%, #ffed4a 100%); border-radius: 8px; color: #333;">
        <strong>Prize Leader:</strong> ${buyinLeader.displayName} (${buyinLeader.score} pts)
        <span style="font-size: 0.85rem; opacity: 0.8;"> - ${buyinLeaderboard.length} participant${buyinLeaderboard.length !== 1 ? 's' : ''} in prize pool</span>
      </div>
    ` : ''}

    <h3 style="margin-top: 1.5rem;">Leaderboard</h3>
    ${state.playoffsLocked ? '<p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.5rem;">Click a player to view their bracket</p>' : ''}
    <div class="leaderboard">
      <div class="leaderboard-row header">
        <div>Rank</div>
        <div>Player</div>
        <div>Score</div>
      </div>
      ${leaderboard.map((entry, i) => `
        <div class="leaderboard-row ${entry.paidBuyin ? 'buyin-participant' : ''} ${state.playoffsLocked && entry.hasBracket ? 'clickable' : ''}"
             ${state.playoffsLocked && entry.hasBracket ? `onclick="viewUserBracket('${entry.userId}', '${entry.displayName.replace(/'/g, "\\'")}', '${group.id}')"` : ''}
             ${state.playoffsLocked && entry.hasBracket ? 'style="cursor: pointer;"' : ''}>
          <div class="leaderboard-rank ${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''}">${entry.rank}</div>
          <div class="leaderboard-name">
            ${entry.displayName}
            ${entry.paidBuyin && group.buyin_type !== 'none' ? '<span style="color: #ffd700; font-size: 0.75rem; margin-left: 0.25rem;" title="In prize pool">$</span>' : ''}
            ${entry.paidBuyin && entry.buyinRank === 1 && group.buyin_type !== 'none' ? '<span style="font-size: 0.75rem; margin-left: 0.25rem;">👑</span>' : ''}
            ${!entry.hasBracket ? '<span style="color: var(--warning); font-size: 0.75rem; margin-left: 0.25rem;">(no bracket)</span>' : ''}
            ${state.playoffsLocked && entry.hasBracket ? '<span style="font-size: 0.75rem; margin-left: 0.25rem;">👁</span>' : ''}
          </div>
          <div class="leaderboard-score">${entry.score}</div>
        </div>
      `).join('')}
    </div>
  `;

  openModal('groupDetailModal');
}

async function viewUserBracket(userId, displayName, groupId) {
  // Use SECURITY DEFINER function to fetch picks (bypasses RLS)
  const { data: picks, error } = await supabaseClient
    .rpc('get_user_picks', { target_user_id: userId });

  if (error) {
    showToast('Failed to load bracket: ' + error.message, 'error');
    return;
  }

  // Create a helper to get pick for a specific slot
  const getPick = (conference, round, game) => {
    return picks?.find(p => p.conference === conference && p.round === round && p.game === game);
  };

  // Build team slot HTML with result status (uses global helper functions)
  const buildTeamSlot = (conference, round, game) => {
    const pick = getPick(conference, round, game);
    if (!pick) return '<div class="view-team-slot empty">-</div>';

    const team = state.teams[pick.team_id];

    // Use the same logic as main bracket: getPickResult handles all the elimination checks
    const result = getPickResult(conference, round, game, pick.team_id);
    let statusClass = result || ''; // null means pending (no class)

    return `
      <div class="view-team-slot ${statusClass}">
        <img src="${team?.logo || ''}" alt="" class="view-team-logo" onerror="this.style.display='none'">
        <span class="view-team-name">${team?.abbreviation || pick.team_id}</span>
        ${statusClass === 'correct' ? '<span class="status-icon">✓</span>' : ''}
        ${statusClass === 'incorrect' ? '<span class="status-icon">✗</span>' : ''}
      </div>
    `;
  };

  const content = document.getElementById('groupDetailContent');
  content.innerHTML = `
    <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem;">
      <button class="btn btn-secondary" onclick="openGroupDetail('${groupId}')" style="padding: 0.25rem 0.75rem;">&larr; Back</button>
      <h2 style="margin: 0;">${displayName}'s Bracket</h2>
    </div>

    <div class="view-bracket-container">
      <!-- NFC Side (Left) - Wild Card on far left, progressing toward center -->
      <div class="view-conference nfc">
        <h3 class="view-conf-title">NFC</h3>
        <div class="view-bracket-rounds">
          <div class="view-round">
            <div class="view-round-title">Wild Card</div>
            <div class="view-matchup">${buildTeamSlot('NFC', 1, 1)}</div>
            <div class="view-matchup">${buildTeamSlot('NFC', 1, 2)}</div>
            <div class="view-matchup">${buildTeamSlot('NFC', 1, 3)}</div>
          </div>
          <div class="view-round">
            <div class="view-round-title">Divisional</div>
            <div class="view-matchup">${buildTeamSlot('NFC', 2, 1)}</div>
            <div class="view-matchup">${buildTeamSlot('NFC', 2, 2)}</div>
          </div>
          <div class="view-round">
            <div class="view-round-title">NFC Champ</div>
            <div class="view-matchup">${buildTeamSlot('NFC', 3, 1)}</div>
          </div>
        </div>
      </div>

      <!-- Super Bowl (Center) -->
      <div class="view-super-bowl">
        <h3 class="view-conf-title">Super Bowl</h3>
        <div class="view-sb-matchup">
          ${buildTeamSlot('SB', 4, 1)}
        </div>
        <div class="view-champion-label">Champion</div>
      </div>

      <!-- AFC Side (Right) - AFC Champ near center, Wild Card on far right -->
      <div class="view-conference afc">
        <h3 class="view-conf-title">AFC</h3>
        <div class="view-bracket-rounds">
          <div class="view-round">
            <div class="view-round-title">AFC Champ</div>
            <div class="view-matchup">${buildTeamSlot('AFC', 3, 1)}</div>
          </div>
          <div class="view-round">
            <div class="view-round-title">Divisional</div>
            <div class="view-matchup">${buildTeamSlot('AFC', 2, 1)}</div>
            <div class="view-matchup">${buildTeamSlot('AFC', 2, 2)}</div>
          </div>
          <div class="view-round">
            <div class="view-round-title">Wild Card</div>
            <div class="view-matchup">${buildTeamSlot('AFC', 1, 1)}</div>
            <div class="view-matchup">${buildTeamSlot('AFC', 1, 2)}</div>
            <div class="view-matchup">${buildTeamSlot('AFC', 1, 3)}</div>
          </div>
        </div>
      </div>
    </div>

    <style>
      #groupDetailModal .modal-content {
        max-width: 900px;
        width: 95vw;
      }
      .view-bracket-container {
        display: flex;
        justify-content: center;
        align-items: flex-start;
        gap: 0.5rem;
        margin-top: 1rem;
        overflow-x: auto;
        padding: 1rem 0;
      }
      .view-conference {
        flex: 0 0 auto;
      }
      .view-conf-title {
        text-align: center;
        font-size: 1rem;
        margin-bottom: 0.75rem;
        padding-bottom: 0.5rem;
        border-bottom: 2px solid var(--border-color);
      }
      .view-bracket-rounds {
        display: flex;
        gap: 1rem;
      }
      .view-round {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        min-width: 90px;
      }
      .view-round-title {
        font-size: 0.75rem;
        text-transform: uppercase;
        color: var(--text-secondary);
        text-align: center;
        margin-bottom: 0.25rem;
        white-space: nowrap;
      }
      .view-matchup {
        display: flex;
        justify-content: center;
      }
      .view-team-slot {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        background: var(--bg-secondary);
        border-radius: 6px;
        font-size: 0.85rem;
        min-width: 85px;
        border: 2px solid transparent;
      }
      .view-team-slot.empty {
        color: var(--text-secondary);
        justify-content: center;
      }
      .view-team-slot.correct {
        background: rgba(34, 197, 94, 0.2);
        border-color: rgba(34, 197, 94, 0.6);
      }
      .view-team-slot.incorrect {
        background: rgba(239, 68, 68, 0.2);
        border-color: rgba(239, 68, 68, 0.6);
      }
      .view-team-logo {
        width: 20px;
        height: 20px;
        object-fit: contain;
      }
      .view-team-name {
        font-weight: 500;
      }
      .status-icon {
        margin-left: auto;
        font-weight: bold;
      }
      .view-team-slot.correct .status-icon { color: #22c55e; }
      .view-team-slot.incorrect .status-icon { color: #ef4444; }
      .view-super-bowl {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-width: 120px;
        padding: 1rem;
        background: linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-primary) 100%);
        border-radius: 8px;
        border: 2px solid var(--primary);
      }
      .view-sb-matchup {
        margin: 1rem 0;
      }
      .view-sb-matchup .view-team-slot {
        font-size: 0.9rem;
        padding: 0.5rem 0.75rem;
        min-width: 90px;
      }
      .view-champion-label {
        font-size: 0.7rem;
        text-transform: uppercase;
        color: var(--text-secondary);
      }
      @media (max-width: 700px) {
        #groupDetailModal .modal-content {
          max-width: 100%;
        }
        .view-bracket-container {
          flex-direction: column;
          align-items: center;
        }
        .view-conference, .view-super-bowl {
          width: 100%;
          max-width: 350px;
        }
        .view-bracket-rounds {
          justify-content: center;
        }
      }
    </style>
  `;
}

async function joinGroupFromDetail(groupId, paidBuyin = false) {
  const result = await joinGroup(groupId, paidBuyin);
  if (result.success) {
    closeModal('groupDetailModal');
    // Reopen to refresh the view
    await openGroupDetail(groupId);
  } else {
    showToast(result.error, 'error');
  }
}

async function toggleBuyinStatus(groupId, newStatus) {
  if (!state.user) return;

  const { error } = await supabaseClient
    .from('group_members')
    .update({ paid_buyin: newStatus })
    .eq('group_id', groupId)
    .eq('user_id', state.user.id);

  if (error) {
    showToast('Failed to update buy-in status: ' + error.message, 'error');
    return;
  }

  showToast(newStatus ? 'Opted into prize pool!' : 'Opted out of prize pool', 'success');
  // Refresh the group detail view
  await openGroupDetail(groupId);
}

function renderGroups() {
  const list = document.getElementById('groupsList');
  const groups = state.currentGroupTab === 'my-groups' ? state.groups : state.publicGroups;

  if (groups.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        ${state.currentGroupTab === 'my-groups'
          ? "You haven't joined any groups yet. Create one or join a public group!"
          : "No public groups available."}
      </div>
    `;
    return;
  }

  list.innerHTML = groups.map(group => `
    <div class="group-card" onclick="openGroupDetail('${group.groupId || group.id}')">
      <div class="group-card-header">
        <span class="group-name">${group.name}</span>
        <span class="group-badge">${group.isPublic || group.is_public ? 'Public' : 'Private'}</span>
      </div>
      <div class="group-meta">
        <span>${group.memberCount || '?'} members</span>
        ${(group.buyinType || group.buyin_type) !== 'none' ? `<span>$${group.buyinPrice || group.buyin_price} buy-in</span>` : ''}
      </div>
    </div>
  `).join('');
}

// ============================================
// Stats
// ============================================

async function loadStats() {
  const { data, error } = await supabaseClient.rpc('get_aggregate_stats');

  const content = document.getElementById('statsContent');

  if (error || !data || data.length === 0) {
    content.innerHTML = '<div class="empty-state">No brackets submitted yet.</div>';
    return;
  }

  // Get total users from the first row (all rows have the same total_users value)
  const totalUsers = data[0]?.total_users || 0;

  const byRound = {};
  data.forEach(stat => {
    const key = `${stat.conference}-R${stat.round}`;
    if (!byRound[key]) byRound[key] = [];
    byRound[key].push(stat);
  });

  Object.values(byRound).forEach(arr => arr.sort((a, b) => b.percentage - a.percentage));

  const roundNames = {
    1: 'Wild Card',
    2: 'Divisional',
    3: 'Conference Championship',
    4: 'Super Bowl'
  };

  let html = `<p style="margin-bottom: 1rem;">Based on <strong>${totalUsers}</strong> bracket${totalUsers !== 1 ? 's' : ''}</p><div class="stats-grid">`;

  ['AFC', 'NFC', 'SB'].forEach(conf => {
    [1, 2, 3, 4].forEach(round => {
      if (conf === 'SB' && round !== 4) return;
      if (conf !== 'SB' && round === 4) return;

      const key = `${conf}-R${round}`;
      const stats = byRound[key] || [];

      if (stats.length === 0) return;

      html += `
        <div class="stats-round">
          <div class="stats-round-title">${conf === 'SB' ? '' : conf + ' '}${roundNames[round]}</div>
          ${stats.map(stat => {
            const team = findTeamById(conf === 'SB' ? 'AFC' : conf, stat.team_id) ||
                        findTeamById('NFC', stat.team_id);
            return `
              <div class="stats-team">
                <img src="${team?.logo || ''}" class="stats-team-logo" onerror="this.style.display='none'">
                <span class="stats-team-name">${team?.shortName || 'Unknown'}</span>
                <div class="stats-bar">
                  <div class="stats-bar-fill" style="width: ${stat.percentage}%"></div>
                </div>
                <span class="stats-pct">${stat.percentage}%</span>
              </div>
            `;
          }).join('')}
        </div>
      `;
    });
  });

  html += '</div>';
  content.innerHTML = html;
}

// ============================================
// UI Helpers
// ============================================

function initializeUI() {
  updateAuthUI();

  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const modal = e.target.closest('.modal');
      if (modal) closeModal(modal.id);
    });
  });

  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal(modal.id);
    });
  });

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;

    showFormMessage('loginMessage', 'Sending login link...', 'success');

    const result = await sendMagicLink(email);

    if (result.success) {
      showFormMessage('loginMessage', 'Check your email for the login link!', 'success');
    } else {
      showFormMessage('loginMessage', result.error, 'error');
    }
  });

  document.getElementById('createGroupForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const groupData = {
      name: document.getElementById('groupName').value,
      isPublic: document.querySelector('input[name="isPublic"]:checked').value === 'true',
      buyinType: document.querySelector('input[name="buyinType"]:checked').value,
      buyinPrice: document.getElementById('buyinPrice').value,
      paymentLink: document.getElementById('paymentLink').value,
      pointsR1: parseInt(document.getElementById('pointsR1').value) || 2,
      pointsR2: parseInt(document.getElementById('pointsR2').value) || 4,
      pointsR3: parseInt(document.getElementById('pointsR3').value) || 6,
      pointsSB: parseInt(document.getElementById('pointsSB').value) || 8
    };

    const result = await createGroup(groupData);

    if (result.success) {
      closeModal('createGroupModal');
      e.target.reset();
    } else {
      showFormMessage('createGroupMessage', result.error, 'error');
    }
  });

  document.querySelectorAll('input[name="buyinType"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      document.getElementById('buyinDetails').style.display =
        e.target.value === 'none' ? 'none' : 'block';
    });
  });

  document.getElementById('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const displayName = document.getElementById('displayName').value;

    const result = await updateDisplayName(displayName);

    if (result.success) {
      updateAuthUI();
      showFormMessage('profileMessage', 'Profile updated!', 'success');
    } else {
      showFormMessage('profileMessage', result.error, 'error');
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await logout();
    closeModal('profileModal');
  });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentGroupTab = btn.dataset.tab;
      renderGroups();
    });
  });

  document.getElementById('createGroupBtn').addEventListener('click', () => {
    if (!state.user) {
      openModal('loginModal');
      return;
    }
    openModal('createGroupModal');
  });

  document.getElementById('statsBtn').addEventListener('click', async () => {
    openModal('statsModal');
    await loadStats();
  });

  document.getElementById('submitPicksBtn').addEventListener('click', savePicks);
  document.getElementById('resetPicksBtn').addEventListener('click', resetPicks);
}

function updateAuthUI() {
  const authSection = document.getElementById('authSection');

  if (state.user) {
    const displayName = state.profile?.display_name || state.user.email?.split('@')[0] || 'User';
    const initial = displayName[0].toUpperCase();
    authSection.innerHTML = `
      <div class="user-info" onclick="openModal('profileModal'); populateProfile();">
        <div class="user-avatar">${initial}</div>
        <span class="user-name">${displayName}</span>
      </div>
    `;
  } else {
    authSection.innerHTML = `
      <button class="btn btn-primary" onclick="openModal('loginModal')">Sign In</button>
    `;
  }

  const groupsSection = document.getElementById('groupsSection');
  if (state.user) {
    groupsSection.style.display = 'block';
  }

  updateBracketStatus();
}

function populateProfile() {
  if (state.profile) {
    document.getElementById('displayName').value = state.profile.display_name || '';
    document.getElementById('profileEmail').textContent = state.user?.email || '';
  }
}

function openModal(modalId) {
  document.getElementById(modalId).classList.add('open');
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('open');
  document.querySelectorAll('.form-message').forEach(el => {
    el.classList.remove('visible');
  });
}

function showFormMessage(elementId, message, type) {
  const el = document.getElementById(elementId);
  el.textContent = message;
  el.className = `form-message visible ${type}`;
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 4000);
}

function showLoading(show) {
  document.body.style.cursor = show ? 'wait' : 'default';
}

// Make functions globally available
window.openModal = openModal;
window.closeModal = closeModal;
window.openGroupDetail = openGroupDetail;
window.joinGroupFromDetail = joinGroupFromDetail;
window.toggleBuyinStatus = toggleBuyinStatus;
window.viewUserBracket = viewUserBracket;
window.populateProfile = populateProfile;

// Debug functions - call from browser console
window.debugLockBrackets = async function(locked = true) {
  const { error } = await supabaseClient
    .from('config')
    .update({ value: locked ? 'true' : 'false' })
    .eq('key', 'playoffs_locked');

  if (error) {
    console.error('Failed to update lock status:', error);
    console.log('You may need to run this SQL instead:');
    console.log(`UPDATE config SET value = '${locked}' WHERE key = 'playoffs_locked';`);
    return;
  }

  state.playoffsLocked = locked;
  updateLockStatus();
  renderBracket();
  console.log(`Brackets ${locked ? 'LOCKED' : 'UNLOCKED'}`);
};

window.debugUnlockBrackets = function() {
  return window.debugLockBrackets(false);
};

window.debugStatus = function() {
  console.log('Current state:', {
    playoffsLocked: state.playoffsLocked,
    user: state.user?.email,
    picksCount: state.picks.length,
    groupsCount: state.groups.length
  });
};

// Set the winner of a game for scoring
// Usage: debugSetWinner('AFC', 1, 1, '12') - sets AFC Wild Card Game 1 winner to team ID 12
window.debugSetWinner = async function(conference, round, game, teamId) {
  // Validate inputs
  if (!['AFC', 'NFC', 'SB'].includes(conference)) {
    console.error('Conference must be AFC, NFC, or SB');
    return;
  }
  if (round < 1 || round > 4) {
    console.error('Round must be 1-4 (1=Wild Card, 2=Divisional, 3=Conference, 4=Super Bowl)');
    return;
  }
  if (game < 1 || game > 3) {
    console.error('Game must be 1-3');
    return;
  }

  const { error } = await supabaseClient
    .from('actual_results')
    .upsert({
      conference,
      round,
      game,
      team_id: teamId
    }, { onConflict: 'conference,round,game' });

  if (error) {
    console.error('Failed to set winner:', error);
    console.log('You may need to run this SQL instead:');
    console.log(`INSERT INTO actual_results (conference, round, game, team_id) VALUES ('${conference}', ${round}, ${game}, '${teamId}') ON CONFLICT (conference, round, game) DO UPDATE SET team_id = '${teamId}';`);
    return;
  }

  console.log(`Set winner: ${conference} Round ${round} Game ${game} = Team ${teamId}`);

  // Show team name if we have it
  const team = state.teams[teamId];
  if (team) {
    console.log(`Winner: ${team.name}`);
  }

  // Refresh the UI to show correct/incorrect picks
  await loadActualResults();
};

// Clear a game result
window.debugClearWinner = async function(conference, round, game) {
  const { error } = await supabaseClient
    .from('actual_results')
    .delete()
    .eq('conference', conference)
    .eq('round', round)
    .eq('game', game);

  if (error) {
    console.error('Failed to clear winner:', error);
    return;
  }

  console.log(`Cleared winner for ${conference} Round ${round} Game ${game}`);

  // Refresh the UI
  await loadActualResults();
};

// Show all current results
window.debugShowResults = async function() {
  const { data, error } = await supabaseClient
    .from('actual_results')
    .select('*')
    .order('conference')
    .order('round')
    .order('game');

  if (error) {
    console.error('Failed to fetch results:', error);
    return;
  }

  if (!data || data.length === 0) {
    console.log('No results set yet');
    return;
  }

  console.log('Current Results:');
  const roundNames = { 1: 'Wild Card', 2: 'Divisional', 3: 'Conference', 4: 'Super Bowl' };
  data.forEach(r => {
    const team = state.teams[r.team_id];
    console.log(`  ${r.conference} ${roundNames[r.round]} Game ${r.game}: ${team?.name || r.team_id}`);
  });
};

// List all teams with IDs for reference
window.debugListTeams = function() {
  console.log('Teams by ID:');
  Object.entries(state.teams).forEach(([id, team]) => {
    console.log(`  ${id}: ${team.name} (${team.abbreviation})`);
  });
};

// Clear all game results
window.debugClearAllWinners = async function() {
  const { error } = await supabaseClient
    .from('actual_results')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all rows

  if (error) {
    console.error('Failed to clear results:', error);
    return;
  }

  console.log('All results cleared');

  // Refresh the UI
  await loadActualResults();
};
