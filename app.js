// App.js - Predichess Web Controller
// Real-time Firestore sync and board interaction mirroring Android styling

import {
  ChessBoard,
  PieceColor,
  PieceType,
  GameResult,
  ChessMove
} from './chess.js';

// --- FIREBASE IMPORT CDN (Modular SDK) ---
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  onAuthStateChanged 
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { 
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  addDoc,
  deleteDoc,
  runTransaction,
  collection,
  onSnapshot,
  query,
  where,
  getDocs,
  writeBatch,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

// --- FIREBASE CONFIGURATION ---
const firebaseConfig = {
  apiKey: "AIzaSyB9QNdGcA0Mk83WbBCNnP8WOm1yFveK1Cc",
  authDomain: "deltachess-151a5.firebaseapp.com",
  projectId: "deltachess-151a5",
  storageBucket: "deltachess-151a5.firebasestorage.app",
  messagingSenderId: "595116332112",
  appId: "1:595116332112:web:fabc72220006efa9792d55"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- SOUND MANAGER FOR CHESS EVENTS ---
const SoundManager = {
  sounds: {
    move: './sounds/move.mp3',
    capture: './sounds/capture.mp3',
    explosion: './sounds/explosion.mp3',
    genericnotify: './sounds/genericnotify.mp3',
    lowtime: './sounds/lowtime.mp3'
  },

  playSound(name, pitch = 1.0) {
    try {
      const src = this.sounds[name];
      if (!src) return;
      const audio = new Audio(src);
      audio.preservesPitch = false;
      audio.playbackRate = pitch;
      audio.play().catch(e => console.log("Sound play blocked by browser autoplay policy:", e));
    } catch (e) {
      console.error("Error playing sound", e);
    }
  }
};

// --- GLOBAL STATE ---
let currentUser = null;
let currentUid = null;
let currentUsername = "";

let activeGameId = null;
let activeGame = null;
let gameListener = null;

let activeBoard = new ChessBoard();
let isFlipped = false;
let myColor = PieceColor.WHITE;

let reviewIndex = -1; 
let selSquare = null; 
let legalTargets = []; 
let promotionPendingMove = null; 

let friendRequestsListener = null;
let openGamesListener = null;
let dashboardPollInterval = null;
let friendsRenderToken = 0;

// --- SOUND NOTIFICATION AND EVENT TRACKERS ---
let renderedEventsCount = -1;
let lastPlayedLowTimeSecond = -1;
let previousTurn = "";
let previousPhase = "";
let lastAnimatedTrapIndex = -1;

// --- OFFLINE BOT STATE ---
let botTimeoutId = null;
let botRunning = false;
let botWorker = null;
let botRequestId = 0;

const BotGameStore = {
  PREFS_NAME: "bot_game_prefs",

  save(uid, game) {
    const data = {
      events: game.events,
      predictions: game.predictions,
      pendingPrediction: game.pendingPrediction,
      currentTurn: game.currentTurn,
      phase: game.phase,
      status: game.status,
      result: game.result,
      botElo: game.botElo,
      timerType: game.timerType,
      whiteTimeLeft: game.whiteTimeLeft,
      blackTimeLeft: game.blackTimeLeft,
      lastActionTime: game.lastActionTime
    };
    localStorage.setItem(`${this.PREFS_NAME}_game_${uid}`, JSON.stringify(data));
  },

  load(uid) {
    const str = localStorage.getItem(`${this.PREFS_NAME}_game_${uid}`);
    if (!str) return null;
    try {
      const json = JSON.parse(str);
      const botElo = json.botElo || 1200;
      return {
        id: "offline_bot",
        whiteUid: uid,
        blackUid: "bot",
        whiteUsername: "You",
        blackUsername: `Bot (${botElo} ELO)`,
        currentTurn: json.currentTurn,
        phase: json.phase,
        events: json.events || [],
        predictions: json.predictions || [],
        pendingPrediction: json.pendingPrediction || "",
        status: json.status || "active",
        result: json.result || "",
        botElo: botElo,
        timerType: json.timerType || "bot_20m",
        whiteTimeLeft: json.whiteTimeLeft !== undefined ? json.whiteTimeLeft : 1200000,
        blackTimeLeft: json.blackTimeLeft !== undefined ? json.blackTimeLeft : 1200000,
        lastActionTime: json.lastActionTime || Date.now()
      };
    } catch (_) {
      return null;
    }
  },

  clear(uid) {
    localStorage.removeItem(`${this.PREFS_NAME}_game_${uid}`);
  },

  hasActiveGame(uid) {
    const game = this.load(uid);
    return game && game.status === "active" && game.events && game.events.length > 0;
  },

  saveToHistory(uid, game) {
    const key = `${this.PREFS_NAME}_history_${uid}`;
    const str = localStorage.getItem(key) || "[]";
    try {
      const arr = JSON.parse(str);
      const finishedGame = {
        ...game,
        id: `offline_bot_${Date.now()}`,
        status: "finished",
        lastActionTime: Date.now()
      };
      arr.push(finishedGame);
      localStorage.setItem(key, JSON.stringify(arr));
    } catch (_) {}
  },

  loadHistory(uid) {
    const key = `${this.PREFS_NAME}_history_${uid}`;
    const str = localStorage.getItem(key);
    if (!str) return [];
    try {
      const arr = JSON.parse(str);
      return arr.map(game => ({
        ...game,
        blackUsername: `Bot (${game.botElo || 1200} ELO)`
      }));
    } catch (_) {
      return [];
    }
  }
};

// --- NAVIGATION & SCREEN ROUTING ---
const screens = {
  login: document.getElementById('screen-login'),
  username: document.getElementById('screen-username'),
  dashboard: document.getElementById('screen-dashboard'),
  game: document.getElementById('screen-game'),
  settings: document.getElementById('screen-settings')
};

function showScreen(screenId) {
  Object.keys(screens).forEach(key => {
    if (key === screenId) {
      screens[key].style.display = 'flex';
      setTimeout(() => screens[key].classList.add('active'), 50);
    } else {
      screens[key].classList.remove('active');
      screens[key].style.display = 'none';
    }
  });

  if (screenId !== 'game') {
    if (gameListener) {
      gameListener();
      gameListener = null;
    }
    if (botTimeoutId) {
      clearTimeout(botTimeoutId);
      botTimeoutId = null;
    }
    botRunning = false;
    activeGameId = null;
    activeGame = null;
  }

  if (screenId === 'dashboard') {
    refreshOpenGamesList();
  }
}

// --- DYNAMIC ALERT DIALOGS & TOASTS ---
function showDialog(title, message, buttons = []) {
  const dialog = document.getElementById('global-dialog');
  const dTitle = document.getElementById('dialog-title');
  const dMessage = document.getElementById('dialog-message');
  const dButtons = document.getElementById('dialog-buttons');

  dTitle.textContent = title;
  dMessage.innerHTML = message;
  dButtons.innerHTML = '';

  if (buttons.length === 0) {
    buttons = [{ text: 'OK', type: 'confirm', action: () => dialog.classList.remove('active') }];
  }

  buttons.forEach(btn => {
    const el = document.createElement('button');
    el.className = `btn-dialog ${btn.type === 'confirm' ? 'btn-dialog-confirm' : btn.type === 'danger' ? 'btn-dialog-danger' : 'btn-dialog-cancel'}`;
    el.textContent = btn.text;
    el.addEventListener('click', () => {
      dialog.classList.remove('active');
      if (btn.action) btn.action();
    });
    dButtons.appendChild(el);
  });

  dialog.classList.add('active');
}

function showToast(message, type = 'info') {
  const toast = document.getElementById('global-toast');
  const tIcon = document.getElementById('toast-icon');
  const tMessage = document.getElementById('toast-message');

  tMessage.textContent = message;
  toast.className = 'toast';

  if (type === 'success') {
    toast.classList.add('toast-success');
    tIcon.className = 'fa-solid fa-circle-check';
  } else if (type === 'error') {
    toast.classList.add('toast-error');
    tIcon.className = 'fa-solid fa-circle-exclamation';
  } else {
    tIcon.className = 'fa-solid fa-circle-info';
  }

  toast.classList.add('active');
  setTimeout(() => {
    toast.classList.remove('active');
  }, 4000);
}

// --- AUTH & PROFILE MANAGER ---
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUid = user.uid;
    await checkUserProfile();
  } else {
    currentUid = null;
    currentUser = null;
    currentUsername = "";
    cleanupListeners();
    showScreen('login');
    updateLoginBotButton();
  }
});

async function checkUserProfile() {
  try {
    const userDocRef = doc(db, 'users', currentUid);
    const userDoc = await getDoc(userDocRef);

    if (userDoc.exists()) {
      currentUser = userDoc.data();
      currentUsername = currentUser.username;
      
      document.getElementById('user-display-name').textContent = currentUsername;

      // Migrate anonymous bot game if present and user has no active game
      const anonGame = BotGameStore.load('anonymous');
      if (anonGame && anonGame.status === 'active') {
        const userGame = BotGameStore.load(currentUid);
        if (!userGame || userGame.status !== 'active') {
          anonGame.whiteUid = currentUid;
          anonGame.whiteUsername = currentUsername;
          BotGameStore.save(currentUid, anonGame);
          BotGameStore.clear('anonymous');
          showToast('Offline game migrated to your profile!', 'success');
        }
      }

      setupDashboardListeners();
      showScreen('dashboard');
    } else {
      showScreen('username');
    }
  } catch (e) {
    showToast('Failed to check user profile.', 'error');
  }
}

// Claim username logic
document.getElementById('btn-submit-username').addEventListener('click', async () => {
  const input = document.getElementById('username-input');
  const username = input.value.trim();
  const errorDiv = document.getElementById('username-error');

  if (!username) return;
  
  const usernameRegex = /^[a-zA-Z0-9_-]{3,20}$/;
  if (!usernameRegex.test(username)) {
    errorDiv.textContent = "Username must be 3-20 characters and contain only letters, numbers, underscores, or hyphens.";
    errorDiv.style.display = "block";
    return;
  }

  const btn = document.getElementById('btn-submit-username');
  btn.disabled = true;
  errorDiv.style.display = "none";

  try {
    const success = await runTransaction(db, async (transaction) => {
      const usernameRef = doc(db, 'usernames', username.toLowerCase());
      const userRef = doc(db, 'users', currentUid);

      const usernameDoc = await transaction.get(usernameRef);
      if (usernameDoc.exists()) {
        return false;
      }

      transaction.set(usernameRef, { uid: currentUid });
      transaction.set(userRef, {
        username: username,
        elo: 800,
        openGames: []
      });
      return true;
    });

    if (success) {
      showToast('Profile registered successfully!', 'success');
      await checkUserProfile();
    } else {
      errorDiv.textContent = "Username is already taken.";
      errorDiv.style.display = "block";
      btn.disabled = false;
    }
  } catch (e) {
    showToast('Error registering handle.', 'error');
    btn.disabled = false;
  }
});

// Login button listener
document.getElementById('btn-google-login').addEventListener('click', () => {
  const provider = new GoogleAuthProvider();
  signInWithPopup(auth, provider).catch((error) => {
    showToast('Google sign-in failed.', 'error');
  });
});

// Login screen play bot listener
document.getElementById('btn-login-play-bot').addEventListener('click', () => {
  enterBotGame();
});

// Settings Cog Navigation Listener
document.getElementById('btn-dashboard-settings').addEventListener('click', () => {
  showScreen('settings');
});

// Settings Back Navigation Listener
document.getElementById('btn-settings-back').addEventListener('click', () => {
  showScreen('dashboard');
});

// Settings Logout Action Listener (Matching Android App exactly!)
document.getElementById('btn-settings-logout').addEventListener('click', () => {
  showDialog('LOGOUT', 'Are you sure you want to end your session?', [
    { text: 'Logout', type: 'danger', action: () => signOut(auth) },
    { text: 'Cancel', type: 'cancel' }
  ]);
});

// Play bot listener
document.getElementById('btn-play-bot').addEventListener('click', () => {
  const uid = currentUid || 'anonymous';
  if (BotGameStore.hasActiveGame(uid)) {
    enterBotGame();
  } else {
    document.getElementById('modal-difficulty').classList.add('active');
  }
});

document.querySelectorAll('.btn-elo').forEach(btn => {
  btn.addEventListener('click', () => {
    const elo = parseInt(btn.dataset.elo, 10);
    document.getElementById('modal-difficulty').classList.remove('active');
    enterBotGame(elo);
  });
});

document.getElementById('btn-difficulty-cancel').addEventListener('click', () => {
  document.getElementById('modal-difficulty').classList.remove('active');
});

// HOST CHALLENGE MODAL LISTENERS
document.getElementById('btn-host-challenge').addEventListener('click', () => {
  if (!currentUid) {
    showToast('Please sign in to play online.', 'error');
    return;
  }
  document.getElementById('modal-timer-select').classList.add('active');
});

document.querySelectorAll('.btn-timer-type').forEach(btn => {
  btn.addEventListener('click', () => {
    const timerType = btn.dataset.timer;
    document.getElementById('modal-timer-select').classList.remove('active');
    hostPublicChallenge(timerType);
  });
});

document.getElementById('btn-timer-select-cancel').addEventListener('click', () => {
  document.getElementById('modal-timer-select').classList.remove('active');
});

// --- LOBBY & FRIENDS REALTIME LISTENERS ---
function setupDashboardListeners() {
  cleanupListeners();

  // 1. Listen to incoming friend requests
  const reqQuery = collection(db, 'users', currentUid, 'incomingRequests');
  friendRequestsListener = onSnapshot(reqQuery, (snapshot) => {
    const requestsList = document.getElementById('incoming-requests-list');
    requestsList.innerHTML = '';
    const pendingHeader = document.getElementById('header-pending');

    if (snapshot.empty) {
      pendingHeader.style.display = 'none';
      requestsList.style.display = 'none';
      return;
    }

    pendingHeader.style.display = 'block';
    requestsList.style.display = 'block';
    snapshot.forEach(docSnap => {
      const fromUid = docSnap.id;
      const data = docSnap.data();
      
      const item = document.createElement('div');
      item.className = 'request-item';
      item.innerHTML = `
        <span class="friend-name">${data.fromUsername}</span>
        <div class="request-actions">
          <button class="btn-outlined-white-small btn-accept" data-uid="${fromUid}">ACCEPT</button>
          <button class="btn-outlined-gray-small btn-reject" data-uid="${fromUid}">REJECT</button>
        </div>
      `;

      item.querySelector('.btn-accept').addEventListener('click', () => acceptFriend(fromUid));
      item.querySelector('.btn-reject').addEventListener('click', () => rejectFriend(fromUid));
      requestsList.appendChild(item);
    });
  });

  // 2. Listen to profile updates (for friends list & open games)
  const userDocRef = doc(db, 'users', currentUid);
  openGamesListener = onSnapshot(userDocRef, async (docSnap) => {
    if (!docSnap.exists()) return;
    currentUser = docSnap.data();

    // Render Friends List.
    // This handler is async (it fetches each friend's profile), so a rapid
    // burst of snapshots can run several copies concurrently. We stamp each
    // run with a token and only let the newest one mutate the DOM, and we
    // build the rows off-DOM and swap them in atomically — otherwise
    // interleaved appends produce duplicated friend rows.
    const friendsListDiv = document.getElementById('friends-list');
    const friends = currentUser.friends || [];
    const renderToken = ++friendsRenderToken;

    if (friends.length === 0) {
      if (renderToken === friendsRenderToken) {
        friendsListDiv.innerHTML = `
          <div class="empty-state">
            <p>No friends added yet</p>
          </div>
        `;
      }
    } else {
      const fDocs = await Promise.all(
        friends.map(fUid => getDoc(doc(db, 'users', fUid)).catch(() => null))
      );
      // A newer snapshot superseded us while we were fetching — let it win.
      if (renderToken === friendsRenderToken) {
        const fragment = document.createDocumentFragment();
        fDocs.forEach((fDoc, i) => {
          if (!fDoc || !fDoc.exists()) return;
          const fUid = friends[i];
          const fData = fDoc.data();
          const item = document.createElement('div');
          item.className = 'friend-item';
          item.innerHTML = `
            <div class="friend-info">
              <span class="friend-name">${fData.username}</span>
            </div>
            <div class="friend-actions">
              <button class="btn-outlined-white-small btn-challenge" data-uid="${fUid}">CHALLENGE</button>
            </div>
          `;
          item.querySelector('.btn-challenge').addEventListener('click', () => {
            challengeFriend(fUid, fData.username);
          });
          fragment.appendChild(item);
        });
        friendsListDiv.innerHTML = '';
        friendsListDiv.appendChild(fragment);
      }
    }

    await refreshOpenGamesList();
  });

  if (dashboardPollInterval) clearInterval(dashboardPollInterval);
  dashboardPollInterval = setInterval(refreshOpenGamesList, 15000);

  setupPublicLobbyListener();
}

async function refreshOpenGamesList() {
  if (!currentUser) return;
  const gamesListDiv = document.getElementById('open-games-list');
  if (!gamesListDiv) return;

  const uid = currentUid || 'anonymous';
  const openGames = currentUser.openGames || [];
  let activeGamesCount = 0;
  const items = [];

  const hasActiveBot = BotGameStore.hasActiveGame(uid);
  const botGame = hasActiveBot ? BotGameStore.load(uid) : null;
  const playBotBtn = document.getElementById('btn-play-bot');
  if (playBotBtn) {
    playBotBtn.textContent = hasActiveBot ? "RESUME BOT GAME" : "PLAY VS OFFLINE BOT";
  }

  if (hasActiveBot && botGame) {
    activeGamesCount++;
    const myTurn = botGame.currentTurn === 'white';
    const item = document.createElement('div');
    item.className = 'game-item bot-game-item';
    item.innerHTML = `
      <div class="game-item-info">
        <div class="game-item-avatar" style="background-color: var(--accent-blue);">🤖</div>
        <div>
          <div class="game-item-opponent">Minimax Bot</div>
          <div class="game-item-meta">Offline Game</div>
        </div>
      </div>
      <span class="badge ${myTurn ? 'badge-your-turn' : 'badge-waiting'}">${myTurn ? 'YOUR TURN' : "BOT'S TURN"}</span>
    `;
    item.addEventListener('click', () => enterBotGame());
    items.push(item);
  }

  for (const gameId of openGames) {
    try {
      const gDoc = await getDoc(doc(db, 'games', gameId));
      if (gDoc.exists()) {
        const gData = gDoc.data();
        if (gData.status === 'active') {
          activeGamesCount++;
          const opponentName = gData.whiteUid === currentUid ? gData.blackUsername : gData.whiteUsername;
          const myTurn = (gData.currentTurn === 'white' && gData.whiteUid === currentUid) ||
                         (gData.currentTurn === 'black' && gData.blackUid === currentUid);
          const item = document.createElement('div');
          item.className = 'game-item';
          item.innerHTML = `
            <div class="game-item-info">
              <div class="game-item-avatar">♟</div>
              <div>
                <div class="game-item-opponent">${opponentName}</div>
                <div class="game-item-meta">Predichess Match</div>
              </div>
            </div>
            <span class="badge ${myTurn ? 'badge-your-turn' : 'badge-waiting'}">${myTurn ? 'YOUR TURN' : 'WAITING'}</span>
          `;
          item.addEventListener('click', () => enterGame(gameId));
          items.push(item);
        }
      }
    } catch (_) {}
  }

  gamesListDiv.innerHTML = '';
  items.forEach(item => gamesListDiv.appendChild(item));

  if (activeGamesCount === 0) {
    gamesListDiv.innerHTML = `<div class="empty-state"><p>No active games</p></div>`;
  }
}

function cleanupListeners() {
  if (friendRequestsListener) friendRequestsListener();
  if (openGamesListener) openGamesListener();
  if (publicChallengesListener) publicChallengesListener();
  if (dashboardPollInterval) clearInterval(dashboardPollInterval);
  friendRequestsListener = null;
  openGamesListener = null;
  publicChallengesListener = null;
  dashboardPollInterval = null;
}

// TAB MANAGEMENT IN DASHBOARD
const tabPlay = document.getElementById('tab-play');
const tabFriends = document.getElementById('tab-friends');
const tabPerformance = document.getElementById('tab-performance');
const panePlay = document.getElementById('pane-play');
const paneFriends = document.getElementById('pane-friends');
const panePerformance = document.getElementById('pane-performance');

tabPlay.addEventListener('click', () => {
  tabPlay.classList.add('active');
  tabFriends.classList.remove('active');
  tabPerformance.classList.remove('active');
  panePlay.classList.add('active');
  paneFriends.classList.remove('active');
  panePerformance.classList.remove('active');
});

tabFriends.addEventListener('click', () => {
  tabFriends.classList.add('active');
  tabPlay.classList.remove('active');
  tabPerformance.classList.remove('active');
  paneFriends.classList.add('active');
  panePlay.classList.remove('active');
  panePerformance.classList.remove('active');
});

tabPerformance.addEventListener('click', () => {
  tabPerformance.classList.add('active');
  tabPlay.classList.remove('active');
  tabFriends.classList.remove('active');
  panePerformance.classList.add('active');
  panePlay.classList.remove('active');
  paneFriends.classList.remove('active');
  renderPerformanceTab();
});

// Add Friend Logic
document.getElementById('btn-add-friend').addEventListener('click', async () => {
  const input = document.getElementById('add-friend-input');
  const targetUsername = input.value.trim();

  if (!targetUsername) return;
  if (targetUsername.toLowerCase() === currentUsername.toLowerCase()) {
    showToast("Can't add yourself.", 'error');
    return;
  }

  const btn = document.getElementById('btn-add-friend');
  btn.disabled = true;

  try {
    const usernameDoc = await getDoc(doc(db, 'usernames', targetUsername.toLowerCase()));
    if (!usernameDoc.exists()) {
      showToast('User not found.', 'error');
      btn.disabled = false;
      return;
    }

    const toUid = usernameDoc.data().uid;

    const friends = currentUser.friends || [];
    if (friends.includes(toUid)) {
      showToast('Already friends.', 'error');
      btn.disabled = false;
      return;
    }

    const existingReq = await getDoc(doc(db, 'users', toUid, 'incomingRequests', currentUid));
    if (existingReq.exists()) {
      showToast('Request already sent.', 'error');
      btn.disabled = false;
      return;
    }

    await setDoc(doc(db, 'users', toUid, 'incomingRequests', currentUid), {
      fromUsername: currentUsername,
      timestamp: serverTimestamp()
    });

    showToast('Request sent!', 'success');
    input.value = '';
  } catch (e) {
    showToast('Failed to send request.', 'error');
  } finally {
    btn.disabled = false;
  }
});

// Accept Friend
async function acceptFriend(fromUid) {
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', currentUid), { friends: arrayUnion(fromUid) });
    batch.update(doc(db, 'users', fromUid), { friends: arrayUnion(currentUid) });
    batch.delete(doc(db, 'users', currentUid, 'incomingRequests', fromUid));
    await batch.commit();
    showToast('Request accepted!', 'success');
  } catch (e) {
    showToast('Failed to accept friend request.', 'error');
  }
}

// Reject Friend
async function rejectFriend(fromUid) {
  try {
    const requestDocRef = doc(db, 'users', currentUid, 'incomingRequests', fromUid);
    await deleteDoc(requestDocRef);
    showToast('Request rejected.', 'info');
  } catch (e) {
    showToast('Failed to reject request.', 'error');
  }
}

// Challenge Friend
async function challengeFriend(friendUid, friendUsername) {
  showToast('Creating match...', 'info');
  try {
    const gameData = {
      whiteUid: currentUid,
      blackUid: friendUid,
      whiteUsername: currentUsername,
      blackUsername: friendUsername,
      currentTurn: "white",
      phase: "move",
      events: [],
      predictions: [],
      pendingPrediction: "",
      status: "active",
      result: "",
      timerType: "friend_3d",
      whiteTimeLeft: 259200000,
      blackTimeLeft: 259200000,
      lastActionTime: Date.now(),
      createdAt: serverTimestamp()
    };

    // Create the game and index it on both players' profiles in one atomic
    // batch, so a denied/failed write can never leave an orphaned game behind.
    const gameRef = doc(collection(db, 'games'));
    const batch = writeBatch(db);
    batch.set(gameRef, gameData);
    batch.update(doc(db, 'users', currentUid), { openGames: arrayUnion(gameRef.id) });
    batch.update(doc(db, 'users', friendUid), { openGames: arrayUnion(gameRef.id) });
    await batch.commit();

    enterGame(gameRef.id);
  } catch (e) {
    showToast('Failed to challenge.', 'error');
  }
}

// --- ACTIVE PREDICHESS GAME CLIENT ---
function enterGame(gameId) {
  activeGameId = gameId;
  reviewIndex = -1;
  selSquare = null;
  legalTargets = [];
  promotionPendingMove = null;

  // Reset sound and clock state variables
  renderedEventsCount = -1;
  lastPlayedLowTimeSecond = -1;
  previousTurn = "";
  previousPhase = "";
  lastAnimatedTrapIndex = -1;

  showScreen('game');

  gameListener = onSnapshot(doc(db, 'games', gameId), (docSnap) => {
    if (!docSnap.exists()) return;
    activeGame = docSnap.data();

    myColor = activeGame.whiteUid === currentUid ? PieceColor.WHITE : PieceColor.BLACK;
    isFlipped = myColor === PieceColor.BLACK;
    document.getElementById('game-opponent-name').textContent =
      myColor === PieceColor.WHITE ? activeGame.blackUsername : activeGame.whiteUsername;
    document.getElementById('game-my-name').textContent = currentUsername || 'You';

    if (reviewIndex >= (activeGame.events || []).length) {
      reviewIndex = -1;
    }

    renderGameRoom();
  });
}

function renderGameRoom() {
  if (!activeGame) return;

  const events = activeGame.events || [];

  // --- Real-time Trap Vaporization Delay (Live Gameplay Only) ---
  // If a trap is hit, we show the piece moving for 0.5s, then trigger the vaporization/explosion.
  if (reviewIndex === -1 && events.length > 0) {
    const lastEvent = events[events.length - 1];
    const trapIdx = events.length - 1;
    if (lastEvent.startsWith('trap:') && lastAnimatedTrapIndex !== trapIdx) {
      const pred = activeGame.predictions ? activeGame.predictions[activeGame.predictions.length - 1] : "";
      if (pred && pred.length >= 4) {
        const fromSq = pred.substring(0, 2);
        const toSq = pred.substring(2, 4);
        const fromCol = fromSq.charCodeAt(0) - 'a'.charCodeAt(0);
        const fromRow = 8 - parseInt(fromSq[1], 10);
        const toCol = toSq.charCodeAt(0) - 'a'.charCodeAt(0);
        const toRow = 8 - parseInt(toSq[1], 10);

        const prevEvents = events.slice(0, -1);
        const tempBoard = new ChessBoard();
        tempBoard.applyMoves(prevEvents);
        const piece = tempBoard.squares[fromRow][fromCol];

        if (piece) {
          // 1. Show the board right before the vaporization
          activeBoard.applyMoves(prevEvents);

          // 2. Visually place the piece at the destination momentarily
          activeBoard.squares[fromRow][fromCol] = null;
          activeBoard.squares[toRow][toCol] = piece;

          // Clear check visually during move
          activeBoard.checkSquare = null;

          // Set tracking variable to prevent animation re-triggers
          lastAnimatedTrapIndex = trapIdx;

          // Render this intermediate state
          drawChessBoardGrid();
          updateGameHUD(activeBoard.gameResult());
          populateMoveLog();

          // 3. Vaporize/Explode 0.5 seconds later
          setTimeout(() => {
            if (activeGame && activeGame.events && activeGame.events.length - 1 === trapIdx && reviewIndex === -1) {
              renderGameRoom();
            }
          }, 500);

          // Bypasses synchronous render for this frame
          return;
        }
      }
    }
  }

  // --- Real-time Sounds for Newly Added Live Events ---
  if (reviewIndex === -1) {
    if (renderedEventsCount === -1) {
      renderedEventsCount = events.length;
    } else if (events.length > renderedEventsCount) {
      const tempBoard = new ChessBoard();
      const existingEvents = events.slice(0, renderedEventsCount);
      tempBoard.applyMoves(existingEvents);

      for (let i = renderedEventsCount; i < events.length; i++) {
        const event = events[i];
        if (event.startsWith('trap:')) {
          SoundManager.playSound('explosion');
        } else {
          // Parse UCI details
          const fromSq = event.substring(0, 2);
          const toSq = event.substring(2, 4);
          const toCol = toSq.charCodeAt(0) - 'a'.charCodeAt(0);
          const toRow = 8 - parseInt(toSq[1], 10);
          const fromCol = fromSq.charCodeAt(0) - 'a'.charCodeAt(0);
          const fromRow = 8 - parseInt(fromSq[1], 10);
          const piece = tempBoard.squares[fromRow][fromCol];
          const targetPiece = tempBoard.squares[toRow][toCol];
          
          const isCapture = (targetPiece !== null) || (tempBoard.enPassantTarget === toSq && piece && piece.type === PieceType.PAWN);

          tempBoard.applyMove(event);

          const opponentColor = piece && piece.color === PieceColor.WHITE ? PieceColor.BLACK : PieceColor.WHITE;
          const isCheck = tempBoard.isInCheck(opponentColor);

          const isOpponentMove = piece && (piece.color !== myColor);
          const pitch = isOpponentMove ? 1.15 : 1.0;

          if (isCheck) {
            SoundManager.playSound('genericnotify', pitch);
          } else if (isCapture) {
            SoundManager.playSound('capture', pitch);
          } else {
            SoundManager.playSound('move', pitch);
          }
        }
      }
      renderedEventsCount = events.length;
    }

    // --- Phase Transition Sounds (Prediction Locked / Turn Changed) ---
    if (previousTurn && previousPhase) {
      const myTurnStr = myColor === PieceColor.WHITE ? 'white' : 'black';
      const oppTurnStr = myColor === PieceColor.WHITE ? 'black' : 'white';

      const playerPredictingBefore = (previousTurn === myTurnStr && previousPhase === 'predict');
      const opponentMovingNow = (activeGame.currentTurn === oppTurnStr && activeGame.phase === 'move');

      const opponentPredictingBefore = (previousTurn === oppTurnStr && previousPhase === 'predict');
      const playerMovingNow = (activeGame.currentTurn === myTurnStr && activeGame.phase === 'move');

      if ((playerPredictingBefore && opponentMovingNow) || (opponentPredictingBefore && playerMovingNow)) {
        SoundManager.playSound('genericnotify', 1.4);
      }
    }
    previousTurn = activeGame.currentTurn;
    previousPhase = activeGame.phase;
  }

  const eventsToApply = reviewIndex === -1 ? events : (reviewIndex === -2 ? [] : events.slice(0, reviewIndex + 1));
  activeBoard.applyMoves(eventsToApply);

  const gameRes = activeBoard.gameResult();
  if (gameRes !== GameResult.ONGOING && reviewIndex === -1) {
    selSquare = null;
    legalTargets = [];
    if (activeGameId === 'offline_bot') {
      if (activeGame.status === 'active') {
        finalizeLocalBotGame(gameRes);
      }
    } else {
      if (activeGame.status === 'active') {
        finalizeGameOnDB(gameRes);
      }
    }
  }

  drawChessBoardGrid();
  updateGameHUD(gameRes);
  populateMoveLog();

  // Trigger bot action if it's the bot's turn in a live, active offline game!
  if (activeGameId === 'offline_bot' && activeGame.currentTurn === 'black' && activeGame.status === 'active' && reviewIndex === -1) {
    triggerBotAction();
  }
}

function drawChessBoardGrid() {
  const grid = document.getElementById('chess-board-grid');
  grid.innerHTML = '';

  const inPredictPhase = (activeGame.phase === 'predict');
  const isMyTurn = activeGameId === 'offline_bot'
    ? (activeGame.currentTurn === 'white')
    : ((activeGame.currentTurn === 'white' && activeGame.whiteUid === currentUid) ||
       (activeGame.currentTurn === 'black' && activeGame.blackUid === currentUid));
  
  const effectiveFlipped = (reviewIndex === -1 && inPredictPhase && isMyTurn) ? !isFlipped : isFlipped;

  let checkSquare = null;
  if (reviewIndex === -1 && activeGame.phase === 'move') {
    const turnColor = activeBoard.currentTurn;
    if (activeBoard.isInCheck(turnColor)) {
      checkSquare = activeBoard.findKing(turnColor);
    }
  }

  let lastFrom = null;
  let lastTo = null;
  let trapSq = null;

  const events = activeGame.events || [];
  const eventsToApply = reviewIndex === -1 ? events : (reviewIndex === -2 ? [] : events.slice(0, reviewIndex + 1));

  if (eventsToApply.length > 0) {
    const lastEvent = eventsToApply[eventsToApply.length - 1];
    if (lastEvent.startsWith('trap:')) {
      const fromSqStr = lastEvent.substring(5);
      const fromSq = {
        row: 8 - parseInt(fromSqStr[1], 10),
        col: fromSqStr.charCodeAt(0) - 'a'.charCodeAt(0)
      };
      const trapPred = activeGame.predictions ? activeGame.predictions[eventsToApply.length - 1] : "";
      if (trapPred && trapPred.length >= 4) {
        const toSqStr = trapPred.substring(2, 4);
        trapSq = {
          row: 8 - parseInt(toSqStr[1], 10),
          col: toSqStr.charCodeAt(0) - 'a'.charCodeAt(0)
        };
        lastFrom = fromSq;
        lastTo = trapSq;
      } else {
        trapSq = fromSq;
      }
    } else if (lastEvent.length >= 4) {
      lastFrom = {
        row: 8 - parseInt(lastEvent[1], 10),
        col: lastEvent.charCodeAt(0) - 'a'.charCodeAt(0)
      };
      lastTo = {
        row: 8 - parseInt(lastEvent[3], 10),
        col: lastEvent.charCodeAt(2) - 'a'.charCodeAt(0)
      };
    }
  }

  // Draw board squares
  for (let r = 0; r < 8; r++) {
    const rowIdx = effectiveFlipped ? 7 - r : r;
    for (let c = 0; c < 8; c++) {
      const colIdx = effectiveFlipped ? 7 - c : c;
      const piece = activeBoard.squares[rowIdx][colIdx];
      const isLight = (rowIdx + colIdx) % 2 === 0;

      const cell = document.createElement('div');
      cell.className = `square ${isLight ? 'light' : 'dark'}`;
      cell.dataset.row = rowIdx;
      cell.dataset.col = colIdx;

      if (selSquare && selSquare.row === rowIdx && selSquare.col === colIdx) {
        cell.classList.add('selected');
      }
      if (checkSquare && checkSquare.row === rowIdx && checkSquare.col === colIdx) {
        cell.classList.add('check');
      }
      if (trapSq && trapSq.row === rowIdx && trapSq.col === colIdx) {
        cell.classList.add('trap');
        
        if (reviewIndex === -1 && eventsToApply.length === events.length && !cell.querySelector('.trap-ring')) {
          const glow = document.createElement('div');
          glow.className = 'trap-glow';
          const ring = document.createElement('div');
          ring.className = 'trap-ring';
          cell.appendChild(glow);
          cell.appendChild(ring);
        }
      }
      if (lastFrom && ((lastFrom.row === rowIdx && lastFrom.col === colIdx) || (lastTo.row === rowIdx && lastTo.col === colIdx))) {
        cell.classList.add('last-move');
      }

      const isLegal = legalTargets.some(t => t.row === rowIdx && t.col === colIdx);
      if (isLegal) {
        if (piece === null) {
          const dot = document.createElement('div');
          dot.className = 'move-dot';
          cell.appendChild(dot);
        } else {
          const ring = document.createElement('div');
          ring.className = 'move-ring';
          cell.appendChild(ring);
        }
      }

      // Border Coordinates labels matching Android color mappings
      const isLightSquare = (rowIdx + colIdx) % 2 === 0;
      const coordColorStr = isLightSquare ? "var(--board-dark)" : "var(--board-light)";

      if (c === 0) {
        const lbl = document.createElement('span');
        lbl.className = 'coord-label rank';
        lbl.style.color = coordColorStr;
        lbl.textContent = 8 - rowIdx;
        cell.appendChild(lbl);
      }
      if (r === 7) {
        const lbl = document.createElement('span');
        lbl.className = 'coord-label file';
        lbl.style.color = coordColorStr;
        lbl.textContent = String.fromCharCode('a'.charCodeAt(0) + colIdx);
        cell.appendChild(lbl);
      }

      if (piece) {
        const pieceEl = document.createElement('div');
        pieceEl.className = 'piece';
        
        let canDrag = false;
        if (reviewIndex === -1) {
          if (!inPredictPhase && isMyTurn && piece.color === myColor) {
            canDrag = true;
          } else if (inPredictPhase && isMyTurn && piece.color !== myColor) {
            canDrag = true;
          }
        }

        if (canDrag) {
          pieceEl.draggable = true;
          pieceEl.classList.add(piece.color === myColor ? 'player-piece' : 'opponent-piece');
        } else {
          pieceEl.classList.add('non-interactive');
        }

        pieceEl.innerHTML = getPieceSvg(piece.type, piece.color);

        pieceEl.addEventListener('dragstart', (e) => {
          if (reviewIndex !== -1) return;
          e.dataTransfer.setData('text/plain', JSON.stringify({ row: rowIdx, col: colIdx }));
          setTimeout(() => pieceEl.classList.add('dragging'), 0);
          selectSquare(rowIdx, colIdx);
        });

        pieceEl.addEventListener('dragend', () => {
          pieceEl.classList.remove('dragging');
        });

        cell.appendChild(pieceEl);
      }

      cell.addEventListener('click', () => {
        if (reviewIndex !== -1) return;
        if (isLegal) {
          executeSelectionMove(rowIdx, colIdx);
        } else if (piece) {
          if (!inPredictPhase && isMyTurn && piece.color === myColor) {
            selectSquare(rowIdx, colIdx);
          } else if (inPredictPhase && isMyTurn && piece.color !== myColor) {
            selectSquare(rowIdx, colIdx);
          } else {
            selSquare = null;
            legalTargets = [];
            drawChessBoardGrid();
          }
        } else {
          selSquare = null;
          legalTargets = [];
          drawChessBoardGrid();
        }
      });

      cell.addEventListener('dragover', (e) => e.preventDefault());
      cell.addEventListener('drop', (e) => {
        e.preventDefault();
        if (reviewIndex !== -1) return;
        
        try {
          const data = JSON.parse(e.dataTransfer.getData('text/plain'));
          if (data && isLegal && cell.dataset.row == rowIdx && cell.dataset.col == colIdx) {
            executeSelectionMove(rowIdx, colIdx);
          }
        } catch (_) {}
      });

      grid.appendChild(cell);
    }
  }
}

function selectSquare(row, col) {
  if (reviewIndex !== -1) return;
  selSquare = { row, col };
  legalTargets = activeBoard.legalMovesFrom(row, col).map(m => ({ row: m.toRow, col: m.toCol }));
  drawChessBoardGrid();
}

function executeSelectionMove(toRow, toCol) {
  if (!selSquare) return;

  const validMoves = activeBoard.legalMovesFrom(selSquare.row, selSquare.col)
    .filter(m => m.toRow === toRow && m.toCol === toCol);

  if (validMoves.length === 0) return;
  const move = validMoves[0];

  if (move.promotion !== null) {
    promotionPendingMove = move;
    openPromotionModal();
  } else {
    submitTacticalMove(move.toUci());
  }
}

function openPromotionModal() {
  const overlay = document.getElementById('promotion-dialog');
  const promoColor = (activeGame.phase === 'predict') ? activeBoard.opponent(myColor) : myColor;

  document.getElementById('promo-q').innerHTML = getPieceSvg(PieceType.QUEEN, promoColor);
  document.getElementById('promo-r').innerHTML = getPieceSvg(PieceType.ROOK, promoColor);
  document.getElementById('promo-b').innerHTML = getPieceSvg(PieceType.BISHOP, promoColor);
  document.getElementById('promo-n').innerHTML = getPieceSvg(PieceType.KNIGHT, promoColor);

  overlay.classList.add('active');
}

document.querySelectorAll('.promo-option').forEach(btn => {
  btn.addEventListener('click', () => {
    const overlay = document.getElementById('promotion-dialog');
    overlay.classList.remove('active');

    if (!promotionPendingMove) return;

    const promoType = PieceType[btn.dataset.promo];
    const finalMove = new ChessMove(
      promotionPendingMove.fromRow,
      promotionPendingMove.fromCol,
      promotionPendingMove.toRow,
      promotionPendingMove.toCol,
      promoType
    );

    promotionPendingMove = null;
    submitTacticalMove(finalMove.toUci());
  });
});

async function submitTacticalMove(uci) {
  selSquare = null;
  legalTargets = [];
  
  const inPredictPhase = (activeGame.phase === 'predict');
  const myTurnStr = myColor === PieceColor.WHITE ? 'white' : 'black';
  const oppTurnStr = myColor === PieceColor.WHITE ? 'black' : 'white';

  if (activeGameId === 'offline_bot') {
    if (inPredictPhase) {
      handleLocalPrediction(uci);
    } else {
      handleLocalMove(uci);
    }
    return;
  }

  const now = Date.now();
  const elapsed = now - (activeGame.lastActionTime || now);
  const myTurnColor = myColor === PieceColor.WHITE ? 'white' : 'black';

  if (inPredictPhase) {
    // End of turn -> deduct elapsed time from our clock!
    const whiteTime = myTurnColor === 'white' ? Math.max(0, (activeGame.whiteTimeLeft || 1800000) - elapsed) : (activeGame.whiteTimeLeft || 1800000);
    const blackTime = myTurnColor === 'black' ? Math.max(0, (activeGame.blackTimeLeft || 1800000) - elapsed) : (activeGame.blackTimeLeft || 1800000);

    try {
      await updateDoc(doc(db, 'games', activeGameId), {
        pendingPrediction: uci,
        phase: 'move',
        currentTurn: oppTurnStr,
        whiteTimeLeft: whiteTime,
        blackTimeLeft: blackTime,
        lastActionTime: now
      });
      showToast('Prediction submitted!', 'success');
      SoundManager.playSound('genericnotify', 1.25);
    } catch (e) {
      showToast('Failed to lock prediction.', 'error');
    }
  } else {
    const prediction = activeGame.pendingPrediction || "";
    
    if (prediction && uci === prediction) {
      const fromSq = uci.substring(0, 2);
      const fromCol = uci.charCodeAt(0) - 'a'.charCodeAt(0);
      const fromRow = 8 - parseInt(uci[1], 10);
      const piece = activeBoard.squares[fromRow][fromCol];
      const trapEvent = `trap:${fromSq}`;

      if (piece && piece.type === PieceType.KING) {
        const resultStatus = myColor === PieceColor.WHITE ? 'black_wins' : 'white_wins';
        try {
          const batch = writeBatch(db);
          batch.update(doc(db, 'games', activeGameId), {
            events: [...(activeGame.events || []), trapEvent],
            predictions: [...(activeGame.predictions || []), prediction],
            status: "finished",
            result: resultStatus,
            pendingPrediction: "",
            lastActionTime: now
          });
          batch.update(doc(db, 'users', activeGame.whiteUid), { openGames: arrayRemove(activeGameId) });
          batch.update(doc(db, 'users', activeGame.blackUid), { openGames: arrayRemove(activeGameId) });
          await batch.commit();
        } catch (_) {}
      } else {
        const whiteTime = myTurnColor === 'white' ? Math.max(0, (activeGame.whiteTimeLeft || 1800000) - elapsed) : (activeGame.whiteTimeLeft || 1800000);
        const blackTime = myTurnColor === 'black' ? Math.max(0, (activeGame.blackTimeLeft || 1800000) - elapsed) : (activeGame.blackTimeLeft || 1800000);

        try {
          await updateDoc(doc(db, 'games', activeGameId), {
            events: [...(activeGame.events || []), trapEvent],
            predictions: [...(activeGame.predictions || []), prediction],
            phase: 'move',
            currentTurn: myTurnStr,
            pendingPrediction: "",
            whiteTimeLeft: whiteTime,
            blackTimeLeft: blackTime,
            lastActionTime: now
          });
        } catch (_) {}
      }
    } else {
      try {
        await updateDoc(doc(db, 'games', activeGameId), {
          events: [...(activeGame.events || []), uci],
          predictions: [...(activeGame.predictions || []), prediction],
          phase: 'predict',
          currentTurn: myTurnStr,
          pendingPrediction: ""
        });
      } catch (e) {
        showToast('Failed to post move.', 'error');
      }
    }
  }
}

// UPDATE TURN STATE HUD AND CONTROLLER BINDINGS MATCHING ANDROID TEXTS/COLORS
function updateGameHUD(gameRes) {
  const banner = document.getElementById('game-turn-banner');
  const inPredictPhase = (activeGame.phase === 'predict');
  const isMyTurn = activeGameId === 'offline_bot'
    ? (activeGame.currentTurn === 'white')
    : ((activeGame.currentTurn === 'white' && activeGame.whiteUid === currentUid) ||
       (activeGame.currentTurn === 'black' && activeGame.blackUid === currentUid));

  const btnFirst = document.getElementById('btn-game-first');
  const btnPrev = document.getElementById('btn-game-prev');
  const btnNext = document.getElementById('btn-game-next');
  const btnLast = document.getElementById('btn-game-last');

  const eventsSize = (activeGame.events || []).length;
  const isFinished = activeGame.status === 'finished' || activeGame.status === 'completed';

  // Toggle resign button based on game finished state
  document.getElementById('btn-game-resign').style.display = isFinished ? 'none' : 'block';

  // Customize LIVE button text for finished games
  btnLast.textContent = isFinished ? "END" : "LIVE";

  if (reviewIndex !== -1) {
    // Reviewing banner
    banner.style.color = "var(--accent-blue)";
    if (reviewIndex === -2) {
      banner.textContent = `REVIEWING: STARTING POSITION (MOVE 0/${eventsSize})`;
      btnFirst.disabled = true;
      btnPrev.disabled = true;
      btnNext.disabled = (eventsSize === 0);
      btnLast.disabled = false;
    } else {
      banner.textContent = `REVIEWING MOVE ${reviewIndex + 1}/${eventsSize}`;
      btnFirst.disabled = false;
      btnPrev.disabled = false;
      btnNext.disabled = false;
      btnLast.disabled = false;
    }
  } else {
    // Live banner
    btnFirst.disabled = (eventsSize === 0);
    btnPrev.disabled = (eventsSize === 0);
    btnNext.disabled = true;
    btnLast.disabled = true;

    if (isFinished || gameRes !== GameResult.ONGOING) {
      banner.style.color = "var(--text-secondary)";
      let resultLabel = "GAME CONCLUDED";
      if (activeGame.result) {
        if (activeGame.result === 'white_wins') resultLabel = "WHITE WINS";
        else if (activeGame.result === 'black_wins') resultLabel = "BLACK WINS";
        else if (activeGame.result === 'draw') resultLabel = "DRAW";
      } else {
        const winner = gameRes === GameResult.CHECKMATE_WHITE_WINS ? 'WHITE WINS' : 
                       gameRes === GameResult.CHECKMATE_BLACK_WINS ? 'BLACK WINS' : 'DRAW';
        resultLabel = winner;
      }
      banner.textContent = resultLabel;
      return;
    }

    if (isMyTurn) {
      if (inPredictPhase) {
        banner.style.color = "var(--accent-blue)";
        banner.textContent = "PREDICT THEIR MOVE";
      } else {
        banner.style.color = "var(--accent-green)";
        banner.textContent = "YOUR TURN";
      }
    } else {
      banner.style.color = "var(--text-secondary)";
      if (inPredictPhase) {
        banner.textContent = activeGameId === 'offline_bot' ? "BOT IS PREDICTING..." : "OPPONENT PREDICTING";
      } else {
        banner.textContent = activeGameId === 'offline_bot' ? "WAITING FOR BOT" : "WAITING FOR OPPONENT";
      }
    }
  }
}

// POPULATE LOG LIST OF ACTIONABLE EVENTS
function populateMoveLog() {
  const container = document.getElementById('game-move-log');
  container.innerHTML = '';

  const events = activeGame.events || [];
  const predictions = activeGame.predictions || [];
  const tempBoard = new ChessBoard();

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const movingColor = tempBoard.currentTurn;
    const movingPlayerStr = movingColor === PieceColor.WHITE ? 'White' : 'Black';

    const pred = predictions[i] || "";
    let wasPredicted = false;
    let formattedText = "";

    if (event.startsWith('trap:')) {
      const sq = event.substring(5);
      formattedText = `Piece Destroyed at ${sq}`;
      wasPredicted = true;
      tempBoard.applyTrap(sq);
    } else {
      wasPredicted = (pred && event.startsWith(pred));
      formattedText = formatUciMove(event);
      tempBoard.applyMove(event);
    }

    const row = document.createElement('div');
    row.className = `move-log-row ${reviewIndex === i ? 'active' : ''}`;
    
    const moveLine = document.createElement('div');
    moveLine.className = 'move-log-line';
    moveLine.textContent = `${i + 1}. ${movingPlayerStr}: ${formattedText}`;
    row.appendChild(moveLine);

    const predLine = document.createElement('div');
    if (pred) {
      const predictorStr = movingColor === PieceColor.WHITE ? 'Black' : 'White';
      const isMePredictor = activeGameId === 'offline_bot'
        ? (predictorStr === 'White')
        : (predictorStr.toLowerCase() === (myColor === PieceColor.WHITE ? 'white' : 'black'));
      const predictorLabel = isMePredictor ? 'You' : (activeGameId === 'offline_bot' ? 'Bot' : `Opponent (${predictorStr})`);

      if (wasPredicted) {
        predLine.className = 'move-log-prediction destroyed';
        predLine.innerHTML = `↳ ${predictorLabel} predicted this exactly! (Piece Destroyed!)`;
      } else {
        predLine.className = 'move-log-prediction normal';
        predLine.innerHTML = `↳ ${predictorLabel} predicted: ${formatUciMove(pred)}`;
      }
    } else if (i > 0) {
      const predictorStr = movingColor === PieceColor.WHITE ? 'Black' : 'White';
      const isMePredictor = activeGameId === 'offline_bot'
        ? (predictorStr === 'White')
        : (predictorStr.toLowerCase() === (myColor === PieceColor.WHITE ? 'white' : 'black'));
      const predictorLabel = isMePredictor ? 'You' : (activeGameId === 'offline_bot' ? 'Bot' : `Opponent (${predictorStr})`);
      predLine.className = 'move-log-prediction none';
      predLine.innerHTML = `↳ ${predictorLabel} did not predict a move`;
    }
    row.appendChild(predLine);

    row.addEventListener('click', () => {
      reviewIndex = i;
      renderGameRoom();
    });

    container.appendChild(row);
  }

  const isMyTurn = activeGameId === 'offline_bot'
    ? (activeGame.currentTurn === 'white')
    : ((activeGame.currentTurn === 'white' && activeGame.whiteUid === currentUid) ||
       (activeGame.currentTurn === 'black' && activeGame.blackUid === currentUid));

  if (!isMyTurn && activeGame.phase === 'move' && activeGame.pendingPrediction) {
    const activeBanner = document.createElement('div');
    activeBanner.className = 'move-log-active-prediction';
    activeBanner.textContent = `Active Prediction: You predicted ${formatUciMove(activeGame.pendingPrediction)}`;
    container.appendChild(activeBanner);
  }

  if (reviewIndex === -1) {
    container.scrollTop = container.scrollHeight;
  }
}

function formatUciMove(move) {
  if (move.startsWith('trap:')) {
    return `Destroyed at ${move.substring(5)}`;
  }
  if (move.length >= 4) {
    const from = move.substring(0, 2);
    const to = move.substring(2, 4);
    const promo = move.length >= 5 ? `=${move[4].toUpperCase()}` : "";
    return `${from} → ${to}${promo}`;
  }
  return move;
}

// HISTORICAL REVIEW LOGIC BINDINGS
document.getElementById('btn-game-first').addEventListener('click', () => {
  const events = activeGame.events || [];
  if (events.length > 0) {
    reviewIndex = -2; // Jump back to starting position (Move 0)
    renderGameRoom();
  }
});

document.getElementById('btn-game-prev').addEventListener('click', () => {
  const events = activeGame.events || [];
  if (events.length > 0) {
    if (reviewIndex === -1) {
      reviewIndex = events.length - 1;
    } else if (reviewIndex === 0) {
      reviewIndex = -2; // From move 1 go back to move 0 starting board state
    } else {
      reviewIndex = Math.max(-2, reviewIndex - 1);
    }
    renderGameRoom();
  }
});

document.getElementById('btn-game-next').addEventListener('click', () => {
  const events = activeGame.events || [];
  if (events.length > 0 && reviewIndex !== -1) {
    if (reviewIndex === -2) {
      reviewIndex = 0; // From move 0 advance to move 1
    } else if (reviewIndex === events.length - 1) {
      reviewIndex = -1;
    } else {
      reviewIndex++;
    }
    renderGameRoom();
  }
});

document.getElementById('btn-game-last').addEventListener('click', () => {
  reviewIndex = -1;
  renderGameRoom();
});

// Resign Button
document.getElementById('btn-game-resign').addEventListener('click', () => {
  showDialog('Resign Game', 'Are you sure you want to resign this room?', [
    {
      text: 'Resign',
      type: 'danger',
      action: async () => {
        if (activeGameId === 'offline_bot') {
          const nextGame = {
            ...activeGame,
            status: 'completed',
            result: 'black_wins'
          };
          activeGame = nextGame;
          saveBotGame(nextGame);
          renderGameRoom();
          finalizeLocalBotGame(GameResult.CHECKMATE_BLACK_WINS);
          return;
        }
        const resignResult = myColor === PieceColor.WHITE ? 'black_wins' : 'white_wins';
        await finalizeGameOnDBDirectly(resignResult);
        showToast('You resigned.', 'info');
        showScreen('dashboard');
      }
    },
    { text: 'Cancel', type: 'cancel' }
  ]);
});

// Exit / Back
document.getElementById('btn-game-exit').addEventListener('click', () => {
  showScreen(currentUid ? 'dashboard' : 'login');
});

// AUTO FINALIZE GAME IN DATABASE
async function finalizeGameOnDB(result) {
  const statusStr = (result === GameResult.CHECKMATE_WHITE_WINS) ? 'white_wins' :
                    (result === GameResult.CHECKMATE_BLACK_WINS) ? 'black_wins' : 'draw';
  await finalizeGameOnDBDirectly(statusStr);
  
  const userWon = (result === GameResult.CHECKMATE_WHITE_WINS && myColor === PieceColor.WHITE) ||
                  (result === GameResult.CHECKMATE_BLACK_WINS && myColor === PieceColor.BLACK);
  const userLost = (result === GameResult.CHECKMATE_WHITE_WINS && myColor === PieceColor.BLACK) ||
                   (result === GameResult.CHECKMATE_BLACK_WINS && myColor === PieceColor.WHITE);
  
  let msg = "The room ended in a draw.";
  if (userWon) msg = "You win!";
  if (userLost) msg = "You lose.";

  showDialog('Game Over', msg, [
    { text: 'OK', type: 'confirm', action: () => showScreen('dashboard') }
  ]);
}

async function finalizeGameOnDBDirectly(resultStr) {
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'games', activeGameId), {
      status: "finished",
      result: resultStr
    });
    batch.update(doc(db, 'users', activeGame.whiteUid), { openGames: arrayRemove(activeGameId) });
    batch.update(doc(db, 'users', activeGame.blackUid), { openGames: arrayRemove(activeGameId) });
    await batch.commit();
  } catch (_) {}
}

// --- FLAT VECTOR CHESS SVG GRAPHICS DECK ---
function getPieceSvg(type, color) {
  const isWhite = color === PieceColor.WHITE;
  
  if (isWhite) {
    switch (type) {
      case PieceType.KING:
        return `
          <svg viewBox="0 0 45 45" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <path d="M22.5 11.63V6M20 8h5" fill="none" stroke="#000" stroke-width="1.5" stroke-linejoin="miter" stroke-linecap="round" />
            <path d="M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="miter" stroke-linecap="butt" />
            <path d="M11.5 37c5.5 3.5 15.5 3.5 21 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V27v-3.5c-3.5-7.5-13-10.5-16-4-3 6 5 10 5 10z" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
            <path d="M11.5 30c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0" fill="none" stroke="#000" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
          </svg>
        `;
      case PieceType.QUEEN:
        return `
          <svg viewBox="0 0 45 45" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 12a2 2 0 1 1-4 0 2 2 0 1 1 4 0m16.5-4.5a2 2 0 1 1-4 0 2 2 0 1 1 4 0M41 12a2 2 0 1 1-4 0 2 2 0 1 1 4 0M16 8.5a2 2 0 1 1-4 0 2 2 0 1 1 4 0M33 9a2 2 0 1 1-4 0 2 2 0 1 1 4 0" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
            <path d="M9 26c8.5-1.5 21-1.5 27 0l2-12-7 11V11l-5.5 13.5-3-15-3 15-5.5-14V25L7 14z" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="butt" />
            <path d="M9 26c0 2 1.5 2 2.5 4 1 1.5 1 1 .5 3.5-1.5 1-1.5 2.5-1.5 2.5-1.5 1.5.5 2.5.5 2.5 6.5 1 16.5 1 23 0 0 0 1.5-1 0-2.5 0 0 .5-1.5-1-2.5-.5-2.5-.5-2 .5-3.5 1-2 2.5-2 2.5-4-8.5-1.5-18.5-1.5-27 0z" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="butt" />
            <path d="M11.5 30c3.5-1 18.5-1 22 0M12 33.5c6-1 15-1 21 0" fill="none" stroke="#000" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
          </svg>
        `;
      case PieceType.ROOK:
        return `
          <svg viewBox="0 0 45 45" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <path d="M9 39h27v-3H9zm3-3v-4h21v4zm-1-22V9h4v2h5V9h5v2h5V9h4v5" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="butt" />
            <path d="m34 14-3 3H14l-3-3" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
            <path d="M31 17v12.5H14V17" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="miter" stroke-linecap="butt" />
            <path d="m31 29.5 1.5 2.5h-20l1.5-2.5" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
            <path d="M11 14h23" fill="none" stroke="#000" stroke-width="1.5" stroke-linejoin="miter" stroke-linecap="round" />
          </svg>
        `;
      case PieceType.BISHOP:
        return `
          <svg viewBox="0 0 45 45" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <path d="M9 36c3.39-.97 10.11.43 13.5-2 3.39 2.43 10.11 1.03 13.5 2 0 0 1.65.54 3 2-.68.97-1.65.99-3 .5-3.39-.97-10.11.46-13.5-1-3.39 1.46-10.11.03-13.5 1-1.35.49-2.32.47-3-.5 1.35-1.94 3-2 3-2z" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="butt" />
            <path d="M15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-2.5-4 5.5-1.5 6-11.5-5-15.5-11 4-10.5 14-5 15.5 0 0-2.5 1.5-2.5 4 0 0-.5.5 0 2z" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="butt" />
            <path d="M25 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0z" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="butt" />
            <path d="M17.5 26h10M15 30h15m-7.5-14.5v5M20 18h5" fill="none" stroke="#000" stroke-width="1.5" stroke-linejoin="miter" stroke-linecap="round" />
          </svg>
        `;
      case PieceType.KNIGHT:
        return `
          <svg viewBox="0 0 45 45" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <path d="M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
            <path d="M24 18c.38 2.91-5.55 7.37-8 9-3 2-2.82 4.34-5 4-1.042-.94 1.41-3.04 0-3-1 0 .19 1.23-1 2-1 0-4.003 1-4-4 0-2 6-12 6-12s1.89-1.9 2-3.5c-.73-.994-.5-2-.5-3 1-1 3 2.5 3 2.5h2s.78-1.992 2.5-3c1 0 1 3 1 3" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
            <path d="M9.5 25.5a.5.5 0 1 1-1 0 .5.5 0 1 1 1 0m5.433-9.75a.5 1.5 30 1 1-.866-.5.5 1.5 30 1 1 .866.5" fill="#000" stroke="#000" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
          </svg>
        `;
      case PieceType.PAWN:
        return `
          <svg viewBox="0 0 45 45" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <path d="M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03-3 1.06-7.41 5.55-7.41 13.47h23c0-7.92-4.41-12.41-7.41-13.47 1.47-1.19 2.41-3 2.41-5.03 0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        `;
      default:
        return "";
    }
  } else {
    switch (type) {
      case PieceType.KING:
        return `
          <svg viewBox="0 0 45 45" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <path d="M22.5 11.6V6" fill="none" stroke="#000" stroke-width="1.5" stroke-linejoin="miter" stroke-linecap="round" />
            <path d="M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5" fill="#000" stroke="#000" stroke-width="1.5" stroke-linejoin="miter" stroke-linecap="butt" />
            <path d="M11.5 37a22.3 22.3 0 0 0 21 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V27v-3.5c-3.5-7.5-13-10.5-16-4-3 6 5 10 5 10z" fill="#000" stroke="#000" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
            <path d="M20 8h5" fill="none" stroke="#000" stroke-width="1.5" stroke-linejoin="miter" stroke-linecap="round" />
            <path d="M32 29.5s8.5-4 6-9.7C34.1 14 25 18 22.5 24.6v2.1-2.1C20 18 9.9 14 7 19.9c-2.5 5.6 4.8 9 4.8 9" fill="none" stroke="#ececec" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
            <path d="M11.5 30c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0" fill="none" stroke="#ececec" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
          </svg>
        `;
      case PieceType.QUEEN:
        return `
          <svg viewBox="0 0 45 45" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <path d="M 6,9.25 a 2.75,2.75 0 1,1 0,5.5 a 2.75,2.75 0 1,1 0,-5.5 Z M 14,6.25 a 2.75,2.75 0 1,1 0,5.5 a 2.75,2.75 0 1,1 0,-5.5 Z M 22.5,5.25 a 2.75,2.75 0 1,1 0,5.5 a 2.75,2.75 0 1,1 0,-5.5 Z M 31,6.25 a 2.75,2.75 0 1,1 0,5.5 a 2.75,2.75 0 1,1 0,-5.5 Z M 39,9.25 a 2.75,2.75 0 1,1 0,5.5 a 2.75,2.75 0 1,1 0,-5.5 Z" fill="#000" stroke="#000" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
            <path d="M9 26c8.5-1.5 21-1.5 27 0l2.5-12.5L31 25l-.3-14.1-5.2 13.6-3-14.5-3 14.5-5.2-13.6L14 25 6.5 13.5z" fill="#000" stroke="#000" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="butt" />
            <path d="M9 26c0 2 1.5 2 2.5 4 1 1.5 1 1 .5 3.5-1.5 1-1.5 2.5-1.5 2.5-1.5 1.5.5 2.5.5 2.5 6.5 1 16.5 1 23 0 0 0 1.5-1 0-2.5 0 0 .5-1.5-1-2.5-.5-2.5-.5-2 .5-3.5 1-2 2.5-2 2.5-4-8.5-1.5-18.5-1.5-27 0z" fill="#000" stroke="#000" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="butt" />
            <path d="M11 38.5a35 35 1 0 0 23 0" fill="none" stroke="#000" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="butt" />
            <path d="M11 29a35 35 1 0 1 23 0m-21.5 2.5h20m-21 3a35 35 1 0 0 22 0m-23 3a35 35 1 0 0 24 0" fill="none" stroke="#ececec" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
          </svg>
        `;
      case PieceType.ROOK:
        return `
          <svg viewBox="0 0 45 45" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <path d="M9 39h27v-3H9zm3.5-7 1.5-2.5h17l1.5 2.5zm-.5 4v-4h21v4z" fill="#000" stroke="#000" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="butt" />
            <path d="M14 29.5v-13h17v13z" fill="#000" stroke="#000" stroke-width="1.5" stroke-linejoin="miter" stroke-linecap="butt" />
            <path d="M14 16.5 11 14h23l-3 2.5zM11 14V9h4v2h5V9h5v2h5V9h4v5z" fill="#000" stroke="#000" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="butt" />
            <path d="M12 35.5h21m-20-4h19m-18-2h17m-17-13h17M11 14h23" fill="none" stroke="#ececec" stroke-width="1" stroke-linejoin="miter" stroke-linecap="round" />
          </svg>
        `;
      case PieceType.BISHOP:
        return `
          <svg viewBox="0 0 45 45" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <path d="M9 36c3.4-1 10.1.4 13.5-2 3.4 2.4 10.1 1 13.5 2 0 0 1.6.5 3 2-.7 1-1.6 1-3 .5-3.4-1-10.1.5-13.5-1-3.4 1.5-10.1 0-13.5 1-1.4.5-2.3.5-3-.5 1.4-2 3-2 3-2z" fill="#000" stroke="#000" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="butt" />
            <path d="M15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-2.5-4 5.5-1.5 6-11.5-5-15.5-11 4-10.5 14-5 15.5 0 0-2.5 1.5-2.5 4 0 0-.5.5 0 2z" fill="#000" stroke="#000" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="butt" />
            <path d="M25 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0z" fill="#000" stroke="#000" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="butt" />
            <path d="M17.5 26h10M15 30h15m-7.5-14.5v5M20 18h5" fill="none" stroke="#ececec" stroke-width="1.5" stroke-linejoin="miter" stroke-linecap="round" />
          </svg>
        `;
      case PieceType.KNIGHT:
        return `
          <svg viewBox="0 0 45 45" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <path d="M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21" fill="#000" stroke="#000" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
            <path d="M24 18c.38 2.91-5.55 7.37-8 9-3 2-2.82 4.34-5 4-1.04-.94 1.41-3.04 0-3-1 0 .19 1.23-1 2-1 0-4 1-4-4 0-2 6-12 6-12s1.89-1.9 2-3.5c-.73-1-.5-2-.5-3 1-1 3 2.5 3 2.5h2s.78-2 2.5-3c1 0 1 3 1 3" fill="#000" stroke="#000" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
            <path d="M9.5 25.5a.5.5 0 1 1-1 0 .5.5 0 1 1 1 0m5.43-9.75a.5 1.5 30 1 1-.86-.5.5 1.5 30 1 1 .86.5" fill="#ececec" stroke="#ececec" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
            <path d="m24.55 10.4-.45 1.45.5.15c3.15 1 5.65 2.49 7.9 6.75S35.75 29.06 35.25 39l-.05.5h2.25l.05-.5c.5-10.06-.88-16.85-3.25-21.34s-5.79-6.64-9.19-7.16z" fill="#ececec" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
          </svg>
        `;
      case PieceType.PAWN:
        return `
          <svg viewBox="0 0 45 45" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <path d="M22.5 9a4 4 0 0 0-3.22 6.38 6.48 6.48 0 0 0-.87 10.65c-3 1.06-7.41 5.55-7.41 13.47h23c0-7.92-4.41-12.41-7.41-13.47a6.46 6.46 0 0 0-.87-10.65A4.01 4.01 0 0 0 22.5 9z" fill="#000" stroke="#000" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        `;
      default:
        return "";
    }
  }
}

// --- LOCAL BOT GAMEPLAY SYSTEM ---
function enterBotGame(selectedElo = 1200) {
  activeGameId = 'offline_bot';
  reviewIndex = -1;
  selSquare = null;
  legalTargets = [];
  promotionPendingMove = null;

  // Reset sound and clock state variables
  renderedEventsCount = -1;
  lastPlayedLowTimeSecond = -1;
  previousTurn = "";
  previousPhase = "";
  lastAnimatedTrapIndex = -1;

  showScreen('game');

  const uid = currentUid || 'anonymous';
  let game = BotGameStore.load(uid);

  if (!game || game.status !== 'active' || (game.status === 'active' && selectedElo && game.botElo !== selectedElo)) {
    // Start a new bot game!
    game = {
      id: "offline_bot",
      whiteUid: uid,
      blackUid: "bot",
      whiteUsername: currentUsername || "You",
      blackUsername: `Bot (${selectedElo} ELO)`,
      currentTurn: "white",
      phase: "move",
      events: [],
      predictions: [],
      pendingPrediction: "",
      status: "active",
      result: "",
      botElo: selectedElo,
      timerType: "bot_20m",
      whiteTimeLeft: 1200000, // 20 mins
      blackTimeLeft: 1200000,
      lastActionTime: Date.now()
    };
    BotGameStore.save(uid, game);
  }

  activeGame = game;
  myColor = PieceColor.WHITE;
  isFlipped = false;

  document.getElementById('game-opponent-name').textContent = activeGame.blackUsername;
  document.getElementById('game-my-name').textContent = currentUsername || "You";

  renderGameRoom();
  
  if (activeGame.status === 'active') {
    startGameClocks();
  } else {
    stopGameClocks();
  }
}

function saveBotGame(game) {
  const uid = currentUid || 'anonymous';
  BotGameStore.save(uid, game);
}

function handleLocalMove(uci) {
  if (!activeGame) return;
  const prediction = activeGame.pendingPrediction || "";

  if (prediction && uci === prediction) {
    handleLocalTrap(activeGame, uci);
  } else {
    const nextGame = {
      ...activeGame,
      events: [...activeGame.events, uci],
      predictions: [...activeGame.predictions, prediction],
      phase: 'predict',
      currentTurn: 'white',
      pendingPrediction: ""
    };
    activeGame = nextGame;
    saveBotGame(nextGame);
    renderGameRoom();
  }
}

function handleLocalPrediction(uci) {
  if (!activeGame) return;
  const now = Date.now();
  const elapsed = now - (activeGame.lastActionTime || now);
  const nextGame = {
    ...activeGame,
    pendingPrediction: uci,
    phase: 'move',
    currentTurn: 'black',
    whiteTimeLeft: Math.max(0, (activeGame.whiteTimeLeft || 1200000) - elapsed),
    lastActionTime: now
  };
  activeGame = nextGame;
  saveBotGame(nextGame);
  SoundManager.playSound('genericnotify', 1.25);
  renderGameRoom();
}

function handleLocalTrap(game, moveUci) {
  const fromSquare = moveUci.substring(0, 2);
  const fromCol = moveUci.charCodeAt(0) - 'a'.charCodeAt(0);
  const fromRow = 8 - parseInt(moveUci[1], 10);
  const piece = activeBoard.squares[fromRow][fromCol];
  const trapEvent = `trap:${fromSquare}`;
  const now = Date.now();
  const elapsed = now - (game.lastActionTime || now);

  if (piece && piece.type === PieceType.KING) {
    const nextGame = {
      ...game,
      events: [...game.events, trapEvent],
      predictions: [...game.predictions, game.pendingPrediction],
      status: 'completed',
      result: 'black_wins',
      pendingPrediction: "",
      whiteTimeLeft: Math.max(0, (game.whiteTimeLeft || 1200000) - elapsed),
      lastActionTime: now
    };
    activeGame = nextGame;
    saveBotGame(nextGame);
    BotGameStore.saveToHistory(currentUid || 'anonymous', nextGame);
    renderGameRoom();
    finalizeLocalBotGame(GameResult.CHECKMATE_BLACK_WINS);
  } else {
    const nextGame = {
      ...game,
      events: [...game.events, trapEvent],
      predictions: [...game.predictions, game.pendingPrediction],
      currentTurn: 'white',
      phase: 'move',
      pendingPrediction: "",
      whiteTimeLeft: Math.max(0, (game.whiteTimeLeft || 1200000) - elapsed),
      lastActionTime: now
    };
    activeGame = nextGame;
    saveBotGame(nextGame);
    renderGameRoom();
  }
}

function getBotWorker() {
  if (!botWorker) {
    botWorker = new Worker('./bot-worker.js', { type: 'module' });
    botWorker.onmessage = (e) => onBotWorkerMessage(e.data);
    botWorker.onerror = (err) => {
      console.error('Bot worker error', err);
      botRunning = false;
    };
  }
  return botWorker;
}

function triggerBotAction() {
  if (activeGameId !== 'offline_bot') return;
  if (!activeGame || activeGame.status !== 'active') return;
  if (reviewIndex !== -1) return;
  if (activeGame.currentTurn !== 'black') return;
  if (botRunning) return;

  botRunning = true;
  const delayMs = activeGame.phase === 'predict' ? 500 : 1200;
  // Snapshot the request so a stale worker reply (after the user navigated
  // away, finished the game, or entered review) can be safely ignored.
  const requestId = ++botRequestId;
  const kind = activeGame.phase === 'predict' ? 'predict' : 'move';
  const events = [...(activeGame.events || [])];
  const elo = activeGame.botElo || 1200;

  if (botTimeoutId) clearTimeout(botTimeoutId);

  // A short delay gives the bot a "thinking" beat; the heavy search then runs
  // in the worker, so the main thread (and the clock) stay responsive.
  botTimeoutId = setTimeout(() => {
    try {
      getBotWorker().postMessage({ requestId, kind, events, elo });
    } catch (e) {
      console.error(e);
      botRunning = false;
    }
  }, delayMs);
}

function onBotWorkerMessage(data) {
  const { requestId, kind, uci } = data || {};
  // Ignore replies to superseded requests.
  if (requestId !== botRequestId) return;
  botRunning = false;

  // Re-validate: the game may have changed while the worker was computing.
  if (activeGameId !== 'offline_bot' || !activeGame || activeGame.status !== 'active') return;
  if (reviewIndex !== -1) return; // returning to LIVE re-triggers via renderGameRoom
  if (activeGame.currentTurn !== 'black') return;

  const now = Date.now();
  const elapsed = now - (activeGame.lastActionTime || now);
  const newBlackTime = Math.max(0, (activeGame.blackTimeLeft || 1200000) - elapsed);

  if (kind === 'predict') {
    if (activeGame.phase !== 'predict') return;
    const nextGame = {
      ...activeGame,
      pendingPrediction: uci || "",
      phase: 'move',
      currentTurn: 'white',
      blackTimeLeft: newBlackTime,
      lastActionTime: now
    };
    activeGame = nextGame;
    saveBotGame(nextGame);
    renderGameRoom();
    return;
  }

  // Move phase.
  if (activeGame.phase !== 'move' || !uci) return;
  const prediction = activeGame.pendingPrediction || "";

  if (prediction && uci === prediction) {
    // Bot fell into the player's trap!
    const fromSq = uci.substring(0, 2);
    const fromCol = uci.charCodeAt(0) - 'a'.charCodeAt(0);
    const fromRow = 8 - parseInt(uci[1], 10);
    const piece = activeBoard.squares[fromRow][fromCol];
    const trapEvent = `trap:${fromSq}`;

    if (piece && piece.type === PieceType.KING) {
      // Bot King is vaporized -> Player wins!
      const nextGame = {
        ...activeGame,
        events: [...activeGame.events, trapEvent],
        predictions: [...activeGame.predictions, prediction],
        status: 'completed',
        result: 'white_wins',
        pendingPrediction: "",
        blackTimeLeft: newBlackTime,
        lastActionTime: now
      };
      activeGame = nextGame;
      saveBotGame(nextGame);
      BotGameStore.saveToHistory(currentUid || 'anonymous', nextGame);
      renderGameRoom();
      finalizeLocalBotGame(GameResult.CHECKMATE_WHITE_WINS);
    } else {
      // Bot piece is vaporized -> Bot gets a compensation move!
      const nextGame = {
        ...activeGame,
        events: [...activeGame.events, trapEvent],
        predictions: [...activeGame.predictions, prediction],
        currentTurn: 'black',
        phase: 'move',
        pendingPrediction: "",
        blackTimeLeft: newBlackTime,
        lastActionTime: now
      };
      activeGame = nextGame;
      saveBotGame(nextGame);
      renderGameRoom();
    }
  } else {
    // Normal bot move completes successfully
    const nextGame = {
      ...activeGame,
      events: [...activeGame.events, uci],
      predictions: [...activeGame.predictions, prediction],
      phase: 'predict',
      currentTurn: 'black',
      pendingPrediction: "",
      blackTimeLeft: newBlackTime,
      lastActionTime: now
    };
    activeGame = nextGame;
    saveBotGame(nextGame);
    renderGameRoom();
  }
}

function finalizeLocalBotGame(result) {
  const statusStr = (result === GameResult.CHECKMATE_WHITE_WINS) ? 'white_wins' :
                    (result === GameResult.CHECKMATE_BLACK_WINS) ? 'black_wins' : 'draw';
  const nextGame = {
    ...activeGame,
    status: 'completed',
    result: statusStr,
    lastActionTime: Date.now()
  };
  activeGame = nextGame;
  saveBotGame(nextGame);

  const userWon = (result === GameResult.CHECKMATE_WHITE_WINS && myColor === PieceColor.WHITE) ||
                  (result === GameResult.CHECKMATE_BLACK_WINS && myColor === PieceColor.BLACK);
  const userLost = (result === GameResult.CHECKMATE_WHITE_WINS && myColor === PieceColor.BLACK) ||
                   (result === GameResult.CHECKMATE_BLACK_WINS && myColor === PieceColor.WHITE);
  
  let msg = "The game ended in a draw.";
  if (userWon) msg = "You win!";
  if (userLost) msg = "You lose.";

  showDialog('Game Over', msg, [
    { text: 'OK', type: 'confirm', action: () => showScreen(currentUid ? 'dashboard' : 'login') }
  ]);
}

function updateLoginBotButton() {
  const btn = document.getElementById('btn-login-play-bot');
  if (btn) {
    const hasActive = BotGameStore.hasActiveGame('anonymous');
    btn.textContent = hasActive ? "RESUME OFFLINE BOT GAME" : "PLAY VS OFFLINE BOT";
  }
}

// ============================================
// NEW FEATURE IMPLEMENTATIONS (1-4)
// ============================================

// --- ACTIVE GAME COUNTDOWN CLOCK TICKERS ---
let gameTimerInterval = null;

function startGameClocks() {
  lastPlayedLowTimeSecond = -1;
  if (gameTimerInterval) clearInterval(gameTimerInterval);
  gameTimerInterval = setInterval(() => {
    updateGameClocksUI();
  }, 200);
}

function stopGameClocks() {
  lastPlayedLowTimeSecond = -1;
  if (gameTimerInterval) clearInterval(gameTimerInterval);
  gameTimerInterval = null;
}

function updateGameClocksUI() {
  if (!activeGame) {
    document.getElementById('game-my-timer').style.display = 'none';
    document.getElementById('game-opponent-timer').style.display = 'none';
    return;
  }

  // Handle finished game static displays
  if (activeGame.status === 'finished' || activeGame.status === 'completed') {
    const myTime = myColor === PieceColor.WHITE ? activeGame.whiteTimeLeft : activeGame.blackTimeLeft;
    const oppTime = myColor === PieceColor.WHITE ? activeGame.blackTimeLeft : activeGame.whiteTimeLeft;
    
    const myTimerEl = document.getElementById('game-my-timer');
    const oppTimerEl = document.getElementById('game-opponent-timer');

    if (activeGame.timerType) {
      myTimerEl.style.display = 'inline-block';
      oppTimerEl.style.display = 'inline-block';
      myTimerEl.textContent = formatTimeMs(myTime, activeGame.timerType);
      oppTimerEl.textContent = formatTimeMs(oppTime, activeGame.timerType);
    } else {
      myTimerEl.style.display = 'none';
      oppTimerEl.style.display = 'none';
    }
    myTimerEl.classList.remove('active-turn');
    oppTimerEl.classList.remove('active-turn');
    return;
  }

  if (!activeGame.timerType) {
    document.getElementById('game-my-timer').style.display = 'none';
    document.getElementById('game-opponent-timer').style.display = 'none';
    return;
  }

  const now = Date.now();
  let elapsed = 0;
  if (activeGame.lastActionTime > 0) {
    elapsed = now - activeGame.lastActionTime;
  }

  let whiteTime = activeGame.whiteTimeLeft || 0;
  let blackTime = activeGame.blackTimeLeft || 0;

  if (activeGame.currentTurn === 'white') {
    whiteTime = Math.max(0, whiteTime - elapsed);
  } else if (activeGame.currentTurn === 'black') {
    blackTime = Math.max(0, blackTime - elapsed);
  }

  // Timeout handler triggers
  if (whiteTime <= 0 && activeGame.currentTurn === 'white') {
    handleTimeoutLoss('white');
    return;
  }
  if (blackTime <= 0 && activeGame.currentTurn === 'black') {
    handleTimeoutLoss('black');
    return;
  }

  // Calculate my timing vs opponent
  const myTime = myColor === PieceColor.WHITE ? whiteTime : blackTime;
  const oppTime = myColor === PieceColor.WHITE ? blackTime : whiteTime;

  const myTimerEl = document.getElementById('game-my-timer');
  const oppTimerEl = document.getElementById('game-opponent-timer');

  myTimerEl.style.display = 'inline-block';
  oppTimerEl.style.display = 'inline-block';

  myTimerEl.textContent = formatTimeMs(myTime, activeGame.timerType);
  oppTimerEl.textContent = formatTimeMs(oppTime, activeGame.timerType);

  // Turn ticking highlights and low-time audio warnings
  const myTurnColor = myColor === PieceColor.WHITE ? 'white' : 'black';
  if (activeGame.currentTurn === myTurnColor) {
    myTimerEl.classList.add('active-turn');
    oppTimerEl.classList.remove('active-turn');

    // Play low-time warnings under 30s for Blitz 30m
    if (activeGame.timerType === 'friend_30m') {
      const currentSecond = Math.floor(myTime / 1000);
      if (myTime < 30000 && currentSecond !== lastPlayedLowTimeSecond) {
        lastPlayedLowTimeSecond = currentSecond;
        SoundManager.playSound('lowtime');
      }
    }
  } else {
    oppTimerEl.classList.add('active-turn');
    myTimerEl.classList.remove('active-turn');
  }
}

function formatTimeMs(ms, timerType) {
  if (ms <= 0) return "00:00";
  if (timerType === 'friend_3d') {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h`;
    } else {
      return `${hours}h ${minutes % 60}m`;
    }
  } else {
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
}

async function handleTimeoutLoss(losingColor) {
  stopGameClocks();
  const winningColor = losingColor === 'white' ? 'black' : 'white';
  const resultStr = `${winningColor}_wins`;

  if (activeGameId === 'offline_bot') {
    const nextGame = {
      ...activeGame,
      status: 'completed',
      result: resultStr,
      lastActionTime: Date.now()
    };
    activeGame = nextGame;
    saveBotGame(nextGame);
    BotGameStore.saveToHistory(currentUid || 'anonymous', nextGame);
    renderGameRoom();
    showToast(`Game Over: ${winningColor.toUpperCase()} wins on time!`, 'info');
  } else {
    try {
      const myTurnColor = myColor === PieceColor.WHITE ? 'white' : 'black';
      if (losingColor === myTurnColor) {
        await finalizeGameOnDBDirectly(resultStr);
        showToast("You lost on time.", 'error');
      }
    } catch (_) {}
  }
}

// --- PUBLIC MATCHMAKING LOBBY & HOSTING ---
async function hostPublicChallenge(timerType) {
  const uid = currentUid;
  if (!uid) return;
  try {
    const existing = await getDocs(query(collection(db, 'open_challenges'), where('hostUid', '==', uid)));
    if (!existing.empty) {
      showToast('Cancel your existing challenge first.', 'error');
      return;
    }
    showToast('Hosting challenge...', 'info');
    await addDoc(collection(db, 'open_challenges'), {
      hostUid: uid,
      hostUsername: currentUsername || 'Anonymous',
      timerType: timerType,
      createdAt: Date.now()
    });
    showToast('Challenge posted to lobby!', 'success');
  } catch (e) {
    showToast('Failed to host challenge.', 'error');
  }
}

async function cancelChallenge(challengeId) {
  try {
    await deleteDoc(doc(db, 'open_challenges', challengeId));
    showToast('Challenge cancelled.', 'info');
  } catch (e) {
    showToast('Failed to cancel challenge.', 'error');
  }
}

async function joinChallenge(challengeId, hostUid, hostUsername, timerType) {
  const uid = currentUid;
  if (!uid) return;
  showToast('Joining match...', 'info');
  try {
    const challengeRef = doc(db, 'open_challenges', challengeId);
    
    await runTransaction(db, async (transaction) => {
      const challengeDoc = await transaction.get(challengeRef);
      if (!challengeDoc.exists()) {
        throw new Error("Challenge no longer exists");
      }

      // Create new game with starting timers
      const totalTime = timerType === "friend_3d" ? 259200000 : 1800000;
      const gameRef = doc(collection(db, 'games'));
      const gameData = {
        whiteUid: hostUid,
        blackUid: uid,
        whiteUsername: hostUsername,
        blackUsername: currentUsername,
        currentTurn: "white",
        phase: "move",
        events: [],
        predictions: [],
        pendingPrediction: "",
        status: "active",
        result: "",
        timerType: timerType,
        whiteTimeLeft: totalTime,
        blackTimeLeft: totalTime,
        lastActionTime: Date.now(),
        createdAt: serverTimestamp()
      };

      transaction.set(gameRef, gameData);

      // Update both users
      const hostUserRef = doc(db, 'users', hostUid);
      const challengerUserRef = doc(db, 'users', uid);

      transaction.update(hostUserRef, { openGames: arrayUnion(gameRef.id) });
      transaction.update(challengerUserRef, { openGames: arrayUnion(gameRef.id) });

      // Delete challenge
      transaction.delete(challengeRef);

      // Once transaction succeeds, enter the game
      setTimeout(() => enterGame(gameRef.id), 100);
    });
  } catch (e) {
    showToast(e.message || 'Failed to join challenge.', 'error');
  }
}

let publicChallengesListener = null;

function setupPublicLobbyListener() {
  if (publicChallengesListener) publicChallengesListener();

  const q = collection(db, 'open_challenges');
  publicChallengesListener = onSnapshot(q, (snapshot) => {
    const listEl = document.getElementById('public-challenges-list');
    listEl.innerHTML = '';

    const challenges = [];
    snapshot.forEach(docSnap => {
      challenges.push({ id: docSnap.id, ...docSnap.data() });
    });

    challenges.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    const hostBtn = document.getElementById('btn-host-challenge');
    if (hostBtn) {
      const hasOpenChallenge = challenges.some(c => c.hostUid === currentUid);
      hostBtn.disabled = hasOpenChallenge;
      hostBtn.textContent = hasOpenChallenge ? 'CHALLENGE OPEN' : 'HOST PUBLIC CHALLENGE';
    }

    if (challenges.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <p>No public challenges available</p>
        </div>
      `;
      return;
    }

    challenges.forEach(challenge => {
      const isMyChallenge = challenge.hostUid === currentUid;
      const timerDesc = challenge.timerType === "friend_3d" ? "3-Day Correspondence" : "30-Minute Blitz";

      const item = document.createElement('div');
      item.className = 'game-item';
      if (isMyChallenge) item.style.borderLeft = "3px solid var(--btn-resign)";

      const left = document.createElement('div');
      left.className = 'game-item-info';
      left.innerHTML = `
        <div class="game-item-opponent">${isMyChallenge ? "Your Challenge" : challenge.hostUsername}</div>
        <div class="game-item-meta">Open Challenge • ${timerDesc}</div>
      `;

      const right = document.createElement('div');
      if (isMyChallenge) {
        const btnCancel = document.createElement('button');
        btnCancel.className = 'badge badge-waiting';
        btnCancel.style.cursor = 'pointer';
        btnCancel.textContent = 'CANCEL';
        btnCancel.addEventListener('click', (e) => {
          e.stopPropagation();
          cancelChallenge(challenge.id);
        });
        right.appendChild(btnCancel);
      } else {
        const btnPlay = document.createElement('button');
        btnPlay.className = 'badge badge-your-turn';
        btnPlay.style.cursor = 'pointer';
        btnPlay.textContent = 'PLAY';
        btnPlay.addEventListener('click', (e) => {
          e.stopPropagation();
          joinChallenge(challenge.id, challenge.hostUid, challenge.hostUsername, challenge.timerType);
        });
        right.appendChild(btnPlay);
      }

      item.appendChild(left);
      item.appendChild(right);
      listEl.appendChild(item);
    });
  });
}

// --- PERFORMANCE TAB & GAME HISTORIES ---
async function renderPerformanceTab() {
  const uid = currentUid;
  const listEl = document.getElementById('history-games-list');
  listEl.innerHTML = '<div class="empty-state"><p>Loading match history...</p></div>';

  try {
    let onlineGames = [];
    if (uid) {
      const qWhite = query(collection(db, 'games'), where('whiteUid', '==', uid), where('status', '==', 'finished'));
      const qBlack = query(collection(db, 'games'), where('blackUid', '==', uid), where('status', '==', 'finished'));
      
      const snapWhite = await getDocs(qWhite);
      const snapBlack = await getDocs(qBlack);

      snapWhite.forEach(docSnap => {
        onlineGames.push({ id: docSnap.id, ...docSnap.data() });
      });
      snapBlack.forEach(docSnap => {
        onlineGames.push({ id: docSnap.id, ...docSnap.data() });
      });
    }

    const botGames = BotGameStore.loadHistory(uid || 'anonymous');

    // Upload bot games to Firestore to sync histories
    if (uid && botGames.length > 0) {
      try {
        for (const game of botGames) {
          const docRef = doc(db, 'games', game.id);
          const snap = await getDoc(docRef);
          if (!snap.exists()) {
            await setDoc(docRef, { ...game, status: 'finished' });
          }
        }
      } catch (_) {}
    }

    const allGames = [...onlineGames, ...botGames];
    const uniqueGames = [];
    const seenIds = new Set();
    for (const g of allGames) {
      if (!seenIds.has(g.id)) {
        seenIds.add(g.id);
        uniqueGames.push(g);
      }
    }

    uniqueGames.sort((a, b) => (b.lastActionTime || 0) - (a.lastActionTime || 0));

    listEl.innerHTML = '';

    if (uniqueGames.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <p>No completed games yet</p>
        </div>
      `;
      return;
    }

    uniqueGames.forEach(game => {
      const isWhite = game.whiteUid === uid;
      const playerColor = isWhite ? 'white' : 'black';
      const opponentName = isWhite ? game.blackUsername : game.whiteUsername;

      let timerDesc = "30-Minute Blitz";
      if (game.timerType === 'friend_3d') timerDesc = "3-Day Correspondence";
      else if (game.timerType === 'bot_20m') timerDesc = "20-Minute Offline Bot Match";
      else if (game.botElo) timerDesc = `Offline Bot Match (${game.botElo} ELO)`;

      let outcomeText = "DRAW";
      let badgeClass = "badge-draw";
      if (game.result === `${playerColor}_wins`) {
        outcomeText = "WIN";
        badgeClass = "badge-win";
      } else if (game.result && game.result !== 'draw') {
        outcomeText = "LOSS";
        badgeClass = "badge-loss";
      }

      const item = document.createElement('div');
      item.className = 'game-item';
      item.innerHTML = `
        <div class="game-item-info">
          <div class="game-item-avatar">${game.botElo ? '🤖' : '♟'}</div>
          <div>
            <div class="game-item-opponent">${opponentName}</div>
            <div class="game-item-meta">${timerDesc}</div>
          </div>
        </div>
        <span class="badge ${badgeClass}">${outcomeText}</span>
      `;

      item.addEventListener('click', () => {
        enterGameInReviewMode(game);
      });

      listEl.appendChild(item);
    });

  } catch (e) {
    listEl.innerHTML = `
      <div class="empty-state">
        <p>Failed to load match history</p>
      </div>
    `;
  }
}

function enterGameInReviewMode(game) {
  activeGameId = game.id;
  activeGame = game;
  reviewIndex = game.events.length - 1; // start review at last state
  selSquare = null;
  legalTargets = [];
  promotionPendingMove = null;

  myColor = game.whiteUid === (currentUid || 'anonymous') ? PieceColor.WHITE : PieceColor.BLACK;
  isFlipped = myColor === PieceColor.BLACK;

  showScreen('game');

  if (gameListener) {
    gameListener();
    gameListener = null;
  }

  document.getElementById('game-opponent-name').textContent = myColor === PieceColor.WHITE ? game.blackUsername : game.whiteUsername;
  document.getElementById('game-my-name').textContent = myColor === PieceColor.WHITE ? game.whiteUsername : game.blackUsername;

  renderGameRoom();
}
