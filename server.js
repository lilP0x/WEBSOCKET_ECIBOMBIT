const axios = require("axios");
const { Server } = require("socket.io");
const io = new Server(3000, { cors: { origin: "*" } });

let rooms = {};
let games = {};

io.on("connection", (socket) => {

    socket.on("getRooms", () => {
        socket.emit("roomsList", Object.keys(rooms));
    });

    socket.on("createRoom", (data, callback) => {
        const { roomName, username } = data;
        console.log(roomName);

        const isUsernameTaken = Object.values(rooms).some(room => {
            return Object.values(room.players).some(player => {
                return player.username === username;
            });
        });

        if (isUsernameTaken) {
            return callback?.({
                success: false,
                message: "Este usuario ya está en una sala. No puede crear una nueva."
            });
        }

        if (rooms[roomName]) {
            return callback?.({
                success: false,
                message: "La sala ya existe."
            });
        }

        rooms[roomName] = {
            players: {},
            ready: {},
            characters: {},
            owner: null, // sin owner inicialmente
            gameStarted: false,
            config: {
                map: "default",
                time: 5,
                items: 3
            }
        };

        console.log(`Sala ${roomName} creada.`);

        callback?.({
            success: true,
            message: "Sala creada correctamente."
        });

        io.emit("roomsList", Object.keys(rooms));
    });

    socket.on("joinRoom", (data, callback) => {
        const { room, username } = data;

        const sala = rooms[room];
        if (!sala) {
            return callback?.({ success: false, message: "La sala no existe." });
        }

        // Comprobar si ya está en otra sala con ese username
        for (const r in rooms) {
            const players = rooms[r].players;
            for (const playerId in players) {
                if (players[playerId].username === username) {
                    return callback?.({
                        success: false,
                        message: "Ya estás en otra sala."
                    });
                }
            }
        }

        if (sala.gameStarted) {
            return callback?.({ success: false, message: "La partida ya comenzó." });
        }

        if (Object.keys(sala.players).length >= 4) {
            return callback?.({ success: false, message: "La sala está llena." });
        }

        socket.join(room);

        sala.players[socket.id] = {
            id: socket.id,
            username: username,
            score: 0,
            specialItems: [],
            bomb: 0
        };

        sala.ready[socket.id] = false;

        if (!sala.owner) {
            sala.owner = socket.id;
        }

        console.log(`Jugador ${socket.id} (${username}) se unió a ${room}`);

        callback?.({
            success: true,
            isOwner: sala.owner === socket.id,
            config: sala.config
        });

        io.emit("roomsList", Object.keys(rooms));
        io.to(room).emit("updateLobby", serializeRoom(sala, socket.id));
    });

    socket.on("setReady", ({ room, isReady }, callback) => {
        if (!rooms[room]) return callback({ success: false, message: "Sala no existe" });

        rooms[room].ready[socket.id] = isReady;

        io.to(room).emit("updateLobby", {
            players: rooms[room].players,
            characters: rooms[room].characters,
            ready: rooms[room].ready,
            config: rooms[room].config
        });

        callback({ success: true });
    });

    socket.on("setRoomConfig", ({ room, map, time, items }, callback) => {
        if (!rooms[room]) return;

        if (socket.id !== rooms[room].owner) {
            if (typeof callback === "function") {
                return callback({ success: false, message: "Solo el creador puede cambiar la configuración." });
            }
            return;
        }

        // Aplicar cambios si los valores son válidos
        if (map !== undefined) rooms[room].config.map = map;
        if (time !== undefined) rooms[room].config.time = time;
        if (items !== undefined) rooms[room].config.items = items;

        io.to(room).emit("updateLobby", serializeRoom(rooms[room]));

        if (typeof callback === "function") {
            callback({ success: true, config: rooms[room].config }); // Enviar la config actualizada
        }
    });

    socket.on("startGame", async ({ room, players, config }, callback) => {
        if (!rooms[room]) {
            return callback?.({ success: false, message: "Sala no encontrada." });
        }

        if (socket.id !== rooms[room].owner) {
            return callback?.({ success: false, message: "Solo el creador puede iniciar la partida." });
        }

        const readyPlayers = Object.values(rooms[room].ready).filter(r => r).length;

        if (!rooms[room].ready[rooms[room].owner]) {
            return callback?.({ success: false, message: "El creador también debe estar listo para iniciar la partida." });
        }

        if (readyPlayers < 2) {
            return callback?.({ success: false, message: "Se necesitan al menos 2 jugadores listos." });
        }

        try {
            const response = await axios.post("http://localhost:8080/games/create", {
                roomId: room,
                config,
                players
            });

            const game = response.data;

            // Marcar juego iniciado
            rooms[room].gameStarted = true;

            games[game.gameId] = {
                room,
                players: game.players,
                config: game.config,
                board: game.board,
                connectedPlayers:0
            };

            // Notificar a todos los clientes LISTOS
            Object.keys(rooms[room].players).forEach((playerId) => {
                if (rooms[room].ready[playerId]) {
                    io.to(playerId).emit("gameStart", {
                        gameId: game.gameId,
                        players: game.players,
                        config: game.config,
                        board: game.board
                    });
                } else {
                    // Redirigir a pantalla de opciones
                    io.to(playerId).emit("redirect", { to: "/options" });
                }
            });
            return callback?.({ success: true });

        } catch (err) {
            console.error("Error iniciando juego:", err);
            return callback?.({ success: false, message: "Error iniciando juego." });
        }
    });

    socket.on("connectToGame", ({ gameId, username }, callback) => {
        const game = games[gameId];
        if (!game) {
            return callback?.({ success: false, message: "Juego no encontrado." });
        }

        const player = Object.values(game.players).find(p => p.username === username);

        if (!player) {
            return callback?.({ success: false, message: "No estás registrado en este juego." });
        }

        socket.join(game.room);
        player.socketId = socket.id;

        game.connectedPlayers = (game.connectedPlayers || 0) + 1;

        if (game.connectedPlayers === game.players.length) {
            let countdown = 3;
        
            // Initial countdown
            io.in(game.room).emit("startTimerGame", { countdown });
        
            const countdownInterval = setInterval(() => {
                countdown--;
                if (countdown > 0) {
                    io.in(game.room).emit("startTimerGame", { countdown });
                } else {
                    clearInterval(countdownInterval);
                    io.in(game.room).emit("startGame");
        
                    // Game duration timer
                    game.timeLeft = game.config.time * 60;
        
                    io.in(game.room).emit("gameTimerTick", {  timeLeft: game.timeLeft});
        
                    game.timerInterval = setInterval(() => {
                        game.timeLeft--;
                        
                        if (game.timeLeft > 0) {
                            io.in(game.room).emit("gameTimerTick", { timeLeft: game.timeLeft });
                        } else {
                            clearInterval(game.timerInterval);
                            game.timerInterval = null;
                    
                            io.in(game.room).emit("gameTimerTick", { timeLeft: 0 });
                    
                            checkForWinner(game);
                        }
                    }, 1000);
                }
            }, 1000);
        }


        console.log(`Jugador ${socket.id} (${username}) se unio al juego ${gameId}`);


        return callback?.({ success: true });
    });


    socket.on("move", ({ direction, playerId, xa, ya, x, y, gameId }) => {
        const game = games[gameId];
        if (!game) return;

        const afterCell = game.board.cells.find(cell => cell.x === x && cell.y === y);
        const beforeCell = game.board.cells.find(cell => cell.x === xa && cell.y === ya);

        if (afterCell && afterCell.type === 'EMPTY') {
            afterCell.playerId = playerId;
            afterCell.type = 'PLAYER';

            if (beforeCell) {
                beforeCell.playerId = null;
                beforeCell.type = 'EMPTY';
            }

            socket.to(game.room).emit("playerMoved", {
                playerId,
                direction,
                x,
                y,
            });
        }
    });

    socket.on("bombPlaced", ({ playerId, x, y, gameId }) => {
        const game = games[gameId];
        if (!game) return;

        socket.to(game.room).emit("bombPlaced", { x, y });
    });

    socket.on("bombExploded", ({ playerId, explosionTiles, gameId }) => {
        const game = games[gameId];
        if (!game) return;

        socket.to(game.room).emit("bombExplodedClient", { explosionTiles });

        const player = game.players.find(p => p.id === playerId);
        if (!player || player.dead) return;

        let score = 0;

        for (const tile of explosionTiles) {
            const { x: xa, y: ya } = tile;
            const cell = game.board.cells.find(c => c.x === xa && c.y === ya);

            if (!cell) continue;

            if (cell.type === 'BLOCK') {
                score += 10;
                cell.type = 'EMPTY';
            }
        }

        player.score = (player.score || 0) + score;
        checkForWinner(game);
        io.in(game.room).emit("players", game.players);
    });

    socket.on("playerKilled", ({ gameId, killerId, victimId, playerId, x, y }) => {
        const game = games[gameId];
        if (!game) return;
        //socket.to(game.room).emit("reportKill", { killerId, victimId, playerId });
        const cell = game.board.cells.find(c => c.x === x && c.y === y);

        if (cell && cell.playerId === victimId) {
            cell.playerId = null;
            cell.type = 'EMPTY';
        }

        const eliminatedPlayer = game.players.find(p => p.id === victimId);
        if (eliminatedPlayer) {
            const previouslyAlive = game.players.filter(p => !p.dead).length;
            eliminatedPlayer.dead = true;
            const currentlyAlive = game.players.filter(p => !p.dead).length;
            const simultaneousDeath = previouslyAlive === 2 && currentlyAlive === 0;
            checkForWinner(game, simultaneousDeath);
        }

        const killerPlayer = game.players.find(p => p.id === killerId);

        io.in(game.room).emit("playerDied", {
            victimId,
            killerId,
            victimUsername: eliminatedPlayer?.username,
            killerUsername: killerPlayer?.username,
            suicide: killerId === victimId
        });

        //Aqui AGREGAMOS la condicion para que no aumente score ni kills al matarse a si mismo
        if (killerPlayer && killerId !== victimId) {
            killerPlayer.score = (killerPlayer.score || 0) + 25;
            killerPlayer.kills = (killerPlayer.kills || 0) + 1;
        }

        //No estamos borrando al jugador del game.players, sino que estamos solamente cambiando su estado a dead=true
        io.in(game.room).emit("players", game.players); // Actualizamos barra lateral
    });

    function checkForWinner(game, simultaneousDeath = false) {

        const alivePlayers = game.players.filter(p => !p.dead);

        if (alivePlayers.length === 0) {
            if (game.timerInterval) {
                clearInterval(game.timerInterval);
                game.timerInterval = null;
            }

            io.in(game.room).emit("gameOver", {
                winner: null,
                reason: simultaneousDeath
                    ? "Todos los jugadores vivos murieron al mismo tiempo."
                    : "Todos los jugadores han sido eliminados."
            });

            return true;
        }
    
        if (alivePlayers.length === 1) {
            // Solo queda uno vivo
            if (game.timerInterval) {
                clearInterval(game.timerInterval);
                game.timerInterval = null;
            }

            console.log(alivePlayers.map(p => p.id));
            io.in(game.room).emit("gameOver", {
                winners: alivePlayers.map(p => p.id),
                winnerUserNames: alivePlayers.map(p => p.username),
                reason: "Último jugador con vida."
                
            });
            return true;
        }
    
        if (game.timeLeft === 0) {
            const topScore = Math.max(...alivePlayers.map(p => p.score || 0));
            const topPlayers = alivePlayers.filter(p => (p.score || 0) === topScore);

            const isTie = topPlayers.length > 1;
            console.log(topPlayers.map(p => p.id));
            io.in(game.room).emit("gameOver", {
                winners: topPlayers.map(p => p.id),
                winnerUsernames: topPlayers.map(p => p.username),
                reason: isTie
                    ? "Empate entre jugadores con el mayor puntaje."
                    : "Mayor puntaje al finalizar el tiempo."
            });
            return true;
        }
    
        return false;
    }
    

    socket.on("selectCharacter", ({ room, character }) => {
        if (rooms[room]) {
            rooms[room].characters[socket.id] = character;
            io.to(room).emit("updateLobby", serializeRoom(rooms[room]));
        }
    });

    socket.on("leaveRoom", ({ room }, callback) => {
        if (!rooms[room]) return callback({ success: false, message: "Sala no existe" });

        const username = rooms[room].players[socket.id]?.username || "Usuario desconocido";
        console.log(`Jugador ${socket.id} (${username}) salió de la sala ${room}`);

        if (rooms[room].owner === socket.id) {
            // Si el owner se va, se cierra la sala y se expulsa a todos
            io.to(room).emit("roomClosed", {
                message: "El dueño de la sala salió, sala cerrada.",
            });
            delete rooms[room]; // Se borra la sala
            console.log(`Sala ${room} eliminada porque el Owner se fue.`);
            io.emit("roomsList", Object.keys(rooms)); // Notificar a todos que la sala ya no existe
        } else {
            // Si no es el owner, simplemente lo eliminamos de la sala
            delete rooms[room].players[socket.id];
            delete rooms[room].ready[socket.id];
            delete rooms[room].characters[socket.id];
            io.to(room).emit("updateLobby", serializeRoom(rooms[room]));
        }
        callback({ success: true });
    });

    socket.on("leaveGame", ({ gameId, playerId, x, y }, callback) => {
        const game = games[gameId];
        if (!game) return callback?.({ success: false });

        const cell = game.board.cells.find(c => c.x === x && c.y === y);
        if (cell && cell.playerId === playerId) {
            cell.playerId = null;
            cell.type = 'EMPTY';
        }

        const player = game.players.find(p => p.id === playerId);
        if (player) {
            player.dead = true;
        }

        // Notificar al resto
        io.in(game.room).emit("players", game.players);
        io.in(game.room).emit("playerLeft", { playerId }); // útil si quieres animación futura

        // También limpiar de la sala si sigue registrada
        const roomId = game.room;
        const room = rooms[roomId];
        if (room) {
            delete room.players[playerId];
            delete room.ready[playerId];
            delete room.characters[playerId];
            io.emit("roomsList", Object.keys(rooms));
        }

        callback?.({ success: true });
    });

    socket.on("disconnect", () => {
        // Remover de cualquier juego
        for (const gameId in games) {
            const game = games[gameId];
            const player = game.players.find(p => p.socketId === socket.id);
            if (player && !player.dead) {
                console.log(`Desconexión detectada. Eliminando ${socket.id} del juego ${gameId}`);
                player.dead = true;
                const playerId = player.id;
                const cell = game.board.cells.find(c => c.playerId === player.id);
                if (cell) {
                    cell.playerId = null;
                    cell.type = 'EMPTY';
                }
                io.to(game.room).emit("players", game.players);
                io.in(game.room).emit("playerLeft", { playerId });
            }
        }

        // Remover de cualquier sala (no activa)
        for (const roomName in rooms) {
            const room = rooms[roomName];
            if (room.players[socket.id]) {
                delete room.players[socket.id];
                delete room.ready[socket.id];
                delete room.characters[socket.id];
                if (room.owner === socket.id) {
                    io.to(roomName).emit("roomClosed", { message: "El dueño de la sala salió." });
                    delete rooms[roomName];
                    io.emit("roomsList", Object.keys(rooms));
                } else {
                    io.to(roomName).emit("updateLobby", serializeRoom(room));
                }
            }
        }
    });
});

function serializeRoom(room, socketId) {
    const { timer, ...roomData } = room;
    return {
        ...roomData,
        isOwner: room.owner === socketId,
    };
}

console.log("Servidor WebSocket de Bomberman corriendo en el puerto 3000");