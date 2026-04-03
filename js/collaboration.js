import { getCurrentUser } from "./auth.js";

const COLLABORATORS_KEY = "collaborators";
const INVITE_CODES_KEY = "invite_codes";

// Generate a random 6-character invite code
function generateInviteCode() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

// Get the database reference for an inventory
export function getInventoryRef(inventoryId) {
  if (typeof firebase === "undefined") return null;
  return firebase.database().ref(`inventories/${inventoryId}`);
}

// Get current user's inventories
export async function getUserInventories(userId) {
  if (typeof firebase === "undefined") return [];

  try {
    const snapshot = await firebase
      .database()
      .ref(`user_inventories/${userId}`)
      .once("value");
    return snapshot.val() || {};
  } catch (error) {
    console.error("Error fetching inventories:", error);
    return {};
  }
}

// Create a new shared inventory
export async function createSharedInventory(userId, inventoryName, initialData) {
  if (typeof firebase === "undefined") return null;

  try {
    const inventoryRef = firebase.database().ref("inventories").push();
    const inventoryId = inventoryRef.key;

    const inviteCode = generateInviteCode();

    // Inventory data
    await inventoryRef.set({
      id: inventoryId,
      name: inventoryName,
      owner_id: userId,
      created_at: firebase.database.ServerValue.TIMESTAMP,
      data: initialData,
      collaborators: {
        [userId]: {
          role: "admin",
          name: (getCurrentUser() && getCurrentUser().displayName) || "Owner",
          joined_at: firebase.database.ServerValue.TIMESTAMP,
        },
      },
      invite_codes: {
        [inviteCode]: {
          created_by: userId,
          created_at: firebase.database.ServerValue.TIMESTAMP,
          uses: 0,
          max_uses: null, // unlimited
        },
      },
    });

    // Add to user's inventory list
    await firebase
      .database()
      .ref(`user_inventories/${userId}/${inventoryId}`)
      .set({
        name: inventoryName,
        role: "admin",
        joined_at: firebase.database.ServerValue.TIMESTAMP,
      });

    return { inventoryId, inviteCode };
  } catch (error) {
    console.error("Error creating shared inventory:", error);
    const msg = String(error && error.message ? error.message : error);
    if ((error && error.code === "PERMISSION_DENIED") || /permission|denied/i.test(msg)) {
      throw new Error("Permission denied by Firebase Realtime Database rules.");
    }
    throw error;
  }
}

// Join an inventory with invite code
export async function joinInventoryWithCode(userId, inventoryId, inviteCode) {
  if (typeof firebase === "undefined") return false;

  try {
    const inventoryRef = firebase.database().ref(`inventories/${inventoryId}`);
    const snapshot = await inventoryRef.once("value");
    const inventory = snapshot.val();

    if (!inventory) {
      throw new Error("Inventory not found");
    }

    const code = inventory.invite_codes ? inventory.invite_codes[inviteCode] : null;
    if (!code) {
      throw new Error("Invalid invite code");
    }

    if (code.max_uses && code.uses >= code.max_uses) {
      throw new Error("Invite code has reached its usage limit");
    }

    // Add user as collaborator
    const currentUser = getCurrentUser();
    const displayName =
      (currentUser && currentUser.displayName) || (currentUser && currentUser.email) || "Member";
    await inventoryRef.child(`collaborators/${userId}`).set({
      role: "member",
      name: displayName,
      joined_at: firebase.database.ServerValue.TIMESTAMP,
    });

    // Increment code usage
    await inventoryRef.child(`invite_codes/${inviteCode}/uses`).set(code.uses + 1);

    // Add to user's inventory list
    await firebase
      .database()
      .ref(`user_inventories/${userId}/${inventoryId}`)
      .set({
        name: inventory.name,
        role: "member",
        joined_at: firebase.database.ServerValue.TIMESTAMP,
      });

    return true;
  } catch (error) {
    console.error("Error joining inventory:", error);
    throw error;
  }
}

// Get collaborators for an inventory
export async function getCollaborators(inventoryId) {
  if (typeof firebase === "undefined") return {};

  try {
    const snapshot = await firebase
      .database()
      .ref(`inventories/${inventoryId}/collaborators`)
      .once("value");
    return snapshot.val() || {};
  } catch (error) {
    console.error("Error fetching collaborators:", error);
    return {};
  }
}

// Generate new invite code
export async function generateNewInviteCode(inventoryId, userId) {
  if (typeof firebase === "undefined") return null;

  try {
    const inventoryRef = firebase.database().ref(`inventories/${inventoryId}`);
    const snapshot = await inventoryRef.once("value");
    const inventory = snapshot.val();

    if (!inventory || inventory.owner_id !== userId) {
      throw new Error("Only inventory owner can generate invite codes");
    }

    const inviteCode = generateInviteCode();
    await inventoryRef.child(`invite_codes/${inviteCode}`).set({
      created_by: userId,
      created_at: firebase.database.ServerValue.TIMESTAMP,
      uses: 0,
      max_uses: null,
    });

    return inviteCode;
  } catch (error) {
    console.error("Error generating invite code:", error);
    throw error;
  }
}

// Remove collaborator
export async function removeCollaborator(inventoryId, userId, collaboratorId) {
  if (typeof firebase === "undefined") return false;

  try {
    const inventoryRef = firebase.database().ref(`inventories/${inventoryId}`);
    const snapshot = await inventoryRef.once("value");
    const inventory = snapshot.val();

    if (inventory.owner_id !== userId) {
      throw new Error("Only inventory owner can remove collaborators");
    }

    await inventoryRef.child(`collaborators/${collaboratorId}`).remove();
    await firebase
      .database()
      .ref(`user_inventories/${collaboratorId}/${inventoryId}`)
      .remove();

    return true;
  } catch (error) {
    console.error("Error removing collaborator:", error);
    throw error;
  }
}

// Listen to real-time inventory updates
export function listenToInventory(inventoryId, onUpdate) {
  if (typeof firebase === "undefined") return null;

  const ref = firebase.database().ref(`inventories/${inventoryId}/data`);
  ref.on("value", (snapshot) => {
    const data = snapshot.val();
    onUpdate(data);
  });

  // Return unsubscribe function
  return () => ref.off("value");
}

// Update inventory data
export async function updateInventoryData(inventoryId, data) {
  if (typeof firebase === "undefined") return false;

  try {
    await firebase
      .database()
      .ref(`inventories/${inventoryId}/data`)
      .set(data, (error) => {
        if (error) {
          console.error("Sync failed:", error);
        }
      });
    return true;
  } catch (error) {
    console.error("Error updating inventory:", error);
    return false;
  }
}

// Get invite codes for inventory
export async function getInviteCodes(inventoryId) {
  if (typeof firebase === "undefined") return {};

  try {
    const snapshot = await firebase
      .database()
      .ref(`inventories/${inventoryId}/invite_codes`)
      .once("value");
    return snapshot.val() || {};
  } catch (error) {
    console.error("Error fetching invite codes:", error);
    return {};
  }
}

// Delete invite code
export async function deleteInviteCode(inventoryId, userId, inviteCode) {
  if (typeof firebase === "undefined") return false;

  try {
    const inventoryRef = firebase.database().ref(`inventories/${inventoryId}`);
    const snapshot = await inventoryRef.once("value");
    const inventory = snapshot.val();

    if (inventory.owner_id !== userId) {
      throw new Error("Only owner can delete codes");
    }

    await inventoryRef.child(`invite_codes/${inviteCode}`).remove();
    return true;
  } catch (error) {
    console.error("Error deleting invite code:", error);
    throw error;
  }
}
