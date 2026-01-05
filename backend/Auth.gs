/**
 * PlayoffPredictor - Authentication Module
 * Handles magic link authentication flow
 */

/**
 * Send a magic link to the user's email
 */
function sendMagicLink(email) {
  if (!email || !isValidEmail(email)) {
    return { error: 'Invalid email address' };
  }

  email = email.toLowerCase().trim();

  // Create or get user
  const user = getOrCreateUser(email);

  // Generate magic link token
  const token = generateUUID();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + CONFIG.TOKEN_EXPIRY_HOURS);

  // Store token in Sessions
  const sessionsSheet = getSheet('Sessions');
  sessionsSheet.appendRow([token, email, expiresAt.toISOString()]);

  // Build magic link URL
  const magicLink = CONFIG.FRONTEND_URL + '?token=' + token;

  // Send email
  try {
    MailApp.sendEmail({
      to: email,
      subject: 'Your PlayoffPredictor Login Link',
      htmlBody: buildMagicLinkEmail(magicLink, user.displayName || email)
    });

    return {
      success: true,
      message: 'Login link sent to ' + email
    };
  } catch (error) {
    return {
      error: 'Failed to send email: ' + error.message
    };
  }
}

/**
 * Validate a magic link token and create a session
 */
function validateToken(token) {
  if (!token) {
    return { error: 'No token provided' };
  }

  const sessionsSheet = getSheet('Sessions');
  const data = sessionsSheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === token) {
      const email = data[i][1];
      const expiresAt = new Date(data[i][2]);

      // Check if token is expired
      if (new Date() > expiresAt) {
        // Delete expired token
        sessionsSheet.deleteRow(i + 1);
        return { error: 'Token expired. Please request a new login link.' };
      }

      // Token is valid - delete it (one-time use)
      sessionsSheet.deleteRow(i + 1);

      // Create a new session token for ongoing auth
      const sessionToken = generateUUID();
      const sessionExpiry = new Date();
      sessionExpiry.setDate(sessionExpiry.getDate() + 7); // 7 day session

      sessionsSheet.appendRow([sessionToken, email, sessionExpiry.toISOString()]);

      // Update user's last login
      updateUserLastLogin(email);

      // Get user data
      const user = getUserByEmail(email);

      return {
        success: true,
        sessionToken: sessionToken,
        user: user
      };
    }
  }

  return { error: 'Invalid token' };
}

/**
 * Validate an existing session token
 */
function validateSession(sessionToken) {
  if (!sessionToken) {
    return { valid: false, error: 'No session token provided' };
  }

  const sessionsSheet = getSheet('Sessions');
  const data = sessionsSheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === sessionToken) {
      const email = data[i][1];
      const expiresAt = new Date(data[i][2]);

      if (new Date() > expiresAt) {
        sessionsSheet.deleteRow(i + 1);
        return { valid: false, error: 'Session expired' };
      }

      const user = getUserByEmail(email);
      return {
        valid: true,
        user: user
      };
    }
  }

  return { valid: false, error: 'Invalid session' };
}

/**
 * Logout - invalidate session token
 */
function logout(sessionToken) {
  if (!sessionToken) {
    return { success: true };
  }

  const sessionsSheet = getSheet('Sessions');
  const data = sessionsSheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === sessionToken) {
      sessionsSheet.deleteRow(i + 1);
      break;
    }
  }

  return { success: true };
}

/**
 * Get email from session token (helper)
 */
function getEmailFromSession(sessionToken) {
  const result = validateSession(sessionToken);
  if (result.valid) {
    return result.user.email;
  }
  return null;
}

/**
 * Get or create a user
 */
function getOrCreateUser(email) {
  const usersSheet = getSheet('Users');
  const data = usersSheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === email) {
      return {
        email: data[i][0],
        displayName: data[i][1],
        createdAt: data[i][2],
        lastLogin: data[i][3]
      };
    }
  }

  // Create new user
  const now = new Date().toISOString();
  const defaultDisplayName = email.split('@')[0];
  usersSheet.appendRow([email, defaultDisplayName, now, now]);

  return {
    email: email,
    displayName: defaultDisplayName,
    createdAt: now,
    lastLogin: now
  };
}

/**
 * Get user by email
 */
function getUserByEmail(email) {
  const usersSheet = getSheet('Users');
  const data = usersSheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === email) {
      return {
        email: data[i][0],
        displayName: data[i][1],
        createdAt: data[i][2],
        lastLogin: data[i][3]
      };
    }
  }

  return null;
}

/**
 * Get user from session token
 */
function getUser(sessionToken) {
  const result = validateSession(sessionToken);
  if (result.valid) {
    return { user: result.user };
  }
  return { error: 'Invalid session' };
}

/**
 * Update user's last login timestamp
 */
function updateUserLastLogin(email) {
  const usersSheet = getSheet('Users');
  const data = usersSheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === email) {
      usersSheet.getRange(i + 1, 4).setValue(new Date().toISOString());
      break;
    }
  }
}

/**
 * Update user's display name
 */
function updateDisplayName(sessionToken, displayName) {
  const email = getEmailFromSession(sessionToken);
  if (!email) {
    return { error: 'Invalid session' };
  }

  if (!displayName || displayName.trim().length < 2) {
    return { error: 'Display name must be at least 2 characters' };
  }

  displayName = displayName.trim().substring(0, 30); // Max 30 chars

  const usersSheet = getSheet('Users');
  const data = usersSheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === email) {
      usersSheet.getRange(i + 1, 2).setValue(displayName);
      return {
        success: true,
        user: {
          email: email,
          displayName: displayName,
          createdAt: data[i][2],
          lastLogin: data[i][3]
        }
      };
    }
  }

  return { error: 'User not found' };
}

/**
 * Validate email format
 */
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Build magic link email HTML
 */
function buildMagicLinkEmail(magicLink, displayName) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #1a365d; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
        .button { display: inline-block; background: #2563eb; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 20px 0; }
        .footer { margin-top: 20px; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🏈 PlayoffPredictor</h1>
        </div>
        <div class="content">
          <p>Hi ${displayName},</p>
          <p>Click the button below to log in to PlayoffPredictor:</p>
          <p style="text-align: center;">
            <a href="${magicLink}" class="button">Log In to PlayoffPredictor</a>
          </p>
          <p>This link will expire in ${CONFIG.TOKEN_EXPIRY_HOURS} hours.</p>
          <p>If you didn't request this login link, you can safely ignore this email.</p>
          <div class="footer">
            <p>If the button doesn't work, copy and paste this URL into your browser:</p>
            <p style="word-break: break-all;">${magicLink}</p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}
