# nOrder - Firebase Setup Guide

## Overview
nOrder now supports collaborative inventory management using Firebase. Multiple users can log in, create shared inventories, and collaborate with invite codes.

## Required Changes to Use Collaboration Features

### Step 1: Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Click "Create a new project"
3. Name it "nOrder" and continue through the setup
4. Choose your region and disable Google Analytics (optional)
5. Click "Create project" and wait for it to complete

### Step 2: Set Up Authentication

1. In Firebase Console, go to **Authentication**
2. Click **Get Started**
3. Enable **Email/Password** provider:
   - Click Email/Password
   - Toggle "Email/Password" to ON
   - Keep "Email link (passwordless sign-in)" OFF
   - Click Save

### Step 3: Create a Realtime Database

1. In Firebase Console, go to **Realtime Database**
2. Click **Create Database**
3. Select your region and start in **Test Mode** (for development)
4. Click **Enable**

**Security Note:**  
For production, update your database rules to:
```json
{
  "rules": {
    "inventories": {
      "$inventoryId": {
        ".read": "auth != null && root.child('inventories').child($inventoryId).child('collaborators').child(auth.uid).exists()",
        ".write": "auth != null && ((!data.exists() && newData.child('owner_id').val() === auth.uid && newData.child('collaborators').child(auth.uid).exists()) || data.child('collaborators').child(auth.uid).exists())"
      }
    },
    "user_inventories": {
      "$userId": {
        ".read": "auth != null && $userId === auth.uid",
        ".write": "auth != null && $userId === auth.uid"
      }
    }
  }
}
```

These rules are important because they allow the creator to write a brand new inventory first, and then enforce collaborator-based access afterward.

### Step 4: Get Your Firebase Credentials

1. In Firebase Console, click **Project Settings** (gear icon)
2. Go to **General** tab
3. Scroll to "Your apps" section
4. Click the `</>` (web) icon to create a web app (if not already created)
5. Copy the config object that looks like:
```javascript
{
  apiKey: "...",
  authDomain: "...",
  databaseURL: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
}
```

### Step 5: Update Firebase Config

1. Open `js/firebase-config.js`
2. Replace the config values with your actual Firebase credentials from Step 4
3. Make sure `databaseURL` matches your Realtime Database URL (ends with `.firebaseio.com`)

```javascript
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY_HERE",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};
```

### Step 6: Replace app.js

The old `app.js` file has been replaced with `app-new.js` to support authentication. You have two options:

**Option A: Use Collaboration Features (Recommended)**
1. Backup your old `app.js`: `cp app.js app-old.js`
2. Replace with new version: `cp app-new.js app.js`
3. Update `index.html` to reference the new app.js (it should already be updated)

**Option B: Keep Legacy Local-Only Mode**
- Keep the old `app.js` as-is
- The app will work with local storage only (no collaboration)
- Firebase features won't be available

## Features After Setup

### User Authentication
- Users can sign up with email/password
- Secure login system with password validation
- Session management (logout available in inventory selection screen)

### Collaborative Inventories
- **Create Shared Inventory**: Create a new inventory and get an invite code
- **Invite Collaborators**: Share invite codes with other users
- **Admin Controls**: Inventory owner can:
  - Generate multiple invite codes
  - Remove collaborators
  - Delete invite codes
  - Manage who has access

### Real-Time Sync
- Changes to inventory items sync in real-time to all collaborators
- Multiple users can edit the same inventory simultaneously
- Automatic Firebase Realtime Database sync

## Usage Examples

### Creating a Shared Inventory
1. Sign up/login with email and password
2. Click "New Inventory"
3. Enter inventory name (e.g., "Apartment Stock")
4. Share the generated invite code with family/roommates
5. They can click "Join Shared Inventory" and paste the code

### Joining Existing Inventory
1. Sign up/login
2. Get the invite code from inventory owner
3. Click "Join Shared Inventory"
4. Paste the code
5. You'll now have access to the shared inventory

### Managing Collaborators
1. In Settings, click "Manage Collaborators"
2. See all team members and their roles
3. Remove members (admin only)
4. Generate or delete invite codes (admin only)

## Troubleshooting

### "Firebase SDK not loaded" Error
- Check that Firebase CDN scripts are in `index.html`
- Verify the Firebase script URLs are accessible

### Authentication Fails
- Verify credentials in `firebase-config.js`
- Check that Authentication is enabled in Firebase Console
- Ensure Email/Password provider is active

### Database Not Syncing
- Verify Realtime Database is created in Firebase
- Check database URL in config matches your Firebase project
- Ensure database is not in "disabled" state

### Invite Codes Not Working
- Verify the code is typed correctly (case-sensitive)
- Check the code hasn't exceeded max uses
- Ensure the invitation still exists (owner may have deleted it)

## Security Notes

⚠️ **Important**: The default configuration uses Firebase Test Mode which allows public read/write access. 

For production use:
1. Implement proper database rules (see Step 3)
2. Enable Email verification
3. Implement rate limiting on authentication
4. Use Firebase App Check for additional security
5. Never expose API keys in production (use environment variables)

## Questions or Issues?

If you encounter problems:
1. Check the browser console for error messages
2. Verify your Firebase configuration matches your project
3. Ensure all scripts load properly
4. Check Firebase Console for any warnings/errors

## File Changes Summary

**New Files:**
- `js/firebase-config.js` - Firebase configuration
- `js/auth.js` - Authentication logic
- `js/collaboration.js` - Collaboration features
- `js/auth-events.js` - Auth event handlers
- `app-new.js` - Updated app with auth support

**Updated Files:**
- `js/state.js` - Added inventory tracking
- `js/views.js` - Added auth and collaboration views
- `index.html` - Added Firebase SDK references
- `app.js` - (Backup as app-old.js if needed)

**Unchanged:**
- `js/router.js` - Routing logic
- `js/utils.js` - Utility functions
- `js/events.js` - Event handling
- `app.css` - Styling
- `README.md` - Original readme
