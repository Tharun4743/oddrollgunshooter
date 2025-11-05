const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);

app.use(express.static("public"));

const gameRooms = new Map();
const ODD_NUMBERS = [1, 3, 5, 7, 9];

class GameRoom {
    constructor(roomKey, maxPlayers) {
        this.roomKey = roomKey;
        this.maxPlayers = maxPlayers || 4;
        this.players = new Map();
        this.currentTurnIndex = 0;
        this.gameStarted = false;
        this.winner = null;
    }

    addPlayer(socketId, playerName) {
        if (this.players.size >= this.maxPlayers) return false;
        this.players.set(socketId, {
            id: socketId,
            name: playerName,
            boxes: {
                1: { stage: 0, bodyParts: [], bullets: 0, disabled: false },
                3: { stage: 0, bodyParts: [], bullets: 0, disabled: false },
                5: { stage: 0, bodyParts: [], bullets: 0, disabled: false },
                7: { stage: 0, bodyParts: [], bullets: 0, disabled: false },
                9: { stage: 0, bodyParts: [], bullets: 0, disabled: false }
            },
            isAlive: true,
            totalBodyParts: 0,
            mustShoot: false
        });
        return true;
    }

    removePlayer(socketId) {
        this.players.delete(socketId);
    }

    getPlayersList() {
        return Array.from(this.players.values()).map(p => ({
            id: p.id,
            name: p.name,
            isAlive: p.isAlive,
            totalBodyParts: p.totalBodyParts
        }));
    }

    getCurrentPlayer() {
        const playerArray = Array.from(this.players.values()).filter(p => p.isAlive);
        if (playerArray.length === 0) return null;
        return playerArray[this.currentTurnIndex % playerArray.length];
    }

    processRoll(socketId, rolledNumber) {
        const player = this.players.get(socketId);
        if (!player || !player.isAlive) return null;

        const box = player.boxes[rolledNumber];

        if (box.disabled) {
            return {
                success: false,
                message: `Box ${rolledNumber} is disabled! No action taken.`,
                box
            };
        }

        if (player.mustShoot) {
            return {
                success: false,
                message: `You MUST shoot before you can roll again!`,
                box
            };
        }

        box.stage++;

        let result = {
            success: true,
            message: '',
            box,
            canShoot: false
        };

        if (box.stage === 1) {
            if (!box.bodyParts.includes('Face')) {
                box.bodyParts.push('Face');
                player.totalBodyParts++;
                result.message = `Face appeared in box ${rolledNumber}!`;
            } else {
                result.message = `Face already present in box ${rolledNumber}.`;
            }
        } else if (box.stage === 2) {
            if (!box.bodyParts.includes('Full Body')) {
                box.bodyParts.push('Full Body');
                player.totalBodyParts++;
                result.message = `Full Body appeared in box ${rolledNumber}!`;
            } else {
                result.message = `Full Body already revealed in box ${rolledNumber}.`;
            }
        } else if (box.stage === 3) {
            box.bullets = 1;
            result.message = `Gun with 1 bullet received in box ${rolledNumber}!`;
        } else if (box.stage === 4) {
            box.bullets = 2;
            result.message = `Gun upgraded to 2 bullets in box ${rolledNumber}!`;
        } else if (box.stage >= 5) {
            box.bullets = 3;
            player.mustShoot = true;
            result.canShoot = true;
            result.message = `Gun fully loaded with 3 bullets in box ${rolledNumber}! You MUST SHOOT before ending your turn!`;
        }

        return result;
    }

    shootPlayer(shooterId, targetId, disableNumber) {
        const shooter = this.players.get(shooterId);
        const target = this.players.get(targetId);

        if (!shooter || !target || !target.isAlive) {
            return { success: false, message: 'Invalid target!' };
        }

        // Find shooter's box with 3 bullets and zero it out
        let shotBox = null;
        for (const num of ODD_NUMBERS) {
            if (shooter.boxes[num].bullets === 3) {
                shotBox = shooter.boxes[num];
                break;
            }
        }
        if (shotBox) shotBox.bullets = 0;
        shooter.mustShoot = false;

        target.boxes[disableNumber].disabled = true;

        return {
            success: true,
            message: `${target.name}'s box ${disableNumber} has been disabled!`,
            targetName: target.name,
            disabledBox: disableNumber
        };
    }

    nextTurn(socketId) {
        const player = this.players.get(socketId);
        if (!player) return null;
        if (player.mustShoot) {
            return { error: 'You MUST shoot before ending your turn!' };
        }
        const alivePlayers = Array.from(this.players.values()).filter(p => p.isAlive);
        if (alivePlayers.length <= 1) {
            this.winner = alivePlayers[0];
            return null;
        }
        this.currentTurnIndex++;
        return this.getCurrentPlayer();
    }

    checkWinner() {
        const alivePlayers = Array.from(this.players.values()).filter(p => p.isAlive);
        if (alivePlayers.length === 1) {
            this.winner = alivePlayers[0];
            return this.winner;
        }
        return null;
    }
}

io.on('connection', (socket) => {
    socket.on('joinRoom', ({ roomKey, playerName, maxPlayers }) => {
        let room = gameRooms.get(roomKey);
        if (!room) {
            room = new GameRoom(roomKey, maxPlayers || 4);
            gameRooms.set(roomKey, room);
        }
        const joined = room.addPlayer(socket.id, playerName);
        if (joined) {
            socket.join(roomKey);
            socket.roomKey = roomKey;
            io.to(roomKey).emit('playerJoined', {
                players: room.getPlayersList(),
                currentPlayer: room.getCurrentPlayer()
            });
            socket.emit('joinSuccess', {
                roomKey: roomKey,
                playerId: socket.id,
                players: room.getPlayersList()
            });
        } else {
            socket.emit('joinFailed', { message: 'Room is full!' });
        }
    });

    socket.on('startGame', () => {
        const room = gameRooms.get(socket.roomKey);
        if (room && room.players.size >= 2) {
            room.gameStarted = true;
            io.to(socket.roomKey).emit('gameStarted', {
                currentPlayer: room.getCurrentPlayer(),
                players: room.getPlayersList()
            });
        }
    });

    socket.on('rollDice', () => {
        const room = gameRooms.get(socket.roomKey);
        if (!room || !room.gameStarted) return;
        const currentPlayer = room.getCurrentPlayer();
        if (!currentPlayer || currentPlayer.id !== socket.id) {
            socket.emit('notYourTurn', { message: "It's not your turn!" });
            return;
        }
        if (currentPlayer.mustShoot) {
            socket.emit('notYourTurn', { message: "You MUST shoot before rolling again!" });
            return;
        }
        const rolledNumber = ODD_NUMBERS[Math.floor(Math.random() * ODD_NUMBERS.length)];
        const result = room.processRoll(socket.id, rolledNumber);
        io.to(socket.roomKey).emit('diceRolled', {
            playerId: socket.id,
            playerName: currentPlayer.name,
            rolledNumber: rolledNumber,
            result: result,
            currentPlayerState: room.players.get(socket.id)
        });
    });

    socket.on('shootPlayer', ({ targetId, disableNumber }) => {
        const room = gameRooms.get(socket.roomKey);
        if (!room || !room.gameStarted) return;
        const shooter = room.players.get(socket.id);
        if (!shooter.mustShoot) {
            socket.emit('notYourTurn', { message: "You don't have 3 bullets loaded right now!" });
            return;
        }
        const result = room.shootPlayer(socket.id, targetId, disableNumber);
        if (result.success) {
            io.to(socket.roomKey).emit('playerShot', {
                shooterId: socket.id,
                targetId: targetId,
                disabledBox: disableNumber,
                message: result.message,
                updatedPlayers: room.getPlayersList()
            });
            const winner = room.checkWinner();
            if (winner) {
                io.to(socket.roomKey).emit('gameOver', {
                    winner: winner
                });
            }
        }
    });

    socket.on('nextTurn', () => {
        const room = gameRooms.get(socket.roomKey);
        if (!room) return;
        const player = room.players.get(socket.id);
        if (player && player.mustShoot) {
            socket.emit('notYourTurn', { message: "You MUST shoot before ending your turn!" });
            return;
        }
        const nextPlayer = room.nextTurn(socket.id);
        if (nextPlayer && !nextPlayer.error) {
            io.to(socket.roomKey).emit('turnChanged', {
                currentPlayer: nextPlayer,
                players: room.getPlayersList()
            });
        } else if (nextPlayer && nextPlayer.error) {
            socket.emit('notYourTurn', { message: nextPlayer.error });
        } else {
            io.to(socket.roomKey).emit('gameOver', {
                winner: room.winner
            });
        }
    });

    socket.on('getGameState', () => {
        const room = gameRooms.get(socket.roomKey);
        if (!room) return;
        socket.emit('gameState', {
            players: room.getPlayersList(),
            currentPlayer: room.getCurrentPlayer(),
            myState: room.players.get(socket.id)
        });
    });

    socket.on('disconnect', () => {
        if (socket.roomKey) {
            const room = gameRooms.get(socket.roomKey);
            if (room) {
                room.removePlayer(socket.id);
                if (room.players.size === 0) {
                    gameRooms.delete(socket.roomKey);
                } else {
                    io.to(socket.roomKey).emit('playerLeft', {
                        players: room.getPlayersList(),
                        currentPlayer: room.getCurrentPlayer()
                    });
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`🎲 Odd Roll Showdown server running on port ${PORT}`);
});
