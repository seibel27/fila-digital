// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(__dirname));

// Senha do admin: vem do ambiente em produção; fallback "crepe" só para desenvolvimento local
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'crepe';

// Estado da aplicação (Em memória)
let queue = [];
let notifiedUsers = new Set(); // Evita mandar o mesmo WhatsApp duas vezes na mesma rodada

// Mock da API do WhatsApp
async function sendWhatsAppMessage(phone, name) {
    console.log(`[WhatsApp API] Mensagem enviada para ${phone}: "Olá ${name}, vá para a estação de crepe! Sua vez está chegando."`);
    // Aqui entraria a integração real com Twilio, Z-API, Evolution API, etc.
}

// Telefone visível só para o dono e para admins; os demais recebem a versão mascarada
function maskPhone(phone) {
    const p = String(phone);
    if (p.length <= 4) return '****';
    return p.slice(0, 2) + '*'.repeat(p.length - 4) + p.slice(-2);
}

// Versão da fila sem dados internos (socketId)
function fullQueue() {
    return queue.map(({ name, phone }) => ({ name, phone }));
}

function maskedQueueFor(ownPhone) {
    return queue.map(({ name, phone }) => ({
        name,
        phone: phone === ownPhone ? phone : maskPhone(phone)
    }));
}

io.on('connection', (socket) => {

    // Cliente entra na fila
    socket.on('join_queue', (user) => {
        if (!user || !user.name || !user.phone) return;
        const name = String(user.name);
        const phone = String(user.phone);

        // Guarda o telefone deste socket: é o que autoriza o "Fui Atendido" dele mesmo
        socket.data.phone = phone;

        const existingUser = queue.find(u => u.phone === phone);
        if (!existingUser) {
            queue.push({ name, phone, socketId: socket.id });
        } else {
            // Atualiza o socketId caso o cliente tenha recarregado a página
            existingUser.socketId = socket.id;
        }
        updateAllClients();
    });

    // Admin valida a senha no servidor; nunca no cliente
    socket.on('admin_login', (password, callback) => {
        const success = typeof password === 'string' && password === ADMIN_PASSWORD;
        if (success) {
            socket.data.isAdmin = true;
        }
        if (typeof callback === 'function') callback({ success });
        if (success) socket.emit('queue_updated', fullQueue());
    });

    // Cliente (ou Admin) marca como atendido.
    // Permitido apenas para admins ou para o próprio telefone registrado no join_queue.
    socket.on('mark_served', (phone) => {
        const target = String(phone);
        const isSelf = socket.data.phone && socket.data.phone === target;
        if (!socket.data.isAdmin && !isSelf) return;

        queue = queue.filter(u => u.phone !== target);
        notifiedUsers.delete(target); // Limpa o status de notificação para a próxima vez
        updateAllClients();
    });

    // Sincronização da fila completa: só para admins (a lista expõe os telefones de todos)
    socket.on('request_queue_sync', () => {
        if (!socket.data.isAdmin) return;
        socket.emit('queue_updated', fullQueue());
    });
});

function updateAllClients() {
    // Admins recebem a fila completa; convidados recebem os telefones mascarados
    // (exceto o próprio, necessário para o cliente localizar a sua posição)
    for (const [, s] of io.of('/').sockets) {
        if (s.data.isAdmin) {
            s.emit('queue_updated', fullQueue());
        } else {
            s.emit('queue_updated', maskedQueueFor(s.data.phone));
        }
    }

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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
