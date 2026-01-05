/**
 * PlayoffPredictor - Groups Module
 * Handles group creation, joining, and leaderboards
 */

/**
 * Create a new group
 */
function createGroup(sessionToken, groupData) {
  const email = getEmailFromSession(sessionToken);
  if (!email) {
    return { error: 'Invalid session' };
  }

  // Validate required fields
  if (!groupData.name || groupData.name.trim().length < 2) {
    return { error: 'Group name must be at least 2 characters' };
  }

  const groupId = generateUUID();
  const now = new Date().toISOString();

  // Set defaults
  const group = {
    groupId: groupId,
    name: groupData.name.trim().substring(0, 50),
    isPublic: groupData.isPublic === true || groupData.isPublic === 'true',
    buyinType: groupData.buyinType || 'none', // none, optional, required
    buyinPrice: parseFloat(groupData.buyinPrice) || 0,
    paymentLink: groupData.paymentLink || '',
    creatorEmail: email,
    pointsR1: parseInt(groupData.pointsR1) || 2,
    pointsR2: parseInt(groupData.pointsR2) || 4,
    pointsR3: parseInt(groupData.pointsR3) || 6,
    pointsSB: parseInt(groupData.pointsSB) || 8,
    createdAt: now
  };

  // Insert group
  const groupsSheet = getSheet('Groups');
  groupsSheet.appendRow([
    group.groupId,
    group.name,
    group.isPublic,
    group.buyinType,
    group.buyinPrice,
    group.paymentLink,
    group.creatorEmail,
    group.pointsR1,
    group.pointsR2,
    group.pointsR3,
    group.pointsSB,
    group.createdAt
  ]);

  // Auto-join creator to the group
  const membersSheet = getSheet('GroupMembers');
  membersSheet.appendRow([groupId, email, now]);

  return {
    success: true,
    group: group,
    inviteLink: CONFIG.FRONTEND_URL + '?join=' + groupId
  };
}

/**
 * Get group by ID
 */
function getGroup(groupId) {
  if (!groupId) {
    return { error: 'Group ID required' };
  }

  const groupsSheet = getSheet('Groups');
  const data = groupsSheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === groupId) {
      const group = {
        groupId: data[i][0],
        name: data[i][1],
        isPublic: data[i][2],
        buyinType: data[i][3],
        buyinPrice: data[i][4],
        paymentLink: data[i][5],
        creatorEmail: data[i][6],
        pointsR1: data[i][7],
        pointsR2: data[i][8],
        pointsR3: data[i][9],
        pointsSB: data[i][10],
        createdAt: data[i][11]
      };

      // Get member count
      const members = getGroupMembersInternal(groupId);
      group.memberCount = members.length;

      return { group: group };
    }
  }

  return { error: 'Group not found' };
}

/**
 * Join a group
 */
function joinGroup(sessionToken, groupId) {
  const email = getEmailFromSession(sessionToken);
  if (!email) {
    return { error: 'Invalid session' };
  }

  // Check if group exists
  const groupResult = getGroup(groupId);
  if (groupResult.error) {
    return groupResult;
  }

  // Check if already a member
  const membersSheet = getSheet('GroupMembers');
  const data = membersSheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === groupId && data[i][1] === email) {
      return { error: 'Already a member of this group' };
    }
  }

  // Add member
  const now = new Date().toISOString();
  membersSheet.appendRow([groupId, email, now]);

  return {
    success: true,
    message: 'Successfully joined ' + groupResult.group.name,
    group: groupResult.group
  };
}

/**
 * Leave a group
 */
function leaveGroup(sessionToken, groupId) {
  const email = getEmailFromSession(sessionToken);
  if (!email) {
    return { error: 'Invalid session' };
  }

  const membersSheet = getSheet('GroupMembers');
  const data = membersSheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === groupId && data[i][1] === email) {
      membersSheet.deleteRow(i + 1);
      return { success: true, message: 'Left group successfully' };
    }
  }

  return { error: 'Not a member of this group' };
}

/**
 * Get all public groups
 */
function getPublicGroups() {
  const groupsSheet = getSheet('Groups');
  const data = groupsSheet.getDataRange().getValues();
  const groups = [];

  for (let i = 1; i < data.length; i++) {
    if (data[i][2] === true || data[i][2] === 'TRUE') {
      const group = {
        groupId: data[i][0],
        name: data[i][1],
        isPublic: true,
        buyinType: data[i][3],
        buyinPrice: data[i][4],
        creatorEmail: data[i][6],
        pointsR1: data[i][7],
        pointsR2: data[i][8],
        pointsR3: data[i][9],
        pointsSB: data[i][10],
        createdAt: data[i][11]
      };

      // Get member count
      const members = getGroupMembersInternal(group.groupId);
      group.memberCount = members.length;

      groups.push(group);
    }
  }

  return { groups: groups };
}

/**
 * Get groups for a user
 */
function getUserGroups(sessionToken) {
  const email = getEmailFromSession(sessionToken);
  if (!email) {
    return { error: 'Invalid session' };
  }

  const membersSheet = getSheet('GroupMembers');
  const membersData = membersSheet.getDataRange().getValues();

  // Get group IDs user belongs to
  const userGroupIds = new Set();
  for (let i = 1; i < membersData.length; i++) {
    if (membersData[i][1] === email) {
      userGroupIds.add(membersData[i][0]);
    }
  }

  // Get full group details
  const groupsSheet = getSheet('Groups');
  const groupsData = groupsSheet.getDataRange().getValues();
  const groups = [];

  for (let i = 1; i < groupsData.length; i++) {
    if (userGroupIds.has(groupsData[i][0])) {
      const group = {
        groupId: groupsData[i][0],
        name: groupsData[i][1],
        isPublic: groupsData[i][2],
        buyinType: groupsData[i][3],
        buyinPrice: groupsData[i][4],
        paymentLink: groupsData[i][5],
        creatorEmail: groupsData[i][6],
        pointsR1: groupsData[i][7],
        pointsR2: groupsData[i][8],
        pointsR3: groupsData[i][9],
        pointsSB: groupsData[i][10],
        createdAt: groupsData[i][11]
      };

      const members = getGroupMembersInternal(group.groupId);
      group.memberCount = members.length;
      group.isCreator = group.creatorEmail === email;

      groups.push(group);
    }
  }

  return { groups: groups };
}

/**
 * Get members of a group
 */
function getGroupMembers(groupId) {
  if (!groupId) {
    return { error: 'Group ID required' };
  }

  const members = getGroupMembersInternal(groupId);

  // Get user details for each member
  const usersSheet = getSheet('Users');
  const usersData = usersSheet.getDataRange().getValues();
  const userMap = {};

  for (let i = 1; i < usersData.length; i++) {
    userMap[usersData[i][0]] = {
      email: usersData[i][0],
      displayName: usersData[i][1]
    };
  }

  const enrichedMembers = members.map(member => ({
    email: member.email,
    displayName: userMap[member.email]?.displayName || member.email.split('@')[0],
    joinedAt: member.joinedAt,
    hasBracket: hasSubmittedBracket(member.email)
  }));

  return { members: enrichedMembers };
}

/**
 * Internal helper to get group members
 */
function getGroupMembersInternal(groupId) {
  const membersSheet = getSheet('GroupMembers');
  const data = membersSheet.getDataRange().getValues();
  const members = [];

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === groupId) {
      members.push({
        email: data[i][1],
        joinedAt: data[i][2]
      });
    }
  }

  return members;
}

/**
 * Get leaderboard for a group
 * Includes scores calculated from actual results if playoffs have started
 */
function getGroupLeaderboard(groupId) {
  if (!groupId) {
    return { error: 'Group ID required' };
  }

  // Get group for point values
  const groupResult = getGroup(groupId);
  if (groupResult.error) {
    return groupResult;
  }
  const group = groupResult.group;

  // Get members
  const members = getGroupMembersInternal(groupId);

  // Get user details
  const usersSheet = getSheet('Users');
  const usersData = usersSheet.getDataRange().getValues();
  const userMap = {};

  for (let i = 1; i < usersData.length; i++) {
    userMap[usersData[i][0]] = {
      email: usersData[i][0],
      displayName: usersData[i][1]
    };
  }

  // Check if playoffs are locked (to determine if we show picks)
  const playoffsLocked = isPlayoffsLocked();

  // Get actual results from Config sheet (if any)
  const actualResults = getActualResults();

  // Build leaderboard
  const leaderboard = members.map(member => {
    const userPicks = getUserPicksByEmail(member.email);
    const hasBracket = userPicks.picks.length > 0;

    // Calculate score if we have actual results
    let score = 0;
    if (actualResults.length > 0) {
      score = calculateScore(
        userPicks.picks,
        actualResults,
        {
          r1: group.pointsR1,
          r2: group.pointsR2,
          r3: group.pointsR3,
          sb: group.pointsSB
        }
      );
    }

    return {
      email: member.email,
      displayName: userMap[member.email]?.displayName || member.email.split('@')[0],
      hasBracket: hasBracket,
      score: score,
      picks: playoffsLocked ? userPicks.picks : [] // Only show picks if locked
    };
  });

  // Sort by score descending
  leaderboard.sort((a, b) => b.score - a.score);

  // Add rank
  leaderboard.forEach((entry, index) => {
    entry.rank = index + 1;
  });

  return {
    leaderboard: leaderboard,
    playoffsLocked: playoffsLocked,
    pointValues: {
      r1: group.pointsR1,
      r2: group.pointsR2,
      r3: group.pointsR3,
      sb: group.pointsSB
    }
  };
}

/**
 * Get actual playoff results from Config sheet
 * Format: JSON array stored in Config with key 'actualResults'
 */
function getActualResults() {
  const configSheet = getSheet('Config');
  const data = configSheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === 'actualResults') {
      try {
        return JSON.parse(data[i][1]) || [];
      } catch (e) {
        return [];
      }
    }
  }

  return [];
}

/**
 * Set actual playoff results (admin function)
 * results: Array of { conference, round, teamId }
 */
function setActualResults(adminKey, results) {
  if (adminKey !== 'YOUR_ADMIN_KEY') {
    return { error: 'Unauthorized' };
  }

  const configSheet = getSheet('Config');
  const data = configSheet.getDataRange().getValues();

  let found = false;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === 'actualResults') {
      configSheet.getRange(i + 1, 2).setValue(JSON.stringify(results));
      found = true;
      break;
    }
  }

  if (!found) {
    configSheet.appendRow(['actualResults', JSON.stringify(results)]);
  }

  return { success: true };
}
