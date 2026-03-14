const gunRelays = [
    'https://gun-manhattan.herokuapp.com/gun',
    'https://gun-relay.phi.is/gun',
    'https://gun-us.herokuapp.com/gun',
    'https://peer.wall.org/gun',
    'https://gun.p2p.report/gun',
    'https://gun-server.marda.io/gun'
];
const APP_NAMESPACE = 'oddroll_global_sync_v5'; 

const gun = Gun({
    peers: gunRelays,
    localStorage: true,
    radisk: true
});

// Debug Logger for User UI
function netLog(msg, color = '#a5b4fc') {
    const log = document.getElementById('networkLog');
    if (log) {
        const entry = document.createElement('div');
        entry.className = 'log-line';
        entry.style.color = color;
        entry.innerHTML = `<span class="log-time">${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}</span> ${msg}`;
        log.insertBefore(entry, log.firstChild);
        if (log.childNodes.length > 8) log.removeChild(log.lastChild);
    }
}

let gameState = {
    playerId: Math.random().toString(36).substr(2, 9),
    playerName: null,
    roomKey: null,
    players: [],
    currentTurnId: null,
    myState: null,
    canShoot: false,
    selectedTarget: null,
    isRoomCreator: false,
    gameStarted: false,
    connectedToPeers: false
};

// Monitor Peer Connection
gun.on('hi', peer => {
    console.log('Peer connected:', peer);
    gameState.connectedToPeers = true;
    updateConnectionStatus(true);
    addLog('✅ Connected to sync network');
});

function updateConnectionStatus(connected) {
    const statusDot = document.getElementById('connectionStatus');
    if (statusDot) {
        if (connected) {
            statusDot.classList.add('active');
            statusDot.title = 'Connected to Peers';
        } else {
            statusDot.classList.remove('active');
            statusDot.title = 'Disconnected from network';
        }
    }
}

gun.on('bye', peer => {
    console.log('Peer disconnected:', peer);
});

// DOM Elements
const loginScreen = document.getElementById('loginScreen');
const lobbyScreen = document.getElementById('lobbyScreen');
const gameScreen = document.getElementById('gameScreen');
const playerNameInput = document.getElementById('playerName');
const roomKeyInput = document.getElementById('roomKey');
const newRoomKeyInput = document.getElementById('newRoomKey');
const maxPlayersInput = document.getElementById('maxPlayers');
const joinButton = document.getElementById('joinButton');
const createRoomButton = document.getElementById('createRoomButton');
const confirmCreateButton = document.getElementById('confirmCreateButton');
const backButton = document.getElementById('backButton');
const joinMode = document.getElementById('joinMode');
const createMode = document.getElementById('createMode');
const roomKeyDisplay = document.getElementById('roomKeyDisplay');
const lobbyPlayers = document.getElementById('lobbyPlayers');
const startGameButton = document.getElementById('startGameButton');
const currentTurnDisplay = document.getElementById('currentTurnDisplay');
const playersListContainer = document.getElementById('playersListContainer');
const diceDisplay = document.getElementById('diceDisplay');
const rollDiceButton = document.getElementById('rollDiceButton');
const rollResult = document.getElementById('rollResult');
const shootButton = document.getElementById('shootButton');
const nextTurnButton = document.getElementById('nextTurnButton');
const gameLog = document.getElementById('gameLog');
const shootModal = document.getElementById('shootModal');
const closeShootModal = document.getElementById('closeShootModal');
const targetPlayersContainer = document.getElementById('targetPlayersContainer');
const disableNumberContainer = document.getElementById('disableNumberContainer');
const winnerModal = document.getElementById('winnerModal');
const winnerName = document.getElementById('winnerName');
const newGameButton = document.getElementById('newGameButton');

// Listeners
joinButton.addEventListener('click', joinRoom);
createRoomButton.addEventListener('click', showCreateMode);
backButton.addEventListener('click', showJoinMode);
confirmCreateButton.addEventListener('click', createRoom);
startGameButton.addEventListener('click', startGameAction);
rollDiceButton.addEventListener('click', rollDiceAction);
shootButton.addEventListener('click', showShootModal);
closeShootModal.addEventListener('click', hideShootModal);
nextTurnButton.addEventListener('click', nextTurnAction);
newGameButton.addEventListener('click', () => location.reload());

function showCreateMode() {
    joinMode.style.display = 'none';
    createMode.style.display = 'block';
}

function showJoinMode() {
    createMode.style.display = 'none';
    joinMode.style.display = 'block';
}

function joinRoom() {
    const name = playerNameInput.value.trim();
    const key = roomKeyInput.value.trim().toLowerCase(); // Normalize key
    if (!name || !key) return alert('Enter name and room key!');
    initGame(name, key, false);
}

function createRoom() {
    const name = playerNameInput.value.trim();
    const key = newRoomKeyInput.value.trim().toLowerCase(); // Normalize key
    if (!name || !key) return alert('Enter name and room key!');
    initGame(name, key, true);
}

function initGame(name, key, isCreator) {
    gameState.playerName = name;
    gameState.roomKey = key;
    gameState.isRoomCreator = isCreator;

    // UI Transitions
    roomKeyDisplay.textContent = key;
    switchScreen('lobby');
    addLog('Connecting to room...');

    // Clear existing players list to prevent duplicates on manual re-entry
    gameState.players = [];

    // Discovery logic check
    netLog(`Room [${key}] searching for players...`);

    // Initial Join logic
    const playerRef = room.get('players').get(gameState.playerId);
    playerRef.put({
        id: gameState.playerId,
        name: name,
        isAlive: true,
        totalBodyParts: 0,
        mustShoot: false,
        joinedAt: Date.now(),
        lastActive: Date.now()
    });

    // Subscriptions
    room.get('gameStarted').on(val => {
        if (val && !gameState.gameStarted) {
            gameState.gameStarted = true;
            switchScreen('game');
            netLog('🎮 Start signal received!', '#10b981');
        }
    });

    // Listen for all players in the room
    room.get('players').map().on((pData, pId) => {
        if (!pData || !pData.id) return;
        
        // Only log discovery once
        const exists = gameState.players.find(pl => pl.id === pData.id);
        if (!exists) netLog(`👤 Found player: ${pData.name}`, '#8b5cf6');

        updatePlayerInList(pData);

        if (pId === gameState.playerId) {
            gameState.myState = pData;
            ODD_NUMBERS.forEach(num => {
                playerRef.get('boxes').get(num.toString()).on(boxData => {
                    if (!gameState.myState.boxes) gameState.myState.boxes = {};
                    gameState.myState.boxes[num] = boxData;
                    updateMyBoxes();
                });
            });
        }
    });

    // Subscribe to gameplay actions (rolls, shots) to sync logs and UI
    room.get('lastAction').on(action => {
        if (!action || action.by === gameState.playerId) return;
        
        if (action.type === 'roll') {
            addLog(`${action.name} rolled a ${action.num}: ${action.msg}`);
            // Briefly show the roll for others
            if (gameState.currentTurnId === action.by) {
                diceDisplay.textContent = action.num;
                diceDisplay.classList.add('rolling');
                setTimeout(() => diceDisplay.classList.remove('rolling'), 300);
            }
        } else if (action.type === 'shot') {
            addLog(`🔫 ${action.msg}`, true);
        }
    });

    // Listen for all players in the room
    room.get('players').map().on((pData, pId) => {
        if (!pData || !pData.id) return;

        // Remove player if they haven't been active for 30 seconds (simple cleanup)
        if (pData.lastActive && Date.now() - pData.lastActive > 30000 && pId !== gameState.playerId) {
            // Option to handle disconnects (optional)
        }

        updatePlayerInList(pData);

        if (pId === gameState.playerId) {
            gameState.myState = pData;
            ODD_NUMBERS.forEach(num => {
                playerRef.get('boxes').get(num.toString()).on(boxData => {
                    if (!gameState.myState.boxes) gameState.myState.boxes = {};
                    gameState.myState.boxes[num] = boxData;
                    updateMyBoxes();
                });
            });
        }
    });

    room.get('currentTurnId').on(id => {
        gameState.currentTurnId = id;
        updateCurrentTurn();
    });

    room.get('winner').on(w => {
        if (w) {
            winnerName.textContent = `${w.name} Wins!`;
            winnerModal.classList.add('active');
            addLog(`🏆 ${w.name} wins the game!`, true);
        }
    });
}

function updatePlayerInList(p) {
    const index = gameState.players.findIndex(player => player.id === p.id);
    if (index > -1) gameState.players[index] = { ...gameState.players[index], ...p };
    else gameState.players.push(p);

    // Sort players by join time to ensure consistent turn order across all clients
    gameState.players.sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));

    if (gameState.gameStarted) updatePlayersList(gameState.players);
    else updateLobbyPlayers(gameState.players);
}

function startGameAction() {
    if (!gameState.isRoomCreator) return;
    if (gameState.players.length < 2) return alert("Waiting for more players...");
    
    const room = gun.get(APP_NAMESPACE).get('rooms').get(gameState.roomKey);
    room.get('gameStarted').put(true);
    // Set first player as turn holder (players are already sorted by joinedAt)
    const firstPlayerId = gameState.players[0].id;
    room.get('currentTurnId').put(firstPlayerId);
}

function rollDiceAction() {
    if (gameState.currentTurnId !== gameState.playerId) return;
    if (gameState.myState.mustShoot) return alert("You MUST shoot first!");

    rollDiceButton.disabled = true;
    diceDisplay.classList.add('rolling');

    setTimeout(() => {
        const rolledNumber = ODD_NUMBERS[Math.floor(Math.random() * ODD_NUMBERS.length)];
        diceDisplay.textContent = rolledNumber;
        diceDisplay.classList.remove('rolling');

        processRollLocally(rolledNumber);
        rollDiceButton.disabled = false;
        nextTurnButton.disabled = false;
    }, 600);
}

function processRollLocally(num) {
    const room = gun.get(APP_NAMESPACE).get('rooms').get(gameState.roomKey);
    const playerRef = room.get('players').get(gameState.playerId);
    const boxRef = playerRef.get('boxes').get(num.toString());

    boxRef.once(box => {
        if (box.disabled) {
            addLog(`Box ${num} is disabled!`, true);
            return;
        }

        let newStage = (box.stage || 0) + 1;
        let update = { stage: newStage };
        let msg = `Rolled ${num}: `;

        if (newStage === 1) {
            update.bodyParts = "Face";
            playerRef.get('totalBodyParts').put(1);
            msg += "Face appeared!";
        } else if (newStage === 2) {
            update.bodyParts = "Face,Full Body";
            playerRef.get('totalBodyParts').put(2);
            msg += "Full Body appeared!";
        } else if (newStage === 3) {
            update.bullets = 1;
            msg += "Gun with 1 bullet!";
        } else if (newStage === 4) {
            update.bullets = 2;
            msg += "Gun updated to 2 bullets!";
        } else if (newStage >= 5) {
            update.bullets = 3;
            playerRef.put({ mustShoot: true });
            msg += "3 Bullets! YOU MUST SHOOT!";
            shootButton.disabled = false;
        }

        boxRef.put(update);
        addLog(msg);

        // Sync action to other players
        room.get('lastAction').put({
            type: 'roll',
            by: gameState.playerId,
            name: gameState.playerName,
            num: num,
            msg: msg,
            time: Date.now()
        });
    });
}

function nextTurnAction() {
    if (gameState.myState.mustShoot) return alert("You must shoot first!");

    const alivePlayers = gameState.players.filter(p => p.isAlive);
    const currentIndex = alivePlayers.findIndex(p => p.id === gameState.playerId);
    const nextPlayer = alivePlayers[(currentIndex + 1) % alivePlayers.length];

    const room = gun.get(APP_NAMESPACE).get('rooms').get(gameState.roomKey);
    room.get('currentTurnId').put(nextPlayer.id);
    nextTurnButton.disabled = true;
}

function showShootModal() {
    targetPlayersContainer.innerHTML = '';
    gameState.players.forEach(player => {
        if (player.id !== gameState.playerId && player.isAlive) {
            const div = document.createElement('div');
            div.className = 'target-player';
            div.textContent = player.name;
            div.onclick = () => {
                gameState.selectedTarget = player.id;
                disableNumberContainer.style.display = 'block';
            };
            targetPlayersContainer.appendChild(div);
        }
    });

    document.querySelectorAll('.btn-number').forEach(btn => {
        btn.onclick = () => performShoot(gameState.selectedTarget, btn.dataset.num);
    });

    shootModal.classList.add('active');
}

function hideShootModal() {
    shootModal.classList.remove('active');
    disableNumberContainer.style.display = 'none';
}

function performShoot(targetId, num) {
    const room = gun.get(APP_NAMESPACE).get('rooms').get(gameState.roomKey);

    // Disable target's box
    room.get('players').get(targetId).get('boxes').get(num).put({ disabled: true });

    // Reset our bullets and mustShoot
    room.get('players').get(gameState.playerId).put({ mustShoot: false });
    // Reset the box that had the bullets (simplification: reset all, but usually only one has 3)
    ODD_NUMBERS.forEach(n => {
        room.get('players').get(gameState.playerId).get('boxes').get(n.toString()).once(b => {
            if (b && b.bullets === 3) room.get('players').get(gameState.playerId).get('boxes').get(n.toString()).put({ bullets: 0 });
        });
    });

    addLog(`Shot ${targetName}'s box ${num}!`, true);
    
    // Sync shot action
    room.get('lastAction').put({
        type: 'shot',
        by: gameState.playerId,
        msg: `${gameState.playerName} shot ${targetName}'s box ${num}!`,
        time: Date.now()
    });

    hideShootModal();
    shootButton.disabled = true;

    // Check if target is eliminated (if all boxes disabled)
    const targetRef = room.get('players').get(targetId);
    let disabledCount = 0;
    ODD_NUMBERS.forEach(n => {
        targetRef.get('boxes').get(n.toString()).once(b => {
            if (b && b.disabled) disabledCount++;
            if (disabledCount === 5) {
                targetRef.put({ isAlive: false });
                addLog(`${targetId} has been eliminated!`, true);

                // Check victory
                checkVictoryLogic(room);
            }
        });
    });
}

function checkVictoryLogic(room) {
    const alivePlayers = gameState.players.filter(p => p.isAlive);
    if (alivePlayers.length === 1) {
        room.get('winner').put({ id: alivePlayers[0].id, name: alivePlayers[0].name });
    }
}

// UI Helpers
function updateLobbyPlayers(players) {
    lobbyPlayers.innerHTML = '';
    players.forEach(p => {
        const div = document.createElement('div');
        div.className = 'lobby-player';
        div.textContent = `✓ ${p.name}`;
        lobbyPlayers.appendChild(div);
    });
    if (players.length >= 2 && gameState.isRoomCreator) startGameButton.disabled = false;
}

function updatePlayersList(players) {
    playersListContainer.innerHTML = '';
    players.forEach(p => {
        const div = document.createElement('div');
        div.className = 'player-item';
        if (p.id === gameState.currentTurnId) div.classList.add('current-turn');
        if (!p.isAlive) div.classList.add('eliminated');
        div.innerHTML = `<strong>${p.name}</strong><br>Parts: ${p.totalBodyParts || 0}`;
        playersListContainer.appendChild(div);
    });
}

function updateCurrentTurn() {
    const isMyTurn = gameState.currentTurnId === gameState.playerId;
    currentTurnDisplay.textContent = isMyTurn ? "🎲 YOUR TURN!" : "Waiting...";
    rollDiceButton.disabled = !isMyTurn;
}

function updateMyBoxes() {
    if (!gameState.myState || !gameState.myState.boxes) return;
    ODD_NUMBERS.forEach(num => {
        const box = gameState.myState.boxes[num];
        if (!box) return;
        const boxElem = document.querySelector(`.box[data-number="${num}"]`);
        const contentElem = document.getElementById(`box-${num}`);

        if (box.disabled) {
            boxElem.classList.add('disabled');
            contentElem.innerHTML = '❌ DISABLED';
        } else {
            boxElem.classList.remove('disabled');
            contentElem.innerHTML = (box.bodyParts || 'Empty') + (box.bullets ? `<br>🔫 ${box.bullets} Bullets` : '');
        }
    });
}

function switchScreen(s) {
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    document.getElementById(s + 'Screen').classList.add('active');
}

function addLog(msg, imp = false) {
    const div = document.createElement('div');
    div.className = 'log-entry' + (imp ? ' important' : '');
    div.innerHTML = `<small>${new Date().toLocaleTimeString()}</small><br>${msg}`;
    gameLog.insertBefore(div, gameLog.firstChild);
}

switchScreen('login');
