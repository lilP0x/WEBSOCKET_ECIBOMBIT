const { Server } = require("socket.io");

const io = new Server(3000, { cors: { origin: "*" } });

let rooms = {};
const playerRooms = {}; // Mapeo de socket.id a sala
const usernameToSocketMap = {}; // Nuevo: Para rastrear nombres de usuario

io.on("connection", (socket) => {
    console.log("Jugador conectado:", socket.id);

    socket.on("getRooms", () => {
        socket.emit("roomsList", Object.keys(rooms).filter(r => !rooms[r].gameStarted));
    });

    

    socket.on("joinRoom", (data, callback) => { 
        const { room, username } = data;
        
        // Validación 0: Nombre de usuario vacío
        if (!username || username.trim() === "") {
            if (typeof callback === "function") {
                return callback({ 
                    success: false, 
                    message: "❌ El nombre de usuario no puede estar vacío." 
                });
            }
            return;
        }

        // Validación 1: Verificar si el nombre de usuario ya está en uso en cualquier sala
        if (usernameToSocketMap[username] && usernameToSocketMap[username] !== socket.id) {
            if (typeof callback === "function") {
                return callback({ 
                    success: false, 
                    message: "❌ Ya estás en otra sala. Debes salir primero." 
                });
            }
            return;
        }


        // Si la sala no existe, se crea
        if (!rooms[room]) {
            rooms[room] = { 
                players: {}, 
                ready: {}, 
                characters: {}, 
                timer: null,
                gameStarted: false,
                usernames: new Set() // Nuevo: Para nombres de usuario únicos por sala
            };
        }

    
        // Validación 4: ¿El juego ya comenzó?
        if (rooms[room].gameStarted) {
            if (typeof callback === "function") {
                return callback({ 
                    success: false, 
                    message: "❌ La partida ya comenzó. No puedes unirte." 
                });
            }
            return;
        }
    
        // Validación 5: ¿La sala está llena (4/4)?
        if (Object.keys(rooms[room].players).length >= 4) {
            if (typeof callback === "function") {
                return callback({ 
                    success: false, 
                    message: "❌ La sala está llena (4/4 jugadores)." 
                });
            }
            return;
        }
    
        // Si pasa todas las validaciones, lo agregamos a la sala
        socket.join(room);
        playerRooms[socket.id] = room;
        usernameToSocketMap[username] = socket.id; // Registrar nombre de usuario
        rooms[room].usernames.add(username); // Agregar a conjunto de nombres de sala
        
        rooms[room].players[socket.id] = { 
            id: socket.id,
            x: 0, 
            y: 0,
            username: username 
        };
        rooms[room].ready[socket.id] = false;
    
        console.log(`Jugador ${socket.id} (${username}) se unió a ${room}`);
        
        // Actualizar lista de salas para todos
        io.emit("roomsList", Object.keys(rooms).filter(r => !rooms[r].gameStarted));
        // Actualizar lobby para los jugadores de la sala
        io.to(room).emit("updateLobby", serializeRoom(rooms[room]));
    
        // Iniciamos temporizador solo si no hay uno activo
        if (!rooms[room].timer) {
            console.log(`⏳ Temporizador iniciado para la sala ${room} (120 segundos)...`);
            rooms[room].timer = setTimeout(() => {
                const playerCount = Object.keys(rooms[room]?.players || {}).length;
                
                if (!rooms[room]?.gameStarted) {
                    if (playerCount >= 2) {
                        console.log(`⌛ Tiempo agotado en ${room}. Iniciando juego...`);
                        startGame(room);
                    } else {
                        console.log(`⌛ Tiempo agotado en ${room}. No hay suficientes jugadores (${playerCount}).`);
                        io.to(room).emit("timeExpired", "No hay suficientes jugadores. Sala cerrada.");
                        cleanupRoom(room);
                    }
                }
            }, 1200000); 
        }
    
        // Respuesta exitosa al cliente
        if (typeof callback === "function") {
            callback({ 
                success: true,
                message: `✅ Te uniste a **${room}**. Esperando jugadores...` 
            });
        }
    });

    socket.on("leaveRoom", (room, callback) => {
        if (rooms[room] && rooms[room].players[socket.id]) {
            const username = rooms[room].players[socket.id].username;
            
            // Eliminar al jugador de la sala
            delete rooms[room].players[socket.id];
            delete rooms[room].ready[socket.id];
            delete rooms[room].characters[socket.id];
            delete playerRooms[socket.id];
            
            // Eliminar el mapeo de nombre de usuario
            if (usernameToSocketMap[username] === socket.id) {
                delete usernameToSocketMap[username];
            }
            
            // Eliminar de los nombres de la sala
            if (rooms[room].usernames) {
                rooms[room].usernames.delete(username);
            }
    
            console.log(`Jugador ${socket.id} (${username}) abandonó la sala ${room}`);
            
            // Notificar a los demás jugadores
            io.to(room).emit("updateLobby", serializeRoom(rooms[room]));
            
            // Verificar si la sala debe eliminarse
            const playerCount = Object.keys(rooms[room].players).length;
            if (playerCount === 0) {
                cleanupRoom(room);
            }
            
            // Dejar la sala
            socket.leave(room);
            
            if (typeof callback === "function") {
                callback({ success: true });
            }
        } else {
            if (typeof callback === "function") {
                callback({ success: false, message: "No estabas en esta sala" });
            }
        }
    });
    
    socket.on("disconnect", () => {
        const room = playerRooms[socket.id];
        if (room && rooms[room]) {
            const username = rooms[room].players[socket.id]?.username;
            console.log(`Jugador ${socket.id} (${username}) se desconectó de la sala ${room}`);
            
            // Limpiar registros del usuario
            if (username) {
                delete usernameToSocketMap[username];
                rooms[room].usernames.delete(username);
            }
            
            delete rooms[room].players[socket.id];
            delete rooms[room].ready[socket.id];
            delete rooms[room].characters[socket.id];
            delete playerRooms[socket.id];

            // Notificar a los demás jugadores
            io.to(room).emit("updateLobby", serializeRoom(rooms[room]));

            // Verificar si la sala debe eliminarse
            const playerCount = Object.keys(rooms[room].players).length;
            if (playerCount === 0) {
                cleanupRoom(room);
            } else if (playerCount < 2 && rooms[room].gameStarted) {
                io.to(room).emit("gameTerminated", "La partida terminó porque otros jugadores abandonaron.");
                cleanupRoom(room);
            }
        }
        socket.emit("roomsList", Object.keys(rooms).filter(r => !rooms[r].gameStarted));
    });

    

    function cleanupRoom(room) {
        if (rooms[room]) {
            clearTimeout(rooms[room].timer);
            
            // Limpiar todos los nombres de usuario de esta sala
            rooms[room].usernames.forEach(username => {
                delete usernameToSocketMap[username];
            });
            
            // Notificar a los jugadores antes de eliminarla
            if (Object.keys(rooms[room].players).length > 0) {
                io.to(room).emit("redirectToLobby", "La sala ha sido cerrada.");
                
                // Limpiar el registro de los jugadores
                Object.keys(rooms[room].players).forEach(playerId => {
                    delete playerRooms[playerId];
                });
            }
            
            delete rooms[room];
            console.log(`Sala ${room} eliminada`);
        }
    }

    socket.on("setReady", (room) => {
        if (rooms[room]) {
            rooms[room].ready[socket.id] = true;
            io.to(room).emit("updateLobby", serializeRoom(rooms[room]));

            if (Object.values(rooms[room].ready).every((r) => r)) {
                startGame(room);
            }
        }
    });

    socket.on("selectCharacter", ({ room, character }) => {
        if (rooms[room]) {
            rooms[room].characters[socket.id] = character;
            io.to(room).emit("updateLobby", serializeRoom(rooms[room]));
        }
    });
});

function startGame(room) {
    if (rooms[room] && !rooms[room].gameStarted) {
        rooms[room].gameStarted = true;

        const players = Object.keys(rooms[room].players).map(playerId => ({
            id: playerId,
            username: rooms[room].players[playerId].username,
            character: rooms[room].characters[playerId] || "/assets/default.png", 
            score: rooms[room].players[playerId].score || 0,
            bombs: rooms[room].players[playerId].bombs || 1,
            fire: rooms[room].players[playerId].fire || 1
        }));

        console.log(`Juego iniciado en sala ${room} con jugadores:`, players.map(p => p.username).join(', '));
        io.to(room).emit("gameStart", players);
    }
}


function serializeRoom(room) {
    const { timer, usernames, ...roomData } = room;
    return roomData;
}

console.log("Servidor WebSocket de Bomberman corriendo en el puerto 3000");