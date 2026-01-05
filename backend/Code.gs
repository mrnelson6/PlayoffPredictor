/**
 * PlayoffPredictor - Main Apps Script Entry Point
 * Deploy this as a Web App to handle API requests from the frontend
 */

// Configuration - UPDATE THESE after deploying
const CONFIG = {
  FRONTEND_URL: 'https://playoff.ttnelson.com', // Update after GitHub Pages deploy
  TOKEN_EXPIRY_HOURS: 24,
  PLAYOFFS_LOCKED: false // Set to true manually or via admin function when playoffs start
};

/**
 * Handle GET requests
 */
function doGet(e) {
  return handleRequest(e, 'GET');
}

/**
 * Handle POST requests
 */
function doPost(e) {
  return handleRequest(e, 'POST');
}

/**
 * Main request router
 */
function handleRequest(e, method) {
  const params = e.parameter;
  const action = params.action;

  // Enable CORS
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  try {
    let result;

    switch (action) {
      // Auth endpoints
      case 'sendMagicLink':
        result = sendMagicLink(params.email);
        break;
      case 'validateToken':
        result = validateToken(params.token);
        break;
      case 'validateSession':
        result = validateSession(params.sessionToken);
        break;
      case 'logout':
        result = logout(params.sessionToken);
        break;

      // User endpoints
      case 'updateDisplayName':
        result = updateDisplayName(params.sessionToken, params.displayName);
        break;
      case 'getUser':
        result = getUser(params.sessionToken);
        break;

      // Picks endpoints
      case 'savePicks':
        const picksData = JSON.parse(params.picks || '[]');
        result = savePicks(params.sessionToken, picksData);
        break;
      case 'getPicks':
        result = getPicks(params.sessionToken);
        break;
      case 'getUserPicksByEmail':
        result = getUserPicksByEmail(params.email);
        break;

      // Groups endpoints
      case 'createGroup':
        const groupData = JSON.parse(params.groupData || '{}');
        result = createGroup(params.sessionToken, groupData);
        break;
      case 'getGroup':
        result = getGroup(params.groupId);
        break;
      case 'joinGroup':
        result = joinGroup(params.sessionToken, params.groupId);
        break;
      case 'leaveGroup':
        result = leaveGroup(params.sessionToken, params.groupId);
        break;
      case 'getPublicGroups':
        result = getPublicGroups();
        break;
      case 'getUserGroups':
        result = getUserGroups(params.sessionToken);
        break;
      case 'getGroupMembers':
        result = getGroupMembers(params.groupId);
        break;
      case 'getGroupLeaderboard':
        result = getGroupLeaderboard(params.groupId);
        break;

      // Stats endpoints
      case 'getAggregateStats':
        result = getAggregateStats();
        break;

      // Admin endpoints
      case 'lockPlayoffs':
        result = lockPlayoffs(params.adminKey);
        break;
      case 'isPlayoffsLocked':
        result = { locked: isPlayoffsLocked() };
        break;

      default:
        result = { error: 'Unknown action: ' + action };
    }

    output.setContent(JSON.stringify(result));
  } catch (error) {
    output.setContent(JSON.stringify({
      error: error.message,
      stack: error.stack
    }));
  }

  return output;
}

/**
 * Get or create a spreadsheet sheet by name
 */
function getSheet(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    initializeSheet(sheet, sheetName);
  }

  return sheet;
}

/**
 * Initialize sheet with headers based on schema
 */
function initializeSheet(sheet, sheetName) {
  const headers = {
    'Users': ['email', 'displayName', 'createdAt', 'lastLogin'],
    'Sessions': ['token', 'email', 'expiresAt'],
    'Picks': ['email', 'conference', 'round', 'game', 'teamId', 'submittedAt'],
    'Groups': ['groupId', 'name', 'isPublic', 'buyinType', 'buyinPrice', 'paymentLink', 'creatorEmail', 'pointsR1', 'pointsR2', 'pointsR3', 'pointsSB', 'createdAt'],
    'GroupMembers': ['groupId', 'email', 'joinedAt'],
    'Config': ['key', 'value']
  };

  if (headers[sheetName]) {
    sheet.getRange(1, 1, 1, headers[sheetName].length).setValues([headers[sheetName]]);
    sheet.getRange(1, 1, 1, headers[sheetName].length).setFontWeight('bold');
  }
}

/**
 * Generate a UUID
 */
function generateUUID() {
  return Utilities.getUuid();
}

/**
 * Check if playoffs are locked
 */
function isPlayoffsLocked() {
  const sheet = getSheet('Config');
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === 'playoffsLocked') {
      return data[i][1] === 'true' || data[i][1] === true;
    }
  }

  return false;
}

/**
 * Lock playoffs (admin function)
 */
function lockPlayoffs(adminKey) {
  // Simple admin key check - in production use a more secure method
  if (adminKey !== 'YOUR_ADMIN_KEY') {
    return { error: 'Unauthorized' };
  }

  const sheet = getSheet('Config');
  const data = sheet.getDataRange().getValues();

  let found = false;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === 'playoffsLocked') {
      sheet.getRange(i + 1, 2).setValue('true');
      found = true;
      break;
    }
  }

  if (!found) {
    sheet.appendRow(['playoffsLocked', 'true']);
  }

  return { success: true, message: 'Playoffs locked' };
}

/**
 * Initialize all sheets (run once manually)
 */
function initializeAllSheets() {
  const sheetNames = ['Users', 'Sessions', 'Picks', 'Groups', 'GroupMembers', 'Config'];
  sheetNames.forEach(name => getSheet(name));
  Logger.log('All sheets initialized');
}
