// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(__dirname));

// Estado da aplicação (Em memória)
let queue = [];
let notifiedUsers = new Set(); // Evita mandar o mesmo WhatsApp duas vezes na mesma rodada

// Mock da API do WhatsApp
async function sendWhatsAppMessage(phone, name) {
    console.log(`[WhatsApp API] Mensagem enviada para ${phone}: "Olá ${name}, vá para a estação de crepe! Sua vez está chegando."`);
    // Aqui entraria a integração real com Twilio, Z-API, Evolution API, etc.
}

io.on('connection', (socket) => {

    // Cliente entra na fila
    socket.on('join_queue', (user) => {
        const existingUser = queue.find(u => u.phone === user.phone);
        if (!existingUser) {
            queue.push({ ...user, socketId: socket.id });
        } else {
            // Atualiza o socketId caso o cliente tenha recarregado a página
            existingUser.socketId = socket.id;
        }
        updateAllClients();
    });

    // Cliente (ou Admin) marca como atendido
    socket.on('mark_served', (phone) => {
        queue = queue.filter(u => u.phone !== phone);
        notifiedUsers.delete(phone); // Limpa o status de notificação para a próxima vez
        updateAllClients();
    });

    // Envia o estado atual para um cliente recém-conectado (como o Admin)
    socket.on('request_queue_sync', () => {
        socket.emit('queue_updated', queue);
    });

    function updateAllClients() {
        // Envia a fila inteira para todos os conectados
        io.emit('queue_updated', queue);

        // Lógica de Notificação do 3º lugar
        if (queue.length >= 3) {
            const thirdInLine = queue[2]; // Índice 2 = 3ª posição
            if (!notifiedUsers.has(thirdInLine.phone)) {
                sendWhatsAppMessage(thirdInLine.phone, thirdInLine.name);
                notifiedUsers.add(thirdInLine.phone);
                // O frontend já vai receber o update e mostrar a notificação em tempo real
            }
        }
    }
});

server.listen(3000, () => {
    console.log('Servidor rodando na porta 3000');
});