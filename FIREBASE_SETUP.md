# nORDER Firebase Setup Guide

## Overview

nORDER uses Firebase Authentication and Firebase Realtime Database for:
- Email/password sign in
- Shared inventory spaces
- Invite-code collaboration
- Real-time sync
- Activity logging and accountability

This guide reflects the current app architecture and deploy scripts.

## Prerequisites

1. Install Node.js (includes npm and npx)
2. Create a Firebase project in the Firebase Console
3. Clone this repository locally

## Step 1: Enable Firebase Authentication

1. Open your Firebase project
2. Go to Authentication
3. Enable Email/Password provider

## Step 2: Create Realtime Database

1. Open Realtime Database in Firebase Console
2. Create database in your preferred region
3. Start in locked mode if possible
4. Deploy project rules from this repo (next step)

## Step 3: Deploy Database Rules

This project includes production-focused rules in database.rules.json.

From the project root, run one of these:
- PowerShell: ./deploy.ps1 -RulesOnly
- PowerShell with explicit project: ./deploy.ps1 -RulesOnly -ProjectId YOUR_PROJECT_ID
- CMD wrapper: deploy.bat rules
- CMD wrapper with explicit project: deploy.bat rules YOUR_PROJECT_ID

Rules currently cover:
- Inventory access restricted to collaborators
- Owner-only controls for sensitive collaboration paths
- Invite-code index ownership checks
- Per-user isolation for user_inventories and user_profiles

## Step 4: Configure Firebase Client Credentials

Update the Firebase config object in:
- public/js/firebase-config.js

Required values:
- apiKey
- authDomain
- databaseURL
- projectId
- storageBucket
- messagingSenderId
- appId

Notes:
- databaseURL should match your Realtime Database endpoint
- App Hosting uses files under public/
- Mirror files also exist in the root and js/ paths; keep them in sync as needed

## Step 5: Set Firebase Project for Deploy

Set your default project in .firebaserc, or pass project ID on each deploy command.

## Step 6: Deploy Hosting + Rules

Recommended full deploy commands:
- PowerShell: ./deploy.ps1
- PowerShell with explicit project: ./deploy.ps1 -ProjectId YOUR_PROJECT_ID
- CMD wrapper: deploy.bat
- CMD wrapper with explicit project: deploy.bat YOUR_PROJECT_ID

## First-Run User Tutorial

After setup/deploy, new users can:

1. Sign in and onboard
- Create account with email/password
- Add display name and optional avatar

2. Create or join inventory spaces
- Use New Space to create
- Use invite code to join shared spaces

3. Manage inventory with richer item detail
- Add category, quantity, container type, and stock level
- For quantity greater than 1, set per-unit stock levels

4. Collaborate safely
- Owners generate/revoke invite codes
- Owners can remove collaborators

5. Track accountability
- Open View Change History in settings
- Review actor, action summary, and timestamps

6. Configure preferences
- Account-level: theme, dark mode, profile image, password
- Inventory-level: space name, tombstone retention days

## What Is New in This Build

Compared to earlier docs/flows, the current app now includes:
- Multi-space inventory selection flow after auth
- Invite-code index and stricter rules model
- Activity timeline for inventory changes
- Per-unit stock modeling for multi-quantity items
- Explicit separation of account prefs vs inventory prefs
- Deploy helpers for Hosting-only, Rules-only, or full deploy

## Troubleshooting

### Firebase SDK not loaded
- Verify Firebase scripts exist in index.html
- Confirm browser can fetch Firebase CDN assets

### Sign in or sign up fails
- Confirm Email/Password auth is enabled
- Confirm config values in public/js/firebase-config.js are correct

### No data sync
- Confirm Realtime Database exists and is active
- Confirm databaseURL points to the same Firebase project
- Confirm rules were deployed successfully

### Invite code not working
- Codes are uppercase and must exist
- Code may have been deleted by owner
- Ensure user has network access and auth session is valid

### Deploy script error
- Confirm npx is available in shell
- Confirm you are logged in with Firebase CLI via npx -y firebase-tools@latest login
- Confirm project ID is valid when using -ProjectId

## Security Recommendations

For production hardening:
1. Keep Realtime Database rules in source control and deploy from repo
2. Enable and enforce email verification where required by policy
3. Rotate and audit collaborator access regularly
4. Consider Firebase App Check and additional abuse controls
5. Do not commit secrets beyond intended public web config
