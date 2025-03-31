const { Server } = require("socket.io");

const io = new Server(3000, { cors: { origin: "*" } });

let rooms = {}; 

io.on("connection", (socket) => {
    console.log("Jugador conectado:", socket.id);

    socket.on("getRooms", () => {
        socket.emit("roomsList", Object.keys(rooms));
    });

    socket.on("joinRoom", (room, callback) => { 
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
        rooms[room].players[socket.id] = { x: 0, y: 0 }; 
        rooms[room].ready[socket.id] = false;
    
        console.log(`Jugador ${socket.id} se unió a ${room}`);
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

            const players = Object.values(rooms[room].players || {}).map(player => ({
                id: player.id,
                character: player.character || "/assets/default.png", 
                score: player.score || 0,
                bombs: player.bombs || 1,
                fire: player.fire || 1
            }));
    
            console.log(`Juego iniciado en sala ${room}`);
        }
    }
    
    socket.on("selectCharacter", ({ room, character }) => {
        if (rooms[room]) {
            rooms[room].characters[socket.id] = character;
            io.to(room).emit("updateLobby", serializeRoom(rooms[room]));
        }
    });

    /*socket.on("setReady", (room) => {
        if (rooms[room]) {
            rooms[room].ready[socket.id] = true;
            io.to(room).emit("updateLobby", serializeRoom(rooms[room]));

            if (Object.values(rooms[room].ready).every((r) => r)) {
                startGame(room);
            }
        }
    });*/

    socket.on("disconnect", () => {
        for (let room in rooms) {
            if (rooms[room].players[socket.id]) {
                delete rooms[room].players[socket.id];
                delete rooms[room].ready[socket.id];
                delete rooms[room].characters[socket.id];

                if (Object.keys(rooms[room].players).length === 0) {
                    clearTimeout(rooms[room].timer);
                    delete rooms[room];
                } else {
                    io.to(room).emit("updateLobby", serializeRoom(rooms[room]));
                }
                break;
            }
        }
    });
});


function serializeRoom(room) {
    const { timer, ...safeRoom } = room; 
    return JSON.parse(JSON.stringify(safeRoom));
}


console.log("Servidor WebSocket de Bomberman corriendo en el puerto 3000");
