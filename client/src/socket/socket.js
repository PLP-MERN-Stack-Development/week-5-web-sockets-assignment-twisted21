// client/src/App.js
// This React application serves as the client-side interface for the real-time chat.
// It uses Socket.io to communicate with the Node.js server.

import React, { useEffect, useState, useRef } from 'react';
import io from 'socket.io-client';

// Establish Socket.io connection to the server
const socket = io('http://localhost:3000'); // Ensure this matches your server's address and port

function App() {
    const [username, setUsername] = useState('');
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [message, setMessage] = useState('');
    const [messages, setMessages] = useState([]);
    const [onlineUsers, setOnlineUsers] = useState([]);
    const [currentRoom, setCurrentRoom] = useState('general');
    const [availableRooms, setAvailableRooms] = useState(['general']);
    const [typingUsers, setTypingUsers] = useState({}); // { username: true/false }
    const [privateChatTarget, setPrivateChatTarget] = useState(null); // { socketId, username }
    const messagesEndRef = useRef(null); // Ref for auto-scrolling to the latest message

    // Effect to scroll to the bottom of the messages container
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Socket.io event listeners
    useEffect(() => {
        // Event: Receive a message (public or private)
        socket.on('receive_message', (data) => {
            setMessages((prevMessages) => [...prevMessages, data]);
            // Play a sound notification for new messages (optional)
            // const audio = new Audio('/path/to/notification.mp3');
            // audio.play().catch(e => console.error("Error playing sound:", e));
        });

        // Event: Update list of online users
        socket.on('online_users', (users) => {
            setOnlineUsers(users);
        });

        // Event: A user has joined the chat
        socket.on('user_joined', (user) => {
            setOnlineUsers((prevUsers) => {
                // Prevent duplicates if user already in list
                if (!prevUsers.some(u => u.socketId === user.socketId)) {
                    return [...prevUsers, user];
                }
                return prevUsers;
            });
            setMessages((prevMessages) => [...prevMessages, {
                sender: 'System',
                message: `${user.username} has joined the chat.`,
                timestamp: new Date().toISOString(),
                room: user.currentRoom
            }]);
        });

        // Event: A user has disconnected
        socket.on('user_disconnected', (socketId) => {
            setOnlineUsers((prevUsers) => prevUsers.filter(user => user.socketId !== socketId));
            const disconnectedUser = onlineUsers.find(u => u.socketId === socketId);
            if (disconnectedUser) {
                setMessages((prevMessages) => [...prevMessages, {
                    sender: 'System',
                    message: `${disconnectedUser.username} has disconnected.`,
                    timestamp: new Date().toISOString(),
                    room: disconnectedUser.currentRoom // Or just general if not tracking per-room
                }]);
            }
        });

        // Event: Typing status update
        socket.on('typing_status', (data) => {
            setTypingUsers((prev) => ({
                ...prev,
                [data.username]: data.isTyping
            }));
        });

        // Event: Update available rooms list
        socket.on('available_rooms', (rooms) => {
            setAvailableRooms(rooms);
        });

        // Event: Room changed confirmation from server
        socket.on('room_changed', (newRoom) => {
            setCurrentRoom(newRoom);
            setMessages([]); // Clear messages when changing rooms
            setTypingUsers({}); // Clear typing indicators
            setPrivateChatTarget(null); // Exit private chat when changing rooms
        });

        // Event: Error messages from the server
        socket.on('error_message', (msg) => {
            alert(`Error: ${msg}`); // Use a custom modal in a real app
        });

        // Event: Room users update (for displaying users in current room)
        socket.on('room_users_update', (data) => {
            // This event is useful if you want to show users *within* the current active room
            // For simplicity, we are using the general 'online_users' for now.
            // If you implement a dedicated room users list, update state here.
            console.log(`Users in room ${data.room}: ${data.users.join(', ')}`);
        });

        // Clean up socket listeners on component unmount
        return () => {
            socket.off('receive_message');
            socket.off('online_users');
            socket.off('user_joined');
            socket.off('user_disconnected');
            socket.off('typing_status');
            socket.off('available_rooms');
            socket.off('room_changed');
            socket.off('error_message');
            socket.off('room_users_update');
        };
    }, [onlineUsers]); // Added onlineUsers to dependency array to ensure disconnectedUser lookup works

    // Handle user joining the chat
    const handleJoinChat = () => {
        if (username.trim()) {
            socket.emit('join_chat', username.trim());
            setIsLoggedIn(true);
        } else {
            alert('Please enter a username.');
        }
    };

    // Handle sending a message (public or private)
    const handleSendMessage = (e) => {
        e.preventDefault();
        if (message.trim()) {
            if (privateChatTarget) {
                socket.emit('send_private_message', {
                    receiverSocketId: privateChatTarget.socketId,
                    message: message.trim()
                });
            } else {
                socket.emit('send_message', { message: message.trim() });
            }
            setMessage('');
            socket.emit('typing_stop', currentRoom); // Stop typing after sending
        }
    };

    // Handle typing status
    const handleTyping = (e) => {
        setMessage(e.target.value);
        if (e.target.value.length > 0) {
            socket.emit('typing_start', currentRoom);
        } else {
            socket.emit('typing_stop', currentRoom);
        }
    };

    // Handle joining a different room
    const handleJoinRoom = (roomName) => {
        if (roomName !== currentRoom) {
            socket.emit('join_room', roomName);
        }
    };

    // Start a private chat
    const startPrivateChat = (user) => {
        setPrivateChatTarget(user);
        setMessages([]); // Clear messages for new private chat view
        alert(`Starting private chat with ${user.username}`);
    };

    // Exit private chat
    const exitPrivateChat = () => {
        setPrivateChatTarget(null);
        setMessages([]); // Clear private messages
        alert(`Exited private chat. Back to ${currentRoom} room.`);
    };

    // Filter messages based on current room or private chat target
    const getFilteredMessages = () => {
        if (privateChatTarget) {
            return messages.filter(
                (msg) =>
                    msg.isPrivate &&
                    ((msg.sender === username && msg.receiver === privateChatTarget.username) ||
                     (msg.sender === privateChatTarget.username && msg.receiver === username))
            );
        } else {
            return messages.filter((msg) => msg.room === currentRoom && !msg.isPrivate);
        }
    };

    return (
        <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4 font-inter">
            {!isLoggedIn ? (
                // Login Screen
                <div className="bg-white p-8 rounded-lg shadow-lg w-full max-w-md">
                    <h1 className="text-3xl font-bold text-center text-gray-800 mb-6">Join Chat</h1>
                    <input
                        type="text"
                        placeholder="Enter your username"
                        className="w-full p-3 mb-4 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleJoinChat()}
                    />
                    <button
                        onClick={handleJoinChat}
                        className="w-full bg-blue-600 text-white p-3 rounded-md hover:bg-blue-700 transition duration-300 ease-in-out shadow-md"
                    >
                        Join Chat
                    </button>
                </div>
            ) : (
                // Chat Application
                <div className="flex flex-col md:flex-row bg-white rounded-lg shadow-lg w-full max-w-6xl h-[90vh] overflow-hidden">
                    {/* Sidebar for Online Users and Rooms */}
                    <div className="w-full md:w-1/4 bg-gray-50 border-r border-gray-200 p-4 flex flex-col">
                        <h2 className="text-xl font-semibold text-gray-800 mb-4">Online Users</h2>
                        <ul className="flex-grow overflow-y-auto mb-4">
                            {onlineUsers.map((user) => (
                                <li
                                    key={user.socketId}
                                    className={`flex items-center p-2 rounded-md mb-2 cursor-pointer ${user.socketId === socket.id ? 'bg-blue-100 text-blue-800' : 'hover:bg-gray-200'}`}
                                    onClick={() => user.socketId !== socket.id && startPrivateChat(user)}
                                >
                                    <span className={`w-2 h-2 rounded-full mr-2 ${user.socketId === socket.id ? 'bg-blue-500' : 'bg-green-500'}`}></span>
                                    <span className="font-medium">{user.username}</span>
                                    {user.socketId === socket.id && <span className="ml-auto text-sm text-blue-600">(You)</span>}
                                </li>
                            ))}
                        </ul>

                        <h2 className="text-xl font-semibold text-gray-800 mb-4 mt-auto">Rooms</h2>
                        <ul className="overflow-y-auto">
                            {availableRooms.map((room) => (
                                <li
                                    key={room}
                                    className={`p-2 rounded-md mb-2 cursor-pointer ${currentRoom === room ? 'bg-blue-500 text-white' : 'hover:bg-gray-200'}`}
                                    onClick={() => handleJoinRoom(room)}
                                >
                                    # {room}
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Main Chat Area */}
                    <div className="flex-1 flex flex-col p-4">
                        <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-200">
                            <h2 className="text-2xl font-bold text-gray-800">
                                {privateChatTarget ? `Private Chat with ${privateChatTarget.username}` : `Room: #${currentRoom}`}
                            </h2>
                            {privateChatTarget && (
                                <button
                                    onClick={exitPrivateChat}
                                    className="bg-red-500 text-white px-3 py-1 rounded-md text-sm hover:bg-red-600 transition duration-300"
                                >
                                    Exit Private Chat
                                </button>
                            )}
                        </div>

                        {/* Messages Display */}
                        <div className="flex-1 overflow-y-auto p-2 mb-4 bg-gray-50 rounded-md border border-gray-200">
                            {getFilteredMessages().map((msg, index) => (
                                <div
                                    key={index}
                                    className={`mb-3 p-3 rounded-lg max-w-[80%] ${msg.sender === username ? 'bg-blue-500 text-white ml-auto' : 'bg-gray-200 text-gray-800 mr-auto'}`}
                                >
                                    <div className="font-semibold text-sm mb-1">
                                        {msg.sender === username ? 'You' : msg.sender}
                                        {msg.isPrivate && msg.receiver && (
                                            <span className="ml-2 text-xs opacity-80">
                                                {msg.sender === username ? `to ${msg.receiver}` : `(private)`}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-base break-words">{msg.message}</p>
                                    <div className="text-right text-xs opacity-70 mt-1">
                                        {new Date(msg.timestamp).toLocaleTimeString()}
                                    </div>
                                </div>
                            ))}
                            <div ref={messagesEndRef} /> {/* Scroll target */}
                        </div>

                        {/* Typing Indicator */}
                        <div className="h-6 text-sm text-gray-600 mb-2">
                            {Object.entries(typingUsers).some(([user, isTyping]) => isTyping && user !== username) && (
                                <p>
                                    {Object.entries(typingUsers)
                                        .filter(([user, isTyping]) => isTyping && user !== username)
                                        .map(([user]) => user)
                                        .join(', ')}{' '}
                                    {Object.entries(typingUsers).filter(([user, isTyping]) => isTyping && user !== username).length > 1 ? 'are' : 'is'} typing...
                                </p>
                            )}
                        </div>

                        {/* Message Input */}
                        <form onSubmit={handleSendMessage} className="flex mt-auto">
                            <input
                                type="text"
                                placeholder={privateChatTarget ? `Message ${privateChatTarget.username}...` : `Message #${currentRoom}...`}
                                className="flex-1 p-3 border border-gray-300 rounded-l-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                value={message}
                                onChange={handleTyping}
                            />
                            <button
                                type="submit"
                                className="bg-blue-600 text-white p-3 rounded-r-md hover:bg-blue-700 transition duration-300 ease-in-out shadow-md"
                            >
                                Send
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;
