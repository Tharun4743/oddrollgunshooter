const socket = io();

let gameState = {
    playerId: null,
    playerName: null,
    roomKey: null,
    players: [],
    currentPlayer: null,
    myState: null,
    canShoot: false,
    selectedTarget: null,
    isRoomCreator: false
};

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

joinButton.addEventListener('click', joinRoom);
createRoomButton.addEventListener('click', showCreateMode);
backButton.addEventListener('click', showJoinMode);
confirmCreateButton.addEventListener('click', createRoom);
startGameButton.addEventListener('click', startGame);
rollDiceButton.addEventListener('click', rollDice);
shootButton.addEventListener('click', showShootModal);
closeShootModal.addEventListener('click', hideShootModal);
nextTurnButton.addEventListener('click', nextTurn);
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
    const playerName = playerNameInput.value.trim();
    const roomKey = roomKeyInput.value.trim();

    if (!playerName || !roomKey) {
        alert('Please enter your name and room key!');
        return;
    }

    gameState.playerName = playerName;
    gameState.isRoomCreator = false;

    socket.emit('joinRoom', {
        playerName: playerName,
        roomKey: roomKey,
        maxPlayers: 4
    });
}

function createRoom() {
    const playerName = playerNameInput.value.trim();
    const roomKey = newRoomKeyInput.value.trim();
    const maxPlayers = parseInt(maxPlayersInput.value);

    if (!playerName || !roomKey) {
        alert('Please enter your name and room key!');
        return;
    }

    gameState.playerName = playerName;
    gameState.isRoomCreator = true;

    socket.emit('joinRoom', {
        playerName: playerName,
        roomKey: roomKey,
        maxPlayers: maxPlayers
    });
}

socket.on('joinSuccess', (data) => {
    gameState.playerId = data.playerId;
    gameState.roomKey = data.roomKey;
    gameState.players = data.players;

    roomKeyDisplay.textContent = data.roomKey;
    updateLobbyPlayers(data.players);

    switchScreen('lobby');
    addLog('Successfully joined the game!');
});

socket.on('joinFailed', (data) => {
    alert(data.message);
});

socket.on('playerJoined', (data) => {
    gameState.players = data.players;
    updateLobbyPlayers(data.players);
    addLog(`Player joined! Total players: ${data.players.length}`);
});

socket.on('playerLeft', (data) => {
    gameState.players = data.players;
    updatePlayersList(data.players);
    addLog('A player left the game');
});

socket.on('gameStarted', (data) => {
    gameState.currentPlayer = data.currentPlayer;
    gameState.players = data.players;

    switchScreen('game');
    updatePlayersList(data.players);
    updateCurrentTurn();
    addLog('🎮 Game Started!', true);
});

socket.on('diceRolled', (data) => {
    diceDisplay.classList.add('rolling');

    setTimeout(() => {
        diceDisplay.textContent = data.rolledNumber;
        diceDisplay.classList.remove('rolling');

        if (data.result.success) {
            rollResult.innerHTML = `<strong>${data.playerName}</strong> rolled <strong>${data.rolledNumber}</strong><br>${data.result.message}`;

            if (data.playerId === gameState.playerId) {
                gameState.myState = data.currentPlayerState;
                updateMyBoxes();

                if (data.result.canShoot) {
                    gameState.canShoot = true;
                    shootButton.disabled = false;
                    addLog('🔫 You can now SHOOT!', true);
                }

                nextTurnButton.disabled = false;
            }
        } else {
            rollResult.innerHTML = `<strong style="color: #ef4444;">${data.playerName}</strong> rolled <strong>${data.rolledNumber}</strong><br>${data.result.message}`;
        }

        addLog(`${data.playerName} rolled ${data.rolledNumber}: ${data.result.message}`);
    }, 500);
});

socket.on('turnChanged', (data) => {
    gameState.currentPlayer = data.currentPlayer;
    gameState.players = data.players;
    gameState.canShoot = false;

    updatePlayersList(data.players);
    updateCurrentTurn();

    rollResult.innerHTML = '';
    diceDisplay.textContent = '?';

    addLog(`It's now ${data.currentPlayer.name}'s turn`, true);
});

socket.on('playerShot', (data) => {
    addLog(`🔫 ${data.message}`, true);

    if (data.targetId === gameState.playerId) {
        socket.emit('getGameState');
    }

    gameState.players = data.updatedPlayers;
    updatePlayersList(data.updatedPlayers);
});

socket.on('gameOver', (data) => {
    winnerName.textContent = `${data.winner.name} Wins!`;
    winnerModal.classList.add('active');
    addLog(`🏆 ${data.winner.name} wins the game!`, true);
});

socket.on('gameState', (data) => {
    gameState.myState = data.myState;
    gameState.players = data.players;
    gameState.currentPlayer = data.currentPlayer;

    updateMyBoxes();
    updatePlayersList(data.players);
});

socket.on('notYourTurn', (data) => {
    alert(data.message);
});

function startGame() {
    if (!gameState.isRoomCreator) {
        alert('Only the room creator can start the game!');
        return;
    }
    socket.emit('startGame');
}

function rollDice() {
    rollDiceButton.disabled = true;
    socket.emit('rollDice');
}

function nextTurn() {
    nextTurnButton.disabled = true;
    shootButton.disabled = true;
    gameState.canShoot = false;
    socket.emit('nextTurn');
}

function showShootModal() {
    if (!gameState.canShoot) {
        alert('You need 3 bullets to shoot!');
        return;
    }

    targetPlayersContainer.innerHTML = '';
    gameState.players.forEach(player => {
        if (player.id !== gameState.playerId && player.isAlive) {
            const targetDiv = document.createElement('div');
            targetDiv.className = 'target-player';
            targetDiv.textContent = player.name;
            targetDiv.onclick = () => selectTarget(player.id);
            targetPlayersContainer.appendChild(targetDiv);
        }
    });

    shootModal.classList.add('active');
}

function hideShootModal() {
    shootModal.classList.remove('active');
    disableNumberContainer.style.display = 'none';
    gameState.selectedTarget = null;
}

function selectTarget(targetId) {
    gameState.selectedTarget = targetId;
    disableNumberContainer.style.display = 'block';

    document.querySelectorAll('.btn-number').forEach(btn => {
        btn.onclick = () => {
            const disableNum = parseInt(btn.dataset.num);
            shootPlayer(targetId, disableNum);
        };
    });
}

function shootPlayer(targetId, disableNumber) {
    socket.emit('shootPlayer', {
        targetId: targetId,
        disableNumber: disableNumber
    });

    hideShootModal();
    gameState.canShoot = false;
    shootButton.disabled = true;
}

function updateLobbyPlayers(players) {
    lobbyPlayers.innerHTML = '';
    players.forEach(player => {
        const playerDiv = document.createElement('div');
        playerDiv.className = 'lobby-player';
        playerDiv.textContent = `✓ ${player.name}`;
        lobbyPlayers.appendChild(playerDiv);
    });

    if (players.length >= 2 && gameState.isRoomCreator) {
        startGameButton.disabled = false;
    }
}

function updatePlayersList(players) {
    playersListContainer.innerHTML = '';
    players.forEach(player => {
        const playerDiv = document.createElement('div');
        playerDiv.className = 'player-item';

        if (gameState.currentPlayer && player.id === gameState.currentPlayer.id) {
            playerDiv.classList.add('current-turn');
        }

        if (!player.isAlive) {
            playerDiv.classList.add('eliminated');
        }

        playerDiv.innerHTML = `
            <strong>${player.name}</strong>
            <br>Body Parts: ${player.totalBodyParts}
        `;

        playersListContainer.appendChild(playerDiv);
    });
}

function updateCurrentTurn() {
    if (gameState.currentPlayer) {
        const isMyTurn = gameState.currentPlayer.id === gameState.playerId;
        currentTurnDisplay.textContent = isMyTurn 
            ? "🎲 YOUR TURN!" 
            : `${gameState.currentPlayer.name}'s Turn`;

        rollDiceButton.disabled = !isMyTurn;

        if (isMyTurn) {
            currentTurnDisplay.style.color = '#10b981';
        } else {
            currentTurnDisplay.style.color = '#f59e0b';
        }
    }
}

function updateMyBoxes() {
    if (!gameState.myState) return;

    const boxes = gameState.myState.boxes;

    [1, 3, 5, 7, 9].forEach(num => {
        const box = boxes[num];
        const boxElement = document.querySelector(`.box[data-number="${num}"]`);
        const contentElement = document.getElementById(`box-${num}`);

        if (box.disabled) {
            boxElement.classList.add('disabled');
            contentElement.innerHTML = '<div style="color: #ef4444; font-weight: bold; text-align: center;">❌ DISABLED</div>';
        } else {
            boxElement.classList.remove('disabled');

            let content = '';

            // Emojis for parts for visual game effect
            box.bodyParts.forEach(part => {
                if (part === "Face") content += `<div class="body-part">😀 Face</div>`;
                else if (part === "Full Body") content += `<div class="body-part">🧍 Full Body</div>`;
                else content += `<div class="body-part">${part}</div>`;
            });

            if (box.bullets > 0) {
                let gunVisual = Array(box.bullets).fill("🔫").join(" ");
                content += `<div class="bullet-info">${gunVisual} ${box.bullets} Bullet${box.bullets > 1 ? 's' : ''}</div>`;
            }

            contentElement.innerHTML = content || '<div style="text-align: center; opacity: 0.5;">Empty</div>';
        }
    });
}

function switchScreen(screen) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));

    if (screen === 'login') {
        loginScreen.classList.add('active');
    } else if (screen === 'lobby') {
        lobbyScreen.classList.add('active');
    } else if (screen === 'game') {
        gameScreen.classList.add('active');
    }
}

function addLog(message, important = false) {
    const logEntry = document.createElement('div');
    logEntry.className = 'log-entry';
    if (important) logEntry.classList.add('important');

    const timestamp = new Date().toLocaleTimeString();
    logEntry.innerHTML = `<small>${timestamp}</small><br>${message}`;

    gameLog.insertBefore(logEntry, gameLog.firstChild);

    while (gameLog.children.length > 50) {
        gameLog.removeChild(gameLog.lastChild);
    }
}

switchScreen('login');
