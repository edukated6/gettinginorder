# nORDER

nORDER is a collaborative inventory app for homes, teams, and businesses.

Use it to:
- Track stock levels visually
- Share inventory spaces with invite codes
- Keep a restock list in sync across collaborators
- See accountability history for changes

## New Features Added

Recent updates include:
- Multi-inventory account flow (create, join, switch, leave/delete spaces)
- Invite-code collaboration management with owner controls
- Accountability timeline showing who changed what and when
- Per-item quantity tracking with per-unit stock levels
- Container-type support (Bottle, Can, Bag, Box)
- Improved profile flow with avatar upload and onboarding
- Account-level appearance settings (theme and dark mode)
- Inventory-level preferences (home name and tombstone retention)
- One-command deploy scripts for Hosting and Realtime Database rules

## Quick Tutorial (New Users)

1. Sign up and complete onboarding
- Open the app.
- Create your account with email and password.
- Add your name and optional profile image.

2. Create your first inventory space
- Go to My Inventory Spaces.
- Select New Space.
- Enter a name (for example: Apartment Stock or Warehouse A).

3. Invite collaborators
- Open Settings.
- Go to Manage Team Access.
- Generate an invite code and share it.
- Teammates can join from Join Shared Inventory.

4. Add and manage inventory items
- Use Add New in Inventory Workspace.
- Set category, stock level, quantity, and optional container type.
- For quantities above 1, set each unit's stock level for more accurate tracking.
- Use Add to Restock for low items.

5. Track accountability
- In Settings, open View Change History.
- Review timeline entries to see actor, action summary, and timestamp.

6. Configure preferences
- Profile Settings controls account-level theme, dark mode, profile image, and password.
- Inventory Preferences controls current-space values such as home name and tombstone retention.

## Firebase Setup

For full Firebase setup and production guidance, see FIREBASE_SETUP.md.

## Deploy

Use the local deploy scripts from the project root.

PowerShell:
- Full deploy (Hosting + Database rules): ./deploy.ps1
- Full deploy with explicit project: ./deploy.ps1 -ProjectId YOUR_PROJECT_ID
- Hosting only: ./deploy.ps1 -HostingOnly
- Hosting only with explicit project: ./deploy.ps1 -HostingOnly -ProjectId YOUR_PROJECT_ID
- Database rules only: ./deploy.ps1 -RulesOnly
- Database rules only with explicit project: ./deploy.ps1 -RulesOnly -ProjectId YOUR_PROJECT_ID

Command Prompt wrapper:
- Full deploy (Hosting + Database rules): deploy.bat
- Full deploy with explicit project: deploy.bat YOUR_PROJECT_ID
- Hosting only: deploy.bat hosting
- Hosting only with explicit project: deploy.bat hosting YOUR_PROJECT_ID
- Database rules only: deploy.bat rules
- Database rules only with explicit project: deploy.bat rules YOUR_PROJECT_ID

Before first deploy to a new Firebase app:
- Update .firebaserc default project ID
- Update Firebase credentials in public/js/firebase-config.js

