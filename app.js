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
  currentGroupTab: 'my-groups'
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
  const hashParams = new URLSearchParams(window.location.hash.substring(1));
  const accessToken = hashParams.get('access_token');

  if (accessToken) {
    // Clear the hash from URL
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
      isCreator: d.groups.creator_id === state.user.id
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

async function joinGroup(groupId) {
  if (!state.user) {
    openModal('loginModal');
    return { error: 'Please sign in first' };
  }

  const { error } = await supabaseClient
    .from('group_members')
    .insert({
      group_id: groupId,
      user_id: state.user.id
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
  const { data: group } = await supabaseClient
    .from('groups')
    .select('*')
    .eq('id', groupId)
    .single();

  const { data: members } = await supabaseClient
    .from('group_members')
    .select(`
      user_id,
      profiles (
        display_name,
        email
      )
    `)
    .eq('group_id', groupId);

  if (!group) {
    showToast('Group not found', 'error');
    return;
  }

  // Calculate scores for leaderboard
  const leaderboard = [];
  for (const member of members || []) {
    const { data: picks } = await supabaseClient
      .from('picks')
      .select('*')
      .eq('user_id', member.user_id);

    // Get actual results for scoring
    const { data: results } = await supabaseClient
      .from('actual_results')
      .select('*');

    let score = 0;
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

    leaderboard.push({
      displayName: member.profiles?.display_name || member.profiles?.email?.split('@')[0] || 'Unknown',
      hasBracket: (picks?.length || 0) > 0,
      score
    });
  }

  leaderboard.sort((a, b) => b.score - a.score);
  leaderboard.forEach((entry, i) => entry.rank = i + 1);

  const content = document.getElementById('groupDetailContent');
  content.innerHTML = `
    <h2>${group.name}</h2>
    <div class="group-meta" style="margin-bottom: 1rem;">
      <span>${members?.length || 0} members</span>
      <span>${group.is_public ? 'Public' : 'Private'}</span>
      ${group.buyin_type !== 'none' ? `<span>$${group.buyin_price} buy-in</span>` : ''}
    </div>

    <div style="margin-bottom: 1rem;">
      <strong>Scoring:</strong> Wild Card: ${group.points_r1} | Divisional: ${group.points_r2} | Conference: ${group.points_r3} | Super Bowl: ${group.points_sb}
    </div>

    ${!state.playoffsLocked ? `
      <div style="margin-bottom: 1rem;">
        <strong>Invite Link:</strong>
        <input type="text" value="${CONFIG.SITE_URL}?join=${group.id}" readonly style="width: 100%;" onclick="this.select()">
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

  // Get total users
  const { count } = await supabaseClient
    .from('picks')
    .select('user_id', { count: 'exact', head: true });

  let html = `<p style="margin-bottom: 1rem;">Based on brackets from multiple users</p><div class="stats-grid">`;

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
window.populateProfile = populateProfile;
