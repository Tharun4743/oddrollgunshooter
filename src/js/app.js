// 🚀 PeerJS - High-Protocol Sync Engine v4 (MASTER)
const ODD_NUMBERS = [1, 3, 5, 7, 9];
let peer = null;
let connections = []; 
let gameState = {
    playerId: null, playerName: null, roomKey: null,
    players: [], currentTurnId: null,
    isRoomCreator: false, gameStarted: false,
};

// 🛰️ Diagnostics
function netLog(msg, type = 'info') {
    const log = document.getElementById('networkLog');
    if (!log) return;
    const colors = { info: '#a5b4fc', success: '#10b981', warn: '#fbbf24', error: '#ef4444' };
    const entry = document.createElement('div');
    entry.style.color = colors[type] || '#fff';
    entry.style.fontSize = '10px';
    entry.innerHTML = `<span style="opacity:0.4">[${new Date().toLocaleTimeString([], {hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'})}]</span> ${msg}`;
    log.insertBefore(entry, log.firstChild);
    if (log.childNodes.length > 30) log.removeChild(log.lastChild);
}

// 📦 UI Cache
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
    winnerName: document.getElementById('winnerName'),
    targetList: document.getElementById('targetPlayersContainer'),
    numPad: document.getElementById('disableNumberContainer')
};

// ⚙️ Core Logic
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
            Object.values(actor.boxes).forEach(b => { if (b.bullets === 3) { b.bullets = 0; b.stage = 2; }});
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

// 🌐 Network
function initHost() {
    const name = ui.playerName.value.trim();
    const key = ui.newRoomKey.value.trim().toLowerCase();
    if (!name || !key) return alert("Required: Name & Key");

    peer = new Peer(`oddroll-${key}-host`, { debug: 1 });
    peer.on('open', (id) => {
        gameState.playerId = id; gameState.playerName = name; gameState.roomKey = key; gameState.isRoomCreator = true;
        gameState.players = [{ id, name, isAlive: true, joinedAt: Date.now(), boxes: genBoxes(), mustShoot: false }];
        updateLobby(); switchView('lobby'); ui.roomDisplay.textContent = key;
        netLog(`✔ Room Live: ${key}`, 'success');
        dot(true);
    });
    peer.on('connection', (c) => {
        c.on('open', () => { connections.push(c); netLog(`🔗 Player joined.`); bcast(); });
        c.on('data', (d) => handlePacket(d, c));
        c.on('close', () => { connections = connections.filter(x => x.peer !== c.peer); netLog('✖ Player left.', 'warn'); });
    });
    peer.on('error', (e) => { if(e.type==='unavailable-id') { alert("Room active!"); location.reload(); }});
}

function initJoin() {
    const name = ui.playerName.value.trim();
    const key = ui.roomKey.value.trim().toLowerCase();
    if (!name || !key) return alert("Required: Name & Key");

    peer = new Peer(null, { debug: 1 });
    peer.on('open', (id) => {
        gameState.playerId = id; gameState.playerName = name; gameState.roomKey = key;
        netLog(`🔍 Connecting to ${key}...`);
        const c = peer.connect(`oddroll-${key}-host`);
        c.on('open', () => {
            connections = [c]; netLog(`🚀 Connected!`, 'success');
            c.send({ type: 'join', name, id });
            switchView('lobby'); ui.roomDisplay.textContent = key; dot(true);
        });
        c.on('data', (d) => handlePacket(d, c));
        c.on('error', () => netLog(`✖ Failed.`, 'error'));
    });
}

function handlePacket(p, c) {
    if (p.type === 'join') {
        if (!gameState.players.find(x => x.id === p.id)) {
            gameState.players.push({ id: p.id, name: p.name, isAlive: true, joinedAt: Date.now(), boxes: genBoxes(), mustShoot: false });
            gameState.players.sort((a,b) => a.joinedAt - b.joinedAt);
        }
        bcast(); updateLobby();
    } else if (p.type === 'sync') {
        gameState.players = p.players; gameState.currentTurnId = p.turn;
        if (p.start && !gameState.gameStarted) { gameState.gameStarted = true; switchView('game'); }
        if (p.winner) showWin(p.winner);
        refresh();
    } else if (p.type === 'action') {
        applyAction(p.action);
        if (gameState.isRoomCreator) { connections.forEach(x => { if (x.peer !== c.peer) x.send(p); }); bcast(); }
        refresh();
    }
}

function bcast(extra = {}) {
    if (!gameState.isRoomCreator) return;
    const p = { type: 'sync', players: gameState.players, turn: gameState.currentTurnId, start: gameState.gameStarted, ...extra };
    connections.forEach(c => c.send(p));
}

function sendAct(action) { connections.forEach(c => c.send({ type: 'action', action })); }

// 🎬 Interface
function refresh() {
    ui.playersList.innerHTML = '';
    gameState.players.forEach(p => {
        const d = document.createElement('div');
        d.className = `player-item ${p.id === gameState.currentTurnId ? 'current-turn' : ''} ${!p.isAlive ? 'eliminated' : ''}`;
        let pts = 0; Object.values(p.boxes).forEach(b => { if(b.stage === 1) pts++; if(b.stage >= 2) pts+=2; });
        
        let grid = `<div class="mini-boxes-grid">`;
        ODD_NUMBERS.forEach(n => {
            const b = p.boxes[n.toString()];
            let cls = 'mini-box'; let icon = n;
            if (b.disabled) { cls += ' disabled'; icon = '✖'; }
            else if (b.bullets > 0) { cls += ' has-bullets'; icon = '🔫'; }
            else if (b.stage === 1) { cls += ' stage-1'; }
            else if (b.stage >= 2) { cls += ' stage-2'; }
            grid += `<div class="${cls}" title="Box ${n}">${icon}</div>`;
        });
        grid += `</div>`;
        
        d.innerHTML = `<strong>${p.name}</strong><br>Health: ${pts}/10${grid}`;
        ui.playersList.appendChild(d);
    });
    const isMe = (gameState.currentTurnId === gameState.playerId);
    const me = gameState.players.find(p => p.id === gameState.playerId);
    ui.turnDisplay.textContent = isMe ? "🎲 YOUR TURN!" : "Waiting...";
    ui.rollBtn.disabled = !isMe || me?.mustShoot;
    ui.nextBtn.disabled = !isMe || me?.mustShoot;
    ui.shootBtn.disabled = !isMe || !me?.mustShoot;
    if (me) {
        Object.keys(me.boxes).forEach(n => {
            const b = me.boxes[n]; const el = document.getElementById(`box-${n}`); const p = document.querySelector(`.box[data-number="${n}"]`);
            if (b.disabled) { p.classList.add('disabled'); el.innerHTML = "❌ DISABLED"; }
            else { p.classList.remove('disabled'); el.innerHTML = `${b.bodyParts}${b.bullets > 0 ? `<div class="bullet-info">🔫 ${b.bullets} Bullets</div>` : ''}`; }
        });
    }
}

function updateLobby() {
    ui.lobbyPlayers.innerHTML = '';
    gameState.players.forEach(p => { const d = document.createElement('div'); d.className = 'lobby-player'; d.textContent = `✅ ${p.name}`; ui.lobbyPlayers.appendChild(d); });
    if (gameState.isRoomCreator && gameState.players.length >= 2) ui.startGameBtn.disabled = false;
}

// 🖱️ Interaction
ui.rollBtn.onclick = () => {
    if (gameState.currentTurnId !== gameState.playerId) return;
    const rolled = ODD_NUMBERS[Math.floor(Math.random() * ODD_NUMBERS.length)];
    ui.dice.classList.add('rolling');
    setTimeout(() => {
        ui.dice.classList.remove('rolling');
        const act = { type: 'roll', num: rolled, by: gameState.playerId, msg: `${gameState.playerName} rolled ${rolled}` };
        applyAction(act); sendAct(act); refresh();
    }, 600);
};

ui.nextBtn.onclick = () => {
    const alives = gameState.players.filter(p => p.isAlive);
    const idx = alives.findIndex(p => p.id === gameState.playerId);
    const nxt = alives[(idx + 1) % alives.length];
    const act = { type: 'next', nextId: nxt.id, nextName: nxt.name, by: gameState.playerId };
    applyAction(act); sendAct(act); refresh();
};

ui.shootBtn.onclick = () => {
    ui.targetList.innerHTML = '';
    gameState.players.forEach(p => {
        if (p.id !== gameState.playerId && p.isAlive) {
            const d = document.createElement('div'); d.className = 'target-player'; d.textContent = p.name;
            d.onclick = () => { gameState.selectedTarget = p.id; ui.numPad.style.display = 'block'; document.querySelectorAll('.target-player').forEach(e => e.style.border = 'none'); d.style.border = '2px solid #6366f1'; };
            ui.targetList.appendChild(d);
        }
    });
    document.querySelectorAll('.btn-number').forEach(b => b.onclick = () => {
        const target = gameState.players.find(x => x.id === gameState.selectedTarget);
        const act = { type: 'shoot', targetId: target.id, boxNum: b.dataset.num, by: gameState.playerId, msg: `🔫 ${gameState.playerName} shot ${target.name}'s ${b.dataset.num}` };
        applyAction(act); sendAct(act);
        const a = gameState.players.filter(x => x.isAlive);
        if (a.length === 1 && gameState.isRoomCreator) { bcast({ winner: a[0] }); showWin(a[0]); }
        else if (gameState.isRoomCreator) bcast();
        ui.shootModal.classList.remove('active'); ui.numPad.style.display = 'none'; refresh();
    });
    ui.shootModal.classList.add('active');
};

ui.startGameBtn.onclick = () => {
    gameState.gameStarted = true; gameState.currentTurnId = gameState.players[0].id;
    switchView('game'); refresh(); bcast(); 
};

// 🏁 Init
document.getElementById('joinButton').onclick = initJoin;
document.getElementById('confirmCreateButton').onclick = initHost;
document.getElementById('createRoomButton').onclick = () => { document.getElementById('joinMode').style.display = 'none'; document.getElementById('createMode').style.display = 'block'; };
document.getElementById('backButton').onclick = () => { document.getElementById('createMode').style.display = 'none'; document.getElementById('joinMode').style.display = 'block'; };
document.getElementById('closeShootModal').onclick = () => { ui.shootModal.classList.remove('active'); ui.numPad.style.display = 'none'; };
document.getElementById('newGameButton').onclick = () => location.reload();

function switchView(s) { document.querySelectorAll('.screen').forEach(e => e.classList.remove('active')); ui[s].classList.add('active'); }
function addLog(m, i) { const d = document.createElement('div'); d.className = `log-entry ${i?'important':''}`; d.innerHTML = `<small>${new Date().toLocaleTimeString()}</small> ${m}`; ui.gameLog.insertBefore(d, ui.gameLog.firstChild); }
function genBoxes() { const b = {}; ODD_NUMBERS.forEach(n => b[n.toString()] = { stage: 0, bodyParts: 'Empty', bullets: 0, disabled: false }); return b; }
function dot(c) { const d = document.getElementById('connectionStatus'); if(d) c ? d.classList.add('active') : d.classList.remove('active'); }
function showWin(w) { ui.winnerName.textContent = w.name; ui.winnerModal.classList.add('active'); }
// 🚀 Functions for HTML
window.manualReconnect = () => location.reload();

netLog('🚀 Engine Live.');
