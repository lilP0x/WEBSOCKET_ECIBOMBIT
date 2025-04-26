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
                board: game.board
            };
            console.log(games[game.gameId]);
            
            Object.keys(rooms[room].players).forEach((playerId) => {
                io.to(playerId).emit("gameStart", {
                    gameId: game.gameId,
                    players: game.players,
                    config: game.config,
                    board: game.board
                }); 
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
        console.log(`Jugador ${socket.id} (${username}) se unio al juego ${gameId}`);
        socket.emit("gameState", {
            gameId,
            board: game.board,
            players: game.players,
            config: game.config
        });

        return callback?.({ success: true });
    });

    //Mover players

    socket.on("move", ({ direction, playerId, xa ,ya , x, y,gameId }) => {
        const roomName = Object.keys(rooms).find(room =>
            Object.keys(rooms[room].players).includes(playerId)
        );
        if (!roomName || !gameId ) return;

        const game = games[gameId];
        const afterCell = game.board.cells.find(cell => cell.x === x && cell.y === y);
        const beforeCell = game.board.cells.find(cell => cell.x === xa && cell.y === ya);
        if (afterCell.type === 'EMPTY'){
            afterCell.playerId = playerId;
            afterCell.type ='PLAYER';
            beforeCell.playerId = null;
            beforeCell.type = 'EMPTY';
            // Reenvía el movimiento con coordenadas
            socket.to(roomName).emit("playerMoved", {
                playerId,
                direction,
                x,
                y,
            });
        } 
    });

    socket.on("bombPlaced", ({ playerId, x, y }) => {
        const roomName = Object.keys(rooms).find(room =>
            Object.keys(rooms[room].players).includes(playerId)
        );
        if (!roomName) return;
        // Reenvía posicion de la bomba con coordenadas
        socket.to(roomName).emit("bombPlaced", { x, y });
    });
    
    socket.on("bombExploded", ({ playerId, explosionTiles, gameId }) => {
        const roomName = Object.keys(rooms).find(room =>
            Object.keys(rooms[room].players).includes(playerId)
        );

        if (!roomName || !gameId) return;

        socket.to(roomName).emit("bombExplodedClient", { explosionTiles });
        
        
        const game = games[gameId];
        const player = game.players.find(p => p.id === playerId);

        if (!player || player.dead) return;

        let score = 0;
        
        for (const tile of explosionTiles) {
            const { x: xa, y: ya } = tile;
            const cell = game.board.cells.find(c => c.x === xa && c.y === ya);

            if (!cell) continue;

            // Si la celda es un bloque destruible
            if (cell.type === 'BLOCK') {
                score += 10;
                cell.type = 'EMPTY';
            }
        }

        // sumo puntaje
        player.score = (player.score || 0) + score;
        
        io.in(roomName).emit("players", game.players);
    });

    socket.on("playerKilled", ({ gameId, killerId, victimId }) =>{
        const roomName = Object.keys(rooms).find(room =>
            Object.keys(rooms[room].players).includes(killerId)
        );

        if (!roomName || !gameId) return;

        let score = 0;
        let kills = 0;
        const game = games[gameId];
        const player = game.players.find(p => p.id === killerId);
        const cell = game.board.cells.find(c => c.playerId === victimId);

        if (!cell) return;

        if (cell.playerId !== null) {

            cell.playerId = null;
            score += 25;
            kills += 1;
            eliminatedPlayer = game.players.find(p => p.id === victimId);

            if (eliminatedPlayer) {
                eliminatedPlayer.dead = true;
            }
        }
        // sumo puntaje
        player.score = (player.score || 0) + score;
        player.kills = (player.kills || 0) + kills;
        io.in(roomName).emit("players", game.players);
    });

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
            io.to(room).emit("updateLobby", serializeRoom(rooms[room])); // 🔥 Notificar cambios
        }
        callback({ success: true });
    });

    
    socket.on("disconnect", () => {
        
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