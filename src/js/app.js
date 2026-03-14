// 🚀 PeerJS - Ultra-Sync Multiplayer Engine v2
const ODD_NUMBERS = [1, 3, 5, 7, 9];
let peer = null;
let connections = []; // Host: all clients. Client: only Host.
let gameState = {
    playerId: null,
    playerName: null,
    roomKey: null,
    players: [], // Reliable list of player objects
    currentTurnId: null,
    isRoomCreator: false,
    gameStarted: false,
    connectedToPeers: false
};

// 🛰️ Network Logging
function netLog(msg, type = 'info') {
    const log = document.getElementById('networkLog');
    if (!log) return;
    const colors = { info: '#a5b4fc', success: '#10b981', warn: '#fbbf24', error: '#ef4444' };
    const entry = document.createElement('div');
    entry.style.color = colors[type] || '#fff';
    entry.style.fontSize = '10px';
    entry.style.marginBottom = '2px';
    entry.innerHTML = `<span style="opacity:0.5">[${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}]</span> ${msg}`;
    log.insertBefore(entry, log.firstChild);
    if (log.childNodes.length > 25) log.removeChild(log.lastChild);
}

// 🖥️ UI Elements
const ui = {
    login: document.getElementById('loginScreen'),
    lobby: document.getElementById('lobbyScreen'),
    game: document.getElementById('gameScreen'),
    playerName: document.getElementById('playerName'),
    roomKey: document.getElementById('roomKey'),
    newRoomKey: document.getElementById('newRoomKey'),
    roomDisplay: document.getElementById('roomKeyDisplay'),
    lobbyPlayers: document.getElementById('lobbyPlayers'),
    startGameBtn: document.getElementById('startGameButton'),
    turnDisplay: document.getElementById('currentTurnDisplay'),
    playersList: document.getElementById('playersListContainer'),
    dice: document.getElementById('diceDisplay'),
    rollBtn: document.getElementById('rollDiceButton'),
    shootBtn: document.getElementById('shootButton'),
    nextBtn: document.getElementById('nextTurnButton'),
    gameLog: document.getElementById('gameLog'),
    shootModal: document.getElementById('shootModal'),
    winnerModal: document.getElementById('winnerModal'),
    winnerName: document.getElementById('winnerName')
};

// 🔌 PeerJS Initialization
function initNetwork(onReady) {
    if (peer) return onReady();
    
    peer = new Peer(null, { debug: 1 });
    
    peer.on('open', (id) => {
        gameState.playerId = id.toString();
        netLog(`✔ Network Node Ready: ${id.substring(0,8)}`, 'success');
        updateStatusDot(true);
        if(onReady) onReady();
    });

    peer.on('connection', (conn) => {
        netLog(`📡 Incoming connection: ${conn.peer.substring(0,5)}...`);
        setupPeerEvents(conn);
    });

    peer.on('error', (err) => {
        netLog(`✖ Network Error: ${err.type}`, 'error');
        if (err.type === 'peer-unavailable') {
            netLog('Room host seems offline.', 'warn');
        }
    });
}

function setupPeerEvents(conn) {
    conn.on('open', () => {
        if (!connections.find(c => c.peer === conn.peer)) {
            connections.push(conn);
        }
        if (gameState.isRoomCreator) {
            netLog(`🔗 Client ${conn.peer.substring(0,5)} connected.`);
            syncStateToAll();
        }
    });

    conn.on('data', (data) => {
        processPacket(data, conn);
    });

    conn.on('close', () => {
        connections = connections.filter(c => c.peer !== conn.peer);
        netLog('✖ Peer connection closed', 'warn');
    });
}

// 📦 Packet Handling
function processPacket(packet, conn) {
    if (packet.type === 'join_request') {
        netLog(`👤 ${packet.name} is joining...`, 'success');
        addPlayer({
            id: packet.id,
            name: packet.name,
            joinedAt: Date.now(),
            isAlive: true,
            boxes: createDefaultBoxes(),
            mustShoot: false
        });
        syncStateToAll();
    } 
    else if (packet.type === 'sync_state') {
        gameState.players = packet.players;
        gameState.currentTurnId = packet.currentTurnId;
        
        if (packet.gameStarted && !gameState.gameStarted) {
            gameState.gameStarted = true;
            switchActiveScreen('game');
        }
        
        if (packet.winner) {
            triggerWinner(packet.winner);
        }

        refreshGameUI();
    }
    else if (packet.type === 'game_action') {
        netLog(`🎮 Received action: ${packet.action.type} from ${packet.action.byName}`);
        applyInGameAction(packet.action);
        
        // Host relays to all other clients
        if (gameState.isRoomCreator) {
            connections.forEach(c => {
                if (c.peer !== conn.peer) c.send(packet);
            });
            syncStateToAll(); // Confirm final state
        }
        refreshGameUI();
    }
}

// 🕹️ Game Logic
function createDefaultBoxes() {
    const boxes = {};
    ODD_NUMBERS.forEach(n => {
        boxes[n.toString()] = { stage: 0, bodyParts: 'Empty', bullets: 0, disabled: false };
    });
    return boxes;
}

function applyInGameAction(action) {
    const actor = gameState.players.find(p => p.id === action.by);
    if (!actor) return;

    if (action.type === 'roll') {
        const box = actor.boxes[action.num.toString()];
        if (!box || box.disabled) return;
        
        box.stage++;
        if (box.stage === 1) box.bodyParts = "Face";
        else if (box.stage === 2) box.bodyParts = "Full Body";
        else if (box.stage === 3) box.bullets = 1;
        else if (box.stage === 4) box.bullets = 2;
        else if (box.stage >= 5) { box.bullets = 3; actor.mustShoot = true; }
        
        // Always update dice display for a roll action
        ui.dice.textContent = action.num;
        addGameLog(action.msg);
    } 
    else if (action.type === 'shoot') {
        const target = gameState.players.find(p => p.id === action.targetId);
        if (target) {
            target.boxes[action.boxNum.toString()].disabled = true;
            actor.mustShoot = false;
            // Clear bullets from the active shooting box
            Object.values(actor.boxes).forEach(b => {
                if (b.bullets === 3) { b.bullets = 0; b.stage = 2; }
            });
            addGameLog(action.msg, true);
            
            if (Object.values(target.boxes).every(b => b.disabled)) {
                target.isAlive = false;
                addGameLog(`💀 ${target.name} ELIMINATED!`, true);
            }
        }
    } 
    else if (action.type === 'turn_end') {
        gameState.currentTurnId = action.nextId;
        addGameLog(`➡️ Turn passed to ${action.nextName}`);
    }
}

function addPlayer(p) {
    if (!gameState.players.find(pl => pl.id === p.id)) {
        gameState.players.push(p);
        gameState.players.sort((a,b) => a.joinedAt - b.joinedAt);
    }
}

// 📡 Broadcasting
function syncStateToAll(extra = {}) {
    if (!gameState.isRoomCreator) return;
    const packet = { 
        type: 'sync_state', 
        players: gameState.players, 
        currentTurnId: gameState.currentTurnId, 
        gameStarted: gameState.gameStarted,
        ...extra 
    };
    connections.forEach(c => c.send(packet));
}

function sendActionToPeers(action) {
    const packet = { type: 'game_action', action };
    if (gameState.isRoomCreator) {
        connections.forEach(c => c.send(packet));
    } else {
        // Send to host only
        connections[0].send(packet);
    }
}

// ⌨️ UI Event Handlers
document.getElementById('joinButton').onclick = () => joinGameRoom();
document.getElementById('createRoomButton').onclick = () => showCreateView();
document.getElementById('backButton').onclick = () => showJoinView();
document.getElementById('confirmCreateButton').onclick = () => startHostRoom();
document.getElementById('startGameButton').onclick = () => triggerGameBegin();
document.getElementById('rollDiceButton').onclick = () => executeRoll();
document.getElementById('shootButton').onclick = () => openShootMenu();
document.getElementById('closeShootModal').onclick = () => closeShootMenu();
document.getElementById('nextTurnButton').onclick = () => concludeTurn();
document.getElementById('newGameButton').onclick = () => location.reload();

function showCreateView() { document.getElementById('joinMode').style.display = 'none'; document.getElementById('createMode').style.display = 'block'; }
function showJoinView() { document.getElementById('createMode').style.display = 'none'; document.getElementById('joinMode').style.display = 'block'; }

function startHostRoom() {
    const name = ui.playerName.value.trim();
    const key = ui.newRoomKey.value.trim().toLowerCase();
    if (!name || !key) return alert('Name and Key required!');
    
    gameState.isRoomCreator = true;
    gameState.playerName = name;
    gameState.roomKey = key;
    
    initNetwork(() => {
        const me = { id: gameState.playerId, name, joinedAt: Date.now(), isAlive: true, boxes: createDefaultBoxes(), mustShoot: false };
        gameState.players = [me];
        switchActiveScreen('lobby');
        ui.roomDisplay.textContent = key;
        netLog(`Room [${key}] created. Host: ${name}`, 'success');
        updateLobbyUI();
        
        // Signal Presence
        const signaler = new Peer(`odd-roll-v2-${key}`, { debug: 1 });
        signaler.on('open', () => netLog('🌐 Room visible to public.', 'success'));
        signaler.on('connection', (c) => {
            c.on('open', () => {
                c.send({ type: 'host_id', id: gameState.playerId });
                setTimeout(() => signaler.destroy(), 1500);
            });
        });
        signaler.on('error', (e) => { if(e.type === 'unavailable-id') { alert("Key in use!"); location.reload(); }});
    });
}

function joinGameRoom() {
    const name = ui.playerName.value.trim();
    const key = ui.roomKey.value.trim().toLowerCase();
    if (!name || !key) return alert('Name and Key required!');

    gameState.playerName = name;
    gameState.roomKey = key;
    
    initNetwork(() => {
        netLog(`🔍 Scanning for room: ${key}...`);
        const tracker = peer.connect(`odd-roll-v2-${key}`);
        tracker.on('data', (m) => {
            if (m.type === 'host_id') {
                netLog('🚀 Target found! Establishing connection...', 'success');
                const hostConn = peer.connect(m.id);
                hostConn.on('open', () => {
                    setupPeerEvents(hostConn);
                    connections = [hostConn]; // Client only has one peer: Host
                    hostConn.send({ type: 'join_request', name, id: gameState.playerId });
                    switchActiveScreen('lobby');
                    ui.roomDisplay.textContent = key;
                });
            }
        });
        setTimeout(() => {
            if (!ui.lobby.classList.contains('active')) netLog('✖ Search timed out.', 'warn');
        }, 10000);
    });
}

function triggerGameBegin() {
    if (!gameState.isRoomCreator || gameState.players.length < 1) return;
    gameState.gameStarted = true;
    gameState.currentTurnId = gameState.players[0].id;
    switchActiveScreen('game');
    syncStateState();
    syncStateToAll();
}

function executeRoll() {
    if (gameState.currentTurnId !== gameState.playerId) return;
    const me = gameState.players.find(p => p.id === gameState.playerId);
    if (me.mustShoot) return alert("Must shoot first!");

    const rolled = ODD_NUMBERS[Math.floor(Math.random() * ODD_NUMBERS.length)];
    ui.rollBtn.disabled = true;
    ui.dice.textContent = '?';
    ui.dice.classList.add('rolling');
    
    setTimeout(() => {
        ui.dice.classList.remove('rolling');
        const action = { 
            type: 'roll', 
            num: rolled, 
            msg: `${gameState.playerName} rolled a ${rolled}`, 
            by: gameState.playerId,
            byName: gameState.playerName
        };
        applyInGameAction(action);
        sendActionToPeers(action);
        refreshGameUI();
    }, 800);
}

function concludeTurn() {
    const me = gameState.players.find(p => p.id === gameState.playerId);
    if (me.mustShoot) return alert("Must shoot first!");
    
    const alivePlayers = gameState.players.filter(p => p.isAlive);
    const myIdx = alivePlayers.findIndex(p => p.id === gameState.playerId);
    const nextPlayer = alivePlayers[(myIdx + 1) % alivePlayers.length];
    
    const action = { 
        type: 'turn_end', 
        nextId: nextPlayer.id, 
        nextName: nextPlayer.name,
        by: gameState.playerId,
        byName: gameState.playerName
    };
    
    applyInGameAction(action);
    sendActionToPeers(action);
    refreshGameUI();
}

function performActionShoot(targetId, num) {
    const target = gameState.players.find(p => p.id === targetId);
    if (!target) return;
    
    const action = { 
        type: 'shoot', 
        targetId, 
        boxNum: num, 
        msg: `🎯 ${gameState.playerName} shot ${target.name}'s box ${num}!`, 
        by: gameState.playerId,
        byName: gameState.playerName
    };
    
    applyInGameAction(action);
    sendActionToPeers(action);
    
    const alivePlayers = gameState.players.filter(p => p.isAlive);
    if (alivePlayers.length === 1) {
        if (gameState.isRoomCreator) syncStateToAll({ winner: alivePlayers[0] });
        triggerWinner(alivePlayers[0]);
    } else {
        if (gameState.isRoomCreator) syncStateToAll();
    }
    
    closeShootMenu();
    refreshGameUI();
}

// 🎨 UI Refreshing
function refreshGameUI() {
    updatePlayersBar();
    updateCommandCenter();
    updateGridStatus();
}

function updatePlayersBar() {
    ui.playersList.innerHTML = '';
    gameState.players.forEach(p => {
        const div = document.createElement('div');
        div.className = `player-item ${p.id === gameState.currentTurnId ? 'current-turn' : ''} ${!p.isAlive ? 'eliminated' : ''}`;
        let score = 0;
        Object.values(p.boxes).forEach(b => { 
            if(b.stage === 1) score += 1; 
            if(b.stage >= 2) score += 2; 
        });
        div.innerHTML = `<strong>${p.name}</strong><br><small>Health: ${score}/10</small>`;
        ui.playersList.appendChild(div);
    });
}

function updateCommandCenter() {
    const isMyTurn = gameState.currentTurnId === gameState.playerId;
    const me = gameState.players.find(p => p.id === gameState.playerId);
    
    ui.turnDisplay.textContent = isMyTurn ? "🎲 YOUR TURN!" : "Waiting...";
    ui.rollBtn.disabled = !isMyTurn || (me && me.mustShoot);
    ui.nextBtn.disabled = !isMyTurn || (me && me.mustShoot);
    ui.shootBtn.disabled = !isMyTurn || (me && !me.mustShoot);
}

function updateGridStatus() {
    const me = gameState.players.find(p => p.id === gameState.playerId);
    if (!me) return;
    
    Object.keys(me.boxes).forEach(numStr => {
        const box = me.boxes[numStr];
        const boxElem = document.querySelector(`.box[data-number="${numStr}"]`);
        const contentElem = document.getElementById(`box-${numStr}`);
        if (!boxElem || !contentElem) return;
        
        if (box.disabled) {
            boxElem.classList.add('disabled');
            contentElem.innerHTML = '<div style="color:#ef4444;font-weight:bold;text-align:center;margin-top:20px;">✖ DISABLED</div>';
        } else {
            boxElem.classList.remove('disabled');
            let html = `<div style="margin-bottom:10px;">Status: <strong>${box.bodyParts}</strong></div>`;
            if (box.bullets > 0) {
                html += `<div class="bullet-info">🔫 ${box.bullets} Bullets Loaded</div>`;
            }
            contentElem.innerHTML = html;
        }
    });
}

// 🛠️ General Helpers
function triggerWinner(w) { ui.winnerName.textContent = w.name; ui.winnerModal.classList.add('active'); }
function switchActiveScreen(s) { 
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active')); 
    if (ui[s]) ui[s].classList.add('active'); 
}
function updateStatusDot(c) { 
    const dot = document.getElementById('connectionStatus'); 
    if(dot) c ? dot.classList.add('active') : dot.classList.remove('active'); 
}
function addGameLog(msg, imp = false) {
    const entry = document.createElement('div');
    entry.className = `log-entry ${imp ? 'important' : ''}`;
    entry.innerHTML = `<small>${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</small> ${msg}`;
    ui.gameLog.insertBefore(entry, ui.gameLog.firstChild);
}
function updateLobbyUI() {
    ui.lobbyPlayers.innerHTML = '';
    gameState.players.forEach(p => {
        const div = document.createElement('div');
        div.className = 'lobby-player';
        div.textContent = `✅ ${p.name}`;
        ui.lobbyPlayers.appendChild(div);
    });
    if (gameState.isRoomCreator && gameState.players.length >= 2) ui.startGameBtn.disabled = false;
}
function openShootMenu() {
    ui.targetPlayersContainer.innerHTML = '';
    gameState.players.forEach(p => {
        if (p.id !== gameState.playerId && p.isAlive) {
            const div = document.createElement('div');
            div.className = 'target-player';
            div.textContent = p.name;
            div.onclick = () => {
                gameState.selectedTarget = p.id;
                ui.disableNumberContainer.style.display = 'block';
                document.querySelectorAll('.target-player').forEach(el => el.style.border = 'none');
                div.style.border = '2px solid #6366f1';
            };
            ui.targetPlayersContainer.appendChild(div);
        }
    });
    document.querySelectorAll('.btn-number').forEach(btn => btn.onclick = () => performActionShoot(gameState.selectedTarget, btn.dataset.num));
    ui.shootModal.classList.add('active');
}
function closeShootMenu() { ui.shootModal.classList.remove('active'); ui.disableNumberContainer.style.display = 'none'; }

netLog('🚀 System Ready.', 'info');
