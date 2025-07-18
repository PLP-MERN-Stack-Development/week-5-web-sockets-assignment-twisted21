// server/index.js
// This server uses Express to serve a basic webpage (though the React app will handle the main UI)
// and Socket.io for real-time bidirectional communication.

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Configure CORS for Socket.io to allow connections from the React frontend.
// The origin should be your React app's development server URL.
const io = new Server(server, {
    cors: {
        origin: "*", // Adjust this if your React app runs on a different port
        methods: ["GET", "POST"]
    }
});

// Use Express middleware for CORS for HTTP requests (if any, though not strictly needed for this chat app's API).
app.use(cors());
app.use(express.json());

// In-memory store for users and their associated socket IDs.
// In a real application, you'd use a database (e.g., MongoDB, PostgreSQL) for persistence.
const users = new Map(); // Map<socketId, { username, currentRoom }>
const rooms = new Map(); // Map<roomId, { name, users: Set<socketId> }>

// Initialize a default public room
const DEFAULT_ROOM = 'general';
rooms.set(DEFAULT_ROOM, { name: 'General Chat', users: new Set() });

// Socket.io event handling
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // --- User Management ---

    // Event for a user joining the chat (setting their username)
    socket.on('join_chat', (username) => {
        if (!username) {
            socket.emit('error_message', 'Username cannot be empty.');
            return;
        }

        // Check if username already exists (simple check for demonstration)
        const existingUser = Array.from(users.values()).find(user => user.username === username);
        if (existingUser) {
            socket.emit('error_message', 'Username already taken. Please choose another.');
            return;
        }

        users.set(socket.id, { username, currentRoom: DEFAULT_ROOM });
        socket.join(DEFAULT_ROOM); // Join the default room

        // Notify all clients about the new user joining
        io.emit('user_joined', { socketId: socket.id, username, currentRoom: DEFAULT_ROOM });
        console.log(`${username} (${socket.id}) joined the chat.`);

        // Send the current list of online users to the newly joined user
        const onlineUsers = Array.from(users.entries()).map(([id, data]) => ({
            socketId: id,
            username: data.username,
            currentRoom: data.currentRoom
        }));
        socket.emit('online_users', onlineUsers);

        // Send the list of available rooms to the newly joined user
        const availableRooms = Array.from(rooms.keys());
        socket.emit('available_rooms', availableRooms);

        // Send a welcome message to the user
        socket.emit('receive_message', {
            sender: 'System',
            message: `Welcome, ${username}! You are in the '${DEFAULT_ROOM}' room.`,
            timestamp: new Date().toISOString(),
            room: DEFAULT_ROOM
        });

        // Add user to the default room's user set
        rooms.get(DEFAULT_ROOM).users.add(socket.id);
        io.to(DEFAULT_ROOM).emit('room_users_update', {
            room: DEFAULT_ROOM,
            users: Array.from(rooms.get(DEFAULT_ROOM).users).map(id => users.get(id)?.username).filter(Boolean)
        });
    });

    // --- Room Management ---

    // Event for a user joining a specific room
    socket.on('join_room', (roomName) => {
        const user = users.get(socket.id);
        if (!user) {
            socket.emit('error_message', 'Please set your username first.');
            return;
        }

        // Leave the current room first
        if (user.currentRoom) {
            socket.leave(user.currentRoom);
            rooms.get(user.currentRoom)?.users.delete(socket.id);
            // Notify old room about user leaving
            io.to(user.currentRoom).emit('room_users_update', {
                room: user.currentRoom,
                users: Array.from(rooms.get(user.currentRoom)?.users || new Set()).map(id => users.get(id)?.username).filter(Boolean)
            });
            io.to(user.currentRoom).emit('receive_message', {
                sender: 'System',
                message: `${user.username} has left the room.`,
                timestamp: new Date().toISOString(),
                room: user.currentRoom
            });
        }

        // Create room if it doesn't exist
        if (!rooms.has(roomName)) {
            rooms.set(roomName, { name: roomName, users: new Set() });
            io.emit('available_rooms', Array.from(rooms.keys())); // Notify all about new room
        }

        socket.join(roomName); // Join the new room
        user.currentRoom = roomName; // Update user's current room
        rooms.get(roomName).users.add(socket.id); // Add user to new room's user set

        // Notify new room about user joining
        io.to(roomName).emit('room_users_update', {
            room: roomName,
            users: Array.from(rooms.get(roomName).users).map(id => users.get(id)?.username).filter(Boolean)
        });
        io.to(roomName).emit('receive_message', {
            sender: 'System',
            message: `${user.username} has joined the room.`,
            timestamp: new Date().toISOString(),
            room: roomName
        });

        socket.emit('room_changed', roomName); // Confirm room change to the user
        console.log(`${user.username} (${socket.id}) joined room: ${roomName}`);
    });

    // --- Messaging ---

    // Event for sending a public message to the current room
    socket.on('send_message', (data) => {
        const user = users.get(socket.id);
        if (!user) {
            socket.emit('error_message', 'Please set your username first.');
            return;
        }

        const messageData = {
            sender: user.username,
            message: data.message,
            timestamp: new Date().toISOString(),
            room: user.currentRoom // Ensure message is associated with the current room
        };
        // Emit message to all clients in the same room
        io.to(user.currentRoom).emit('receive_message', messageData);
        console.log(`Message from ${user.username} in room ${user.currentRoom}: ${data.message}`);
    });

    // Event for sending a private message
    socket.on('send_private_message', (data) => {
        const senderUser = users.get(socket.id);
        if (!senderUser) {
            socket.emit('error_message', 'Please set your username first.');
            return;
        }

        const receiverSocketId = data.receiverSocketId;
        const receiverUser = users.get(receiverSocketId);

        if (!receiverUser) {
            socket.emit('error_message', `User with ID ${receiverSocketId} is not online.`);
            return;
        }

        const messageData = {
            sender: senderUser.username,
            message: data.message,
            timestamp: new Date().toISOString(),
            isPrivate: true,
            receiver: receiverUser.username
        };

        // Emit message to the sender
        socket.emit('receive_message', messageData);
        // Emit message to the receiver
        io.to(receiverSocketId).emit('receive_message', messageData);
        console.log(`Private message from ${senderUser.username} to ${receiverUser.username}: ${data.message}`);
    });

    // --- Typing Indicators ---

    // Event when a user starts typing
    socket.on('typing_start', (room) => {
        const user = users.get(socket.id);
        if (user) {
            // Broadcast to others in the room (excluding the sender)
            socket.to(room).emit('typing_status', { username: user.username, isTyping: true, room });
        }
    });

    // Event when a user stops typing
    socket.on('typing_stop', (room) => {
        const user = users.get(socket.id);
        if (user) {
            // Broadcast to others in the room (excluding the sender)
            socket.to(room).emit('typing_status', { username: user.username, isTyping: false, room });
        }
    });

    // --- Disconnection ---

    socket.on('disconnect', () => {
        const user = users.get(socket.id);
        if (user) {
            console.log(`User disconnected: ${user.username} (${socket.id})`);
            // Remove user from their current room's set
            if (user.currentRoom && rooms.has(user.currentRoom)) {
                rooms.get(user.currentRoom).users.delete(socket.id);
                io.to(user.currentRoom).emit('room_users_update', {
                    room: user.currentRoom,
                    users: Array.from(rooms.get(user.currentRoom).users).map(id => users.get(id)?.username).filter(Boolean)
                });
                io.to(user.currentRoom).emit('receive_message', {
                    sender: 'System',
                    message: `${user.username} has left the room.`,
                    timestamp: new Date().toISOString(),
                    room: user.currentRoom
                });
            }
            users.delete(socket.id); // Remove user from the global users map
            io.emit('user_disconnected', socket.id); // Notify all clients about disconnection
        } else {
            console.log(`Unknown user disconnected: ${socket.id}`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

