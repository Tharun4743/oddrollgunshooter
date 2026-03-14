// 🚀 PeerJS - Ultimate High-Protocol Engine v3 (Direct Discovery)
const ODD_NUMBERS = [1, 3, 5, 7, 9];
let peer = null;
let connections = []; 
let gameState = {
    playerId: null,
    playerName: null,
    roomKey: null,
    players: [],
    currentTurnId: null,
    isRoomCreator: false,
    gameStarted: false,
};

// 🛰️ Network Diagnostics
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
    if (log.childNodes.length > 30) log.removeChild(log.lastChild);
}

// 📦 UI Handles
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

// 🧠 Action Processors
function applyAction(action) {
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
        
        ui.dice.textContent = action.num;
        addLog(action.msg);
    } 
    else if (action.type === 'shoot') {
        const target = gameState.players.find(p => p.id === action.targetId);
        if (target) {
            target.boxes[action.boxNum.toString()].disabled = true;
            actor.mustShoot = false;
            Object.values(actor.boxes).forEach(b => {
                if (b.bullets === 3) { b.bullets = 0; b.stage = 2; }
            });
            addLog(action.msg, true);
            if (Object.values(target.boxes).every(b => b.disabled)) {
                target.isAlive = false;
                addLog(`💀 ${target.name} ELIMINATED!`, true);
            }
        }
    } 
    else if (action.type === 'next') {
        gameState.currentTurnId = action.nextId;
        addLog(`➡️ Turn: ${action.nextName}`);
    }
}

// 📡 Network Logic
function startHost() {
    const name = ui.playerName.value.trim();
    const key = ui.newRoomKey.value.trim().toLowerCase();
    if (!name || !key) return alert("Required: Name & Key");

    const hostPeerId = `oddroll-${key}-host`;
    peer = new Peer(hostPeerId, { debug: 1 });
    
    peer.on('open', (id) => {
        gameState.playerId = id;
        gameState.isRoomCreator = true;
        gameState.playerName = name;
        gameState.roomKey = key;
        
        const me = { id, name, isAlive: true, joinedAt: Date.now(), boxes: createBoxes(), mustShoot: false };
        gameState.players = [me];
        
        switchScreen('lobby');
        ui.roomDisplay.textContent = key;
        netLog(`✔ Room Live: ${key}`, 'success');
        updateLobby();
        updateStatusDot(true);
    });

    peer.on('connection', (conn) => {
        netLog(`📡 Player connecting...`);
        conn.on('open', () => {
            connections.push(conn);
            netLog(`🔗 Player ${conn.peer.substring(0,5)} connected.`);
            broadcastState();
        });
        conn.on('data', (data) => handlePacket(data, conn));
    });

    peer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
            alert("This Room Key is already active! Choose another.");
            location.reload();
        }
        netLog(`✖ Peer Error: ${err.type}`, 'error');
    });
}

function startJoin() {
    const name = ui.playerName.value.trim();
    const key = ui.roomKey.value.trim().toLowerCase();
    if (!name || !key) return alert("Required: Name & Key");

    peer = new Peer(null, { debug: 1 });
    
    peer.on('open', (id) => {
        gameState.playerId = id;
        gameState.playerName = name;
        gameState.roomKey = key;
        
        netLog(`🔍 Connecting to Host: ${key}...`);
        const hostId = `oddroll-${key}-host`;
        const conn = peer.connect(hostId);
        
        conn.on('open', () => {
            connections = [conn];
            netLog(`🚀 Connected to Room!`, 'success');
            conn.send({ type: 'join', name, id });
            switchScreen('lobby');
            ui.roomDisplay.textContent = key;
            updateStatusDot(true);
        });

        conn.on('data', (data) => handlePacket(data, conn));
        conn.on('error', (err) => netLog(`✖ Host connection failed.`, 'error'));
    });
}

function handlePacket(packet, conn) {
    if (packet.type === 'join') {
        netLog(`👤 ${packet.name} joined the lobby.`, 'success');
        if (!gameState.players.find(p => p.id === packet.id)) {
            gameState.players.push({ id: packet.id, name: packet.name, isAlive: true, joinedAt: Date.now(), boxes: createBoxes(), mustShoot: false });
            gameState.players.sort((a,b) => a.joinedAt - b.joinedAt);
        }
        broadcastState();
        updateLobby();
    } 
    else if (packet.type === 'sync') {
        gameState.players = packet.players;
        gameState.currentTurnId = packet.turn;
        if (packet.start && !gameState.gameStarted) {
            gameState.gameStarted = true;
            switchScreen('game');
        }
        if (packet.winner) showWin(packet.winner);
        refreshUI();
    }
    else if (packet.type === 'action') {
        applyAction(packet.action);
        if (gameState.isRoomCreator) {
            // Host relays to all EXCEPT sender
            connections.forEach(c => { if (c.peer !== conn.peer) c.send(packet); });
            broadcastState();
        }
        refreshUI();
    }
}

function broadcastState(extra = {}) {
    if (!gameState.isRoomCreator) return;
    const packet = { 
        type: 'sync', 
        players: gameState.players, 
        turn: gameState.currentTurnId, 
        start: gameState.gameStarted,
        ...extra 
    };
    connections.forEach(c => c.send(packet));
}

function sendAction(action) {
    const packet = { type: 'action', action };
    connections.forEach(c => c.send(packet));
}

// 🕹️ Actions
function executeRoll() {
    if (gameState.currentTurnId !== gameState.playerId) return;
    const rolled = ODD_NUMBERS[Math.floor(Math.random() * ODD_NUMBERS.length)];
    ui.dice.classList.add('rolling');
    setTimeout(() => {
        ui.dice.classList.remove('rolling');
        const action = { type: 'roll', num: rolled, by: gameState.playerId, byName: gameState.playerName, msg: `${gameState.playerName} rolled ${rolled}` };
        applyAction(action);
        sendAction(action);
        refreshUI();
    }, 600);
}

function executeShoot(targetId, num) {
    const target = gameState.players.find(p => p.id === targetId);
    const action = { type: 'shoot', targetId, boxNum: num, by: gameState.playerId, msg: `🔫 ${gameState.playerName} shot ${target.name}'s ${num}` };
    applyAction(action);
    sendAction(action);
    
    const alives = gameState.players.filter(p => p.isAlive);
    if (alives.length === 1 && gameState.isRoomCreator) {
        broadcastState({ winner: alives[0] });
        showWin(alives[0]);
    } else {
        if (gameState.isRoomCreator) broadcastState();
    }
    closeShoot();
    refreshUI();
}

function endTurn() {
    const alives = gameState.players.filter(p => p.isAlive);
    const idx = alives.findIndex(p => p.id === gameState.playerId);
    const next = alives[(idx + 1) % alives.length];
    const action = { type: 'next', nextId: next.id, nextName: next.name, by: gameState.playerId };
    applyAction(action);
    sendAction(action);
    refreshUI();
}

// 🎨 UI
function refreshUI() {
    ui.playersList.innerHTML = '';
    gameState.players.forEach(p => {
        const div = document.createElement('div');
        div.className = `player-item ${p.id === gameState.currentTurnId ? 'current-turn' : ''} ${!p.isAlive ? 'eliminated' : ''}`;
        let pts = 0; Object.values(p.boxes).forEach(b => { if(b.stage === 1) pts++; if(b.stage >= 2) pts+=2; });
        div.innerHTML = `<strong>${p.name}</strong><br>Health: ${pts}/10`;
        ui.playersList.appendChild(div);
    });

    const isMe = gameState.currentTurnId === gameState.playerId;
    const me = gameState.players.find(p => p.id === gameState.playerId);
    ui.turnDisplay.textContent = isMe ? "🎲 YOUR TURN!" : "Waiting...";
    ui.rollBtn.disabled = !isMe || me?.mustShoot;
    ui.nextBtn.disabled = !isMe || me?.mustShoot;
    ui.shootBtn.disabled = !isMe || !me?.mustShoot;

    if (me) {
        Object.keys(me.boxes).forEach(n => {
            const b = me.boxes[n];
            const el = document.getElementById(`box-${n}`);
            const parent = document.querySelector(`.box[data-number="${n}"]`);
            if (!el || !parent) return;
            if (b.disabled) { parent.classList.add('disabled'); el.innerHTML = "❌ DISABLED"; }
            else { parent.classList.remove('disabled'); el.innerHTML = `${b.bodyParts}${b.bullets > 0 ? `<div class="bullet-info">🔫 ${b.bullets} Bullets</div>` : ''}`; }
        });
    }
}

function updateLobby() {
    ui.lobbyPlayers.innerHTML = '';
    gameState.players.forEach(p => {
        const d = document.createElement('div'); d.className = 'lobby-player'; d.textContent = `✅ ${p.name}`;
        ui.lobbyPlayers.appendChild(d);
    });
    if (gameState.isRoomCreator && gameState.players.length >= 2) ui.startGameBtn.disabled = false;
}

function switchScreen(s) { document.querySelectorAll('.screen').forEach(e => e.classList.remove('active')); ui[s].classList.add('active'); }
function addLog(m, i) { const d = document.createElement('div'); d.className = `log-entry ${i?'important':''}`; d.innerHTML = `<small>${new Date().toLocaleTimeString()}</small> ${m}`; ui.gameLog.insertBefore(d, ui.gameLog.firstChild); }
function createBoxes() { const b = {}; ODD_NUMBERS.forEach(n => b[n.toString()] = { stage: 0, bodyParts: 'Empty', bullets: 0, disabled: false }); return b; }
function updateStatusDot(c) { const d = document.getElementById('connectionStatus'); if(d) c ? d.classList.add('active') : d.classList.remove('active'); }
function showWin(w) { ui.winnerName.textContent = w.name; ui.winnerModal.classList.add('active'); }
function closeShoot() { ui.shootModal.classList.remove('active'); document.getElementById('disableNumberContainer').style.display = 'none'; }
function openShoot() {
    ui.targetPlayersContainer.innerHTML = '';
    gameState.players.forEach(p => {
        if (p.id !== gameState.playerId && p.isAlive) {
            const d = document.createElement('div'); d.className = 'target-player'; d.textContent = p.name;
            d.onclick = () => { gameState.selectedTarget = p.id; document.getElementById('disableNumberContainer').style.display = 'block'; document.querySelectorAll('.target-player').forEach(e => e.style.border = 'none'); d.style.border = '2px solid #6366f1'; };
            ui.targetPlayersContainer.appendChild(d);
        }
    });
    document.querySelectorAll('.btn-number').forEach(b => b.onclick = () => executeShoot(gameState.selectedTarget, b.dataset.num));
    ui.shootAtOnce = true;
    ui.shootBtn.disabled = false;
    ui.shootModal.classList.add('active');
}

// ⌨️ Bindings
ui.rollBtn.onclick = executeRoll;
ui.nextBtn.onclick = endTurn;
ui.shootBtn.onclick = openShoot;
document.getElementById('startGameButton').onclick = () => { gameState.gameStarted = true; gameState.currentTurnId = gameState.players[0].id; switchScreen('game'); broadcastState(); };
document.getElementById('joinButton').onclick = startJoin;
document.getElementById('createRoomButton').onclick = () => { document.getElementById('joinMode').style.display = 'none'; document.getElementById('createMode').style.display = 'block'; };
document.getElementById('backButton').onclick = () => { document.getElementById('createMode').style.display = 'none'; document.getElementById('joinMode').style.display = 'block'; };
document.getElementById('confirmCreateButton').onclick = startHost;
document.getElementById('closeShootModal').onclick = closeShoot;
document.getElementById('newGameButton').onclick = () => location.reload();

netLog('🚀 Engine Live.');
