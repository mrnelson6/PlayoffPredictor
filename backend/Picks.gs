/**
 * PlayoffPredictor - Picks Module
 * Handles saving and retrieving user bracket picks
 */

/**
 * Save user's bracket picks
 * picks: Array of { conference, round, game, teamId }
 */
function savePicks(sessionToken, picks) {
  const email = getEmailFromSession(sessionToken);
  if (!email) {
    return { error: 'Invalid session' };
  }

  // Check if playoffs are locked
  if (isPlayoffsLocked()) {
    return { error: 'Playoffs have started. Brackets are locked.' };
  }

  if (!Array.isArray(picks)) {
    return { error: 'Invalid picks data' };
  }

  const picksSheet = getSheet('Picks');
  const now = new Date().toISOString();

  // Delete existing picks for this user
  deleteUserPicks(email);

  // Insert new picks
  picks.forEach(pick => {
    if (pick.conference && pick.round && pick.game && pick.teamId) {
      picksSheet.appendRow([
        email,
        pick.conference,
        pick.round,
        pick.game,
        pick.teamId,
        now
      ]);
    }
  });

  return {
    success: true,
    message: 'Picks saved successfully',
    pickCount: picks.length
  };
}

/**
 * Get user's bracket picks
 */
function getPicks(sessionToken) {
  const email = getEmailFromSession(sessionToken);
  if (!email) {
    return { error: 'Invalid session' };
  }

  return getUserPicksByEmail(email);
}

/**
 * Get picks by email (for viewing other users' brackets after lockout)
 */
function getUserPicksByEmail(email) {
  const picksSheet = getSheet('Picks');
  const data = picksSheet.getDataRange().getValues();
  const picks = [];

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === email) {
      picks.push({
        conference: data[i][1],
        round: data[i][2],
        game: data[i][3],
        teamId: data[i][4],
        submittedAt: data[i][5]
      });
    }
  }

  return {
    picks: picks,
    submittedAt: picks.length > 0 ? picks[0].submittedAt : null
  };
}

/**
 * Delete all picks for a user
 */
function deleteUserPicks(email) {
  const picksSheet = getSheet('Picks');
  const data = picksSheet.getDataRange().getValues();

  // Find rows to delete (in reverse order to maintain indices)
  const rowsToDelete = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === email) {
      rowsToDelete.push(i + 1);
    }
  }

  // Delete in reverse order
  rowsToDelete.reverse().forEach(row => {
    picksSheet.deleteRow(row);
  });
}

/**
 * Get aggregate statistics across all users
 */
function getAggregateStats() {
  const picksSheet = getSheet('Picks');
  const data = picksSheet.getDataRange().getValues();

  // Count picks per team per round (ignoring game number for stats)
  const stats = {};
  const userCount = new Set();

  for (let i = 1; i < data.length; i++) {
    const email = data[i][0];
    const conference = data[i][1];
    const round = data[i][2];
    // game is data[i][3] - not needed for aggregate stats
    const teamId = data[i][4];

    userCount.add(email);

    // For aggregate stats, we just care about which team was picked to win each round
    const key = `${conference}-${round}-${teamId}`;
    if (!stats[key]) {
      stats[key] = {
        conference: conference,
        round: round,
        teamId: teamId,
        count: 0
      };
    }
    stats[key].count++;
  }

  const totalUsers = userCount.size;

  // Convert to array and calculate percentages
  const result = Object.values(stats).map(stat => ({
    ...stat,
    percentage: totalUsers > 0 ? Math.round((stat.count / totalUsers) * 100) : 0
  }));

  return {
    stats: result,
    totalUsers: totalUsers
  };
}

/**
 * Calculate user's score based on actual results
 * actualResults: Array of { conference, round, teamId } representing actual winners
 * userPicks: Array of user's picks
 * pointValues: { r1, r2, r3, sb } point values per round
 */
function calculateScore(userPicks, actualResults, pointValues) {
  const defaults = { r1: 2, r2: 4, r3: 6, sb: 8 };
  const points = { ...defaults, ...pointValues };

  let score = 0;

  // Create a set of actual winners per round
  const actualWinners = {};
  actualResults.forEach(result => {
    const key = `${result.conference}-${result.round}`;
    if (!actualWinners[key]) {
      actualWinners[key] = new Set();
    }
    actualWinners[key].add(result.teamId);
  });

  // Check each user pick
  userPicks.forEach(pick => {
    const key = `${pick.conference}-${pick.round}`;
    if (actualWinners[key] && actualWinners[key].has(pick.teamId)) {
      // Correct pick!
      switch (parseInt(pick.round)) {
        case 1:
          score += points.r1;
          break;
        case 2:
          score += points.r2;
          break;
        case 3:
          score += points.r3;
          break;
        case 4:
          score += points.sb;
          break;
      }
    }
  });

  return score;
}

/**
 * Check if a user has submitted their bracket
 */
function hasSubmittedBracket(email) {
  const picksSheet = getSheet('Picks');
  const data = picksSheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === email) {
      return true;
    }
  }

  return false;
}

/**
 * Get all users who have submitted brackets
 */
function getUsersWithBrackets() {
  const picksSheet = getSheet('Picks');
  const data = picksSheet.getDataRange().getValues();

  const users = new Set();
  for (let i = 1; i < data.length; i++) {
    users.add(data[i][0]);
  }

  return Array.from(users);
}
