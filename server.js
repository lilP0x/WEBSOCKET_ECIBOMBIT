const axios = require("axios");
const { Server } = require("socket.io");
const io = new Server(3000, { cors: { origin: "*" } });

let rooms = {};

// Almacenamiento para todos los jugadores conectados
const players = {};

// Tamaño del tablero y los tiles - deben coincidir con el cliente
const GRID_SIZE = 50;

io.on("connection", (socket) => {
    console.log("Jugador conectado:", socket.id);

    socket.on("getRooms", () => {
        socket.emit("roomsList", Object.keys(rooms));
    });

    socket.on("joinRoom", (data, callback) => {
        const { room, username } = data;

        if (!rooms[room]) {
            rooms[room] = { 
                players: {}, 
                ready: {}, 
                characters: {},
                owner: socket.id,
                gameStarted: false,
                config: {
                    map: "default",
                    time: 5,
                    items: 3
                }
            };
        }
    
        io.emit("roomsList", Object.keys(rooms));
   
        if (rooms[room].gameStarted) {
            if (typeof callback === "function") {
                return callback({ success: false, message: "La partida ya ha comenzado." });
            }
            return;
        }
    
        if (Object.keys(rooms[room].players).length >= 4) {
            if (typeof callback === "function") {
                return callback({ success: false, message: "La sala está llena." });
            }
            return;
        }

        // Verificar si el usuario ya está en otra sala
        for (const roomName in rooms) {
            const players = rooms[roomName].players;
            for (const playerId in players) {
                if (players[playerId].username === username) {
                    return callback({
                        success: false,
                        message: "Ya estás en otra sala"
                    });
                }
            }
        }
    
        socket.join(room);
        rooms[room].players[socket.id] = {
            id: socket.id,
            username: username,
            score: 0,
            specialItems: [],
            bomb: 0
        };
        rooms[room].ready[socket.id] = false;
    
        console.log(`Jugador ${socket.id} (${username}) se unió a ${room}`);
        // IMPORTANTE: Devolver isOwner en el callback
        if (typeof callback === "function") {
            callback({
                success: true,
                isOwner: rooms[room].owner === socket.id,
                config: rooms[room].config
            });
        }

        io.to(room).emit("updateLobby", serializeRoom(rooms[room], socket.id));
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
        for (let room in rooms) {
            if (rooms[room].players[socket.id]) {
                const username = rooms[room].players[socket.id].username;
                console.log(`Jugador ${socket.id} (${username}) se desconectó de la sala ${room}`);

                if (rooms[room].owner === socket.id) {
                    // Si el owner se desconecta, se cierra la sala y se expulsa a todos
                    io.to(room).emit("roomClosed", {
                        message: "El dueño de la sala se desconectó, sala cerrada.",
                    });
                    delete rooms[room];
                    io.emit("roomsList", Object.keys(rooms));
                    return;
                }

                // Si es un jugador normal, solo lo sacamos
                delete rooms[room].players[socket.id];
                delete rooms[room].ready[socket.id];
                delete rooms[room].characters[socket.id];

                io.to(room).emit("updateLobby", serializeRoom(rooms[room]));
                break;
            }
        }
    });

    // Enviar jugadores existentes al nuevo jugador inmediatamente
    socket.emit('players', players);

    // Manejar nuevo jugador que se une
    socket.on('newPlayer', (playerData) => {
        console.log(`Registrando nuevo jugador: ${socket.id}`);
        players[socket.id] = {
            id: socket.id,
            x: playerData.x,
            y: playerData.y,
            health: playerData.health || 100
        };

        // Enviar lista actualizada de jugadores a todos los clientes
        io.emit('players', players);
    });


    // Manejar movimiento del jugador
    socket.on('move', (moveData) => {
        if (players[socket.id]) {
            // Actualizar la posición del jugador en nuestro registro del servidor
            players[socket.id].x = moveData.x;
            players[socket.id].y = moveData.y;
            
            // Actualizar la salud si se proporciona
            if (moveData.health !== undefined) {
                players[socket.id].health = moveData.health;
            }

            // Enviar la posición actualizada a todos los demás clientes
            socket.broadcast.emit('playerMoved', {
                id: socket.id,
                x: moveData.x,
                y: moveData.y,
                health: players[socket.id].health
            });
        }
    });

    // Cosa que hace aparecer bombas
    socket.on('addBomb', (bombData) => {
        if (players[socket.id]) {
            // Enviar la posición de la bomba a todos los demás clientes
            socket.broadcast.emit('addBomb', {
                id: socket.id,
                x: bombData.x,
                y: bombData.y,
                tileX: bombData.tileX,
                tileY: bombData.tileY
            });
        }
    });

    // Manejar explosión de bomba y daño a jugadores
    socket.on('bombExploded', ({ id, tileX, tileY }) => {
        console.log(`Bomba de ${id} explotó en (${tileX}, ${tileY})`);
        
        // Determinar qué jugadores son afectados por la explosión
        const playersHit = [];
        const explosionRange = 1; // La bomba afecta a las casillas adyacentes
        
        // Verificar si algún jugador está en el rango de la explosión
        Object.entries(players).forEach(([playerId, playerData]) => {
            // Convertir posición de píxeles a coordenadas de casilla
            const playerTileX = Math.floor(playerData.x / GRID_SIZE);
            const playerTileY = Math.floor(playerData.y / GRID_SIZE);
            
            // Verificar si el jugador está en el rango de la explosión (centro o adyacentes)
            if ((Math.abs(playerTileX - tileX) <= explosionRange && playerTileY === tileY) || 
                (Math.abs(playerTileY - tileY) <= explosionRange && playerTileX === tileX)) {
                
                // Añadir a la lista de jugadores afectados
                playersHit.push(playerId);
                
                // Reducir la salud del jugador
                if (players[playerId]) {
                    players[playerId].health -= 25; // Restar 25 de salud
                    
                    // Asegurarse de que la salud no sea negativa
                    if (players[playerId].health < 0) {
                        players[playerId].health = 0;
                    }
                    
                    // Enviar actualización de salud a todos los clientes
                    io.emit('playerHealthUpdate', {
                        id: playerId,
                        health: players[playerId].health
                    });
                    
                    // Si el jugador muere
                    if (players[playerId].health <= 0) {
                        io.emit('playerDied', { id: playerId });
                    }
                }
            }
        });
        
        // Broadcast the explosion to all clients with list of affected players
        io.emit('bombExploded', { 
          id, 
          tileX, 
          tileY,
          playersHit 
        });
    });
    
    // Manejar actualización de salud
    socket.on('updateHealth', ({ id, health }) => {
        if (players[id]) {
            players[id].health = health;
            io.emit('playerHealthUpdate', { id, health });
        }
    });
    
    // Manejar cuando un jugador muere
    socket.on('playerDied', ({ id }) => {
        if (players[id]) {
            players[id].health = 0;
            io.emit('playerDied', { id });
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