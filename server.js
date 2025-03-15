const { Server } = require("socket.io");
const io = new Server(3001, {
    cors: {
        origin: "http://localhost:5173", 
        methods: ["GET", "POST"]
    }
});

// Salas predefinidas
const rooms = {
    "Sala 1": [],
    "Sala 2": [],
    "Sala 3": [],
    "Sala 4": [],
};

io.on("connection", (socket) => {
    console.log("Un jugador se ha conectado:", socket.id);

    // Enviar la lista de salas predefinidas cuando un jugador se conecta
    socket.emit("roomsList", Object.keys(rooms));

    socket.on("joinRoom", (roomName, playerName) => {
        if (!rooms[roomName]) {
            rooms[roomName] = [];
        }
        rooms[roomName].push(playerName);
        socket.join(roomName);
        io.to(roomName).emit("roomUpdate", rooms[roomName]);
        console.log(`${playerName} entró a la sala ${roomName}`);

        // Enviar la lista de salas actualizada a todos los clientes
        io.emit("roomsList", Object.keys(rooms));
    });

    socket.on("leaveRoom", (roomName, playerName) => {
        if (rooms[roomName]) {
            rooms[roomName] = rooms[roomName].filter(p => p !== playerName);
            socket.leave(roomName);
            io.to(roomName).emit("roomUpdate", rooms[roomName]);
            console.log(`${playerName} salió de la sala ${roomName}`);

            io.emit("roomsList", Object.keys(rooms));
        }
    });

    socket.on("disconnect", () => {
        console.log("Un jugador se ha desconectado:", socket.id);
    });
});

console.log("Servidor WebSocket corriendo en el puerto 3001");
