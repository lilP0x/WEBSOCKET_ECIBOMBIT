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
                    map: "mapa1", //Mapa por defecto
                    time: 5,      //Tiempo por defecto (minutos)
                    items: 2      //Ítems por defecto
                }
            };
        }
    
        io.emit("roomsList", Object.keys(rooms));
    
        if (rooms[room].players[socket.id]) {
            if (typeof callback === "function") {
                return callback({ success: true }); 
            }
            return;
        } //ESTO SE PUEDE QUITAR
   
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
    
        socket.join(room);
        rooms[room].players[socket.id] = {
            id: socket.id,
            x: 0,
            y: 0,
            username: username
        };
        rooms[room].ready[socket.id] = false;
    
        console.log(`Jugador ${socket.id} (${username}) se unió a ${room}`);
        io.to(room).emit("updateLobby", serializeRoom(rooms[room]));
    
        if (typeof callback === "function") {
            callback({ success: true });
        }
    });

    socket.on("setReady", (room) => {
        if (rooms[room]) {
            rooms[room].ready[socket.id] = true;
            io.to(room).emit("updateLobby", serializeRoom(rooms[room]));
        }
    });

    //Nueva funcionalidad: Configuración de la sala
    socket.on("setRoomConfig", ({ room, map, time, items }, callback) => {
        if (!rooms[room]) return;

        if (socket.id !== rooms[room].owner) {
            if (typeof callback === "function") {
                return callback({ success: false, message: "Solo el creador puede cambiar la configuración." });
            }
            return;
        }

        if (map) rooms[room].config.map = map;
        if (time) rooms[room].config.time = time;
        if (items) rooms[room].config.items = items;

        io.to(room).emit("updateLobby", serializeRoom(rooms[room]));

        if (typeof callback === "function") {
            callback({ success: true });
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
            fire: 1
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

function serializeRoom(room) {
    // Creamos una copia segura para enviar al cliente sin el timer
    const { timer, ...roomData } = room;
    return roomData;
}

console.log("Servidor WebSocket de Bomberman corriendo en el puerto 3000");