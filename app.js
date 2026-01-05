/**
 * PlayoffPredictor - Main Application
 */

// ============================================
// Configuration
// ============================================

const CONFIG = {
  
  // UPDATE THIS after deploying your Apps Script
  API_URL: 'https://script.google.com/macros/s/AKfycbx_K7q_4naFXSieVtcXq0_Nx7OTYBavNYQ9W-9mh2l8P1SO_MFMaZ-E2yCBvEHjplMd/exec',

  // ESPN API endpoints
  ESPN_SCOREBOARD: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
  ESPN_TEAMS: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams',

  // Logo URL pattern
  LOGO_URL: (abbrev) => `https://a.espncdn.com/i/teamlogos/nfl/500/${abbrev}.png`,

  // Storage keys
  STORAGE_SESSION: 'pp_session',
  STORAGE_PICKS: 'pp_picks_draft'
};

// ============================================
// State Management
// ============================================

const state = {
  user: null,
  sessionToken: null,
  teams: {},           // teamId -> team data
  playoffTeams: {      // conference -> seed -> team
    AFC: {},
    NFC: {}
  },
  picks: [],           // User's picks
  savedPicks: [],      // Picks from server
  groups: [],
  publicGroups: [],
  playoffsLocked: false,
  currentGroupTab: 'my-groups'
};

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  // Check for magic link token in URL
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token');
  const joinGroupId = urlParams.get('join');

  if (token) {
    await handleMagicLinkToken(token);
    // Clean URL
    window.history.replaceState({}, document.title, window.location.pathname);
  } else {
    // Try to restore session
    await restoreSession();
  }

  // Load NFL data
  await loadNFLData();

  // Check if playoffs are locked
  await checkPlayoffsLocked();

  // Initialize UI
  initializeUI();

  // Handle group join link
  if (joinGroupId) {
    await handleJoinLink(joinGroupId);
  }

  // Render bracket
  renderBracket();

  // Load user data if logged in
  if (state.user) {
    await loadUserPicks();
    await loadUserGroups();
  }

  // Load public groups
  await loadPublicGroups();
});

// ============================================
// API Calls
// ============================================

async function apiCall(action, params = {}) {
  const url = new URL(CONFIG.API_URL);
  url.searchParams.set('action', action);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, typeof value === 'object' ? JSON.stringify(value) : value);
    }
  });

  try {
    const response = await fetch(url.toString());
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('API Error:', error);
    return { error: error.message };
  }
}

// ============================================
// Authentication
// ============================================

async function handleMagicLinkToken(token) {
  showLoading(true);
  const result = await apiCall('validateToken', { token });
  showLoading(false);

  if (result.success) {
    state.sessionToken = result.sessionToken;
    state.user = result.user;
    localStorage.setItem(CONFIG.STORAGE_SESSION, result.sessionToken);
    showToast('Welcome back, ' + state.user.displayName + '!', 'success');
    updateAuthUI();
  } else {
    showToast(result.error || 'Invalid login link', 'error');
  }
}

async function restoreSession() {
  const sessionToken = localStorage.getItem(CONFIG.STORAGE_SESSION);
  if (!sessionToken) return;

  const result = await apiCall('validateSession', { sessionToken });

  if (result.valid) {
    state.sessionToken = sessionToken;
    state.user = result.user;
    updateAuthUI();
  } else {
    localStorage.removeItem(CONFIG.STORAGE_SESSION);
  }
}

async function sendMagicLink(email) {
  const result = await apiCall('sendMagicLink', { email });
  return result;
}

async function logout() {
  await apiCall('logout', { sessionToken: state.sessionToken });
  localStorage.removeItem(CONFIG.STORAGE_SESSION);
  state.user = null;
  state.sessionToken = null;
  state.picks = [];
  state.savedPicks = [];
  state.groups = [];
  updateAuthUI();
  renderBracket();
  showToast('Signed out successfully', 'success');
}

// ============================================
// NFL Data
// ============================================

async function loadNFLData() {
  try {
    // Fetch teams
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

    // Fetch scoreboard for playoff data
    const scoreboardResponse = await fetch(CONFIG.ESPN_SCOREBOARD);
    const scoreboardData = await scoreboardResponse.json();

    // Parse playoff teams from scoreboard or use standings
    await loadPlayoffTeams();

  } catch (error) {
    console.error('Error loading NFL data:', error);
    // Use fallback data if ESPN fails
    loadFallbackData();
  }
}

async function loadPlayoffTeams() {
  // Try to get playoff standings
  try {
    const standingsUrl = 'https://site.api.espn.com/apis/v2/sports/football/nfl/standings';
    const response = await fetch(standingsUrl);
    const data = await response.json();

    // Parse standings to get playoff seeds
    data.children?.forEach(conference => {
      const confName = conference.abbreviation; // AFC or NFC

      // Get teams sorted by playoff seed
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
  // Fallback: Use 2024-25 playoff teams as example
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
  const result = await apiCall('isPlayoffsLocked');
  state.playoffsLocked = result.locked || false;
  updateLockStatus();
}

// ============================================
// Picks
// ============================================

async function loadUserPicks() {
  if (!state.sessionToken) return;

  const result = await apiCall('getPicks', { sessionToken: state.sessionToken });

  if (result.picks) {
    state.savedPicks = result.picks;
    state.picks = [...result.picks];
    renderBracket();
    updateBracketStatus();
  }
}

async function savePicks() {
  if (!state.sessionToken) {
    openModal('loginModal');
    return;
  }

  if (state.playoffsLocked) {
    showToast('Brackets are locked!', 'error');
    return;
  }

  showLoading(true);
  const result = await apiCall('savePicks', {
    sessionToken: state.sessionToken,
    picks: state.picks
  });
  showLoading(false);

  if (result.success) {
    state.savedPicks = [...state.picks];
    showToast('Bracket saved!', 'success');
    updateBracketStatus();
  } else {
    showToast(result.error || 'Failed to save', 'error');
  }
}

function resetPicks() {
  state.picks = [];
  renderBracket();
  updateBracketStatus();
}

// Get pick for a specific matchup (conference, round, game)
function getPick(conference, round, game) {
  return state.picks.find(p =>
    p.conference === conference &&
    p.round === round &&
    p.game === game
  );
}

// Set a pick for a specific matchup
function setPick(conference, round, game, teamId) {
  // Remove existing pick for this specific matchup
  state.picks = state.picks.filter(p =>
    !(p.conference === conference && p.round === round && p.game === game)
  );

  // Add new pick
  if (teamId) {
    state.picks.push({ conference, round, game, teamId });
  }

  // Clear downstream picks that might be invalidated
  clearDownstreamPicks(conference, round, teamId);

  renderBracket();
  updateBracketStatus();
}

function clearDownstreamPicks(conference, round, newTeamId) {
  // When a pick changes, we need to clear picks in later rounds
  // that might have depended on a different team advancing

  if (round === 1) {
    // Changing a Wild Card pick clears Divisional and beyond for this conference
    state.picks = state.picks.filter(p =>
      !(p.conference === conference && p.round >= 2)
    );
    // Also clear Super Bowl if it involved this conference's teams
    state.picks = state.picks.filter(p =>
      !(p.conference === 'SB')
    );
  } else if (round === 2) {
    // Changing a Divisional pick clears Conference Championship and Super Bowl
    state.picks = state.picks.filter(p =>
      !(p.conference === conference && p.round >= 3)
    );
    state.picks = state.picks.filter(p =>
      !(p.conference === 'SB')
    );
  } else if (round === 3) {
    // Changing Conference Championship clears Super Bowl
    state.picks = state.picks.filter(p =>
      !(p.conference === 'SB')
    );
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

  // Round 1: Wild Card - Fixed matchups based on seeding
  // Game 1: 2 vs 7, Game 2: 3 vs 6, Game 3: 4 vs 5
  renderMatchup(conference, 1, 1, [teams[2], teams[7]]);
  renderMatchup(conference, 1, 2, [teams[3], teams[6]]);
  renderMatchup(conference, 1, 3, [teams[4], teams[5]]);

  // Round 2: Divisional - Based on Wild Card winners
  // #1 seed plays lowest remaining seed, other two play each other
  const wcWinners = getWildCardWinners(conference);
  const divMatchups = buildDivisionalMatchups(conference, teams[1], wcWinners);
  renderMatchup(conference, 2, 1, divMatchups[0]);
  renderMatchup(conference, 2, 2, divMatchups[1]);

  // Round 3: Conference Championship - Based on Divisional winners
  const divWinners = getDivisionalWinners(conference);
  renderMatchup(conference, 3, 1, divWinners);
}

// Get Wild Card winners based on user picks for each game
function getWildCardWinners(conference) {
  const winners = [];

  for (let game = 1; game <= 3; game++) {
    const pick = getPick(conference, 1, game);
    if (pick) {
      const team = findTeamById(conference, pick.teamId);
      if (team) {
        winners.push(team);
      }
    }
  }

  return winners;
}

// Build Divisional round matchups based on NFL rules
// #1 seed plays lowest remaining seed, other two winners play each other
function buildDivisionalMatchups(conference, topSeed, wcWinners) {
  if (wcWinners.length < 3) {
    // Not all Wild Card picks made yet - show TBD
    return [
      [topSeed, null],
      [null, null]
    ];
  }

  // Sort winners by seed (higher seed number = lower seed)
  const sorted = [...wcWinners].sort((a, b) => b.seed - a.seed);

  // Lowest seed (highest number) plays #1
  const lowestSeed = sorted[0];
  // Other two play each other (sorted by seed for consistent display)
  const others = sorted.slice(1).sort((a, b) => a.seed - b.seed);

  return [
    [topSeed, lowestSeed],      // Game 1: #1 vs lowest remaining
    [others[0], others[1]]       // Game 2: other two winners
  ];
}

// Get Divisional round winners based on user picks
function getDivisionalWinners(conference) {
  const winners = [];

  for (let game = 1; game <= 2; game++) {
    const pick = getPick(conference, 2, game);
    if (pick) {
      const team = findTeamById(conference, pick.teamId);
      if (team) {
        winners.push(team);
      }
    }
  }

  return winners;
}

// Find a team by ID within a conference
function findTeamById(conference, teamId) {
  // Check the specified conference first
  const teams = state.playoffTeams[conference];
  if (teams) {
    for (const seed in teams) {
      if (teams[seed]?.teamId === teamId) {
        return teams[seed];
      }
    }
  }

  // For Super Bowl, check both conferences
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
  // Get conference champions from user's round 3 picks
  const afcChampPick = getPick('AFC', 3, 1);
  const nfcChampPick = getPick('NFC', 3, 1);

  const afcChamp = afcChampPick ? findTeamById('AFC', afcChampPick.teamId) : null;
  const nfcChamp = nfcChampPick ? findTeamById('NFC', nfcChampPick.teamId) : null;

  const sbMatchup = document.querySelector('.super-bowl-matchup');
  if (sbMatchup) {
    const slots = sbMatchup.querySelectorAll('.team-slot');
    // NFC on top (left side of bracket), AFC on bottom (right side of bracket)
    renderTeamSlot(slots[0], nfcChamp, 'SB', 4, 1, true);
    renderTeamSlot(slots[1], afcChamp, 'SB', 4, 1, true);
  }

  // Champion display - show who user picked to win Super Bowl
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

  slot.innerHTML = `
    <img src="${team.logo}" alt="${team.abbreviation}" class="team-logo" onerror="this.style.display='none'">
    <div class="team-info">
      <div class="team-name">${team.shortName || team.name}</div>
    </div>
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
  // Remove old event listeners by cloning
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

  if (isSelected) {
    slot.classList.add('selected');
  }

  // Check locked state
  if (state.playoffsLocked || !state.user) {
    slot.classList.add('locked');
  }

  slot.innerHTML = `
    <img src="${team.logo}" alt="${team.abbreviation}" class="team-logo" onerror="this.style.display='none'">
    <div class="team-info">
      <div class="team-name">${team.shortName || team.name}</div>
      <div class="team-seed">#${team.seed} seed</div>
    </div>
  `;

  // Add click handler
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
    // Deselect - clicking same team again
    setPick(conference, round, game, null);
  } else {
    // Select this team as winner
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
  const expectedPicks = 13; // 6 WC + 4 Div + 2 Conf + 1 SB

  if (totalPicks === 0) {
    banner.className = 'status-banner visible warning';
    banner.innerHTML = 'Click on teams to make your picks, then submit your bracket!';
  } else if (totalPicks < expectedPicks) {
    banner.className = 'status-banner visible warning';
    banner.innerHTML = `You have ${totalPicks}/${expectedPicks} picks. Complete your bracket and submit!`;
  } else {
    const hasUnsaved = JSON.stringify(state.picks) !== JSON.stringify(state.savedPicks);
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
  if (!state.sessionToken) return;

  const result = await apiCall('getUserGroups', { sessionToken: state.sessionToken });

  if (result.groups) {
    state.groups = result.groups;
    renderGroups();
  }
}

async function loadPublicGroups() {
  const result = await apiCall('getPublicGroups');

  if (result.groups) {
    state.publicGroups = result.groups;
    if (state.currentGroupTab === 'public-groups') {
      renderGroups();
    }
  }
}

async function createGroup(groupData) {
  if (!state.sessionToken) {
    openModal('loginModal');
    return { error: 'Please sign in first' };
  }

  const result = await apiCall('createGroup', {
    sessionToken: state.sessionToken,
    groupData: groupData
  });

  if (result.success) {
    await loadUserGroups();
    showToast('Group created! Share the invite link with friends.', 'success');

    // Show invite link
    if (result.inviteLink) {
      prompt('Share this link to invite friends:', result.inviteLink);
    }
  }

  return result;
}

async function joinGroup(groupId) {
  if (!state.sessionToken) {
    openModal('loginModal');
    return { error: 'Please sign in first' };
  }

  const result = await apiCall('joinGroup', {
    sessionToken: state.sessionToken,
    groupId: groupId
  });

  if (result.success) {
    await loadUserGroups();
    showToast(result.message, 'success');
  }

  return result;
}

async function handleJoinLink(groupId) {
  // Get group details
  const result = await apiCall('getGroup', { groupId });

  if (result.group) {
    showJoinGroupModal(result.group);
  } else {
    showToast('Group not found', 'error');
  }

  // Clean URL
  window.history.replaceState({}, document.title, window.location.pathname);
}

function showJoinGroupModal(group) {
  const details = document.getElementById('joinGroupDetails');
  details.innerHTML = `
    <h3>${group.name}</h3>
    <p><strong>Members:</strong> ${group.memberCount}</p>
    <p><strong>Visibility:</strong> ${group.isPublic ? 'Public' : 'Private'}</p>
    ${group.buyinType !== 'none' ? `
      <p><strong>Buy-in:</strong> $${group.buyinPrice} (${group.buyinType})</p>
      ${group.paymentLink ? `<p><a href="${group.paymentLink}" target="_blank">Payment Link</a></p>` : ''}
    ` : ''}
    <p><strong>Scoring:</strong> WC: ${group.pointsR1} | Div: ${group.pointsR2} | Conf: ${group.pointsR3} | SB: ${group.pointsSB}</p>
  `;

  document.getElementById('confirmJoinBtn').onclick = async () => {
    const result = await joinGroup(group.groupId);
    if (result.success) {
      closeModal('joinGroupModal');
    } else {
      showFormMessage('joinGroupMessage', result.error, 'error');
    }
  };

  openModal('joinGroupModal');
}

async function openGroupDetail(groupId) {
  const groupResult = await apiCall('getGroup', { groupId });
  const membersResult = await apiCall('getGroupMembers', { groupId });
  const leaderboardResult = await apiCall('getGroupLeaderboard', { groupId });

  if (groupResult.error) {
    showToast(groupResult.error, 'error');
    return;
  }

  const group = groupResult.group;
  const members = membersResult.members || [];
  const leaderboard = leaderboardResult.leaderboard || [];

  const content = document.getElementById('groupDetailContent');
  content.innerHTML = `
    <h2>${group.name}</h2>
    <div class="group-meta" style="margin-bottom: 1rem;">
      <span>${members.length} members</span>
      <span>${group.isPublic ? 'Public' : 'Private'}</span>
      ${group.buyinType !== 'none' ? `<span>$${group.buyinPrice} buy-in</span>` : ''}
    </div>

    <div style="margin-bottom: 1rem;">
      <strong>Scoring:</strong> Wild Card: ${group.pointsR1} | Divisional: ${group.pointsR2} | Conference: ${group.pointsR3} | Super Bowl: ${group.pointsSB}
    </div>

    ${!state.playoffsLocked ? `
      <div style="margin-bottom: 1rem;">
        <strong>Invite Link:</strong>
        <input type="text" value="${CONFIG.API_URL.replace('/exec', '')}?join=${group.groupId}" readonly style="width: 100%;" onclick="this.select()">
      </div>
    ` : ''}

    <h3 style="margin-top: 1.5rem;">Leaderboard</h3>
    <div class="leaderboard">
      <div class="leaderboard-row header">
        <div>Rank</div>
        <div>Player</div>
        <div>Score</div>
      </div>
      ${leaderboard.map((entry, i) => `
        <div class="leaderboard-row">
          <div class="leaderboard-rank ${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''}">${entry.rank}</div>
          <div class="leaderboard-name">
            ${entry.displayName}
            ${!entry.hasBracket ? '<span style="color: var(--warning); font-size: 0.75rem;">(no bracket)</span>' : ''}
          </div>
          <div class="leaderboard-score">${entry.score}</div>
        </div>
      `).join('')}
    </div>
  `;

  openModal('groupDetailModal');
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
    <div class="group-card" onclick="openGroupDetail('${group.groupId}')">
      <div class="group-card-header">
        <span class="group-name">${group.name}</span>
        <span class="group-badge">${group.isPublic ? 'Public' : 'Private'}</span>
      </div>
      <div class="group-meta">
        <span>${group.memberCount} members</span>
        ${group.buyinType !== 'none' ? `<span>$${group.buyinPrice} buy-in</span>` : ''}
      </div>
    </div>
  `).join('');
}

// ============================================
// Stats
// ============================================

async function loadStats() {
  const result = await apiCall('getAggregateStats');

  if (result.error) {
    showToast(result.error, 'error');
    return;
  }

  const content = document.getElementById('statsContent');

  if (result.totalUsers === 0) {
    content.innerHTML = '<div class="empty-state">No brackets submitted yet.</div>';
    return;
  }

  // Group stats by round
  const byRound = {};
  result.stats.forEach(stat => {
    const key = `${stat.conference}-R${stat.round}`;
    if (!byRound[key]) byRound[key] = [];
    byRound[key].push(stat);
  });

  // Sort each round by percentage
  Object.values(byRound).forEach(arr => arr.sort((a, b) => b.percentage - a.percentage));

  const roundNames = {
    1: 'Wild Card',
    2: 'Divisional',
    3: 'Conference Championship',
    4: 'Super Bowl'
  };

  let html = `<p style="margin-bottom: 1rem;">Based on ${result.totalUsers} brackets</p><div class="stats-grid">`;

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
            const team = findTeamById(conf === 'SB' ? 'AFC' : conf, stat.teamId) ||
                        findTeamById('NFC', stat.teamId);
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
  // Auth UI
  updateAuthUI();

  // Modal close buttons
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const modal = e.target.closest('.modal');
      if (modal) closeModal(modal.id);
    });
  });

  // Click outside modal to close
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal(modal.id);
    });
  });

  // Login form
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

  // Create group form
  document.getElementById('createGroupForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const groupData = {
      name: document.getElementById('groupName').value,
      isPublic: document.querySelector('input[name="isPublic"]:checked').value === 'true',
      buyinType: document.querySelector('input[name="buyinType"]:checked').value,
      buyinPrice: document.getElementById('buyinPrice').value,
      paymentLink: document.getElementById('paymentLink').value,
      pointsR1: document.getElementById('pointsR1').value,
      pointsR2: document.getElementById('pointsR2').value,
      pointsR3: document.getElementById('pointsR3').value,
      pointsSB: document.getElementById('pointsSB').value
    };

    const result = await createGroup(groupData);

    if (result.success) {
      closeModal('createGroupModal');
      e.target.reset();
    } else {
      showFormMessage('createGroupMessage', result.error, 'error');
    }
  });

  // Buy-in toggle
  document.querySelectorAll('input[name="buyinType"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      document.getElementById('buyinDetails').style.display =
        e.target.value === 'none' ? 'none' : 'block';
    });
  });

  // Profile form
  document.getElementById('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const displayName = document.getElementById('displayName').value;

    const result = await apiCall('updateDisplayName', {
      sessionToken: state.sessionToken,
      displayName: displayName
    });

    if (result.success) {
      state.user = result.user;
      updateAuthUI();
      showFormMessage('profileMessage', 'Profile updated!', 'success');
    } else {
      showFormMessage('profileMessage', result.error, 'error');
    }
  });

  // Logout button
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await logout();
    closeModal('profileModal');
  });

  // Group tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentGroupTab = btn.dataset.tab;
      renderGroups();
    });
  });

  // Create group button
  document.getElementById('createGroupBtn').addEventListener('click', () => {
    if (!state.user) {
      openModal('loginModal');
      return;
    }
    openModal('createGroupModal');
  });

  // Stats button
  document.getElementById('statsBtn').addEventListener('click', async () => {
    openModal('statsModal');
    await loadStats();
  });

  // Bracket actions
  document.getElementById('submitPicksBtn').addEventListener('click', savePicks);
  document.getElementById('resetPicksBtn').addEventListener('click', resetPicks);
}

function updateAuthUI() {
  const authSection = document.getElementById('authSection');

  if (state.user) {
    const initial = (state.user.displayName || state.user.email)[0].toUpperCase();
    authSection.innerHTML = `
      <div class="user-info" onclick="openModal('profileModal'); populateProfile();">
        <div class="user-avatar">${initial}</div>
        <span class="user-name">${state.user.displayName}</span>
      </div>
    `;
  } else {
    authSection.innerHTML = `
      <button class="btn btn-primary" onclick="openModal('loginModal')">Sign In</button>
    `;
  }

  // Update groups section visibility
  const groupsSection = document.getElementById('groupsSection');
  if (state.user) {
    groupsSection.style.display = 'block';
  }

  updateBracketStatus();
}

function populateProfile() {
  if (state.user) {
    document.getElementById('displayName').value = state.user.displayName || '';
    document.getElementById('profileEmail').textContent = state.user.email;
  }
}

function openModal(modalId) {
  document.getElementById(modalId).classList.add('open');
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('open');
  // Clear form messages
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
  // Could add a loading overlay here
  document.body.style.cursor = show ? 'wait' : 'default';
}

// Make functions globally available for onclick handlers
window.openModal = openModal;
window.closeModal = closeModal;
window.openGroupDetail = openGroupDetail;
window.populateProfile = populateProfile;
