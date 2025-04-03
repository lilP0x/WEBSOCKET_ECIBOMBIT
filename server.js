const { Server } = require("socket.io");

const io = new Server(3000, { cors: { origin: "*" } });

let rooms = {};

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
                owner: socket.id, //El primer jugador en crear la sala es el dueño
                gameStarted: false,
                config: {
                    map: "default", //Mapa por defecto
                    time: 5,      //Tiempo por defecto (minutos)
                    items: 3      //Ítems por defecto
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
            if (rooms[roomName].players[socket.id]) {
                return callback({
                    success: false,
                    message: "Ya estás en otra sala"
                });
            }
        }
    
        socket.join(room);
        rooms[room].players[socket.id] = {
            id: socket.id,
            username: username
        };
        rooms[room].ready[socket.id] = false;
    
        console.log(`Jugador ${socket.id} (${username}) se unió a ${room}`);
        // IMPORTANTE: Devolver isOwner en el callback
        if (typeof callback === "function") {
            callback({
                success: true,
                isOwner: rooms[room].owner === socket.id, // Verifica si el usuario es el dueño
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

    //server.js - Nueva funcionalidad: Configuración de la sala
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

    socket.on("startGame", (room, callback) => {
        if (!rooms[room]) return;

        if (socket.id !== rooms[room].owner) {
            if (typeof callback === "function") {
                return callback({ success: false, message: "Solo el creador puede iniciar la partida." });
            }
            return;
        }

        //Verificamos que al menos 2 jugadores estén listos
        const readyPlayers = Object.values(rooms[room].ready).filter(r => r).length;
        if (readyPlayers < 2) {
            if (typeof callback === "function") {
                return callback({ success: false, message: "Se necesitan al menos 2 jugadores listos para iniciar." });
            }
            return;
        }

        //Iniciar el juego
        rooms[room].gameStarted = true;
        const players = Object.keys(rooms[room].players).map(playerId => ({
            id: playerId,
            username: rooms[room].players[playerId].username,
            character: rooms[room].characters[playerId] || "/assets/default.png",
            score: 0,
            bombs: 1,
            lasers: 0,
            hammers: 0
        }));

        console.log(`Juego iniciado en sala ${room} con jugadores:`, players.map(p => p.username).join(', '));
        io.to(room).emit("gameStart", {
            players,
            config: rooms[room].config
        });

        if (typeof callback === "function") {
            callback({ success: true });
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

        // Eliminar jugador de la sala
        delete rooms[room].players[socket.id];
        delete rooms[room].ready[socket.id];
        delete rooms[room].characters[socket.id];

        // Transferir ownership si era el creador
        if (rooms[room].owner === socket.id) {
            const remainingPlayers = Object.keys(rooms[room].players);
            if (remainingPlayers.length > 0) {
                rooms[room].owner = remainingPlayers[0];
                console.log(`Nuevo creador de la sala ${room}: ${rooms[room].owner}`);
            } else {
                // Eliminar sala si queda vacía
                delete rooms[room];
                console.log(`Sala ${room} eliminada por falta de jugadores`);
                io.emit("roomsList", Object.keys(rooms)); // Notificar que la sala ya no existe
                return callback({ success: true });
            }
        }

        io.to(room).emit("updateLobby", serializeRoom(rooms[room]));
        callback({ success: true });
    });

    socket.on("disconnect", () => {
        for (let room in rooms) {
            if (rooms[room].players[socket.id]) {
                const username = rooms[room].players[socket.id].username;
                console.log(`Jugador ${socket.id} (${username}) se desconectó de la sala ${room}`);

                delete rooms[room].players[socket.id];
                delete rooms[room].ready[socket.id];
                delete rooms[room].characters[socket.id];

                // Si el creador se va, delegamos el rol a otro jugador
                if (rooms[room].owner === socket.id) {
                    const remainingPlayers = Object.keys(rooms[room].players);
                    if (remainingPlayers.length > 0) {
                        rooms[room].owner = remainingPlayers[0]; //Nuevo creador
                        console.log(`Nuevo creador de la sala ${room}: ${rooms[room].owner}`);
                    } else {
                        delete rooms[room]; //La sala se borra si queda vacía
                        console.log(`Sala ${room} eliminada por falta de jugadores`);
                        break;
                    }
                }

                io.to(room).emit("updateLobby", serializeRoom(rooms[room]));
                break;
            }
        }
    });

});

function serializeRoom(room, socketId) {
    const { timer, ...roomData } = room;
    return {
        ...roomData,
        isOwner: room.owner === socketId, // Determinar si el usuario es el dueño de la sala
    };
}

console.log("Servidor WebSocket de Bomberman corriendo en el puerto 3000");