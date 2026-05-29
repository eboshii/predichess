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

// --- NAVIGATION & SCREEN ROUTING ---
const screens = {
  login: document.getElementById('screen-login'),
  username: document.getElementById('screen-username'),
  dashboard: document.getElementById('screen-dashboard'),
  game: document.getElementById('screen-game'),
  help: document.getElementById('screen-help')
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

  if (screenId !== 'game' && gameListener) {
    gameListener();
    gameListener = null;
    activeGameId = null;
    activeGame = null;
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
  if (username.length < 3 || username.length > 20) {
    errorDiv.textContent = "Username must be between 3 and 20 characters.";
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

// Logout listener
document.getElementById('btn-dashboard-logout').addEventListener('click', () => {
  showDialog('LOGOUT', 'Are you sure you want to end your session?', [
    { text: 'Logout', type: 'danger', action: () => signOut(auth) },
    { text: 'Cancel', type: 'cancel' }
  ]);
});

// Help buttons
document.getElementById('btn-dashboard-help').addEventListener('click', () => showScreen('help'));
document.getElementById('btn-help-back').addEventListener('click', () => showScreen('dashboard'));

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
      return;
    }

    pendingHeader.style.display = 'block';
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

    // Render Friends List
    const friendsListDiv = document.getElementById('friends-list');
    friendsListDiv.innerHTML = '';
    const friends = currentUser.friends || [];

    if (friends.length === 0) {
      friendsListDiv.innerHTML = `
        <div class="empty-state">
          <p>No friends added yet</p>
        </div>
      `;
    } else {
      for (const fUid of friends) {
        const fDoc = await getDoc(doc(db, 'users', fUid));
        if (fDoc.exists()) {
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
          friendsListDiv.appendChild(item);
        }
      }
    }

    // Render Active Games List (OPEN GAMES)
    const gamesListDiv = document.getElementById('open-games-list');
    gamesListDiv.innerHTML = '';
    const openGames = currentUser.openGames || [];
    let activeGamesCount = 0;

    for (const gameId of openGames) {
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
          gamesListDiv.appendChild(item);
        }
      }
    }

    if (activeGamesCount === 0) {
      gamesListDiv.innerHTML = `
        <div class="empty-state">
          <p>No active games</p>
        </div>
      `;
    }
  });
}

function cleanupListeners() {
  if (friendRequestsListener) friendRequestsListener();
  if (openGamesListener) openGamesListener();
  friendRequestsListener = null;
  openGamesListener = null;
}

// TAB MANAGEMENT IN DASHBOARD
const tabPlay = document.getElementById('tab-play');
const tabFriends = document.getElementById('tab-friends');
const panePlay = document.getElementById('pane-play');
const paneFriends = document.getElementById('pane-friends');

tabPlay.addEventListener('click', () => {
  tabPlay.classList.add('active');
  tabFriends.classList.remove('active');
  panePlay.classList.add('active');
  paneFriends.classList.remove('active');
});

tabFriends.addEventListener('click', () => {
  tabFriends.classList.add('active');
  tabPlay.classList.remove('active');
  paneFriends.classList.add('active');
  panePlay.classList.remove('active');
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
    await setDoc(requestDocRef, {});
    const batch = writeBatch(db);
    batch.delete(requestDocRef);
    await batch.commit();
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
      createdAt: serverTimestamp()
    };

    const docRef = await addDoc(collection(db, 'games'), gameData);
    const gameId = docRef.id;

    const batch = writeBatch(db);
    batch.update(doc(db, 'users', currentUid), { openGames: arrayUnion(gameId) });
    batch.update(doc(db, 'users', friendUid), { openGames: arrayUnion(gameId) });
    await batch.commit();

    enterGame(gameId);
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

  showScreen('game');

  gameListener = onSnapshot(doc(db, 'games', gameId), (docSnap) => {
    if (!docSnap.exists()) return;
    activeGame = docSnap.data();

    myColor = activeGame.whiteUid === currentUid ? PieceColor.WHITE : PieceColor.BLACK;
    isFlipped = (myColor === PieceColor.BLACK);

    const opponentName = myColor === PieceColor.WHITE ? activeGame.blackUsername : activeGame.whiteUsername;
    document.getElementById('game-opponent-name').textContent = opponentName;
    document.getElementById('game-my-name').textContent = currentUsername;

    if (reviewIndex >= activeGame.events.size) {
      reviewIndex = -1;
    }

    renderGameRoom();
  });
}

function renderGameRoom() {
  if (!activeGame) return;

  const events = activeGame.events || [];
  const eventsToApply = reviewIndex === -1 ? events : events.slice(0, reviewIndex + 1);
  activeBoard.applyMoves(eventsToApply);

  const gameRes = activeBoard.gameResult();
  if (gameRes !== GameResult.ONGOING && reviewIndex === -1) {
    selSquare = null;
    legalTargets = [];
    if (activeGame.status === 'active') {
      finalizeGameOnDB(gameRes);
    }
  }

  drawChessBoardGrid();
  updateGameHUD(gameRes);
  populateMoveLog();
}

function drawChessBoardGrid() {
  const grid = document.getElementById('chess-board-grid');
  grid.innerHTML = '';

  const inPredictPhase = (activeGame.phase === 'predict');
  const isMyTurn = (activeGame.currentTurn === 'white' && activeGame.whiteUid === currentUid) ||
                   (activeGame.currentTurn === 'black' && activeGame.blackUid === currentUid);
  
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
  const eventsToApply = reviewIndex === -1 ? events : events.slice(0, reviewIndex + 1);

  if (eventsToApply.length > 0) {
    const lastEvent = eventsToApply[eventsToApply.length - 1];
    if (lastEvent.startsWith('trap:')) {
      const sq = lastEvent.substring(5);
      trapSq = {
        row: 8 - parseInt(sq[1], 10),
        col: sq.charCodeAt(0) - 'a'.charCodeAt(0)
      };
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

        pieceEl.addEventListener('click', (e) => {
          if (reviewIndex !== -1) return;
          e.stopPropagation();

          if (!inPredictPhase && isMyTurn && piece.color === myColor) {
            selectSquare(rowIdx, colIdx);
          } else if (inPredictPhase && isMyTurn && piece.color !== myColor) {
            selectSquare(rowIdx, colIdx);
          }
        });

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

  if (inPredictPhase) {
    try {
      await updateDoc(doc(db, 'games', activeGameId), {
        pendingPrediction: uci,
        phase: 'move',
        currentTurn: oppTurnStr
      });
      showToast('Prediction submitted!', 'success');
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
            events: arrayUnion(trapEvent),
            predictions: arrayUnion(prediction),
            status: "finished",
            result: resultStatus,
            pendingPrediction: ""
          });
          batch.update(doc(db, 'users', activeGame.whiteUid), { openGames: arrayRemove(activeGameId) });
          batch.update(doc(db, 'users', activeGame.blackUid), { openGames: arrayRemove(activeGameId) });
          await batch.commit();
        } catch (_) {}
      } else {
        try {
          await updateDoc(doc(db, 'games', activeGameId), {
            events: arrayUnion(trapEvent),
            predictions: arrayUnion(prediction),
            phase: 'move',
            currentTurn: myTurnStr,
            pendingPrediction: ""
          });
        } catch (_) {}
      }
    } else {
      try {
        await updateDoc(doc(db, 'games', activeGameId), {
          events: arrayUnion(uci),
          predictions: arrayUnion(prediction),
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
  const isMyTurn = (activeGame.currentTurn === 'white' && activeGame.whiteUid === currentUid) ||
                   (activeGame.currentTurn === 'black' && activeGame.blackUid === currentUid);

  const btnFirst = document.getElementById('btn-game-first');
  const btnPrev = document.getElementById('btn-game-prev');
  const btnNext = document.getElementById('btn-game-next');
  const btnLast = document.getElementById('btn-game-last');

  const eventsSize = (activeGame.events || []).length;

  if (reviewIndex !== -1) {
    // Reviewing banner
    banner.style.color = "var(--accent-blue)";
    banner.textContent = `REVIEWING MOVE ${reviewIndex + 1}/${eventsSize}`;

    btnFirst.disabled = (reviewIndex === 0);
    btnPrev.disabled = (reviewIndex === 0);
    btnNext.disabled = false;
    btnLast.disabled = false;
  } else {
    // Live banner
    btnFirst.disabled = (eventsSize === 0);
    btnPrev.disabled = (eventsSize === 0);
    btnNext.disabled = true;
    btnLast.disabled = true;

    if (gameRes !== GameResult.ONGOING) {
      banner.style.color = "var(--text-secondary)";
      const winner = gameRes === GameResult.CHECKMATE_WHITE_WINS ? 'White wins!' : 
                     gameRes === GameResult.CHECKMATE_BLACK_WINS ? 'Black wins!' : 'Draw.';
      banner.textContent = `GAME CONCLUDED: ${winner.toUpperCase()}`;
      return;
    }

    if (isMyTurn) {
      if (inPredictPhase) {
        banner.style.color = "var(--accent-blue)";
        banner.textContent = "PREDICT THEIR MOVE (Click & Drag Opponent Piece)";
      } else {
        banner.style.color = "var(--accent-green)";
        banner.textContent = "YOUR TURN";
      }
    } else {
      banner.style.color = "var(--text-secondary)";
      if (inPredictPhase) {
        banner.textContent = "OPPONENT PREDICTING";
      } else {
        banner.textContent = "WAITING FOR OPPONENT";
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
      const isMePredictor = predictorStr.toLowerCase() === (myColor === PieceColor.WHITE ? 'white' : 'black');
      const predictorLabel = isMePredictor ? 'You' : `Opponent (${predictorStr})`;

      if (wasPredicted) {
        predLine.className = 'move-log-prediction destroyed';
        predLine.innerHTML = `↳ ${predictorLabel} predicted this exactly! (Piece Destroyed!)`;
      } else {
        predLine.className = 'move-log-prediction normal';
        predLine.innerHTML = `↳ ${predictorLabel} predicted: ${formatUciMove(pred)}`;
      }
    } else if (i > 0) {
      const predictorStr = movingColor === PieceColor.WHITE ? 'Black' : 'White';
      const isMePredictor = predictorStr.toLowerCase() === (myColor === PieceColor.WHITE ? 'white' : 'black');
      const predictorLabel = isMePredictor ? 'You' : `Opponent (${predictorStr})`;
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

  const isMyTurn = (activeGame.currentTurn === 'white' && activeGame.whiteUid === currentUid) ||
                   (activeGame.currentTurn === 'black' && activeGame.blackUid === currentUid);

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
    reviewIndex = 0;
    renderGameRoom();
  }
});

document.getElementById('btn-game-prev').addEventListener('click', () => {
  const events = activeGame.events || [];
  if (events.length > 0) {
    if (reviewIndex === -1) {
      reviewIndex = events.length - 1;
    } else {
      reviewIndex = Math.max(0, reviewIndex - 1);
    }
    renderGameRoom();
  }
});

document.getElementById('btn-game-next').addEventListener('click', () => {
  const events = activeGame.events || [];
  if (events.length > 0 && reviewIndex !== -1) {
    if (reviewIndex === events.length - 1) {
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
  showScreen('dashboard');
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
  const strokeColor = isWhite ? "#596A82" : "#3A86FF";
  const fillGradientId = `grad-${type}-${color}`;
  
  const gradient = isWhite 
    ? `<linearGradient id="${fillGradientId}" x1="0%" y1="0%" x2="100%" y2="100%">
         <stop offset="0%" stop-color="#ffffff" />
         <stop offset="100%" stop-color="#e2e6ed" />
       </linearGradient>`
    : `<linearGradient id="${fillGradientId}" x1="0%" y1="0%" x2="100%" y2="100%">
         <stop offset="0%" stop-color="#2a364f" />
         <stop offset="100%" stop-color="#121a26" />
       </linearGradient>`;

  const baseSvg = (content) => `
    <svg viewBox="0 0 45 45" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <defs>${gradient}</defs>
      <g fill="url(#${fillGradientId})" stroke="${strokeColor}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">
        ${content}
      </g>
    </svg>
  `;

  switch (type) {
    case PieceType.KING:
      return baseSvg(`
        <path d="M22.5 11.63V6M20 8h5M11.5 37c0 1 1.5 2 11 2s11-1 11-2M11.5 30c0-2.5 2-5 3.5-7.5C18.5 22 21.5 19 22.5 15c1 4 4 7 7.5 7.5 1.5 2.5 3.5 5 3.5 7.5H11.5z" />
        <path d="M11.5 30c0 1.5 2 3 11 3s11-1.5 11-3H11.5z" />
        <path d="M12.5 33.5c0 1.5 1.5 2.5 10 2.5s10-1 10-2.5h-20z" />
      `);
    case PieceType.QUEEN:
      return baseSvg(`
        <path d="M9 26c0-4 2.5-9 6-12.5L22.5 30 30 13.5c3.5 3.5 6 8.5 6 12.5H9z" />
        <path d="M9 26c0 2 2.5 4 13.5 4s13.5-2 13.5-4H9z" />
        <path d="M11.5 30c0 1.5 2 3 11 3s11-1.5 11-3H11.5z" />
        <path d="M12.5 33.5c0 1.5 1.5 2.5 10 2.5s10-1 10-2.5h-20z" />
        <path d="M11.5 37c0 1 1.5 2 11 2s11-1 11-2" />
        <circle cx="9" cy="26" r="1.5" />
        <circle cx="15" cy="13.5" r="1.5" />
        <circle cx="22.5" cy="9" r="1.5" />
        <circle cx="30" cy="13.5" r="1.5" />
        <circle cx="36" cy="26" r="1.5" />
      `);
    case PieceType.ROOK:
      return baseSvg(`
        <path d="M9 39h27v-3H9v3zM12 36v-4h21v4H12zM12 32l1-17h19l1 17H12zM14 15v-4h4v2h5v-2h5v2h5v-4h4v4H14z" />
        <path d="M11 36c0 1 2 2 11.5 2s11.5-1 11.5-2H11z" />
      `);
    case PieceType.BISHOP:
      return baseSvg(`
        <path d="M9 36c3.39 0 7.66-.69 11.5-2.33 3.84 1.64 8.11 2.33 11.5 2.33M15 30c0-4.5 4-8.5 7.5-16.5 3.5 8 7.5 12 7.5 16.5H15z" />
        <path d="M17.5 18c2 1 3 3 5 4M11.5 37c0 1 1.5 2 11 2s11-1 11-2" />
        <circle cx="22.5" cy="10" r="1.5" />
        <path d="M11.5 30c0 1.5 2 3 11 3s11-1.5 11-3H11.5z" />
        <path d="M12.5 33.5c0 1.5 1.5 2.5 10 2.5s10-1 10-2.5h-20z" />
      `);
    case PieceType.KNIGHT:
      return baseSvg(`
        <path d="M22 10c-3 0-6 2-7.5 5-1.5 3-1.5 7 1 9.5 2.5 2.5 2.5 4.5.5 7.5-2 3-2 5 2 5h17s2-5.5-2-9c-4-3.5-3-6-3-9s-2-6-8-9z" />
        <path d="M9 39c0 1 1.5 2 11 2s11-1 11-2" />
        <circle cx="17.5" cy="15" r="1" />
        <path d="M20 23.5c2-1 4-1 6-1" />
      `);
    case PieceType.PAWN:
      return baseSvg(`
        <circle cx="22.5" cy="14.5" r="6.5" />
        <path d="M15 36c0-5 3.5-8 7.5-12.5 4 4.5 7.5 7.5 7.5 12.5H15z" />
        <path d="M11.5 37c0 1 1.5 2 11 2s11-1 11-2" />
        <path d="M15 36c0 1 2 2 7.5 2s7.5-1 7.5-2H15z" />
      `);
    default:
      return "";
  }
}
