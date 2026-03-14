// 🚀 PeerJS - Professional P2P Network Engine
const ODD_NUMBERS = [1, 3, 5, 7, 9];
let peer = null;
let connections = []; // All connected peers
let gameState = {
    playerId: null, // This will be the Peer ID
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

// Advanced Network Diagnostics
function netLog(msg, type = 'info') {
    const log = document.getElementById('networkLog');
    if (!log) return;
    const colors = { info: '#a5b4fc', success: '#10b981', warn: '#fbbf24', error: '#ef4444' };
    const entry = document.createElement('div');
    entry.className = 'log-line';
    entry.style.color = colors[type] || '#fff';
    entry.innerHTML = `<span class="log-time">[${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}]</span> ${msg}`;
    log.insertBefore(entry, log.firstChild);
    if (log.childNodes.length > 20) log.removeChild(log.lastChild);
}

// UI Elements
const loginScreen = document.getElementById('loginScreen');
const lobbyScreen = document.getElementById('lobbyScreen');
const gameScreen = document.getElementById('gameScreen');
const playerNameInput = document.getElementById('playerName');
const roomKeyInput = document.getElementById('roomKey');
const newRoomKeyInput = document.getElementById('newRoomKey');
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

// Initialize Peer
function initPeerSignals(onReady) {
    peer = new Peer(null, { debug: 1 });

    peer.on('open', (id) => {
        gameState.playerId = id;
        netLog('✔ Network ID ready', 'success');
        updateConnectionStatus(true);
        if(onReady) onReady();
    });

    peer.on('connection', (conn) => {
        setupConnection(conn);
    });

    peer.on('error', (err) => {
        netLog(`✖ Network Error: ${err.type}`, 'error');
        console.error(err);
    });
}

function setupConnection(conn) {
    netLog(`📡 Peer Handshake: ${conn.peer.substring(0,5)}...`, 'info');
    
    conn.on('open', () => {
        connections.push(conn);
        if (gameState.isRoomCreator) {
            broadcastState();
        }
    });

    conn.on('data', (data) => {
        handleIncomingMessage(data, conn);
    });

    conn.on('close', () => {
        connections = connections.filter(c => c !== conn);
        netLog('✖ Peer disconnected', 'warn');
    });
}

function handleIncomingMessage(data, conn) {
    if (data.type === 'join') {
        netLog(`👤 Player Joined: ${data.name}`, 'success');
        addPlayerToList({ id: data.id, name: data.name, joinedAt: Date.now(), isAlive: true, boxes: getDefaultBoxes(), mustShoot: false });
        broadcastState();
    } else if (data.type === 'sync_state') {
        gameState.players = data.players;
        gameState.currentTurnId = data.currentTurnId;
        
        if (data.gameStarted && !gameState.gameStarted) {
            gameState.gameStarted = true;
            switchScreen('game');
        }
        
        if (data.winner) {
            showWinner(data.winner);
        }

        updateLobbyPlayers(gameState.players);
        updatePlayersList(gameState.players);
        updateCurrentTurn();
        updateMyBoxes();
    } else if (data.type === 'action') {
        processRemoteAction(data);
        // CRITICAL: Host relays actions to all other clients
        if (gameState.isRoomCreator) {
            connections.forEach(c => {
                if (c !== conn) c.send(data);
            });
        }
    }
}

function getDefaultBoxes() {
    const boxes = {};
    ODD_NUMBERS.forEach(n => boxes[n] = { stage: 0, bodyParts: 'Empty', bullets: 0, disabled: false });
    return boxes;
}

function broadcastState(extraData = {}) {
    const stateUpdate = {
        type: 'sync_state',
        players: gameState.players,
        currentTurnId: gameState.currentTurnId,
        gameStarted: gameState.gameStarted,
        ...extraData
    };
    connections.forEach(conn => conn.send(stateUpdate));
}

function addPlayerToList(p) {
    if (!gameState.players.find(pl => pl.id === p.id)) {
        gameState.players.push(p);
        gameState.players.sort((a,b) => a.joinedAt - b.joinedAt);
    }
    updateLobbyPlayers(gameState.players);
}

// UI Transition Helpers
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

function showCreateMode() { joinMode.style.display = 'none'; createMode.style.display = 'block'; }
function showJoinMode() { createMode.style.display = 'none'; joinMode.style.display = 'block'; }

function createRoom() {
    const name = playerNameInput.value.trim();
    const key = newRoomKeyInput.value.trim().toLowerCase();
    if (!name || !key) return alert('Enter name and room key!');
    
    gameState.isRoomCreator = true;
    gameState.playerName = name;
    gameState.roomKey = key;
    
    initPeerSignals(() => {
        const me = { id: gameState.playerId, name: name, joinedAt: Date.now(), isAlive: true, boxes: getDefaultBoxes(), mustShoot: false };
        gameState.players = [me];
        gameState.myState = me;
        
        switchScreen('lobby');
        roomKeyDisplay.textContent = key;
        netLog(`Room [${key}] created. Waiting for peers...`, 'success');
        updateLobbyPlayers(gameState.players);
        
        const signaler = new Peer(`oddroll-room-${key}`, { debug: 1 });
        signaler.on('open', () => netLog('🌐 Room broadcast live', 'success'));
        signaler.on('error', (err) => {
            if(err.type === 'unavailable-id') {
                alert("Room key already taken! Use a different one.");
                location.reload();
            }
        });
        signaler.on('connection', (conn) => {
            conn.on('open', () => {
                conn.send({ type: 'host_id', id: gameState.playerId });
                setTimeout(() => signaler.destroy(), 1000);
            });
        });
    });
}

function joinRoom() {
    const name = playerNameInput.value.trim();
    const key = roomKeyInput.value.trim().toLowerCase();
    if (!name || !key) return alert('Enter name and room key!');

    gameState.playerName = name;
    gameState.roomKey = key;
    gameState.isRoomCreator = false;

    initPeerSignals(() => {
        netLog(`🔍 Looking for Room: ${key}...`);
        const tracker = peer.connect(`oddroll-room-${key}`);
        tracker.on('data', (msg) => {
            if (msg.type === 'host_id') {
                netLog('🚀 Room found! Connecting...', 'success');
                const hostConn = peer.connect(msg.id);
                hostConn.on('open', () => {
                    setupConnection(hostConn);
                    hostConn.send({ type: 'join', name: name, id: gameState.playerId });
                    switchScreen('lobby');
                    roomKeyDisplay.textContent = key;
                });
            }
        });
        setTimeout(() => {
            if (lobbyScreen.classList.contains('active')) return;
            netLog('✖ Room not found or slow response.', 'warn');
        }, 8000);
    });
}

function startGameAction() {
    if (!gameState.isRoomCreator || gameState.players.length < 2) return alert("Min 2 players!");
    gameState.gameStarted = true;
    gameState.currentTurnId = gameState.players[0].id;
    switchScreen('game');
    broadcastState();
}

function rollDiceAction() {
    if (gameState.currentTurnId !== gameState.playerId) return;
    const myPlayer = gameState.players.find(p => p.id === gameState.playerId);
    if (myPlayer.mustShoot) return alert("You MUST shoot first!");

    const rolledNumber = ODD_NUMBERS[Math.floor(Math.random() * ODD_NUMBERS.length)];
    diceDisplay.textContent = rolledNumber;
    diceDisplay.classList.add('rolling');
    
    setTimeout(() => {
        diceDisplay.classList.remove('rolling');
        processRoll(rolledNumber);
    }, 600);
}

function processRoll(num) {
    const myPlayer = gameState.players.find(p => p.id === gameState.playerId);
    const box = myPlayer.boxes[num];
    if (box.disabled) {
        addLog(`Box ${num} is disabled!`, true);
        broadcastAction({ type: 'roll', num, msg: `${gameState.playerName} rolled a disabled box ${num}`, by: gameState.playerId });
        broadcastState();
        nextTurnButton.disabled = false;
        return;
    }

    box.stage++;
    let msg = `${gameState.playerName} rolled ${num}: `;
    if (box.stage === 1) { box.bodyParts = "Face"; msg += "Face!"; }
    else if (box.stage === 2) { box.bodyParts = "Face, Full Body"; msg += "Full Body!"; }
    else if (box.stage === 3) { box.bullets = 1; msg += "Gun +1 Bullet"; }
    else if (box.stage === 4) { box.bullets = 2; msg += "Gun +2 Bullets"; }
    else if (box.stage >= 5) { 
        box.bullets = 3; 
        myPlayer.mustShoot = true; 
        msg += "3 BULLETS! MUST SHOOT!"; 
        shootButton.disabled = false;
    }

    addLog(msg);
    broadcastAction({ type: 'roll', num, msg, by: gameState.playerId });
    broadcastState();
    nextTurnButton.disabled = false;
}

function broadcastAction(actionData) {
    connections.forEach(conn => conn.send({ type: 'action', ...actionData }));
}

function processRemoteAction(action) {
    if (action.type === 'roll') {
        addLog(action.msg);
        if (gameState.currentTurnId === action.by) {
            diceDisplay.textContent = action.num;
        }
    } else if (action.type === 'shot') {
        addLog(`🔫 ${action.msg}`, true);
    }
}

function nextTurnAction() {
    const myPlayer = gameState.players.find(p => p.id === gameState.playerId);
    if (myPlayer.mustShoot) return alert("Must shoot first!");

    const alives = gameState.players.filter(p => p.isAlive);
    const idx = alives.findIndex(p => p.id === gameState.playerId);
    gameState.currentTurnId = alives[(idx + 1) % alives.length].id;
    
    nextTurnButton.disabled = true;
    broadcastState();
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
                // Highlight selection
                document.querySelectorAll('.target-player').forEach(el => el.style.border = 'none');
                div.style.border = '2px solid var(--primary-color)';
            };
            targetPlayersContainer.appendChild(div);
        }
    });

    document.querySelectorAll('.btn-number').forEach(btn => {
        btn.onclick = () => performShoot(gameState.selectedTarget, btn.dataset.num);
    });

    shootModal.classList.add('active');
}

function performShoot(targetId, num) {
    if (!targetId) return alert("Select a target first!");
    
    const myPlayer = gameState.players.find(p => p.id === gameState.playerId);
    const targetPlayer = gameState.players.find(p => p.id === targetId);
    
    if (!targetPlayer) return;

    // 1. Disable target's box
    targetPlayer.boxes[num].disabled = true;
    
    // 2. Reset our status
    myPlayer.mustShoot = false;
    Object.values(myPlayer.boxes).forEach(b => {
        if (b.bullets === 3) {
            b.bullets = 0;
            b.stage = 2; // Return to stage 2 (Full Body) after shooting
        }
    });

    const msg = `${gameState.playerName} shot ${targetPlayer.name}'s box ${num}!`;
    addLog(msg, true);
    broadcastAction({ type: 'shot', msg, by: gameState.playerId });

    // 3. Check if target is eliminated
    const allDisabled = Object.values(targetPlayer.boxes).every(b => b.disabled);
    if (allDisabled) {
        targetPlayer.isAlive = false;
        addLog(`💀 ${targetPlayer.name} HAS BEEN ELIMINATED!`, true);
    }

    // 4. Check for victory
    const alives = gameState.players.filter(p => p.isAlive);
    if (alives.length === 1) {
        broadcastState({ winner: alives[0] });
        showWinner(alives[0]);
    } else {
        broadcastState();
    }

    hideShootModal();
    shootButton.disabled = true;
}

function showWinner(w) {
    winnerName.textContent = `${w.name} Wins!`;
    winnerModal.classList.add('active');
}

function hideShootModal() {
    shootModal.classList.remove('active');
    disableNumberContainer.style.display = 'none';
}

// UI Base Helpers
function updateConnectionStatus(c) {
    const dot = document.getElementById('connectionStatus');
    if(dot) c ? dot.classList.add('active') : dot.classList.remove('active');
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

function updateLobbyPlayers(players) {
    lobbyPlayers.innerHTML = '';
    players.forEach(p => {
        const div = document.createElement('div');
        div.className = 'lobby-player';
        div.textContent = `✓ ${p.name}`;
        lobbyPlayers.appendChild(div);
    });
    if (players.length >= 2 && gameState.isRoomCreator) {
        startGameButton.disabled = false;
    }
}

function updatePlayersList(players) {
    playersListContainer.innerHTML = '';
    players.forEach(p => {
        const div = document.createElement('div');
        div.className = 'player-item';
        if (p.id === gameState.currentTurnId) div.classList.add('current-turn');
        if (!p.isAlive) div.classList.add('eliminated');
        let parts = 0;
        Object.values(p.boxes).forEach(b => { 
            if(b.stage === 1) parts+=1; 
            if(b.stage >= 2) parts+=2; 
        });
        div.innerHTML = `<strong>${p.name}</strong><br>Health Parts: ${parts}`;
        playersListContainer.appendChild(div);
    });
}

function updateCurrentTurn() {
    const isMe = gameState.currentTurnId === gameState.playerId;
    currentTurnDisplay.textContent = isMe ? "🎲 YOUR TURN!" : "Waiting...";
    rollDiceButton.disabled = !isMe;
    
    // Auto-enable shoot if mustShoot is set
    const me = gameState.players.find(p => p.id === gameState.playerId);
    if (isMe && me && me.mustShoot) {
        shootButton.disabled = false;
    }
}

function updateMyBoxes() {
    const me = gameState.players.find(p => p.id === gameState.playerId);
    if (!me) return;
    Object.keys(me.boxes).forEach(num => {
        const box = me.boxes[num];
        const boxElem = document.querySelector(`.box[data-number="${num}"]`);
        const contentElem = document.getElementById(`box-${num}`);
        if (!boxElem || !contentElem) return;
        
        if (box.disabled) {
            boxElem.classList.add('disabled');
            contentElem.innerHTML = '❌ DISABLED';
        } else {
            boxElem.classList.remove('disabled');
            contentElem.innerHTML = (box.bodyParts || 'Empty') + (box.bullets ? `<br>🔫 ${box.bullets} Bullets` : '');
        }
    });
}

netLog('System Ready. Enter name to start.', 'info');
