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
                timer: null,
                gameStarted: false
            };
        }
    
        io.emit("roomsList", Object.keys(rooms));
    
        if (rooms[room].players[socket.id]) {
            if (typeof callback === "function") {
                return callback({ success: true }); 
            }
            return;
        }
   
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
    
        if (!rooms[room].timer) {
            console.log(`Temporizador iniciado para la sala ${room}.`);
            rooms[room].timer = setTimeout(() => {
                console.log(`Tiempo agotado en sala ${room}. Iniciando juego con los jugadores presentes...`);
                startGame(room); 
            }, 10000); 
        }
    
        if (typeof callback === "function") {
            callback({ success: true });
        }
    });

    socket.on("setReady", (room) => {
        if (rooms[room]) {
            rooms[room].ready[socket.id] = true;
            io.to(room).emit("updateLobby", serializeRoom(rooms[room]));
    
            if (Object.values(rooms[room].ready).every((r) => r) && Object.keys(rooms[room].players).length >= 2) {
                console.log(`Todos listos en sala ${room}. Iniciando juego...`);
                clearTimeout(rooms[room].timer); 
                startGame(room);
            }
        }
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

                if (Object.keys(rooms[room].players).length === 0) {
                    clearTimeout(rooms[room].timer);
                    delete rooms[room];
                    console.log(`Sala ${room} eliminada por falta de jugadores`);
                } else {
                    io.to(room).emit("updateLobby", serializeRoom(rooms[room]));
                }
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