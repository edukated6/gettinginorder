# nORDER Developer Guide

This guide explains where things live and what to edit when you want to change behavior.

## 0) Current Scope

- This repository is currently web-only.
- Native mobile integration folders/files (Android, iOS, Capacitor/Cordova artifacts) were intentionally removed.

## 1) Project Structure

- Runtime app files used by Firebase Hosting:
  - `public/index.html`
  - `public/app.css`
  - `public/app.js`
  - `public/js/*.js`
- Mirror copies also exist at the root (`index.html`, `app.js`, `js/*`).
  - Keep them in sync if you edit both trees.

## 2) Quick Change Map

- Change app startup behavior and route rules:
  - `public/app.js`
- Change login/signup/profile button behavior:
  - `public/js/auth-events.js`
- Change Firebase auth logic:
  - `public/js/auth.js`
- Change inventory event behavior (add item, save prefs, category actions):
  - `public/js/events.js`
- Change page HTML layouts:
  - `public/js/views.js`
- Change local state shape and persistence:
  - `public/js/state.js`
- Change database read/write logic (invites, collaborators, logs):
  - `public/js/collaboration.js`
- Change URL hash routing helpers:
  - `public/js/router.js`
- Change stock-level math and sanitizing helpers:
  - `public/js/utils.js`
- Change visual style:
  - `public/app.css`

## 3) HTML File (Entry Point)

File: `public/index.html`

- Loads fonts and main CSS.
- Loads Firebase compat SDK scripts.
- Imports `public/app.js` as a module.
- Shows fallback UI if module load fails.

If you need to:
- Add analytics snippet: place in `head`.
- Add global script before app starts: place before module script.
- Update cache busting: edit the version query in the app module import.

## 4) CSS File (Visual System)

File: `public/app.css`

Main sections:
- Theme variables:
  - `:root` for light mode colors.
  - `html.dark` for dark mode overrides.
- Base/layout styles:
  - `body`, `.app-shell`, `.topbar`, `.page`.
- Components:
  - Buttons, inputs, cards, list items, progress bars.
- Feature sections:
  - Login/about/profile/activity/collaboration classes.
- Responsive behavior:
  - Media-query section near file bottom.

Best practice:
- Prefer editing CSS variables first before changing many hard-coded colors.

## 5) JavaScript Architecture (Simple Mental Model)

- `app.js`: Controller (what page should be visible right now).
- `views.js`: Markup output (what HTML should page contain).
- `events.js` and `auth-events.js`: Interaction wiring (what clicks do).
- `state.js`: Local app memory + localStorage save/load.
- `collaboration.js`: Firebase Realtime Database operations.
- `auth.js`: Firebase Authentication operations.

### Data flow example (save preferences)

1. User clicks Save in Settings.
2. `events.js` updates state.
3. `state.js` saves to localStorage.
4. `app.js` catches `norder:state-saved` and syncs to cloud paths.
5. UI re-renders through route logic.

## 6) Common Tasks

### Add a new page

1. Add `renderYourPage()` in `public/js/views.js`.
2. Add route handling in `public/app.js` inside `render()`.
3. Add any buttons/handlers in `public/js/events.js` or `public/js/auth-events.js`.

### Add a new settings field

1. Add field in `public/js/state.js` defaults.
2. Add UI input in `public/js/views.js` settings page.
3. Save it in `public/js/events.js` (`savePrefs`).
4. If it should sync across devices, add to user prefs payload in `public/app.js`.

### Add a new database record type

1. Create helper functions in `public/js/collaboration.js`.
2. Update `database.rules.json` permissions.
3. Use helper from `events.js` or `auth-events.js`.

## 7) Naming Conventions Used

- `render*`: returns HTML string for a page/section.
- `wire*Events`: attaches event listeners for a page/flow.
- `get*` / `set*` / `update*`: state/database helper functions.
- `listenTo*`: real-time Firebase subscription.

## 8) Safe Editing Tips

- Change one file at a time, then test that route.
- Keep UI (views) and behavior (events) separate.
- Reuse utility helpers from `utils.js` instead of duplicating logic.
- If you change Firebase paths, update database rules accordingly.

## 9) Deploy Checklist

1. Run app locally and test:
   - Login
   - Inventory CRUD
   - Settings save
   - Profile updates
2. Deploy:
   - Hosting only: `npx -y firebase-tools@latest deploy --only hosting`
   - Rules + hosting: `npx -y firebase-tools@latest deploy --only database,hosting`
